import { ValidationError } from '../observability/errors.ts';

export type EditorialCollection =
  'entradas' | 'memorias' | 'paginas' | 'simposios' | 'categorias' | 'etiquetas';

export function safeContentSlug(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function newContentPath(
  collection: EditorialCollection,
  data: Record<string, unknown>
): string {
  let stem = safeContentSlug(data.slug || data.title);
  if (collection === 'memorias') stem = `${data.number}-${safeContentSlug(data.title)}`;
  if (collection === 'paginas' && data.simposio) stem = `${safeContentSlug(data.simposio)}-${stem}`;
  if (!stem) throw new ValidationError('No se pudo generar un nombre de archivo válido.');
  return `src/content/${collection}/${stem}.md`;
}

export function publicUrlForContent(
  collection: EditorialCollection,
  filePath: string,
  data: Record<string, unknown>
): string | null {
  const stem = String(filePath.split('/').pop() || '').replace(/\.md$/i, '');
  if (!stem) return null;
  if (collection === 'entradas') return `/entradas/${stem}`;
  if (collection === 'memorias') {
    const number = String(data.number || stem.split('-')[0] || '').trim();
    return number ? `/museo-memorias/${number}` : null;
  }
  if (collection === 'paginas') {
    const slug = String(data.slug || stem.replace(/^\d{4}-/, '') || '').trim();
    return slug ? `/${slug}` : null;
  }
  if (collection === 'simposios') {
    const slug = String(data.slug || stem || '').trim();
    return slug ? `/ediciones/${slug}` : null;
  }
  return null;
}
