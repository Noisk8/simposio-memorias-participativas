import { createSign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ConfigurationError, GitHubError } from '../observability/errors.ts';
import { getGitHubConfiguration } from './config.ts';

type CachedToken = { token: string; expiresAt: number };
let cachedInstallationToken: CachedToken | null = null;
let loggedMode: string | null = null;

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function normalizeGitHubPrivateKey(value: unknown): string {
  let normalized = String(value || '').trim();
  if (normalized.startsWith('GITHUB_APP_PRIVATE_KEY=')) {
    normalized = normalized.slice('GITHUB_APP_PRIVATE_KEY='.length).trim();
  }
  const quote = normalized.at(0);
  if ((quote === '"' || quote === "'") && normalized.at(-1) === quote) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

export function githubPrivateKeyFromEnvironment(
  pemValue: unknown,
  base64Value: unknown
): string {
  const encoded = String(base64Value || '')
    .trim()
    .replace(/^(["'])|(["'])$/g, '');
  if (!encoded) return normalizeGitHubPrivateKey(pemValue);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new ConfigurationError('GITHUB_APP_PRIVATE_KEY_BASE64 no contiene Base64 válido.');
  }
  try {
    const decoded = normalizeGitHubPrivateKey(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(decoded)) throw new Error('PEM inválido');
    return decoded;
  } catch {
    throw new ConfigurationError('GITHUB_APP_PRIVATE_KEY_BASE64 no contiene Base64 válido.');
  }
}

function appEnvironment() {
  const values = {
    appId: String(process.env.GITHUB_APP_ID || '').trim(),
    installationId: String(process.env.GITHUB_APP_INSTALLATION_ID || '').trim(),
    privateKey: githubPrivateKeyFromEnvironment(
      process.env.GITHUB_APP_PRIVATE_KEY,
      process.env.GITHUB_APP_PRIVATE_KEY_BASE64
    ),
  };
  const configured = Object.values(values).filter(Boolean).length;
  if (configured > 0 && configured < 3) {
    throw new ConfigurationError(
      'La configuración de GitHub App está incompleta: define GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID y GITHUB_APP_PRIVATE_KEY.'
    );
  }
  return configured === 3 ? values : null;
}

function logAuthMode(mode: 'github_app' | 'legacy_token') {
  if (loggedMode === mode) return;
  loggedMode = mode;
  console.info(
    JSON.stringify({
      level: mode === 'legacy_token' ? 'warn' : 'info',
      event: 'github.auth.mode',
      mechanism: mode,
      ...(mode === 'legacy_token' ? { deprecated: true } : {}),
    })
  );
}

export function createGitHubAppJwt(now = new Date()): string {
  const app = appEnvironment();
  if (!app) throw new ConfigurationError('GitHub App no está configurada.');
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: app.appId })
  );
  const unsigned = `${header}.${payload}`;
  try {
    const signature = createSign('RSA-SHA256').update(unsigned).sign(app.privateKey, 'base64url');
    return `${unsigned}.${signature}`;
  } catch {
    throw new ConfigurationError('GITHUB_APP_PRIVATE_KEY no contiene una clave PEM válida.');
  }
}

export async function getInstallationToken(): Promise<string> {
  const app = appEnvironment();
  if (!app) throw new ConfigurationError('GitHub App no está configurada.');
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60_000) {
    return cachedInstallationToken.token;
  }
  const config = getGitHubConfiguration();
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(app.installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createGitHubAppJwt()}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Simposio-CMS',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        repositories: [config.repo],
        permissions: {
          contents: 'write',
          pull_requests: 'write',
          checks: 'read',
          statuses: 'read',
        },
      }),
    }
  );
  if (!response.ok) {
    throw new GitHubError('No se pudo obtener el token de instalación de GitHub App.', {
      status: response.status,
    });
  }
  const result: any = await response.json();
  if (!result.token || !result.expires_at) {
    throw new GitHubError('GitHub devolvió un token de instalación inválido.');
  }
  cachedInstallationToken = {
    token: result.token,
    expiresAt: new Date(result.expires_at).getTime(),
  };
  logAuthMode('github_app');
  return result.token;
}

export async function getGitHubCredential(): Promise<{
  token: string;
  mechanism: 'github_app' | 'legacy_token';
}> {
  if (appEnvironment()) {
    return { token: await getInstallationToken(), mechanism: 'github_app' };
  }
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!token) {
    throw new ConfigurationError(
      'Configura una GitHub App. GITHUB_TOKEN solo se admite temporalmente como fallback obsoleto.'
    );
  }
  logAuthMode('legacy_token');
  return { token, mechanism: 'legacy_token' };
}

export function resetGitHubAuthCacheForTests() {
  cachedInstallationToken = null;
  loggedMode = null;
}
