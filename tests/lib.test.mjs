import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, parseFrontmatter, isValidPublicImagePath } from '../shared/lib.mjs';

test('slugify: normaliza acentos, mayúsculas y caracteres especiales', () => {
  assert.equal(slugify('Hola Mundo'), 'hola-mundo');
  assert.equal(slugify('Museo de Memorias Vivas'), 'museo-de-memorias-vivas');
  assert.equal(slugify('ÁÉÍÓÚ'), 'aeiou');
  assert.equal(slugify('  test  '), 'test');
  assert.equal(slugify('año 2026!'), 'ano-2026');
  assert.equal(slugify('---foo-bar---'), 'foo-bar');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify('memoria 1'), 'memoria-1');
});

test('parseFrontmatter: claves simples, arrays, booleanos y números', () => {
  const content = [
    '---',
    'title: "Mi entrada"',
    'draft: true',
    'number: 12',
    'categories:',
    '  - cultura',
    '  - memoria',
    'empty: ""',
    '# un comentario',
    'description: Hola mundo',
    '---',
    'Cuerpo de la entrada.',
  ].join('\n');

  const data = parseFrontmatter(content);
  assert.equal(data.title, 'Mi entrada');
  assert.equal(data.draft, true);
  assert.equal(data.number, 12);
  assert.deepEqual(data.categories, ['cultura', 'memoria']);
  assert.equal(data.empty, '');
  assert.equal(data.description, 'Hola mundo');
  assert.equal(data['# un comentario'], undefined);
});

test('parseFrontmatter: sin frontmatter devuelve objeto vacío', () => {
  assert.deepEqual(parseFrontmatter('solo cuerpo'), {});
  assert.deepEqual(parseFrontmatter(''), {});
});

test('isValidPublicImagePath: acepta rutas válidas y rechaza las demás', () => {
  assert.equal(isValidPublicImagePath('/images/proyecto-10.jpg'), true);
  assert.equal(isValidPublicImagePath('/images/hero-bg.JPG'), true);
  assert.equal(isValidPublicImagePath('/images/foto_1.webp'), true);
  assert.equal(isValidPublicImagePath('/images/carpeta/foto.png'), true);
  assert.equal(isValidPublicImagePath('/images/archivo.jpeg'), true);
  assert.equal(isValidPublicImagePath('images/sin-barra.jpg'), false);
  assert.equal(isValidPublicImagePath('/images/archivo.gif'), true);
  assert.equal(isValidPublicImagePath('/images/mal.avi'), false);
  assert.equal(isValidPublicImagePath('https://ejemplo.com/img.jpg'), false);
  assert.equal(isValidPublicImagePath('/images/../escape.jpg'), false);
  assert.equal(isValidPublicImagePath(''), false);
});
