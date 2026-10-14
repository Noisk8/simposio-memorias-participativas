import { z } from 'zod';
import {
  dateField,
  editorialIdentityFields,
  editorialMetadataFields,
  legacyPublicationFields,
} from './base.ts';

export const eventoSchema = z.object({
  ...editorialIdentityFields,
  ...legacyPublicationFields,
  ...editorialMetadataFields,
  title: z.string().trim().min(1).max(180),
  date: dateField,
  description: z.string().trim().max(5000).optional().default(''),
  image: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .default('')
    .refine((value) => {
      if (!value) return true;
      if (/^\/images\/[A-Za-z0-9._/-]+$/.test(value)) return !value.split('/').includes('..');
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'Usa una imagen de la biblioteca, una ruta /images/ o una URL HTTPS válida.'),
  address: z.string().trim().max(500).optional().default(''),
  organizer: z.string().trim().max(240).optional().default(''),
});

export type Evento = z.infer<typeof eventoSchema>;
