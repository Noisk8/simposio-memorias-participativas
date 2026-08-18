import type { User } from '@supabase/supabase-js';

export type SupabaseAuthApi = {
  ready: Promise<boolean>;
  getToken: () => Promise<string | null>;
  getUser: () => Promise<User | null>;
  signOut: () => Promise<void>;
};

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    supabaseAuth?: SupabaseAuthApi;
    cmsMediaPreviewBase?: string;
  }
}

export async function waitForAdminAuth(timeoutMs = 10_000): Promise<SupabaseAuthApi> {
  const startedAt = Date.now();
  while (!window.supabaseAuth) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('La autenticación administrativa no respondió a tiempo.');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  await window.supabaseAuth.ready;
  return window.supabaseAuth;
}

export async function getAdminToken(): Promise<string> {
  const auth = await waitForAdminAuth();
  const token = await auth.getToken();
  if (!token) throw new Error('La sesión expiró. Vuelve a iniciar sesión.');
  return token;
}

export async function adminApi(path: string, init: RequestInit = {}) {
  const token = await getAdminToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || payload?.error || `Error HTTP ${response.status}`
    );
    Object.assign(error, { status: response.status, payload });
    throw error;
  }
  return payload;
}
