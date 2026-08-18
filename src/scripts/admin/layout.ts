import { waitForAdminAuth } from './client.ts';

const root = document.documentElement;
root.dataset.adminTheme = localStorage.getItem('cms_admin_theme') || 'light';
window.cmsMediaPreviewBase = document.body.dataset.mediaPreviewBase || '';

document.getElementById('cms-theme')?.addEventListener('click', () => {
  const next = root.dataset.adminTheme === 'dark' ? 'light' : 'dark';
  root.dataset.adminTheme = next;
  localStorage.setItem('cms_admin_theme', next);
});

void waitForAdminAuth()
  .then(async (auth) => {
    const current = await auth.getUser();
    const name = current?.user_metadata?.full_name || current?.email?.split('@')[0] || 'Usuario';
    const nameNode = document.getElementById('cms-user-name');
    if (nameNode) nameNode.textContent = name;
    const avatar = document.getElementById('cms-avatar');
    if (avatar) avatar.textContent = name.slice(0, 1).toUpperCase();
  })
  .catch(() => {});

const accountButton = document.getElementById('cms-account');
const accountMenu = document.getElementById('cms-account-menu');
const accountArrow = document.getElementById('cms-account-arrow');

accountButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  const opening = accountMenu?.classList.contains('hidden') ?? false;
  accountMenu?.classList.toggle('hidden', !opening);
  accountButton.setAttribute('aria-expanded', String(opening));
  if (accountArrow) accountArrow.textContent = opening ? '⌃' : '⌄';
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.cms-account-wrap')) {
    accountMenu?.classList.add('hidden');
    accountButton?.setAttribute('aria-expanded', 'false');
    if (accountArrow) accountArrow.textContent = '⌄';
  }
});

document
  .getElementById('cms-menu-signout')
  ?.addEventListener('click', () => window.supabaseAuth?.signOut());
