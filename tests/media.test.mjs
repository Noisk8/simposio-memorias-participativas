import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { assertImageSignature, detectedImageType } from '../shared/media/validation.ts';

test('detecta firmas binarias de imágenes permitidas', () => {
  assert.equal(detectedImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'jpeg');
  assert.equal(
    detectedImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'png'
  );
  assert.equal(detectedImageType(Buffer.from('GIF89a')), 'gif');
});

test('rechaza archivos disfrazados con extensión de imagen', () => {
  assert.throws(() => assertImageSignature('ataque.png', Buffer.from('<script>')), /no coincide/);
  assert.throws(
    () =>
      assertImageSignature(
        'foto.jpg',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ),
    /no coincide/
  );
});
