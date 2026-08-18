import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { PermissionContext } from '../auth/require-permission.ts';
import { serializeMarkdownDocument } from '../content/frontmatter.ts';
import { normalizePublishedContent } from '../content/publication.ts';
import { assertPublicationReady, publicDocumentData } from '../content/publication-readiness.ts';
import { contentVersionSha } from '../content/version.ts';
import {
  createBranch,
  closePullRequest,
  createContent,
  createPullRequest,
  deleteContent as deleteGitHubContent,
  enablePullRequestAutoMerge,
  findOpenPullRequest,
  getBranchHeadSha,
  getCommitVerification,
  getPullRequest,
  mergePullRequest,
  readContent,
  updateContent,
} from '../github/client.ts';
import { deployPublicUrl, getDeployForCommit, isDeployFailure } from '../netlify/deploys.ts';
import { recordAudit } from '../observability/audit.ts';
import { AppError, ConflictError, GitHubError, InternalError } from '../observability/errors.ts';
import { logEvent } from '../observability/logger.ts';
import { getAdminClient } from '../supabase/admin-client.ts';
import {
  contentCollection,
  validateContentDocument,
  type ContentCollection,
} from './content-service.ts';

const ACTIVE_PUBLICATION_STATES = ['queued', 'validating', 'pr_open', 'merged'];
type PublicationOperation = 'publish' | 'archive';
type ReconciliationContext = Pick<PermissionContext, 'requestId'>;

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
  if (error && error.code !== '23505') {
    throw new InternalError('No se pudo registrar el evento de publicación.');
  }
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

async function markFailed(
  publicationId: string,
  recordId: string,
  error: unknown,
  operation: PublicationOperation = 'publish'
) {
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
    .update({
      publication_state: 'failed',
      deployment_state: 'failed',
      workflow_state: operation === 'archive' ? 'archive_failed' : 'publish_failed',
    })
    .eq('id', recordId);
}

function publicationOperation(publication: any): PublicationOperation {
  return publication?.operation === 'archive' ? 'archive' : 'publish';
}

async function freshRecord(recordId: string) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_content_drafts(*), cms_publications(*)')
    .eq('id', recordId)
    .single();
  if (error || !data) throw new InternalError('No se pudo refrescar el estado editorial.');
  return data;
}

async function confirmDeployment(record: any, publication: any, context: ReconciliationContext) {
  if (!publication.merge_sha) return record;
  const deploy = await getDeployForCommit(publication.merge_sha);
  if (!deploy) return record;
  if (isDeployFailure(deploy)) {
    const failure = new AppError(
      'BUILD_ERROR',
      deploy.error_message || 'Netlify informó un despliegue fallido.',
      502
    );
    const client = getAdminClient();
    if (client) {
      await client
        .from('cms_publications')
        .update({ error_code: failure.code, error_message: failure.message })
        .eq('id', publication.id)
        .eq('status', 'merged');
      await client
        .from('cms_content_records')
        .update({ deployment_state: 'failed' })
        .eq('id', record.id)
        .eq('publication_state', 'merged');
    }
    logEvent('error', 'cms_publication.deploy_failed', {
      requestId: context.requestId,
      publicationId: publication.id,
      deployId: deploy.id,
      mergeSha: publication.merge_sha,
    });
    return {
      ...record,
      workflow_state: publicationOperation(publication) === 'archive' ? 'archiving' : 'publishing',
      publication_state: 'merged',
      deployment_state: 'failed',
      publication_error: failure.message,
    };
  }
  const deployedAt = deploy.published_at || deploy.updated_at;
  if (deploy.state !== 'ready' || !deployedAt) return record;

  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data: finalized, error } = await client.rpc('cms_finalize_publication', {
    p_publication_id: publication.id,
    p_deploy_id: deploy.id,
    p_deploy_url: deployPublicUrl(deploy),
    p_deployed_at: deployedAt,
    p_request_id: context.requestId,
  });
  if (error) throw new InternalError('No se pudo confirmar el despliegue de Netlify.');
  if (finalized) {
    logEvent('info', 'cms_publication.live', {
      requestId: context.requestId,
      publicationId: publication.id,
      operation: publicationOperation(publication),
      deployId: deploy.id,
      mergeSha: publication.merge_sha,
    });
  }
  return freshRecord(record.id);
}

async function confirmMerged(
  record: any,
  publication: any,
  pull: any,
  context: ReconciliationContext
) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const mergedAt = pull.merged_at || publication.merged_at || new Date().toISOString();
  const mergeSha = pull.merge_commit_sha || publication.merge_sha;
  if (!mergeSha) throw new InternalError('GitHub no devolvió el SHA del merge.');

  if (publication.status !== 'merged') {
    const { error } = await client.rpc('cms_mark_publication_merged', {
      p_publication_id: publication.id,
      p_merge_sha: mergeSha,
      p_merged_at: mergedAt,
    });
    if (error) throw new InternalError('No se pudo confirmar el merge de la publicación.');
  }

  const mergedPublication = {
    ...publication,
    status: 'merged',
    merge_sha: mergeSha,
    merged_at: mergedAt,
  };
  const mergedRecord = {
    ...record,
    workflow_state: publicationOperation(publication) === 'archive' ? 'archiving' : 'publishing',
    publication_state: 'merged',
    deployment_state: 'deploying',
    merge_sha: mergeSha,
  };
  return confirmDeployment(mergedRecord, mergedPublication, context);
}

export async function reconcilePublication(record: any, context: ReconciliationContext) {
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
  if (error || !publication) return record;
  if (publication.status === 'merged') return confirmDeployment(record, publication, context);
  if (!publication.github_pr_number) return record;

  const response = await getPullRequest(Number(publication.github_pr_number));
  if (!response.ok) return record;
  let pull: any = await response.json();
  if (pull.merged_at) return confirmMerged(record, publication, pull, context);
  if (pull.state === 'closed') {
    const failedState =
      publicationOperation(publication) === 'archive' ? 'archive_failed' : 'publish_failed';
    await markFailed(
      publication.id,
      record.id,
      new ConflictError('La publicación fue cerrada antes de fusionarse.'),
      publicationOperation(publication)
    );
    return { ...record, workflow_state: failedState, publication_state: 'failed' };
  }

  // Si el repositorio no admite auto-merge, esta reconciliación realiza el merge
  // en cuanto los checks técnicos terminan correctamente.
  try {
    const verification = await getCommitVerification(pull.head.sha);
    if (verification.failed) {
      const failedChecks = verification.failedChecks.join(', ') || 'validación técnica';
      const failure = new ConflictError(`Fallaron los checks de publicación: ${failedChecks}.`);
      await markFailed(publication.id, record.id, failure, publicationOperation(publication));
      await closePullRequest(Number(publication.github_pr_number)).catch(() => null);
      return {
        ...record,
        workflow_state:
          publicationOperation(publication) === 'archive' ? 'archive_failed' : 'publish_failed',
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
          if (pull.merged_at) return confirmMerged(record, publication, pull, context);
        }
      }
    }
  } catch {
    // Checks pendientes o permiso Checks no configurado: GitHub auto-merge sigue a cargo.
  }
  return record;
}

async function startPublication(input: {
  path: string;
  auth: PermissionContext;
  operationKey?: unknown;
  operation: PublicationOperation;
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
  const collection = contentCollection(record.collection) as ContentCollection;
  let version: any;

  if (input.operation === 'publish') {
    if (!draft) throw new ConflictError('No existe un borrador publicable.');
    const validated = validateContentDocument(collection, draft.data, draft.body);
    if (contentVersionSha(validated, draft.body) !== draft.content_sha) {
      throw new ConflictError('La integridad del borrador no coincide con su checksum.');
    }
    if (record.published_sha === draft.content_sha && record.publication_state !== 'failed') {
      return { state: 'published', publicationState: record.publication_state, idempotent: true };
    }
    version = await immutableVersion(record, draft, input.auth.user.id);
  } else {
    if (record.workflow_state === 'archived' && record.publication_state === 'archived') {
      return { state: 'archived', publicationState: 'archived', idempotent: true };
    }
    if (!record.published_version_id || !record.published_sha) {
      throw new ConflictError('Este contenido no tiene una versión publicada para archivar.');
    }
    const { data: publishedVersion, error: versionError } = await client
      .from('cms_content_versions')
      .select('*')
      .eq('id', record.published_version_id)
      .single();
    if (versionError || !publishedVersion) {
      throw new InternalError('No se encontró la versión publicada que debe archivarse.');
    }
    version = publishedVersion;
  }

  const { data: active } = await client
    .from('cms_publications')
    .select('*')
    .eq('content_id', record.id)
    .in('status', ACTIVE_PUBLICATION_STATES)
    .maybeSingle();
  if (active) {
    return {
      state: publicationOperation(active) === 'archive' ? 'archiving' : 'publishing',
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
      operation: input.operation,
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
      workflow_state: input.operation === 'archive' ? 'archiving' : 'publishing',
      publication_state: 'validating',
      publication_requested_by: input.auth.user.id,
      publication_requested_at: new Date().toISOString(),
      github_branch: branch,
      deployment_state: 'creating_pr',
    })
    .eq('id', record.id);

  try {
    const publicationData =
      input.operation === 'publish'
        ? normalizePublishedContent(
            { ...version.data, draft: false, workflow_state: 'published' },
            'published'
          )
        : version.data;
    if (input.operation === 'publish') {
      validateContentDocument(collection, publicationData, version.body);
      assertPublicationReady(collection, publicationData, version.body);
    }
    const baseSha = await getBranchHeadSha();
    const branchResponse = await createBranch(branch, baseSha);
    if (!branchResponse.ok) {
      throw new GitHubError('No se pudo preparar la publicación.', {
        status: branchResponse.status,
      });
    }
    const existingResponse = await readContent(record.path, branch);
    let writeResponse;
    if (input.operation === 'archive') {
      if (!existingResponse.ok) {
        throw new GitHubError('No se encontró el Markdown publicado que debe archivarse.', {
          status: existingResponse.status,
        });
      }
      const existing: any = await existingResponse.json();
      writeResponse = await deleteGitHubContent({
        path: record.path,
        sha: existing.sha,
        message: `Archivar ${record.collection}: ${String(publicationData.title || record.path)}`,
        branch,
      });
    } else if (existingResponse.status === 404) {
      const artifact = serializeMarkdownDocument(publicDocumentData(publicationData), version.body);
      writeResponse = await createContent({
        path: record.path,
        content: artifact,
        message: `Publicar ${record.collection}: ${String(publicationData.title || record.path)}`,
        branch,
      });
    } else if (existingResponse.ok) {
      const artifact = serializeMarkdownDocument(publicDocumentData(publicationData), version.body);
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
      throw new GitHubError(
        input.operation === 'archive'
          ? 'No se pudo retirar el Markdown publicado.'
          : 'No se pudo escribir la versión publicable.',
        {
          status: writeResponse.status,
        }
      );
    }
    let pull: any = await findOpenPullRequest(branch);
    if (!pull) {
      const response = await createPullRequest({
        head: branch,
        title: `CMS: ${input.operation === 'archive' ? 'archivar' : 'publicar'} ${String(publicationData.title || record.path)}`,
        body: [
          `${input.operation === 'archive' ? 'Archivo' : 'Publicación'} técnico generado automáticamente por el CMS.`,
          '',
          `- Contenido: \`${record.path}\``,
          `- Versión: \`${version.content_sha}\``,
          '',
          'Se fusionará únicamente después de superar las validaciones obligatorias.',
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
      eventType:
        input.operation === 'archive' ? 'content_archive_requested' : 'content_publish_requested',
      actorId: input.auth.user.id,
      contentSha: version.content_sha,
      metadata: { publication_id: publication.id, pull_request: pull.number },
    });
    await recordAudit({
      requestId: input.auth.requestId,
      actorId: input.auth.user.id,
      action:
        input.operation === 'archive' ? 'content_archive_requested' : 'content_publish_requested',
      resourceType: record.collection,
      resourceId: record.id,
      result: 'success',
      metadata: { path: record.path, content_sha: version.content_sha },
    });
    return {
      state: input.operation === 'archive' ? 'archiving' : 'publishing',
      publicationState: 'pr_open',
      publicationId: publication.id,
    };
  } catch (publicationError) {
    await markFailed(publication.id, record.id, publicationError, input.operation);
    throw publicationError;
  }
}

export async function publishContent(input: {
  path: string;
  auth: PermissionContext;
  operationKey?: unknown;
}) {
  return startPublication({ ...input, operation: 'publish' });
}

export async function archiveContent(input: {
  path: string;
  auth: PermissionContext;
  operationKey?: unknown;
}) {
  return startPublication({ ...input, operation: 'archive' });
}

export async function reconcilePendingPublications(requestId = randomUUID()) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data: records, error } = await client
    .from('cms_content_records')
    .select('*, cms_content_drafts(*)')
    .in('publication_state', ACTIVE_PUBLICATION_STATES)
    .limit(100);
  if (error) throw new InternalError('No se pudieron consultar las publicaciones pendientes.');

  const results = [];
  for (const record of records || []) {
    try {
      results.push(await reconcilePublication(record, { requestId }));
    } catch (error) {
      logEvent('error', 'cms_publication.reconcile_failed', {
        requestId,
        contentId: record.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { processed: (records || []).length, results };
}
