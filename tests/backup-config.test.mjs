import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';

const script = new URL('../scripts/validate-backup-config.mjs', import.meta.url);
const valid = {
  SUPABASE_ACCESS_TOKEN: 'test-token',
  SUPABASE_DB_PASSWORD: 'test-password',
  SUPABASE_PROJECT_ID: 'test-project',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  BACKUP_ENCRYPTION_KEY: 'a-test-only-key-with-at-least-32-characters',
  S3_ENDPOINT: 'https://s3.example.test',
  S3_REGION: 'garage',
  S3_BUCKET: 'cms-media',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  S3_PUBLIC_BASE_URL: 'https://media.example.test',
  S3_BACKUP_BUCKET: 'private-backups',
};
function validate(overrides = {}) {
  return spawnSync(process.execPath, [script.pathname], {
    env: { ...valid, ...overrides },
    encoding: 'utf8',
  });
}

test('accepts a complete configuration using public certificate authorities', () => {
  assert.equal(validate().status, 0);
});

test('rejects each missing credential without exposing secret values', () => {
  for (const name of Object.keys(valid)) {
    const result = validate({ [name]: '' });
    assert.equal(result.status, 1, name);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(valid.S3_SECRET_ACCESS_KEY));
    assert.ok(!result.stderr.includes(valid.BACKUP_ENCRYPTION_KEY));
  }
});

test('rejects weak encryption and unsafe storage configuration', () => {
  for (const overrides of [
    { BACKUP_ENCRYPTION_KEY: 'short' },
    { S3_BACKUP_BUCKET: 'cms-media' },
    { S3_BUCKET: 'other' },
    { S3_FORCE_PATH_STYLE: 'false' },
    { S3_ENDPOINT: 'http://s3.example.test' },
    { S3_ENDPOINT: 'https://user:password@s3.example.test' },
    { SUPABASE_URL: 'not-a-url' },
    { S3_PUBLIC_BASE_URL: 'https://media.example.test?token=secret' },
    { S3_CA_CERT_PEM: 'not-a-certificate' },
    { S3_CA_CERT_PEM: '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----' },
  ]) {
    assert.equal(validate(overrides).status, 1);
  }
});

test('private CA enables TLS only when explicitly trusted', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-tls-test-'));
  const key = path.join(directory, 'key.pem');
  const cert = path.join(directory, 'cert.pem');
  const ca = path.join(directory, 'trusted.pem');
  let server;
  try {
    const generated = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(generated.status, 0, generated.stderr);
    const pem = readFileSync(cert, 'utf8');
    const result = validate({ S3_CA_CERT_PEM: pem, BACKUP_CA_FILE: ca });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(ca).mode & 0o777, 0o600);
    assert.equal(
      validate({ S3_CA_CERT_PEM: pem + readFileSync(key, 'utf8'), BACKUP_CA_FILE: ca }).status,
      1
    );
    server = https.createServer({ key: readFileSync(key), cert: pem }, (_req, res) =>
      res.end('ok')
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    async function request(trusted) {
      return new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import https from 'node:https'; https.get({hostname:'127.0.0.1',servername:'localhost',port:${port}}, r => { r.resume(); r.on('end', () => process.exit(0)); }).on('error', () => process.exit(1));`,
          ],
          { env: trusted ? { NODE_EXTRA_CA_CERTS: ca } : {}, stdio: 'ignore' }
        );
        child.on('error', reject);
        child.on('exit', resolve);
      });
    }
    assert.equal(await request(false), 1);
    assert.equal(await request(true), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
