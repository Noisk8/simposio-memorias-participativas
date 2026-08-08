/**
 * Sincroniza carpetas de contenido nuevas sin duplicar los modelos canónicos.
 * Los modelos conocidos viven únicamente en shared/content-model/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const contentDirectory = path.join(projectRoot, 'src', 'content');
const contentConfigPath = path.join(projectRoot, 'src', 'content.config.ts');
const identifierPattern = /^[a-z][a-z0-9_]*$/;

function genericSchema(name) {
  return `const ${name} = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/${name}' }),
  schema: genericContentSchema,
});`;
}

const folders = fs
  .readdirSync(contentDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const invalidFolders = folders.filter((name) => !identifierPattern.test(name));
if (invalidFolders.length > 0) {
  throw new Error(
    `Las colecciones deben ser identificadores TypeScript válidos: ${invalidFolders.join(', ')}`
  );
}

console.log('Colecciones detectadas:', folders);

let configText = fs.readFileSync(contentConfigPath, 'utf8');
for (const name of folders) {
  if (configText.includes(`const ${name} = defineCollection(`)) continue;
  const exportIndex = configText.indexOf('export const collections');
  if (exportIndex === -1)
    throw new Error('No se encontró el export de colecciones en src/content.config.ts.');
  configText = `${configText.slice(0, exportIndex)}${genericSchema(name)}\n\n${configText.slice(exportIndex)}`;
  console.log(`✓ Esquema genérico "${name}" añadido a content.config.ts`);
}

const exportMatch = configText.match(/export\s+const\s+collections\s*=\s*\{([^}]*)\}/);
if (!exportMatch) throw new Error('No se pudo leer el export de colecciones.');
const existingNames = exportMatch[1]
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const missingNames = folders.filter((name) => !existingNames.includes(name));
if (missingNames.length > 0) {
  configText = configText.replace(
    /export\s+const\s+collections\s*=\s*\{([^}]*)\}/,
    `export const collections = { ${[...existingNames, ...missingNames].join(', ')} }`
  );
}

fs.writeFileSync(contentConfigPath, configText, 'utf8');
console.log('✓ content.config.ts sincronizado con modelos canónicos.');
