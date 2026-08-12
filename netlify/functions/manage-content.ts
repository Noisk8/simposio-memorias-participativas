import { errorResponse, getCorsHeaders } from '../security';
import {
  contentAction,
  contentCollection,
  contentPermission,
  deleteContent,
  getContent,
  saveContent,
} from '../../shared/cms/content-service.ts';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { AppError, ValidationError } from '../../shared/observability/errors.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, PUT, PATCH, DELETE, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!METHODS.includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const collection = contentCollection(event.queryStringParameters?.collection);
    let payload: any = {};
    if (['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
    }
    const action = contentAction(event.httpMethod, payload);
    const auth = await authorizeRequest(
      event,
      contentPermission(collection, action),
      action === 'read' ? 'read' : 'write',
      { netlifyContext: context }
    );
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, PUT, PATCH, DELETE, OPTIONS', requestId);

    if (event.httpMethod === 'GET') {
      const result = await getContent({
        collection,
        filePath: event.queryStringParameters?.path,
        auth,
      });
      return {
        statusCode: 200,
        headers: result.cached ? { ...headers, 'Cache-Control': 'private, max-age=15' } : headers,
        body: JSON.stringify({
          ok: true,
          ...(result.item ? { item: result.item } : { items: result.items }),
          permissions: auth.permissions,
          roles: auth.roles,
          ...(result.cached ? { cached: true } : {}),
          requestId,
        }),
      };
    }
    if (['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
      const result = await saveContent({ collection, method: event.httpMethod, payload, auth });
      return {
        statusCode: result.creating ? 201 : 200,
        headers,
        body: JSON.stringify({
          ok: true,
          item: result.item,
          publicUrl: result.publicUrl,
          requestId,
        }),
      };
    }
    await deleteContent({
      collection,
      filePath: event.queryStringParameters?.path,
      revision: event.queryStringParameters?.revision,
      auth,
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requestId }) };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
