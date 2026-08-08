import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../shared/content/frontmatter.ts';

test('frontmatter conserva escalares, listas y cuerpo Markdown', () => {
  const source = serializeMarkdownDocument(
    { title: 'Título: con signos', draft: false, number: 3, tags: ['uno', 'dos'] },
    '# Contenido\n\nTexto.'
  );
  const result = parseMarkdownDocument(source);
  assert.deepEqual(result.data, {
    title: 'Título: con signos',
    draft: false,
    number: 3,
    tags: ['uno', 'dos'],
  });
  assert.equal(result.body, '# Contenido\n\nTexto.');
});

test('frontmatter acepta valores existentes sin comillas', () => {
  const result = parseMarkdownDocument('---\ntitle: Entrada de prueba\ndraft: true\n---\nTexto');
  assert.equal(result.data.title, 'Entrada de prueba');
  assert.equal(result.data.draft, true);
  assert.equal(result.body, 'Texto');
});
