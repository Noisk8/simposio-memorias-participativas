import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  approvalIsCurrent,
  contentVersionSha,
  workflowStateAfterEdit,
} from '../shared/content/version.ts';
import { publicationBranch } from '../shared/cms/workflow-service.ts';

const baseData = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  title: 'Versión A',
  publish_date: '2026-08-11',
  draft: true,
  workflow_state: 'approved',
  owner_id: '123e4567-e89b-42d3-a456-426614174001',
};

test('el SHA editorial cambia al modificar cuerpo o metadata revisable', () => {
  const original = contentVersionSha(baseData, 'Texto aprobado.');
  assert.notEqual(original, contentVersionSha(baseData, 'Texto modificado.'));
  assert.notEqual(
    original,
    contentVersionSha({ ...baseData, title: 'Versión B' }, 'Texto aprobado.')
  );
  assert.notEqual(
    original,
    contentVersionSha({ ...baseData, publish_date: '2026-08-12' }, 'Texto aprobado.')
  );
});

test('los campos operativos no alteran la versión editorial aprobada', () => {
  const draft = contentVersionSha(baseData, 'Texto aprobado.');
  const publicationArtifact = contentVersionSha(
    {
      ...baseData,
      draft: false,
      workflow_state: 'published',
      owner_id: '123e4567-e89b-42d3-a456-426614174099',
    },
    'Texto aprobado.'
  );
  assert.equal(draft, publicationArtifact);
});

test('una aprobación solo es vigente cuando ambos SHA coinciden', () => {
  assert.equal(approvalIsCurrent({ current_sha: 'a', approved_sha: 'a' }), true);
  assert.equal(approvalIsCurrent({ current_sha: 'b', approved_sha: 'a' }), false);
  assert.equal(approvalIsCurrent({ current_sha: 'a', approved_sha: null }), false);
});

test('editar una versión aprobada o en revisión exige nueva revisión', () => {
  assert.equal(workflowStateAfterEdit('approved', 'a', 'b'), 'changes_requested');
  assert.equal(workflowStateAfterEdit('in_review', 'a', 'b'), 'changes_requested');
  assert.equal(workflowStateAfterEdit('published', 'a', 'b'), 'changes_requested');
  assert.equal(workflowStateAfterEdit('approved', 'a', 'a'), 'approved');
  assert.equal(workflowStateAfterEdit('draft', 'a', 'b'), 'draft');
});

test('la rama editorial no deriva del título', () => {
  const branch = publicationBranch(
    '123e4567-e89b-42d3-a456-426614174000',
    new Date('2026-08-11T12:34:56.789Z')
  );
  assert.equal(branch, 'cms/123e4567-e89b-42d3-a456-426614174000/20260811T123456789Z');
  assert.doesNotMatch(branch, /\s/);
});

test('manage-content no conserva el bypass de publicación directa', () => {
  const contentService = fs.readFileSync('shared/cms/content-service.ts', 'utf8');
  const workflowService = fs.readFileSync('shared/cms/workflow-service.ts', 'utf8');
  const panel = fs.readFileSync('src/pages/admin/contenidos.astro', 'utf8');
  assert.doesNotMatch(contentService, /payload\?\.data\?\.draft === false/);
  assert.match(contentService, /approvalInvalidated/);
  assert.match(workflowService, /current_sha', record\.approved_sha/);
  assert.match(workflowService, /content_published/);
  assert.match(panel, /transition\('publish'\)/);
  assert.match(panel, /La aprobación quedó invalidada porque el contenido fue modificado/);
});

test('la migración persiste versiones, PR y SHA en eventos de auditoría', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/202608110007_approved_version_pr_publication.sql',
    'utf8'
  );
  for (const field of [
    'current_sha',
    'approved_sha',
    'published_sha',
    'github_branch',
    'github_pr_number',
    'github_pr_url',
    'merge_sha',
    'deployment_state',
    'content_sha',
  ]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
});
