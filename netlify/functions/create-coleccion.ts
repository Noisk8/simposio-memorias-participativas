import { getCorsHeaders, checkRateLimit, errorResponse } from '../security';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import {
  AppError,
  ConfigurationError,
  ConflictError,
  GitHubError,
  InternalError,
  RateLimitError,
  ValidationError,
} from '../../shared/observability/errors.ts';

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }

    const auth = await requirePermission(event, 'settings.manage');
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);

    const limit = checkRateLimit('write', `coleccion:${auth.user.id}`);
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      throw new ValidationError('Cuerpo de la petición inválido.');
    }

    const { name, label, folder, slug } = payload;
    if (!name || !label || !folder || !slug)
      throw new ValidationError('Faltan campos obligatorios.');

    const safeName = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_|_$/g, '');
    const safeLabel = String(label).trim();
    const safeFolder = String(folder).trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const safeSlug = String(slug).trim();

    if (!/^[a-z][a-z0-9_]*$/.test(safeName) || safeName.length > 64) {
      throw new ValidationError(
        'El nombre interno debe ser un identificador en minúsculas sin guiones.'
      );
    }
    if (!safeLabel || safeLabel.length > 120 || /[\r\n]/.test(safeLabel)) {
      throw new ValidationError('La etiqueta visible no es válida.');
    }
    if (
      !/^src\/content\/[a-z0-9-]+$/i.test(safeFolder) ||
      safeFolder !== `src/content/${safeName}`
    ) {
      throw new ValidationError('La carpeta debe corresponder a src/content/<nombre>.');
    }
    if (!safeSlug || safeSlug.length > 120 || /[\r\n]/.test(safeSlug)) {
      throw new ValidationError('El patrón de slug no es válido.');
    }

    const githubToken = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'Noisk8/simposio-memorias-participativas';
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!githubToken) throw new ConfigurationError('GITHUB_TOKEN no está configurado.');

    const apiBase = `https://api.github.com/repos/${repo}`;
    const apiHeaders = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };

    async function getFile(path: string) {
      const response = await fetch(`${apiBase}/contents/${path}?ref=${branch}`, {
        headers: apiHeaders,
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new GitHubError('No se pudo leer el repositorio.', { status: response.status });
      return response.json();
    }

    async function putFile(path: string, content: string, message: string, sha?: string) {
      const body: Record<string, unknown> = {
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
      };
      if (sha) body.sha = sha;

      const response = await fetch(`${apiBase}/contents/${path}`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new GitHubError('No se pudo escribir en el repositorio.', {
          status: response.status,
        });
      return response.json();
    }

    const contentConfigPath = 'src/content.config.ts';
    const contentConfigFile = await getFile(contentConfigPath);
    if (!contentConfigFile) throw new InternalError('No se encontró src/content.config.ts.');

    const contentConfigContent = Buffer.from(contentConfigFile.content, 'base64').toString('utf-8');
    if (contentConfigContent.includes(`const ${safeName} = defineCollection(`)) {
      throw new ConflictError('La colección ya existe.');
    }
    const exportRegex = /export const collections = \{([^}]+)\};/;
    const match = contentConfigContent.match(exportRegex);
    if (!match) throw new InternalError('No se pudo procesar src/content.config.ts.');

    const newCollectionTs = `const ${safeName} = defineCollection({
  loader: glob({ pattern: '*.md', base: './${safeFolder}' }),
  schema: genericContentSchema,
});

`;
    const newContentConfig = contentConfigContent.replace(
      exportRegex,
      newCollectionTs + `export const collections = { ${match[1].trim()}, ${safeName} };`
    );

    const sampleFilePath = `${safeFolder}/ejemplo.md`.replace(/\/+/g, '/');
    const sampleContent = `---
title: ${JSON.stringify(`Ejemplo de ${safeLabel}`)}
image: ""
description: ""
---

Contenido de ejemplo.
`;
    const message = `Crear colección ${safeName} desde el frontend`;

    await putFile(contentConfigPath, newContentConfig, message, contentConfigFile.sha);
    await putFile(sampleFilePath, sampleContent, message);

    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'collection.create',
      resourceType: 'collection',
      result: 'success',
      metadata: { collection: safeName, folder: safeFolder },
    });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        ok: true,
        collection: safeName,
        files: [contentConfigPath, sampleFilePath],
        requestId,
      }),
    };
  } catch (error: unknown) {
    return errorResponse(error, headers, requestId);
  }
};
