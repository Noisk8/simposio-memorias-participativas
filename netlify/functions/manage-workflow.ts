import { errorResponse, getCorsHeaders } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import {
  getWorkflowState,
  transitionWorkflow,
  validateWorkflowPath,
  workflowPermission,
} from '../../shared/cms/workflow-service.ts';
import { AppError, ValidationError } from '../../shared/observability/errors.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    let payload: any = {};
    if (event.httpMethod === 'POST') {
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
    }
    const path = validateWorkflowPath(
      event.httpMethod === 'GET' ? event.queryStringParameters?.path : payload.path
    );

    if (event.httpMethod === 'GET') {
      const auth = await authorizeRequest(event, 'admin.access', 'read', {
        netlifyContext: context,
      });
      requestId = auth.requestId;
      headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);
      const record = await getWorkflowState(path);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          record,
          permissions: auth.permissions,
          roles: auth.roles,
          requestId,
        }),
      };
    }

    const operation = workflowPermission(path, payload.transition);
    const auth = await authorizeRequest(
      event,
      operation.permission,
      operation.transition === 'publish' ? 'publish' : 'write',
      { netlifyContext: context }
    );
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);
    const result = await transitionWorkflow({
      path,
      transition: operation.transition,
      comment: payload.comment,
      auth,
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, ...result, requestId }),
    };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
