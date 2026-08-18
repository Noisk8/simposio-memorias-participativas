import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const failures = [];

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(target) : entry.name.endsWith('.html') ? [target] : [];
  });
}

for (const file of htmlFiles(root)) {
  const route = `/${path
    .relative(root, file)
    .replace(/index\.html$/, '')
    .replace(/\\/g, '/')}`;
  if (route.startsWith('/admin/')) continue;
  const html = fs.readFileSync(file, 'utf8');
  const csp = html.match(/<meta\s+[^>]*http-equiv="content-security-policy"[^>]*>/i)?.[0] || '';
  if (/supabase\.co/i.test(csp)) failures.push(`${route}: la CSP pública permite Supabase`);

  for (const tag of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const opening = tag[0].slice(0, tag[0].indexOf('>') + 1);
    const source = opening.match(/\ssrc="([^"]+)"/i)?.[1];
    const body = tag[1];
    if (/supabaseAuth|signInWithPassword|@supabase\/supabase-js/i.test(body)) {
      failures.push(`${route}: contiene autenticación Supabase inline`);
    }
    if (source?.startsWith('/_astro/')) {
      const asset = path.join(root, source.replace(/^\/+/, ''));
      if (
        fs.existsSync(asset) &&
        /supabaseAuth|signInWithPassword|@supabase\/supabase-js/i.test(
          fs.readFileSync(asset, 'utf8')
        )
      ) {
        failures.push(`${route}: carga el SDK o la sesión de Supabase`);
      }
    }
  }
}

if (failures.length) {
  console.error(`Límite público/admin fallido:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('El sitio público no carga Supabase ni permite conexiones a Supabase.');
