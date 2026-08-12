import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { PermissionContext } from '../auth/require-permission.ts';
import { serializeMarkdownDocument } from '../content/frontmatter.ts';
import { normalizePublishedContent } from '../content/publication.ts';
import { contentVersionSha } from '../content/version.ts';
import {
  createBranch,
  closePullRequest,
  createContent,
  createPullRequest,
  enablePullRequestAutoMerge,
  findOpenPullRequest,
  getBranchHeadSha,
  getCommitVerification,
  getPullRequest,
  mergePullRequest,
  readContent,
  updateContent,
} from '../github/client.ts';
import { recordAudit } from '../observability/audit.ts';
import { AppError, ConflictError, GitHubError, InternalError } from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';
import {
  contentCollection,
  validateContentDocument,
  type ContentCollection,
} from './content-service.ts';

const ACTIVE_PUBLICATION_STATES = ['queued', 'validating', 'pr_open', 'merged'];

export function publicationBranch(contentId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  return `cms/${contentId}/${stamp}`;
}

function draftFromRecord(record: any) {
  const relation = record?.cms_content_drafts;
  return Array.isArray(relation) ? relation[0] || null : relation || null;
}

async function recordEvent(input: {
  record: any;
  eventType: string;
  actorId?: string | null;
  contentSha?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { error } = await client.from('cms_workflow_events').insert({
    content_id: input.record.id,
    from_state: input.record.workflow_state,
    to_state: input.record.workflow_state,
    event_type: input.eventType,
    content_sha: input.contentSha || null,
    actor_id: input.actorId || null,
    metadata: input.metadata || {},
  });
  if (error) throw new InternalError('No se pudo registrar el evento de publicación.');
}

async function immutableVersion(record: any, draft: any, actorId: string) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data: existing, error: existingError } = await client
    .from('cms_content_versions')
    .select('*')
    .eq('content_id', record.id)
    .eq('content_sha', draft.content_sha)
    .maybeSingle();
  if (existingError) throw new InternalError('No se pudo comprobar la versión publicable.');
  if (existing) return existing;

  const { data: latest, error: latestError } = await client
    .from('cms_content_versions')
    .select('version_number')
    .eq('content_id', record.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new InternalError('No se pudo numerar la versión publicable.');
  const { data: created, error } = await client
    .from('cms_content_versions')
    .insert({
      content_id: record.id,
      version_number: Number(latest?.version_number || 0) + 1,
      data: draft.data,
      body: draft.body,
      content_sha: draft.content_sha,
      reason: 'publication',
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error?.code === '23505') return immutableVersion(record, draft, actorId);
  if (error) throw new InternalError('No se pudo congelar la versión a publicar.');
  return created;
}

async function markFailed(publicationId: string, recordId: string, error: unknown) {
  const client = getAdminClient();
  if (!client) return;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message.slice(0, 2000) : 'Error desconocido';
  await client
    .from('cms_publications')
    .update({ status: 'failed', error_code: code, error_message: message })
    .eq('id', publicationId);
  await client
    .from('cms_content_records')
    .update({ publication_state: 'failed', workflow_state: 'publish_failed' })
    .eq('id', recordId);
}

async function confirmMerged(record: any, publication: any, pull: any, auth: PermissionContext) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const mergedAt = pull.merged_at || new Date().toISOString();
  const mergeSha = pull.merge_commit_sha || publication.merge_sha;
  const { data: version, error: versionError } = await client
    .from('cms_content_versions')
    .select('*')
    .eq('id', publication.version_id)
    .single();
  if (versionError || !version) throw new InternalError('No se encontró la versión publicada.');

  const hasNewerDraft = record.current_sha !== version.content_sha;
  const { error: publicationError } = await client
    .from('cms_publications')
    .update({ status: 'merged', merge_sha: mergeSha, merged_at: mergedAt })
    .eq('id', publication.id);
  if (publicationError) throw new InternalError('No se pudo confirmar la publicación.');
  const { data: updated, error } = await client
    .from('cms_content_records')
    .update({
      published_sha: version.content_sha,
      published_version_id: version.id,
      published_by: publication.requested_by,
      published_at: mergedAt,
      merge_sha: mergeSha,
      github_sha: mergeSha,
      workflow_state: hasNewerDraft ? 'draft' : 'published',
      publication_state: 'merged',
      deployment_state: 'merged',
    })
    .eq('id', record.id)
    .select('*')
    .single();
  if (error) throw new InternalError('No se pudo actualizar la versión publicada.');
  await recordEvent({
    record: updated,
    eventType: 'content_published',
    actorId: publication.requested_by,
    contentSha: version.content_sha,
    metadata: {
      publication_id: publication.id,
      pull_request: publication.github_pr_number,
      merge_sha: mergeSha,
    },
  });
  await recordAudit({
    requestId: auth.requestId,
    actorId: publication.requested_by,
    action: 'content_published',
    resourceType: record.collection,
    resourceId: record.id,
    result: 'success',
    metadata: { path: record.path, published_sha: version.content_sha, merge_sha: mergeSha },
  });
  return updated;
}

export async function reconcilePublication(record: any, auth: PermissionContext) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data: publication, error } = await client
    .from('cms_publications')
    .select('*')
    .eq('content_id', record.id)
    .in('status', ACTIVE_PUBLICATION_STATES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !publication?.github_pr_number) return record;

  const response = await getPullRequest(Number(publication.github_pr_number));
  if (!response.ok) return record;
  let pull: any = await response.json();
  if (pull.merged_at) return confirmMerged(record, publication, pull, auth);
  if (pull.state === 'closed') {
    await markFailed(
      publication.id,
      record.id,
      new ConflictError('La publicación fue cerrada antes de fusionarse.')
    );
    return { ...record, workflow_state: 'publish_failed', publication_state: 'failed' };
  }

  // Si el repositorio no admite auto-merge, esta reconciliación realiza el merge
  // en cuanto los checks técnicos terminan correctamente.
  try {
    const verification = await getCommitVerification(pull.head.sha);
    if (verification.failed) {
      const failedChecks = verification.failedChecks.join(', ') || 'validación técnica';
      const failure = new ConflictError(`Fallaron los checks de publicación: ${failedChecks}.`);
      await markFailed(publication.id, record.id, failure);
      await closePullRequest(Number(publication.github_pr_number)).catch(() => null);
      return {
        ...record,
        workflow_state: 'publish_failed',
        publication_state: 'failed',
        publication_error: failure.message,
      };
    }
    if (verification.success) {
      const mergeResponse = await mergePullRequest({
        number: Number(publication.github_pr_number),
        expectedHeadSha: pull.head.sha,
        method: 'squash',
      });
      if (mergeResponse.ok) {
        const refreshed = await getPullRequest(Number(publication.github_pr_number));
        if (refreshed.ok) {
          pull = await refreshed.json();
          if (pull.merged_at) return confirmMerged(record, publication, pull, auth);
        }
      }
    }
  } catch {
    // Checks pendientes o permiso Checks no configurado: GitHub auto-merge sigue a cargo.
  }
  return record;
}

export async function publishContent(input: {
  path: string;
  auth: PermissionContext;
  operationKey?: unknown;
}) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data: record, error } = await client
    .from('cms_content_records')
    .select('*, cms_content_drafts(*)')
    .eq('path', input.path)
    .maybeSingle();
  if (error || !record) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
  const draft = draftFromRecord(record);
  if (!draft) throw new ConflictError('No existe un borrador publicable.');
  const collection = contentCollection(record.collection) as ContentCollection;
  const validated = validateContentDocument(collection, draft.data, draft.body);
  if (contentVersionSha(validated, draft.body) !== draft.content_sha) {
    throw new ConflictError('La integridad del borrador no coincide con su checksum.');
  }
  if (record.published_sha === draft.content_sha && record.publication_state !== 'failed') {
    return { state: 'published', publicationState: record.publication_state, idempotent: true };
  }
  const version = await immutableVersion(record, draft, input.auth.user.id);
  const { data: active } = await client
    .from('cms_publications')
    .select('*')
    .eq('content_id', record.id)
    .eq('version_id', version.id)
    .in('status', ACTIVE_PUBLICATION_STATES)
    .maybeSingle();
  if (active) {
    return {
      state: 'publishing',
      publicationState: active.status,
      publicationId: active.id,
      idempotent: true,
    };
  }

  const operationKey =
    typeof input.operationKey === 'string' && /^[0-9a-f-]{36}$/i.test(input.operationKey)
      ? input.operationKey
      : randomUUID();
  const branch = publicationBranch(record.id);
  const { data: publication, error: reserveError } = await client
    .from('cms_publications')
    .insert({
      content_id: record.id,
      version_id: version.id,
      operation_key: operationKey,
      status: 'validating',
      github_branch: branch,
      requested_by: input.auth.user.id,
    })
    .select('*')
    .single();
  if (reserveError) throw new ConflictError('Ya existe una publicación en curso.');
  await client
    .from('cms_content_records')
    .update({
      workflow_state: 'publishing',
      publication_state: 'validating',
      publication_requested_by: input.auth.user.id,
      publication_requested_at: new Date().toISOString(),
      github_branch: branch,
      deployment_state: 'creating_pr',
    })
    .eq('id', record.id)
    .eq('current_sha', draft.content_sha);

  try {
    const publicationData = normalizePublishedContent(
      { ...version.data, draft: false, workflow_state: 'published' },
      'published'
    );
    validateContentDocument(collection, publicationData, version.body);
    const artifact = serializeMarkdownDocument(publicationData, version.body);
    const baseSha = await getBranchHeadSha();
    const branchResponse = await createBranch(branch, baseSha);
    if (!branchResponse.ok) {
      throw new GitHubError('No se pudo preparar la publicación.', {
        status: branchResponse.status,
      });
    }
    const existingResponse = await readContent(record.path, branch);
    let writeResponse;
    if (existingResponse.status === 404) {
      writeResponse = await createContent({
        path: record.path,
        content: artifact,
        message: `Publicar ${record.collection}: ${String(publicationData.title || record.path)}`,
        branch,
      });
    } else if (existingResponse.ok) {
      const existing: any = await existingResponse.json();
      const existingSource = Buffer.from(
        String(existing.content || '').replace(/\n/g, ''),
        'base64'
      ).toString('utf8');
      if (existingSource === artifact) {
        throw new ConflictError('Esta versión ya coincide con el Markdown publicado.');
      }
      writeResponse = await updateContent({
        path: record.path,
        content: artifact,
        message: `Publicar ${record.collection}: ${String(publicationData.title || record.path)}`,
        sha: existing.sha,
        branch,
      });
    } else {
      throw new GitHubError('No se pudo comprobar el Markdown publicado.', {
        status: existingResponse.status,
      });
    }
    if (!writeResponse.ok) {
      throw new GitHubError('No se pudo escribir la versión publicable.', {
        status: writeResponse.status,
      });
    }
    let pull: any = await findOpenPullRequest(branch);
    if (!pull) {
      const response = await createPullRequest({
        head: branch,
        title: `CMS: publicar ${String(publicationData.title || record.path)}`,
        body: [
          'Publicación técnica generada automáticamente por el CMS.',
          '',
          `- Contenido: \`${record.path}\``,
          `- Versión: \`${version.content_sha}\``,
          '',
          'No requiere revisión editorial adicional. Se fusionará al superar las validaciones.',
        ].join('\n'),
      });
      if (!response.ok) {
        throw new GitHubError('No se pudo abrir la publicación técnica.', {
          status: response.status,
        });
      }
      pull = await response.json();
    }
    if (pull.node_id) {
      try {
        const autoMerge = await enablePullRequestAutoMerge(pull.node_id);
        const autoMergeResult: any = autoMerge.ok ? await autoMerge.json() : null;
        if (!autoMerge.ok || autoMergeResult?.errors?.length) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'cms_publication.auto_merge.unavailable',
              pullRequest: pull.number,
              status: autoMerge.status,
              errors: (autoMergeResult?.errors || []).map((error: any) => error.type || 'unknown'),
            })
          );
        }
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'cms_publication.auto_merge.unavailable',
            pullRequest: pull.number,
            message: error instanceof Error ? error.message : String(error),
          })
        );
        // No se expone GitHub al usuario: reconcilePublication reintentará el merge.
      }
    }
    const { error: saveError } = await client
      .from('cms_publications')
      .update({
        status: 'pr_open',
        github_pr_number: pull.number,
        github_pr_url: pull.html_url,
      })
      .eq('id', publication.id);
    if (saveError) throw new InternalError('La publicación se creó, pero no pudo registrarse.');
    await client
      .from('cms_content_records')
      .update({
        publication_state: 'pr_open',
        deployment_state: 'pr_open',
        github_pr_number: pull.number,
        github_pr_url: pull.html_url,
      })
      .eq('id', record.id);
    await recordEvent({
      record,
      eventType: 'content_publish_requested',
      actorId: input.auth.user.id,
      contentSha: version.content_sha,
      metadata: { publication_id: publication.id, pull_request: pull.number },
    });
    await recordAudit({
      requestId: input.auth.requestId,
      actorId: input.auth.user.id,
      action: 'content_publish_requested',
      resourceType: record.collection,
      resourceId: record.id,
      result: 'success',
      metadata: { path: record.path, content_sha: version.content_sha },
    });
    return {
      state: 'publishing',
      publicationState: 'pr_open',
      publicationId: publication.id,
    };
  } catch (publicationError) {
    await markFailed(publication.id, record.id, publicationError);
    throw publicationError;
  }
}
