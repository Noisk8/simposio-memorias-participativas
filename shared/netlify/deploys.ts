import { ConfigurationError, InternalError } from '../observability/errors.ts';

export type NetlifyDeploy = {
  id: string;
  state: string;
  context?: string;
  branch?: string;
  commit_ref?: string;
  deploy_ssl_url?: string;
  ssl_url?: string;
  url?: string;
  published_at?: string;
  updated_at?: string;
  error_message?: string;
};

type NetlifyConfiguration = {
  siteId: string;
  token: string;
};

function expectedDeployContext(): string {
  return String(
    process.env.NETLIFY_DEPLOY_CONTEXT ||
      (String(process.env.GITHUB_BRANCH || 'main') === 'main' ? 'production' : 'branch-deploy')
  );
}

function currentRuntimeDeploy(commitSha: string): NetlifyDeploy | null {
  const context = String(process.env.CONTEXT || '');
  const commitRef = String(process.env.COMMIT_REF || '');
  if (context !== expectedDeployContext() || commitRef.toLowerCase() !== commitSha.toLowerCase()) {
    return null;
  }
  return {
    id: String(process.env.DEPLOY_ID || `runtime-${commitRef}`),
    state: 'ready',
    context,
    branch: String(process.env.BRANCH || process.env.GITHUB_BRANCH || ''),
    commit_ref: commitRef,
    deploy_ssl_url: String(process.env.DEPLOY_PRIME_URL || process.env.URL || ''),
    published_at: new Date().toISOString(),
  };
}

export function getNetlifyConfiguration(): NetlifyConfiguration {
  const siteId = String(process.env.NETLIFY_SITE_ID || process.env.SITE_ID || '').trim();
  const token = String(
    process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN || ''
  ).trim();
  if (!siteId || !token) {
    throw new ConfigurationError(
      'NETLIFY_SITE_ID y NETLIFY_API_TOKEN no están configurados para consultar despliegues históricos.'
    );
  }
  return { siteId, token };
}

export function deployForCommit(deploys: NetlifyDeploy[], commitSha: string): NetlifyDeploy | null {
  const expected = String(commitSha || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expected)) return null;
  return (
    deploys
      .filter(
        (deploy) =>
          deploy.context === expectedDeployContext() &&
          (expectedDeployContext() === 'production' ||
            !deploy.branch ||
            deploy.branch === String(process.env.GITHUB_BRANCH || 'staging')) &&
          String(deploy.commit_ref || '')
            .trim()
            .toLowerCase() === expected
      )
      .sort((left, right) =>
        String(right.published_at || right.updated_at || '').localeCompare(
          String(left.published_at || left.updated_at || '')
        )
      )[0] || null
  );
}

export function isDeployFailure(deploy: NetlifyDeploy | null): boolean {
  return Boolean(deploy && ['error', 'failed'].includes(String(deploy.state).toLowerCase()));
}

async function listProductionDeploys(): Promise<NetlifyDeploy[]> {
  const config = getNetlifyConfiguration();
  const response = await fetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.siteId)}/deploys?per_page=50`,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
        'User-Agent': 'Simposio-CMS',
      },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!response.ok) {
    throw new InternalError(`Netlify no pudo confirmar el despliegue (${response.status}).`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

export async function getDeployForCommit(commitSha: string): Promise<NetlifyDeploy | null> {
  const runtime = currentRuntimeDeploy(commitSha);
  if (runtime) return runtime;
  try {
    return deployForCommit(await listProductionDeploys(), commitSha);
  } catch (error) {
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

export async function getLatestProductionDeploy(): Promise<NetlifyDeploy | null> {
  const currentSha = String(process.env.COMMIT_REF || '');
  const runtime = currentSha ? currentRuntimeDeploy(currentSha) : null;
  if (runtime) return runtime;
  let deploys: NetlifyDeploy[];
  try {
    deploys = await listProductionDeploys();
  } catch (error) {
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
  return (
    deploys
      .filter((deploy) => deploy.context === expectedDeployContext())
      .sort((left, right) =>
        String(right.published_at || right.updated_at || '').localeCompare(
          String(left.published_at || left.updated_at || '')
        )
      )[0] || null
  );
}

export function deployPublicUrl(deploy: NetlifyDeploy): string {
  return String(deploy.deploy_ssl_url || deploy.ssl_url || deploy.url || '');
}
