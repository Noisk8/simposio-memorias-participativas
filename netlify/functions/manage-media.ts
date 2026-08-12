import { errorResponse, getCorsHeaders } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { deleteMedia, listMedia, uploadMedia } from '../../shared/cms/media-service.ts';
import { AppError, ValidationError } from '../../shared/observability/errors.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!['GET', 'POST', 'DELETE'].includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const permission =
      event.httpMethod === 'GET'
        ? 'media.read'
        : event.httpMethod === 'POST'
          ? 'media.upload'
          : 'media.delete';
    const auth = await authorizeRequest(
      event,
      permission,
      event.httpMethod === 'GET' ? 'read' : event.httpMethod === 'POST' ? 'media-upload' : 'write',
      { netlifyContext: context }
    );
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, DELETE, OPTIONS', requestId);

    if (event.httpMethod === 'GET') {
      const images = await listMedia();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, images, requestId }) };
    }
    if (event.httpMethod === 'POST') {
      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
      const result = await uploadMedia(payload, auth);
      return {
        statusCode: result.statusCode,
        headers,
        body: JSON.stringify({ ok: true, image: result.image, requestId }),
      };
    }
    await deleteMedia(
      { name: event.queryStringParameters?.name, sha: event.queryStringParameters?.sha },
      auth
    );
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requestId }) };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
