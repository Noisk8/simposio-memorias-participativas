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

async function deliverAlert(entry: Record<string, unknown>) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return false;
  const text = `[simposio-cms] ${entry.event}: ${JSON.stringify(entry)}`;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  });
  return response.ok;
}

export async function sendOperationalAlert(event: string, context: Record<string, unknown> = {}) {
  const entry = sanitize({
    level: 'error',
    event,
    timestamp: new Date().toISOString(),
    ...context,
  }) as Record<string, unknown>;
  try {
    return await deliverAlert(entry);
  } catch {
    return false;
  }
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
  }) as Record<string, unknown>;
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    deliverAlert(entry).catch(() => {
      // La alerta nunca debe interrumpir la petición que la originó.
    });
  } else if (level === 'warn') console.warn(line);
  else console.log(line);
}
