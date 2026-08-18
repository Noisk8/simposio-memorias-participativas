import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../netlify/functions/scheduled-publish.ts';

test('la activación programada falla cerrada si no existe un build hook válido', async () => {
  const previous = process.env.SCHEDULED_BUILD_HOOK_URL;
  delete process.env.SCHEDULED_BUILD_HOOK_URL;
  try {
    const result = await handler();
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).ok, false);
  } finally {
    if (previous === undefined) delete process.env.SCHEDULED_BUILD_HOOK_URL;
    else process.env.SCHEDULED_BUILD_HOOK_URL = previous;
  }
});

test('la activación programada solicita un build de Netlify', async () => {
  const previousUrl = process.env.SCHEDULED_BUILD_HOOK_URL;
  const previousFetch = globalThis.fetch;
  process.env.SCHEDULED_BUILD_HOOK_URL =
    'https://api.netlify.com/build_hooks/0123456789abcdef01234567';
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'deploy-scheduled' }),
    };
  };
  try {
    const result = await handler();
    assert.equal(result.statusCode, 202);
    assert.equal(JSON.parse(result.body).deployId, 'deploy-scheduled');
    assert.equal(request.url, process.env.SCHEDULED_BUILD_HOOK_URL);
    assert.equal(request.options.method, 'POST');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SCHEDULED_BUILD_HOOK_URL;
    else process.env.SCHEDULED_BUILD_HOOK_URL = previousUrl;
  }
});
