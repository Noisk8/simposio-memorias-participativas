import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBearerToken, verifySupabaseSession } from '../shared/auth/verify-session.ts';
import { extractRbac, requirePermission } from '../shared/auth/require-permission.ts';
import { AuthorizationError, errorBody } from '../shared/observability/errors.ts';
import { getRequestId } from '../shared/observability/request-id.ts';
import { memoriaCreateInputSchema } from '../shared/content-model/memoria.ts';
import { safeAdminRedirect } from '../src/lib/supabase-browser.ts';

const REQUEST_ID = '6f55cb59-bf47-4f19-9b82-8c492e3d18db';

test('extractBearerToken: solo acepta el esquema Bearer', () => {
  assert.equal(
    extractBearerToken({ headers: { authorization: 'Bearer token-valido' } }),
    'token-valido'
  );
  assert.equal(
    extractBearerToken({ headers: { Authorization: 'bearer otro-token' } }),
    'otro-token'
  );
  assert.equal(extractBearerToken({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(extractBearerToken({ headers: {} }), '');
});

test('getRequestId: conserva UUID válido y reemplaza valores arbitrarios', () => {
  assert.equal(getRequestId({ headers: { 'x-request-id': REQUEST_ID } }), REQUEST_ID);
  assert.match(getRequestId({ headers: { 'x-request-id': '<script>' } }), /^[0-9a-f-]{36}$/);
});

test('verifySupabaseSession: rechaza peticiones sin bearer token', async () => {
  await assert.rejects(
    verifySupabaseSession({ headers: {} }, { auth: { getUser: async () => ({}) } }),
    (error) => error.statusCode === 401 && error.code === 'AUTHENTICATION_REQUIRED'
  );
});

test('verifySupabaseSession: rechaza tokens inválidos o expirados', async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: 'expired' } }),
    },
  };
  await assert.rejects(
    verifySupabaseSession({ headers: { authorization: 'Bearer expirado' } }, client),
    (error) => error.statusCode === 401 && error.code === 'AUTHENTICATION_REQUIRED'
  );
});

test('verifySupabaseSession: rechaza usuarios deshabilitados', async () => {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'user-1', banned_until: '2999-01-01T00:00:00.000Z' } },
        error: null,
      }),
    },
  };
  await assert.rejects(
    verifySupabaseSession({ headers: { authorization: 'Bearer token' } }, client),
    (error) => error.statusCode === 401
  );
});

test('extractRbac: deriva roles y permisos únicamente de filas normalizadas', () => {
  const result = extractRbac([
    {
      roles: {
        key: 'author',
        role_permissions: [
          { permissions: { key: 'memoria.create' } },
          { permissions: { key: 'memoria.read' } },
        ],
      },
    },
  ]);
  assert.deepEqual(result.roles, ['author']);
  assert.deepEqual(result.permissions, ['memoria.create', 'memoria.read']);
});

function rbacClient(permissionKeys) {
  return {
    from(table) {
      assert.equal(table, 'user_roles');
      return {
        select() {
          return {
            async eq(column, userId) {
              assert.equal(column, 'user_id');
              assert.equal(userId, 'user-1');
              return {
                data: [
                  {
                    roles: {
                      key: 'author',
                      role_permissions: permissionKeys.map((key) => ({ permissions: { key } })),
                    },
                  },
                ],
                error: null,
              };
            },
          };
        },
      };
    },
  };
}

test('requirePermission: devuelve el contexto efectivo y audita autorización', async () => {
  const audits = [];
  const context = await requirePermission(
    { headers: { 'x-request-id': REQUEST_ID } },
    'memoria.create',
    {
      client: rbacClient(['memoria.create']),
      verifySession: async () => ({ id: 'user-1', app_metadata: { roles: ['superadmin'] } }),
      audit: async (entry) => audits.push(entry),
    }
  );

  assert.deepEqual(context.permissions, ['memoria.create']);
  assert.deepEqual(context.roles, ['author']);
  assert.equal(context.requestId, REQUEST_ID);
  assert.equal(audits[0].result, 'allowed');
});

test('requirePermission: ignora roles enviados en metadatos y devuelve 403', async () => {
  await assert.rejects(
    requirePermission({ headers: {} }, 'memoria.publish', {
      client: rbacClient(['memoria.read']),
      verifySession: async () => ({ id: 'user-1', app_metadata: { roles: ['superadmin'] } }),
      audit: async () => {},
    }),
    AuthorizationError
  );
});

test('errorBody: usa el contrato estructurado con requestId', () => {
  assert.deepEqual(errorBody(new AuthorizationError(), REQUEST_ID), {
    ok: false,
    error: {
      code: 'AUTHORIZATION_DENIED',
      message: 'Permisos insuficientes.',
      requestId: REQUEST_ID,
    },
  });
});

test('memoriaCreateInputSchema: valida límites y rutas sin duplicar reglas del endpoint', () => {
  const valid = memoriaCreateInputSchema.safeParse({
    number: 27,
    title: 'Memoria barrial',
    place: 'Granada',
    image: '/images/memoria-27.webp',
  });
  assert.equal(valid.success, true);

  const traversal = memoriaCreateInputSchema.safeParse({
    number: 27,
    title: 'Memoria barrial',
    place: 'Granada',
    image: '/images/../secreto.jpg',
  });
  assert.equal(traversal.success, false);
});

test('safeAdminRedirect: impide redirecciones externas desde el login', () => {
  assert.equal(safeAdminRedirect('/admin/gestion-usuarios'), '/admin/gestion-usuarios');
  assert.equal(safeAdminRedirect('//evil.example'), '/admin/');
  assert.equal(safeAdminRedirect('https://evil.example'), '/admin/');
  assert.equal(safeAdminRedirect('/otra-ruta'), '/admin/');
});
