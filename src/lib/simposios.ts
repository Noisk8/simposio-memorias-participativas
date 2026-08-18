import { getCollection, type CollectionEntry } from 'astro:content';

export type Simposio = CollectionEntry<'simposios'>;

/** Carga todas las ediciones de simposio. */
export async function getSimposios(): Promise<Simposio[]> {
  return getCollection('simposios');
}

/** Devuelve la edición marcada como por defecto, o la primera activa si no hay ninguna. */
export async function getSimposioDefault(): Promise<Simposio | null> {
  const simposios = await getSimposios();
  const def = simposios.find((s) => s.data.is_default);
  if (def) return def;
  const active = simposios
    .filter((s) => s.data.status === 'active')
    .sort((a, b) => a.data.year - b.data.year);
  return active[0] || simposios[0] || null;
}

/** Devuelve una edición por su slug. */
export async function getSimposioBySlug(slug: string): Promise<Simposio | null> {
  const simposios = await getSimposios();
  return simposios.find((s) => s.data.slug === slug) || null;
}

/** Filtra un array de entradas/memorias/páginas por el slug de un simposio. */
export function filterBySimposio<T extends { data: { simposio?: string } }>(
  entries: T[],
  slug: string
): T[] {
  return entries.filter((e) => e.data.simposio === slug);
}

/** Resuelve el slug del simposio activo (por defecto) o el que se pase. */
export async function resolveSimposioSlug(slug?: string): Promise<string> {
  if (slug) return slug;
  const def = await getSimposioDefault();
  return def?.data.slug || '2026';
}

/** URL única de una entrada: corta para la edición actual y versionada para el archivo. */
export function entryPublicPath(entryId: string, simposio: string, defaultSlug: string): string {
  return simposio === defaultSlug
    ? `/entradas/${entryId}`
    : `/ediciones/${simposio}/entradas/${entryId}`;
}
