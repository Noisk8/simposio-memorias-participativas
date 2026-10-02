import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Ejecutar con: node --env-file=.env scripts/test-garage-storage.mjs
// Solo escribe y elimina objetos propios bajo connectivity-tests/<uuid>/.
const required = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_BACKUP_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_BASE_URL',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Falta ${name}.`);
}
const endpoint = new URL(process.env.S3_ENDPOINT);
const publicBase = new URL(process.env.S3_PUBLIC_BASE_URL);
if (endpoint.protocol !== 'https:' || publicBase.protocol !== 'https:') {
  throw new Error('Los endpoints deben usar HTTPS.');
}
if (process.env.S3_FORCE_PATH_STYLE !== 'true') {
  throw new Error('Esta prueba requiere S3_FORCE_PATH_STYLE=true.');
}
const directory = await mkdtemp(path.join(tmpdir(), 'garage-test-'));
const prefix = `connectivity-tests/${randomUUID()}`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => JSON.stringify(value);
const samples = [
  {
    name: 'image.png',
    type: 'image/png',
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=',
      'base64'
    ),
  },
  {
    name: 'content.md',
    type: 'text/markdown',
    bytes: Buffer.from(
      '# Prueba de almacenamiento\n\nContenido temporal de Memorias Participativas.\n'
    ),
  },
];

async function request(method, url, sample, authenticated = true) {
  const output = path.join(directory, 'response');
  const config = [
    `url = ${quote(url)}`,
    `request = ${quote(method)}`,
    'silent',
    'show-error',
    'connect-timeout = 10',
    'max-time = 30',
    `output = ${quote(output)}`,
    'write-out = "%{http_code}"',
  ];
  if (authenticated) {
    config.push(
      `aws-sigv4 = ${quote(`aws:amz:${process.env.S3_REGION}:s3`)}`,
      `user = ${quote(`${process.env.S3_ACCESS_KEY_ID}:${process.env.S3_SECRET_ACCESS_KEY}`)}`
    );
  }
  if (sample) {
    const input = path.join(directory, sample.name);
    await writeFile(input, sample.bytes);
    config.push(
      `upload-file = ${quote(input)}`,
      `header = ${quote(`Content-Type: ${sample.type}`)}`,
      `header = ${quote(`x-amz-content-sha256: ${digest(sample.bytes)}`)}`
    );
  }
  // Las credenciales viajan por stdin, nunca como argumentos ni en los logs.
  const result = spawnSync('curl', ['--config', '-'], {
    input: config.join('\n'),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Fallo de conexión curl (${result.status}).`);
  const status = Number(result.stdout);
  const bytes = await readFile(output);
  if (status < 200 || status >= 300) {
    const code = bytes.toString().match(/<Code>([^<]+)<\/Code>/)?.[1] || 'sin código S3';
    throw new Error(`${method}: HTTP ${status} (${code}).`);
  }
  return bytes;
}

let failures = 0;
try {
  for (const bucket of new Set([process.env.S3_BUCKET, process.env.S3_BACKUP_BUCKET])) {
    for (const sample of samples) {
      const key = `${prefix}/${sample.name}`;
      const url = `${endpoint.href.replace(/\/$/, '')}/${encodeURIComponent(bucket)}/${key}`;
      let attempted = false;
      try {
        attempted = true;
        await request('PUT', url, sample);
        const downloaded = await request('GET', url);
        if (digest(downloaded) !== digest(sample.bytes)) throw new Error('Checksum distinto.');
        console.log(`OK ${bucket}/${sample.name}: subida y descarga con SHA-256 idéntico.`);
        if (bucket === process.env.S3_BUCKET) {
          const publicBytes = await request(
            'GET',
            `${publicBase.href.replace(/\/$/, '')}/${key}`,
            null,
            false
          );
          if (digest(publicBytes) !== digest(sample.bytes))
            throw new Error('URL pública devuelve otro contenido.');
          console.log(`OK ${bucket}/${sample.name}: lectura pública verificada.`);
        }
      } catch (error) {
        failures++;
        console.error(`ERROR ${bucket}/${sample.name}: ${error.message}`);
      } finally {
        if (attempted) {
          try {
            await request('DELETE', url);
            console.log(`OK limpieza ${bucket}/${key}`);
          } catch (error) {
            failures++;
            console.error(`ERROR limpieza ${bucket}/${key}: ${error.message}`);
          }
        }
      }
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;
