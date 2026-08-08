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

const configText = fs.readFileSync(contentConfigPath, 'utf8');

const exportMatch = configText.match(/export\s+const\s+collections\s*=\s*\{([^}]*)\}/);
if (!exportMatch) throw new Error('No se pudo leer el export de colecciones.');
const existingNames = exportMatch[1]
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const missingNames = folders.filter((name) => !existingNames.includes(name));
const missingFolders = existingNames.filter((name) => !folders.includes(name));
if (missingNames.length || missingFolders.length) {
  throw new Error(
    `Colecciones desincronizadas. Sin configurar: ${missingNames.join(', ') || 'ninguna'}. Sin carpeta: ${missingFolders.join(', ') || 'ninguna'}.`
  );
}
console.log(
  '✓ content.config.ts coincide con las carpetas de contenido; no se modificó ningún archivo.'
);
