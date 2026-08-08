import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditResource, recordAudit } from '../shared/observability/audit.ts';

test('conserva identificadores UUID en resource_id', () => {
  const id = 'fa2bbf44-8c6b-43fb-8c3a-d30c8c90db9d';
  assert.deepEqual(normalizeAuditResource(id, { source: 'test' }), {
    resourceId: id,
    metadata: { source: 'test' },
  });
});

test('una caída de auditoría no revierte una operación ya confirmada', async () => {
  const client = {
    from() {
      return { insert: async () => ({ error: { message: 'database unavailable' } }) };
    },
  };
  await assert.doesNotReject(
    recordAudit(
      {
        requestId: 'fa2bbf44-8c6b-43fb-8c3a-d30c8c90db9d',
        action: 'content.update',
        result: 'success',
        resourceId: 'src/content/entradas/prueba.md',
      },
      client
    )
  );
});

test('mueve rutas y slugs a metadata.resourceRef', () => {
  assert.deepEqual(normalizeAuditResource('public/images/imagen.png', { size: 20 }), {
    resourceId: null,
    metadata: { size: 20, resourceRef: 'public/images/imagen.png' },
  });
});
