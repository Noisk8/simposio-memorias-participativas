import { expect, test } from '@playwright/test';

test('la biblioteca sube imágenes sin crédito ni licencia y muestra la URL recibida', async ({
  page,
}) => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'media@example.com',
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
  const media = {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'foto.png',
    kind: 'image',
    size: 100,
    mimeType: 'image/webp',
    path: 'https://media.example.org/images/2026/09/photo.webp',
    publicUrl: 'https://media.example.org/images/2026/09/photo.webp',
    altText: 'Foto de prueba',
    credit: null,
    license: null,
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6n8AAAAASUVORK5CYII=',
    'base64'
  );
  await page.route('https://media.example.org/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: png })
  );
  let uploaded = false;
  await page.route('**/.netlify/functions/manage-media', (route) =>
    route.fulfill({
      json: { ok: true, media: uploaded ? [media] : [], policy: { maxBytes: 2097152 } },
    })
  );
  let received: Record<string, unknown> | undefined;
  await page.route('**/.netlify/functions/upload-media', async (route) => {
    received = route.request().postDataJSON();
    uploaded = true;
    await route.fulfill({ status: 201, json: { ok: true, media, image: media } });
  });
  await page.goto('/admin/login?next=/admin/medios');
  await page.locator('#supabase-email').fill(user.email);
  await page.locator('#supabase-password').fill('test-password');
  await page.locator('#supabase-login-submit').click();
  await expect(page).toHaveURL(/\/admin\/medios\/?$/);
  await expect(page.locator('#media-panel')).toBeVisible();
  await page
    .locator('#file')
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
  await page.locator('#alt-text').fill('Foto de prueba');
  await expect(page.locator('#credit')).not.toHaveAttribute('required', '');
  await expect(page.locator('#license')).not.toHaveAttribute('required', '');
  await page.locator('#upload-button').click();
  await expect(page.locator('#images article')).toHaveCount(1);
  expect(received?.credit).toBe('');
  expect(received?.license).toBe('');
  await expect(page.locator('#images img')).toHaveAttribute('src', media.publicUrl);
  await page.locator('#media-search').fill('foto');
  await expect(page.locator('#images article')).toHaveCount(1);
});
