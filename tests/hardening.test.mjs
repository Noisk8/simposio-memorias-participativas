import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const header = fs.readFileSync('src/components/Header.astro', 'utf8');
const cleanup = fs.readFileSync('shared/cms/operational-cleanup.ts', 'utf8');
const githubClient = fs.readFileSync('shared/github/client.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202608160002_hardening_retention.sql',
  'utf8'
);

test('la autenticación de Supabase no forma parte del encabezado público', () => {
  assert.doesNotMatch(header, /supabase|user-info|logout/i);
  assert.match(header, /scripts\/header\.ts/);
});

test('la limpieza solo opera ramas CMS terminales y deja trazabilidad', () => {
  assert.match(githubClient, /\^cms\\\//);
  assert.match(cleanup, /\['live', 'archived', 'failed', 'cancelled'\]/);
  assert.match(cleanup, /operational_cleaned_at/);
  assert.match(migration, /audit_log[\s\S]*365 days/);
  assert.match(migration, /cms_workflow_events[\s\S]*730 days/);
  assert.match(migration, /cms_publications[\s\S]*180 days/);
});
