import { z } from 'zod';
import { editorialIdentityFields } from './base.ts';

export const categoriaSchema = z.object({
  ...editorialIdentityFields,
  title: z.string(),
  slug: z.string().optional().default(''),
  description: z.string().optional().default(''),
  parent: z.string().optional().default(''),
});

export const etiquetaSchema = categoriaSchema.omit({ parent: true });
