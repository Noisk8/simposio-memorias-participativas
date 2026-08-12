import { z } from 'zod';
import {
  editorialIdentityFields,
  editorialMetadataFields,
  legacyPublicationFields,
  nonEmptyStringList,
} from './base.ts';

const PUBLIC_IMAGE_PATTERN = /^\/images\/[a-z0-9_./-]+\.(?:jpe?g|png|webp|avif|gif)$/i;

export const memoriaSchema = z.object({
  ...editorialIdentityFields,
  ...legacyPublicationFields,
  ...editorialMetadataFields,
  simposio: z.string().default('2026'),
  number: z.number().int().positive(),
  title: z.string(),
  place: z.string(),
  author: z.string().optional().default(''),
  collective: z.string().optional().default(''),
  categories: nonEmptyStringList,
  tags: nonEmptyStringList,
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export const memoriaCreateInputSchema = z.object({
  number: z.number().int().min(1).max(999999),
  title: z.string().trim().min(1).max(180),
  place: z.string().trim().min(1).max(180),
  author: z.string().max(180).optional().default(''),
  collective: z.string().max(240).optional().default(''),
  image: z
    .string()
    .trim()
    .max(180)
    .regex(PUBLIC_IMAGE_PATTERN, 'La imagen debe ser una ruta válida dentro de /images/.')
    .refine(
      (value) => !value.split('/').includes('..'),
      'La ruta de imagen no puede contener segmentos ..'
    ),
  description: z.string().max(1000).optional().default(''),
  body: z.string().max(100000).optional().default(''),
});

export type Memoria = z.infer<typeof memoriaSchema>;
export type MemoriaCreateInput = z.infer<typeof memoriaCreateInputSchema>;
