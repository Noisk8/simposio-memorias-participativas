import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8888';
const FN = `${BASE_URL}/.netlify/functions`;
const REQUEST_ID = '6f55cb59-bf47-4f19-9b82-8c492e3d18db';

let serverAvailable = false;

before(async () => {
  try {
    await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    serverAvailable = true;
  } catch {
    console.warn(
      `\n[api-contract] No hay servidor en ${BASE_URL}. ` +
        `Ejecuta "npm run test:api" para levantar netlify dev automáticamente.\n`
    );
  }
});

function api(path, options = {}) {
  return fetch(`${FN}/${path}`, { redirect: 'manual', ...options });
}

async function errorPayload(response) {
  assert.equal(
    response.headers.get('content-type')?.includes('application/json'),
    true,
    'los errores deben ser JSON'
  );
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error?.code, 'string');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(typeof body.error?.requestId, 'string');
  return body;
}

test('OPTIONS: preflight CORS responde 204 con cabeceras', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const response = await api('manage-content', { method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.ok(response.headers.get('access-control-allow-origin'));
  assert.ok(response.headers.get('access-control-allow-methods')?.includes('GET'));
  assert.ok(response.headers.get('access-control-allow-methods')?.includes('PUT'));
  assert.ok(response.headers.get('access-control-allow-methods')?.includes('PATCH'));
});

test('método no permitido: 405 con contrato de error estructurado', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const cases = [
    ['deploy-status', 'POST'],
    ['create-coleccion', 'GET'],
    ['manage-collections', 'GET'],
    ['manage-workflow', 'DELETE'],
    ['get-revision-history', 'POST'],
  ];
  for (const [path, method] of cases) {
    const response = await api(path, { method });
    assert.equal(response.status, 405, `${method} ${path}`);
    const body = await errorPayload(response);
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('sin bearer token: 401 AUTHENTICATION_REQUIRED en todas las funciones', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const cases = [
    ['manage-content?collection=memorias', 'GET'],
    ['manage-content?collection=memorias', 'PUT'],
    ['manage-content?collection=memorias', 'PATCH'],
    ['manage-users', 'GET'],
    ['manage-media', 'GET'],
    ['upload-media', 'POST'],
    ['deploy-status', 'GET'],
    ['create-coleccion', 'POST'],
    ['manage-collections', 'POST'],
  ];
  for (const [path, method] of cases) {
    const response = await api(path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    const body = await errorPayload(response);
    assert.equal(body.error.code, 'AUTHENTICATION_REQUIRED');
  }
});

test('colección inválida o ausente: 400 VALIDATION_ERROR', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  for (const path of ['manage-content', 'manage-content?collection=inventada']) {
    const response = await api(path);
    assert.equal(response.status, 400, path);
    const body = await errorPayload(response);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  }
});

test('ruta editorial inválida: 400 VALIDATION_ERROR', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const response = await api('get-revision-history?path=../../etc/passwd');
  assert.equal(response.status, 400);
  const body = await errorPayload(response);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('token inválido: nunca 200 y siempre contrato de error', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const response = await api('manage-content?collection=memorias', {
    headers: { Authorization: 'Bearer token-inventado' },
  });
  assert.ok([401, 500].includes(response.status), `status inesperado: ${response.status}`);
  const body = await errorPayload(response);
  assert.ok(
    ['AUTHENTICATION_REQUIRED', 'CONFIGURATION_ERROR', 'INTERNAL_ERROR'].includes(body.error.code),
    `código inesperado: ${body.error.code}`
  );
});

test('x-request-id: un UUID válido del cliente se conserva en la respuesta', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const response = await api('manage-content?collection=memorias', {
    headers: { 'X-Request-Id': REQUEST_ID },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
  const body = await response.json();
  assert.equal(body.error.requestId, REQUEST_ID);
});

test('CORS: un origen desconocido nunca se refleja en la respuesta', async (t) => {
  if (!serverAvailable) return t.skip('servidor no disponible');
  const response = await api('deploy-status', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(response.status, 204);
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://evil.example');
});
