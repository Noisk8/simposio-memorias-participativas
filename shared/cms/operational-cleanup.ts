import { closePullRequest, deleteOperationalBranch } from '../github/client.ts';
import { InternalError } from '../observability/errors.ts';
import { getAdminClient } from '../supabase/admin-client.ts';

const CLEANUP_AFTER_DAYS = 7;
const SUCCESSFUL_DELETE_STATUSES = new Set([204, 404]);
const SUCCESSFUL_CLOSE_STATUSES = new Set([200, 404]);

export async function cleanupOperationalPublications() {
  const client = getAdminClient();
  if (!client) throw new InternalError('Supabase no está configurado en este entorno.');
  const cutoff = new Date(Date.now() - CLEANUP_AFTER_DAYS * 86_400_000).toISOString();
  const { data, error } = await client
    .from('cms_publications')
    .select('id,status,github_branch,github_pr_number')
    .in('status', ['live', 'archived', 'failed', 'cancelled'])
    .is('operational_cleaned_at', null)
    .lte('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(50);
  if (error) throw new InternalError('No se pudieron consultar las publicaciones para limpiar.');

  let cleaned = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  for (const publication of data || []) {
    try {
      const pullRequestNumber = Number(publication.github_pr_number);
      if (
        ['failed', 'cancelled'].includes(publication.status) &&
        publication.github_pr_number !== null &&
        Number.isSafeInteger(pullRequestNumber) &&
        pullRequestNumber > 0
      ) {
        const response = await closePullRequest(pullRequestNumber);
        if (!SUCCESSFUL_CLOSE_STATUSES.has(response.status)) {
          throw new Error(`GitHub no cerró el PR (${response.status}).`);
        }
      }
      if (publication.github_branch) {
        const response = await deleteOperationalBranch(publication.github_branch);
        if (!SUCCESSFUL_DELETE_STATUSES.has(response.status)) {
          throw new Error(`GitHub no eliminó la rama (${response.status}).`);
        }
      }
      const { error: updateError } = await client
        .from('cms_publications')
        .update({ operational_cleaned_at: new Date().toISOString() })
        .eq('id', publication.id)
        .is('operational_cleaned_at', null);
      if (updateError) throw new Error('No se pudo registrar la limpieza.');
      cleaned += 1;
    } catch (error) {
      failures.push({
        id: publication.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { candidates: (data || []).length, cleaned, failures };
}
