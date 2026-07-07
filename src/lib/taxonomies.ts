/**
 * Utilidades para taxonomías (categorías y etiquetas) y fechas.
 * Arquitectura tipo WordPress: las entradas/proyectos guardan los títulos
 * de las taxonomías; estas utilidades resuelven slugs y archivos.
 */
import { getCollection } from 'astro:content';

/** Convierte un texto a slug URL-friendly (ej: "Memoria Histórica" → "memoria-historica"). */
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

/** Carga las categorías con su slug canónico (campo slug o slugify del título). */
export async function getCategorias(): Promise<TaxonomyTerm[]> {
  const entries = await getCollection('categorias');
  return entries.map((e) => ({
    title: e.data.title,
    slug: e.data.slug || slugify(e.data.title),
    description: e.data.description,
    parent: e.data.parent,
  }));
}

/** Carga las etiquetas con su slug canónico. */
export async function getEtiquetas(): Promise<TaxonomyTerm[]> {
  const entries = await getCollection('etiquetas');
  return entries.map((e) => ({
    title: e.data.title,
    slug: e.data.slug || slugify(e.data.title),
    description: e.data.description,
  }));
}

/** Mapa título → slug para generar enlaces desde los pills. */
export function termSlugMap(terms: TaxonomyTerm[]): Map<string, string> {
  return new Map(terms.map((t) => [t.title, t.slug]));
}

/** Resuelve el slug de un término; si no existe como documento, usa slugify. */
export function resolveTermSlug(title: string, map: Map<string, string>): string {
  return map.get(title) || slugify(title);
}

/** Formatea una fecha ISO/string a español legible (ej: "3 de julio de 2026"). */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Ordena entradas por fecha descendente; sin fecha van al final (orden alfabético). */
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
