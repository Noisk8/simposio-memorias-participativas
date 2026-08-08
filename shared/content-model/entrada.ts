import { z } from 'zod';
import { dateField, legacyPublicationFields, nonEmptyStringList } from './base.ts';

export const entradaSchema = z.object({
  ...legacyPublicationFields,
  simposio: z.string().default('2026'),
  title: z.string(),
  date: dateField,
  author: z.string().optional().default(''),
  categories: nonEmptyStringList,
  tags: nonEmptyStringList,
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export type Entrada = z.infer<typeof entradaSchema>;
