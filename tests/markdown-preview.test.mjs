import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { marked } from 'marked';

const editor = fs.readFileSync('src/pages/admin/contenidos.astro', 'utf8');

test('el parser GFM reconoce la sintaxis editorial completa', () => {
  const source = [
    '# Título',
    '',
    '> #### Resultado',
    '>',
    '> - Ingreso **alto**',
    '> - Beneficio *estable*',
    '',
    '- [x] Publicado',
    '- [ ] Pendiente',
    '',
    '```js',
    'const value = 1;',
    '```',
    '',
    '| Campo | Valor |',
    '| --- | --- |',
    '| Estado | ~~viejo~~ nuevo |',
    '',
    '[Enlace](https://example.com)',
  ].join('\n');
  const html = String(marked.parse(source, { gfm: true, breaks: true }));

  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>alto<\/strong>/);
  assert.match(html, /<em>estable<\/em>/);
  assert.match(html, /<input[^>]+checked[^>]+type="checkbox"/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /<table>/);
  assert.match(html, /<del>viejo<\/del>/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('la vista previa sanitiza el HTML antes de insertarlo', () => {
  assert.match(editor, /import DOMPurify from 'dompurify'/);
  assert.match(editor, /import \{ marked \} from 'marked'/);
  assert.match(editor, /DOMPurify\.sanitize/);
  assert.match(editor, /USE_PROFILES: \{ html: true \}/);
  assert.doesNotMatch(editor, /\.replace\(\/\^###/);
});
