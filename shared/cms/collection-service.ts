import { Buffer } from 'node:buffer';
import { getGitHubConfiguration } from '../github/config.ts';
import { githubContentsRequest } from '../github/contents-client.ts';
import { recordAudit } from '../observability/audit.ts';
import {
  ConflictError,
  GitHubError,
  InternalError,
  ValidationError,
} from '../observability/errors.ts';

export type CreateCollectionInput = {
  name: string;
  label: string;
  folder: string;
  slug: string;
};

export function validateCreateCollectionInput(payload: any): CreateCollectionInput {
  const safeName = String(payload?.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '');
  const safeLabel = String(payload?.label || '').trim();
  const safeFolder = String(payload?.folder || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  const safeSlug = String(payload?.slug || '').trim();

  if (!/^[a-z][a-z0-9_]*$/.test(safeName) || safeName.length > 64) {
    throw new ValidationError(
      'El nombre interno debe ser un identificador en minúsculas sin guiones.'
    );
  }
  if (!safeLabel || safeLabel.length > 120 || /[\r\n]/.test(safeLabel)) {
    throw new ValidationError('La etiqueta visible no es válida.');
  }
  if (!/^src\/content\/[a-z0-9-]+$/i.test(safeFolder) || safeFolder !== `src/content/${safeName}`) {
    throw new ValidationError('La carpeta debe corresponder a src/content/<nombre>.');
  }
  if (!safeSlug || safeSlug.length > 120 || /[\r\n]/.test(safeSlug)) {
    throw new ValidationError('El patrón de slug no es válido.');
  }
  return { name: safeName, label: safeLabel, folder: safeFolder, slug: safeSlug };
}

async function readGitHubFile(filePath: string) {
  const response = await githubContentsRequest(filePath);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new GitHubError('No se pudo leer el repositorio.', { status: response.status });
  return response.json();
}

async function writeGitHubFile(filePath: string, content: string, message: string, sha?: string) {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: getGitHubConfiguration().branch,
    ...(sha ? { sha } : {}),
  };
  const response = await githubContentsRequest(filePath, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (response.status === 409 || response.status === 422) {
    throw new ConflictError('La configuración cambió o la colección ya existe.');
  }
  if (!response.ok)
    throw new GitHubError('No se pudo escribir en el repositorio.', {
      status: response.status,
    });
  return response.json();
}

export async function createCollection(
  input: CreateCollectionInput,
  context: { requestId: string; actorId: string }
) {
  const contentConfigPath = 'src/content.config.ts';
  const configFile: any = await readGitHubFile(contentConfigPath);
  if (!configFile) throw new InternalError('No se encontró src/content.config.ts.');

  const source = Buffer.from(configFile.content, 'base64').toString('utf8');
  if (source.includes(`const ${input.name} = defineCollection(`)) {
    throw new ConflictError('La colección ya existe.');
  }
  const exportRegex = /export const collections = \{([^}]+)\};/;
  const match = source.match(exportRegex);
  if (!match) throw new InternalError('No se pudo procesar src/content.config.ts.');

  const definition = `const ${input.name} = defineCollection({
  loader: glob({ pattern: '*.md', base: './${input.folder}' }),
  schema: genericContentSchema,
});

`;
  const updated = source.replace(
    exportRegex,
    definition + `export const collections = { ${match[1].trim()}, ${input.name} };`
  );
  const markerPath = `${input.folder}/.gitkeep`;
  const message = `Crear colección ${input.name} desde el panel`;

  await writeGitHubFile(contentConfigPath, updated, message, configFile.sha);
  await writeGitHubFile(markerPath, '', message);
  await recordAudit({
    requestId: context.requestId,
    actorId: context.actorId,
    action: 'collection.create',
    resourceType: 'collection',
    result: 'success',
    metadata: { collection: input.name, folder: input.folder },
  });

  return {
    collection: input.name,
    files: [contentConfigPath, markerPath],
  };
}
