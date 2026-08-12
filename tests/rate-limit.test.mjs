import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  authorizeRequest,
  enforceRateLimit,
  getTrustedClientIp,
  rateLimitSubjectHash,
} from '../shared/security/rate-limit.ts';
import { RateLimitError, RateLimitUnavailableError } from '../shared/observability/errors.ts';
import { errorResponse, getCorsHeaders } from '../netlify/security.ts';

const EVENT = { headers: { 'x-request-id': '6f55cb59-bf47-4f19-9b82-8c492e3d18db' } };
const KEY = 'test-rate-limit-secret-with-sufficient-entropy';

test('la RPC usa un identificador no reservado para el timestamptz actual', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/202608110008_fix_rate_limit_timestamp.sql',
    'utf8'
  );
  assert.match(migration, /v_now timestamptz := clock_timestamp\(\)/);
  assert.doesNotMatch(migration, /\bcurrent_time timestamptz/);
  assert.match(migration, /values \([\s\S]*v_now/);
});

function fixedWindowClient() {
  let now = 0;
  const buckets = new Map();
  return {
    advance(milliseconds) {
      now += milliseconds;
    },
    async rpc(name, args) {
      assert.equal(name, 'cms_consume_rate_limit');
      const key = `${args.p_subject_hash}:${args.p_action}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.startedAt + args.p_window_seconds * 1000 <= now) {
        bucket = { count: 0, startedAt: now };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const allowed = bucket.count <= args.p_limit;
      return {
        data: [
          {
            allowed,
            remaining: Math.max(0, args.p_limit - bucket.count),
            retry_after_seconds: allowed
              ? 0
              : Math.max(
                  1,
                  Math.ceil((bucket.startedAt + args.p_window_seconds * 1000 - now) / 1000)
                ),
          },
        ],
        error: null,
      };
    },
  };
}

test('rate limit distribuido: bloquea al superar el límite y reinicia la ventana', async () => {
  const client = fixedWindowClient();
  const dependencies = {
    client,
    hmacKey: KEY,
    policy: { max: 2, windowSeconds: 10, fallback: 'closed' },
  };
  await enforceRateLimit(EVENT, 'write', { userId: 'user-1' }, dependencies);
  await enforceRateLimit(EVENT, 'write', { userId: 'user-1' }, dependencies);
  await assert.rejects(
    enforceRateLimit(EVENT, 'write', { userId: 'user-1' }, dependencies),
    RateLimitError
  );
  client.advance(10_000);
  await enforceRateLimit(EVENT, 'write', { userId: 'user-1' }, dependencies);
});

test('rate limit distribuido: usuario y acción tienen buckets independientes', () => {
  const userAWrite = rateLimitSubjectHash({ userId: 'user-a' }, 'write', KEY);
  const userBWrite = rateLimitSubjectHash({ userId: 'user-b' }, 'write', KEY);
  const userARead = rateLimitSubjectHash({ userId: 'user-a' }, 'read', KEY);
  assert.notEqual(userAWrite, userBWrite);
  assert.notEqual(userAWrite, userARead);
  assert.match(userAWrite, /^[a-f0-9]{64}$/);
});

test('authorizeRequest usa únicamente el user.id de la sesión verificada', async () => {
  const calls = [];
  const client = {
    async rpc(_name, args) {
      calls.push(args);
      return {
        data: [{ allowed: true, remaining: 2, retry_after_seconds: 0 }],
        error: null,
      };
    },
  };
  const event = {
    headers: { authorization: 'Bearer validado' },
    body: JSON.stringify({ userId: 'atacante' }),
  };
  const context = await authorizeRequest(event, 'memoria.create', 'write', {
    client,
    hmacKey: KEY,
    require: async () => ({
      requestId: '6f55cb59-bf47-4f19-9b82-8c492e3d18db',
      user: { id: 'usuario-verificado' },
      permissions: ['memoria.create'],
      roles: ['author'],
    }),
  });
  assert.equal(context.user.id, 'usuario-verificado');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].p_subject_hash,
    rateLimitSubjectHash({ userId: 'usuario-verificado' }, 'write', KEY)
  );
  assert.notEqual(
    calls[0].p_subject_hash,
    rateLimitSubjectHash({ userId: 'atacante' }, 'write', KEY)
  );
});

test('rate limit distribuido: la operación atómica conserva el límite bajo concurrencia', async () => {
  const client = fixedWindowClient();
  const calls = Array.from({ length: 20 }, () =>
    enforceRateLimit(
      EVENT,
      'publish',
      { userId: 'publisher' },
      {
        client,
        hmacKey: KEY,
        policy: { max: 5, windowSeconds: 60, fallback: 'closed' },
      }
    )
  );
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 5);
  assert.equal(
    results.filter(
      (result) => result.status === 'rejected' && result.reason instanceof RateLimitError
    ).length,
    15
  );
});

test('rate limit distribuido: fallback abierto solo permite continuar lecturas', async () => {
  const client = { rpc: async () => ({ data: null, error: new Error('db unavailable') }) };
  await enforceRateLimit(EVENT, 'read', { userId: 'reader' }, { client, hmacKey: KEY });
  await assert.rejects(
    enforceRateLimit(EVENT, 'write', { userId: 'writer' }, { client, hmacKey: KEY }),
    RateLimitUnavailableError
  );
});

test('IP confiable: ignora headers reenviados manipulables', () => {
  const previous = process.env.NETLIFY;
  delete process.env.NETLIFY;
  assert.equal(
    getTrustedClientIp({
      headers: {
        'x-forwarded-for': '203.0.113.7',
        'x-real-ip': '203.0.113.8',
        'x-nf-client-connection-ip': '203.0.113.9',
      },
      requestContext: { identity: { sourceIp: '198.51.100.10' } },
    }),
    '198.51.100.10'
  );
  assert.equal(
    getTrustedClientIp({ headers: { 'x-forwarded-for': '203.0.113.7' } }, { ip: '192.0.2.25' }),
    '192.0.2.25'
  );
  if (previous === undefined) delete process.env.NETLIFY;
  else process.env.NETLIFY = previous;
});

test('429 conserva Retry-After, x-request-id y cuerpo normalizado', () => {
  const requestId = EVENT.headers['x-request-id'];
  const response = errorResponse(
    new RateLimitError(17),
    getCorsHeaders(EVENT, 'GET', requestId),
    requestId
  );
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '17');
  assert.equal(response.headers['x-request-id'], requestId);
  assert.equal(JSON.parse(response.body).error.code, 'RATE_LIMIT_EXCEEDED');
});

test('la migración usa upsert atómico, TTL, poda acotada y permisos service_role', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/202608110002_distributed_rate_limits.sql',
    'utf8'
  );
  assert.match(sql, /primary key \(subject_hash, action\)/i);
  assert.match(sql, /on conflict \(subject_hash, action\) do update/i);
  assert.match(sql, /expires_at/i);
  assert.match(sql, /limit 100/i);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
});
