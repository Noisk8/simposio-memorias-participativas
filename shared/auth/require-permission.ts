import { AuthorizationError, InternalError } from '../observability/errors.ts';
import { recordAudit } from '../observability/audit.ts';
import { getRequestId } from '../observability/request-id.ts';
import { getAdminClient } from '../supabase/admin-client.ts';
import { verifySupabaseSession } from './verify-session.ts';

export type PermissionContext = {
  requestId: string;
  user: any;
  permissions: string[];
  roles: string[];
};

export function extractRbac(rows: any[]): { permissions: string[]; roles: string[] } {
  const roles = new Set<string>();
  const permissions = new Set<string>();

  for (const row of rows || []) {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (!role) continue;
    if (typeof role.key === 'string') roles.add(role.key);
    for (const link of role.role_permissions || []) {
      const permission = Array.isArray(link.permissions) ? link.permissions[0] : link.permissions;
      if (typeof permission?.key === 'string') permissions.add(permission.key);
    }
  }

  return { roles: [...roles].sort(), permissions: [...permissions].sort() };
}

export async function requirePermission(
  event: any,
  permission: string,
  dependencies: {
    client?: any;
    verifySession?: typeof verifySupabaseSession;
    audit?: typeof recordAudit;
  } = {}
): Promise<PermissionContext> {
  const requestId = getRequestId(event);
  const client = dependencies.client || getAdminClient();
  const verifySession = dependencies.verifySession || verifySupabaseSession;
  const audit = dependencies.audit || recordAudit;
  if (!client) throw new InternalError('Supabase no está configurado en este entorno.');

  let user: any;
  try {
    user = await verifySession(event, client);
  } catch (error) {
    await audit(
      {
        requestId,
        actorId: null,
        action: 'authentication.check',
        resourceType: 'session',
        result: 'denied',
        metadata: {},
      },
      client
    );
    throw error;
  }

  const { data, error } = await client
    .from('user_roles')
    .select('roles(key, role_permissions(permissions(key)))')
    .eq('user_id', user.id);

  if (error) throw new InternalError('No se pudieron consultar los permisos efectivos.');

  const rbac = extractRbac(data || []);
  const allowed = rbac.permissions.includes(permission);

  await audit(
    {
      requestId,
      actorId: user.id,
      action: 'authorization.check',
      resourceType: 'permission',
      result: allowed ? 'allowed' : 'denied',
      metadata: { permission, roles: rbac.roles },
    },
    client
  );

  if (!allowed) throw new AuthorizationError();
  return { requestId, user, ...rbac };
}
