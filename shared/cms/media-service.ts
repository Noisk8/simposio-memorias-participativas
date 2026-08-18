import type { PermissionContext } from '../auth/require-permission.ts';
import { getGitHubConfiguration } from '../github/config.ts';
import { githubSearchCode } from '../github/contents-client.ts';
import { getMediaValidationPolicy, validateEditorialMetadata } from '../media/validation.ts';
import { recordAudit } from '../observability/audit.ts';
import {
  ConflictError,
  GitHubError,
  InternalError,
  StorageError,
  ValidationError,
} from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export const CMS_MEDIA_BUCKET = 'cms-media';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mayUpdateReusedMedia(auth: Pick<PermissionContext, 'permissions'>): boolean {
  return auth.permissions.includes('media.update');
}

export function adminClient() {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado en este entorno.');
  return client;
}

export function toMedia(row: any) {
  return {
    id: row.id,
    name: row.original_filename,
    safeFilename: row.safe_filename,
    path: row.public_url,
    publicUrl: row.public_url,
    previewUrl: row.public_url,
    downloadUrl: row.public_url,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    kind: row.media_kind,
    size: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    checksum: row.checksum_sha256,
    altText: row.alt_text,
    credit: row.credit,
    author: row.author,
    license: row.license,
    decorative: row.is_decorative,
    format: row.image_format,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMedia() {
  const client = adminClient();
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new InternalError('No se pudo consultar la biblioteca de medios.');
  return (data || []).map(toMedia);
}

export function mediaUploadPolicy() {
  const policy = getMediaValidationPolicy();
  return {
    maxBytes: policy.maxBytes,
    maxWidth: policy.maxWidth,
    maxHeight: policy.maxHeight,
    maxPixels: policy.maxPixels,
    allowedImageMimeTypes: policy.allowedImageMimeTypes,
    requiredImageMetadata: ['altText_or_decorative', 'credit', 'license'],
  };
}

async function referencesForMedia(row: any) {
  const config = getGitHubConfiguration();
  const candidates = [row.public_url, `/images/${row.original_filename}`];
  const found = new Set<string>();
  for (const reference of candidates) {
    const response = await githubSearchCode(
      `\"${reference}\" repo:${config.owner}/${config.repo} path:src/content`
    );
    if (!response.ok) {
      throw new GitHubError('No se pudo comprobar el uso del medio.', { status: response.status });
    }
    const result: any = await response.json();
    for (const item of result.items || []) found.add(item.path);
  }
  const draftIds = new Set<string>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data: drafts, error } = await adminClient()
      .from('cms_content_drafts')
      .select('content_id, data, body')
      .range(offset, offset + pageSize - 1);
    if (error)
      throw new InternalError('No se pudieron comprobar los borradores que usan el medio.');
    for (const draft of drafts || []) {
      const serialized = `${JSON.stringify(draft.data || {})}\n${String(draft.body || '')}`;
      if (candidates.some((reference) => reference && serialized.includes(reference))) {
        draftIds.add(draft.content_id);
      }
    }
    if ((drafts || []).length < pageSize) break;
  }

  const ids = [...draftIds];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data: records, error } = await adminClient()
      .from('cms_content_records')
      .select('id, path')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw new InternalError('No se pudieron resolver las referencias de borradores.');
    for (const record of records || []) found.add(`draft:${record.path}`);
  }
  return [...found].sort();
}

function validateMediaId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError('Identificador de medio inválido.');
  }
  return value;
}

export async function updateMediaMetadata(payload: any, auth: PermissionContext) {
  const id = validateMediaId(payload?.id);
  const editableKeys = ['altText', 'credit', 'author', 'license', 'decorative'];
  if (!editableKeys.some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key))) {
    throw new ValidationError('No se recibió metadata para actualizar.');
  }
  const client = adminClient();
  const { data: current, error: readError } = await client
    .from('cms_media')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError) throw new InternalError('No se pudo consultar el medio.');
  if (!current) throw new ValidationError('El medio no existe o fue eliminado.');

  const metadata = validateEditorialMetadata(
    {
      altText: Object.prototype.hasOwnProperty.call(payload, 'altText')
        ? payload.altText
        : current.alt_text,
      credit: Object.prototype.hasOwnProperty.call(payload, 'credit')
        ? payload.credit
        : current.credit,
      author: Object.prototype.hasOwnProperty.call(payload, 'author')
        ? payload.author
        : current.author,
      license: Object.prototype.hasOwnProperty.call(payload, 'license')
        ? payload.license
        : current.license,
      decorative: Object.prototype.hasOwnProperty.call(payload, 'decorative')
        ? payload.decorative
        : current.is_decorative,
    },
    current.media_kind
  );
  const { data, error } = await client
    .from('cms_media')
    .update({
      alt_text: metadata.altText,
      credit: metadata.credit,
      author: metadata.author,
      license: metadata.license,
      is_decorative: metadata.decorative,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new InternalError('No se pudo actualizar la metadata del medio.');
  if (!data) throw new ConflictError('El medio cambió. Actualiza la biblioteca.');
  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.update',
    resourceType: 'media',
    resourceId: id,
    result: 'success',
    metadata: {},
  });
  return toMedia(data);
}

export async function deleteMedia(input: { id: unknown }, auth: PermissionContext) {
  const id = validateMediaId(input.id);
  const client = adminClient();
  const { data: row, error: readError } = await client
    .from('cms_media')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError) throw new InternalError('No se pudo consultar el medio.');
  if (!row) throw new ValidationError('El medio no existe o ya fue eliminado.');

  const references = await referencesForMedia(row);
  if (references.length) {
    throw new ConflictError('El medio está siendo utilizado y no se puede eliminar.', {
      references,
    });
  }

  const deletedAt = new Date().toISOString();
  const { data: marked, error: markError } = await client
    .from('cms_media')
    .update({ deleted_at: deletedAt })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (markError || !marked) throw new ConflictError('El medio cambió. Actualiza la biblioteca.');

  const { error: removeError } = await client.storage
    .from(row.storage_bucket)
    .remove([row.storage_path]);
  if (removeError) {
    await client.from('cms_media').update({ deleted_at: null }).eq('id', id);
    throw new StorageError('No se pudo eliminar el objeto de Storage.', {
      reason: removeError.message,
    });
  }

  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.delete',
    resourceType: 'media',
    resourceId: id,
    result: 'success',
    metadata: { storagePath: row.storage_path },
  });
}
