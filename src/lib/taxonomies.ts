import { getCollection } from 'astro:content';

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TaxonomyTerm {
  title: string;
  slug: string;
  description: string;
  parent?: string;
}

export async function getCategorias(): Promise<TaxonomyTerm[]> {
  const entries = await getCollection('categorias');
  return entries.map((e) => ({
    title: e.data.title,
    slug: e.data.slug || slugify(e.data.title),
    description: e.data.description,
    parent: e.data.parent,
  }));
}

export async function getEtiquetas(): Promise<TaxonomyTerm[]> {
  const entries = await getCollection('etiquetas');
  return entries.map((e) => ({
    title: e.data.title,
    slug: e.data.slug || slugify(e.data.title),
    description: e.data.description,
  }));
}

export function termSlugMap(terms: TaxonomyTerm[]): Map<string, string> {
  return new Map(terms.map((t) => [t.title, t.slug]));
}

export function slugTitleMap(terms: TaxonomyTerm[]): Map<string, string> {
  return new Map(terms.map((t) => [t.slug, t.title]));
}

export function resolveTermSlug(title: string, map: Map<string, string>): string {
  return map.get(title) || slugify(title);
}

export function resolveTermTitle(slug: string, map: Map<string, string>): string {
  return map.get(slug) || slug;
}

export function buildTree(terms: TaxonomyTerm[]): TaxonomyTerm[] {
  const map = new Map<string, TaxonomyTerm & { children: TaxonomyTerm[] }>();
  const roots: (TaxonomyTerm & { children: TaxonomyTerm[] })[] = [];

  for (const t of terms) {
    map.set(t.slug, { ...t, children: [] });
  }

  for (const t of terms) {
    if (t.parent && map.has(t.parent)) {
      map.get(t.parent)!.children.push(map.get(t.slug)!);
    } else {
      roots.push(map.get(t.slug)!);
    }
  }

  return roots;
}

export function getParentChain(
  slug: string,
  allTerms: TaxonomyTerm[],
  chain: TaxonomyTerm[] = []
): TaxonomyTerm[] {
  const term = allTerms.find((t) => t.slug === slug);
  if (!term) return chain;
  chain.unshift(term);
  if (term.parent) {
    return getParentChain(term.parent, allTerms, chain);
  }
  return chain;
}

export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function sortByDateDesc<T extends { data: { date?: string; title?: string } }>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const da = a.data.date || '';
    const db = b.data.date || '';
    if (da && db) return db.localeCompare(da);
    if (da) return -1;
    if (db) return 1;
    return (a.data.title ?? '').localeCompare(b.data.title ?? '');
  });
}

export function isScheduled(data: { draft?: boolean; publish_date?: string }): boolean {
  if (data.draft) return false;
  if (!data.publish_date) return false;
  const now = new Date();
  const scheduled = new Date(data.publish_date);
  return scheduled > now;
}

export function filterPublished<T extends { data: { draft?: boolean; publish_date?: string } }>(
  entries: T[]
): T[] {
  return entries.filter((e) => !e.data.draft && !isScheduled(e.data));
}
