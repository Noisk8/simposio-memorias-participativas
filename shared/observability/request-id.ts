import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_CACHE = Symbol.for('simposio.requestId');

export function getRequestId(event: any): string {
  if (event?.[REQUEST_ID_CACHE]) return event[REQUEST_ID_CACHE];
  const candidate = String(
    event?.headers?.['x-request-id'] || event?.headers?.['X-Request-Id'] || ''
  ).trim();
  const requestId = UUID_PATTERN.test(candidate) ? candidate : randomUUID();
  if (event && typeof event === 'object') {
    Object.defineProperty(event, REQUEST_ID_CACHE, { value: requestId, enumerable: false });
  }
  return requestId;
}
