import { randomUUID } from 'node:crypto';
import { logEvent, sendOperationalAlert } from '../../shared/observability/logger.ts';

export const handler = async () => {
  const requestId = randomUUID();
  const hookUrl = String(process.env.SCHEDULED_BUILD_HOOK_URL || '').trim();

  if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9_-]+$/.test(hookUrl)) {
    const failure = { requestId, reason: 'missing_or_invalid_build_hook' };
    logEvent('error', 'scheduled_publish.configuration_failed', failure);
    await sendOperationalAlert('scheduled_publish.configuration_failed', failure);
    return {
      statusCode: 503,
      body: JSON.stringify({ ok: false, requestId, error: failure.reason }),
    };
  }

  try {
    const response = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_title: 'Activación editorial programada' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Netlify respondió ${response.status}.`);

    const deploy = await response.json().catch(() => ({}));
    logEvent('info', 'scheduled_publish.build_requested', {
      requestId,
      deployId: deploy?.id || null,
    });
    return {
      statusCode: 202,
      body: JSON.stringify({ ok: true, requestId, deployId: deploy?.id || null }),
    };
  } catch (error) {
    const failure = {
      requestId,
      reason: error instanceof Error ? error.message : String(error),
    };
    logEvent('error', 'scheduled_publish.build_failed', failure);
    await sendOperationalAlert('scheduled_publish.build_failed', failure);
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, requestId, error: failure.reason }),
    };
  }
};
