import { errorResponse, getCorsHeaders } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { uploadMedia } from '../../shared/cms/media-upload-service.ts';
import { AppError, ValidationError } from '../../shared/observability/errors.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const auth = await authorizeRequest(event, 'media.upload', 'media-upload', {
      netlifyContext: context,
    });
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);
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
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
