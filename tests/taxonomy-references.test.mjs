import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  normalizeTaxonomyData,
  taxonomyReferencePath,
  taxonomyReferenceSlug,
} from '../shared/content/taxonomy-references.ts';

test('normaliza títulos de taxonomía como referencias estables', () => {
  assert.equal(taxonomyReferenceSlug('  Arte y Memoria Ágil  '), 'arte-y-memoria-agil');
  assert.deepEqual(normalizeTaxonomyData('categorias', { title: 'Arte', slug: '' }), {
    title: 'Arte',
    slug: 'arte',
  });
  assert.equal(taxonomyReferencePath('categorias', 'Arte'), 'src/content/categorias/arte.md');
});

test('conserva un slug explícito y no altera contenido ordinario', () => {
  assert.equal(
    normalizeTaxonomyData('etiquetas', { title: 'Memoria', slug: 'memoria-viva' }).slug,
    'memoria-viva'
  );
  assert.deepEqual(normalizeTaxonomyData('entradas', { title: 'Entrada' }), {
    title: 'Entrada',
  });
});

test('el editor ofrece solo taxonomías publicadas y refresca al publicar', () => {
  const editor = fs.readFileSync('src/scripts/admin/content-editor.ts', 'utf8');
  assert.match(editor, /references\[source\]\.filter\(isPublishedReference\)/);
  assert.match(editor, /taxonomyReferenceSlug\(item\.data\.slug \|\| item\.data\.title\)/);
  assert.match(editor, /if \(state === 'live'\)[\s\S]*await loadReferences\(\)/);
});

test('la publicación comprueba taxonomías antes de crear el PR', () => {
  const service = fs.readFileSync('shared/cms/publication-service.ts', 'utf8');
  const validationIndex = service.indexOf('await assertPublishedTaxonomyReferences');
  const branchIndex = service.indexOf('const baseSha = await getBranchHeadSha()');
  assert.ok(validationIndex > 0);
  assert.ok(branchIndex > validationIndex);
});
