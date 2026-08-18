import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const editor =
  fs.readFileSync('src/pages/admin/contenidos.astro', 'utf8') +
  fs.readFileSync('src/scripts/admin/content-editor.ts', 'utf8');

test('el editor permite elegir imágenes existentes desde la biblioteca', () => {
  assert.match(editor, /id="media-library-dialog"/);
  assert.match(editor, /Elegir de la biblioteca/);
  assert.match(editor, /api\('\/.netlify\/functions\/manage-media'\)/);
  assert.match(editor, /media\.kind === 'image'/);
  assert.match(editor, /chooseLibraryMedia\(media\)/);
  assert.match(editor, /media\?\.publicUrl \|\| media\?\.path/);
});

test('el selector conserva carga nueva, URL manual y controles accesibles', () => {
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /Buscar por nombre, crédito o licencia/);
  assert.match(editor, /Subir nueva/);
  assert.match(editor, /\/\.netlify\/functions\/upload-media/);
  assert.match(editor, /method: 'POST'/);
  assert.match(editor, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});
