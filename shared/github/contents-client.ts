import { getGitHubConfiguration } from './config.ts';

export async function githubContentsRequest(filePath: string, init: any = {}) {
  const config = getGitHubConfiguration();
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}`;
  const hasMethod = Boolean(init.method);
  return fetch(hasMethod ? url : `${url}?ref=${encodeURIComponent(config.branch)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Simposio-CMS',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

export async function githubSearchCode(query: string, perPage = 5) {
  const config = getGitHubConfiguration();
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Simposio-CMS',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}
