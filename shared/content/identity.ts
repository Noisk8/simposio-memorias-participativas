import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const contentIdSchema = z
  .string()
  .regex(UUID_V4_PATTERN, 'El id debe ser un UUID v4 válido.');

export function isContentId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export function generateContentId(generator: () => string = randomUUID): string {
  const id = generator();
  if (!isContentId(id)) throw new Error('El generador no produjo un UUID v4 válido.');
  return id;
}

export function assignNewContentId(
  incoming: Record<string, unknown>,
  generator: () => string = randomUUID
): Record<string, unknown> {
  return { ...incoming, id: generateContentId(generator) };
}

export function preserveContentId(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fallbackId?: unknown,
  generator: () => string = randomUUID
): Record<string, unknown> {
  const id = isContentId(existing.id)
    ? existing.id
    : isContentId(fallbackId)
      ? fallbackId
      : generateContentId(generator);
  return { ...incoming, id };
}
