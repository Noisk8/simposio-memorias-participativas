import { setTimeout as sleep } from 'node:timers/promises';

const siteId = String(process.env.NETLIFY_SITE_ID || '').trim();
const targetSha = String(process.env.GITHUB_SHA || '').toLowerCase();
const timeoutMs = Number(process.env.TIMEOUT_MS || 300000);
const intervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);

async function currentDeploy() {
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=10`);
  if (!res.ok) return null;
  const deploys = await res.json();
  return Array.isArray(deploys)
    ? deploys.find((d) => String(d.commit_ref || '').toLowerCase() === targetSha) || null
    : null;
}

async function main() {
  if (!siteId || !targetSha) {
    console.error('✖ Faltan NETLIFY_SITE_ID o GITHUB_SHA.');
    process.exitCode = 1;
    return;
  }
  const deadline = Date.now() + timeoutMs;
  let latest = 'desconocido';
  while (Date.now() < deadline) {
    const deploy = await currentDeploy();
    if (!deploy) {
      latest = 'aún sin deploy (posible build automatizado no iniciado)';
    } else {
      latest = deploy.state;
      if (String(deploy.state).toLowerCase() === 'ready') {
        console.log(`✓ Deploy ready (${deploy.id})`);
        process.exit(0);
      }
      if (['error', 'failed'].includes(String(deploy.state).toLowerCase())) {
        console.error(`✖ Deploy en estado ${deploy.state}.`);
        process.exitCode = 1;
        return;
      }
    }
    await sleep(intervalMs);
  }
  console.error(`✖ Tiempo de espera agotado; estado del deploy: ${latest}.`);
  process.exitCode = 1;
}

main();
