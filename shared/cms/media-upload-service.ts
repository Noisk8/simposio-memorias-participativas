import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { PermissionContext } from '../auth/require-permission.ts';
import { CMS_MEDIA_BUCKET, adminClient, mayUpdateReusedMedia, toMedia } from './media-service.ts';
import {
  getMediaValidationPolicy,
  inspectMediaBytes,
  validateEditorialMetadata,
  validateMediaFilename,
  validateOriginalFilename,
} from '../media/validation.ts';
import { optimizeImageUpload } from '../media/image-processor.ts';
import { mediaStorage, verifyStoredMedia, ensureStoredMedia } from '../media/storage.ts';
import { recordAudit } from '../observability/audit.ts';
import { InternalError, ValidationError } from '../observability/errors.ts';

type MediaMetadataInput = {
  altText: string | null;
  credit: string | null;
  author: string | null;
  license: string | null;
  decorative: boolean | null;
};

function generatedSafeFilename(safeSlug: string) {
  return `${randomUUID()}-${safeSlug}`;
}

function storagePath(directory: string, safeFilename: string) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${directory}/${year}/${month}/${safeFilename}`;
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

export async function uploadMedia(
  payload: any,
  auth: PermissionContext,
  dependencies = { adminClient, mediaStorage, recordAudit }
) {
  const { adminClient, mediaStorage, recordAudit } = dependencies;
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
      ? await optimizeImageUpload({
          name: originalFilename,
          declaredMimeType: payload.mimeType,
          bytes,
          policy,
        })
      : null;
  const detected = image || inspected;
  const storedBytes = image?.bytes || bytes;
  const storedSafeSlug = image?.safeSlug || safeSlug;
  const dimensions = image
    ? { width: image.width, height: image.height, format: image.format }
    : { width: null, height: null, format: null };
  const metadata: MediaMetadataInput = validateEditorialMetadata(payload, detected.kind);
  const checksum = createHash('sha256').update(storedBytes).digest('hex');
  const client = adminClient();
  const existing = await activeMediaByChecksum(client, checksum);
  if (existing) {
    const storage = mediaStorage(client, existing);
    if (!(await verifyStoredMedia(storage, existing.storage_path, checksum))) {
      await ensureStoredMedia(storage, existing.storage_path, storedBytes, existing.mime_type);
    }
    let enriched = existing;
    if (mayUpdateReusedMedia(auth)) {
      const { data, error: enrichError } = await client
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
      enriched = data;
    }
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: 'media.reuse',
      resourceType: 'media',
      resourceId: existing.id,
      result: 'success',
      metadata: {
        size: storedBytes.length,
        checksum,
        metadataUpdated: mayUpdateReusedMedia(auth),
      },
    });
    return { statusCode: 200, media: { ...toMedia(enriched), existing: true } };
  }

  const deleted = await deletedMediaByChecksum(client, checksum);
  if (deleted) {
    const storage = mediaStorage(client, deleted);
    if (!(await verifyStoredMedia(storage, deleted.storage_path, checksum))) {
      await ensureStoredMedia(storage, deleted.storage_path, storedBytes, deleted.mime_type);
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
      // A concurrent restore may already be using this shared path. Keep the object.
      const raced = await activeMediaByChecksum(client, checksum);
      if (raced) return { statusCode: 200, media: { ...toMedia(raced), existing: true } };
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

  const safeFilename = generatedSafeFilename(storedSafeSlug);
  const objectPath = storagePath(detected.directory, safeFilename);
  const storage = mediaStorage(client);
  const uploadedNow = await ensureStoredMedia(storage, objectPath, storedBytes, detected.mimeType);
  const publicUrl = storage.publicUrl(objectPath);
  const record = {
    storage_bucket: CMS_MEDIA_BUCKET,
    storage_path: objectPath,
    public_url: publicUrl,
    original_filename: originalFilename,
    safe_filename: safeFilename,
    media_kind: detected.kind,
    mime_type: detected.mimeType,
    size_bytes: storedBytes.length,
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
        await storage.remove(objectPath);
      }
      return { statusCode: 200, media: { ...toMedia(raced), existing: true } };
    }
    if (uploadedNow) await storage.remove(objectPath);
    throw new InternalError('El archivo se subió, pero no se pudo guardar su metadata.');
  }

  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.upload',
    resourceType: 'media',
    resourceId: inserted.id,
    result: 'success',
    metadata: {
      size: storedBytes.length,
      originalSize: bytes.length,
      checksum,
      storagePath: objectPath,
    },
  });
  return { statusCode: 201, media: toMedia(inserted) };
}
