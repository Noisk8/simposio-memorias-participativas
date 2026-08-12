type EditableContent = {
  data?: {
    draft?: unknown;
    workflow_state?: unknown;
  };
  workflow?: {
    published_sha?: unknown;
    workflow_state?: unknown;
  } | null;
};

export function hasPublishedVersion(content?: EditableContent | null): boolean {
  if (!content) return false;
  if (String(content.workflow?.published_sha || '').trim()) return true;

  const workflowState = String(
    content.workflow?.workflow_state || content.data?.workflow_state || ''
  ).toLowerCase();
  return workflowState === 'published' || content.data?.draft === false;
}

export function saveActionLabel(content?: EditableContent | null): string {
  return hasPublishedVersion(content) ? 'Guardar cambios' : 'Guardar borrador';
}
