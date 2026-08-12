import type { PermissionContext } from '../auth/require-permission.ts';
import { ValidationError, InternalError } from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';
import { publicationBranch, publishContent, reconcilePublication } from './publication-service.ts';

export const WORKFLOW_TRANSITIONS = {
  publish: { suffix: 'publish' },
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
  if (transition !== 'publish') throw new ValidationError('Transición editorial inválida.');
  const base = collectionPermissionBase(path.split('/')[2]);
  if (!base) throw new ValidationError('Esta colección no admite publicación.');
  return {
    transition: 'publish' as const,
    permission: base === 'taxonomy' ? 'taxonomy.manage' : `${base}.publish`,
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
  return reconcilePublication(data, auth);
}

export async function transitionWorkflow(input: {
  path: string;
  transition: WorkflowTransition;
  comment?: unknown;
  operationKey?: unknown;
  auth: PermissionContext;
}) {
  return publishContent({
    path: input.path,
    auth: input.auth,
    operationKey: input.operationKey,
  });
}

export { publicationBranch };
