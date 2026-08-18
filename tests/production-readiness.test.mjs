import assert from 'node:assert/strict';
import test from 'node:test';
import { mayUpdateReusedMedia } from '../shared/cms/media-service.ts';
import {
  publicationReadinessErrors,
  publicDocumentData,
} from '../shared/content/publication-readiness.ts';
import { deployForCommit, getDeployForCommit, isDeployFailure } from '../shared/netlify/deploys.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('Netlify solo confirma un deploy de producción para el merge exacto', () => {
  const deploy = deployForCommit(
    [
      { id: 'preview', state: 'ready', context: 'deploy-preview', commit_ref: SHA },
      { id: 'other', state: 'ready', context: 'production', commit_ref: 'f'.repeat(40) },
      {
        id: 'expected',
        state: 'ready',
        context: 'production',
        commit_ref: SHA,
        published_at: '2026-08-16T12:00:00Z',
      },
    ],
    SHA
  );
  assert.equal(deploy?.id, 'expected');
  assert.equal(deployForCommit([], SHA), null);
});

test('los estados fallidos de Netlify se detectan sin confundir pendientes', () => {
  assert.equal(isDeployFailure({ id: 'a', state: 'error' }), true);
  assert.equal(isDeployFailure({ id: 'b', state: 'building' }), false);
  assert.equal(isDeployFailure(null), false);
});

test('el runtime de Netlify confirma su propio commit sin persistir un token API', async () => {
  const keys = ['CONTEXT', 'COMMIT_REF', 'DEPLOY_ID', 'DEPLOY_PRIME_URL', 'GITHUB_BRANCH'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CONTEXT: 'production',
    COMMIT_REF: SHA,
    DEPLOY_ID: 'deploy-runtime',
    DEPLOY_PRIME_URL: 'https://deploy-runtime.example',
    GITHUB_BRANCH: 'main',
  });
  try {
    const deploy = await getDeployForCommit(SHA);
    assert.equal(deploy?.id, 'deploy-runtime');
    assert.equal(deploy?.state, 'ready');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('reutilizar un medio no concede permiso implícito para editar metadata', () => {
  assert.equal(mayUpdateReusedMedia({ permissions: ['media.upload'] }), false);
  assert.equal(mayUpdateReusedMedia({ permissions: ['media.upload', 'media.update'] }), true);
});

test('la validación de producción rechaza slugs, resúmenes y cuerpos incompletos', () => {
  const errors = publicationReadinessErrors(
    'paginas',
    { title: 'ok', slug: 'Slug con espacios', description: 'corta' },
    'breve'
  );
  assert.equal(errors.length, 4);
  assert.deepEqual(
    publicationReadinessErrors(
      'paginas',
      {
        title: 'Página editorial',
        slug: 'pagina-editorial',
        description: 'Una descripción pública suficientemente informativa.',
      },
      'Este es un cuerpo editorial suficientemente extenso para su publicación.'
    ),
    []
  );
});

test('la validación de producción exige autoría e imagen en contenido editorial', () => {
  const entryErrors = publicationReadinessErrors(
    'entradas',
    {
      title: 'Entrada completa',
      description: 'Una descripción pública suficientemente informativa.',
      author: '',
      image: '',
    },
    'Este es un cuerpo editorial suficientemente extenso para su publicación.'
  );
  assert.match(entryErrors.join(' '), /autoría editorial/);
  assert.match(entryErrors.join(' '), /imagen social/);

  assert.deepEqual(
    publicationReadinessErrors(
      'memorias',
      {
        title: 'Memoria colectiva',
        description: 'Una descripción pública suficientemente informativa.',
        collective: 'Colectivo responsable',
        image: '/images/proyecto-1.jpg',
      },
      'Este es un cuerpo editorial suficientemente extenso para su publicación.'
    ),
    []
  );
});

test('el Markdown público no expone metadata operativa del CMS', () => {
  assert.deepEqual(
    publicDocumentData({ title: 'Pública', owner_id: 'user-id', workflow_state: 'published' }),
    { title: 'Pública' }
  );
});
