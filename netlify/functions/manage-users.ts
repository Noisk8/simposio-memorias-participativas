// Gestión de usuarios de Netlify Identity: listar usuarios y asignar roles.
// Solo accesible para admins (por rol o por estar en ADMIN_EMAILS).
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

  const { identity, user } = context.clientContext || {};

  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Debes iniciar sesión.' }) };
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  const callerRoles = user.app_metadata?.roles || [];
  const isAdmin = callerRoles.includes('admin') || adminEmails.includes((user.email || '').toLowerCase());

  if (!isAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo los administradores pueden gestionar usuarios.' }) };
  }

  if (!identity || !identity.url || !identity.token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'No se pudo obtener el contexto de Identity. Verifica que Identity esté habilitado en Netlify.' }),
    };
  }

  const adminHeaders = {
    'Authorization': `Bearer ${identity.token}`,
    'Content-Type': 'application/json',
  };

  try {
    // GET: listar usuarios con sus roles.
    if (event.httpMethod === 'GET') {
      const res = await fetch(`${identity.url}/admin/users?per_page=100`, { headers: adminHeaders });
      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Error listando usuarios: ${res.status} ${text}` }) };
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

    // POST: asignar roles a un usuario. Body: { userId, roles: ["admin"] }
    if (event.httpMethod === 'POST') {
      let payload;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cuerpo de la petición inválido.' }) };
      }

      const { userId, roles } = payload;
      if (!userId || !Array.isArray(roles)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Se requiere userId y roles (array).' }) };
      }

      const allowedRoles = ['admin', 'editor'];
      const invalid = roles.filter((r: string) => !allowedRoles.includes(r));
      if (invalid.length > 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Roles no válidos: ${invalid.join(', ')}` }) };
      }

      const res = await fetch(`${identity.url}/admin/users/${userId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ app_metadata: { roles } }),
      });

      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Error actualizando usuario: ${res.status} ${text}` }) };
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
