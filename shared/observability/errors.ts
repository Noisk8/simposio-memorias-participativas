export type ErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'GITHUB_ERROR'
  | 'STORAGE_ERROR'
  | 'BUILD_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options: { details?: Record<string, unknown>; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Autenticación requerida.') {
    super('AUTHENTICATION_REQUIRED', message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Permisos insuficientes.') {
    super('AUTHORIZATION_DENIED', message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, { details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, { details });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMIT_EXCEEDED', 'Se superó el límite permitido.', 429, { retryAfterSeconds });
  }
}

export class GitHubError extends AppError {
  constructor(
    message = 'No se pudo completar la operación en GitHub.',
    details?: Record<string, unknown>
  ) {
    super('GITHUB_ERROR', message, 502, { details });
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Error interno del servidor.') {
    super('INTERNAL_ERROR', message, 500);
  }
}

export function normalizeError(error: unknown): AppError {
  return error instanceof AppError ? error : new InternalError();
}

export function errorBody(error: unknown, requestId: string) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      requestId,
      ...(normalized.details ? { details: normalized.details } : {}),
      ...(normalized.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: normalized.retryAfterSeconds }
        : {}),
    },
  };
}
