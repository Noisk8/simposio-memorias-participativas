import type { PermissionContext } from '../auth/require-permission.ts';
import { recordAudit } from '../observability/audit.ts';
import {
  AppError,
  AuthorizationError,
  ConflictError,
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

export async function getWorkflowState(path: string) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_workflow_events(*)')
    .eq('path', path)
    .maybeSingle();
  if (error) throw new InternalError('No se pudo consultar el estado editorial.');
  return data;
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
  const { data: updated, error: updateError } = await client
    .from('cms_content_records')
    .update({
      workflow_state: transition.to,
      updated_by: input.auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('workflow_state', record.workflow_state)
    .select('id')
    .maybeSingle();
  if (updateError || !updated) {
    throw new ConflictError('El estado cambió mientras realizabas la operación.');
  }
  const { error: eventError } = await client.from('cms_workflow_events').insert({
    content_id: record.id,
    from_state: record.workflow_state,
    to_state: transition.to,
    comment,
    actor_id: input.auth.user.id,
  });
  if (eventError) throw new InternalError('No se pudo registrar el evento editorial.');
  await recordAudit({
    requestId: input.auth.requestId,
    actorId: input.auth.user.id,
    action: `workflow.${input.transition}`,
    resourceType: collection,
    resourceId: record.id,
    result: 'success',
    metadata: { path: input.path, from: record.workflow_state, to: transition.to },
  });
  return { state: transition.to };
}
