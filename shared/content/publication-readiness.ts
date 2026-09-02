import { ValidationError } from '../observability/errors.ts';
import { safeContentSlug } from './paths.ts';

export function publicationReadinessErrors(
  collection: string,
  data: Record<string, unknown>,
  _body: string
): string[] {
  const errors: string[] = [];
  const title = String(data.title || '').trim();
  const slug = String(data.slug || '').trim();

  if (title.length < 3) errors.push('El título debe tener al menos 3 caracteres.');
  if (collection === 'entradas' && String(data.author || '').trim().length < 2) {
    errors.push('La entrada debe declarar una autoría editorial.');
  }
  if (
    collection === 'memorias' &&
    !String(data.author || '').trim() &&
    !String(data.collective || '').trim()
  ) {
    errors.push('La memoria debe declarar una persona autora o un colectivo responsable.');
  }
  if (['entradas', 'memorias'].includes(collection) && String(data.image || '').trim().length < 4) {
    errors.push('El contenido debe declarar una imagen social y editorial.');
  }
  if (slug && (slug !== safeContentSlug(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
    errors.push('El slug debe estar normalizado en minúsculas y separado por guiones.');
  }
  return errors;
}

export function assertPublicationReady(
  collection: string,
  data: Record<string, unknown>,
  body: string
) {
  const errors = publicationReadinessErrors(collection, data, body);
  if (errors.length) {
    throw new ValidationError('El contenido no cumple los requisitos para producción.', {
      fields: errors.map((message) => ({ path: 'publication', message })),
    });
  }
}

export function publicDocumentData(data: Record<string, unknown>): Record<string, unknown> {
  const publicData = { ...data };
  delete publicData.owner_id;
  delete publicData.workflow_state;
  return publicData;
}
