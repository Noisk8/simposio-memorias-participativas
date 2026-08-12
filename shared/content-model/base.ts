import { z } from 'zod';
import { contentIdSchema } from '../content/identity.ts';

export const dateField = z
  .union([z.string(), z.date()])
  .optional()
  .default('')
  .transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value));

export const nonEmptyStringList = z
  .preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.string()))
  .transform((items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]);

export const legacyPublicationFields = {
  draft: z.boolean().optional().default(false),
  publish_date: dateField,
};

export const editorialIdentityFields = {
  id: contentIdSchema,
};

export const optionalContentReference = z
  .union([z.literal(''), contentIdSchema])
  .optional()
  .default('');

export const editorialMetadataFields = {
  owner_id: z.uuid().optional(),
  workflow_state: z
    .enum([
      'draft',
      'publishing',
      'published',
      'publish_failed',
      'archived',
      'in_review',
      'changes_requested',
      'approved',
    ])
    .optional(),
};

export const genericContentSchema = z.object({
  ...editorialIdentityFields,
  simposio: z.string().default('2026'),
  title: z.string(),
  date: dateField,
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
});
