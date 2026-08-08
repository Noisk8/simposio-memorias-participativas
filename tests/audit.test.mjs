import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditResource } from '../shared/observability/audit.ts';

test('conserva identificadores UUID en resource_id', () => {
  const id = 'fa2bbf44-8c6b-43fb-8c3a-d30c8c90db9d';
  assert.deepEqual(normalizeAuditResource(id, { source: 'test' }), {
    resourceId: id,
    metadata: { source: 'test' },
  });
});

test('mueve rutas y slugs a metadata.resourceRef', () => {
  assert.deepEqual(normalizeAuditResource('public/images/imagen.png', { size: 20 }), {
    resourceId: null,
    metadata: { size: 20, resourceRef: 'public/images/imagen.png' },
  });
});
