import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  categoriaSchema,
  entradaSchema,
  etiquetaSchema,
  genericContentSchema,
  memoriaSchema,
  paginaSchema,
  simposioSchema,
} from '../shared/content-model/index.ts';

// genericContentSchema es usado por scripts/sync-collections.mjs cuando se
// incorpora una colección nueva que aún no tiene un modelo especializado.
void genericContentSchema;

const simposios = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/simposios' }),
  schema: simposioSchema,
});

const categorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/categorias' }),
  schema: categoriaSchema,
});

const etiquetas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/etiquetas' }),
  schema: etiquetaSchema,
});

const paginas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/paginas' }),
  schema: paginaSchema,
});

const memorias = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/memorias' }),
  schema: memoriaSchema,
});

const entradas = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/entradas' }),
  schema: entradaSchema,
});

export const collections = { simposios, categorias, etiquetas, paginas, memorias, entradas };
