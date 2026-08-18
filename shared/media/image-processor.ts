import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { ConfigurationError, ValidationError } from '../observability/errors.ts';
import {
  getMediaValidationPolicy,
  inspectMediaBytes,
  normalizedExtension,
  validateMediaFilename,
  type MediaValidationPolicy,
} from './validation.ts';

type Environment = Record<string, string | undefined>;

function configuredInteger(
  env: Environment,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${key} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

export function getImageOutputPolicy(env: Environment = process.env) {
  return {
    maxWidth: configuredInteger(env, 'CMS_IMAGE_OUTPUT_MAX_WIDTH', 2560, 320, 8000),
    maxHeight: configuredInteger(env, 'CMS_IMAGE_OUTPUT_MAX_HEIGHT', 2560, 320, 8000),
    quality: configuredInteger(env, 'CMS_IMAGE_WEBP_QUALITY', 82, 40, 100),
  };
}

export async function optimizeImageUpload(input: {
  name: string;
  declaredMimeType: unknown;
  bytes: Buffer;
  policy?: MediaValidationPolicy;
  outputPolicy?: ReturnType<typeof getImageOutputPolicy>;
}) {
  const policy = input.policy || getMediaValidationPolicy();
  const outputPolicy = input.outputPolicy || getImageOutputPolicy();
  const originalSafeSlug = validateMediaFilename(input.name);
  const type = inspectMediaBytes(originalSafeSlug, input.bytes);
  if (type.kind !== 'image') throw new ValidationError('El archivo no es una imagen permitida.');
  if (!input.bytes.length || input.bytes.length > policy.maxBytes) {
    throw new ValidationError(`La imagen debe pesar entre 1 byte y ${policy.maxBytes} bytes.`);
  }
  if (
    typeof input.declaredMimeType !== 'string' ||
    !policy.allowedImageMimeTypes.includes(input.declaredMimeType.toLowerCase())
  ) {
    throw new ValidationError('El MIME declarado de la imagen no está permitido.');
  }

  try {
    const pipeline = sharp(input.bytes, {
      failOn: 'error',
      limitInputPixels: policy.maxPixels,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height || !metadata.format)
      throw new Error('Metadata ausente');
    if ((metadata.pages || 1) > 1) throw new ValidationError('No se permiten imágenes animadas.');
    if (metadata.width > policy.maxWidth || metadata.height > policy.maxHeight) {
      throw new ValidationError(
        `La imagen supera las dimensiones máximas de ${policy.maxWidth}×${policy.maxHeight}.`
      );
    }
    if (metadata.width * metadata.height > policy.maxPixels) {
      throw new ValidationError(`La imagen supera el máximo de ${policy.maxPixels} píxeles.`);
    }
    const expectedFormat =
      normalizedExtension(originalSafeSlug) === 'jpg'
        ? 'jpeg'
        : normalizedExtension(originalSafeSlug);
    if (metadata.format !== expectedFormat) {
      throw new ValidationError('El formato decodificado no coincide con la extensión.');
    }
    if (input.declaredMimeType.toLowerCase() !== type.mimeType) {
      throw new ValidationError('El MIME declarado no coincide con el formato real de la imagen.');
    }

    const optimized = await pipeline
      .rotate()
      .resize({
        width: outputPolicy.maxWidth,
        height: outputPolicy.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: outputPolicy.quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (!optimized.data.length || optimized.data.length > policy.maxBytes) {
      throw new ValidationError('La imagen optimizada supera el límite de almacenamiento.');
    }

    const stem = originalSafeSlug.slice(0, -(normalizedExtension(originalSafeSlug).length + 1));
    return {
      bytes: optimized.data,
      safeSlug: `${stem}.webp`,
      extension: 'webp',
      mimeType: 'image/webp',
      kind: 'image' as const,
      directory: 'images' as const,
      width: optimized.info.width,
      height: optimized.info.height,
      format: 'webp',
      originalBytes: input.bytes.length,
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('La imagen está corrupta o excede los límites de procesamiento.');
  }
}
