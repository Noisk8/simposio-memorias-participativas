import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  createGarageStorage,
  mediaProvider,
  mediaReferenceUrls,
  uploadProvider,
  ensureStoredMedia,
  verifyStoredMedia,
  checksum,
} from '../shared/media/storage.ts';
import { ConflictError, StorageError } from '../shared/observability/errors.ts';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  S3_ENDPOINT: 'https://s3.example.org',
  S3_PUBLIC_BASE_URL: 'https://media.example.org',
  S3_BUCKET: 'cms-media',
  S3_REGION: 'garage',
  S3_ACCESS_KEY_ID: 'test-access',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_FORCE_PATH_STYLE: 'true',
};
const path = 'images/2026/09/example.webp';
const bytes = Buffer.from('image-data');
const row = {
  storage_bucket: 'cms-media',
  storage_path: path,
  public_url: `https://media.example.org/${path}`,
};

test('el proveedor se resuelve por la ubicación persistida y conserva ambas referencias', () => {
  assert.equal(mediaProvider(row, env), 'garage');
  const refs = mediaReferenceUrls(row, env);
  assert.deepEqual(refs, [
    row.public_url,
    `https://project.supabase.co/storage/v1/object/public/cms-media/${path}`,
  ]);
  assert.equal(mediaProvider({ ...row, public_url: refs[1] }, env), 'supabase');
  assert.equal(uploadProvider({}), 'supabase');
  assert.equal(uploadProvider({ CMS_MEDIA_STORAGE_PROVIDER: 'garage' }), 'garage');
  assert.throws(() => uploadProvider({ CMS_MEDIA_STORAGE_PROVIDER: 'unknown' }));
  assert.throws(() => mediaProvider({ ...row, public_url: 'https://evil.example/file' }, env));
  assert.throws(() => mediaProvider({ ...row, storage_bucket: 'other' }, env));
});

test('Garage exige HTTPS, configuración completa y rutas del servidor', async () => {
  assert.throws(() => createGarageStorage({ ...env, S3_ENDPOINT: 'http://s3.example.org' }));
  assert.throws(() => createGarageStorage({ ...env, S3_SECRET_ACCESS_KEY: '' }));
  assert.throws(() =>
    createGarageStorage({ ...env, S3_PUBLIC_BASE_URL: 'https://user:pass@media.example.org' })
  );
  const storage = createGarageStorage(env, {
    send() {
      assert.fail('No debe consultar S3');
    },
  });
  await assert.rejects(storage.read('images/../../secret'));
  assert.throws(() => storage.publicUrl('documents/2026/13/file.pdf'));
});

test('subida S3 condicional conserva MIME, caché y bytes; lectura y borrado usan la misma key', async () => {
  const calls = [];
  const storage = createGarageStorage(env, {
    async send(command, options) {
      calls.push(command);
      assert.ok(options.abortSignal);
      if (command instanceof GetObjectCommand)
        return { Body: { transformToByteArray: async () => bytes } };
      return {};
    },
  });
  await storage.put(path, bytes, 'image/webp');
  assert.ok(calls[0] instanceof PutObjectCommand);
  assert.equal(calls[0].input.IfNoneMatch, '*');
  assert.equal(calls[0].input.ContentType, 'image/webp');
  assert.equal(calls[0].input.CacheControl, 'public, max-age=31536000, immutable');
  assert.deepEqual(calls[0].input.Body, bytes);
  assert.deepEqual(await storage.read(path), bytes);
  await storage.remove(path);
  assert.ok(calls[2] instanceof DeleteObjectCommand);
  assert.ok(calls.every((c) => c.input.Bucket === 'cms-media' && c.input.Key === path));
});

test('solo 404 significa ausente; timeout y acceso denegado no desencadenan reparación', async () => {
  for (const code of [404, 403, 500]) {
    const storage = createGarageStorage(env, {
      async send() {
        throw { $metadata: { httpStatusCode: code } };
      },
    });
    if (code === 404) assert.equal(await storage.read(path), null);
    else await assert.rejects(verifyStoredMedia(storage, path, checksum(bytes)), StorageError);
  }
});

test('deduplicación concurrente comprueba SHA-256 y nunca sobrescribe un objeto distinto', async () => {
  const storage = createGarageStorage(env, {
    async send(command) {
      if (command instanceof PutObjectCommand) throw { $metadata: { httpStatusCode: 412 } };
      return { Body: { transformToByteArray: async () => bytes } };
    },
  });
  assert.equal(await ensureStoredMedia(storage, path, bytes, 'image/webp'), false);
  await assert.rejects(
    ensureStoredMedia(storage, path, Buffer.from('different'), 'image/webp'),
    ConflictError
  );
});

test('reconoce solo aliases legacy configurados en servidor y conserva las referencias antiguas', () => {
  const configured = { ...env, S3_LEGACY_PUBLIC_BASE_URLS: 'https://old-media.example.org' };
  const row = {
    storage_bucket: 'cms-media',
    storage_path: path,
    public_url: `https://old-media.example.org/${path}`,
  };
  assert.equal(mediaProvider(row, configured), 'garage');
  assert.throws(() => mediaProvider(row, env));
});
