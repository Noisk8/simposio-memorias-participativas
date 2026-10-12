import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createGarageStorage, createSupabaseStorage } from '../shared/media/storage.ts';
import { backupMediaProvider } from './lib/backup-media-provider.mjs';
import { verifyBackupMedia } from './lib/backup-media-integrity.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outputRoot = process.env.BACKUP_OUTPUT_DIR;
if (!url || !key || !outputRoot) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y BACKUP_OUTPUT_DIR son obligatorios.');
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rows = [];
const pageSize = 500;
for (let offset = 0; ; offset += pageSize) {
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .is('deleted_at', null)
    .order('id')
    .range(offset, offset + pageSize - 1);
  if (error) throw new Error(`No se pudo listar cms_media: ${error.message}`);
  rows.push(...(data || []));
  if ((data || []).length < pageSize) break;
}

const allowedMissingIds = new Set(
  (process.env.BACKUP_ALLOWED_MISSING_MEDIA_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);
const missing = [];
for (const row of rows) {
  const storage =
    backupMediaProvider(row) === 'garage' ? createGarageStorage() : createSupabaseStorage(client);
  const data = await storage.read(row.storage_path);
  if (verifyBackupMedia(row, data, allowedMissingIds).missing) {
    missing.push({ ...row, reason: 'not_found', provider: backupMediaProvider(row) });
    continue;
  }
  const destination = path.join(outputRoot, 'storage', row.storage_bucket, row.storage_path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

await mkdir(outputRoot, { recursive: true });
const createdAt = new Date().toISOString();
const complete = missing.length === 0;
await writeFile(
  path.join(outputRoot, 'media-manifest.json'),
  `${JSON.stringify({ createdAt, count: rows.length, exportedCount: rows.length - missing.length, complete, missing, rows }, null, 2)}\n`,
  { mode: 0o600 }
);
await writeFile(
  path.join(outputRoot, 'missing-media.json'),
  `${JSON.stringify({ createdAt, complete, count: missing.length, missing }, null, 2)}\n`,
  { mode: 0o600 }
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `media_complete=${complete}\nmissing_media_count=${missing.length}\n`
  );
if (!complete)
  console.warn(
    `::warning::Respaldo con ${missing.length} archivos ausentes autorizados; consultar missing-media.json. Esos archivos no podrán restaurarse.`
  );
console.log(
  `Respaldo de medios: ${rows.length - missing.length} objetos verificados; ${missing.length} ausentes.`
);
