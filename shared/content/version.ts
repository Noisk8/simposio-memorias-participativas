import { createHash } from 'node:crypto';
import { serializeMarkdownDocument } from './frontmatter.ts';

// Estos campos controlan el despliegue, la propiedad y el workflow. No forman
// parte de la revisión editorial porque cambian de forma mecánica al publicar.
const OPERATIONAL_FIELDS = new Set(['draft', 'workflow_state', 'owner_id']);

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

export function reviewableContent(
  data: Record<string, unknown>,
  body: string
): { data: Record<string, unknown>; body: string } {
  const editorialData = Object.fromEntries(
    Object.entries(data).filter(([key]) => !OPERATIONAL_FIELDS.has(key))
  );
  return {
    data: sortValue(editorialData) as Record<string, unknown>,
    body: body.replace(/\r\n/g, '\n').trim(),
  };
}

export function contentVersionSha(data: Record<string, unknown>, body: string): string {
  const reviewable = reviewableContent(data, body);
  const canonical = serializeMarkdownDocument(reviewable.data, reviewable.body);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function approvalIsCurrent(record: {
  current_sha?: unknown;
  approved_sha?: unknown;
}): boolean {
  return (
    typeof record.current_sha === 'string' &&
    typeof record.approved_sha === 'string' &&
    record.current_sha === record.approved_sha
  );
}

export function workflowStateAfterEdit(
  previousState: string,
  previousSha: string | null | undefined,
  nextSha: string
): string {
  const changed = !previousSha || previousSha !== nextSha;
  if (changed && ['in_review', 'approved', 'published', 'archived'].includes(previousState)) {
    return 'changes_requested';
  }
  return previousState || 'draft';
}
