import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePublishedContent,
  todayIsoDate,
  isFutureIsoDate,
} from '../shared/content/publication.ts';

test('normalizePublishedContent: fija publish_date en hoy al publicar sin fecha', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const data = normalizePublishedContent({ publish_date: '' }, 'published', now);
  assert.equal(data.publish_date, '2026-08-09');
});

test('normalizePublishedContent: conserva publish_date futura para programar', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const data = normalizePublishedContent({ publish_date: '2026-08-10' }, 'published', now);
  assert.equal(data.publish_date, '2026-08-10');
});

test('normalizePublishedContent: conserva publish_date pasada al publicar', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const data = normalizePublishedContent({ publish_date: '2026-08-08' }, 'published', now);
  assert.equal(data.publish_date, '2026-08-08');
});

test('isFutureIsoDate: detecta fechas futuras', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  assert.equal(isFutureIsoDate('2026-08-10', now), true);
  assert.equal(isFutureIsoDate('2026-08-09', now), false);
  assert.equal(isFutureIsoDate('', now), false);
});

test('todayIsoDate: retorna la fecha ISO del día', () => {
  assert.equal(todayIsoDate(new Date('2026-08-09T23:59:59.000Z')), '2026-08-09');
});
