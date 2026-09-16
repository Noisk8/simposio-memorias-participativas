import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const file = process.argv[2];
const bucket = process.env.S3_BACKUP_BUCKET;
if (!file?.endsWith('.tar.gz.enc') || !bucket || bucket === process.env.S3_BUCKET) {
  throw new Error(
    'Indica un respaldo .tar.gz.enc y un S3_BACKUP_BUCKET privado distinto al bucket de medios.'
  );
}
const endpoint = new URL(process.env.S3_ENDPOINT || '');
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
  throw new Error('El respaldo requiere un endpoint S3 HTTPS válido.');
}
for (const name of ['S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'GITHUB_RUN_ID']) {
  if (!process.env[name]) throw new Error(`Falta ${name}.`);
}
const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt))
  throw new Error('Identificador de ejecución inválido.');
const size = (await stat(file)).size;
if (!size || size > 5 * 1024 ** 3) throw new Error('El respaldo debe pesar entre 1 byte y 5 GiB.');
async function digest(stream) {
  const hash = createHash('sha256');
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest('hex');
}
const sha256 = await digest(createReadStream(file));
const date = new Date().toISOString().slice(0, 10);
const key = `backups/${date}/production-${runId}-${attempt}-${sha256}.tar.gz.enc`;
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
await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(file),
    ContentLength: size,
    ContentType: 'application/octet-stream',
    Metadata: { sha256 },
  }),
  { abortSignal: AbortSignal.timeout(5 * 60_000) }
);
const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
  abortSignal: AbortSignal.timeout(5 * 60_000),
});
if (stored.ContentLength !== size || !stored.Body || (await digest(stored.Body)) !== sha256) {
  throw new Error('La copia del respaldo en Garage no supera la verificación de integridad.');
}
console.log(`Respaldo cifrado verificado en Garage: ${bucket}/${key} (${size} bytes).`);
