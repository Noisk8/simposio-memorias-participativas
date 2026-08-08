import { z } from 'zod';

export const categoriaSchema = z.object({
  title: z.string(),
  slug: z.string().optional().default(''),
  description: z.string().optional().default(''),
  parent: z.string().optional().default(''),
});

export const etiquetaSchema = categoriaSchema.omit({ parent: true });

const menuItemSchema = z.object({
  label: z.string(),
  url: z.string(),
  order: z.number().optional().default(0),
  children: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        order: z.number().optional().default(0),
      })
    )
    .optional()
    .default([]),
});

export const menuSchema = z.object({
  title: z.string(),
  slug: z.string(),
  items: z.array(menuItemSchema).optional().default([]),
});
