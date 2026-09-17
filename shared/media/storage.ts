import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigurationError, ConflictError, StorageError } from '../observability/errors.ts';

export const CMS_MEDIA_BUCKET = 'cms-media';
type Env = Record<string, string | undefined>;
export type StoredMedia = { storage_bucket: string; storage_path: string; public_url: string };
export type MediaStorage = {
  publicUrl(_path: string): string;
  read(_path: string): Promise<Buffer | null>;
  put(_path: string, _bytes: Buffer, _mimeType: string): Promise<void>;
  remove(_path: string): Promise<void>;
};

function encodedPath(path: string) {
  if (!/^(images|documents)\/[0-9]{4}\/(0[1-9]|1[0-2])\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(path)) {
    throw new ConfigurationError('La ubicación del medio no es válida.');
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

function httpsBase(value: string | undefined, name: string) {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new ConfigurationError(`${name} debe ser una URL HTTPS válida.`);
  }
}

export function garagePublicUrl(path: string, env: Env = process.env) {
  return `${httpsBase(env.S3_PUBLIC_BASE_URL, 'S3_PUBLIC_BASE_URL')}/${encodedPath(path)}`;
}

// Orígenes anteriores configurados exclusivamente en servidor durante un cambio de dominio.
export function garageReferenceUrls(path: string, env: Env = process.env) {
  const bases = [env.S3_PUBLIC_BASE_URL, ...(env.S3_LEGACY_PUBLIC_BASE_URLS || '').split(',')]
    .map((value) => value?.trim())
    .filter(Boolean);
  return bases.map((base) => `${httpsBase(base, 'S3_PUBLIC_BASE_URL')}/${encodedPath(path)}`);
}

export function supabasePublicUrl(path: string, env: Env = process.env) {
  return `${httpsBase(env.SUPABASE_URL, 'SUPABASE_URL')}/storage/v1/object/public/${CMS_MEDIA_BUCKET}/${encodedPath(path)}`;
}

// The location comes only from the server-owned database, never from a browser payload.
// Keeping public_url as the discriminator allows a rolling deploy without a schema migration.
export function mediaProvider(row: StoredMedia, env: Env = process.env): 'garage' | 'supabase' {
  if (row.storage_bucket !== CMS_MEDIA_BUCKET)
    throw new ConfigurationError('Bucket de medios desconocido.');
  if (row.public_url === supabasePublicUrl(row.storage_path, env)) return 'supabase';
  if (env.S3_PUBLIC_BASE_URL && garageReferenceUrls(row.storage_path, env).includes(row.public_url))
    return 'garage';
  throw new ConfigurationError('El medio no pertenece a un almacenamiento configurado.');
}

export function mediaReferenceUrls(row: StoredMedia, env: Env = process.env) {
  mediaProvider(row, env);
  return [
    ...new Set([
      row.public_url,
      supabasePublicUrl(row.storage_path, env),
      ...(env.S3_PUBLIC_BASE_URL ? garageReferenceUrls(row.storage_path, env) : []),
    ]),
  ];
}

export function uploadProvider(env: Env = process.env): 'garage' | 'supabase' {
  const provider = env.CMS_MEDIA_STORAGE_PROVIDER || 'supabase';
  if (provider !== 'garage' && provider !== 'supabase')
    throw new ConfigurationError('Proveedor de medios desconocido.');
  return provider;
}

function status(error: any) {
  return Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
}

export function createGarageStorage(
  env: Env = process.env,
  sender?: Pick<S3Client, 'send'>
): MediaStorage {
  const endpoint = httpsBase(env.S3_ENDPOINT, 'S3_ENDPOINT');
  httpsBase(env.S3_PUBLIC_BASE_URL, 'S3_PUBLIC_BASE_URL');
  if (
    env.S3_BUCKET !== CMS_MEDIA_BUCKET ||
    !env.S3_REGION ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    env.S3_FORCE_PATH_STYLE !== 'true'
  ) {
    throw new ConfigurationError('La configuración S3 de Garage está incompleta.');
  }
  const client =
    sender ||
    new S3Client({
      endpoint,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      maxAttempts: 2,
    });
  return {
    publicUrl: (path) => garagePublicUrl(path, env),
    async read(path) {
      encodedPath(path);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: CMS_MEDIA_BUCKET, Key: path }),
          { abortSignal: AbortSignal.timeout(20_000) }
        );
        if (!result.Body) throw new Error('Empty response');
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        if (status(error) === 404) return null;
        throw new StorageError('No se pudo leer el archivo en Garage.');
      }
    },
    async put(path, bytes, mimeType) {
      encodedPath(path);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: CMS_MEDIA_BUCKET,
            Key: path,
            Body: bytes,
            ContentType: mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
            IfNoneMatch: '*',
          }),
          { abortSignal: AbortSignal.timeout(20_000) }
        );
      } catch (error) {
        if ([409, 412].includes(status(error)))
          throw new ConflictError('La ruta de almacenamiento ya existe.');
        throw new StorageError('No se pudo subir el archivo a Garage.');
      }
    },
    async remove(path) {
      encodedPath(path);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: CMS_MEDIA_BUCKET, Key: path }), {
          abortSignal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new StorageError('No se pudo eliminar el archivo de Garage.');
      }
    },
  };
}

export function createSupabaseStorage(client: any, env: Env = process.env): MediaStorage {
  return {
    publicUrl: (path) => supabasePublicUrl(path, env),
    async read(path) {
      encodedPath(path);
      const { data, error } = await client.storage.from(CMS_MEDIA_BUCKET).download(path);
      if (error) {
        if (
          status(error) === 404 ||
          error.code === 'not_found' ||
          error.message === 'Object not found'
        )
          return null;
        throw new StorageError('No se pudo leer el archivo en Supabase Storage.');
      }
      if (!data) throw new StorageError('No se recibió el archivo de Supabase Storage.');
      return Buffer.from(await data.arrayBuffer());
    },
    async put(path, bytes, mimeType) {
      encodedPath(path);
      const { error } = await client.storage.from(CMS_MEDIA_BUCKET).upload(path, bytes, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) {
        if (status(error) === 409 || /duplicate|already exists/i.test(error.message || ''))
          throw new ConflictError('La ruta de almacenamiento ya existe.');
        throw new StorageError('No se pudo subir el archivo a Supabase Storage.');
      }
    },
    async remove(path) {
      encodedPath(path);
      const { error } = await client.storage.from(CMS_MEDIA_BUCKET).remove([path]);
      if (error) throw new StorageError('No se pudo eliminar el archivo de Supabase Storage.');
    },
  };
}

export function mediaStorage(client: any, row?: StoredMedia, env: Env = process.env) {
  const provider = row ? mediaProvider(row, env) : uploadProvider(env);
  return provider === 'garage' ? createGarageStorage(env) : createSupabaseStorage(client, env);
}

export function checksum(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function verifyStoredMedia(storage: MediaStorage, path: string, expected: string) {
  const bytes = await storage.read(path);
  if (!bytes) return false;
  if (checksum(bytes) !== expected)
    throw new ConflictError('La ruta de almacenamiento contiene un archivo diferente.');
  return true;
}

// Garage 2.3 may ignore If-None-Match. Check first; new paths use server UUIDs,
// and repairs/restores only target the path of the same persisted SHA-256.
export async function ensureStoredMedia(
  storage: MediaStorage,
  path: string,
  bytes: Buffer,
  mime: string
) {
  if (await verifyStoredMedia(storage, path, checksum(bytes))) return false;
  try {
    await storage.put(path, bytes, mime);
    return true;
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    if (!(await verifyStoredMedia(storage, path, checksum(bytes)))) throw error;
    return false;
  }
}
