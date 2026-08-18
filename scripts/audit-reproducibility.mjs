import fs from 'node:fs';
import path from 'node:path';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lockfile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const failures = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(packageJson[section] || {})) {
    if (!exactVersion.test(version)) failures.push(`${section}.${name} no está fijada: ${version}`);
    if (lockfile.packages?.['']?.[section]?.[name] !== version) {
      failures.push(`${section}.${name} difiere entre package.json y package-lock.json`);
    }
  }
}

const nodeVersion = String(packageJson.engines?.node || '');
if (!exactVersion.test(nodeVersion)) failures.push(`engines.node no es exacto: ${nodeVersion}`);
if (fs.readFileSync('.nvmrc', 'utf8').trim() !== nodeVersion) {
  failures.push('.nvmrc no coincide con engines.node');
}
if (!fs.readFileSync('netlify.toml', 'utf8').includes(`NODE_VERSION = "${nodeVersion}"`)) {
  failures.push('netlify.toml no coincide con engines.node');
}

const workflowDirectory = '.github/workflows';
for (const name of fs.readdirSync(workflowDirectory)) {
  const file = path.join(workflowDirectory, name);
  if (!/\.ya?ml$/i.test(name)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
    const action = match[1];
    if (!action.startsWith('./') && !/@[a-f0-9]{40}$/i.test(action)) {
      failures.push(`${file}: Action mutable ${action}`);
    }
  }
}

if (failures.length) {
  console.error(`Reproducibilidad fallida:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Versiones directas, Node, lockfile y Actions están fijados.');
