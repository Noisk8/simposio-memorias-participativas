import { z } from 'zod';
import { editorialIdentityFields, optionalContentSlugSchema } from './base.ts';

export const categoriaSchema = z.object({
  ...editorialIdentityFields,
  title: z.string(),
  slug: optionalContentSlugSchema,
  description: z.string().optional().default(''),
  parent: optionalContentSlugSchema,
});

export const etiquetaSchema = categoriaSchema.omit({ parent: true });
