import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const dateField = z
  .union([z.string(), z.date()])
  .optional()
  .default('')
  .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v));

const nonEmptyStringList = z
  .array(z.string())
  .optional()
  .default([])
  .transform((arr) => [...new Set(arr.filter((s) => s.trim() !== ''))]);

const simposios = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/simposios' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    edition: z.number(),
    year: z.number(),
    date: dateField,
    place: z.string().optional().default(''),
    status: z.enum(['active', 'archived', 'upcoming']).default('active'),
    theme: z.string().optional().default(''),
    image: z.string().optional().default(''),
    poster: z.string().optional().default(''),
    program_url: z.string().optional().default(''),
    is_default: z.boolean().optional().default(false),
  }),
});

const categorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/categorias' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional().default(''),
    description: z.string().optional().default(''),
    parent: z.string().optional().default(''),
  }),
});

const etiquetas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/etiquetas' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});

const paginas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/paginas' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    simposio: z.string().default('2026'),
    slug: z.string().optional().default(''),
    parent: z.string().optional().default(''),
    is_home: z.boolean().optional().default(false),
    order: z.number().optional().default(0),
    template: z.enum(['el-simposio', 'organizacion', 'programa', 'contacto', 'default', 'custom']).default('default'),
    title: z.string(),
    description: z.string().optional().default(''),
    image: z.string().optional().default(''),
    email: z.string().optional().default(''),
    instagram: z.string().optional().default(''),
    instagram_handle: z.string().optional().default(''),
    organizadores: nonEmptyStringList,
    instituciones_image: z.string().optional().default(''),
  }),
});

const memorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/memorias' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    publish_date: dateField,
    simposio: z.string().default('2026'),
    number: z.number(),
    title: z.string(),
    place: z.string(),
    author: z.string().optional().default(''),
    collective: z.string().optional().default(''),
    categories: nonEmptyStringList,
    tags: nonEmptyStringList,
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});

const entradas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/entradas' }),
  schema: z.object({
    draft: z.boolean().optional().default(false),
    publish_date: dateField,
    simposio: z.string().default('2026'),
    title: z.string(),
    date: dateField,
    author: z.string().optional().default(''),
    categories: nonEmptyStringList,
    tags: nonEmptyStringList,
    image: z.string().optional().default(''),
    description: z.string().optional().default(''),
  }),
});

const menuItems = z.object({
  label: z.string(),
  url: z.string(),
  order: z.number().optional().default(0),
  children: z.array(z.object({
    label: z.string(),
    url: z.string(),
    order: z.number().optional().default(0),
  })).optional().default([]),
});

const menus = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/menus' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    items: z.array(menuItems).optional().default([]),
  }),
});

export const collections = { simposios, categorias, etiquetas, paginas, memorias, entradas, menus };
