import { randomUUID } from 'node:crypto';
import {
  reconcilePendingPublications,
  reconcilePublishedDrift,
} from '../../shared/cms/publication-service.ts';
import { cleanupOperationalPublications } from '../../shared/cms/operational-cleanup.ts';
import { getBranchHeadSha } from '../../shared/github/client.ts';
import { getLatestProductionDeploy } from '../../shared/netlify/deploys.ts';
import { logEvent, sendOperationalAlert } from '../../shared/observability/logger.ts';
import { getAdminClient } from '../../shared/supabase/admin-client.ts';

export const handler = async () => {
  const requestId = randomUUID();
  const checks: Record<string, unknown> = {};
  const failures: string[] = [];

  try {
    const reconciliation = await reconcilePendingPublications(requestId);
    checks.publications = reconciliation.processed;
  } catch (error) {
    failures.push('publication_reconciliation');
    checks.publicationsError = error instanceof Error ? error.message : String(error);
  }

  try {
    const drift = await reconcilePublishedDrift(requestId);
    checks.publishedDrift = drift;
    if (drift.stale.length || drift.failures.length) failures.push('published_content_drift');
  } catch (error) {
    failures.push('published_content_drift');
    checks.publishedDriftError = error instanceof Error ? error.message : String(error);
  }

  try {
    const cleanup = await cleanupOperationalPublications();
    checks.operationalCleanup = cleanup;
    if (cleanup.failures.length) failures.push('operational_github_cleanup');
  } catch (error) {
    failures.push('operational_github_cleanup');
    checks.operationalCleanupError = error instanceof Error ? error.message : String(error);
  }

  const client = getAdminClient();
  if (!client) {
    failures.push('supabase_configuration');
  } else {
    const { error: databaseError } = await client
      .from('cms_content_records')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    if (databaseError) failures.push('supabase_database');
    else checks.supabase = 'ok';

    const { error: pruneError } = await client.rpc('cms_prune_operational_data');
    if (pruneError) failures.push('operational_prune');
    else checks.prune = 'ok';
  }

  try {
    checks.githubSha = await getBranchHeadSha();
  } catch {
    failures.push('github');
  }

  try {
    const deploy = await getLatestProductionDeploy();
    checks.netlifyDeployId = deploy?.id || null;
    checks.netlifyState = deploy?.state || null;
    if (!deploy || deploy.state !== 'ready') failures.push('netlify_deploy');
  } catch {
    failures.push('netlify_api');
  }

  const siteUrl = String(process.env.SITE_URL || process.env.URL || '').replace(/\/+$/, '');
  if (!siteUrl) {
    failures.push('site_url');
  } else {
    try {
      const response = await fetch(siteUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      checks.siteStatus = response.status;
      if (!response.ok) failures.push('public_site');
    } catch {
      failures.push('public_site');
    }
  }

  if (failures.length) {
    logEvent('warn', 'cms_operations.health_failed', { requestId, failures, checks });
    await sendOperationalAlert('cms_operations.health_failed', { requestId, failures, checks });
  } else {
    logEvent('info', 'cms_operations.healthy', { requestId, checks });
  }

  return {
    statusCode: failures.length ? 503 : 200,
    body: JSON.stringify({ ok: failures.length === 0, requestId, failures, checks }),
  };
};
