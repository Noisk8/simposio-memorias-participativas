import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(projectRoot, 'scripts', 'verify-production.mjs');

function makeDist(dir, routes) {
  const dist = path.join(dir, 'dist');
  for (const route of routes) {
    const cleaned = route.replace(/^\//, '');
    const target = cleaned ? path.join(dist, cleaned, 'index.html') : path.join(dist, 'index.html');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '<!doctype html><title>x</title>');
  }
  return dist;
}

function mockServer(routesOk, routes404, onRequest) {
  const server = http.createServer((req, res) => {
    if (onRequest) onRequest(req.url);
    const code = routes404.includes(req.url) ? 404 : routesOk.includes(req.url) ? 200 : 500;
    res.statusCode = code;
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>x</title>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function run(dir, url) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: dir,
      env: { ...process.env, SITE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => out.push(d.toString()));
    child.stderr.on('data', (d) => err.push(d.toString()));
    child.on('close', (code) =>
      resolve({ code, output: (out.join('') + err.join('')).replace(/\x1b\[[0-9;]*m/g, '') })
    );
  });
}

test('verify-production detecta una ruta publicada que responde 404 y falla', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vpro-'));
  try {
    makeDist(tmp, ['/', '/entradas/una/', '/categorias/arte/']);
    const server = await mockServer(
      ['/', '/entradas/una/', '/categorias/arte/'],
      ['/categorias/arte/']
    );
    const url = `http://127.0.0.1:${server.address().port}`;
    const { code, output } = await run(tmp, url);
    server.close();
    assert.equal(code, 1, 'debe salir con código 1 cuando una ruta responde 404');
    assert.match(output, /categorias\/arte\/.*404/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify-production aprueba (exit 0) cuando todas las rutas responden 200', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vpro-'));
  try {
    makeDist(tmp, ['/', '/entradas/una/', '/etiquetas/memoria/', '/paginas/acerca/']);
    const routes = ['/', '/entradas/una/', '/etiquetas/memoria/', '/paginas/acerca/'];
    const server = await mockServer(routes, []);
    const url = `http://127.0.0.1:${server.address().port}`;
    const { code, output } = await run(tmp, url);
    server.close();
    assert.equal(code, 0, 'debe salir con código 0 cuando todas responden 200');
    assert.match(output, /responden 200/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify-production ignora rutas /admin/ y 404', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vpro-'));
  try {
    makeDist(tmp, ['/', '/admin/login/', '/404/']);
    const server = await mockServer(['/'], ['/admin/login/', '/404/']);
    const url = `http://127.0.0.1:${server.address().port}`;
    const { code } = await run(tmp, url);
    server.close();
    assert.equal(code, 0, 'debe pasar porque /admin/ y /404/ no deben verificarse');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify-production exige una URL base', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vpro-'));
  try {
    makeDist(tmp, ['/']);
    const { code, output } = await run(tmp, '');
    assert.equal(code, 1, 'debe fallar sin URL base');
    assert.match(output, /Falta la URL base/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
