export type PageRelationData = {
  id?: string;
  simposio?: string;
};

export type EntryRelationData = {
  page_id?: string;
  simposio?: string;
};

export function entryBelongsToPage(
  entry: { data: EntryRelationData },
  page: { data: PageRelationData }
) {
  const pageId = String(page.data.id || '').trim();
  const assignedPageId = String(entry.data.page_id || '').trim();
  return (
    Boolean(pageId) &&
    assignedPageId === pageId &&
    String(entry.data.simposio || '') === String(page.data.simposio || '')
  );
}
