import { errorResponse, getCorsHeaders, isSafeContentPath } from '../security';
import { authorizeRequest } from '../../shared/security/rate-limit.ts';
import { recordAudit } from '../../shared/observability/audit.ts';
import { getRequestId } from '../../shared/observability/request-id.ts';
import { AppError, InternalError, ValidationError } from '../../shared/observability/errors.ts';
import { getAdminClient } from '../../shared/supabase/admin-client.ts';

const READ_PERMISSIONS: Record<string, string> = {
  entradas: 'entrada.read',
  memorias: 'memoria.read',
  paginas: 'pagina.read',
  simposios: 'simposio.read',
  categorias: 'taxonomy.read',
  etiquetas: 'taxonomy.read',
};

const REASON_LABELS: Record<string, string> = {
  import: 'Versión importada desde GitHub',
  manual_save: 'Borrador guardado',
  publication: 'Versión publicada',
  restore: 'Versión restaurada',
};

export const handler = async (event: any, context?: any) => {
  let requestId = getRequestId(event);
  let headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
    }
    const filePath = event.queryStringParameters?.path;
    if (!isSafeContentPath(filePath)) throw new ValidationError('La ruta solicitada no es válida.');
    const collection = filePath.split('/')[2];
    const permission = READ_PERMISSIONS[collection];
    if (!permission) throw new ValidationError('La colección solicitada no está permitida.');
    const auth = await authorizeRequest(event, permission, 'read', { netlifyContext: context });
    requestId = auth.requestId;
    headers = getCorsHeaders(event, 'GET, OPTIONS', requestId);
    const client = getAdminClient();
    if (!client) throw new InternalError('Supabase no está configurado.');
    const { data: record, error: recordError } = await client
      .from('cms_content_records')
      .select('id')
      .eq('path', filePath)
      .maybeSingle();
    if (recordError) throw new InternalError('No se pudo localizar el contenido.');
    if (!record) throw new AppError('NOT_FOUND', 'Contenido no encontrado.', 404);
    const { data, error } = await client
      .from('cms_content_versions')
      .select('id, version_number, content_sha, reason, created_by, created_at')
      .eq('content_id', record.id)
      .order('version_number', { ascending: false })
      .limit(30);
    if (error) throw new InternalError('No se pudo consultar el historial de versiones.');
    const revisions = (data || []).map((version: any) => ({
      sha: version.content_sha,
      message: `${REASON_LABELS[version.reason] || 'Versión editorial'} · v${version.version_number}`,
      author: version.created_by || 'Sistema',
      date: version.created_at,
      versionId: version.id,
    }));
    await recordAudit({
      requestId,
      actorId: auth.user.id,
      action: 'content.revision_history',
      resourceType: collection,
      resourceId: record.id,
      result: 'success',
      metadata: { path: filePath, count: revisions.length },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, revisions, requestId }),
    };
  } catch (error: unknown) {
    return errorResponse(error, headers, requestId);
  }
};
