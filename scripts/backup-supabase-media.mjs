import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaStorage, checksum } from '../shared/media/storage.ts';

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

for (const row of rows) {
  const data = await mediaStorage(client, row).read(row.storage_path);
  if (!data || checksum(data) !== row.checksum_sha256)
    throw new Error(`No se pudo verificar ${row.storage_path}.`);
  const destination = path.join(outputRoot, 'storage', row.storage_bucket, row.storage_path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, 'media-manifest.json'),
  `${JSON.stringify({ createdAt: new Date().toISOString(), count: rows.length, rows }, null, 2)}\n`
);
console.log(`Respaldo de medios completado: ${rows.length} objetos.`);
