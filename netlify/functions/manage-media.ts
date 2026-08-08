import { Buffer } from 'node:buffer';
import { checkRateLimit, errorResponse, getCorsHeaders } from '../security';
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

const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

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

function safeName(value: unknown) {
  if (typeof value !== 'string') throw new ValidationError('Nombre de imagen inválido.');
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const extension = normalized.split('.').pop() || '';
  if (!normalized || normalized.length > 140 || !EXTENSIONS.has(extension))
    throw new ValidationError('Solo se permiten imágenes JPG, PNG, WebP, GIF o AVIF.');
  return normalized;
}

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  try {
    if (!['GET', 'POST', 'DELETE'].includes(event.httpMethod))
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    const permission =
      event.httpMethod === 'GET'
        ? 'media.read'
        : event.httpMethod === 'POST'
          ? 'media.upload'
          : 'media.delete';
    const auth = await requirePermission(event, permission);
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);
    const limit = checkRateLimit(
      event.httpMethod === 'GET' ? 'read' : 'write',
      `media:${auth.user.id}`
    );
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));

    if (event.httpMethod === 'GET') {
      const response = await github('public/images');
      if (!response.ok)
        throw new GitHubError('No se pudo consultar la biblioteca de imágenes.', {
          status: response.status,
        });
      const images = (await response.json())
        .filter(
          (item: any) =>
            item.type === 'file' &&
            EXTENSIONS.has(String(item.name).split('.').pop()?.toLowerCase() || '')
        )
        .map((item: any) => ({
          name: item.name,
          path: `/images/${item.name}`,
          sha: item.sha,
          size: item.size,
          downloadUrl: item.download_url,
        }));
      images.sort((a: any, b: any) => a.name.localeCompare(b.name));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, images, requestId }) };
    }

    if (event.httpMethod === 'POST') {
      let payload: any;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
      const name = safeName(payload.name);
      if (typeof payload.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content))
        throw new ValidationError('Contenido de imagen inválido.');
      const bytes = Buffer.from(payload.content, 'base64');
      if (!bytes.length || bytes.length > 6 * 1024 * 1024)
        throw new ValidationError('La imagen debe pesar entre 1 byte y 6 MB.');
      const path = `public/images/${name}`;
      const existingResponse = await github(path);
      if (existingResponse.ok) {
        const existing: any = await existingResponse.json();
        const existingBytes = Buffer.from(
          String(existing.content || '').replace(/\n/g, ''),
          'base64'
        );
        if (existingBytes.equals(bytes)) {
          await recordAudit({
            requestId,
            actorId: auth.user.id,
            action: 'media.reuse',
            resourceType: 'media',
            resourceId: path,
            result: 'success',
            metadata: { size: bytes.length, existing: true },
          });
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ok: true,
              image: { name, path: `/images/${name}`, sha: existing.sha, existing: true },
              requestId,
            }),
          };
        }
        throw new ConflictError(
          'Ya existe una imagen diferente con ese nombre. Renombra el archivo antes de subirlo.'
        );
      }
      if (existingResponse.status !== 404)
        throw new GitHubError('No se pudo comprobar si la imagen ya existe.', {
          status: existingResponse.status,
        });
      const response = await github(path, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Subir imagen: ${name}`,
          content: payload.content,
          branch: getGitHubConfiguration().branch,
        }),
      });
      if (response.status === 409 || response.status === 422)
        throw new ConflictError('Ya existe una imagen con ese nombre.');
      if (!response.ok)
        throw new GitHubError('No se pudo subir la imagen.', { status: response.status });
      const result: any = await response.json();
      await recordAudit({
        requestId,
        actorId: auth.user.id,
        action: 'media.upload',
        resourceType: 'media',
        resourceId: path,
        result: 'success',
        metadata: { size: bytes.length },
      });
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          ok: true,
          image: { name, path: `/images/${name}`, sha: result.content?.sha },
          requestId,
        }),
      };
    }

    const name = safeName(event.queryStringParameters?.name);
    const sha = event.queryStringParameters?.sha;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/i.test(sha))
      throw new ValidationError('Versión de imagen inválida.');
    const path = `public/images/${name}`;
    const response = await github(path, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Eliminar imagen: ${name}`,
        sha,
        branch: getGitHubConfiguration().branch,
      }),
    });
    if (response.status === 409 || response.status === 422)
      throw new ConflictError('La imagen cambió. Actualiza la biblioteca.');
    if (!response.ok)
      throw new GitHubError('No se pudo eliminar la imagen.', { status: response.status });
    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'media.delete',
      resourceType: 'media',
      resourceId: path,
      result: 'success',
      metadata: {},
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requestId }) };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
