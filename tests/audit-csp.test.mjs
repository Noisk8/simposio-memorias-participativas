import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const auditor = path.resolve('scripts/audit-csp.mjs');
const requiredPolicy = "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function fixture(script, hashes = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-csp-'));
  const policy = `${requiredPolicy}; script-src 'self' ${hashes.map((hash) => `'${hash}'`).join(' ')}`;
  fs.writeFileSync(
    path.join(directory, 'index.html'),
    `<html><head><meta http-equiv="content-security-policy" content="${policy}"></head><body>${script}</body></html>`
  );
  return directory;
}

function sha256(content) {
  return `sha256-${crypto.createHash('sha256').update(content).digest('base64')}`;
}

function runAuditor(directory) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [auditor, directory], { encoding: 'utf8', env });
}

test('la auditoría CSP acepta scripts externos sin exigir hash', () => {
  const directory = fixture('<script type="module" src="/_astro/app.js"></script>');
  const result = runAuditor(directory);
  assert.equal(result.status, 0, result.stderr);
});

test('la auditoría CSP ignora bloques de datos JSON-LD no ejecutables', () => {
  const directory = fixture('<script type="application/ld+json">{"@type":"WebSite"}</script>');
  const result = runAuditor(directory);
  assert.equal(result.status, 0, result.stderr);
});

test('la auditoría CSP acepta un script inline con su hash exacto', () => {
  const content = "document.documentElement.dataset.ready = 'true';";
  const directory = fixture(`<script>${content}</script>`, [sha256(content)]);
  const result = runAuditor(directory);
  assert.equal(result.status, 0, result.stderr);
});

test('la auditoría CSP rechaza un script inline sin hash', () => {
  const directory = fixture('<script>document.body.hidden = true;</script>');
  const result = runAuditor(directory);
  assert.equal(result.status, 1);
});
