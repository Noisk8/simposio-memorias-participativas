import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const baseUrl = String(process.env.SITE_URL || process.argv[2] || '').replace(/\/$/, '');
const concurrency = Number(process.env.CONCURRENCY || 8);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function routeFor(file) {
  let route = `/${path
    .relative(dist, file)
    .replace(/index\.html$/, '')
    .replace(/\\/g, '/')}`;
  if (route === '//') route = '/';
  return route;
}

const IDENTIFIABLE =
  /^\/(?:entradas|categorias|etiquetas|paginas|noticias|museo-memorias|ediciones)/;

async function headStatus(url) {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    return response.status;
  } catch {
    return 0;
  }
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  if (!baseUrl) {
    console.error('✖ Falta la URL base (SITE_URL o primer argumento).');
    process.exitCode = 1;
    return;
  }

  const routes = walk(dist)
    .filter((target) => target.endsWith('.html'))
    .map(routeFor)
    .filter((route) => !route.startsWith('/admin/') && !route.startsWith('/404'))
    .filter((route) => IDENTIFIABLE.test(route));

  console.log(`Verificando ${routes.length} rutas publicadas contra ${baseUrl}...`);
  const statuses = await runPool(routes, concurrency, (route) => headStatus(baseUrl + route));

  let failures = 0;
  routes.forEach((route, i) => {
    const status = statuses[i];
    if (status === 200) {
      console.log(`✓ ${route} -> 200`);
    } else {
      failures++;
      console.error(`✖ ${route} -> HTTP ${status}`);
    }
  });

  if (failures > 0) {
    console.error(`\n✖ ${failures} ruta(s) no responden 200 en producción.`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Todas las rutas publicadas responden 200 (${routes.length} verificadas).`);
  }
}

main();
