import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('la verificación HTTP de producción es bloqueante', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const check = workflow.slice(workflow.indexOf('Verificar producción'));
  assert.doesNotMatch(check.split('Install Playwright')[0], /continue-on-error:\s*true/);
});

test('el E2E autenticado de staging se activa de forma segura', () => {
  const workflow = fs.readFileSync('.github/workflows/staging-e2e.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s+branches: \[staging\]/);
  assert.match(workflow, /if: vars\.STAGING_E2E_ENABLED == 'true'/);
});

test('las publicaciones tienen límite de reintentos y detectan drift publicado', () => {
  const service = fs.readFileSync('shared/cms/publication-service.ts', 'utf8');
  assert.match(service, /MAX_RECONCILIATION_ATTEMPTS = 5/);
  assert.match(service, /retry_exhausted/);
  assert.match(service, /export async function reconcilePublishedDrift/);
  assert.match(service, /deployment_state: 'stale'/);
});
