import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPendingPublishedChanges,
  hasPublishedVersion,
  isArchivedContent,
  isMainContentListingContent,
  isPublishedListingContent,
  isUnpublishedDraft,
  saveActionLabel,
} from '../shared/content/editor-action.ts';

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
    workflow: {
      workflow_state: 'draft',
      current_sha: 'sha-cambios',
      published_sha: 'sha-publicado',
    },
  };
  assert.equal(hasPublishedVersion(edited), true);
  assert.equal(isPublishedListingContent(edited), true);
  assert.equal(isUnpublishedDraft(edited), false);
  assert.equal(hasPendingPublishedChanges(edited), true);
  assert.equal(saveActionLabel(edited), 'Guardar cambios');
});

test('el contenido publicado legacy se reconoce aunque no tenga registro de workflow', () => {
  assert.equal(saveActionLabel({ data: { draft: false } }), 'Guardar cambios');
});

test('solo el contenido nunca publicado pertenece a la lista de borradores', () => {
  const draft = {
    data: { draft: true, workflow_state: 'draft' },
    workflow: { workflow_state: 'draft', current_sha: 'sha-borrador', published_sha: null },
  };
  assert.equal(isUnpublishedDraft(draft), true);
  assert.equal(isPublishedListingContent(draft), false);
});

test('el contenido archivado aparece en la lista principal, pero no como publicado ni borrador', () => {
  const archived = {
    data: { draft: true, workflow_state: 'archived' },
    workflow: { workflow_state: 'archived', current_sha: 'sha-anterior', published_sha: null },
  };
  assert.equal(isArchivedContent(archived), true);
  assert.equal(isUnpublishedDraft(archived), false);
  assert.equal(isPublishedListingContent(archived), false);
  assert.equal(isMainContentListingContent(archived), true);
});
