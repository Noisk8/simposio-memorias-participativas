import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const errors = [];
const imageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.ico',
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function actualImageType(buffer) {
  const ascii = buffer.subarray(0, 16).toString('ascii');
  const text = buffer.subarray(0, 512).toString('utf8').trimStart();
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return '.jpg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return '.gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return '.webp';
  if (ascii.slice(4, 12).includes('ftypavif') || ascii.slice(4, 12).includes('ftypavis'))
    return '.avif';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return '.ico';
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)) return '.svg';
  return null;
}

for (const file of walk(publicRoot)) {
  const extension = path.extname(file).toLowerCase();
  if (!imageExtensions.has(extension)) continue;
  const actual = actualImageType(fs.readFileSync(file));
  const expected = extension === '.jpeg' ? '.jpg' : extension;
  if (!actual) errors.push(`${path.relative(root, file)} no contiene una imagen reconocible.`);
  else if (actual !== expected) {
    errors.push(`${path.relative(root, file)} declara ${extension}, pero contiene ${actual}.`);
  }
}

const sourceExtensions = new Set([
  '.astro',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
]);
const sourceRoots = ['src', 'shared', 'public'].map((directory) => path.join(root, directory));
const localAssetPattern = /["'(]((?:\/)[^"'()\s?#]+\.(?:avif|gif|ico|jpe?g|png|svg|webp))/gi;

for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    if (!sourceExtensions.has(path.extname(file).toLowerCase())) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(localAssetPattern)) {
      const publicPath = decodeURIComponent(match[1]);
      const target = path.join(publicRoot, publicPath.replace(/^\/+/, ''));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(`${path.relative(root, file)} referencia un asset inexistente: ${publicPath}`);
      }
    }
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`✖ ${error}`));
  console.error(`\n✖ ${errors.length} problema(s) de assets bloquean el build.`);
  process.exitCode = 1;
} else {
  console.log('✓ Assets locales existentes y con formato coherente.');
}
