import { z } from 'zod';

export const dateField = z
  .union([z.string(), z.date()])
  .optional()
  .default('')
  .transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value));

export const nonEmptyStringList = z
  .array(z.string())
  .optional()
  .default([])
  .transform((items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]);

export const legacyPublicationFields = {
  draft: z.boolean().optional().default(false),
  publish_date: dateField,
};

export const editorialMetadataFields = {
  owner_id: z.uuid().optional(),
  workflow_state: z
    .enum(['draft', 'in_review', 'changes_requested', 'approved', 'published', 'archived'])
    .optional(),
};

export const genericContentSchema = z.object({
  simposio: z.string().default('2026'),
  title: z.string(),
  date: dateField,
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
});
