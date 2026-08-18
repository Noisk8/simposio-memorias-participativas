import { getSupabaseBrowserClient, safeAdminRedirect } from '../../lib/supabase-browser.ts';
import type { SupabaseAuthApi } from './client.ts';

const root = document.getElementById('supabase-auth');
const form = document.getElementById('supabase-login-form');
const errorBox = document.getElementById('supabase-login-error');
const userInfo = document.getElementById('supabase-user-info');
const signOutButton = document.getElementById('supabase-signout');

const redirectUnauthenticated = root?.dataset.redirectUnauthenticated === 'true';
const configuredRedirect = root?.dataset.redirectAfterLogin || '';
const supabase = getSupabaseBrowserClient();

function isLoginPage() {
  return window.location.pathname.replace(/\/+$/, '') === '/admin/login';
}

function loginRedirect() {
  const queryRedirect = new URLSearchParams(window.location.search).get('next');
  return safeAdminRedirect(queryRedirect, safeAdminRedirect(configuredRedirect || null));
}

function updateUI(session: { user: { email?: string } } | null) {
  if (!session) {
    if (redirectUnauthenticated && !isLoginPage()) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/admin/login?next=${encodeURIComponent(next)}`);
      return;
    }
    root?.classList.remove('hidden');
    userInfo?.classList.add('hidden');
    signOutButton?.classList.add('hidden');
    return;
  }

  root?.classList.add('hidden');
  if (userInfo) {
    userInfo.textContent = `Sesión iniciada como ${session.user.email || ''}`;
    userInfo.classList.remove('hidden');
  }
  signOutButton?.classList.remove('hidden');
  if (isLoginPage()) window.location.replace(loginRedirect());
}

async function init() {
  if (!supabase) {
    window.supabaseAuth = {
      ready: Promise.resolve(false),
      getToken: async () => null,
      getUser: async () => null,
      signOut: async () => {},
    } satisfies SupabaseAuthApi;
    root?.classList.remove('hidden');
    if (errorBox) {
      errorBox.textContent =
        'Supabase no está configurado (faltan PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY).';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  window.supabaseAuth = {
    ready: supabase.auth.getSession().then(() => true),
    getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    getUser: async () => (await supabase.auth.getSession()).data.session?.user ?? null,
    signOut: async () => {
      await supabase.auth.signOut();
      window.location.assign('/admin/login');
    },
  } satisfies SupabaseAuthApi;

  const initialSession = (await supabase.auth.getSession()).data.session;
  updateUI(initialSession);
  supabase.auth.onAuthStateChange((_event, session) => {
    updateUI(session);
    window.dispatchEvent(new CustomEvent('supabase-auth'));
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email =
      (document.getElementById('supabase-email') as HTMLInputElement | null)?.value.trim() ?? '';
    const password =
      (document.getElementById('supabase-password') as HTMLInputElement | null)?.value ?? '';
    errorBox?.classList.add('hidden');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error && errorBox) {
      errorBox.textContent =
        'No se pudo iniciar sesión: ' + (error.message || 'revisa email y contraseña.');
      errorBox.classList.remove('hidden');
    }
  });

  signOutButton?.addEventListener('click', () => window.supabaseAuth?.signOut());
}

void init();
