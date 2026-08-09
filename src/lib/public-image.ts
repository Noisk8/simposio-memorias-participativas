import { existsSync } from 'node:fs';
import path from 'node:path';

const githubRepo = String(
  import.meta.env.GITHUB_REPO || 'Noisk8/simposio-memorias-participativas'
).replace(/\.git$/i, '');
const githubBranch = String(import.meta.env.GITHUB_BRANCH || 'main').trim() || 'main';
const githubImageBase = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/public`;

export function resolvePublicImageUrl(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:https?:\/\/|data:|blob:)/i.test(raw)) return raw;
  if (!raw.startsWith('/')) return raw;
  if (existsSync(path.join(process.cwd(), 'public', raw))) return raw;
  return githubImageBase + raw;
}
