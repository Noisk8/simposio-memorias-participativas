import { Buffer } from 'node:buffer';
import type { PermissionContext } from '../auth/require-permission.ts';
import { getGitHubConfiguration } from '../github/config.ts';
import { githubContentsRequest, githubSearchCode } from '../github/contents-client.ts';
import { assertImageSignature } from '../media/validation.ts';
import { recordAudit } from '../observability/audit.ts';
import { ConflictError, GitHubError, ValidationError } from '../observability/errors.ts';

const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function previewUrl(name: string) {
  const config = getGitHubConfiguration();
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/public/images/${name}`;
}

export function validateMediaName(value: unknown) {
  if (typeof value !== 'string') throw new ValidationError('Nombre de imagen inválido.');
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const extension = normalized.split('.').pop() || '';
  if (!normalized || normalized.length > 140 || !EXTENSIONS.has(extension)) {
    throw new ValidationError('Solo se permiten imágenes JPG, PNG, WebP, GIF o AVIF.');
  }
  return normalized;
}

async function referencesFor(name: string) {
  const config = getGitHubConfiguration();
  const response = await githubSearchCode(
    `"/images/${name}" repo:${config.owner}/${config.repo} path:src/content`
  );
  if (!response.ok) {
    throw new GitHubError('No se pudo comprobar el uso de la imagen.', {
      status: response.status,
    });
  }
  const result: any = await response.json();
  return (result.items || []).map((item: any) => item.path);
}

export async function listMedia() {
  const response = await githubContentsRequest('public/images');
  if (!response.ok) {
    throw new GitHubError('No se pudo consultar la biblioteca de imágenes.', {
      status: response.status,
    });
  }
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
      downloadUrl: item.download_url || previewUrl(item.name),
    }));
  images.sort((a: any, b: any) => a.name.localeCompare(b.name));
  return images;
}

export async function uploadMedia(payload: any, auth: PermissionContext) {
  const name = validateMediaName(payload?.name);
  if (typeof payload?.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content)) {
    throw new ValidationError('Contenido de imagen inválido.');
  }
  const bytes = Buffer.from(payload.content, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new ValidationError('La imagen debe pesar entre 1 byte y 4 MB.');
  }
  assertImageSignature(name, bytes);
  const path = `public/images/${name}`;
  const existingResponse = await githubContentsRequest(path);
  if (existingResponse.ok) {
    const existing: any = await existingResponse.json();
    const existingBytes = Buffer.from(String(existing.content || '').replace(/\n/g, ''), 'base64');
    if (!existingBytes.equals(bytes)) {
      throw new ConflictError(
        'Ya existe una imagen diferente con ese nombre. Renombra el archivo antes de subirlo.'
      );
    }
    await recordAudit({
      requestId: auth.requestId,
      actorId: auth.user.id,
      action: 'media.reuse',
      resourceType: 'media',
      resourceId: path,
      result: 'success',
      metadata: { size: bytes.length, existing: true },
    });
    return {
      statusCode: 200,
      image: {
        name,
        path: `/images/${name}`,
        previewUrl: existing.download_url || previewUrl(name),
        sha: existing.sha,
        existing: true,
      },
    };
  }
  if (existingResponse.status !== 404) {
    throw new GitHubError('No se pudo comprobar si la imagen ya existe.', {
      status: existingResponse.status,
    });
  }
  const response = await githubContentsRequest(path, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Subir imagen: ${name}`,
      content: payload.content,
      branch: getGitHubConfiguration().branch,
    }),
  });
  if (response.status === 409 || response.status === 422) {
    throw new ConflictError('Ya existe una imagen con ese nombre.');
  }
  if (!response.ok)
    throw new GitHubError('No se pudo subir la imagen.', { status: response.status });
  const result: any = await response.json();
  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.upload',
    resourceType: 'media',
    resourceId: path,
    result: 'success',
    metadata: { size: bytes.length },
  });
  return {
    statusCode: 201,
    image: {
      name,
      path: `/images/${name}`,
      previewUrl: result.content?.download_url || previewUrl(name),
      sha: result.content?.sha,
    },
  };
}

export async function deleteMedia(input: { name: unknown; sha: unknown }, auth: PermissionContext) {
  const name = validateMediaName(input.name);
  if (typeof input.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(input.sha)) {
    throw new ValidationError('Versión de imagen inválida.');
  }
  const path = `public/images/${name}`;
  const references = await referencesFor(name);
  if (references.length) {
    throw new ConflictError('La imagen está siendo utilizada y no se puede eliminar.', {
      references,
    });
  }
  const response = await githubContentsRequest(path, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Eliminar imagen: ${name}`,
      sha: input.sha,
      branch: getGitHubConfiguration().branch,
    }),
  });
  if (response.status === 409 || response.status === 422) {
    throw new ConflictError('La imagen cambió. Actualiza la biblioteca.');
  }
  if (!response.ok)
    throw new GitHubError('No se pudo eliminar la imagen.', { status: response.status });
  await recordAudit({
    requestId: auth.requestId,
    actorId: auth.user.id,
    action: 'media.delete',
    resourceType: 'media',
    resourceId: path,
    result: 'success',
    metadata: {},
  });
}
