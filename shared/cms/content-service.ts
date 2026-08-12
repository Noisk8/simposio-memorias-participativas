import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PermissionContext } from '../auth/require-permission.ts';
import {
  categoriaSchema,
  entradaSchema,
  etiquetaSchema,
  memoriaSchema,
  paginaSchema,
  simposioSchema,
} from '../content-model/index.ts';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../content/frontmatter.ts';
import { assignNewContentId, isContentId, preserveContentId } from '../content/identity.ts';
import { newContentPath, publicUrlForContent } from '../content/paths.ts';
import { normalizePublishedContent } from '../content/publication.ts';
import { getGitHubConfiguration } from '../github/config.ts';
import { githubContentsRequest } from '../github/contents-client.ts';
import { recordAudit } from '../observability/audit.ts';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  GitHubError,
  ValidationError,
} from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export const CONTENT_COLLECTIONS = {
  entradas: { permission: 'entrada', schema: entradaSchema },
  memorias: { permission: 'memoria', schema: memoriaSchema },
  paginas: { permission: 'pagina', schema: paginaSchema },
  simposios: { permission: 'simposio', schema: simposioSchema },
  categorias: { permission: 'taxonomy', schema: categoriaSchema },
  etiquetas: { permission: 'taxonomy', schema: etiquetaSchema },
} as const;

export type ContentCollection = keyof typeof CONTENT_COLLECTIONS;
export type ContentAction = 'read' | 'create' | 'update' | 'publish' | 'delete';
type WorkflowState =
  'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'archived';

const MANAGER_ROLES = new Set(['superadmin', 'admin', 'editor']);
const LIST_CACHE = new Map<ContentCollection, { expiresAt: number; items: any[] }>();
const LIST_CACHE_MS = 30_000;

export function contentCollection(value: unknown): ContentCollection {
  if (typeof value !== 'string' || !(value in CONTENT_COLLECTIONS)) {
    throw new ValidationError('La colección solicitada no es válida.');
  }
  return value as ContentCollection;
}

export function contentPermission(collection: ContentCollection, action: ContentAction) {
  const base = CONTENT_COLLECTIONS[collection].permission;
  if (base === 'taxonomy') return action === 'read' ? 'taxonomy.read' : 'taxonomy.manage';
  return `${base}.${action}`;
}

export function contentAction(method: string, payload: any = {}): ContentAction {
  if (method === 'GET') return 'read';
  if (method === 'DELETE') return 'delete';
  if (payload?.data?.draft === false) return 'publish';
  return method === 'POST' && !payload?.sha ? 'create' : 'update';
}

export function isManagedContentPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^src\/content\/(entradas|memorias|paginas|simposios|categorias|etiquetas)\/[a-z0-9][a-z0-9._-]*\.md$/i.test(
      value
    )
  );
}

function decodeFile(file: any) {
  const source = Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString(
    'utf8'
  );
  const document = parseMarkdownDocument(source);
  return {
    path: file.path,
    name: file.name,
    sha: file.sha,
    data: document.data,
    body: document.body,
  };
}

function workspaceRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'src', 'content'))) || null;
}

async function mirrorLocal(filePath: string, content: string) {
  const root = workspaceRoot();
  if (!root) return;
  try {
    const absolutePath = path.join(root, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'cms_content.local_mirror.failed',
        filePath,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function removeLocal(filePath: string) {
  const root = workspaceRoot();
  if (!root) return;
  try {
    await fs.rm(path.join(root, filePath), { force: true });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'cms_content.local_remove.failed',
        filePath,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export async function readContentFile(filePath: string) {
  const response = await githubContentsRequest(filePath);
  if (response.status === 404) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
  if (!response.ok)
    throw new GitHubError('No se pudo leer el contenido.', { status: response.status });
  const file = await response.json();
  const decoded = decodeFile(file);
  await mirrorLocal(
    file.path,
    Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString('utf8')
  );
  return decoded;
}

function validateDocument(collection: ContentCollection, data: unknown, body: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Los metadatos del contenido no son válidos.');
  }
  if (typeof body !== 'string' || body.length > 200000) {
    throw new ValidationError('El cuerpo debe ser texto y no superar 200.000 caracteres.');
  }
  try {
    return CONTENT_COLLECTIONS[collection].schema.parse(data) as Record<string, any>;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Hay campos incompletos o inválidos.', {
        fields: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    throw error;
  }
}

async function assertOwnership(auth: PermissionContext, filePath: string, creating = false) {
  if (creating) return { ownerId: auth.user.id, recordId: null };
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data, error } = await client
    .from('cms_content_records')
    .select('id, owner_id')
    .eq('path', filePath)
    .maybeSingle();
  if (error)
    throw new AppError('INTERNAL_ERROR', 'No se pudo comprobar la propiedad editorial.', 500);
  if (auth.roles.some((role: string) => MANAGER_ROLES.has(role))) {
    return { ownerId: data?.owner_id || auth.user.id, recordId: data?.id || null };
  }
  if (!data || data.owner_id !== auth.user.id) {
    throw new AuthorizationError('Solo puedes modificar contenido de tu autoría.');
  }
  return { ownerId: data.owner_id, recordId: data.id };
}

async function assertIdAvailable(contentId: string, filePath: string) {
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data, error } = await client
    .from('cms_content_records')
    .select('path')
    .eq('id', contentId)
    .maybeSingle();
  if (error)
    throw new AppError('INTERNAL_ERROR', 'No se pudo validar la identidad editorial.', 500);
  if (data && data.path !== filePath) {
    throw new ConflictError('El UUID editorial ya está asignado a otro contenido.');
  }
}

async function registerContent(input: {
  contentId: string;
  filePath: string;
  collection: ContentCollection;
  auth: PermissionContext;
  ownerId: string;
  creating: boolean;
  sha?: string;
  state: WorkflowState;
}) {
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { error } = await client.from('cms_content_records').upsert(
    {
      id: input.contentId,
      path: input.filePath,
      collection: input.collection,
      owner_id: input.ownerId,
      updated_by: input.auth.user.id,
      github_sha: input.sha || null,
      workflow_state: input.state,
      updated_at: new Date().toISOString(),
      ...(input.creating ? { created_by: input.auth.user.id } : {}),
    },
    { onConflict: 'path', ignoreDuplicates: false }
  );
  if (error) {
    throw new AppError(
      'INTERNAL_ERROR',
      'El contenido se guardó, pero no pudo registrarse su estado editorial.',
      500,
      { details: { path: input.filePath, collection: input.collection } }
    );
  }
}

async function reconcileRecord(item: any, collection: ContentCollection) {
  const contentId = item?.data?.id;
  if (!isContentId(contentId)) {
    throw new ValidationError(`El contenido ${item?.path || ''} no tiene un UUID v4 válido.`);
  }
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data: existing, error: readError } = await client
    .from('cms_content_records')
    .select('id')
    .eq('path', item.path)
    .maybeSingle();
  if (readError)
    throw new AppError('INTERNAL_ERROR', 'No se pudo reconciliar la identidad editorial.', 500);
  const values = { id: contentId, collection, path: item.path, github_sha: item.sha };
  const query = existing
    ? client.from('cms_content_records').update(values).eq('path', item.path)
    : client.from('cms_content_records').insert({
        ...values,
        workflow_state:
          item.data.workflow_state || (item.data.draft === false ? 'published' : 'draft'),
      });
  const { error } = await query;
  if (error?.code === '23505')
    throw new ConflictError('El UUID editorial está duplicado en otro contenido.');
  if (error)
    throw new AppError('INTERNAL_ERROR', 'No se pudo reconciliar la identidad editorial.', 500);
}

export async function getContent(input: { collection: ContentCollection; filePath?: unknown }) {
  if (input.filePath) {
    if (
      !isManagedContentPath(input.filePath) ||
      !input.filePath.startsWith(`src/content/${input.collection}/`)
    ) {
      throw new ValidationError('La ruta solicitada no es válida.');
    }
    const item = await readContentFile(input.filePath);
    await reconcileRecord(item, input.collection);
    return { items: null, item, cached: false };
  }
  const cached = LIST_CACHE.get(input.collection);
  if (cached && cached.expiresAt > Date.now())
    return { items: cached.items, item: null, cached: true };
  const response = await githubContentsRequest(`src/content/${input.collection}`);
  if (response.status === 404) return { items: [], item: null, cached: false };
  if (!response.ok)
    throw new GitHubError('No se pudo consultar la colección.', { status: response.status });
  const files = (await response.json()).filter(
    (item: any) => item.type === 'file' && item.name.endsWith('.md')
  );
  const items = await Promise.all(files.map((file: any) => readContentFile(file.path)));
  await Promise.all(items.map((item) => reconcileRecord(item, input.collection)));
  items.sort((a, b) =>
    String(b.data.date || b.data.year || b.data.number || '').localeCompare(
      String(a.data.date || a.data.year || a.data.number || ''),
      undefined,
      { numeric: true }
    )
  );
  LIST_CACHE.set(input.collection, { expiresAt: Date.now() + LIST_CACHE_MS, items });
  return { items, item: null, cached: false };
}

export async function saveContent(input: {
  collection: ContentCollection;
  method: string;
  payload: any;
  auth: PermissionContext;
}) {
  const { collection, payload, auth } = input;
  const creating = input.method === 'POST' && !payload.sha;
  if (!creating && (typeof payload.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(payload.sha))) {
    throw new ValidationError('La versión Git del contenido no es válida.');
  }
  const untrustedData =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : {};
  let filePath: string;
  let ownership: { ownerId: string; recordId: string | null };
  let identifiedData: Record<string, unknown>;
  if (creating) {
    identifiedData = assignNewContentId(untrustedData);
    const provisional = validateDocument(collection, identifiedData, payload.body);
    filePath = newContentPath(collection, provisional);
    ownership = await assertOwnership(auth, filePath, true);
  } else {
    filePath = payload.path;
    if (!isManagedContentPath(filePath) || !filePath.startsWith(`src/content/${collection}/`)) {
      throw new ValidationError('La ruta de guardado no es válida.');
    }
    ownership = await assertOwnership(auth, filePath);
    const existing = await readContentFile(filePath);
    if (existing.sha !== payload.sha) {
      throw new ConflictError('El contenido cambió. Actualiza la lista antes de editarlo.');
    }
    identifiedData = preserveContentId(existing.data, untrustedData, ownership.recordId);
  }
  const data = validateDocument(collection, identifiedData, payload.body);
  if (collection === 'entradas' && !data.date) data.date = new Date().toISOString().slice(0, 10);
  if (!isManagedContentPath(filePath) || !filePath.startsWith(`src/content/${collection}/`)) {
    throw new ValidationError('La ruta de guardado no es válida.');
  }
  const contentId = String(data.id);
  await assertIdAvailable(contentId, filePath);
  const requestedState: WorkflowState = payload.data?.draft === false ? 'published' : 'draft';
  data.owner_id = ownership.ownerId;
  data.workflow_state = requestedState;
  const normalizedData = normalizePublishedContent(data, requestedState);
  const content = serializeMarkdownDocument(normalizedData, payload.body);
  const response = await githubContentsRequest(filePath, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${payload.sha ? 'Actualizar' : 'Crear'} ${collection}: ${String(normalizedData.title || filePath)}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: getGitHubConfiguration().branch,
      ...(payload.sha ? { sha: payload.sha } : {}),
    }),
  });
  if (response.status === 409 || response.status === 422) {
    throw new ConflictError(
      'El contenido cambió o ya existe. Actualiza la lista antes de reintentar.'
    );
  }
  if (!response.ok)
    throw new GitHubError('No se pudo guardar el contenido.', { status: response.status });
  const result: any = await response.json();
  LIST_CACHE.delete(collection);
  await registerContent({
    contentId,
    filePath,
    collection,
    auth,
    ownerId: ownership.ownerId,
    creating,
    sha: result.content?.sha,
    state: requestedState,
  });
  await mirrorLocal(filePath, content);
  const action = contentAction(input.method, payload);
  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: `content.${action}`,
    resourceType: collection,
    resourceId: contentId,
    result: 'success',
    metadata: { path: filePath, sha: result.content?.sha },
  });
  return {
    creating,
    item: { id: contentId, path: filePath, sha: result.content?.sha },
    publicUrl: publicUrlForContent(collection, filePath, normalizedData),
  };
}

export async function deleteContent(input: {
  collection: ContentCollection;
  filePath: unknown;
  sha: unknown;
  auth: PermissionContext;
}) {
  if (
    !isManagedContentPath(input.filePath) ||
    !input.filePath.startsWith(`src/content/${input.collection}/`) ||
    typeof input.sha !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(input.sha)
  ) {
    throw new ValidationError('La ruta o versión a eliminar no es válida.');
  }
  const ownership = await assertOwnership(input.auth, input.filePath);
  const response = await githubContentsRequest(input.filePath, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Eliminar ${input.collection}: ${input.filePath}`,
      sha: input.sha,
      branch: getGitHubConfiguration().branch,
    }),
  });
  if (response.status === 409 || response.status === 422) {
    throw new ConflictError('El contenido cambió. Actualiza la lista antes de eliminarlo.');
  }
  if (!response.ok)
    throw new GitHubError('No se pudo eliminar el contenido.', { status: response.status });
  LIST_CACHE.delete(input.collection);
  await getAdminClient()?.from('cms_content_records').delete().eq('path', input.filePath);
  await removeLocal(input.filePath);
  await recordAudit({
    requestId: input.auth.requestId,
    actorId: input.auth.user.id,
    action: 'content.delete',
    resourceType: input.collection,
    resourceId: ownership.recordId,
    result: 'success',
    metadata: { path: input.filePath },
  });
}
