import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROUTES = [
  'src/pages/[pagina].astro',
  'src/pages/categorias/index.astro',
  'src/pages/categorias/[slug].astro',
  'src/pages/etiquetas/index.astro',
  'src/pages/etiquetas/[slug].astro',
  'src/pages/museo-memorias/page/[page].astro',
  'src/pages/ediciones/[slug]/index.astro',
  'src/pages/ediciones/[slug]/[pagina].astro',
  'src/pages/ediciones/[slug]/entradas/index.astro',
  'src/pages/ediciones/[slug]/entradas/[entrada].astro',
];

test('todas las rutas públicas sensibles respetan publicación programada', async () => {
  for (const route of ROUTES) {
    const source = await readFile(route, 'utf8');
    assert.match(source, /filterPublished/, `${route} debe usar filterPublished`);
  }
});
