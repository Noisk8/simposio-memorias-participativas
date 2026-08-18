type EditableContent = {
  data?: {
    draft?: unknown;
    workflow_state?: unknown;
  };
  workflow?: {
    current_sha?: unknown;
    published_sha?: unknown;
    workflow_state?: unknown;
  } | null;
};

function workflowState(content?: EditableContent | null): string {
  return String(content?.workflow?.workflow_state || content?.data?.workflow_state || '')
    .trim()
    .toLowerCase();
}

export function hasPublishedVersion(content?: EditableContent | null): boolean {
  if (!content) return false;
  if (String(content.workflow?.published_sha || '').trim()) return true;

  return workflowState(content) === 'published' || content.data?.draft === false;
}

export function isArchivedContent(content?: EditableContent | null): boolean {
  return workflowState(content) === 'archived';
}

/**
 * A draft-list item is content that has never had a published version.
 * An editable copy or pending changes do not turn already-published content
 * back into a draft-list item.
 */
export function isUnpublishedDraft(content?: EditableContent | null): boolean {
  return Boolean(content) && !isArchivedContent(content) && !hasPublishedVersion(content);
}

export function isPublishedListingContent(content?: EditableContent | null): boolean {
  return Boolean(content) && !isArchivedContent(content) && hasPublishedVersion(content);
}

export function isMainContentListingContent(content?: EditableContent | null): boolean {
  return isArchivedContent(content) || isPublishedListingContent(content);
}

export function hasPendingPublishedChanges(content?: EditableContent | null): boolean {
  if (!isPublishedListingContent(content)) return false;
  const currentSha = String(content?.workflow?.current_sha || '').trim();
  const publishedSha = String(content?.workflow?.published_sha || '').trim();
  return Boolean(currentSha && publishedSha && currentSha !== publishedSha);
}

export function saveActionLabel(content?: EditableContent | null): string {
  return hasPublishedVersion(content) ? 'Guardar cambios' : 'Guardar borrador';
}
