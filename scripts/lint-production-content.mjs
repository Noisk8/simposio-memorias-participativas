import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../shared/lib.mjs';
import { publicationReadinessErrors } from '../shared/content/publication-readiness.ts';
import { safeContentSlug } from '../shared/content/paths.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(root, 'src', 'content');
const errors = [];
const routeOwners = new Map();

for (const collection of fs.readdirSync(contentRoot)) {
  const directory = path.join(contentRoot, collection);
  if (!fs.statSync(directory).isDirectory()) continue;
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.md'))) {
    const relative = path.join('src', 'content', collection, filename);
    const source = fs.readFileSync(path.join(directory, filename), 'utf8');
    const data = parseFrontmatter(source);
    if (data.draft === true) continue;
    const body = source.replace(/^---\n[\s\S]*?\n---\s*/, '');
    const stem = filename.replace(/\.md$/i, '');
    if (stem !== safeContentSlug(stem)) {
      errors.push(`${relative}: el nombre de archivo no es un slug normalizado.`);
    }

    const routeKey =
      collection === 'memorias'
        ? `/museo-memorias/${data.number || ''}`
        : collection === 'paginas'
          ? `/ediciones/${data.simposio || ''}/${data.slug || data.template || stem}`
          : collection === 'entradas'
            ? `/ediciones/${data.simposio || ''}/entradas/${stem}`
            : collection === 'simposios'
              ? `/ediciones/${data.slug || stem}`
              : `/${collection}/${data.slug || stem}`;
    const routeOwner = routeOwners.get(routeKey);
    if (routeOwner) errors.push(`${relative}: colisiona con ${routeOwner} en ${routeKey}.`);
    else routeOwners.set(routeKey, relative);

    for (const message of publicationReadinessErrors(collection, data, body)) {
      errors.push(`${relative}: ${message}`);
    }
    if ('owner_id' in data || 'workflow_state' in data) {
      errors.push(`${relative}: el Markdown público contiene metadata operativa del CMS.`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`✖ ${error}`);
  console.error(`\n✖ ${errors.length} problema(s) bloquean la publicación.`);
  process.exitCode = 1;
} else {
  console.log(`✓ Inventario editorial apto: ${routeOwners.size} rutas sin colisiones.`);
}
