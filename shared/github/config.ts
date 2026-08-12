import { ConfigurationError } from '../observability/errors.ts';

const DEFAULT_REPOSITORY = 'Noisk8/simposio-memorias-participativas';

export function normalizeGitHubRepository(value: unknown): string {
  return String(value || DEFAULT_REPOSITORY)
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

export function getGitHubConfiguration() {
  const normalized = normalizeGitHubRepository(process.env.GITHUB_REPO);
  const [owner, repo, ...extra] = normalized.split('/');
  if (!owner || !repo || extra.length) {
    throw new ConfigurationError(
      'GITHUB_REPO debe usar el formato propietario/repositorio, por ejemplo Noisk8/simposio-memorias-participativas.'
    );
  }
  return {
    owner,
    repo,
    branch: String(process.env.GITHUB_BRANCH || 'main').trim() || 'main',
  };
}
