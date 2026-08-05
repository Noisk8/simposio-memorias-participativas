import { createRateLimiter } from '../shared/lib.mjs';

const DEFAULT_SITE_ORIGIN = 'https://simposio-memorias-participativas.netlify.app';

const writeLimiter = createRateLimiter({ max: 20, windowMs: 60000 });
const readLimiter = createRateLimiter({ max: 60, windowMs: 60000 });

function configuredOrigins(): string[] {
  return [process.env.SITE_URL, process.env.URL, DEFAULT_SITE_ORIGIN]
    .filter(Boolean)
    .map((value) => String(value).replace(/\/$/, ''));
}

export function getCorsHeaders(event: any, methods: string) {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || '';
  const localOrigins = ['http://localhost:8888', 'http://127.0.0.1:8888'];
  const allowedOrigins = [...configuredOrigins(), ...localOrigins];
  const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : configuredOrigins()[0];

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': methods,
    'Content-Type': 'application/json',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function getVerifiedUser(context: any) {
  return context?.clientContext?.user || null;
}

export function getRoles(user: any): string[] {
  const roles = user?.app_metadata?.roles || user?.roles || [];
  return Array.isArray(roles) ? roles : [];
}

export function hasRole(user: any, role: string): boolean {
  return getRoles(user).includes(role);
}

export function isSafeContentPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && /^src\/content\/[a-z0-9_-]+\/[a-z0-9][a-z0-9._-]*\.md$/i.test(filePath);
}

export function getClientIp(event: any): string {
  return (
    event.headers?.['x-nf-client-connection-ip'] ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers?.['x-real-ip'] ||
    'unknown'
  );
}

export function checkRateLimit(kind: 'read' | 'write', key: string): { allowed: boolean; retryAfterMs: number } {
  const limiter = kind === 'write' ? writeLimiter : readLimiter;
  return limiter(key);
}

export function rateLimitHeaders(result: { retryAfterMs: number }, headers: Record<string, string>): Record<string, string> {
  if (result.retryAfterMs > 0) {
    return { ...headers, 'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)) };
  }
  return headers;
}

export function logAudit(action: string, user: any, details: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      type: 'audit',
      timestamp: new Date().toISOString(),
      action,
      user: user?.id || user?.sub || 'unknown',
      email: user?.email || '',
      ...details,
    })
  );
}
