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
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo los administradores pueden crear colecciones.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cuerpo de la petición inválido' }) };
  }

  const { name, label, folder, slug, fields } = payload;

  if (!name || !label || !folder || !slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos obligatorios.' }) };
  }

  const safeName = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const safeLabel = String(label).trim();
  const safeFolder = String(folder).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const safeSlug = String(slug).trim();
  const rawFields = String(fields || '').trim();
  const invalidFields = /(^|\n)\s*(?:collections|backend|publish_mode|local_backend|export|import)\s*:/i.test(rawFields);

  if (!safeName || safeName.length > 64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'El nombre interno no es válido.' }) };
  }
  if (!safeLabel || safeLabel.length > 120 || /[\r\n]/.test(safeLabel)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La etiqueta visible no es válida.' }) };
  }
  if (!/^src\/content\/[a-z0-9-]+$/i.test(safeFolder) || safeFolder !== `src/content/${safeName}`) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La carpeta debe corresponder a src/content/<nombre>.' }) };
  }
  if (!safeSlug || safeSlug.length > 120 || /[\r\n]/.test(safeSlug)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'El patrón de slug no es válido.' }) };
  }
  if (rawFields.length > 12000 || invalidFields) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'La definición de campos no es válida.' }) };
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'Noisk8/test-simposio-memorias-participativas';
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!githubToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GITHUB_TOKEN no está configurado.' }) };
  }

  const apiBase = `https://api.github.com/repos/${repo}`;
  const apiHeaders = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function getFile(path: string) {
    const res = await fetch(`${apiBase}/contents/${path}?ref=${branch}`, { headers: apiHeaders });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Error leyendo ${path}: ${res.status}`);
    return res.json();
  }

  async function putFile(path: string, content: string, message: string, sha?: string) {
    const body: any = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${apiBase}/contents/${path}`, {
      method: 'PUT',
      headers: apiHeaders,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error escribiendo ${path}: ${res.status} ${text}`);
    }

    return res.json();
  }

  try {
    // 1. Leer config.yml
    const configPath = 'public/admin/config.yml';
    const configFile = await getFile(configPath);
    const configContent = configFile ? Buffer.from(configFile.content, 'base64').toString('utf-8') : '';

    // 2. Verificar que la colección no exista
    const existingRegex = new RegExp('name:\\s*["\']?' + safeName + '["\']?', 'i');
    if (existingRegex.test(configContent)) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'La colección ya existe en config.yml.' }) };
    }

    // Re-indentar los campos para que queden anidados bajo la colección (4 espacios).
    const indentedFields = String(fields || '')
      .trim()
      .split('\n')
      .map((line: string) => '    ' + line.replace(/\r$/, ''))
      .join('\n');

    const newCollectionYaml = `
collections:
  - name: "${safeName}"
    label: ${JSON.stringify(safeLabel)}
    folder: ${JSON.stringify(safeFolder)}
    create: true
    slug: ${JSON.stringify(safeSlug)}
${indentedFields}
`;

    // Si ya existe la sección collections, eliminamos el duplicado del encabezado.
    const configAppend = configContent.includes('collections:')
      ? newCollectionYaml.replace('collections:\n', '')
      : newCollectionYaml;

    const newConfigContent = configContent.trimEnd() + '\n' + configAppend;

    // 3. Leer y modificar content.config.ts
    const contentConfigPath = 'src/content.config.ts';
    const contentConfigFile = await getFile(contentConfigPath);
    if (!contentConfigFile) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se encontró src/content.config.ts.' }) };
    }

    const contentConfigContent = Buffer.from(contentConfigFile.content, 'base64').toString('utf-8');
    const exportRegex = /export const collections = \{([^}]+)\};/;
    const match = contentConfigContent.match(exportRegex);

    if (!match) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo parsear src/content.config.ts.' }) };
    }

    const currentCollections = match[1].trim();
    const newCollections = currentCollections + `, ${safeName}`;

    const newCollectionTs = `const ${safeName} = defineCollection({
  loader: glob({ pattern: '*.md', base: './${safeFolder}' }),
  schema: z.object({
    simposio: z.string().default('2026'),
    title: z.string(),
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});

`;

    const newContentConfig = contentConfigContent.replace(
      exportRegex,
      newCollectionTs + `export const collections = { ${newCollections} };`
    );

    // 4. Crear archivo de ejemplo en la nueva carpeta
    const sampleFilePath = `${safeFolder.replace(/^src\//, '')}/ejemplo.md`.replace(/\/+/g, '/');
    const sampleContent = `---
title: "Ejemplo de ${label}"
image: ""
description: ""
---

Contenido de ejemplo.
`;

    // 5. Commit de los cambios
    const message = `Crear colección ${safeName} desde el frontend`;

    await putFile(configPath, newConfigContent, message, configFile?.sha);
    await putFile(contentConfigPath, newContentConfig, message, contentConfigFile?.sha);
    await putFile(sampleFilePath, sampleContent, message);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        collection: safeName,
        files: [configPath, contentConfigPath, sampleFilePath],
      }),
    };
  } catch (error: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
