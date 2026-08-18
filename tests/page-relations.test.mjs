import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { entryBelongsToPage } from '../shared/content/page-relations.ts';

test('una entrada pertenece solo a la página UUID de su misma edición', () => {
  const page = { data: { id: 'page-1', simposio: '2026' } };
  assert.equal(entryBelongsToPage({ data: { page_id: 'page-1', simposio: '2026' } }, page), true);
  assert.equal(entryBelongsToPage({ data: { page_id: 'page-2', simposio: '2026' } }, page), false);
  assert.equal(entryBelongsToPage({ data: { page_id: 'page-1', simposio: '2027' } }, page), false);
});

test('el CMS ofrece la relación y las páginas renderizan entradas relacionadas', () => {
  const editor =
    fs.readFileSync('src/pages/admin/contenidos.astro', 'utf8') +
    fs.readFileSync('src/scripts/admin/content-editor.ts', 'utf8');
  const editorConfig = fs.readFileSync('src/scripts/admin/editor-config.ts', 'utf8');
  const pageTemplate = fs.readFileSync('src/components/PageTemplate.astro', 'utf8');
  const schema = fs.readFileSync('shared/content-model/entrada.ts', 'utf8');
  const validator = fs.readFileSync('scripts/lint-content-relations.mjs', 'utf8');

  assert.match(editorConfig, /Página donde aparecerá/);
  assert.match(editor, /item\.data\.id/);
  assert.match(editor, /syncEntryPageOptions/);
  assert.match(schema, /page_id: optionalContentReference/);
  assert.match(pageTemplate, /<PageEntries entries=\{entries\}/);
  assert.match(validator, /página inexistente o no publicada/);
});
