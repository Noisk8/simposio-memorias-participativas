import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { uploadMedia } from '../shared/cms/media-upload-service.ts';
import { deleteMedia } from '../shared/cms/media-service.ts';
import { checksum } from '../shared/media/storage.ts';
import { ConflictError, StorageError } from '../shared/observability/errors.ts';

function fixture() {
  const rows = [],
    objects = new Map(),
    events = [];
  const state = { failInsert: false, failRemove: false, references: [] };
  const storage = {
    publicUrl: (p) => `https://media.example.org/${p}`,
    read: async (p) => objects.get(p) ?? null,
    put: async (p, bytes) => {
      if (objects.has(p)) throw new ConflictError('exists');
      objects.set(p, bytes);
    },
    remove: async (p) => {
      if (state.failRemove) throw new StorageError('offline');
      objects.delete(p);
    },
  };
  const client = {
    from(table) {
      assert.equal(table, 'cms_media');
      const filters = [];
      let change, insert;
      const query = {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return this;
        },
        is(k, v) {
          filters.push((r) => (r[k] ?? null) === v);
          return this;
        },
        not(k, op, v) {
          assert.equal(op, 'is');
          filters.push((r) => (r[k] ?? null) !== v);
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        update(value) {
          change = value;
          return this;
        },
        insert(value) {
          insert = value;
          return this;
        },
        async maybeSingle() {
          return this.run();
        },
        async single() {
          return this.run();
        },
        then(resolve, reject) {
          return Promise.resolve(this.run()).then(resolve, reject);
        },
        run() {
          if (insert) {
            if (state.failInsert) return { data: null, error: new Error('database unavailable') };
            const row = { ...insert, id: randomUUID(), deleted_at: null };
            rows.push(row);
            return { data: { ...row }, error: null };
          }
          const row = rows.find((r) => filters.every((f) => f(r)));
          if (row && change) Object.assign(row, change);
          return { data: row ? { ...row } : null, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    adminClient: () => client,
    mediaStorage: () => storage,
    recordAudit: async (e) => events.push(e),
    referencesForMedia: async () => state.references,
  };
  return { rows, objects, events, state, dependencies, storage };
}
const auth = {
  user: { id: randomUUID() },
  requestId: 'test',
  permissions: ['media.upload', 'media.update', 'media.delete'],
};
async function payload() {
  return {
    name: 'Foto.png',
    mimeType: 'image/png',
    content: (
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } })
        .png()
        .toBuffer()
    ).toString('base64'),
    altText: 'Imagen de prueba',
    decorative: false,
    credit: 'Archivo',
    license: 'CC0',
  };
}

test('subir y seleccionar conserva el contrato, optimiza WebP y reutiliza duplicados', async () => {
  const f = fixture(),
    input = await payload();
  delete input.credit;
  delete input.license;
  const result = await uploadMedia(input, auth, f.dependencies);
  assert.equal(result.statusCode, 201);
  assert.equal(result.media.mimeType, 'image/webp');
  assert.equal(result.media.credit, null);
  assert.equal(result.media.license, null);
  assert.match(result.media.publicUrl, /^https:\/\/media.example.org\/images\//);
  assert.equal(result.media.previewUrl, result.media.publicUrl);
  assert.equal(result.media.path, result.media.publicUrl);
  assert.equal(checksum(f.objects.get(result.media.storagePath)), result.media.checksum);
  const reused = await uploadMedia(input, auth, f.dependencies);
  assert.equal(reused.media.id, result.media.id);
  assert.equal(reused.media.existing, true);
  assert.equal(f.objects.size, 1);
  assert.equal(f.rows.length, 1);
});

test('un error de metadata revierte solo el objeto recién creado', async () => {
  const f = fixture();
  f.state.failInsert = true;
  await assert.rejects(uploadMedia(await payload(), auth, f.dependencies), /metadata/);
  assert.equal(f.objects.size, 0);
});

test('borrado bloquea medios en uso y revierte la marca si Garage falla', async () => {
  const f = fixture();
  const { media } = await uploadMedia(await payload(), auth, f.dependencies);
  f.state.references = ['draft:src/content/entradas/example.md'];
  await assert.rejects(deleteMedia({ id: media.id }, auth, f.dependencies), ConflictError);
  assert.equal(f.rows[0].deleted_at, null);
  f.state.references = [];
  f.state.failRemove = true;
  await assert.rejects(deleteMedia({ id: media.id }, auth, f.dependencies), StorageError);
  assert.equal(f.rows[0].deleted_at, null);
  assert.equal(f.objects.size, 1);
});

test('restaurar un medio eliminado conserva UUID y URL', async () => {
  const f = fixture(),
    input = await payload();
  const first = await uploadMedia(input, auth, f.dependencies);
  await deleteMedia({ id: first.media.id }, auth, f.dependencies);
  assert.equal(f.objects.size, 0);
  const restored = await uploadMedia(input, auth, f.dependencies);
  assert.equal(restored.media.id, first.media.id);
  assert.equal(restored.media.publicUrl, first.media.publicUrl);
  assert.equal(f.rows[0].deleted_at, null);
  assert.equal(f.objects.size, 1);
});

test('PDF conserva sus bytes y metadata; MIME falso falla antes de guardar', async () => {
  const f = fixture();
  const bytes = Buffer.from('%PDF-1.7\nexample');
  const result = await uploadMedia(
    { name: 'programa.pdf', mimeType: 'application/pdf', content: bytes.toString('base64') },
    auth,
    f.dependencies
  );
  assert.equal(result.media.kind, 'document');
  assert.deepEqual(f.objects.get(result.media.storagePath), bytes);
  const input = await payload();
  input.mimeType = 'image/jpeg';
  await assert.rejects(uploadMedia(input, auth, f.dependencies), /MIME/);
  assert.equal(f.objects.size, 1);
});
