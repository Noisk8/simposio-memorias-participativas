import { AuthenticationError, ConfigurationError, InternalError } from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export function extractBearerToken(event: any): string {
  const header = String(event?.headers?.authorization || event?.headers?.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export async function verifySupabaseSession(event: any, client = getAdminClient()): Promise<any> {
  const token = extractBearerToken(event);
  if (!token) throw new AuthenticationError();
  if (!client) throw new ConfigurationError('Supabase no está configurado en este entorno.');

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new AuthenticationError('La sesión no es válida o ha expirado.');

  const bannedUntil = data.user.banned_until ? Date.parse(data.user.banned_until) : 0;
  if (Number.isFinite(bannedUntil) && bannedUntil > Date.now()) {
    throw new AuthenticationError('La cuenta está deshabilitada.');
  }

  if (!data.user.id) throw new InternalError();
  return data.user;
}
