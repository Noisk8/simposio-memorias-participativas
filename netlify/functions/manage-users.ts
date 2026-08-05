/**
 * manage-users.ts
 *
 * Gestión de usuarios de Netlify Identity: listar y asignar roles.
 * Estrategia de autenticación:
 *   1. Lee el JWT del header Authorization: Bearer <token>
 *   2. Verifica admin via context.clientContext.user (inyectado por Netlify)
 *   3. Llama a la API GoTrue con el token de operador de Netlify Identity
 *      (context.clientContext.identity.token), que es el único con permisos
 *      para el endpoint /admin/users.
 */
import { getCorsHeaders, getVerifiedUser, hasRole, checkRateLimit, getClientIp, logAudit, rateLimitHeaders } from '../security';

export const handler = async (event: any, context: any) => {
  const headers = getCorsHeaders(event, 'GET, POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const clientUser = getVerifiedUser(context);
  if (!clientUser) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Autenticación requerida.' }),
    };
  }

  const isAdmin = hasRole(clientUser, 'admin');

  if (!isAdmin) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Solo los administradores pueden gestionar usuarios.' }),
    };
  }

  const limitKey = `users:${clientUser.id || clientUser.sub || getClientIp(event)}`;
  const limitKind = event.httpMethod === 'GET' ? 'read' : 'write';
  const limit = checkRateLimit(limitKind, limitKey);
  if (!limit.allowed) {
    return {
      statusCode: 429,
      headers: rateLimitHeaders(limit, headers),
      body: JSON.stringify({ error: 'Demasiadas peticiones. Inténtalo de nuevo en un momento.' }),
    };
  }

  // ── URL y token de administración de Netlify Identity ───────────────────────
  // En producción: context.clientContext.identity.url / .token
  // En local: la URL del site en Netlify (desde variable de entorno o hardcodeada)
  // Detectar entorno local: en local la URL es localhost o la variable NETLIFY_DEV está presente
  const isLocal =
    process.env.NETLIFY_DEV === 'true' ||
    (event.headers?.host || '').includes('localhost') ||
    (event.headers?.host || '').includes('127.0.0.1');

  if (isLocal) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        users: [],
        _dev_notice: 'La gestión de usuarios no está disponible en local (limitación de Netlify Identity). Usa el deploy en producción para gestionar usuarios.',
      }),
    };
  }

  const identity = context?.clientContext?.identity;
  const identityUrl = identity?.url || process.env.IDENTITY_URL || '';
  if (!identityUrl) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Identity no está configurado en este entorno.' }),
    };
  }

  // El token de operador de Identity puede venir como string o como objeto
  // con propiedad access_token (GoTrue JS).
  const rawIdentityToken = identity?.token;
  const identityToken =
    typeof rawIdentityToken === 'string' ? rawIdentityToken : rawIdentityToken?.access_token;

  if (!identityToken) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'No se pudo obtener el token de administrador de Netlify Identity. Asegúrate de que Identity está habilitado y la función se ejecuta en el sitio de Netlify.',
      }),
    };
  }

  const adminHeaders = {
    'Authorization': `Bearer ${identityToken}`,
    'Content-Type': 'application/json',
  };

  try {
    // GET: listar usuarios
    if (event.httpMethod === 'GET') {
      const res = await fetch(`${identityUrl}/admin/users?per_page=100`, {
        headers: adminHeaders,
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          statusCode: res.status,
          headers,
          body: JSON.stringify({ error: `Error listando usuarios: ${res.status} ${text}` }),
        };
      }
      const data = await res.json();
      const users = (data.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || '',
        roles: u.app_metadata?.roles || [],
        created_at: u.created_at,
        last_login: u.last_login || null,
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ users }) };
    }

    // POST: asignar roles. Body: { userId, roles: ["admin"] }
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

      const allowedRoles = ['admin', 'editor'];
      const invalid = newRoles.filter((role: unknown) => typeof role !== 'string' || !allowedRoles.includes(role));
      if (invalid.length > 0 || newRoles.length > allowedRoles.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'La lista de roles no es válida.' }),
        };
      }

      const currentUserId = clientUser.id || clientUser.sub;
      if (currentUserId && userId === currentUserId && !newRoles.includes('admin')) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'No puedes quitarte tu propio rol de administrador.' }),
        };
      }

      const usersRes = await fetch(`${identityUrl}/admin/users?per_page=100`, {
        headers: adminHeaders,
      });
      if (!usersRes.ok) {
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: 'No se pudo comprobar el estado actual de los usuarios.' }),
        };
      }
      const usersData = await usersRes.json();
      const targetUser = (usersData.users || []).find((user: any) => user.id === userId);
      if (!targetUser) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuario no encontrado.' }),
        };
      }

      const adminCount = (usersData.users || []).filter((user: any) =>
        Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes('admin')
      ).length;
      const targetIsAdmin = Array.isArray(targetUser.app_metadata?.roles) && targetUser.app_metadata.roles.includes('admin');
      if (targetIsAdmin && !newRoles.includes('admin') && adminCount <= 1) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Debe existir al menos un administrador activo.' }),
        };
      }

      const res = await fetch(`${identityUrl}/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ app_metadata: { roles: newRoles } }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          statusCode: res.status,
          headers,
          body: JSON.stringify({ error: `Error actualizando usuario: ${res.status} ${text}` }),
        };
      }

      const updated = await res.json();
      logAudit('assign-roles', clientUser, { targetUserId: userId, roles: newRoles });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            id: updated.id,
            email: updated.email,
            roles: updated.app_metadata?.roles || [],
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
