import { errorResponse, getCorsHeaders } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import {
  deleteMedia,
  listMedia,
  mediaUploadPolicy,
  updateMediaMetadata,
  uploadMedia,
} from '../../shared/cms/media-service.ts';
import { AppError, ValidationError } from '../../shared/observability/errors.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, PATCH, DELETE, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const permission =
      event.httpMethod === 'GET'
        ? 'media.read'
        : event.httpMethod === 'POST'
          ? 'media.upload'
          : event.httpMethod === 'PATCH'
            ? 'media.update'
            : 'media.delete';
    const auth = await authorizeRequest(
      event,
      permission,
      event.httpMethod === 'GET' ? 'read' : event.httpMethod === 'POST' ? 'media-upload' : 'write',
      { netlifyContext: context }
    );
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, PATCH, DELETE, OPTIONS', requestId);

    if (event.httpMethod === 'GET') {
      const media = await listMedia();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, media, policy: mediaUploadPolicy(), requestId }),
      };
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
        body: JSON.stringify({ ok: true, media: result.media, image: result.media, requestId }),
      };
    }
    if (event.httpMethod === 'PATCH') {
      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        throw new ValidationError('Cuerpo JSON inválido.');
      }
      const media = await updateMediaMetadata(payload, auth);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, media, requestId }) };
    }
    await deleteMedia({ id: event.queryStringParameters?.id }, auth);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requestId }) };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
