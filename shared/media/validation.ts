import { Buffer } from 'node:buffer';
import { ValidationError } from '../observability/errors.ts';

export function detectedImageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'webp';
  if (bytes.subarray(4, 12).toString('ascii').includes('ftypavif')) return 'avif';
  return null;
}

export function assertImageSignature(name: string, bytes: Buffer) {
  const detected = detectedImageType(bytes);
  const rawExtension = name.split('.').pop()?.toLowerCase();
  const extension = rawExtension === 'jpg' ? 'jpeg' : rawExtension;
  if (!detected || detected !== extension)
    throw new ValidationError('El contenido real de la imagen no coincide con su extensión.');
}
