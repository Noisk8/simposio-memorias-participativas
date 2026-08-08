import { getCorsHeaders, checkRateLimit, errorResponse } from '../security';
import { slugify } from '../../shared/lib.mjs';
import { memoriaCreateInputSchema } from '../../shared/content-model/memoria.ts';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import {
  ConfigurationError,
  GitHubError,
  RateLimitError,
  ValidationError,
  AppError,
} from '../../shared/observability/errors.ts';

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }

    const auth = await requirePermission(event, 'memoria.create');
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'POST, OPTIONS', requestId);

    const limit = checkRateLimit('write', `memoria:${auth.user.id}`);
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      throw new ValidationError('Cuerpo de la petición inválido.');
    }

    const parsed = memoriaCreateInputSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError('Los datos de la memoria no son válidos.', {
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const { number, title, place, author, collective, image, description, body } = parsed.data;

    const safeTitle = String(title).trim();
    const yamlString = (value: unknown) => JSON.stringify(String(value ?? '').trim());
    const slug = slugify(safeTitle);

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

    if (!githubToken) throw new ConfigurationError('GITHUB_TOKEN no está configurado.');

    const content = Buffer.from(frontmatter).toString('base64');
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `Crear memoria desde el frontend: ${safeTitle}`,
        content,
        branch,
      }),
    });

    if (!response.ok) {
      await recordAudit({
        requestId,
        actorId: auth.user.id,
        action: 'memoria.create',
        resourceType: 'memoria',
        result: 'failure',
        metadata: { number, filePath, githubStatus: response.status },
      });
      throw new GitHubError();
    }

    const data = await response.json();

    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'memoria.create',
      resourceType: 'memoria',
      result: 'success',
      metadata: { number, title: safeTitle, filePath, commitSha: data.commit?.sha || null },
    });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        ok: true,
        file: filePath,
        commit: data.commit?.sha,
        requestId,
      }),
    };
  } catch (error: unknown) {
    return errorResponse(error, headers, requestId);
  }
};
