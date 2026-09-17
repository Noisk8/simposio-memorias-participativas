import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, GetBucketWebsiteCommand } from '@aws-sdk/client-s3';
import { contentS3Client, documentChecksum } from '../shared/content/garage-store.ts';

// Captura el commit indicado (debe ser el SHA de producción comprobado), no el árbol modificado.
const ref = process.env.CONTENT_SNAPSHOT_COMMIT;
if (!ref || !/^[a-f0-9]{40}$/.test(ref))
  throw new Error('Define CONTENT_SNAPSHOT_COMMIT con el SHA de producción.');
if (!process.env.CONTENT_SNAPSHOT_REPORT) throw new Error('Define CONTENT_SNAPSHOT_REPORT.');
const client = contentS3Client();
const bucket = process.env.S3_CONTENT_BUCKET;
try {
  await client.send(new GetBucketWebsiteCommand({ Bucket: bucket }), {
    abortSignal: AbortSignal.timeout(20_000),
  });
  throw new Error('El bucket editorial no debe tener website.');
} catch (error) {
  if (error.name !== 'NoSuchWebsiteConfiguration') throw error;
}

const prefix = `site-snapshots/${ref}`;
const files = execFileSync(
  'git',
  ['ls-tree', '-r', '--name-only', ref, '--', 'src/content', 'public'],
  { encoding: 'utf8' }
)
  .trim()
  .split('\n')
  .filter(Boolean);
const report = { commit: ref, bucket, createdAt: new Date().toISOString(), objects: [] };
async function putVerified(key, bytes, contentType) {
  let existing;
  try {
    existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
  }
  if (existing) {
    if (
      documentChecksum(Buffer.from(await existing.Body.transformToByteArray())) !==
      documentChecksum(bytes)
    )
      throw new Error(`Contenido distinto en ${key}`);
  } else {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: 'private, no-store',
      }),
      { abortSignal: AbortSignal.timeout(20_000) }
    );
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (
      documentChecksum(Buffer.from(await result.Body.transformToByteArray())) !==
      documentChecksum(bytes)
    )
      throw new Error(`Integridad fallida: ${key}`);
  }
}
for (const file of files) {
  const bytes = execFileSync('git', ['show', `${ref}:${file}`], { maxBuffer: 50 * 1024 * 1024 });
  const key = `${prefix}/${file}`;
  await putVerified(
    key,
    bytes,
    file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/octet-stream'
  );
  report.objects.push({ path: file, key, size: bytes.length, sha256: documentChecksum(bytes) });
  if (report.objects.length % 20 === 0)
    console.log(`${report.objects.length}/${files.length} archivos verificados.`);
}
await putVerified(
  `${prefix}/manifest.json`,
  Buffer.from(JSON.stringify(report) + '\n'),
  'application/json'
);
await mkdir(path.dirname(process.env.CONTENT_SNAPSHOT_REPORT), { recursive: true });
await writeFile(process.env.CONTENT_SNAPSHOT_REPORT, JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600,
});
console.log(`Snapshot ${ref}: ${files.length} archivos copiados y verificados.`);
