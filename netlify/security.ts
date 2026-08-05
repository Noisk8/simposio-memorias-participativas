import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

// ── Supabase ─────────────────────────────────────────────────────────────────

let adminClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function bearerToken(event: any): string {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

/** Verifica el JWT de Supabase del request y devuelve el usuario autenticado. */
export async function getVerifiedUser(event: any): Promise<any | null> {
  const token = bearerToken(event);
  if (!token) return null;

  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** Como getVerifiedUser, pero adjunta los roles desde user_roles. */
export async function getVerifiedUserWithRoles(event: any): Promise<any | null> {
  const user = await getVerifiedUser(event);
  if (!user) return null;

  const client = getAdminClient();
  if (client) {
    const { data } = await client
      .from('user_roles')
      .select('roles')
      .eq('user_id', user.id)
      .maybeSingle();
    user.roles = Array.isArray(data?.roles) ? data.roles : [];
  } else {
    user.roles = [];
  }
  return user;
}

export function getRoles(user: any): string[] {
  const roles = user?.roles || user?.app_metadata?.roles || [];
  return Array.isArray(roles) ? roles : [];
}

export function hasRole(user: any, role: string): boolean {
  return getRoles(user).includes(role);
}

export function isSafeContentPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && /^src\/content\/[a-z0-9_-]+\/[a-z0-9][a-z0-9._-]*\.md$/i.test(filePath);
}

// ── Rate limiting y auditoría ────────────────────────────────────────────────

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

/** Registra la acción en los logs de la función y, si hay Supabase, en audit_log. */
export function logAudit(action: string, user: any, details: Record<string, unknown> = {}) {
  const entry = {
    type: 'audit',
    timestamp: new Date().toISOString(),
    action,
    user: user?.id || user?.sub || 'unknown',
    email: user?.email || '',
    ...details,
  };

  console.log(JSON.stringify(entry));

  const client = getAdminClient();
  if (!client) return;
  void client
    .from('audit_log')
    .insert({
      action,
      user_id: user?.id || null,
      email: user?.email || '',
      details,
    })
    .then(
      () => {},
      (err: unknown) => console.error('[audit] no se pudo guardar en audit_log:', (err as Error)?.message || err),
    );
}
