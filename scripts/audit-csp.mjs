import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || 'dist');
const failures = [];

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(target) : entry.name.endsWith('.html') ? [target] : [];
  });
}

function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
    .filter(([, attributes]) => {
      const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      return !type || /^(?:module|importmap|(?:text|application)\/(?:java|ecma)script)$/.test(type);
    })
    .map(
      ([, , content]) => `sha256-${crypto.createHash('sha256').update(content).digest('base64')}`
    );
}

for (const file of htmlFiles(root)) {
  const html = fs.readFileSync(file, 'utf8');
  const tag = html.match(/<meta\s+[^>]*http-equiv="content-security-policy"[^>]*>/i)?.[0];
  const match = tag?.match(/content="([^"]*)"/i);
  const relative = path.relative(root, file);
  if (!match) {
    if (/<meta\s+[^>]*http-equiv="refresh"/i.test(html)) continue;
    failures.push(`${relative}: falta la CSP generada por Astro`);
    continue;
  }
  const policy = match[1];
  if (/unsafe-inline|unsafe-eval/i.test(policy)) failures.push(`${relative}: CSP insegura`);
  for (const hash of inlineScriptHashes(html)) {
    if (!policy.includes(`'${hash}'`)) {
      failures.push(`${relative}: script inline sin hash CSP (${hash})`);
    }
  }
  for (const directive of ["object-src 'none'", 'base-uri', 'form-action']) {
    if (!policy.includes(directive)) failures.push(`${relative}: falta ${directive}`);
  }
  const isAdminPage = relative.split(path.sep).includes('admin');
  if (isAdminPage && !policy.includes("connect-src 'self' https://*.supabase.co")) {
    failures.push(`${relative}: la CSP no permite conectar con Supabase Auth`);
  }
  if (!isAdminPage && policy.includes('supabase.co')) {
    failures.push(`${relative}: una página pública permite conexiones innecesarias a Supabase`);
  }
}

if (failures.length) {
  console.error(`Auditoría CSP fallida:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(
    `CSP segura y todos los scripts inline autorizados por hash en ${htmlFiles(root).length} páginas.`
  );
}
