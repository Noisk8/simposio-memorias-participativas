import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getContent, saveContent, validateContentDocument } from '../shared/cms/content-service.ts';
import { contentVersionSha } from '../shared/content/version.ts';

// Se ejercitan el servicio real, el cliente Supabase y el adaptador S3; solo se simula la red.
test('guardar, recargar y editar usa Garage; un fallo S3 o una revisión obsoleta no confirma el borrador', async (t) => {
  const id = '16e1dc00-d404-429f-a48c-5016d53d6305';
  const actor = '8150fb7f-f678-4a59-aca4-d0be96aedf4d';
  const env = {
    SUPABASE_URL: 'https://db.example.org',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CMS_CONTENT_STORAGE_PROVIDER: 'garage',
    S3_ENDPOINT: 'https://s3.example.org',
    S3_REGION: 'garage',
    S3_ACCESS_KEY_ID: 'test-key',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    S3_FORCE_PATH_STYLE: 'true',
    S3_BUCKET: 'cms-media',
    S3_CONTENT_BUCKET: 'cms-content',
  };
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  let offline = false;
  const objects = new Map();
  const events = [];
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    if (offline) throw new Error('offline');
    const key = command.input.Key;
    if (command instanceof GetObjectCommand) {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
      return { ContentLength: bytes.length, Body: { transformToByteArray: async () => bytes } };
    }
    assert.ok(command instanceof PutObjectCommand);
    events.push('s3-put');
    objects.set(key, Buffer.from(command.input.Body));
    return {};
  });
  const originalData = validateContentDocument(
    'entradas',
    { id, title: 'Texto original', date: '2026-09-17' },
    'Original'
  );
  let draft = {
    content_id: id,
    data: originalData,
    body: 'Original',
    revision: 1,
    content_sha: contentVersionSha(originalData, 'Original'),
  };
  const record = {
    id,
    path: 'src/content/entradas/texto-original.md',
    owner_id: actor,
    workflow_state: 'draft',
    collection: 'entradas',
    published_sha: null,
  };
  let rpcCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://db.example.org');
    const response = (data) =>
      new globalThis.Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname.endsWith('/cms_content_records'))
      return response({ ...record, current_sha: draft.content_sha, cms_content_drafts: draft });
    if (url.pathname.endsWith('/rpc/cms_save_content_draft')) {
      const p = JSON.parse(init.body);
      rpcCalls++;
      events.push('rpc');
      assert.equal(p.p_body, '');
      assert.deepEqual(Object.keys(p.p_data), ['_garage']);
      assert.equal(p.p_expected_revision, draft.revision);
      assert.ok(objects.has(p.p_data._garage.key));
      draft = {
        content_id: id,
        data: p.p_data,
        body: p.p_body,
        revision: draft.revision + 1,
        content_sha: p.p_content_sha,
      };
      return response([{ revision: draft.revision }]);
    }
    if (url.pathname.endsWith('/audit_log')) return response(null);
    throw new Error('unexpected route ' + url.pathname);
  });
  const auth = {
    user: { id: actor },
    roles: ['admin'],
    permissions: ['entrada.update'],
    requestId: actor,
  };
  const payload = {
    path: record.path,
    revision: 1,
    data: { ...originalData, title: 'Texto actualizado' },
    body: 'Contenido completo actualizado',
    autosave: true,
  };
  await saveContent({ collection: 'entradas', method: 'PUT', payload, auth });
  assert.deepEqual(events, ['s3-put', 'rpc']);
  const result = await getContent({ collection: 'entradas', filePath: record.path, auth });
  assert.equal(result.item.body, payload.body);
  assert.equal(result.item.data.title, payload.data.title);
  assert.equal(result.item.revision, 2);
  await assert.rejects(
    saveContent({ collection: 'entradas', method: 'PUT', payload, auth }),
    /versión/
  );
  assert.equal(rpcCalls, 1);
  offline = true;
  await assert.rejects(
    saveContent({
      collection: 'entradas',
      method: 'PUT',
      payload: { ...payload, revision: 2 },
      auth,
    })
  );
  assert.equal(rpcCalls, 1);
});
