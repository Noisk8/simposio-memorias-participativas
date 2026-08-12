import { createHmac } from 'node:crypto';
import type { PermissionContext } from '../auth/require-permission.ts';
import { requirePermission } from '../auth/require-permission.ts';
import { extractBearerToken } from '../auth/verify-session.ts';
import { logEvent } from '../observability/logger.ts';
import { RateLimitError, RateLimitUnavailableError } from '../observability/errors.ts';
import { getRequestId } from '../observability/request-id.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export type RateLimitAction =
  'read' | 'write' | 'login-sensitive' | 'media-upload' | 'user-management' | 'publish';

export type RateLimitPolicy = {
  max: number;
  windowSeconds: number;
  fallback: 'open' | 'closed';
};

export const RATE_LIMIT_POLICIES: Record<RateLimitAction, RateLimitPolicy> = {
  read: { max: 120, windowSeconds: 60, fallback: 'open' },
  write: { max: 30, windowSeconds: 60, fallback: 'closed' },
  'login-sensitive': { max: 20, windowSeconds: 300, fallback: 'closed' },
  'media-upload': { max: 12, windowSeconds: 300, fallback: 'closed' },
  'user-management': { max: 20, windowSeconds: 300, fallback: 'closed' },
  publish: { max: 10, windowSeconds: 300, fallback: 'closed' },
};

type RateLimitDependencies = {
  client?: any;
  hmacKey?: string;
  policy?: RateLimitPolicy;
};

function trustedHeader(event: any, name: string): string {
  return String(event?.headers?.[name] || event?.headers?.[name.toLowerCase()] || '').trim();
}

/**
 * Nunca usa X-Forwarded-For ni X-Real-IP. En producción solo se acepta el
 * header que añade la plataforma Netlify; en pruebas/local se prefiere el
 * sourceIp del contexto Lambda.
 */
export function getTrustedClientIp(event: any, netlifyContext?: any): string {
  if (netlifyContext?.ip) return String(netlifyContext.ip).slice(0, 64);
  const contextIp =
    event?.requestContext?.http?.sourceIp || event?.requestContext?.identity?.sourceIp || '';
  if (contextIp) return String(contextIp).slice(0, 64);
  if (process.env.NETLIFY === 'true') {
    const netlifyIp = trustedHeader(event, 'x-nf-client-connection-ip');
    if (netlifyIp) return netlifyIp.slice(0, 64);
  }
  return 'unresolved';
}

function rateLimitHmacKey(explicit?: string): string {
  const key = explicit || process.env.RATE_LIMIT_HMAC_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new RateLimitUnavailableError();
  return key;
}

export function rateLimitSubjectHash(
  subject: { userId?: string; ip?: string },
  action: RateLimitAction,
  hmacKey?: string
): string {
  const identity = subject.userId ? `user:${subject.userId}` : `ip:${subject.ip || 'unresolved'}`;
  return createHmac('sha256', rateLimitHmacKey(hmacKey))
    .update(`cms-rate-limit:v1:${action}:${identity}`)
    .digest('hex');
}

function rpcRow(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

export async function enforceRateLimit(
  event: any,
  action: RateLimitAction,
  subject: { userId?: string; ip?: string },
  dependencies: RateLimitDependencies = {}
): Promise<{ remaining: number; retryAfterSeconds: number }> {
  const policy = dependencies.policy || RATE_LIMIT_POLICIES[action];
  const client = dependencies.client === undefined ? getAdminClient() : dependencies.client;
  const requestId = getRequestId(event);

  try {
    if (!client) throw new RateLimitUnavailableError();
    const subjectHash = rateLimitSubjectHash(subject, action, dependencies.hmacKey);
    const { data, error } = await client.rpc('cms_consume_rate_limit', {
      p_subject_hash: subjectHash,
      p_action: action,
      p_limit: policy.max,
      p_window_seconds: policy.windowSeconds,
    });
    if (error) throw error;
    const result = rpcRow(data);
    if (!result || typeof result.allowed !== 'boolean') throw new Error('Respuesta RPC inválida.');
    const retryAfterSeconds = Math.max(1, Number(result.retry_after_seconds) || 1);
    if (!result.allowed) throw new RateLimitError(retryAfterSeconds);
    return { remaining: Math.max(0, Number(result.remaining) || 0), retryAfterSeconds };
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    logEvent(policy.fallback === 'open' ? 'warn' : 'error', 'rate_limit.unavailable', {
      requestId,
      action,
      fallback: policy.fallback,
      message: error instanceof Error ? error.message : String(error),
    });
    if (policy.fallback === 'closed') throw new RateLimitUnavailableError();
    return { remaining: policy.max, retryAfterSeconds: 0 };
  }
}

/** Autoriza con Supabase y aplica límites sin aceptar identidad del cliente. */
export async function authorizeRequest(
  event: any,
  permission: string,
  action: RateLimitAction,
  dependencies: {
    client?: any;
    require?: typeof requirePermission;
    hmacKey?: string;
    netlifyContext?: any;
  } = {}
): Promise<PermissionContext> {
  const client = dependencies.client === undefined ? getAdminClient() : dependencies.client;
  const require = dependencies.require || requirePermission;
  const token = extractBearerToken(event);

  // Las peticiones anónimas se limitan antes de generar auditoría de rechazo.
  if (!token && client) {
    await enforceRateLimit(
      event,
      'login-sensitive',
      { ip: getTrustedClientIp(event, dependencies.netlifyContext) },
      {
        client,
        hmacKey: dependencies.hmacKey,
        policy: {
          ...RATE_LIMIT_POLICIES['login-sensitive'],
          // Si el limiter falla, requirePermission mantiene el rechazo 401:
          // no se abre la operación protegida ni se oculta la causa real.
          fallback: 'open',
        },
      }
    );
  }

  let auth: PermissionContext;
  try {
    auth = await require(event, permission, { ...(client === undefined ? {} : { client }) });
  } catch (error) {
    // Un token falso no se convierte en identidad: se limita por IP.
    if (token && client) {
      await enforceRateLimit(
        event,
        'login-sensitive',
        { ip: getTrustedClientIp(event, dependencies.netlifyContext) },
        {
          client,
          hmacKey: dependencies.hmacKey,
          policy: {
            ...RATE_LIMIT_POLICIES['login-sensitive'],
            fallback: 'open',
          },
        }
      );
    }
    throw error;
  }

  await enforceRateLimit(
    event,
    action,
    { userId: auth.user.id },
    {
      client,
      hmacKey: dependencies.hmacKey,
    }
  );
  return auth;
}
