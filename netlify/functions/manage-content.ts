import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { checkRateLimit, errorResponse, getCorsHeaders, isSafeContentPath } from '../security';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { getGitHubConfiguration } from '../../shared/github/config.ts';
import { getAdminClient } from '../../shared/supabase/admin-client.ts';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  GitHubError,
  RateLimitError,
  ValidationError,
} from '../../shared/observability/errors.ts';
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from '../../shared/content/frontmatter.ts';
import { normalizePublishedContent } from '../../shared/content/publication.ts';
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
type WorkflowState =
  'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'archived';

const MANAGER_ROLES = new Set(['superadmin', 'admin', 'editor']);
const LIST_CACHE = new Map<Collection, { expiresAt: number; items: any[] }>();
const LIST_CACHE_MS = 30_000;
async function assertOwnership(auth: any, path: string, creating = false) {
  if (creating) return auth.user.id;
  const client = getAdminClient();
  if (!client) throw new AppError('INTERNAL_ERROR', 'Supabase no está configurado.', 500);
  const { data, error } = await client
    .from('cms_content_records')
    .select('owner_id')
    .eq('path', path)
    .maybeSingle();
  if (auth.roles.some((role: string) => MANAGER_ROLES.has(role)))
    return data?.owner_id || auth.user.id;
  if (error || !data || data.owner_id !== auth.user.id) {
    throw new AuthorizationError('Solo puedes modificar contenido de tu autoría.');
  }
  return data.owner_id;
}

async function registerContent(
  path: string,
  collection: Collection,
  auth: any,
  ownerId: string,
  creating: boolean,
  sha?: string,
  state: WorkflowState = 'draft'
) {
  const client = getAdminClient();
  if (!client) return;
  const values = {
    path,
    collection,
    owner_id: ownerId,
    updated_by: auth.user.id,
    github_sha: sha || null,
    workflow_state: state,
    updated_at: new Date().toISOString(),
    ...(creating ? { created_by: auth.user.id } : {}),
  };
  const { error } = await client
    .from('cms_content_records')
    .upsert(values, { onConflict: 'path', ignoreDuplicates: false });
  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'cms_content_records.upsert.failed',
        requestId: auth.requestId,
        path,
        collection,
        supabase: {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      })
    );
    throw new AppError(
      'INTERNAL_ERROR',
      'El contenido se guardó, pero no pudo registrarse su estado editorial.',
      500,
      {
        details: {
          path,
          collection,
          workflowState: state,
          supabase: {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          },
        },
      }
    );
  }
}

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
  const file = await response.json();
  const decoded = decodeFile(file);
  await mirrorLocalContent(file.path, Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString('utf8'));
  return decoded;
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

function publicUrlFor(collection: Collection, path: string, data: Record<string, unknown>) {
  const stem = String(path.split('/').pop() || '').replace(/\.md$/i, '');
  if (!stem) return null;
  if (collection === 'entradas') return `/entradas/${stem}`;
  if (collection === 'memorias') {
    const number = String(data.number || stem.split('-')[0] || '').trim();
    return number ? `/museo-memorias/${number}` : null;
  }
  if (collection === 'paginas') {
    const slug = String(data.slug || stem.replace(/^\d{4}-/, '') || '').trim();
    return slug ? `/${slug}` : null;
  }
  if (collection === 'simposios') {
    const slug = String(data.slug || stem || '').trim();
    return slug ? `/ediciones/${slug}` : null;
  }
  return null;
}

function localWorkspaceRoot() {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '../..')];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'src', 'content'))) || null;
}

async function mirrorLocalContent(filePath: string, content: string | null | undefined) {
  if (typeof filePath !== 'string' || !filePath.startsWith('src/content/')) return;
  const root = localWorkspaceRoot();
  if (!root) return;
  try {
    const absolutePath = path.join(root, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, String(content || ''), 'utf8');
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'cms_content.local_mirror.failed',
        filePath,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function removeLocalContent(filePath: string) {
  if (typeof filePath !== 'string' || !filePath.startsWith('src/content/')) return;
  const root = localWorkspaceRoot();
  if (!root) return;
  try {
    await fs.rm(path.join(root, filePath), { force: true });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'cms_content.local_remove.failed',
        filePath,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
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
          body: JSON.stringify({
            ok: true,
            item: await readFile(filePath),
            permissions: auth.permissions,
            roles: auth.roles,
            requestId,
          }),
        };
      }

      const cached = LIST_CACHE.get(config.name);
      if (cached && cached.expiresAt > Date.now()) {
        return {
          statusCode: 200,
          headers: { ...headers, 'Cache-Control': 'private, max-age=15' },
          body: JSON.stringify({
            ok: true,
            items: cached.items,
            permissions: auth.permissions,
            roles: auth.roles,
            cached: true,
            requestId,
          }),
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
      LIST_CACHE.set(config.name, { expiresAt: Date.now() + LIST_CACHE_MS, items });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          items,
          permissions: auth.permissions,
          roles: auth.roles,
          requestId,
        }),
      };
    }

    if (event.httpMethod === 'POST') {
      const data = validateDocument(config.name, payload.data, payload.body);
      if (config.name === 'entradas' && !data.date)
        data.date = new Date().toISOString().slice(0, 10);
      const path = payload.path || newPath(config.name, data);
      if (!isSafeContentPath(path) || !path.startsWith(`src/content/${config.name}/`)) {
        throw new ValidationError('La ruta de guardado no es válida.');
      }
      const ownerId = await assertOwnership(auth, path, !payload.sha);
      const requestedState: WorkflowState = payload.data?.draft === false ? 'published' : 'draft';
      data.owner_id = ownerId;
      data.workflow_state = requestedState;
      const normalizedData = normalizePublishedContent(data, requestedState);
      const content = serializeMarkdownDocument(normalizedData, payload.body);
      const githubResponse = await github(path, {
        method: 'PUT',
        body: JSON.stringify({
          message: `${payload.sha ? 'Actualizar' : 'Crear'} ${config.name}: ${String(normalizedData.title || path)}`,
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
      LIST_CACHE.delete(config.name);
      await registerContent(
        path,
        config.name,
        auth,
        ownerId,
        !payload.sha,
        result.content?.sha,
        requestedState
      );
      await mirrorLocalContent(path, content);
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
        body: JSON.stringify({
          ok: true,
          item: { path, sha: result.content?.sha },
          publicUrl: publicUrlFor(config.name, path, normalizedData),
          requestId,
        }),
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
    await assertOwnership(auth, path);
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
    LIST_CACHE.delete(config.name);
    await getAdminClient()?.from('cms_content_records').delete().eq('path', path);
    await removeLocalContent(path);
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
