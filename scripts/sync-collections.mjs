/**
 * sync-collections.mjs
 *
 * Lee las carpetas de src/content/ y asegura que cada colección esté registrada
 * en src/content.config.ts y en public/admin/config.yml.
 *
 * A diferencia de la versión anterior, este script:
 *   - No destruye esquemas existentes: solo añade carpetas nuevas.
 *   - Respeta la arquitectura tipo WordPress (categorias, etiquetas, entradas, memorias).
 *   - Genera un esquema genérico para cualquier carpeta nueva que no tenga esquema conocido.
 *
 * Uso: node scripts/sync-collections.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const contentDir = path.join(ROOT, 'src', 'content');
const configPath = path.join(ROOT, 'src', 'content.config.ts');
const cmsConfigPath = path.join(ROOT, 'public', 'admin', 'config.yml');

// Esquemas conocidos para la arquitectura WordPress del CMS.
const KNOWN_SCHEMAS = {
  simposios: `const simposios = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/simposios' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    edition: z.number(),
    year: z.number(),
    date: dateField,
    place: z.string().optional().default(''),
    status: z.enum(['active', 'archived', 'upcoming']).default('active'),
    theme: z.string().optional().default(''),
    image: z.string().optional().default(''),
    poster: z.string().optional().default(''),
    program_url: z.string().optional().default(''),
    is_default: z.boolean().optional().default(false),
  }),
});`,
  categorias: `const categorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/categorias' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional().default(''),
    description: z.string().optional().default(''),
    parent: z.string().optional().default(''),
  }),
});`,
  etiquetas: `const etiquetas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/etiquetas' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});`,
  paginas: `const paginas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/paginas' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    simposio: z.string().default('2026'),
    slug: z.string().optional().default(''),
    parent: z.string().optional().default(''),
    is_home: z.boolean().optional().default(false),
    order: z.number().optional().default(0),
    template: z.enum(['el-simposio', 'organizacion', 'programa', 'contacto', 'default', 'custom']).default('default'),
    title: z.string(),
    description: z.string().optional().default(''),
    image: z.string().optional().default(''),
    email: z.string().optional().default(''),
    instagram: z.string().optional().default(''),
    instagram_handle: z.string().optional().default(''),
    organizadores: nonEmptyStringList,
    instituciones_image: z.string().optional().default(''),
  }),
});`,
  entradas: `const entradas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/entradas' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    publish_date: dateField,
    simposio: z.string().default('2026'),
    title: z.string(),
    date: dateField,
    author: z.string().optional().default(''),
    categories: nonEmptyStringList,
    tags: nonEmptyStringList,
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});`,
  memorias: `const memorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/memorias' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    publish_date: dateField,
    simposio: z.string().default('2026'),
    number: z.number(),
    title: z.string(),
    place: z.string(),
    author: z.string().optional().default(''),
    collective: z.string().optional().default(''),
    categories: nonEmptyStringList,
    tags: nonEmptyStringList,
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});`,
  menus: `const menuItems = z.object({
  label: z.string(),
  url: z.string(),
  order: z.number().optional().default(0),
  children: z.array(z.object({
    label: z.string(),
    url: z.string(),
    order: z.number().optional().default(0),
  })).optional().default([]),
});

const menus = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/menus' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    items: z.array(menuItems).optional().default([]),
  }),
});`,
};

function genericSchema(name) {
  return `const ${name} = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/${name}' }),
  schema: z.object({
    simposio: z.string().default('2026'),
    title: z.string(),
    date: z.union([z.string(), z.date()]).optional().default('').transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});`;
}

function genericCmsEntry(name) {
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return `
  - name: "${name}"
    label: "${label}"
    folder: "src/content/${name}"
    create: true
    slug: "{{slug}}"
    fields:
      - label: "Simposio"
        name: "simposio"
        widget: "relation"
        collection: "simposios"
        search_fields: ["title", "year"]
        value_field: "slug"
        display_fields: ["title", "year"]
        required: false
        default: "2026"
      - { label: "Título", name: "title", widget: "string" }
      - { label: "Fecha", name: "date", widget: "string", required: false }
      - { label: "Imagen", name: "image", widget: "image", required: false }
      - { label: "Descripción", name: "description", widget: "text", required: false }
      - { label: "Contenido", name: "body", widget: "markdown", required: false }
`;
}

// ── 1. Leer carpetas existentes en src/content/ ─────────────────────────────
const folders = fs
  .readdirSync(contentDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

console.log('Colecciones detectadas:', folders);

// ── 2. Sincronizar content.config.ts ──────────────────────────────────────────
let configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
const configHeader = `import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

`;
if (!configText.startsWith('import { defineCollection }')) {
  configText = configHeader + configText;
}

for (const name of folders) {
  if (configText.includes(`const ${name} = defineCollection(`)) continue;

  const schema = KNOWN_SCHEMAS[name] || genericSchema(name);
  const exportIndex = configText.indexOf('export const collections');
  if (exportIndex === -1) {
    configText += '\n\n' + schema;
  } else {
    configText = configText.slice(0, exportIndex) + '\n' + schema + '\n' + configText.slice(exportIndex);
  }
  console.log(`✓ Esquema "${name}" añadido a content.config.ts`);
}

// ── 2b. Detección de desviación: KNOWN_SCHEMAS vs content.config.ts ─────────
// Los esquemas conocidos están duplicados (aquí y en content.config.ts). Si
// divergen, las ediciones futuras de sync-collections podrían sobrescribir
// silenciosamente el esquema real. Avisamos para mantenerlos en sincronía.
function normalizeSchema(schemaText) {
  return schemaText.replace(/\s+/g, ' ').trim();
}

let drift = 0;
for (const [name, known] of Object.entries(KNOWN_SCHEMAS)) {
  const blockRegex = new RegExp(`const ${name} = defineCollection\\([\\s\\S]*?\\n\\}\\);`);
  const knownBlock = known.match(blockRegex);
  const configBlock = configText.match(blockRegex);
  if (!knownBlock || !configBlock) continue;
  if (normalizeSchema(knownBlock[0]) !== normalizeSchema(configBlock[0])) {
    console.warn(`⚠ El esquema "${name}" en content.config.ts difiere del esquema conocido en sync-collections.mjs. Actualiza KNOWN_SCHEMAS para evitar desviación.`);
    drift++;
  }
}
if (drift > 0) {
  console.warn(`⚠ ${drift} esquema(s) desviado(s).`);
} else {
  console.log('✓ Esquemas conocidos en sincronía con content.config.ts.');
}

// Asegurar que el export incluya todas las carpetas
const exportMatch = configText.match(/export\s+const\s+collections\s*=\s*\{([^}]*)\}/);
if (!exportMatch) {
  configText += `\nexport const collections = { ${folders.join(', ')} };\n`;
} else {
  const existingNames = exportMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = folders.filter((n) => !existingNames.includes(n));
  if (missing.length > 0) {
    const newNames = [...existingNames, ...missing].join(', ');
    configText = configText.replace(
      /export\s+const\s+collections\s*=\s*\{([^}]*)\}/,
      `export const collections = { ${newNames} };`
    );
    console.log('✓ Export de collections actualizado');
  }
}

fs.writeFileSync(configPath, configText, 'utf-8');
console.log('✓ content.config.ts sincronizado');

// ── 3. Sincronizar public/admin/config.yml ──────────────────────────────────
const CMS_HIDDEN = ['menus']; // Existen en content/ pero no deben aparecer en el CMS
let cmsYml = fs.readFileSync(cmsConfigPath, 'utf-8');

for (const name of folders) {
  if (CMS_HIDDEN.includes(name)) continue;
  if (cmsYml.includes(`name: "${name}"`)) continue;
  cmsYml += genericCmsEntry(name);
  console.log(`✓ Colección "${name}" añadida al CMS config`);
}

fs.writeFileSync(cmsConfigPath, cmsYml, 'utf-8');
console.log('✓ public/admin/config.yml sincronizado');
