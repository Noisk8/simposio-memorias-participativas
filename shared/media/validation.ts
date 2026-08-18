import { Buffer } from 'node:buffer';
import { ConfigurationError, ValidationError } from '../observability/errors.ts';

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type MediaKind = 'image' | 'document';

export type MediaType = {
  extension: string;
  mimeType: string;
  kind: MediaKind;
  directory: 'images' | 'documents';
};

export type MediaValidationPolicy = {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  allowedImageMimeTypes: readonly string[];
};

export type EditorialMetadata = {
  altText: string | null;
  credit: string | null;
  author: string | null;
  license: string | null;
  decorative: boolean | null;
};

type Environment = Record<string, string | undefined>;

const IMAGE_TYPES: Record<string, Omit<MediaType, 'extension'>> = {
  jpg: { mimeType: 'image/jpeg', kind: 'image', directory: 'images' },
  jpeg: { mimeType: 'image/jpeg', kind: 'image', directory: 'images' },
  png: { mimeType: 'image/png', kind: 'image', directory: 'images' },
  webp: { mimeType: 'image/webp', kind: 'image', directory: 'images' },
};

const OTHER_MEDIA_TYPES: Record<string, Omit<MediaType, 'extension'>> = {
  pdf: { mimeType: 'application/pdf', kind: 'document', directory: 'documents' },
};

const MEDIA_TYPES = { ...IMAGE_TYPES, ...OTHER_MEDIA_TYPES };
function configuredInteger(env: Environment, key: string, fallback: number, hardMaximum: number) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > hardMaximum) {
    throw new ConfigurationError(`${key} debe ser un entero entre 1 y ${hardMaximum}.`);
  }
  return parsed;
}

export function getMediaValidationPolicy(env: Environment = process.env): MediaValidationPolicy {
  return {
    maxBytes: MAX_MEDIA_BYTES,
    maxWidth: configuredInteger(env, 'CMS_IMAGE_MAX_WIDTH', 8000, 20_000),
    maxHeight: configuredInteger(env, 'CMS_IMAGE_MAX_HEIGHT', 8000, 20_000),
    maxPixels: configuredInteger(env, 'CMS_IMAGE_MAX_PIXELS', 40_000_000, 100_000_000),
    allowedImageMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
  };
}

export function normalizedExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

export function validateOriginalFilename(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('Nombre de archivo inválido.');
  const filename = value.trim();
  if (
    !filename ||
    filename.length > 255 ||
    filename.startsWith('.') ||
    filename.includes('..') ||
    /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(filename)
  ) {
    throw new ValidationError('El nombre original contiene una ruta o caracteres peligrosos.');
  }
  if (!MEDIA_TYPES[normalizedExtension(filename)]) {
    throw new ValidationError('El tipo de archivo no está permitido.');
  }
  return filename;
}

export function validateMediaFilename(value: unknown): string {
  const original = validateOriginalFilename(value);
  const extension = normalizedExtension(original);
  const stem = original
    .slice(0, -(extension.length + 1))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120 - extension.length);
  if (!stem) throw new ValidationError('Nombre de archivo inválido.');
  return `${stem}.${extension}`;
}

export function detectedImageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function assertImageSignature(name: string, bytes: Buffer) {
  const detected = detectedImageType(bytes);
  const rawExtension = normalizedExtension(name);
  const extension = rawExtension === 'jpg' ? 'jpeg' : rawExtension;
  if (!detected || detected !== extension) {
    throw new ValidationError('El contenido real de la imagen no coincide con su extensión.');
  }
}

export function inspectMediaBytes(name: string, bytes: Buffer): MediaType {
  const extension = normalizedExtension(name);
  const config = MEDIA_TYPES[extension];
  if (!config) throw new ValidationError('El tipo de archivo no está permitido.');

  let valid = false;
  if (config.kind === 'image') {
    valid = detectedImageType(bytes) === (extension === 'jpg' ? 'jpeg' : extension);
  } else if (extension === 'pdf') {
    valid = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  if (!valid) {
    throw new ValidationError('El contenido real del archivo no coincide con su extensión.');
  }
  return { extension, ...config };
}

function textValue(value: unknown, field: string, maximum: number, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field}: campo obligatorio.`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} no es válido.`);
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > maximum) {
    throw new ValidationError(`${field} no es válido.`);
  }
  return normalized || null;
}

export function validateEditorialMetadata(payload: any, kind: MediaKind): EditorialMetadata {
  const author = textValue(payload?.author, 'La autoría', 255);
  if (kind !== 'image') {
    return {
      altText: textValue(payload?.altText, 'El texto alternativo', 500),
      credit: textValue(payload?.credit, 'El crédito', 500),
      author,
      license: textValue(payload?.license, 'La licencia', 255),
      decorative: null,
    };
  }

  if (typeof payload?.decorative !== 'boolean') {
    throw new ValidationError('Debe indicarse explícitamente si la imagen es decorativa.');
  }
  const decorative = payload.decorative;
  const altText = textValue(payload?.altText, 'El texto alternativo', 500, !decorative);
  if (decorative && altText) {
    throw new ValidationError('Una imagen decorativa no debe tener texto alternativo.');
  }
  return {
    altText: decorative ? null : altText,
    credit: textValue(payload?.credit, 'El crédito', 500, true),
    author,
    license: textValue(payload?.license, 'La licencia', 255, true),
    decorative,
  };
}
