import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
