import { checkRateLimit, errorResponse, getCorsHeaders } from '../security';
import { requirePermission } from '../../shared/auth/require-permission.ts';
import { getAdminClient } from '../../shared/supabase/admin-client.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  InternalError,
  RateLimitError,
  ValidationError,
} from '../../shared/observability/errors.ts';

const TRANSITIONS = {
  submit_review: { from: ['draft', 'changes_requested'], to: 'in_review', suffix: 'submit_review' },
  request_changes: { from: ['in_review'], to: 'changes_requested', suffix: 'approve' },
  approve: { from: ['in_review'], to: 'approved', suffix: 'approve' },
  publish: { from: ['approved'], to: 'published', suffix: 'publish' },
  archive: { from: ['published'], to: 'archived', suffix: 'archive' },
} as const;

export const handler = async (event: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, POST, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  try {
    if (!['GET', 'POST'].includes(event.httpMethod))
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    const path =
      event.httpMethod === 'GET'
        ? event.queryStringParameters?.path
        : JSON.parse(event.body || '{}').path;
    if (typeof path !== 'string' || !path.startsWith('src/content/'))
      throw new ValidationError('Ruta editorial inválida.');
    const client = getAdminClient();
    if (!client) throw new InternalError('Supabase no está configurado.');

    if (event.httpMethod === 'GET') {
      const auth = await requirePermission(event, 'admin.access');
      const { data, error } = await client
        .from('cms_content_records')
        .select('*, cms_workflow_events(*)')
        .eq('path', path)
        .maybeSingle();
      if (error) throw new InternalError('No se pudo consultar el estado editorial.');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          record: data,
          permissions: auth.permissions,
          roles: auth.roles,
          requestId,
        }),
      };
    }

    const payload = JSON.parse(event.body || '{}');
    const transition = TRANSITIONS[payload.transition as keyof typeof TRANSITIONS];
    if (!transition) throw new ValidationError('Transición editorial inválida.');
    const collection = path.split('/')[2];
    const permissionBase =
      collection === 'entradas'
        ? 'entrada'
        : collection === 'memorias'
          ? 'memoria'
          : collection === 'paginas'
            ? 'pagina'
            : collection === 'simposios'
              ? 'simposio'
              : null;
    if (!permissionBase) throw new ValidationError('Esta colección no usa flujo editorial.');
    const auth = await requirePermission(event, `${permissionBase}.${transition.suffix}`);
    const limit = checkRateLimit('write', `workflow:${auth.user.id}`);
    if (!limit.allowed) throw new RateLimitError(Math.ceil(limit.retryAfterMs / 1000));
    const { data: record, error: readError } = await client
      .from('cms_content_records')
      .select('*')
      .eq('path', path)
      .maybeSingle();
    if (readError || !record)
      throw new AppError('NOT_FOUND', 'No existe registro editorial para este contenido.', 404);
    if (!transition.from.includes(record.workflow_state as never))
      throw new ConflictError(`No se puede pasar de ${record.workflow_state} a ${transition.to}.`);
    if (
      payload.transition === 'submit_review' &&
      record.owner_id !== auth.user.id &&
      !auth.roles.some((role: string) => ['superadmin', 'admin', 'editor'].includes(role))
    ) {
      throw new AuthorizationError(
        'Solo la persona autora puede enviar este contenido a revisión.'
      );
    }
    const comment =
      typeof payload.comment === 'string' ? payload.comment.trim().slice(0, 2000) : '';
    const { error: updateError } = await client
      .from('cms_content_records')
      .update({
        workflow_state: transition.to,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
      .eq('workflow_state', record.workflow_state);
    if (updateError) throw new ConflictError('El estado cambió mientras realizabas la operación.');
    await client.from('cms_workflow_events').insert({
      content_id: record.id,
      from_state: record.workflow_state,
      to_state: transition.to,
      comment,
      actor_id: auth.user.id,
    });
    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: `workflow.${payload.transition}`,
      resourceType: collection,
      resourceId: path,
      result: 'success',
      metadata: { from: record.workflow_state, to: transition.to },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, state: transition.to, requestId }),
    };
  } catch (error) {
    return errorResponse(error, headers, requestId);
  }
};
