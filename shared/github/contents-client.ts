import { getGitHubConfiguration } from './config.ts';
import { githubRequest } from './client.ts';

export async function githubContentsRequest(filePath: string, init: any = {}) {
  const config = getGitHubConfiguration();
  const hasMethod = Boolean(init.method);
  return githubRequest(`/repos/${config.owner}/${config.repo}/contents/${filePath}`, {
    ...init,
    ...(hasMethod ? {} : { query: { ref: config.branch } }),
  });
}

export async function githubSearchCode(query: string, perPage = 5) {
  return githubRequest('/search/code', {
    query: { q: query, per_page: perPage },
  });
}
