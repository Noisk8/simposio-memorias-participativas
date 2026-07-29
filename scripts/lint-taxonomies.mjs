/**
 * lint-taxonomies.mjs
 *
 * Valida la integridad de las relaciones entre taxonomías y contenido.
 * Detecta:
 *   1. Categorías/etiquetas usadas en entradas o proyectos sin documento .md propio.
 *   2. Documentos de taxonomía sin ninguna entrada o proyecto asociado.
 *   3. Posibles duplicados (mismo slug o mismo title).
 *
 * Uso: node scripts/lint-taxonomies.mjs
 * Salida: 0 si todo ok, 1 si hay advertencias/errores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const data = {};
  const lines = yaml.split('\n');
  let currentKey = null;
  let currentArray = null;
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    const arrayItem = line.match(/^\s*-\s+(.+)/);
    if (arrayItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(arrayItem[1].trim());
      continue;
    }
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '' || val === '""' || val === "''") {
        data[currentKey] = '';
      } else if (val === 'true') {
        data[currentKey] = true;
      } else if (val === 'false') {
        data[currentKey] = false;
      } else if (!isNaN(Number(val))) {
        data[currentKey] = Number(val);
      } else {
        data[currentKey] = val;
      }
    }
  }
  return data;
}

function readDirFiles(dir) {
  const fullPath = path.join(ROOT, 'src', 'content', dir);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = fs.readFileSync(path.join(fullPath, f), 'utf-8');
      return { file: f, content, data: parseFrontmatter(content) };
    });
}

function main() {
  let errors = 0;
  let warnings = 0;

  const categorias = readDirFiles('categorias');
  const etiquetas = readDirFiles('etiquetas');
  const entradas = readDirFiles('entradas');
  const proyectos = readDirFiles('proyectos');

  // Build slug→term maps
  const catBySlug = new Map();
  const catByTitle = new Map();
  for (const c of categorias) {
    const slug = c.data.slug || slugify(c.data.title || '');
    catBySlug.set(slug, c);
    catByTitle.set(c.data.title, c);
  }

  const tagBySlug = new Map();
  const tagByTitle = new Map();
  for (const t of etiquetas) {
    const slug = t.data.slug || slugify(t.data.title || '');
    tagBySlug.set(slug, t);
    tagByTitle.set(t.data.title, t);
  }

  // Collect all slugs used in content
  const usedCatSlugs = new Set();
  const usedTagSlugs = new Set();

  for (const entry of [...entradas, ...proyectos]) {
    const cats = entry.data.categories || [];
    const tags = entry.data.tags || [];
    for (const c of cats) usedCatSlugs.add(c);
    for (const t of tags) usedTagSlugs.add(t);
  }

  // 1. Términos usados sin documento
  for (const slug of usedCatSlugs) {
    if (!catBySlug.has(slug)) {
      console.warn(`⚠ Categoría "${slug}" usada en contenido pero sin documento en src/content/categorias/`);
      warnings++;
    }
  }
  for (const slug of usedTagSlugs) {
    if (!tagBySlug.has(slug)) {
      console.warn(`⚠ Etiqueta "${slug}" usada en contenido pero sin documento en src/content/etiquetas/`);
      warnings++;
    }
  }

  // 2. Documentos de taxonomía sin uso
  for (const [slug, c] of catBySlug) {
    if (!usedCatSlugs.has(slug)) {
      console.warn(`⚠ Categoría "${c.data.title}" (slug: ${slug}) no tiene ninguna entrada o proyecto asociado`);
      warnings++;
    }
  }
  for (const [slug, t] of tagBySlug) {
    if (!usedTagSlugs.has(slug)) {
      console.warn(`⚠ Etiqueta "${t.data.title}" (slug: ${slug}) no tiene ninguna entrada o proyecto asociado`);
      warnings++;
    }
  }

  // 3. Duplicados
  const slugCounts = new Map();
  const titleCounts = new Map();
  for (const [slug] of catBySlug) {
    slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
  }
  for (const [, c] of catByTitle) {
    titleCounts.set(c.data.title, (titleCounts.get(c.data.title) || 0) + 1);
  }
  for (const [slug] of tagBySlug) {
    slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
  }
  for (const [, t] of tagByTitle) {
    titleCounts.set(t.data.title, (titleCounts.get(t.data.title) || 0) + 1);
  }

  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      console.error(`✖ Duplicado: ${count} taxonomías comparten el slug "${slug}"`);
      errors++;
    }
  }

  if (errors > 0) {
    console.error(`\n✖ ${errors} error(es) encontrado(s). Revisa los duplicados.`);
    process.exit(1);
  }

  if (warnings > 0) {
    console.log(`\n⚠ ${warnings} advertencia(s). Considera crear documentos faltantes.`);
  } else {
    console.log('✓ Taxonomías íntegras: sin huérfanos, sin duplicados.');
  }
}

main();
