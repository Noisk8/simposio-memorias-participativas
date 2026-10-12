import test from 'node:test';
import assert from 'node:assert/strict';
import { backupObjectPath } from '../scripts/lib/backup-object-path.mjs';

test('ordinary S3 keys and zero-byte directory markers retain their paths', () => {
  assert.deepEqual(backupObjectPath('noisk8_things/reporte ramas.md', 7824), {
    relativePath: 'noisk8_things/reporte ramas.md',
    directoryMarker: false,
  });
  assert.deepEqual(backupObjectPath('noisk8_things/', 0), {
    relativePath: 'noisk8_things',
    directoryMarker: true,
  });
});

test('directory markers cannot conceal nonempty object data', () => {
  for (const size of [1, undefined, -1])
    assert.throws(() => backupObjectPath('folder/', size), /debe estar vacío/);
});

test('S3 paths cannot escape the export directory or contain empty segments', () => {
  for (const key of [
    '',
    '/',
    '/file',
    '../file',
    'a/../file',
    'a/./file',
    'a//file',
    'a//',
    'a\\file',
  ])
    assert.throws(() => backupObjectPath(key, 0), /no segura/);
});
