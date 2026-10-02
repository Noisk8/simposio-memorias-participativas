import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const errors = [];
const canonicalOwners = new Map();

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function content(html, pattern) {
  return html.match(pattern)?.[1]?.trim() || '';
}

for (const file of walk(dist).filter((target) => target.endsWith('.html'))) {
  const relative = path.relative(dist, file);
  const html = fs.readFileSync(file, 'utf8');
  const robots = content(html, /<meta\s+name="robots"\s+content="([^"]*)"/i);
  const redirect = /<meta\s+http-equiv="refresh"/i.test(html);
  if (redirect || robots.includes('noindex')) continue;

  const title = content(html, /<title>([^<]+)<\/title>/i);
  const description = content(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
  const canonical = content(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
  const ogTitle = content(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i);
  const ogDescription = content(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i);
  const ogImage = content(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
  const ogType = content(html, /<meta\s+property="og:type"\s+content="([^"]*)"/i);

  if (!title) errors.push(`${relative}: falta title.`);
  if (!description) errors.push(`${relative}: falta una meta description.`);
  if (!canonical) errors.push(`${relative}: falta canonical.`);
  if (!ogTitle || !ogDescription || !ogImage || !ogType) {
    errors.push(`${relative}: Open Graph está incompleto.`);
  }
  if (canonical) {
    const owner = canonicalOwners.get(canonical);
    if (owner) errors.push(`${relative} y ${owner} comparten canonical ${canonical}.`);
    else canonicalOwners.set(canonical, relative);
  }
  if (ogType === 'article') {
    const author = content(html, /<meta\s+name="author"\s+content="([^"]*)"/i);
    const articleAuthor = content(html, /<meta\s+property="article:author"\s+content="([^"]*)"/i);
    if (!author || !articleAuthor) errors.push(`${relative}: el artículo no declara autoría.`);
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`✖ ${error}`));
  console.error(`\n✖ ${errors.length} problema(s) SEO bloquean el build.`);
  process.exitCode = 1;
} else {
  console.log(`✓ SEO completo y ${canonicalOwners.size} canonical(s) únicos.`);
}
