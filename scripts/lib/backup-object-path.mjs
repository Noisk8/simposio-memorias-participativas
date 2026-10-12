export function backupObjectPath(key, size) {
  if (!key || key.startsWith('/') || key.includes('\\'))
    throw new Error('Ruta de objeto no segura.');
  const directoryMarker = key.endsWith('/');
  const relativePath = directoryMarker ? key.slice(0, -1) : key;
  if (relativePath.split('/').some((part) => !part || part === '..' || part === '.'))
    throw new Error('Ruta de objeto no segura.');
  if (directoryMarker && size !== 0) throw new Error('Un marcador de carpeta debe estar vacío.');
  return { relativePath, directoryMarker };
}
