import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/202608110004_cms_media_storage.sql', 'utf8');
const validationMigration = fs.readFileSync(
  'supabase/migrations/202608110005_professional_media_validation.sql',
  'utf8'
);
const limitsMigration = fs.readFileSync(
  'supabase/migrations/202608110006_media_types_and_2mib_limit.sql',
  'utf8'
);
const uploadService = fs.readFileSync('shared/cms/media-upload-service.ts', 'utf8');
const handler = fs.readFileSync('netlify/functions/manage-media.ts', 'utf8');
const uploadHandler = fs.readFileSync('netlify/functions/upload-media.ts', 'utf8');

test('el bucket bloquea toda escritura cliente aunque exista otra política permisiva', () => {
  assert.match(migration, /'cms-media'[\s\S]*true,[\s\S]*4194304/);
  assert.match(migration, /as restrictive for insert to public/);
  assert.match(migration, /as restrictive for update to public/);
  assert.match(migration, /as restrictive for delete to public/);
  assert.match(migration, /bucket_id <> 'cms-media'/);
  assert.match(migration, /on storage\.buckets as restrictive for update to public/);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[^;]*to authenticated/i);
});

test('cms_media queda bajo RLS y las escrituras solo se conceden a service_role', () => {
  assert.match(migration, /alter table public\.cms_media enable row level security/);
  assert.match(migration, /grant select on public\.cms_media to authenticated/);
  assert.match(migration, /cms_has_permission\(\(select auth\.uid\(\)\), 'media\.read'\)/);
  assert.match(
    migration,
    /grant select, insert, update, delete on public\.cms_media to service_role/
  );
});

test('manage-media usa Storage y metadata, no GitHub Contents para binarios', () => {
  assert.match(uploadService, /\.storage[\s\S]*\.upload\(/);
  assert.match(uploadService, /\.from\('cms_media'\)/);
  assert.match(uploadService, /createHash\('sha256'\)/);
  assert.match(uploadService, /randomUUID\(\)/);
  assert.match(uploadService, /optimizeImageUpload/);
  assert.match(uploadService, /validateEditorialMetadata/);
  assert.doesNotMatch(uploadService, /githubContentsRequest/);
  assert.match(handler, /event\.httpMethod === 'PATCH'/);
  assert.match(handler, /'media\.update'/);
  assert.match(handler, /errorResponse\(error, headers, requestId\)/);
  assert.doesNotMatch(handler, /uploadMedia|sharp/);
  assert.match(uploadHandler, /uploadMedia/);
  assert.match(uploadHandler, /'media\.upload'/);
});

test('la política de imagen del bucket y PostgreSQL excluye SVG, GIF y AVIF', () => {
  assert.match(validationMigration, /'image\/jpeg', 'image\/png', 'image\/webp'/);
  assert.doesNotMatch(validationMigration, /image\/svg\+xml|image\/gif|image\/avif/);
  assert.match(validationMigration, /add column if not exists is_decorative boolean/);
  assert.match(validationMigration, /cms_media_editorial_metadata_check/);
  assert.match(validationMigration, /cms_media_image_type_check/);
});

test('la política final limita a 2 MiB y solo JPEG, PNG, WebP y PDF', () => {
  assert.match(limitsMigration, /file_size_limit = 2097152/);
  assert.match(limitsMigration, /size_bytes between 1 and 2097152/);
  assert.match(limitsMigration, /'image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'/);
  assert.doesNotMatch(limitsMigration, /audio\/|video\//);
  assert.match(limitsMigration, /media_kind in \('image', 'document'\)/);
});
