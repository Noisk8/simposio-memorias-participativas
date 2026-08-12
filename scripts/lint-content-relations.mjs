import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../shared/lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectionDocuments(collection, root = projectRoot) {
  const directory = path.join(root, 'src', 'content', collection);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      data: parseFrontmatter(fs.readFileSync(path.join(directory, name), 'utf8')),
    }));
}

export function validatePageRelations(root = projectRoot) {
  const errors = [];
  const pages = collectionDocuments('paginas', root);
  const entries = collectionDocuments('entradas', root);
  const pagesById = new Map();

  for (const page of pages) {
    const id = String(page.data.id || '').trim();
    if (!id) continue;
    if (pagesById.has(id)) {
      errors.push(`Las páginas ${pagesById.get(id).name} y ${page.name} comparten el UUID ${id}.`);
    } else {
      pagesById.set(id, page);
    }
  }

  for (const entry of entries) {
    if (entry.data.draft === true) continue;
    const pageId = String(entry.data.page_id || '').trim();
    if (!pageId) continue;
    const page = pagesById.get(pageId);
    if (!page || page.data.draft === true) {
      errors.push(
        `${entry.name} está asignada a una página inexistente o no publicada (${pageId}).`
      );
      continue;
    }
    if (String(entry.data.simposio || '') !== String(page.data.simposio || '')) {
      errors.push(`${entry.name} y ${page.name} pertenecen a ediciones de simposio diferentes.`);
    }
  }
  return errors;
}

const errors = validatePageRelations();
if (errors.length) {
  for (const error of errors) console.error(`✖ ${error}`);
  console.error(`\n✖ ${errors.length} relación(es) de contenido inválida(s).`);
  process.exitCode = 1;
} else {
  console.log('✓ Relaciones entre entradas y páginas válidas.');
}
