import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createContentStore,
  contentUsesGarage,
  contentS3Client,
  hydratedContent,
} from '../shared/content/garage-store.ts';
import { contentVersionSha } from '../shared/content/version.ts';

const id = '16e1dc00-d404-429f-a48c-5016d53d6305';
const document = {
  data: { id, title: 'Memoria — prueba', draft: true },
  body: 'Texto íntegro con acentos.\n',
};
const sha = contentVersionSha(document.data, document.body);
function fixture() {
  const objects = new Map();
  const calls = [];
  const store = createContentStore(
    { S3_CONTENT_BUCKET: 'cms-content' },
    {
      async send(command, options) {
        calls.push(command);
        assert.ok(options.abortSignal);
        assert.equal(command.input.Bucket, 'cms-content');
        if (command instanceof GetObjectCommand) {
          const bytes = objects.get(command.input.Key);
          if (!bytes)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return { ContentLength: bytes.length, Body: { transformToByteArray: async () => bytes } };
        }
        assert.ok(command instanceof PutObjectCommand);
        objects.set(command.input.Key, Buffer.from(command.input.Body));
        return {};
      },
    }
  );
  return { store, objects, calls };
}

test('Garage guarda datos editoriales completos; Supabase recibe solo referencia y cuerpo vacío', async () => {
  const { store, calls } = fixture();
  const stored = await store.put(id, document, sha);
  assert.equal(stored.body, '');
  assert.deepEqual(Object.keys(stored.data), ['_garage']);
  assert.ok(!JSON.stringify(stored).includes(document.data.title));
  const row = await store.read({ ...stored, content_id: id, content_sha: sha, revision: 7 });
  assert.deepEqual(row.data, document.data);
  assert.equal(row.body, document.body);
  assert.equal(row.revision, 7);
  assert.equal(
    calls.find((c) => c instanceof PutObjectCommand).input.CacheControl,
    'private, no-store'
  );
});

test('reintentos son idempotentes y cambios operativos no sobreescriben versiones antiguas', async () => {
  const { store, calls } = fixture();
  const first = await store.put(id, document, sha);
  assert.deepEqual(await store.put(id, document, sha), first);
  assert.equal(calls.filter((c) => c instanceof PutObjectCommand).length, 1);
  const published = await store.put(
    id,
    { ...document, data: { ...document.data, draft: false } },
    sha
  );
  assert.notEqual(published.data._garage.key, first.data._garage.key);
  assert.equal((await store.read({ ...first, content_id: id, content_sha: sha })).data.draft, true);
});

test('rechaza checksum editorial inválido antes de escribir', async () => {
  const { store, calls } = fixture();
  await assert.rejects(store.put(id, document, '0'.repeat(64)));
  assert.equal(calls.length, 0);
});

test('no acepta paths manipulados ni referencias de otro documento', async () => {
  const { store } = fixture();
  const stored = await store.put(id, document, sha);
  const bad = JSON.parse(JSON.stringify(stored));
  bad.data._garage.key = 'content/../../secret.json';
  await assert.rejects(store.read({ ...bad, content_id: id, content_sha: sha }));
  await assert.rejects(
    store.read({ ...stored, content_id: '8150fb7f-f678-4a59-aca4-d0be96aedf4d', content_sha: sha })
  );
});

test('detecta corrupción de Garage y no devuelve contenido vacío ni fallback', async () => {
  const { store, objects } = fixture();
  const stored = await store.put(id, document, sha);
  objects.set(stored.data._garage.key, Buffer.from('{}'));
  await assert.rejects(store.read({ ...stored, content_id: id, content_sha: sha }));
  await assert.rejects(store.put(id, document, sha));
});

test('un 403 no se confunde con ausencia ni dispara una escritura', async () => {
  let puts = 0;
  const store = createContentStore(
    {},
    {
      async send(c) {
        if (c instanceof PutObjectCommand) puts++;
        throw Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } });
      },
    }
  );
  await assert.rejects(store.put(id, document, sha));
  assert.equal(puts, 0);
});

test('el modo transición conserva filas legacy y falla con proveedores desconocidos', async () => {
  assert.deepEqual(await hydratedContent(document), document);
  assert.equal(contentUsesGarage({}), false);
  assert.equal(contentUsesGarage({ CMS_CONTENT_STORAGE_PROVIDER: 'garage' }), true);
  assert.throws(() => contentUsesGarage({ CMS_CONTENT_STORAGE_PROVIDER: 'unknown' }));
});

test('el bucket público y endpoints inseguros no son destinos editoriales válidos', () => {
  const env = {
    S3_ENDPOINT: 'https://s3.example.org',
    S3_REGION: 'garage',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_FORCE_PATH_STYLE: 'true',
    S3_BUCKET: 'cms-media',
    S3_CONTENT_BUCKET: 'cms-media',
  };
  assert.throws(() => contentS3Client(env));
  assert.throws(() =>
    contentS3Client({
      ...env,
      S3_CONTENT_BUCKET: 'cms-content',
      S3_ENDPOINT: 'http://s3.example.org',
    })
  );
});
