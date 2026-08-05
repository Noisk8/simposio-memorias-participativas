import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  parseFrontmatter,
  isValidPublicImagePath,
  createRateLimiter,
} from '../shared/lib.mjs';

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

test('createRateLimiter: permite hasta max y bloquea después', () => {
  const check = createRateLimiter({ max: 3, windowMs: 1000 });
  const key = 'usuario-1';

  assert.equal(check(key, 0).allowed, true);
  assert.equal(check(key, 10).allowed, true);
  assert.equal(check(key, 20).allowed, true);
  const blocked = check(key, 30);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000 - 30);
});

test('createRateLimiter: la ventana se resetea', () => {
  const check = createRateLimiter({ max: 1, windowMs: 100 });
  assert.equal(check('a', 0).allowed, true);
  assert.equal(check('a', 10).allowed, false);
  assert.equal(check('a', 150).allowed, true);
});

test('createRateLimiter: claves independientes', () => {
  const check = createRateLimiter({ max: 1, windowMs: 100 });
  assert.equal(check('user-a', 0).allowed, true);
  assert.equal(check('user-b', 0).allowed, true);
  assert.equal(check('user-a', 5).allowed, false);
  assert.equal(check('user-b', 5).allowed, false);
});
