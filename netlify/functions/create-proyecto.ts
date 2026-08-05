import { getCorsHeaders, getVerifiedUser, hasRole } from '../security';

export const handler = async (event: any, context: any) => {
  const headers = getCorsHeaders(event, 'POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const user = getVerifiedUser(context);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Autenticación requerida.' }) };
  }

  const isAdmin = hasRole(user, 'admin');

  if (!isAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo los administradores pueden crear memorias.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cuerpo de la petición inválido' }) };
  }

  const { number, title, place, author, collective, image, description, body } = payload;
  const textFields = { title, place, author, collective, image, description, body };
  const maxLengths = { title: 180, place: 180, author: 180, collective: 240, image: 180, description: 1000, body: 100000 };

  if (!Number.isInteger(number) || number < 1 || number > 999999) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'El número debe ser un entero positivo.' }) };
  }
  if (!title || !place || !image) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos obligatorios: título, lugar e imagen.' }) };
  }
  for (const [field, value] of Object.entries(textFields)) {
    if (value !== undefined && value !== null && String(value).length > maxLengths[field as keyof typeof maxLengths]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `El campo ${field} excede su longitud máxima.` }) };
    }
  }
  if (!/^\/images\/[a-z0-9][a-z0-9_./-]*\.(?:avif|gif|jpe?g|png|webp)$/i.test(String(image).trim())) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La imagen debe ser una ruta pública válida dentro de /images/.' }) };
  }

  const safeTitle = String(title).trim();
  const yamlString = (value: unknown) => JSON.stringify(String(value ?? '').trim());
  const slug = safeTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const fileName = `${number}-${slug || 'memoria'}.md`;
  const filePath = `src/content/memorias/${fileName}`;

  const frontmatter = [
    '---',
    `number: ${number}`,
    `title: ${yamlString(safeTitle)}`,
    `place: ${yamlString(place)}`,
    `author: ${yamlString(author)}`,
    `collective: ${yamlString(collective)}`,
    `image: ${yamlString(image)}`,
    `description: ${yamlString(description)}`, 
    '---',
    '',
    String(body || '').trim(),
  ].join('\n');

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'Noisk8/simposio-memorias-participativas';
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
        message: `Crear memoria desde el frontend: ${safeTitle}`,
        content,
        branch,
      }),
    });

    if (!response.ok) {
      console.error('[create-memoria] GitHub API error:', response.status);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No se pudo guardar la memoria.' }) };
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
