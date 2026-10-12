import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyBackupMedia } from '../scripts/lib/backup-media-integrity.mjs';

const data = Buffer.from('verified media');
const row = {
  id: 'known-missing',
  storage_path: 'images/2026/09/example.webp',
  checksum_sha256: createHash('sha256').update(data).digest('hex'),
};

test('absent files require an explicit per-record exception', () => {
  assert.throws(() => verifyBackupMedia(row, null), /Falta el archivo/);
  assert.throws(() => verifyBackupMedia(row, null, new Set(['another-id'])), /Falta el archivo/);
  assert.deepEqual(verifyBackupMedia(row, null, new Set([row.id])), { missing: true });
});

test('exceptions never bypass checksum verification or mark recovered files missing', () => {
  const allowed = new Set([row.id]);
  assert.throws(() => verifyBackupMedia(row, Buffer.from('corrupt'), allowed), /verificar/);
  assert.deepEqual(verifyBackupMedia(row, data, allowed), { missing: false });
});
