import { errorResponse, getCorsHeaders } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { getGitHubConfiguration } from '../../shared/github/config.ts';
import { githubRequest } from '../../shared/github/client.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { AppError, GitHubError } from '../../shared/observability/errors.ts';

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  try {
    if (event.httpMethod !== 'GET')
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    const auth = await authorizeRequest(event, 'admin.access', 'read', {
      netlifyContext: context,
    });
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);
    const config = getGitHubConfiguration();
    const response = await githubRequest(
      `/repos/${config.owner}/${config.repo}/commits/${encodeURIComponent(config.branch)}/status`
    );
    if (!response.ok)
      throw new GitHubError('No se pudo consultar el estado del despliegue.', {
        status: response.status,
      });
    const status: any = await response.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        state: status.state,
        sha: status.sha,
        checks: status.statuses || [],
        requestId,
      }),
    };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
