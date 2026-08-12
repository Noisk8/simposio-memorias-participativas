import { Buffer } from 'node:buffer';
import type { PermissionContext } from '../auth/require-permission.ts';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../content/frontmatter.ts';
import { approvalIsCurrent, contentVersionSha } from '../content/version.ts';
import {
  createBranch,
  createPullRequest,
  findOpenPullRequest,
  getBranchHeadSha,
  getPullRequest,
  readContent,
  updateContent,
} from '../github/client.ts';
import { recordAudit } from '../observability/audit.ts';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  GitHubError,
  InternalError,
  ValidationError,
} from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export const WORKFLOW_TRANSITIONS = {
  submit_review: { from: ['draft', 'changes_requested'], to: 'in_review', suffix: 'submit_review' },
  request_changes: { from: ['in_review'], to: 'changes_requested', suffix: 'approve' },
  approve: { from: ['in_review'], to: 'approved', suffix: 'approve' },
  publish: { from: ['approved'], to: 'published', suffix: 'publish' },
  archive: { from: ['published'], to: 'archived', suffix: 'archive' },
} as const;

export type WorkflowTransition = keyof typeof WORKFLOW_TRANSITIONS;

function collectionPermissionBase(collection: string) {
  return collection === 'entradas'
    ? 'entrada'
    : collection === 'memorias'
      ? 'memoria'
      : collection === 'paginas'
        ? 'pagina'
        : collection === 'simposios'
          ? 'simposio'
          : null;
}

export function validateWorkflowPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^src\/content\/(entradas|memorias|paginas|simposios)\/[a-z0-9][a-z0-9._-]*\.md$/i.test(value)
  ) {
    throw new ValidationError('Ruta editorial inválida.');
  }
  return value;
}

export function workflowPermission(path: string, transition: unknown) {
  if (typeof transition !== 'string' || !(transition in WORKFLOW_TRANSITIONS)) {
    throw new ValidationError('Transición editorial inválida.');
  }
  const collection = path.split('/')[2];
  const base = collectionPermissionBase(collection);
  if (!base) throw new ValidationError('Esta colección no usa flujo editorial.');
  return {
    transition: transition as WorkflowTransition,
    permission: `${base}.${WORKFLOW_TRANSITIONS[transition as WorkflowTransition].suffix}`,
  };
}

export function publicationBranch(contentId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  return `cms/${contentId}/${stamp}`;
}

async function readCurrentVersion(path: string) {
  const response = await readContent(path);
  if (response.status === 404) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
  if (!response.ok)
    throw new GitHubError('No se pudo verificar la versión actual.', { status: response.status });
  const file: any = await response.json();
  const source = Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString(
    'utf8'
  );
  const document = parseMarkdownDocument(source);
  return {
    file,
    data: document.data,
    body: document.body,
    currentSha: contentVersionSha(document.data, document.body),
  };
}

async function recordWorkflowEvent(input: {
  contentId: string;
  from: string;
  to: string;
  eventType: string;
  contentSha?: string | null;
  comment?: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { error } = await client.from('cms_workflow_events').insert({
    content_id: input.contentId,
    from_state: input.from,
    to_state: input.to,
    event_type: input.eventType,
    content_sha: input.contentSha || null,
    comment: input.comment || '',
    actor_id: input.actorId || null,
    metadata: input.metadata || {},
  });
  if (error) throw new InternalError('No se pudo registrar el evento editorial.');
}

async function reconcilePullRequest(record: any, auth: PermissionContext) {
  if (
    !record.github_pr_number ||
    !['creating_pr', 'pr_open', 'stale'].includes(record.deployment_state)
  ) {
    return record;
  }
  const response = await getPullRequest(Number(record.github_pr_number));
  if (!response.ok) {
    if (response.status === 404) return record;
    throw new GitHubError('No se pudo consultar el Pull Request editorial.', {
      status: response.status,
    });
  }
  const pull: any = await response.json();
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');

  if (pull.merged_at) {
    if (!approvalIsCurrent(record)) {
      const { data } = await client
        .from('cms_content_records')
        .update({
          deployment_state: 'stale',
          merge_sha: pull.merge_commit_sha,
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id)
        .select('*')
        .single();
      return data || record;
    }
    const timestamp = new Date().toISOString();
    const { data: published, error } = await client
      .from('cms_content_records')
      .update({
        workflow_state: 'published',
        published_sha: record.approved_sha,
        published_by: record.publication_requested_by,
        published_at: pull.merged_at,
        merge_sha: pull.merge_commit_sha,
        deployment_state: 'merged',
        updated_at: timestamp,
      })
      .eq('id', record.id)
      .eq('workflow_state', 'approved')
      .eq('current_sha', record.approved_sha)
      .select('*')
      .maybeSingle();
    if (error) throw new InternalError('No se pudo confirmar la publicación fusionada.');
    if (published) {
      await recordWorkflowEvent({
        contentId: record.id,
        from: 'approved',
        to: 'published',
        eventType: 'content_published',
        contentSha: record.approved_sha,
        actorId: record.publication_requested_by,
        metadata: { pull_request: record.github_pr_number, merge_sha: pull.merge_commit_sha },
      });
      await recordAudit({
        requestId: auth.requestId,
        actorId: record.publication_requested_by,
        action: 'content_published',
        resourceType: record.collection,
        resourceId: record.id,
        result: 'success',
        metadata: {
          path: record.path,
          published_sha: record.approved_sha,
          publisher: record.publication_requested_by,
          timestamp: pull.merged_at,
          pull_request: record.github_pr_number,
          merge_sha: pull.merge_commit_sha,
        },
      });
      return published;
    }
  }
  if (pull.state === 'closed') {
    const { data } = await client
      .from('cms_content_records')
      .update({ deployment_state: 'closed', updated_at: new Date().toISOString() })
      .eq('id', record.id)
      .select('*')
      .single();
    return data || record;
  }
  return record;
}

export async function getWorkflowState(path: string, auth?: PermissionContext) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_workflow_events(*)')
    .eq('path', path)
    .maybeSingle();
  if (error) throw new InternalError('No se pudo consultar el estado editorial.');
  if (!data || !auth) return data;
  const reconciled = await reconcilePullRequest(data, auth);
  if (reconciled === data) return data;
  const { data: refreshed, error: refreshError } = await client
    .from('cms_content_records')
    .select('*, cms_workflow_events(*)')
    .eq('path', path)
    .single();
  if (refreshError) throw new InternalError('No se pudo actualizar el estado editorial.');
  return refreshed;
}

async function publishApproved(record: any, comment: string, auth: PermissionContext) {
  if (!approvalIsCurrent(record)) {
    throw new ConflictError('La versión actual no coincide con la versión aprobada.', {
      current_sha: record.current_sha,
      approved_sha: record.approved_sha,
    });
  }
  if (record.github_pr_number && record.deployment_state === 'pr_open') {
    return {
      state: 'approved',
      deploymentState: 'pr_open',
      pullRequestNumber: record.github_pr_number,
      pullRequestUrl: record.github_pr_url,
      idempotent: true,
    };
  }

  const current = await readCurrentVersion(record.path);
  if (
    current.currentSha !== record.approved_sha ||
    current.file.sha !== record.approved_github_sha ||
    current.file.sha !== record.github_sha
  ) {
    throw new ConflictError('GitHub ya no contiene exactamente la versión aprobada.', {
      current_sha: current.currentSha,
      approved_sha: record.approved_sha,
    });
  }

  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const branch =
    ['creating_pr', 'failed'].includes(record.deployment_state) && record.github_branch
      ? record.github_branch
      : publicationBranch(record.id);
  const timestamp = new Date().toISOString();
  const { data: reserved, error: reserveError } = await client
    .from('cms_content_records')
    .update({
      github_branch: branch,
      github_pr_number: null,
      github_pr_url: null,
      merge_sha: null,
      deployment_state: 'creating_pr',
      publication_requested_by: auth.user.id,
      publication_requested_at: timestamp,
      updated_by: auth.user.id,
      updated_at: timestamp,
    })
    .eq('id', record.id)
    .eq('workflow_state', 'approved')
    .eq('current_sha', record.approved_sha)
    .in('deployment_state', ['none', 'closed', 'failed'])
    .select('*')
    .maybeSingle();
  if (reserveError || !reserved) {
    throw new ConflictError('El contenido cambió mientras se preparaba la publicación.');
  }

  try {
    const baseSha = await getBranchHeadSha();
    const branchResponse = await createBranch(branch, baseSha);
    if (!branchResponse.ok) {
      throw new GitHubError('No se pudo crear la rama editorial.', {
        status: branchResponse.status,
      });
    }
    const publicationData = {
      ...current.data,
      draft: false,
      workflow_state: 'published',
    };
    const publicationContent = serializeMarkdownDocument(publicationData, current.body);
    const branchFileResponse = await readContent(record.path, branch);
    if (!branchFileResponse.ok) {
      throw new GitHubError('No se pudo verificar el archivo en la rama editorial.', {
        status: branchFileResponse.status,
      });
    }
    const branchFile: any = await branchFileResponse.json();
    const branchSource = Buffer.from(
      String(branchFile.content || '').replace(/\n/g, ''),
      'base64'
    ).toString('utf8');
    if (branchSource !== publicationContent) {
      const writeResponse = await updateContent({
        path: record.path,
        content: publicationContent,
        message: `Publicar versión aprobada ${record.approved_sha.slice(0, 12)}`,
        sha: branchFile.sha,
        branch,
      });
      if (!writeResponse.ok) {
        throw new GitHubError('No se pudo escribir la versión aprobada en la rama editorial.', {
          status: writeResponse.status,
        });
      }
    }
    let pull: any = await findOpenPullRequest(branch);
    if (!pull) {
      const prResponse = await createPullRequest({
        head: branch,
        title: `CMS: publicar ${String(current.data.title || record.path)}`,
        body: [
          'Publicación editorial generada por el CMS.',
          '',
          `- Contenido: \`${record.path}\``,
          `- Versión aprobada: \`${record.approved_sha}\``,
          `- Solicitante: \`${auth.user.id}\``,
          '',
          'Requiere checks de CI y fusión manual según la protección de la rama.',
        ].join('\n'),
      });
      if (!prResponse.ok) {
        throw new GitHubError('No se pudo abrir el Pull Request editorial.', {
          status: prResponse.status,
        });
      }
      pull = await prResponse.json();
    }
    const { data: saved, error: saveError } = await client
      .from('cms_content_records')
      .update({
        github_pr_number: pull.number,
        github_pr_url: pull.html_url,
        deployment_state: 'pr_open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
      .eq('github_branch', branch)
      .select('*')
      .single();
    if (saveError) throw new InternalError('El PR se creó, pero no pudo registrarse en Supabase.');
    await recordWorkflowEvent({
      contentId: record.id,
      from: 'approved',
      to: 'approved',
      eventType: 'content_publish_requested',
      contentSha: record.approved_sha,
      comment,
      actorId: auth.user.id,
      metadata: { branch, pull_request: pull.number, pull_request_url: pull.html_url },
    });
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: 'content_publish_requested',
      resourceType: record.collection,
      resourceId: record.id,
      result: 'success',
      metadata: {
        path: record.path,
        approved_sha: record.approved_sha,
        publisher: auth.user.id,
        timestamp,
        branch,
        pull_request: pull.number,
      },
    });
    return {
      state: saved.workflow_state,
      deploymentState: saved.deployment_state,
      pullRequestNumber: pull.number,
      pullRequestUrl: pull.html_url,
    };
  } catch (error) {
    await client
      .from('cms_content_records')
      .update({ deployment_state: 'failed', updated_at: new Date().toISOString() })
      .eq('id', record.id)
      .eq('github_branch', branch);
    throw error;
  }
}

export async function transitionWorkflow(input: {
  path: string;
  transition: WorkflowTransition;
  comment?: unknown;
  auth: PermissionContext;
}) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const transition = WORKFLOW_TRANSITIONS[input.transition];
  const collection = input.path.split('/')[2];
  const { data: record, error: readError } = await client
    .from('cms_content_records')
    .select('*')
    .eq('path', input.path)
    .maybeSingle();
  if (readError || !record) {
    throw new AppError('NOT_FOUND', 'No existe registro editorial para este contenido.', 404);
  }
  if (!transition.from.includes(record.workflow_state as never)) {
    throw new ConflictError(`No se puede pasar de ${record.workflow_state} a ${transition.to}.`);
  }
  if (
    input.transition === 'submit_review' &&
    record.owner_id !== input.auth.user.id &&
    !input.auth.roles.some((role: string) => ['superadmin', 'admin', 'editor'].includes(role))
  ) {
    throw new AuthorizationError('Solo la persona autora puede enviar este contenido a revisión.');
  }
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 2000) : '';

  if (input.transition === 'publish') return publishApproved(record, comment, input.auth);

  const current = await readCurrentVersion(input.path);
  const timestamp = new Date().toISOString();
  const approvalValues =
    input.transition === 'approve'
      ? {
          current_sha: current.currentSha,
          github_sha: current.file.sha,
          approved_sha: current.currentSha,
          approved_github_sha: current.file.sha,
          approved_by: input.auth.user.id,
          approved_at: timestamp,
          deployment_state: 'none',
          github_branch: null,
          github_pr_number: null,
          github_pr_url: null,
          merge_sha: null,
        }
      : { current_sha: current.currentSha, github_sha: current.file.sha };
  const { data: updated, error: updateError } = await client
    .from('cms_content_records')
    .update({
      workflow_state: transition.to,
      updated_by: input.auth.user.id,
      updated_at: timestamp,
      ...approvalValues,
    })
    .eq('id', record.id)
    .eq('workflow_state', record.workflow_state)
    .select('id')
    .maybeSingle();
  if (updateError || !updated) {
    throw new ConflictError('El estado cambió mientras realizabas la operación.');
  }
  const eventType =
    input.transition === 'approve' ? 'content_approved' : `workflow_${input.transition}`;
  await recordWorkflowEvent({
    contentId: record.id,
    from: record.workflow_state,
    to: transition.to,
    eventType,
    contentSha: current.currentSha,
    comment,
    actorId: input.auth.user.id,
  });
  await recordAudit({
    requestId: input.auth.requestId,
    actorId: input.auth.user.id,
    action: input.transition === 'approve' ? 'content_approved' : `workflow.${input.transition}`,
    resourceType: collection,
    resourceId: record.id,
    result: 'success',
    metadata: {
      path: input.path,
      from: record.workflow_state,
      to: transition.to,
      ...(input.transition === 'approve'
        ? {
            approved_sha: current.currentSha,
            reviewer: input.auth.user.id,
            timestamp,
          }
        : {}),
    },
  });
  return {
    state: transition.to,
    currentSha: current.currentSha,
    ...(input.transition === 'approve' ? { approvedSha: current.currentSha } : {}),
  };
}
