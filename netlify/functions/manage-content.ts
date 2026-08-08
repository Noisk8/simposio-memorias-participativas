import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { checkRateLimit, errorResponse, getCorsHeaders, isSafeContentPath } from '../security';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { getGitHubConfiguration } from '../../shared/github/config.ts';
import {
  AppError,
  ConflictError,
  GitHubError,
  RateLimitError,
  ValidationError,
} from '../../shared/observability/errors.ts';
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from '../../shared/content/frontmatter.ts';
import {
  categoriaSchema,
  entradaSchema,
  etiquetaSchema,
  memoriaSchema,
  paginaSchema,
  simposioSchema,
} from '../../shared/content-model/index.ts';

const COLLECTIONS = {
  entradas: { permission: 'entrada', schema: entradaSchema },
  memorias: { permission: 'memoria', schema: memoriaSchema },
  paginas: { permission: 'pagina', schema: paginaSchema },
  simposios: { permission: 'simposio', schema: simposioSchema },
  categorias: { permission: 'taxonomy', schema: categoriaSchema },
  etiquetas: { permission: 'taxonomy', schema: etiquetaSchema },
} as const;

type Collection = keyof typeof COLLECTIONS;

function collectionConfig(value: unknown) {
  if (typeof value !== 'string' || !(value in COLLECTIONS)) {
    throw new ValidationError('La colección solicitada no es válida.');
  }
  return { name: value as Collection, ...COLLECTIONS[value as Collection] };
}

function permissionFor(
  collection: Collection,
  action: 'read' | 'create' | 'update' | 'publish' | 'delete'
) {
  const base = COLLECTIONS[collection].permission;
  if (base === 'taxonomy') return action === 'read' ? 'taxonomy.read' : 'taxonomy.manage';
  return `${base}.${action}`;
}

async function github(path: string, init: any = {}) {
  const config = getGitHubConfiguration();
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  return fetch(url + (init.method ? '' : `?ref=${encodeURIComponent(config.branch)}`), {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Simposio-CMS',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

function decodeFile(file: any) {
  const source = Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString(
    'utf8'
  );
  const document = parseMarkdownDocument(source);
  return {
    path: file.path,
    name: file.name,
    sha: file.sha,
    data: document.data,
    body: document.body,
  };
}

async function readFile(path: string) {
  const response = await github(path);
  if (response.status === 404) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
  if (!response.ok)
    throw new GitHubError('No se pudo leer el contenido.', { status: response.status });
  return decodeFile(await response.json());
}

function safeSlug(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function newPath(collection: Collection, data: Record<string, unknown>) {
  let stem = safeSlug(data.slug || data.title);
  if (collection === 'memorias') stem = `${data.number}-${safeSlug(data.title)}`;
  if (collection === 'paginas' && data.simposio) stem = `${safeSlug(data.simposio)}-${stem}`;
  if (!stem) throw new ValidationError('No se pudo generar un nombre de archivo válido.');
  return `src/content/${collection}/${stem}.md`;
}

function validateDocument(collection: Collection, data: unknown, body: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('Los metadatos del contenido no son válidos.');
  }
  if (typeof body !== 'string' || body.length > 200000) {
    throw new ValidationError('El cuerpo debe ser texto y no superar 200.000 caracteres.');
  }
  try {
    return COLLECTIONS[collection].schema.parse(data) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Hay campos incompletos o inválidos.', {
        fields: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    throw error;
  }
}

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!['GET', 'POST', 'DELETE'].includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const requestedCollection = event.queryStringParameters?.collection;
    const config = collectionConfig(requestedCollection);
    let action: 'read' | 'create' | 'update' | 'publish' | 'delete' = 'read';
    if (event.httpMethod === 'DELETE') action = 'delete';

    let payload: any = {};
    if (event.httpMethod === 'POST') {
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
      action = payload.sha ? 'update' : 'create';
      if (
        ['entradas', 'memorias', 'paginas'].includes(config.name) &&
        payload.data?.draft === false
      )
        action = 'publish';
    }

    const auth = await requirePermission(event, permissionFor(config.name, action));
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);
    const limit = checkRateLimit(action === 'read' ? 'read' : 'write', `content:${auth.user.id}`);
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));

    if (event.httpMethod === 'GET') {
      const filePath = event.queryStringParameters?.path;
      if (filePath) {
        if (!isSafeContentPath(filePath) || !filePath.startsWith(`src/content/${config.name}/`)) {
          throw new ValidationError('La ruta solicitada no es válida.');
        }
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ok: true, item: await readFile(filePath), requestId }),
        };
      }

      const response = await github(`src/content/${config.name}`);
      if (response.status === 404)
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ok: true, items: [], requestId }),
        };
      if (!response.ok)
        throw new GitHubError('No se pudo consultar la colección.', { status: response.status });
      const files = (await response.json()).filter(
        (item: any) => item.type === 'file' && item.name.endsWith('.md')
      );
      const items = await Promise.all(files.map((file: any) => readFile(file.path)));
      items.sort((a, b) =>
        String(b.data.date || b.data.year || b.data.number || '').localeCompare(
          String(a.data.date || a.data.year || a.data.number || ''),
          undefined,
          { numeric: true }
        )
      );
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items, requestId }) };
    }

    if (event.httpMethod === 'POST') {
      const data = validateDocument(config.name, payload.data, payload.body);
      if (config.name === 'entradas' && !data.date)
        data.date = new Date().toISOString().slice(0, 10);
      const path = payload.path || newPath(config.name, data);
      if (!isSafeContentPath(path) || !path.startsWith(`src/content/${config.name}/`)) {
        throw new ValidationError('La ruta de guardado no es válida.');
      }
      const content = serializeMarkdownDocument(data, payload.body);
      const githubResponse = await github(path, {
        method: 'PUT',
        body: JSON.stringify({
          message: `${payload.sha ? 'Actualizar' : 'Crear'} ${config.name}: ${String(data.title || path)}`,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: getGitHubConfiguration().branch,
          ...(payload.sha ? { sha: payload.sha } : {}),
        }),
      });
      if (githubResponse.status === 409 || githubResponse.status === 422) {
        throw new ConflictError(
          'El contenido cambió o ya existe. Actualiza la lista antes de reintentar.'
        );
      }
      if (!githubResponse.ok)
        throw new GitHubError('No se pudo guardar el contenido.', {
          status: githubResponse.status,
        });
      const result: any = await githubResponse.json();
      await recordAudit({
        requestId,
        actorId: auth.user.id,
        action: `content.${action}`,
        resourceType: config.name,
        resourceId: path,
        result: 'success',
        metadata: { sha: result.content?.sha },
      });
      return {
        statusCode: payload.sha ? 200 : 201,
        headers,
        body: JSON.stringify({ ok: true, item: { path, sha: result.content?.sha }, requestId }),
      };
    }

    const path = event.queryStringParameters?.path;
    const sha = event.queryStringParameters?.sha;
    if (
      !isSafeContentPath(path) ||
      !path.startsWith(`src/content/${config.name}/`) ||
      typeof sha !== 'string' ||
      !/^[a-f0-9]{40}$/i.test(sha)
    ) {
      throw new ValidationError('La ruta o versión a eliminar no es válida.');
    }
    const githubResponse = await github(path, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Eliminar ${config.name}: ${path}`,
        sha,
        branch: getGitHubConfiguration().branch,
      }),
    });
    if (githubResponse.status === 409 || githubResponse.status === 422)
      throw new ConflictError('El contenido cambió. Actualiza la lista antes de eliminarlo.');
    if (!githubResponse.ok)
      throw new GitHubError('No se pudo eliminar el contenido.', { status: githubResponse.status });
    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'content.delete',
      resourceType: config.name,
      resourceId: path,
      result: 'success',
      metadata: {},
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requestId }) };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
