import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkCmsBlocks from '../scripts/remark-cms-blocks.mjs';
import {
  cmsEditorBlockErrors,
  parseCmsEditorBlock,
  renderCmsEditorBlockHtml,
  serializeCmsEditorBlock,
} from '../shared/content/editor-blocks.ts';

test('imagen: serializa y recupera un bloque editorial seguro', () => {
  const block = {
    type: 'image',
    image: {
      src: 'https://example.com/imagen.webp',
      alt: 'Descripción útil',
      credit: 'Archivo',
      license: 'CC BY 4.0',
    },
  };
  const markdown = serializeCmsEditorBlock(block);
  assert.match(markdown, /^```cms-image/);
  const json = markdown.replace(/^```cms-image\n|\n```$/g, '');
  assert.deepEqual(parseCmsEditorBlock('cms-image', json), block);
  assert.deepEqual(cmsEditorBlockErrors(markdown), []);
});

test('seguridad: rechaza URLs ejecutables y bloques cms desconocidos', () => {
  assert.equal(
    parseCmsEditorBlock('cms-image', JSON.stringify({ src: 'javascript:alert(1)', alt: '' })),
    null
  );
  assert.deepEqual(cmsEditorBlockErrors('```cms-video\n{}\n```'), [
    'El bloque cms-video no está permitido.',
  ]);
  assert.equal(cmsEditorBlockErrors('```cms-gallery\n{"images":[]}\n```').length, 1);
  assert.deepEqual(cmsEditorBlockErrors('```cms-image\n{}'), [
    'El bloque cms-image no está cerrado.',
  ]);
});

test('entradas: filtra por categoría, excluye borradores y escapa contenido', () => {
  const block = parseCmsEditorBlock(
    'cms-entries',
    JSON.stringify({ category: 'cultura', limit: 2, layout: 'grid' })
  );
  const html = renderCmsEditorBlockHtml(
    block,
    [
      {
        id: 'publicada',
        data: {
          title: '<Publicada>',
          categories: ['cultura'],
          draft: false,
          image: 'https://example.com/publicada.jpg',
        },
      },
      { id: 'borrador', data: { title: 'Borrador', categories: ['cultura'], draft: true } },
      { id: 'otra', data: { title: 'Otra', categories: ['arte'], draft: false } },
      { id: 'actual', data: { title: 'Actual', categories: ['cultura'], draft: false } },
    ],
    { excludeSlug: 'actual' }
  );
  assert.match(html, /&lt;Publicada&gt;/);
  assert.doesNotMatch(html, />Borrador</);
  assert.doesNotMatch(html, />Otra</);
  assert.doesNotMatch(html, />Actual</);
});

test('Astro transforma bloques cms y conserva bloques de código normales', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'code',
        lang: 'cms-image',
        value: JSON.stringify({ src: '/images/ejemplo.jpg', alt: 'Ejemplo' }),
      },
      { type: 'code', lang: 'js', value: 'const example = true;' },
    ],
  };
  remarkCmsBlocks()(tree);
  assert.equal(tree.children[0].type, 'html');
  assert.match(tree.children[0].value, /cms-rich-block-image/);
  assert.equal(tree.children[1].type, 'code');
});

test('el procesador Markdown de Astro genera el bloque público final', async () => {
  const processor = await createMarkdownProcessor({ remarkPlugins: [remarkCmsBlocks] });
  const source = serializeCmsEditorBlock({
    type: 'image',
    image: { src: '/images/ejemplo.jpg', alt: 'Imagen de ejemplo' },
  });
  const result = await processor.render(source);
  assert.match(result.code, /cms-rich-block-image/);
  assert.match(result.code, /alt="Imagen de ejemplo"/);
  assert.doesNotMatch(result.code, /language-cms-image/);
});

test('el panel ofrece herramientas visuales y selección múltiple de medios', () => {
  const source =
    fs.readFileSync('src/pages/admin/contenidos.astro', 'utf8') +
    fs.readFileSync('src/scripts/admin/content-editor.ts', 'utf8') +
    fs.readFileSync('src/components/admin/VisualContentEditor.tsx', 'utf8') +
    fs.readFileSync('src/components/admin/CmsBlockNode.tsx', 'utf8');
  assert.match(source, /data-block-action="image"/);
  assert.match(source, /data-block-action="gallery"/);
  assert.match(source, /data-block-action="carousel"/);
  assert.match(source, /data-block-action="entries"/);
  assert.match(source, /mediaPickerMode === 'multiple'/);
  assert.match(source, /serializeCmsEditorBlock/);
  assert.match(source, /LexicalComposer/);
  assert.match(source, /DraggableBlockPlugin_EXPERIMENTAL/);
  assert.match(source, /cms:block-insert/);
  assert.match(source, /Mover hacia arriba/);
  assert.match(source, /Mover hacia abajo/);
  assert.match(source, /aria-label="Contenido"/);
});
