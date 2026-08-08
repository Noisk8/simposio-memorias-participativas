import { checkRateLimit, errorResponse, getCorsHeaders, getAdminClient } from '../security';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import {
  AppError,
  ConflictError,
  InternalError,
  RateLimitError,
  ValidationError,
} from '../../shared/observability/errors.ts';

const ALLOWED_ROLES = ['superadmin', 'admin', 'editor', 'reviewer', 'author', 'read_only'];

function isValidEmail(email: unknown): email is string {
  return (
    typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function nestedRoleKey(row: any): string | null {
  const role = Array.isArray(row?.roles) ? row.roles[0] : row?.roles;
  return typeof role?.key === 'string' ? role.key : null;
}

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }

    const permission = event.httpMethod === 'GET' ? 'users.read' : 'users.manage';
    const auth = await requirePermission(event, permission);
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);

    const limit = checkRateLimit(
      event.httpMethod === 'GET' ? 'read' : 'write',
      `users:${auth.user.id}`
    );
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));

    const client = getAdminClient();
    if (!client) throw new InternalError('Supabase no está configurado en este entorno.');

    if (event.httpMethod === 'GET') {
      const page = Math.max(1, Math.min(10000, Number(event.queryStringParameters?.page) || 1));
      const perPage = Math.max(
        10,
        Math.min(100, Number(event.queryStringParameters?.perPage) || 50)
      );
      const { data: authUsers, error: listError } = await client.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listError) throw new InternalError('No se pudo consultar la lista de usuarios.');

      const { data: roleRows, error: rolesError } = await client
        .from('user_roles')
        .select('user_id, roles(key)');
      if (rolesError) throw new InternalError('No se pudieron consultar los roles.');

      const rolesByUser = new Map<string, string[]>();
      for (const row of roleRows || []) {
        const roleKey = nestedRoleKey(row);
        if (!roleKey) continue;
        rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), roleKey]);
      }

      const users = (authUsers.users || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        roles: (rolesByUser.get(user.id) || []).sort(),
        created_at: user.created_at,
        last_login: user.last_sign_in_at || null,
        disabled: Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now()),
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          users,
          pagination: { page, perPage, hasMore: users.length === perPage },
          requestId,
        }),
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      throw new ValidationError('Cuerpo de la petición inválido.');
    }

    if (payload.action === 'create') {
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const role = payload.role || 'author';

      if (!isValidEmail(email)) throw new ValidationError('Introduce un email válido.');
      if (password.length < 8 || password.length > 72) {
        throw new ValidationError('La contraseña debe tener entre 8 y 72 caracteres.');
      }
      if (name.length > 100)
        throw new ValidationError('El nombre no puede superar los 100 caracteres.');
      if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
        throw new ValidationError('El rol inicial no es válido.');
      }

      const { data: created, error: createError } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: name ? { full_name: name } : {},
      });
      if (createError || !created.user) {
        throw new ValidationError(createError?.message || 'No se pudo crear el usuario.');
      }

      const { error: roleError } = await client.rpc('cms_set_user_roles', {
        target_user_id: created.user.id,
        target_role_keys: [role],
        actor_user_id: auth.user.id,
      });
      if (roleError) {
        await client.auth.admin.deleteUser(created.user.id);
        throw new InternalError('No se pudo asignar el rol inicial.');
      }

      await recordAudit({
        requestId,
        actorId: auth.user.id,
        action: 'user.create',
        resourceType: 'user',
        resourceId: created.user.id,
        result: 'success',
        metadata: { email, roles: [role] },
      });

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          ok: true,
          user: { id: created.user.id, email, name, roles: [role] },
          requestId,
        }),
      };
    }

    const { userId, roles } = payload;
    if (typeof userId !== 'string' || !userId || !Array.isArray(roles)) {
      throw new ValidationError('Se requiere userId y roles (array).');
    }

    const newRoles = [...new Set(roles)];
    const invalid = newRoles.filter(
      (role) => typeof role !== 'string' || !ALLOWED_ROLES.includes(role)
    );
    if (invalid.length > 0 || newRoles.length !== 1) {
      throw new ValidationError('Cada usuario debe tener exactamente un rol efectivo.');
    }

    const { error: updateError } = await client.rpc('cms_set_user_roles', {
      target_user_id: userId,
      target_role_keys: newRoles,
      actor_user_id: auth.user.id,
    });
    if (updateError) {
      if (/último administrador|propios permisos/i.test(updateError.message || '')) {
        throw new ConflictError(updateError.message);
      }
      if (/usuario|rol/i.test(updateError.message || ''))
        throw new ValidationError(updateError.message);
      throw new InternalError('No se pudieron actualizar los roles.');
    }

    const { data: userData, error: userError } = await client.auth.admin.getUserById(userId);
    if (userError || !userData.user) throw new AppError('NOT_FOUND', 'Usuario no encontrado.', 404);

    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'roles.assign',
      resourceType: 'user',
      resourceId: userId,
      result: 'success',
      metadata: { roles: newRoles },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        user: { id: userId, email: userData.user.email || '', roles: newRoles },
        requestId,
      }),
    };
  } catch (error: unknown) {
    return errorResponse(error, headers, requestId);
  }
};
