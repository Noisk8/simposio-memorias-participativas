// Se ejecuta automáticamente cuando un usuario se registra en Netlify Identity.
// Asigna rol "admin" si el email está en ADMIN_EMAILS, o "editor" por defecto.
export const handler = async (event: any) => {
  let user;
  try {
    user = JSON.parse(event.body).user;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo inválido' }) };
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  const email = (user?.email || '').toLowerCase();
  const roles = adminEmails.includes(email) ? ['admin'] : ['editor'];

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        roles,
      },
    }),
  };
};
