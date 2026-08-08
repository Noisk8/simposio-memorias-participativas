import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  browserClient = url && anonKey ? createClient(url, anonKey) : null;
  return browserClient;
}

export function safeAdminRedirect(candidate: string | null, fallback = '/admin/'): string {
  if (!candidate || !candidate.startsWith('/admin') || candidate.startsWith('//')) return fallback;
  return candidate;
}
