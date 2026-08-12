import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handler as legacyCollectionHandler } from '../netlify/functions/create-coleccion.ts';

test('create-proyecto fue retirado al no tener consumidores', () => {
  assert.equal(fs.existsSync('netlify/functions/create-proyecto.ts'), false);
});

test('create-coleccion es un wrapper y siempre anuncia deprecación', async () => {
  const response = await legacyCollectionHandler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
  });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Deprecation, 'true');
  assert.match(response.headers.Warning, /obsoleto/);
  assert.match(response.headers.Link, /manage-collections/);
});

test('el wrapper legacy delega RBAC, validación y rate limit al adaptador canónico', () => {
  const wrapper = fs.readFileSync('netlify/functions/create-coleccion.ts', 'utf8');
  const canonical = fs.readFileSync('netlify/functions/manage-collections.ts', 'utf8');
  assert.match(wrapper, /handler as manageCollections/);
  assert.match(wrapper, /await manageCollections\(event, context\)/);
  assert.match(canonical, /authorizeRequest\(event, 'settings\.manage', 'write',/);
  assert.match(canonical, /validateCreateCollectionInput/);
  assert.match(canonical, /createCollection/);
});

test('solo content-service escribe o elimina Markdown editorial', () => {
  const functionSources = fs
    .readdirSync('netlify/functions')
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(`netlify/functions/${name}`, 'utf8'))
    .join('\n');
  assert.doesNotMatch(functionSources, /contents\/.*src\/content/);

  const collectionService = fs.readFileSync('shared/cms/collection-service.ts', 'utf8');
  assert.doesNotMatch(collectionService, /ejemplo\.md|sampleFile|Contenido de ejemplo/);
  assert.match(collectionService, /\.gitkeep/);

  const contentService = fs.readFileSync('shared/cms/content-service.ts', 'utf8');
  assert.match(contentService, /githubContentsRequest\(filePath, \{/);
  assert.match(contentService, /method: 'DELETE'/);
  assert.match(contentService, /recordAudit/);
  assert.match(contentService, /payload\.sha/);
  assert.match(contentService, /workflow_state/);
  assert.match(contentService, /preserveContentId/);
});

test('workflow usa locking por estado y exige que una fila haya sido actualizada', () => {
  const source = fs.readFileSync('shared/cms/workflow-service.ts', 'utf8');
  assert.match(source, /\.eq\('workflow_state', record\.workflow_state\)/);
  assert.match(source, /\.select\('id'\)/);
  assert.match(source, /if \(updateError \|\| !updated\)/);
  assert.match(source, /recordAudit/);
});
