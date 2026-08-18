import { z } from 'zod';
import { contentSlugSchema, dateField, editorialIdentityFields } from './base.ts';

export const simposioSchema = z.object({
  ...editorialIdentityFields,
  title: z.string(),
  slug: contentSlugSchema,
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
});

export type Simposio = z.infer<typeof simposioSchema>;
