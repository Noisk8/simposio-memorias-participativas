import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { logEvent } from '../shared/observability/logger.ts';

let received;
const previousWebhook = process.env.ALERT_WEBHOOK_URL;
const previousFetch = globalThis.fetch;

before(() => {
  received = [];
  globalThis.fetch = async (_url, init) => {
    received.push(JSON.parse(String(init?.body || '{}')));
    return { ok: true, status: 200 };
  };
  process.env.ALERT_WEBHOOK_URL = 'https://alerts.invalid/hook';
});

after(() => {
  if (previousWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = previousWebhook;
  globalThis.fetch = previousFetch;
});

async function waitForAlerts(count) {
  const deadline = Date.now() + 3000;
  while (received.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('logEvent error: envía alerta al webhook con secretos redactados', async () => {
  logEvent('error', 'function.request.failed', {
    requestId: 'req-1',
    statusCode: 500,
    authorization: 'Bearer super-secreto',
  });
  await waitForAlerts(1);
  assert.equal(received.length, 1);
  assert.match(received[0].text, /function\.request\.failed/);
  assert.match(received[0].text, /\[REDACTED\]/);
  assert.doesNotMatch(received[0].text, /super-secreto/);
});

test('logEvent info/warn: no genera alertas', async () => {
  const previousCount = received.length;
  logEvent('info', 'content.published', { requestId: 'req-2' });
  logEvent('warn', 'content.deprecated', { requestId: 'req-3' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(received.length, previousCount);
});

test('logEvent sin ALERT_WEBHOOK_URL: no falla', async () => {
  delete process.env.ALERT_WEBHOOK_URL;
  assert.doesNotThrow(() => logEvent('error', 'sin.webhook', {}));
});
