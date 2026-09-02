import type { PermissionContext } from '../auth/require-permission.ts';
import { ValidationError, InternalError } from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';
import {
  archiveContent,
  publicationBranch,
  publishContent,
  reconcilePublication,
} from './publication-service.ts';
import { taxonomyReferenceAvailable } from './content-service.ts';
import { getOperationResponse, normalizeOperationKey, saveOperationResponse } from './operation-keys.ts';

export const WORKFLOW_TRANSITIONS = {
  publish: { suffix: 'publish' },
  archive: { suffix: 'archive' },
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
          : ['categorias', 'etiquetas'].includes(collection)
            ? 'taxonomy'
            : null;
}

export function validateWorkflowPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^src\/content\/(entradas|memorias|paginas|simposios|categorias|etiquetas)\/[a-z0-9][a-z0-9._-]*\.md$/i.test(
      value
    )
  ) {
    throw new ValidationError('Ruta editorial inválida.');
  }
  return value;
}

export function workflowPermission(path: string, transition: unknown) {
  if (!['publish', 'archive'].includes(String(transition))) {
    throw new ValidationError('Transición editorial inválida.');
  }
  const base = collectionPermissionBase(path.split('/')[2]);
  if (!base) throw new ValidationError('Esta colección no admite publicación.');
  const normalized = transition as WorkflowTransition;
  return {
    transition: normalized,
    permission: base === 'taxonomy' ? 'taxonomy.manage' : `${base}.${normalized}`,
  };
}

export async function getWorkflowState(path: string, auth?: PermissionContext) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_workflow_events(*), cms_publications(*)')
    .eq('path', path)
    .maybeSingle();
  if (error) throw new InternalError('No se pudo consultar el estado editorial.');
  if (!data || !auth) return data;
  const record = await reconcilePublication(data, auth);
  if (['categorias', 'etiquetas'].includes(String(record?.collection))) {
    record.reference_available = await taxonomyReferenceAvailable(record.path);
  }
  return record;
}

export async function transitionWorkflow(input: {
  path: string;
  transition: WorkflowTransition;
  comment?: unknown;
  operationKey?: unknown;
  auth: PermissionContext;
}) {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado.');
  const operationKey = normalizeOperationKey(input.operationKey);
  if (operationKey) {
    const cached = await getOperationResponse(client, operationKey, input.auth.user.id);
    if (cached) return { ...cached, idempotent: true };
  }
  const operation = input.transition === 'archive' ? archiveContent : publishContent;
  const result = await operation({
    path: input.path,
    auth: input.auth,
    operationKey: operationKey || undefined,
  });
  if (operationKey) {
    await saveOperationResponse(
      client,
      operationKey,
      input.auth.user.id,
      input.transition,
      input.path,
      result
    );
  }
  return result;
}

export { publicationBranch };
