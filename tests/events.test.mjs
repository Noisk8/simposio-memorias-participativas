import assert from 'node:assert/strict';
import test from 'node:test';
import { eventoSchema } from '../shared/content-model/evento.ts';
import {
  contentPermission,
  validateContentDocument,
  isManagedContentPath,
} from '../shared/cms/content-service.ts';
import { validateWorkflowPath, workflowPermission } from '../shared/cms/workflow-service.ts';
import { newContentPath, publicUrlForContent } from '../shared/content/paths.ts';
import { assertPublicationReady } from '../shared/content/publication-readiness.ts';
import { eventToday, formatEventDate, groupEvents } from '../shared/content/events.ts';
import { isSafeContentPath } from '../netlify/security.ts';

const event = {
  id: '36780047-366b-463b-9240-454fabbc007a',
  title: 'Encuentro de memorias',
  date: '2026-10-24',
  description: 'Un encuentro de los colectivos de la Red.',
  image: '/images/hero-bg.jpg',
  address: 'Universidad de Granada, Granada',
  organizer: 'Colectivo de memorias',
};

test('eventos conserva los seis campos y utiliza rutas y permisos editoriales propios', () => {
  const data = validateContentDocument('eventos', event, 'Más información.');
  for (const field of ['title', 'date', 'description', 'image', 'address', 'organizer']) {
    assert.equal(data[field], event[field]);
  }
  const path = newContentPath('eventos', data);
  assert.equal(path, 'src/content/eventos/encuentro-de-memorias.md');
  assert.equal(publicUrlForContent('eventos', path, data), '/agenda/encuentro-de-memorias');
  assert.equal(isManagedContentPath(path), true);
  assert.equal(isSafeContentPath(path), true);
  assert.equal(validateWorkflowPath(path), path);
  assert.equal(contentPermission('eventos', 'create'), 'evento.create');
  assert.equal(contentPermission('eventos', 'update'), 'evento.update');
  assert.equal(contentPermission('eventos', 'delete'), 'evento.delete');
  assert.equal(workflowPermission(path, 'publish').permission, 'evento.publish');
  assert.equal(workflowPermission(path, 'archive').permission, 'evento.archive');
  assert.throws(() => validateWorkflowPath('src/content/eventos/../paginas/agenda.md'));
});

test('un borrador incompleto se guarda, pero publicar requiere todos los datos del evento', () => {
  const draft = eventoSchema.parse({ id: event.id, title: event.title });
  assert.equal(draft.date, '');
  assert.throws(() => assertPublicationReady('eventos', draft, ''));
  assert.doesNotThrow(() => assertPublicationReady('eventos', event, ''));
  for (const field of ['date', 'description', 'image', 'address', 'organizer']) {
    assert.throws(() => assertPublicationReady('eventos', { ...event, [field]: '' }, ''), field);
  }
  assert.throws(() => assertPublicationReady('eventos', { ...event, date: '2026-02-30' }, ''));
  assert.equal(eventoSchema.safeParse({ ...event, date: '2026-02-30' }).success, false);
  assert.equal(eventoSchema.safeParse({ ...event, image: 'javascript:alert(1)' }).success, false);
  assert.equal(eventoSchema.safeParse({ ...event, image: '/images/../foto.jpg' }).success, false);
});

test('agenda ordena próximos y anteriores sin mutar el listado y conserva el día en Bogotá', () => {
  const events = ['2026-10-25', '2026-10-12', '2026-10-14', '2026-10-13'].map((date) => ({
    data: { ...event, date },
  }));
  const original = events.map((item) => item.data.date);
  const result = groupEvents(events, '2026-10-14');
  assert.deepEqual(
    result.upcoming.map((item) => item.data.date),
    ['2026-10-14', '2026-10-25']
  );
  assert.deepEqual(
    result.past.map((item) => item.data.date),
    ['2026-10-13', '2026-10-12']
  );
  assert.deepEqual(
    events.map((item) => item.data.date),
    original
  );
  assert.equal(eventToday(new Date('2026-10-15T02:00:00Z')), '2026-10-14');
  assert.match(formatEventDate('2026-10-14'), /14 de octubre de 2026/);
});
