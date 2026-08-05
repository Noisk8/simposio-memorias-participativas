/**
 * manage-users.ts
 *
 * Gestión de usuarios de Supabase Auth: listar y asignar roles.
 * Estrategia de autenticación:
 *   1. Verifica el JWT de Supabase del header Authorization: Bearer <token>
 *   2. Comprueba que el usuario tiene rol admin (desde public.user_roles)
 *   3. Opera con el cliente service_role (SUPABASE_SERVICE_ROLE_KEY)
 */
import { getCorsHeaders, getVerifiedUserWithRoles, hasRole, checkRateLimit, getClientIp, logAudit, rateLimitHeaders, getAdminClient } from '../security';

const ALLOWED_ROLES = ['admin', 'editor'];

export const handler = async (event: any) => {
  const headers = getCorsHeaders(event, 'GET, POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const clientUser = await getVerifiedUserWithRoles(event);
  if (!clientUser) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Autenticación requerida.' }),
    };
  }

  if (!hasRole(clientUser, 'admin')) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Solo los administradores pueden gestionar usuarios.' }),
    };
  }

  const limitKey = `users:${clientUser.id || getClientIp(event)}`;
  const limitKind = event.httpMethod === 'GET' ? 'read' : 'write';
  const limit = checkRateLimit(limitKind, limitKey);
  if (!limit.allowed) {
    return {
      statusCode: 429,
      headers: rateLimitHeaders(limit, headers),
      body: JSON.stringify({ error: 'Demasiadas peticiones. Inténtalo de nuevo en un momento.' }),
    };
  }

  const client = getAdminClient();
  if (!client) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase no está configurado en este entorno.' }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      const { data: authUsers, error: listError } = await client.auth.admin.listUsers({ perPage: 100 });
      if (listError) throw listError;

      const { data: roleRows, error: rolesError } = await client.from('user_roles').select('user_id, email, roles');
      if (rolesError) throw rolesError;

      const rolesByUser = new Map((roleRows || []).map((row: any) => [row.user_id, row.roles || []]));

      const users = (authUsers.users || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        roles: rolesByUser.get(user.id) || [],
        created_at: user.created_at,
        last_login: user.last_sign_in_at || null,
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ users }) };
    }

    if (event.httpMethod === 'POST') {
      let payload: any;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Cuerpo de la petición inválido.' }),
        };
      }

      const { userId, roles: newRoles } = payload;
      if (typeof userId !== 'string' || !userId || !Array.isArray(newRoles)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Se requiere userId y roles (array).' }),
        };
      }

      const invalid = newRoles.filter((role: unknown) => typeof role !== 'string' || !ALLOWED_ROLES.includes(role));
      if (invalid.length > 0 || newRoles.length > ALLOWED_ROLES.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'La lista de roles no es válida.' }),
        };
      }

      if (clientUser.id === userId && !newRoles.includes('admin')) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'No puedes quitarte tu propio rol de administrador.' }),
        };
      }

      const { data: roleRows, error: rolesError } = await client.from('user_roles').select('user_id, email, roles');
      if (rolesError) throw rolesError;

      const rolesByUser = new Map((roleRows || []).map((row: any) => [row.user_id, row.roles || []]));
      const targetRoles = rolesByUser.get(userId);
      if (targetRoles === undefined) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuario no encontrado.' }),
        };
      }

      const adminCount = Array.from(rolesByUser.values()).filter((roles) => roles.includes('admin')).length;
      const targetIsAdmin = targetRoles.includes('admin');
      if (targetIsAdmin && !newRoles.includes('admin') && adminCount <= 1) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Debe existir al menos un administrador activo.' }),
        };
      }

      const { error: updateError } = await client
        .from('user_roles')
        .update({ roles: newRoles, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (updateError) throw updateError;

      const { data: userData, error: userError } = await client.auth.admin.getUserById(userId);
      if (userError) throw userError;

      logAudit('assign-roles', clientUser, { targetUserId: userId, roles: newRoles });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            id: userId,
            email: userData.user?.email || '',
            roles: newRoles,
          },
        }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido.' }) };
  } catch (error: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Error interno del servidor.' }),
    };
  }
};
