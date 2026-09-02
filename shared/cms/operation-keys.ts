import type { SupabaseClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f-]{36}$/i;

export function normalizeOperationKey(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

export async function getOperationResponse(client: SupabaseClient, key: string, actorId: string) {
  const { data, error } = await client
    .from('cms_operation_keys')
    .select('response')
    .eq('operation_key', key)
    .eq('actor_id', actorId)
    .maybeSingle();
  if (error) throw error;
  return data?.response ?? null;
}

export async function saveOperationResponse(
  client: SupabaseClient,
  key: string,
  actorId: string,
  operation: string,
  resourceRef: string,
  response: unknown
) {
  const { error } = await client.from('cms_operation_keys').upsert(
    {
      operation_key: key,
      actor_id: actorId,
      operation,
      resource_ref: resourceRef,
      response,
    },
    { onConflict: 'operation_key' }
  );
  if (error) throw error;
}
