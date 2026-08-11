import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { logEvent } from '../shared/observability/logger.ts';

let server;
let received;
const previousWebhook = process.env.ALERT_WEBHOOK_URL;

before(async () => {
  received = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/hook`;
});

after(async () => {
  if (previousWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = previousWebhook;
  await new Promise((resolve) => server.close(resolve));
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
