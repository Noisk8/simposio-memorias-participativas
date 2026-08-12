import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import {
  assertImageSignature,
  detectedImageType,
  getMediaValidationPolicy,
  inspectMediaBytes,
  validateEditorialMetadata,
  validateImageUpload,
  validateMediaFilename,
  validateOriginalFilename,
} from '../shared/media/validation.ts';
import { legacyReferences } from '../scripts/migrate-media-to-storage.mjs';

const policy = getMediaValidationPolicy({});

async function png(width = 20, height = 10) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 80, b: 140 } },
  })
    .png()
    .toBuffer();
}

test('solo detecta firmas binarias de JPEG, PNG y WebP como imágenes permitidas', () => {
  assert.equal(detectedImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'jpeg');
  assert.equal(
    detectedImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'png'
  );
  assert.equal(detectedImageType(Buffer.from('GIF89a')), null);
  assert.throws(() => validateMediaFilename('vector.svg'), /no está permitido/);
  assert.throws(() => validateMediaFilename('audio.mp3'), /no está permitido/);
  assert.throws(() => validateMediaFilename('video.mp4'), /no está permitido/);
  assert.equal(policy.maxBytes, 2 * 1024 * 1024);
});

test('rechaza MIME declarado falso aunque los bytes y la extensión sean válidos', async () => {
  await assert.rejects(
    validateImageUpload({
      name: 'foto.png',
      declaredMimeType: 'image/jpeg',
      bytes: await png(),
      policy,
    }),
    /MIME declarado no coincide/
  );
});

test('rechaza extensión falsa aunque el MIME declarado sea correcto', async () => {
  await assert.rejects(
    validateImageUpload({
      name: 'foto.jpg',
      declaredMimeType: 'image/png',
      bytes: await png(),
      policy,
    }),
    /no coincide con su extensión/
  );
});

test('rechaza archivo que supera el peso configurable', async () => {
  const bytes = await png();
  await assert.rejects(
    validateImageUpload({
      name: 'foto.png',
      declaredMimeType: 'image/png',
      bytes,
      policy: { ...policy, maxBytes: bytes.length - 1 },
    }),
    /debe pesar/
  );
});

test('rechaza ancho, alto o número de píxeles excesivos', async () => {
  const bytes = await png(20, 10);
  await assert.rejects(
    validateImageUpload({
      name: 'foto.png',
      declaredMimeType: 'image/png',
      bytes,
      policy: { ...policy, maxWidth: 19 },
    }),
    /dimensiones máximas/
  );
  await assert.rejects(
    validateImageUpload({
      name: 'foto.png',
      declaredMimeType: 'image/png',
      bytes,
      policy: { ...policy, maxPixels: 199 },
    }),
    /excede los límites|máximo de 199 píxeles/
  );
});

test('rechaza alt faltante salvo declaración decorativa explícita', () => {
  assert.throws(
    () =>
      validateEditorialMetadata(
        { decorative: false, altText: '', credit: 'Archivo', license: 'CC BY 4.0' },
        'image'
      ),
    /texto alternativo.*obligatorio/i
  );
  assert.deepEqual(
    validateEditorialMetadata(
      { decorative: true, altText: '', credit: 'Archivo', license: 'CC BY 4.0' },
      'image'
    ).altText,
    null
  );
});

test('rechaza licencia o crédito faltantes', () => {
  assert.throws(
    () =>
      validateEditorialMetadata(
        { decorative: false, altText: 'Una plaza', credit: 'Archivo', license: '' },
        'image'
      ),
    /licencia.*obligatorio/i
  );
  assert.throws(
    () =>
      validateEditorialMetadata(
        { decorative: false, altText: 'Una plaza', credit: '', license: 'CC0' },
        'image'
      ),
    /crédito.*obligatorio/i
  );
});

test('rechaza filename peligroso y conserva un slug seguro separado del original', () => {
  assert.throws(() => validateOriginalFilename('../../ataque.png'), /peligrosos/);
  assert.throws(() => validateOriginalFilename('.secreto.jpg'), /peligrosos/);
  assert.equal(validateOriginalFilename('Crédito final 2026.PNG'), 'Crédito final 2026.PNG');
  assert.equal(validateMediaFilename('Crédito final 2026.PNG'), 'credito-final-2026.png');
});

test('acepta una imagen válida y extrae formato, MIME y dimensiones con sharp', async () => {
  const result = await validateImageUpload({
    name: 'Foto editorial.png',
    declaredMimeType: 'image/png',
    bytes: await png(20, 10),
    policy,
  });
  assert.deepEqual(
    {
      format: result.format,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    },
    { format: 'png', mimeType: 'image/png', width: 20, height: 10 }
  );
  assert.deepEqual(
    validateEditorialMetadata(
      {
        decorative: false,
        altText: 'Vista de una plaza',
        credit: 'Archivo del Simposio',
        license: 'CC BY-SA 4.0',
      },
      'image'
    ),
    {
      altText: 'Vista de una plaza',
      credit: 'Archivo del Simposio',
      author: null,
      license: 'CC BY-SA 4.0',
      decorative: false,
    }
  );
});

test('solo conserva PDF como documento permitido', () => {
  assert.equal(
    inspectMediaBytes('informe.pdf', Buffer.from('%PDF-1.7')).mimeType,
    'application/pdf'
  );
  assert.throws(
    () => inspectMediaBytes('audio.mp3', Buffer.from('ID3contenido')),
    /no está permitido/
  );
  assert.throws(() => assertImageSignature('ataque.png', Buffer.from('<script>')), /no coincide/);
});

test('detecta referencias legacy sin confundir URLs completas de Storage', () => {
  assert.deepEqual(
    legacyReferences(
      "image: '/images/foto-1.jpg'\n![otra](/documents/programa.pdf)\n/images/foto-1.jpg"
    ),
    ['/documents/programa.pdf', '/images/foto-1.jpg']
  );
  assert.deepEqual(
    legacyReferences(
      "image: 'https://project.supabase.co/storage/v1/object/public/cms-media/images/2026/08/hash-foto.jpg'"
    ),
    []
  );
});
