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
export const handler = async (event: any, context: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // ── Extraer el JWT del header Authorization ──────────────────────────────
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!userToken) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Debes iniciar sesión.' }),
    };
  }

  // ── Verificar que el usuario tiene rol admin ──────────────────────────────
  // En Netlify Functions, clientContext.user contiene los datos del JWT verificados.
  const clientUser = context?.clientContext?.user;

  // Fallback: decodificar el JWT manualmente (solo payload, sin verificar firma)
  // para obtener email y roles cuando estamos en local sin clientContext.
  let email = clientUser?.email || '';
  let roles: string[] = clientUser?.app_metadata?.roles || clientUser?.roles || [];

  if (!clientUser) {
    try {
      const payloadB64 = userToken.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
      email = payload.email || payload.sub || '';
      roles = payload.app_metadata?.roles || payload['https://netlify/roles'] || [];
    } catch {
      // Si no se puede decodificar, seguimos con arrays vacíos
    }
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = roles.includes('admin') || adminEmails.includes(email.toLowerCase());

  if (!isAdmin) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Solo los administradores pueden gestionar usuarios.' }),
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
  const identityUrl =
    identity?.url ||
    process.env.IDENTITY_URL ||
    `https://${process.env.URL?.replace(/^https?:\/\//, '') || 'test-smp-v1.netlify.app'}/.netlify/identity`;

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
      if (!userId || !Array.isArray(newRoles)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Se requiere userId y roles (array).' }),
        };
      }

      const allowedRoles = ['admin', 'editor'];
      const invalid = newRoles.filter((r: string) => !allowedRoles.includes(r));
      if (invalid.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Roles no válidos: ${invalid.join(', ')}` }),
        };
      }

      const res = await fetch(`${identityUrl}/admin/users/${userId}`, {
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
