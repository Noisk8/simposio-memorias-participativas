import { randomUUID } from 'node:crypto';
import { CONTENT_COLLECTIONS, getContent } from '../shared/cms/content-service.ts';
import { githubContentsRequest } from '../shared/github/contents-client.ts';
import { getAdminClient } from '../shared/supabase/admin-client.ts';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run') || !apply;
const client = getAdminClient();

if (!client) {
  throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
}

async function migrationActor() {
  const configured = String(process.env.CMS_MIGRATION_ACTOR_ID || '').trim();
  if (configured) return { id: configured, roles: ['admin'] };
  const { data, error } = await client.from('user_roles').select('user_id, roles(key)').limit(100);
  if (error) throw new Error('No se pudo buscar una cuenta administradora para la importación.');
  for (const row of data || []) {
    const relation = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (['superadmin', 'admin', 'editor'].includes(relation?.key)) {
      return { id: row.user_id, roles: [relation.key] };
    }
  }
  throw new Error('Define CMS_MIGRATION_ACTOR_ID con el UUID de una cuenta administradora.');
}

const collections = Object.keys(CONTENT_COLLECTIONS);
const paths = [];
for (const collection of collections) {
  const response = await githubContentsRequest(`src/content/${collection}`);
  if (response.status === 404) continue;
  if (!response.ok) throw new Error(`GitHub respondió ${response.status} para ${collection}.`);
  const files = (await response.json()).filter(
    (item) => item.type === 'file' && item.name.endsWith('.md')
  );
  for (const file of files) paths.push({ collection, path: file.path });
}

let pending = 0;
for (const item of paths) {
  const { data, error } = await client
    .from('cms_content_records')
    .select('id, cms_content_drafts(content_id)')
    .eq('path', item.path)
    .maybeSingle();
  if (error) throw new Error(`No se pudo comprobar ${item.path}.`);
  const relation = data?.cms_content_drafts;
  const hasDraft = Array.isArray(relation) ? relation.length > 0 : Boolean(relation);
  if (!hasDraft) pending += 1;
}

console.log(
  JSON.stringify({ mode: dryRun ? 'dry-run' : 'apply', discovered: paths.length, pending })
);
if (dryRun) process.exit(0);

const actor = await migrationActor();
const auth = {
  requestId: randomUUID(),
  user: { id: actor.id },
  roles: actor.roles,
  permissions: [],
};
for (const item of paths) {
  await getContent({ collection: item.collection, filePath: item.path, auth });
}

console.log(JSON.stringify({ mode: 'apply', imported: pending, total: paths.length }));
