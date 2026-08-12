import {
  AppError,
  InternalError,
  errorBody,
  normalizeError,
} from '../shared/observability/errors.ts';
import { logEvent } from '../shared/observability/logger.ts';

const DEFAULT_SITE_ORIGIN = 'https://simposio-memorias-participativas.netlify.app';

function configuredOrigins(): string[] {
  const explicit = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return [...explicit, process.env.SITE_URL, process.env.URL, DEFAULT_SITE_ORIGIN]
    .filter(Boolean)
    .map((value) => String(value).replace(/\/$/, ''));
}

export function getCorsHeaders(event: any, methods: string, requestId?: string) {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || '';
  const localOrigins = ['http://localhost:8888', 'http://127.0.0.1:8888'];
  const configured = configuredOrigins();
  const allowedOrigins = [...configured, ...localOrigins];
  const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : configured[0];

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
    'Access-Control-Allow-Methods': methods,
    'Content-Type': 'application/json',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...(requestId ? { 'x-request-id': requestId } : {}),
  };
}

export function isSafeContentPath(filePath: unknown): filePath is string {
  return (
    typeof filePath === 'string' &&
    /^src\/content\/(entradas|memorias|paginas|simposios|categorias|etiquetas)\/[a-z0-9][a-z0-9._-]*\.md$/i.test(
      filePath
    )
  );
}

export function errorResponse(error: unknown, headers: Record<string, string>, requestId: string) {
  const normalized = normalizeError(error);
  if (normalized.statusCode >= 500) {
    logEvent('error', 'function.request.failed', {
      requestId,
      code: normalized.code,
      statusCode: normalized.statusCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const responseHeaders =
    normalized.retryAfterSeconds !== undefined
      ? { ...headers, 'Retry-After': String(normalized.retryAfterSeconds) }
      : headers;

  return {
    statusCode: normalized.statusCode,
    headers: { ...responseHeaders, 'x-request-id': requestId },
    body: JSON.stringify(errorBody(normalized, requestId)),
  };
}

export function unexpectedError(error: unknown): AppError {
  return error instanceof AppError ? error : new InternalError();
}

export { getAdminClient, isSupabaseConfigured } from '../shared/supabase/admin-client.ts';
