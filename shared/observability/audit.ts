import { InternalError } from './errors.ts';
import { logEvent } from './logger.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

export type AuditInput = {
  requestId: string;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: 'allowed' | 'denied' | 'success' | 'failure';
  metadata?: Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAuditResource(
  resourceId: string | null | undefined,
  metadata: Record<string, unknown> = {}
) {
  if (!resourceId || UUID_PATTERN.test(resourceId)) {
    return { resourceId: resourceId || null, metadata };
  }
  return { resourceId: null, metadata: { ...metadata, resourceRef: resourceId } };
}

export async function recordAudit(input: AuditInput, client = getAdminClient()): Promise<void> {
  const normalizedResource = normalizeAuditResource(input.resourceId, input.metadata);
  logEvent(input.result === 'failure' ? 'error' : 'info', 'audit.record', {
    requestId: input.requestId,
    actorId: input.actorId || null,
    action: input.action,
    resourceType: input.resourceType || null,
    resourceId: normalizedResource.resourceId,
    result: input.result,
    metadata: normalizedResource.metadata,
  });

  if (!client) throw new InternalError('Supabase no está configurado en este entorno.');

  const { error } = await client.from('audit_log').insert({
    request_id: input.requestId,
    actor_id: input.actorId || null,
    action: input.action,
    resource_type: input.resourceType || null,
    resource_id: normalizedResource.resourceId,
    result: input.result,
    metadata: normalizedResource.metadata,
  });

  if (error) {
    logEvent('error', 'audit.persist.failed', {
      requestId: input.requestId,
      action: input.action,
      message: error.message,
    });
    throw new InternalError('No se pudo registrar la auditoría.');
  }
}
