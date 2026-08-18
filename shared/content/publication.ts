export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isFutureIsoDate(value: unknown, now = new Date()): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > now.getTime();
}

export function normalizePublishedContent<T extends { publish_date?: unknown }>(
  data: T,
  requestedState: string,
  now = new Date()
): T {
  if (requestedState !== 'published') return data;
  if (!String(data.publish_date || '').trim()) {
    return { ...data, publish_date: todayIsoDate(now) };
  }
  return data;
}
