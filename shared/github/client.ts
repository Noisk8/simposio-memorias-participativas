import { Buffer } from 'node:buffer';
import { ConflictError, GitHubError } from '../observability/errors.ts';
import { getGitHubCredential, getInstallationToken } from './auth.ts';
import { getGitHubConfiguration } from './config.ts';

type RequestOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
};

function repositoryRoute(route: string): string {
  const config = getGitHubConfiguration();
  return `/repos/${config.owner}/${config.repo}${route.startsWith('/') ? route : `/${route}`}`;
}

export async function getGitHubClient() {
  const credential = await getGitHubCredential();
  return {
    mechanism: credential.mechanism,
    request: async (route: string, options: RequestOptions = {}) => {
      const query = new globalThis.URLSearchParams();
      for (const [key, value] of Object.entries(options.query || {})) {
        if (value !== undefined) query.set(key, String(value));
      }
      const url = `https://api.github.com${route}${query.size ? `?${query}` : ''}`;
      return fetch(url, {
        method: options.method,
        body: options.body,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Simposio-CMS',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
      });
    },
  };
}

export async function githubRequest(route: string, options: RequestOptions = {}) {
  return (await getGitHubClient()).request(route, options);
}

export async function readContent(filePath: string, ref = getGitHubConfiguration().branch) {
  return githubRequest(repositoryRoute(`/contents/${filePath}`), { query: { ref } });
}

export async function createContent(input: {
  path: string;
  content: string;
  message: string;
  branch?: string;
}) {
  return githubRequest(repositoryRoute(`/contents/${input.path}`), {
    method: 'PUT',
    body: JSON.stringify({
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      branch: input.branch || getGitHubConfiguration().branch,
    }),
  });
}

export async function updateContent(input: {
  path: string;
  content: string;
  message: string;
  sha: string;
  branch?: string;
}) {
  return githubRequest(repositoryRoute(`/contents/${input.path}`), {
    method: 'PUT',
    body: JSON.stringify({
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      sha: input.sha,
      branch: input.branch || getGitHubConfiguration().branch,
    }),
  });
}

export async function deleteContent(input: {
  path: string;
  sha: string;
  message: string;
  branch?: string;
}) {
  return githubRequest(repositoryRoute(`/contents/${input.path}`), {
    method: 'DELETE',
    body: JSON.stringify({
      message: input.message,
      sha: input.sha,
      branch: input.branch || getGitHubConfiguration().branch,
    }),
  });
}

export async function getBranchHeadSha(branch = getGitHubConfiguration().branch): Promise<string> {
  const response = await githubRequest(
    repositoryRoute(`/git/ref/heads/${encodeURIComponent(branch)}`)
  );
  if (!response.ok)
    throw new GitHubError('No se pudo leer la rama base.', { status: response.status });
  const result: any = await response.json();
  return result.object.sha;
}

export async function createBranch(branch: string, fromSha: string) {
  const response = await githubRequest(repositoryRoute('/git/refs'), {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (response.status !== 422) return response;
  const existing = await githubRequest(
    repositoryRoute(`/git/ref/heads/${encodeURIComponent(branch)}`)
  );
  if (!existing.ok) return response;
  return existing;
}

export async function createPullRequest(input: {
  head: string;
  title: string;
  body: string;
  base?: string;
}) {
  return githubRequest(repositoryRoute('/pulls'), {
    method: 'POST',
    body: JSON.stringify({
      head: input.head,
      base: input.base || getGitHubConfiguration().branch,
      title: input.title,
      body: input.body,
      draft: false,
    }),
  });
}

export async function findOpenPullRequest(head: string) {
  const config = getGitHubConfiguration();
  const response = await githubRequest(repositoryRoute('/pulls'), {
    query: { state: 'open', head: `${config.owner}:${head}`, base: config.branch, per_page: 10 },
  });
  if (!response.ok) return null;
  const pulls: any[] = await response.json();
  return pulls[0] || null;
}

export async function getPullRequest(number: number) {
  return githubRequest(repositoryRoute(`/pulls/${number}`));
}

export async function closePullRequest(number: number) {
  return githubRequest(repositoryRoute(`/pulls/${number}`), {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  });
}

export async function getCommitVerification(sha: string) {
  const [statusResponse, checksResponse] = await Promise.all([
    githubRequest(repositoryRoute(`/commits/${sha}/status`)),
    githubRequest(repositoryRoute(`/commits/${sha}/check-runs`)),
  ]);
  if (!statusResponse.ok || !checksResponse.ok) {
    throw new GitHubError('No se pudieron comprobar los checks del Pull Request.', {
      status: !statusResponse.ok ? statusResponse.status : checksResponse.status,
    });
  }
  const status: any = await statusResponse.json();
  const checks: any = await checksResponse.json();
  const runs = checks.check_runs || [];
  const statuses = status.statuses || [];
  const completed = runs.every((run: any) => run.status === 'completed');
  const accepted = runs.every((run: any) =>
    ['success', 'neutral', 'skipped'].includes(run.conclusion)
  );
  return {
    success:
      statuses.length + runs.length > 0 &&
      (statuses.length === 0 || status.state === 'success') &&
      (runs.length === 0 || (completed && accepted)),
    status: status.state,
    checks: runs,
  };
}

export async function mergePullRequest(input: {
  number: number;
  expectedHeadSha: string;
  method?: 'merge' | 'squash' | 'rebase';
}) {
  const verification = await getCommitVerification(input.expectedHeadSha);
  if (!verification.success) {
    throw new ConflictError(
      'El Pull Request no puede fusionarse hasta que todos los checks pasen.'
    );
  }
  return githubRequest(repositoryRoute(`/pulls/${input.number}/merge`), {
    method: 'PUT',
    body: JSON.stringify({
      sha: input.expectedHeadSha,
      merge_method: input.method || 'squash',
    }),
  });
}

export { getInstallationToken };
