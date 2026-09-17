import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { contentVersionSha } from './version.ts';
import { ConfigurationError, StorageError } from '../observability/errors.ts';

type Env = Record<string, string | undefined>;
type Document = { data: Record<string, any>; body: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024;
export const documentChecksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function contentUsesGarage(env: Env = process.env) {
  const value = env.CMS_CONTENT_STORAGE_PROVIDER || 'supabase';
  if (!['garage', 'supabase'].includes(value))
    throw new ConfigurationError('Proveedor editorial inválido.');
  return value === 'garage';
}

export function contentS3Client(env: Env = process.env) {
  const endpoint = new URL(env.S3_ENDPOINT || 'https://invalid');
  if (
    !env.S3_ENDPOINT ||
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !env.S3_REGION ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    env.S3_FORCE_PATH_STYLE !== 'true' ||
    !env.S3_CONTENT_BUCKET ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_CONTENT_BUCKET) ||
    env.S3_CONTENT_BUCKET === (env.S3_BUCKET || 'cms-media')
  ) {
    throw new ConfigurationError('Configura S3_CONTENT_BUCKET privado y las credenciales S3.');
  }
  return new S3Client({
    endpoint: endpoint.href,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
}

export function isGarageDocument(data: any): boolean {
  return Boolean(data && Object.prototype.hasOwnProperty.call(data, '_garage'));
}

export function createContentStore(env: Env = process.env, sender?: Pick<S3Client, 'send'>) {
  const client = sender || contentS3Client(env);
  const bucket = env.S3_CONTENT_BUCKET;
  function pointer(id: string, sha: string) {
    if (!UUID.test(id) || !HASH.test(sha)) throw new StorageError('Referencia editorial inválida.');
    return { _garage: { version: 1, key: `content/${id}/${sha}.json`, sha256: sha } };
  }
  async function readBytes(key: string) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (!response.Body || (response.ContentLength || 0) > MAX_BYTES)
      throw new StorageError('Objeto editorial inválido.');
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    if (bytes.length > MAX_BYTES) throw new StorageError('Objeto editorial demasiado grande.');
    return bytes;
  }
  return {
    async put(id: string, document: Document, expectedSha: string) {
      if (
        document.data.id !== id ||
        contentVersionSha(document.data, document.body) !== expectedSha
      ) {
        throw new StorageError('La integridad del contenido no coincide con la versión.');
      }
      const bytes = Buffer.from(
        JSON.stringify({ version: 1, data: document.data, body: document.body })
      );
      if (bytes.length > MAX_BYTES) throw new StorageError('Documento editorial demasiado grande.');
      const sha = documentChecksum(bytes);
      const ref = pointer(id, sha);
      const key = ref._garage.key;
      try {
        let exists = false;
        try {
          const current = await readBytes(key);
          if (documentChecksum(current) !== sha)
            throw new StorageError('Colisión de contenido en Garage.');
          exists = true;
        } catch (error: any) {
          if (error?.$metadata?.httpStatusCode !== 404) throw error;
        }
        if (!exists) {
          // La key contiene el hash de TODOS los bytes, incluidas las propiedades operativas.
          // Escrituras simultáneas a esta key siempre tienen exactamente los mismos bytes.
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: bytes,
              ContentType: 'application/json',
              CacheControl: 'private, no-store',
            }),
            { abortSignal: AbortSignal.timeout(20_000) }
          );
          if (documentChecksum(await readBytes(key)) !== sha)
            throw new StorageError('Falló la verificación después de subir.');
        }
        return { data: ref, body: '' };
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw new StorageError('No se pudo guardar y verificar el contenido en Garage.');
      }
    },
    async read(row: any): Promise<any> {
      if (!row || !isGarageDocument(row.data)) return row;
      const ref = row.data._garage;
      const id = row.content_id;
      const expected = pointer(id, ref?.sha256);
      if (ref?.version !== 1 || ref.key !== expected._garage.key || row.body !== '') {
        throw new StorageError('Referencia de contenido no válida.');
      }
      try {
        const bytes = await readBytes(ref.key);
        if (documentChecksum(bytes) !== ref.sha256) throw new Error('checksum');
        const document = JSON.parse(bytes.toString('utf8'));
        if (
          document.version !== 1 ||
          document.data?.id !== id ||
          typeof document.body !== 'string' ||
          contentVersionSha(document.data, document.body) !== row.content_sha
        )
          throw new Error('document');
        return { ...row, data: document.data, body: document.body };
      } catch {
        throw new StorageError('No se pudo leer o verificar el contenido en Garage.');
      }
    },
  };
}

export async function storedContent(
  id: string,
  data: Record<string, any>,
  body: string,
  sha: string
) {
  if (!contentUsesGarage()) return { data, body };
  return createContentStore().put(id, { data, body }, sha);
}

export async function hydratedContent(row: any) {
  if (!row || !isGarageDocument(row.data)) return row;
  return createContentStore().read(row);
}
