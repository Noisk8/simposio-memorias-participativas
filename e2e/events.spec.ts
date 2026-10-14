import { expect, test } from '@playwright/test';

test('la navegación abre la Agenda y Programa redirige a ella', async ({ page }) => {
  await page.goto('/agenda/');
  await expect(page.locator('main h1')).toHaveText('Agenda');
  await expect(page.locator('main')).toContainText('colectivos y agentes de la Red');
  await expect(page.getByRole('heading', { name: 'Próximos eventos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eventos anteriores' })).toBeVisible();
  await expect(page.locator('header a[href="/agenda"]').first()).toHaveText('Agenda');
  await page.goto('/programa/');
  await expect(page).toHaveURL(/\/agenda\/?$/);
  await expect(page.locator('main h1')).toHaveText('Agenda');
});

test('el CMS guarda los datos de un evento usando el flujo editorial existente', async ({
  page,
}) => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'eventos@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
  };
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url'),
    'test-signature',
  ].join('.');
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      json: {
        access_token: token,
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      },
    })
  );
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  const permissions = [
    'evento.read',
    'evento.create',
    'evento.update',
    'evento.publish',
    'evento.archive',
  ];
  let received: { data: Record<string, unknown>; body: string } | undefined;
  let saved: Record<string, unknown> | undefined;
  await page.route('**/.netlify/functions/manage-content?**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      expect(url.searchParams.get('collection')).toBe('eventos');
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
      received = route.request().postDataJSON();
      saved = {
        path: 'src/content/eventos/encuentro-de-la-red.md',
        revision: 1,
        sha: 'test-sha',
        data: {
          ...received?.data,
          id: '00000000-0000-4000-8000-000000000002',
          draft: true,
          workflow_state: 'draft',
        },
        body: received?.body || '',
        workflow: { workflow_state: 'draft', publication_state: 'idle' },
      };
      await route.fulfill({ status: 201, json: { ok: true, item: saved } });
      return;
    }
    await route.fulfill({
      json: url.searchParams.has('path')
        ? { ok: true, item: saved, permissions }
        : { ok: true, items: [], permissions },
    });
  });
  await page.route('**/.netlify/functions/deploy-status', (route) =>
    route.fulfill({ json: { state: 'success' } })
  );
  await page.goto(
    '/admin/login?next=' + encodeURIComponent('/admin/contenidos?collection=eventos&new=1')
  );
  await page.locator('#supabase-email').fill(user.email);
  await page.locator('#supabase-password').fill('test-password');
  await page.locator('#supabase-login-submit').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#collection')).toHaveValue('eventos');
  const fields = {
    title: 'Encuentro de la Red',
    date: '2026-10-24',
    description: 'Encuentro organizado por los colectivos de la Red.',
    image: '/images/hero-bg.jpg',
    address: 'Universidad de Granada',
    organizer: 'Colectivo de memorias',
  };
  for (const [key, value] of Object.entries(fields)) {
    await page.locator(`[data-key="${key}"]`).fill(value);
  }
  await expect(page.locator('#fields').getByRole('button', { name: /biblioteca/i })).toBeVisible();
  await page.locator('#save-draft-button').click();
  await expect(page.locator('#status')).toContainText('Borrador guardado en Supabase');
  for (const [key, value] of Object.entries(fields)) expect(received?.data[key]).toBe(value);
  await expect(page.locator('#live-preview')).toContainText(fields.address);
  await expect(page.locator('#live-preview')).toContainText(fields.organizer);
});
