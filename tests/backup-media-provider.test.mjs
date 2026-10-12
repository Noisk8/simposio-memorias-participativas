import test from 'node:test';
import assert from 'node:assert/strict';
import { backupMediaProvider } from '../scripts/lib/backup-media-provider.mjs';
import { ConfigurationError } from '../shared/observability/errors.ts';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  S3_PUBLIC_BASE_URL: 'https://media.example.test',
};
const path = 'images/2026/09/example.webp';
const row = {
  storage_bucket: 'cms-media',
  storage_path: path,
  public_url: `https://old-media.example.test/${path}`,
};

test('backup preserves current Garage and Supabase routing', () => {
  assert.equal(
    backupMediaProvider({ ...row, public_url: `${env.S3_PUBLIC_BASE_URL}/${path}` }, env),
    'garage'
  );
  assert.equal(
    backupMediaProvider(
      { ...row, public_url: `${env.SUPABASE_URL}/storage/v1/object/public/cms-media/${path}` },
      env
    ),
    'supabase'
  );
});

test('only explicitly trusted legacy bases are accepted without modifying catalog rows', () => {
  assert.throws(() => backupMediaProvider(row, env), ConfigurationError);
  const before = { ...row };
  assert.equal(
    backupMediaProvider(row, {
      ...env,
      BACKUP_GARAGE_LEGACY_PUBLIC_BASE_URLS:
        'https://another-old.example.test, https://old-media.example.test',
    }),
    'garage'
  );
  assert.deepEqual(row, before);
});

test('legacy aliases preserve exact key, bucket, URL and path checks', () => {
  const configured = {
    ...env,
    BACKUP_GARAGE_LEGACY_PUBLIC_BASE_URLS: 'https://old-media.example.test',
  };
  for (const invalid of [
    { ...row, public_url: 'https://untrusted.example.test/' + path },
    { ...row, public_url: row.public_url + '?token=value' },
    { ...row, public_url: row.public_url + '#fragment' },
    { ...row, public_url: 'https://old-media.example.test.evil.test/' + path },
    { ...row, storage_bucket: 'private-backups' },
    { ...row, storage_path: 'images/2026/09/other.webp' },
    { ...row, storage_path: 'images/../../secret' },
  ])
    assert.throws(() => backupMediaProvider(invalid, configured), ConfigurationError);
});

test('legacy bases require HTTPS without credentials, query or fragment', () => {
  for (const base of [
    'http://old-media.example.test',
    'https://user:password@old-media.example.test',
    'https://old-media.example.test?token=value',
    'https://old-media.example.test#fragment',
  ])
    assert.throws(
      () => backupMediaProvider(row, { ...env, BACKUP_GARAGE_LEGACY_PUBLIC_BASE_URLS: base }),
      ConfigurationError
    );
});
