import { z } from 'zod';
import {
  dateField,
  editorialIdentityFields,
  editorialMetadataFields,
  legacyPublicationFields,
  nonEmptyStringList,
  optionalContentReference,
} from './base.ts';

export const entradaSchema = z.object({
  ...editorialIdentityFields,
  ...legacyPublicationFields,
  ...editorialMetadataFields,
  simposio: z.string().default('2026'),
  page_id: optionalContentReference,
  title: z.string(),
  date: dateField,
  author: z.string().optional().default(''),
  author_type: z.enum(['Person', 'Organization']).optional().default('Person'),
  categories: nonEmptyStringList,
  tags: nonEmptyStringList,
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export type Entrada = z.infer<typeof entradaSchema>;
