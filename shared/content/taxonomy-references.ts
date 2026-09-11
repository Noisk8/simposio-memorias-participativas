export type TaxonomyCollection = 'categorias' | 'etiquetas';

export function taxonomyReferenceSlug(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function normalizeTaxonomyData(
  collection: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!['categorias', 'etiquetas'].includes(collection)) return data;
  return { ...data, slug: taxonomyReferenceSlug(data.slug || data.title) };
}

export function taxonomyReferencePath(collection: TaxonomyCollection, value: unknown): string {
  return `src/content/${collection}/${taxonomyReferenceSlug(value)}.md`;
}
