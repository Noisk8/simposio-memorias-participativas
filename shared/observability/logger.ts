const REDACTED_KEYS = /authorization|cookie|password|secret|token|service.?role|private.?key/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitize(nested),
    ])
  );
}

export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  context: Record<string, unknown> = {}
) {
  const entry = sanitize({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...context,
  });
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
