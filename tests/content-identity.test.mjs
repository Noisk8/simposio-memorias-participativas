import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assignNewContentId,
  contentIdSchema,
  preserveContentId,
  UUID_V4_PATTERN,
} from '../shared/content/identity.ts';
import { newContentPath, publicUrlForContent } from '../shared/content/paths.ts';
import { CANONICAL_COLLECTIONS, inspectContentIds } from '../scripts/migrate-content-uuids.mjs';

const EXISTING_ID = 'a438af39-4360-496b-a9af-b35859cbbf20';
const CLIENT_ID = '78d95656-a697-4fb0-916d-90377f5e4564';

test('el UUID canónico es obligatorio y debe ser v4', () => {
  assert.equal(contentIdSchema.safeParse(EXISTING_ID).success, true);
  assert.equal(contentIdSchema.safeParse(undefined).success, false);
  assert.equal(contentIdSchema.safeParse('no-es-uuid').success, false);
  assert.equal(
    contentIdSchema.safeParse('6ba7b810-9dad-11d1-80b4-00c04fd430c8').success,
    false,
    'un UUID v1 no cumple el contrato editorial v4'
  );
});

test('la creación ignora el UUID suministrado por el cliente', () => {
  const generated = assignNewContentId({ id: CLIENT_ID, title: 'Entrada' }, () => EXISTING_ID);
  assert.equal(generated.id, EXISTING_ID);
  assert.notEqual(generated.id, CLIENT_ID);
  assert.match(String(generated.id), UUID_V4_PATTERN);
});

test('la edición conserva el UUID aunque cambien título, número o slug', () => {
  const updated = preserveContentId(
    { id: EXISTING_ID, title: 'Anterior', number: 38, slug: 'anterior' },
    { id: CLIENT_ID, title: 'Nuevo', number: 39, slug: 'nuevo' }
  );
  assert.equal(updated.id, EXISTING_ID);
  assert.equal(updated.number, 39);
  assert.equal(updated.slug, 'nuevo');
});

test('el UUID no participa en filenames ni rutas públicas', () => {
  const first = { id: EXISTING_ID, number: 38, title: 'Memoria viva' };
  const second = { ...first, id: CLIENT_ID };
  assert.equal(newContentPath('memorias', first), newContentPath('memorias', second));
  assert.equal(
    publicUrlForContent('memorias', 'src/content/memorias/38-memoria-viva.md', first),
    '/museo-memorias/38'
  );
});

test('todo el contenido versionado tiene UUID v4 único', async () => {
  const report = await inspectContentIds(process.cwd());
  assert.equal(report.documents.length > 0, true);
  assert.deepEqual(report.invalid, []);
  assert.deepEqual(report.duplicates, []);
  assert.equal(
    report.documents.every((document) => !document.missing),
    true
  );
});

test('el auditor de migración detecta UUID duplicados antes de escribir', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'simposio-uuid-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(
    CANONICAL_COLLECTIONS.map((collection) =>
      mkdir(path.join(root, 'src', 'content', collection), { recursive: true })
    )
  );
  const source = `---\nid: "${EXISTING_ID}"\ntitle: "Prueba"\n---\n`;
  await writeFile(path.join(root, 'src/content/entradas/uno.md'), source);
  await writeFile(path.join(root, 'src/content/paginas/dos.md'), source);

  const report = await inspectContentIds(root);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].id, EXISTING_ID);
});
