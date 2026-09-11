import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const contentRoot = 'src/content';

function markdownBodies() {
  return fs.readdirSync(contentRoot).flatMap((collection) => {
    const directory = path.join(contentRoot, collection);
    if (!fs.statSync(directory).isDirectory()) return [];
    return fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.md'))
      .map((name) => {
        const source = fs.readFileSync(path.join(directory, name), 'utf8');
        return {
          file: path.join(directory, name),
          body: source.replace(/^---\n[\s\S]*?\n---\s*/, ''),
        };
      });
  });
}

test('el corpus existente no contiene estructuras que el WYSIWYG pueda degradar', () => {
  const unsupported = [];
  for (const { file, body } of markdownBodies()) {
    if (/^\|.*\|\s*$/m.test(body)) unsupported.push(`${file}: tabla Markdown`);
    if (/^- \[[ xX]\]\s+/m.test(body)) unsupported.push(`${file}: lista de tareas`);
    if (/^<([A-Za-z][\w-]*)(?:\s|>)/m.test(body)) unsupported.push(`${file}: HTML sin procesar`);
    if (/^```(?!cms-(?:image|gallery|entries)\s*$)[A-Za-z0-9_-]+\s*$/m.test(body)) {
      unsupported.push(`${file}: bloque de código no visual`);
    }
    if (/^\[\^[^\]]+\]:/m.test(body)) unsupported.push(`${file}: nota al pie`);
  }
  assert.deepEqual(unsupported, []);
});

test('Tipo de autoría ya no forma parte del formulario ni del modelo de entradas', () => {
  const form = fs.readFileSync('src/scripts/admin/editor-config.ts', 'utf8');
  const model = fs.readFileSync('shared/content-model/entrada.ts', 'utf8');
  assert.doesNotMatch(form, /author_type|Tipo de autoría/);
  assert.doesNotMatch(model, /author_type/);
});
