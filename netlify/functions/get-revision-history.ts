import { errorResponse, getCorsHeaders, isSafeContentPath } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { getGitHubConfiguration } from '../../shared/github/config.ts';
import { githubRequest } from '../../shared/github/client.ts';
import { AppError, GitHubError, ValidationError } from '../../shared/observability/errors.ts';

const READ_PERMISSIONS: Record<string, string> = {
  entradas: 'entrada.read',
  memorias: 'memoria.read',
  paginas: 'pagina.read',
  simposios: 'simposio.read',
  categorias: 'taxonomy.read',
  etiquetas: 'taxonomy.read',
};

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }

    const filePath = event.queryStringParameters?.path;
    if (!isSafeContentPath(filePath)) throw new ValidationError('La ruta solicitada no es válida.');

    const collection = filePath.split('/')[2];
    const permission = READ_PERMISSIONS[collection];
    if (!permission) throw new ValidationError('La colección solicitada no está permitida.');

    const auth = await authorizeRequest(event, permission, 'read', {
      netlifyContext: context,
    });
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);

    const { owner: repoOwner, repo: repoName, branch } = getGitHubConfiguration();

    const response = await githubRequest(`/repos/${repoOwner}/${repoName}/commits`, {
      query: { path: filePath, sha: branch, per_page: 30 },
    });

    if (!response.ok) {
      await recordAudit({
        requestId,
        actorId: auth.user.id,
        action: 'github.revision-history',
        resourceType: collection,
        result: 'failure',
        metadata: { filePath, githubStatus: response.status },
      });
      throw new GitHubError('No se pudo consultar el historial de revisiones.', {
        status: response.status,
      });
    }

    const commits = await response.json();
    const revisions = commits.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name || 'Desconocido',
      email: commit.commit.author?.email || '',
      date: commit.commit.author?.date || '',
      url: commit.html_url,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, revisions, requestId }),
    };
  } catch (error: unknown) {
    return errorResponse(error, headers, requestId);
  }
};
