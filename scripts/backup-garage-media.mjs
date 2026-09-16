import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const root = process.env.BACKUP_OUTPUT_DIR;
const bucket = process.env.S3_BUCKET;
if (!root || bucket !== 'cms-media')
  throw new Error('Configura BACKUP_OUTPUT_DIR y S3_BUCKET=cms-media.');
const endpoint = new URL(process.env.S3_ENDPOINT || '');
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
  throw new Error('Se requiere HTTPS válido.');
for (const name of ['S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`Falta ${name}.`);
}
const client = new S3Client({
  endpoint: endpoint.toString(),
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  maxAttempts: 2,
});
const objects = [];
let token;
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
  );
  for (const object of page.Contents || []) {
    const key = object.Key;
    if (
      !key ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.split('/').some((s) => !s || s === '..' || s === '.')
    )
      throw new Error('Ruta de objeto no segura.');
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(120_000),
    });
    if (!result.Body) throw new Error('Objeto sin contenido.');
    const destination = path.join(root, 'garage', bucket, key);
    await mkdir(path.dirname(destination), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    const verify = new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk);
        size += chunk.length;
        done(null, chunk);
      },
    });
    await pipeline(result.Body, verify, createWriteStream(destination, { mode: 0o600 }));
    if (size !== result.ContentLength) throw new Error('Descarga incompleta.');
    objects.push({
      key,
      size,
      sha256: hash.digest('hex'),
      contentType: result.ContentType,
      cacheControl: result.CacheControl,
      metadata: result.Metadata,
    });
  }
  token = page.NextContinuationToken;
} while (token);
await mkdir(root, { recursive: true });
await writeFile(
  path.join(root, 'garage-manifest.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      scope: 'Garage objects and S3 metadata; Supabase editorial catalog is separate',
      bucket,
      objects,
    },
    null,
    2
  ) + '\n',
  { mode: 0o600 }
);
console.log(`Respaldo de Garage: ${objects.length} objetos y sus metadatos S3.`);
