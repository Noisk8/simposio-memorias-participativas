import { checksum } from '../../shared/media/storage.ts';

export function verifyBackupMedia(row, data, allowedMissingIds = new Set()) {
  if (data === null) {
    if (allowedMissingIds.has(row.id)) return { missing: true };
    throw new Error(`Falta el archivo ${row.storage_path}.`);
  }
  if (checksum(data) !== row.checksum_sha256)
    throw new Error(`No se pudo verificar ${row.storage_path}.`);
  return { missing: false };
}
