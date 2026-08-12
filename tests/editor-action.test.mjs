import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPublishedVersion, saveActionLabel } from '../shared/content/editor-action.ts';

test('una entrada nueva o nunca publicada conserva la acción de borrador', () => {
  assert.equal(saveActionLabel(null), 'Guardar borrador');
  assert.equal(
    saveActionLabel({ data: { draft: true }, workflow: { workflow_state: 'draft' } }),
    'Guardar borrador'
  );
});

test('una entrada publicada muestra Guardar cambios', () => {
  const published = {
    data: { draft: false },
    workflow: { workflow_state: 'published', published_sha: 'sha-publicado' },
  };
  assert.equal(hasPublishedVersion(published), true);
  assert.equal(saveActionLabel(published), 'Guardar cambios');
});

test('una nueva edición no borra el antecedente de publicación', () => {
  const edited = {
    data: { draft: true },
    workflow: { workflow_state: 'draft', published_sha: 'sha-publicado' },
  };
  assert.equal(hasPublishedVersion(edited), true);
  assert.equal(saveActionLabel(edited), 'Guardar cambios');
});

test('el contenido publicado legacy se reconoce aunque no tenga registro de workflow', () => {
  assert.equal(saveActionLabel({ data: { draft: false } }), 'Guardar cambios');
});
