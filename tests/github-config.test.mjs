import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGitHubRepository } from '../shared/github/config.ts';

test('normaliza repositorios GitHub en formatos habituales', () => {
  assert.equal(
    normalizeGitHubRepository(' https://github.com/Noisk8/simposio-memorias-participativas.git '),
    'Noisk8/simposio-memorias-participativas'
  );
  assert.equal(
    normalizeGitHubRepository('git@github.com:Noisk8/simposio-memorias-participativas.git'),
    'Noisk8/simposio-memorias-participativas'
  );
});

test('usa el repositorio de este proyecto cuando la variable falta', () => {
  assert.equal(normalizeGitHubRepository(undefined), 'Noisk8/simposio-memorias-participativas');
});
