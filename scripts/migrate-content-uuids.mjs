import { randomUUID } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CANONICAL_COLLECTIONS = [
  'entradas',
  'memorias',
  'paginas',
  'simposios',
  'categorias',
  'etiquetas',
  'menus',
];

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(target);
      return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
    })
  );
  return nested.flat();
}

function frontmatter(source, filePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${filePath}: no contiene frontmatter YAML.`);
  return match[1];
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function readId(source, filePath) {
  const yaml = frontmatter(source, filePath);
  const matches = [...yaml.matchAll(/^id:\s*(.*?)\s*$/gm)];
  if (matches.length > 1) throw new Error(`${filePath}: contiene más de un campo id.`);
  return matches.length ? unquote(matches[0][1]) : '';
}

function insertId(source, id) {
  const newline = source.startsWith('---\r\n') ? '\r\n' : '\n';
  return source.replace(/^---\r?\n/, (opening) => `${opening}id: '${id}'${newline}`);
}

export async function inspectContentIds(projectRoot, { assignMissing = false } = {}) {
  const contentRoot = path.join(projectRoot, 'src', 'content');
  const files = (
    await Promise.all(
      CANONICAL_COLLECTIONS.map((collection) => markdownFiles(path.join(contentRoot, collection)))
    )
  )
    .flat()
    .sort();
  const used = new Map();
  const documents = [];
  const invalid = [];
  const duplicates = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    let id = readId(source, filePath);
    const missing = !id;
    if (missing && assignMissing) {
      do id = randomUUID();
      while (used.has(id));
    }
    if (id && !UUID_V4_PATTERN.test(id)) invalid.push({ filePath, id });
    if (id && used.has(id)) duplicates.push({ id, files: [used.get(id), filePath] });
    else if (id) used.set(id, filePath);
    documents.push({ filePath, source, id, missing });
  }

  return { documents, invalid, duplicates };
}

export async function migrateContentIds(projectRoot, mode) {
  const assignMissing = mode !== 'check';
  const report = await inspectContentIds(projectRoot, { assignMissing });
  if (report.invalid.length || report.duplicates.length) {
    for (const item of report.invalid)
      console.error(`UUID inválido: ${path.relative(projectRoot, item.filePath)} (${item.id})`);
    for (const item of report.duplicates)
      console.error(
        `UUID duplicado: ${item.id} (${item.files.map((file) => path.relative(projectRoot, file)).join(', ')})`
      );
    throw new Error('La migración se detuvo sin escribir archivos.');
  }

  const missing = report.documents.filter((document) => document.missing);
  if (mode === 'check' && missing.length) {
    for (const document of missing)
      console.error(`Falta id: ${path.relative(projectRoot, document.filePath)}`);
    throw new Error(`${missing.length} documentos no tienen UUID canónico.`);
  }

  for (const document of missing) {
    const relativePath = path.relative(projectRoot, document.filePath);
    console.log(`${mode === 'write' ? 'Asignado' : 'Asignaría'} ${document.id} -> ${relativePath}`);
    if (mode !== 'write') continue;
    const temporaryPath = `${document.filePath}.uuid-migration.tmp`;
    await writeFile(temporaryPath, insertId(document.source, document.id), 'utf8');
    await rename(temporaryPath, document.filePath);
  }

  console.log(
    `${mode === 'write' ? 'Migración' : mode === 'check' ? 'Validación' : 'Dry-run'}: ` +
      `${report.documents.length} documentos, ${missing.length} sin id, 0 duplicados.`
  );
  return report;
}

function parseMode(args) {
  const modes = args.filter((arg) => ['--dry-run', '--write', '--check'].includes(arg));
  if (modes.length !== 1 || args.length !== 1) {
    throw new Error('Uso: node scripts/migrate-content-uuids.mjs --dry-run|--write|--check');
  }
  return modes[0].slice(2);
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === executedPath) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await migrateContentIds(projectRoot, parseMode(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
