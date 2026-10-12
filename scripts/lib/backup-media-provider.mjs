import { mediaProvider, garagePublicUrl } from '../../shared/media/storage.ts';
import { ConfigurationError } from '../../shared/observability/errors.ts';

// Backup-only aliases are trusted server configuration. Never fetch legacy URLs
// or rewrite the editorial catalog: read the same key from the current provider.
export function backupMediaProvider(row, env = process.env) {
  try {
    return mediaProvider(row, env);
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    const bases = (env.BACKUP_GARAGE_LEGACY_PUBLIC_BASE_URLS || '')
      .split(',')
      .map((base) => base.trim())
      .filter(Boolean);
    for (const base of bases) {
      const legacyEnv = { ...env, S3_PUBLIC_BASE_URL: base };
      if (row.public_url === garagePublicUrl(row.storage_path, legacyEnv)) {
        return mediaProvider(row, legacyEnv);
      }
    }
    throw error;
  }
}
