import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  githubPrivateKeyFromEnvironment,
  normalizeGitHubPrivateKey,
} from '../shared/github/auth.ts';

test('normaliza PEM multilinea, escapado, entre comillas o como asignación', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----';
  assert.equal(normalizeGitHubPrivateKey(pem), pem);
  assert.equal(normalizeGitHubPrivateKey(pem.replaceAll('\n', '\\n')), pem);
  assert.equal(normalizeGitHubPrivateKey(`"${pem}"`), pem);
  assert.equal(normalizeGitHubPrivateKey(`'${pem.replaceAll('\n', '\\n')}'`), pem);
  assert.equal(normalizeGitHubPrivateKey(`GITHUB_APP_PRIVATE_KEY="${pem}"`), pem);
});

test('acepta la private key en Base64 sin depender de saltos de línea', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----';
  const encoded = Buffer.from(pem, 'utf8').toString('base64');
  assert.equal(githubPrivateKeyFromEnvironment('', encoded), pem);
  assert.equal(githubPrivateKeyFromEnvironment('PEM INCORRECTO', `"${encoded}"`), pem);
});

test('todas las llamadas GitHub del backend pasan por la capa compartida', () => {
  const backend = [
    ...fs.readdirSync('shared').flatMap((directory) =>
      fs.statSync(`shared/${directory}`).isDirectory()
        ? fs
            .readdirSync(`shared/${directory}`)
            .filter((file) => file.endsWith('.ts'))
            .map((file) => `shared/${directory}/${file}`)
        : []
    ),
    ...fs
      .readdirSync('netlify/functions')
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `netlify/functions/${file}`),
  ];
  const offenders = backend.filter(
    (file) =>
      !file.startsWith('shared/github/') &&
      fs.readFileSync(file, 'utf8').includes('https://api.github.com')
  );
  assert.deepEqual(offenders, []);
});

test('la abstracción GitHub expone las operaciones editoriales requeridas', () => {
  const client = fs.readFileSync('shared/github/client.ts', 'utf8');
  for (const operation of [
    'getGitHubClient',
    'getInstallationToken',
    'readContent',
    'createContent',
    'updateContent',
    'deleteContent',
    'createBranch',
    'createPullRequest',
    'mergePullRequest',
  ]) {
    assert.match(client, new RegExp(`\\b${operation}\\b`));
  }
  assert.match(client, /getCommitVerification/);
});

test('el token personal solo aparece como fallback obsoleto en auth', () => {
  const githubSources = fs
    .readdirSync('shared/github')
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, source: fs.readFileSync(`shared/github/${file}`, 'utf8') }));
  assert.deepEqual(
    githubSources
      .filter(({ source }) => source.includes('process.env.GITHUB_TOKEN'))
      .map(({ file }) => file),
    ['auth.ts']
  );
  assert.match(githubSources.find(({ file }) => file === 'auth.ts').source, /deprecated: true/);
});
