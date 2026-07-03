export const handler = async (event: any, context: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const { user } = context.clientContext || {};
  const roles = user?.app_metadata?.roles || user?.roles || [];
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = roles.includes('admin') || adminEmails.includes((user?.email || '').toLowerCase());

  if (!isAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo los administradores pueden crear proyectos.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cuerpo de la petición inválido' }) };
  }

  const { number, title, place, author, collective, image, description, body } = payload;

  if (!number || !title || !place || !image) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos obligatorios: número, título, lugar e imagen.' }) };
  }

  const safeTitle = String(title).trim();
  const slug = safeTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const fileName = `${number}-${slug || 'proyecto'}.md`;
  const filePath = `src/content/proyectos/${fileName}`;

  const frontmatter = [
    '---',
    `number: ${number}`,
    `title: "${safeTitle}"`,
    `place: "${String(place).trim()}"`,
    `author: "${String(author || '').trim()}"`,
    `collective: "${String(collective || '').trim()}"`,
    `image: "${String(image).trim()}"`,
    `description: "${String(description || '').trim()}"`,
    '---',
    '',
    String(body || '').trim(),
  ].join('\n');

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'Noisk8/test-simposio-memorias-participativas';
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!githubToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GITHUB_TOKEN no está configurado.' }) };
  }

  const content = Buffer.from(frontmatter).toString('base64');
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `Crear proyecto desde el frontend: ${safeTitle}`,
        content,
        branch,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Error de GitHub', details: text }) };
    }

    const data = await response.json();

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        file: filePath,
        commit: data.commit?.sha,
      }),
    };
  } catch (error: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
