import { z } from 'zod';
import { dateField, editorialMetadataFields, nonEmptyStringList } from './base.ts';

export const paginaSchema = z.object({
  draft: z.boolean().optional().default(false),
  publish_date: dateField,
  ...editorialMetadataFields,
  simposio: z.string().default('2026'),
  slug: z.string().optional().default(''),
  parent: z.string().optional().default(''),
  is_home: z.boolean().optional().default(false),
  order: z.number().optional().default(0),
  template: z
    .enum(['el-simposio', 'organizacion', 'programa', 'contacto', 'default', 'custom'])
    .default('default'),
  title: z.string(),
  description: z.string().optional().default(''),
  image: z.string().optional().default(''),
  email: z.string().optional().default(''),
  instagram: z.string().optional().default(''),
  instagram_handle: z.string().optional().default(''),
  organizadores: nonEmptyStringList,
  instituciones_image: z.string().optional().default(''),
});

export type Pagina = z.infer<typeof paginaSchema>;
