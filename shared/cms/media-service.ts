import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { PermissionContext } from '../auth/require-permission.ts';
import { getGitHubConfiguration } from '../github/config.ts';
import { githubSearchCode } from '../github/contents-client.ts';
import {
  getMediaValidationPolicy,
  inspectMediaBytes,
  validateEditorialMetadata,
  validateImageUpload,
  validateMediaFilename,
  validateOriginalFilename,
} from '../media/validation.ts';
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

type MediaMetadataInput = {
  altText: string | null;
  credit: string | null;
  author: string | null;
  license: string | null;
  decorative: boolean | null;
};

function adminClient() {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado en este entorno.');
  return client;
}

function toMedia(row: any) {
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

function generatedSafeFilename(safeSlug: string) {
  return `${randomUUID()}-${safeSlug}`;
}

function storagePath(directory: string, safeFilename: string) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${directory}/${year}/${month}/${safeFilename}`;
}

function isDuplicateStorageError(error: any) {
  return (
    Number(error?.statusCode || error?.status) === 409 ||
    /duplicate|already exists|resource already exists/i.test(String(error?.message || ''))
  );
}

async function assertStoredChecksum(client: any, path: string, checksum: string) {
  const { data, error } = await client.storage.from(CMS_MEDIA_BUCKET).download(path);
  if (error || !data) return false;
  const stored = Buffer.from(await data.arrayBuffer());
  return createHash('sha256').update(stored).digest('hex') === checksum;
}

async function activeMediaByChecksum(client: any, checksum: string) {
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .eq('storage_bucket', CMS_MEDIA_BUCKET)
    .eq('checksum_sha256', checksum)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new InternalError('No se pudo consultar la metadata de medios.');
  return data;
}

async function deletedMediaByChecksum(client: any, checksum: string) {
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .eq('storage_bucket', CMS_MEDIA_BUCKET)
    .eq('checksum_sha256', checksum)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new InternalError('No se pudo consultar la metadata de medios eliminados.');
  return data;
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

export async function uploadMedia(payload: any, auth: PermissionContext) {
  const policy = getMediaValidationPolicy();
  const originalFilename = validateOriginalFilename(payload?.name);
  const safeSlug = validateMediaFilename(originalFilename);
  if (
    typeof payload?.content !== 'string' ||
    payload.content.length % 4 !== 0 ||
    payload.content.length > Math.ceil((policy.maxBytes * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content)
  ) {
    throw new ValidationError('Contenido de archivo inválido.');
  }
  const bytes = Buffer.from(payload.content, 'base64');
  if (!bytes.length || bytes.length > policy.maxBytes) {
    throw new ValidationError(`El archivo debe pesar entre 1 byte y ${policy.maxBytes} bytes.`);
  }

  const inspected = inspectMediaBytes(safeSlug, bytes);
  if (
    typeof payload?.mimeType !== 'string' ||
    payload.mimeType.toLowerCase() !== inspected.mimeType
  ) {
    throw new ValidationError('El MIME declarado no coincide con el tipo real del archivo.');
  }
  const image =
    inspected.kind === 'image'
      ? await validateImageUpload({
          name: originalFilename,
          declaredMimeType: payload.mimeType,
          bytes,
          policy,
        })
      : null;
  const detected = image || inspected;
  const dimensions = image
    ? { width: image.width, height: image.height, format: image.format }
    : { width: null, height: null, format: null };
  const metadata: MediaMetadataInput = validateEditorialMetadata(payload, detected.kind);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const client = adminClient();
  const existing = await activeMediaByChecksum(client, checksum);
  if (existing) {
    const storedMatches = await assertStoredChecksum(client, existing.storage_path, checksum);
    if (!storedMatches) {
      const { error: repairError } = await client.storage
        .from(existing.storage_bucket)
        .upload(existing.storage_path, bytes, {
          contentType: existing.mime_type,
          cacheControl: '31536000',
          upsert: false,
        });
      if (repairError) {
        throw new StorageError('La metadata existe, pero el objeto no se pudo verificar.', {
          reason: repairError.message,
        });
      }
    }
    const { data: enriched, error: enrichError } = await client
      .from('cms_media')
      .update({
        alt_text: metadata.altText,
        credit: metadata.credit,
        author: metadata.author,
        license: metadata.license,
        is_decorative: metadata.decorative,
        image_format: dimensions.format || existing.image_format,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (enrichError) throw new InternalError('No se pudo actualizar la metadata del duplicado.');
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: 'media.reuse',
      resourceType: 'media',
      resourceId: existing.id,
      result: 'success',
      metadata: { size: bytes.length, checksum },
    });
    return { statusCode: 200, media: { ...toMedia(enriched), existing: true } };
  }

  const deleted = await deletedMediaByChecksum(client, checksum);
  if (deleted) {
    const storedMatches = await assertStoredChecksum(client, deleted.storage_path, checksum);
    if (!storedMatches) {
      const { error: restoreObjectError } = await client.storage
        .from(deleted.storage_bucket)
        .upload(deleted.storage_path, bytes, {
          contentType: deleted.mime_type,
          cacheControl: '31536000',
          upsert: false,
        });
      if (restoreObjectError) {
        throw new StorageError('No se pudo restaurar el objeto eliminado.', {
          reason: restoreObjectError.message,
        });
      }
    }
    const { data: restored, error: restoreRecordError } = await client
      .from('cms_media')
      .update({
        deleted_at: null,
        original_filename: originalFilename,
        alt_text: metadata.altText,
        credit: metadata.credit,
        author: metadata.author,
        license: metadata.license,
        is_decorative: metadata.decorative,
        image_format: dimensions.format || deleted.image_format,
      })
      .eq('id', deleted.id)
      .not('deleted_at', 'is', null)
      .select('*')
      .single();
    if (restoreRecordError) {
      await client.storage.from(deleted.storage_bucket).remove([deleted.storage_path]);
      throw new InternalError('El objeto se restauró, pero no se pudo activar su metadata.');
    }
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: 'media.restore',
      resourceType: 'media',
      resourceId: restored.id,
      result: 'success',
      metadata: { checksum },
    });
    return { statusCode: 201, media: toMedia(restored) };
  }

  const safeFilename = generatedSafeFilename(safeSlug);
  const objectPath = storagePath(detected.directory, safeFilename);
  const { error: uploadError } = await client.storage
    .from(CMS_MEDIA_BUCKET)
    .upload(objectPath, bytes, {
      contentType: detected.mimeType,
      cacheControl: '31536000',
      upsert: false,
    });
  let uploadedNow = !uploadError;
  if (uploadError) {
    if (!isDuplicateStorageError(uploadError)) {
      throw new StorageError('No se pudo subir el archivo.', { reason: uploadError.message });
    }
    if (!(await assertStoredChecksum(client, objectPath, checksum))) {
      throw new ConflictError('La ruta de Storage ya contiene un archivo diferente.');
    }
    uploadedNow = false;
  }

  const { data: publicData } = client.storage.from(CMS_MEDIA_BUCKET).getPublicUrl(objectPath);
  const publicUrl = publicData.publicUrl;
  const record = {
    storage_bucket: CMS_MEDIA_BUCKET,
    storage_path: objectPath,
    public_url: publicUrl,
    original_filename: originalFilename,
    safe_filename: safeFilename,
    media_kind: detected.kind,
    mime_type: detected.mimeType,
    size_bytes: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
    image_format: dimensions.format,
    checksum_sha256: checksum,
    alt_text: metadata.altText,
    credit: metadata.credit,
    author: metadata.author,
    license: metadata.license,
    is_decorative: metadata.decorative,
    created_by: auth.user.id,
  };
  const { data: inserted, error: insertError } = await client
    .from('cms_media')
    .insert(record)
    .select('*')
    .single();

  if (insertError) {
    const raced = await activeMediaByChecksum(client, checksum);
    if (raced) {
      if (uploadedNow && raced.storage_path !== objectPath) {
        await client.storage.from(CMS_MEDIA_BUCKET).remove([objectPath]);
      }
      return { statusCode: 200, media: { ...toMedia(raced), existing: true } };
    }
    if (uploadedNow) await client.storage.from(CMS_MEDIA_BUCKET).remove([objectPath]);
    throw new InternalError('El archivo se subió, pero no se pudo guardar su metadata.');
  }

  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.upload',
    resourceType: 'media',
    resourceId: inserted.id,
    result: 'success',
    metadata: { size: bytes.length, checksum, storagePath: objectPath },
  });
  return { statusCode: 201, media: toMedia(inserted) };
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
