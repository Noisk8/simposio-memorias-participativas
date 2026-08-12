import { errorResponse, getCorsHeaders } from '../security.ts';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import {
  createCollection,
  validateCreateCollectionInput,
} from '../../shared/cms/collection-service.ts';
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
    const auth = await authorizeRequest(event, 'settings.manage', 'write', {
      netlifyContext: context,
    });
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);
    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      throw new ValidationError('Cuerpo de la petición inválido.');
    }
    const result = await createCollection(validateCreateCollectionInput(payload), {
      requestId,
      actorId: auth.user.id,
    });
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ ok: true, ...result, requestId }),
    };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
