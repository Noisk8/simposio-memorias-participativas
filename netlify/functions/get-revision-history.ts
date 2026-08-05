import { getCorsHeaders, getVerifiedUser, hasRole, isSafeContentPath } from '../security';

export const handler = async (event: any, context: any) => {
  const headers = getCorsHeaders(event, 'GET, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método no permitido.' }),
    };
  }

  const user = getVerifiedUser(context);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Autenticación requerida.' }) };
  }
  if (!hasRole(user, 'admin') && !hasRole(user, 'editor')) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Permisos insuficientes.' }) };
  }

  const params = event.queryStringParameters || {};
  const filePath = params.path;

  if (!isSafeContentPath(filePath)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'La ruta solicitada no es válida.' }),
    };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GITHUB_TOKEN no configurado.' }),
    };
  }

  const repo = process.env.GITHUB_REPO || '';
  const [repoOwner, repoName] = repo.split('/');
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!repoOwner || !repoName) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GITHUB_REPO no está configurado correctamente.' }),
    };
  }

  try {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/commits?path=${encodeURIComponent(filePath)}&sha=${branch}&per_page=30`;

    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Simposio-CMS',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[get-revision-history] GitHub API error:', res.status, errText);
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ error: `Error de GitHub API (${res.status})` }),
      };
    }

    const commits = await res.json();

    const revisions = commits.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name || 'Desconocido',
      email: commit.commit.author?.email || '',
      date: commit.commit.author?.date || '',
      url: commit.html_url,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ revisions }),
    };
  } catch (err: any) {
    console.error('[get-revision-history] Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
