import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  GetBucketWebsiteCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import {
  createContentStore,
  contentS3Client,
  documentChecksum,
  isGarageDocument,
} from '../shared/content/garage-store.ts';

const args = process.argv.slice(2);
if (args.some((arg) => !['--dry-run', '--copy', '--apply'].includes(arg)) || args.length > 1)
  throw new Error('Uso: --dry-run | --copy | --apply');
const apply = args.includes('--apply');
const copy = apply || args.includes('--copy');
if (apply && process.env.CMS_GARAGE_DEPLOY_VERIFIED !== 'true')
  throw new Error(
    'Primero despliega y verifica el backend compatible; luego define CMS_GARAGE_DEPLOY_VERIFIED=true.'
  );
if (copy && !process.env.CONTENT_MIGRATION_REPORT)
  throw new Error('Define CONTENT_MIGRATION_REPORT.');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const store = createContentStore();
const s3 = contentS3Client();
const bucket = process.env.S3_CONTENT_BUCKET;
const report = {
  startedAt: new Date().toISOString(),
  mode: apply ? 'apply' : copy ? 'copy' : 'dry-run',
  bucket,
  rows: [],
};
async function saveReport() {
  if (!process.env.CONTENT_MIGRATION_REPORT) return;
  await mkdir(path.dirname(process.env.CONTENT_MIGRATION_REPORT), { recursive: true });
  await writeFile(process.env.CONTENT_MIGRATION_REPORT, JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
}
try {
  // Nunca colocar borradores en un bucket con website habilitado.
  try {
    await s3.send(new GetBucketWebsiteCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    throw new Error('El bucket editorial tiene website habilitado. Desactívalo antes de migrar.');
  } catch (error) {
    if (error.name !== 'NoSuchWebsiteConfiguration') throw error;
  }
  if (copy) {
    const key = `connectivity-tests/${randomUUID()}.txt`;
    const bytes = Buffer.from('Private editorial storage connectivity test');
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }), {
        abortSignal: AbortSignal.timeout(20_000),
      });
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(20_000),
      });
      if (
        documentChecksum(Buffer.from(await result.Body.transformToByteArray())) !==
        documentChecksum(bytes)
      )
        throw new Error('Integridad de prueba fallida.');
      const api = `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${bucket}/${key}`;
      const response = await fetch(api, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (![401, 403, 404].includes(response.status))
        throw new Error('No se confirmó acceso anónimo bloqueado.');
    } finally {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(20_000),
      });
    }
  }
  for (const table of ['cms_content_versions', 'cms_content_drafts']) {
    const primary = table === 'cms_content_drafts' ? 'content_id' : 'id';
    for (let offset = 0; ; offset += 200) {
      const { data: rows, error } = await db
        .from(table)
        .select('*')
        .order(primary)
        .range(offset, offset + 199);
      if (error) throw new Error(`No se pudo consultar ${table}: ${error.code}`);
      for (const row of rows) {
        const entry = { table, id: row[primary], contentSha: row.content_sha, status: 'pending' };
        report.rows.push(entry);
        if (isGarageDocument(row.data)) {
          await store.read(row);
          entry.status = 'verified-existing';
        } else if (copy) {
          const stored = await store.put(
            row.content_id,
            { data: row.data, body: row.body },
            row.content_sha
          );
          entry.reference = stored.data;
          entry.status = 'copied-and-verified';
          await saveReport();
          if (apply) {
            let query = db
              .from(table)
              .update(stored)
              .eq(primary, row[primary])
              .eq('content_sha', row.content_sha);
            if (table === 'cms_content_drafts')
              query = query.eq('revision', row.revision).eq('updated_at', row.updated_at);
            const result = await query.select(primary).maybeSingle();
            if (result.error || !result.data)
              throw new Error(
                `Cambio concurrente o fallo al activar ${table}/${row[primary]}; repetir migración.`
              );
            entry.status = 'active-in-garage';
          }
        } else entry.status = 'needs-copy';
        await saveReport();
      }
      if (rows.length < 200) break;
    }
  }
  report.completedAt = new Date().toISOString();
  await saveReport();
  console.log(
    JSON.stringify({
      mode: report.mode,
      count: report.rows.length,
      statuses: report.rows.reduce((r, x) => ({ ...r, [x.status]: (r[x.status] || 0) + 1 }), {}),
    })
  );
} catch (error) {
  report.error = error.message;
  await saveReport();
  throw error;
}
