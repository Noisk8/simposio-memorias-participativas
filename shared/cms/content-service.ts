import { Buffer } from 'node:buffer';
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
import { parseMarkdownDocument } from '../content/frontmatter.ts';
import { cmsEditorBlockErrors } from '../content/editor-blocks.ts';
import { assignNewContentId, isContentId, preserveContentId } from '../content/identity.ts';
import { newContentPath, publicUrlForContent } from '../content/paths.ts';
import { contentVersionSha } from '../content/version.ts';
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
export type ContentAction = 'read' | 'create' | 'update' | 'delete';

const MANAGER_ROLES = new Set(['superadmin', 'admin', 'editor']);

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

export function contentAction(method: string, payload?: unknown): ContentAction {
  void payload;
  if (method === 'GET') return 'read';
  if (method === 'DELETE') return 'delete';
  return method === 'POST' ? 'create' : 'update';
}

export function isManagedContentPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^src\/content\/(entradas|memorias|paginas|simposios|categorias|etiquetas)\/[a-z0-9][a-z0-9._-]*\.md$/i.test(
      value
    )
  );
}

export function validateContentDocument(
  collection: ContentCollection,
  data: unknown,
  body: unknown
) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Los metadatos del contenido no son válidos.');
  }
  if (typeof body !== 'string' || body.length > 200000) {
    throw new ValidationError('El cuerpo debe ser texto y no superar 200.000 caracteres.');
  }
  const blockErrors = cmsEditorBlockErrors(body);
  if (blockErrors.length) {
    throw new ValidationError('Hay bloques de contenido incompletos o inválidos.', {
      fields: blockErrors.map((message) => ({ path: 'body', message })),
    });
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

function draftFromRecord(record: any) {
  const relation = record?.cms_content_drafts;
  return Array.isArray(relation) ? relation[0] || null : relation || null;
}

function itemFromRecord(record: any) {
  const draft = draftFromRecord(record);
  if (!draft) return null;
  const data = { ...draft.data, workflow_state: record.workflow_state };
  data.draft = record.workflow_state !== 'published' || record.current_sha !== record.published_sha;
  return {
    id: record.id,
    path: record.path,
    name: record.path.split('/').pop(),
    // Compatibilidad temporal con clientes que llamaban sha a la versión actual.
    sha: draft.content_sha,
    revision: Number(draft.revision),
    data,
    body: draft.body,
    currentSha: draft.content_sha,
    workflow: record,
  };
}

function decodeGitHubFile(file: any) {
  const source = Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString(
    'utf8'
  );
  const document = parseMarkdownDocument(source);
  return { file, data: document.data, body: document.body };
}

async function saveImportedFile(
  collection: ContentCollection,
  decoded: ReturnType<typeof decodeGitHubFile>,
  auth: PermissionContext,
  existing?: any
) {
  if (!isContentId(decoded.data.id)) {
    throw new ValidationError(`El contenido ${decoded.file.path} no tiene un UUID v4 válido.`);
  }
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const data = validateContentDocument(collection, decoded.data, decoded.body);
  const currentSha = contentVersionSha(data, decoded.body);
  const { data: saved, error } = await client.rpc('cms_save_content_draft', {
    p_content_id: data.id,
    p_collection: collection,
    p_path: decoded.file.path,
    p_owner_id: existing?.owner_id || auth.user.id,
    p_actor_id: auth.user.id,
    p_data: data,
    p_body: decoded.body,
    p_content_sha: currentSha,
    p_expected_revision: null,
    p_create_version: true,
    p_version_reason: 'import',
  });
  if (error) {
    throw new AppError('INTERNAL_ERROR', 'No se pudo importar el contenido publicado.', 500, {
      details: { code: error.code, path: decoded.file.path },
    });
  }
  const versionId = saved?.[0]?.version_id || null;
  const published = data.draft !== true;
  const { error: updateError } = await client
    .from('cms_content_records')
    .update({
      github_sha: decoded.file.sha,
      ...(published
        ? {
            workflow_state: 'published',
            publication_state: 'live',
            published_sha: currentSha,
            published_version_id: versionId,
          }
        : {}),
    })
    .eq('id', data.id);
  if (updateError) {
    throw new AppError('INTERNAL_ERROR', 'No se pudo completar la importación editorial.', 500);
  }
}

async function importPathFromGitHub(
  filePath: string,
  collection: ContentCollection,
  auth: PermissionContext,
  existing?: any
) {
  const response = await githubContentsRequest(filePath);
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new GitHubError('No se pudo importar el Markdown existente.', {
      status: response.status,
      path: filePath,
    });
  }
  await saveImportedFile(collection, decodeGitHubFile(await response.json()), auth, existing);
  return true;
}

async function recordsForCollection(collection: ContentCollection) {
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_content_drafts(*)')
    .eq('collection', collection)
    .order('updated_at', { ascending: false });
  if (error) {
    throw new AppError('INTERNAL_ERROR', 'No se pudieron consultar los borradores.', 500, {
      details: { code: error.code },
    });
  }
  return data || [];
}

async function ensureLegacyContentImported(
  collection: ContentCollection,
  auth: PermissionContext,
  rows: any[]
) {
  const missing = rows.filter((row) => !draftFromRecord(row));
  if (missing.length) {
    await Promise.all(missing.map((row) => importPathFromGitHub(row.path, collection, auth, row)));
    return recordsForCollection(collection);
  }
  if (rows.length) return rows;

  // Bootstrap de transición: solo una colección todavía vacía consulta GitHub.
  // Después de importarla, todas las lecturas y escrituras salen de Supabase.
  const response = await githubContentsRequest(`src/content/${collection}`);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new GitHubError('No se pudo importar la colección existente.', {
      status: response.status,
    });
  }
  const files = (await response.json()).filter(
    (item: any) => item.type === 'file' && item.name.endsWith('.md')
  );
  for (const file of files) await importPathFromGitHub(file.path, collection, auth);
  return recordsForCollection(collection);
}

export async function getContent(input: {
  collection: ContentCollection;
  filePath?: unknown;
  auth: PermissionContext;
}) {
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  if (input.filePath) {
    if (
      !isManagedContentPath(input.filePath) ||
      !input.filePath.startsWith(`src/content/${input.collection}/`)
    ) {
      throw new ValidationError('La ruta solicitada no es válida.');
    }
    let { data: record, error } = await client
      .from('cms_content_records')
      .select('*, cms_content_drafts(*)')
      .eq('path', input.filePath)
      .maybeSingle();
    if (error) throw new AppError('INTERNAL_ERROR', 'No se pudo consultar el contenido.', 500);
    if (!record || !draftFromRecord(record)) {
      const imported = await importPathFromGitHub(
        input.filePath,
        input.collection,
        input.auth,
        record
      );
      if (!imported) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
      const result = await client
        .from('cms_content_records')
        .select('*, cms_content_drafts(*)')
        .eq('path', input.filePath)
        .single();
      record = result.data;
      error = result.error;
    }
    if (error || !record)
      throw new AppError('INTERNAL_ERROR', 'No se pudo leer el contenido.', 500);
    return { items: null, item: itemFromRecord(record), cached: false };
  }

  const initial = await recordsForCollection(input.collection);
  const rows = await ensureLegacyContentImported(input.collection, input.auth, initial);
  const items = rows.map(itemFromRecord).filter(Boolean);
  items.sort((left: any, right: any) =>
    String(right.data.date || right.data.year || right.data.number || '').localeCompare(
      String(left.data.date || left.data.year || left.data.number || ''),
      undefined,
      { numeric: true }
    )
  );
  return { items, item: null, cached: false };
}

async function recordForPath(filePath: string) {
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data, error } = await client
    .from('cms_content_records')
    .select('*, cms_content_drafts(*)')
    .eq('path', filePath)
    .maybeSingle();
  if (error) throw new AppError('INTERNAL_ERROR', 'No se pudo consultar el borrador.', 500);
  return data;
}

function assertOwnership(auth: PermissionContext, record: any) {
  if (auth.roles.some((role: string) => MANAGER_ROLES.has(role))) return;
  if (!record || record.owner_id !== auth.user.id) {
    throw new AuthorizationError('Solo puedes modificar contenido de tu autoría.');
  }
}

export async function saveContent(input: {
  collection: ContentCollection;
  method: string;
  payload: any;
  auth: PermissionContext;
}) {
  const { collection, payload, auth } = input;
  const creating = !payload.path;
  const untrustedData =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : {};
  let filePath: string;
  let record: any = null;
  let draft: any = null;
  let identifiedData: Record<string, unknown>;

  if (creating) {
    identifiedData = assignNewContentId(untrustedData);
    identifiedData.draft = true;
    identifiedData.workflow_state = 'draft';
    const provisional = validateContentDocument(collection, identifiedData, payload.body);
    filePath = newContentPath(collection, provisional);
    record = await recordForPath(filePath);
    if (record) throw new ConflictError('Ya existe contenido con ese nombre. Cambia el título.');
  } else {
    filePath = payload.path;
    if (!isManagedContentPath(filePath) || !filePath.startsWith(`src/content/${collection}/`)) {
      throw new ValidationError('La ruta de guardado no es válida.');
    }
    record = await recordForPath(filePath);
    if (!record) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
    assertOwnership(auth, record);
    draft = draftFromRecord(record);
    if (!draft) throw new ConflictError('El borrador todavía no fue importado. Recarga la lista.');
    const expectedRevision = Number(payload.revision);
    const compatibleSha = typeof payload.sha === 'string' && payload.sha === draft.content_sha;
    if ((!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) && !compatibleSha) {
      throw new ConflictError('La versión del borrador no es válida. Recarga antes de guardar.');
    }
    identifiedData = preserveContentId(draft.data, untrustedData, record.id);
  }

  const ownerId = record?.owner_id || auth.user.id;
  identifiedData.owner_id = ownerId;
  identifiedData.workflow_state = 'draft';
  identifiedData.draft = true;
  let data = validateContentDocument(collection, identifiedData, payload.body);
  if (collection === 'entradas' && !data.date) data.date = new Date().toISOString().slice(0, 10);
  const currentSha = contentVersionSha(data, payload.body);
  const alreadyPublished = record?.published_sha === currentSha;
  data = {
    ...data,
    owner_id: ownerId,
    workflow_state: alreadyPublished ? 'published' : 'draft',
    draft: !alreadyPublished,
  };

  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const expectedRevision = creating ? null : Number(draft.revision);
  const autosave = payload.autosave === true;
  const { data: saved, error } = await client.rpc('cms_save_content_draft', {
    p_content_id: data.id,
    p_collection: collection,
    p_path: filePath,
    p_owner_id: ownerId,
    p_actor_id: auth.user.id,
    p_data: data,
    p_body: payload.body,
    p_content_sha: currentSha,
    p_expected_revision: expectedRevision,
    p_create_version: !autosave,
    p_version_reason: 'manual_save',
  });
  if (error?.code === '40001') {
    throw new ConflictError('Otra sesión modificó este borrador. Recarga antes de guardar.');
  }
  if (error?.code === '23505') {
    throw new ConflictError('El UUID o la ruta editorial ya pertenecen a otro contenido.');
  }
  if (error) {
    throw new AppError('INTERNAL_ERROR', 'No se pudo guardar el borrador en Supabase.', 500, {
      details: { code: error.code },
    });
  }
  const result = saved?.[0];
  if (!autosave) {
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: creating ? 'content.create_draft' : 'content.save_draft',
      resourceType: collection,
      resourceId: data.id,
      result: 'success',
      metadata: { path: filePath, content_sha: currentSha, revision: result?.revision },
    });
  }
  return {
    creating,
    autosave,
    item: {
      id: data.id,
      path: filePath,
      sha: currentSha,
      revision: Number(result?.revision || 1),
      currentSha,
    },
    publicUrl: publicUrlForContent(collection, filePath, data),
  };
}

export async function deleteContent(input: {
  collection: ContentCollection;
  filePath: unknown;
  revision: unknown;
  auth: PermissionContext;
}) {
  if (
    !isManagedContentPath(input.filePath) ||
    !input.filePath.startsWith(`src/content/${input.collection}/`)
  ) {
    throw new ValidationError('La ruta a eliminar no es válida.');
  }
  const record = await recordForPath(input.filePath);
  if (!record) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
  assertOwnership(input.auth, record);
  const draft = draftFromRecord(record);
  if (Number(input.revision) !== Number(draft?.revision)) {
    throw new ConflictError('El borrador cambió. Recarga antes de eliminarlo.');
  }
  if (record.published_version_id || record.published_sha) {
    throw new ConflictError(
      'Este contenido ya está publicado. Para retirarlo debe usarse una publicación de archivo.'
    );
  }
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { error } = await client.from('cms_content_records').delete().eq('id', record.id);
  if (error) throw new AppError('INTERNAL_ERROR', 'No se pudo eliminar el borrador.', 500);
  await recordAudit({
    requestId: input.auth.requestId,
    actorId: input.auth.user.id,
    action: 'content.delete_draft',
    resourceType: input.collection,
    resourceId: record.id,
    result: 'success',
    metadata: { path: input.filePath },
  });
}
