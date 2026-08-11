/**
 * Levanta las Functions con `netlify functions:serve`, espera a que respondan
 * y ejecuta los tests de contrato de tests/api-contract.test.mjs. Al terminar,
 * detiene el servidor y propaga el código de salida de los tests.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8888';
const startupTimeoutMs = 120_000;

const netlifyBin = process.platform === 'win32' ? 'netlify.cmd' : 'netlify';
// functions:serve levanta solo las Functions: sin astro dev, más rápido y sin
// procesos huérfanos. Las rutas /.netlify/functions/* son idénticas.
const server = spawn(netlifyBin, ['functions:serve', '--port', '8888', '--offline'], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
  // Grupo de procesos propio para poder detener también los hijos (astro dev).
  detached: process.platform !== 'win32',
});

server.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer() {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
}

function stopServer() {
  if (server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

const up = await waitForServer();
if (!up) {
  console.error(`netlify dev no respondió en ${baseUrl} tras ${startupTimeoutMs / 1000}s.`);
  stopServer();
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', 'tests/api-contract.test.mjs'],
  { cwd: projectRoot, stdio: 'inherit', env: { ...process.env, API_BASE_URL: baseUrl } }
);

stopServer();
process.exit(result.status ?? 1);
