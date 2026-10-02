import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createGarageStorage,
  createSupabaseStorage,
  checksum,
  verifyStoredMedia,
  ensureStoredMedia,
  mediaProvider,
} from '../shared/media/storage.ts';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => !['--apply', '--dry-run'].includes(arg))) {
  throw new Error(
    'Uso: node --env-file=.env --experimental-strip-types scripts/migrate-media-to-garage.mjs [--dry-run|--apply]'
  );
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Falta configurar Supabase.');
if (apply && !process.env.MEDIA_MIGRATION_REPORT)
  throw new Error('Define MEDIA_MIGRATION_REPORT para conservar el respaldo y resultado.');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const source = createSupabaseStorage(client);
const target = createGarageStorage();
const report = { startedAt: new Date().toISOString(), apply, rows: [] };
async function save() {
  if (!process.env.MEDIA_MIGRATION_REPORT) return;
  await mkdir(path.dirname(process.env.MEDIA_MIGRATION_REPORT), { recursive: true });
  await writeFile(process.env.MEDIA_MIGRATION_REPORT, JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
}
try {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from('cms_media')
      .select('*')
      .is('deleted_at', null)
      .order('id')
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  for (const row of rows) {
    const entry = {
      id: row.id,
      before: row,
      targetUrl: target.publicUrl(row.storage_path),
      status: 'pending',
    };
    report.rows.push(entry);
    await save();
    if (mediaProvider(row) === 'supabase') {
      const bytes = await source.read(row.storage_path);
      if (
        !bytes ||
        bytes.length !== Number(row.size_bytes) ||
        checksum(bytes) !== row.checksum_sha256
      )
        throw new Error(`Integridad de origen inválida: ${row.id}`);
      if (!(await verifyStoredMedia(target, row.storage_path, row.checksum_sha256))) {
        if (!apply) {
          entry.status = 'needs-copy';
          console.log(row.id, entry.status);
          continue;
        }
        await ensureStoredMedia(target, row.storage_path, bytes, row.mime_type);
      }
    }
    if (!(await verifyStoredMedia(target, row.storage_path, row.checksum_sha256)))
      throw new Error(`Falta el objeto: ${row.id}`);
    const response = await fetch(entry.targetUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Lectura pública fallida: ${row.id}`);
    const publicBytes = Buffer.from(await response.arrayBuffer());
    if (
      checksum(publicBytes) !== row.checksum_sha256 ||
      response.headers.get('content-type')?.split(';')[0] !== row.mime_type
    )
      throw new Error(`Verificación pública fallida: ${row.id}`);
    if (apply && row.public_url !== entry.targetUrl) {
      const { data, error } = await client
        .from('cms_media')
        .update({ public_url: entry.targetUrl })
        .eq('id', row.id)
        .eq('public_url', row.public_url)
        .eq('updated_at', row.updated_at)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error || !data) throw new Error(`El registro cambió o no se pudo actualizar: ${row.id}`);
    }
    entry.status = apply ? 'verified-and-active' : 'verified-ready';
    await save();
    console.log(row.id, entry.status);
  }
  report.completedAt = new Date().toISOString();
  await save();
  console.log(
    `${report.rows.length} medios revisados. Originales y contenido editorial conservados.`
  );
} catch (error) {
  report.error = error.message;
  await save();
  throw error;
}
