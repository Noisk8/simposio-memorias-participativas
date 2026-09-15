import { expect, test } from '@playwright/test';

test('home: carga con título y encabezado del simposio', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Simposio/i);
  await expect(page.locator('main h1')).toBeVisible();
});

test('entradas: el listado muestra artículos y el detalle navega', async ({ page }) => {
  const response = await page.goto('/entradas/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main h1')).toBeVisible();

  const firstLink = page.locator('article a[href^="/entradas/"]').first();
  await expect(firstLink).toBeVisible();
  await firstLink.click();
  await expect(page).toHaveURL(/\/entradas\/.+/);
  await expect(page.locator('main > section').first().locator('h1')).toBeVisible();
});

test('museo-memorias: el archivo lista memorias y el detalle navega', async ({ page }) => {
  const response = await page.goto('/museo-memorias/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main h1')).toContainText('Museo de Memorias Vivas');

  const firstMemory = page.locator('a[href^="/museo-memorias/"]:not([href*="/page/"])').first();
  await expect(firstMemory).toBeVisible();
  await firstMemory.click();
  await expect(page).toHaveURL(/\/museo-memorias\/\d+/);
  await expect(page.locator('main h1')).toBeVisible();
});

test('buscar: la interfaz de Pagefind está disponible tras el build', async ({ page }) => {
  const script = await page.request.get('/pagefind/pagefind-ui.js');
  expect(script.ok()).toBeTruthy();

  const response = await page.goto('/buscar');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#pagefind-ui')).toBeAttached();
});

test('taxonomías: los archivos de categorías y etiquetas responden', async ({ page }) => {
  for (const path of ['/categorias/', '/etiquetas/']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
  }
});

test('contacto: está disponible desde el menú y muestra los canales de contacto', async ({
  page,
}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  const menuLink = page.locator('header a[href="/contacto"]').first();
  await expect(menuLink).toHaveText('Contacto');
  await menuLink.click();

  await expect(page).toHaveURL(/\/contacto\/?$/);
  await expect(page.locator('main h1')).toHaveText('Contacto');
  await expect(page.locator('header a[href="/contacto"]').first()).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.locator('main a[href^="mailto:"]')).toBeVisible();
  await expect(page.locator('main a[href*="instagram.com"]')).toBeVisible();
});

test('404: una ruta inexistente devuelve la página personalizada', async ({ page }) => {
  const response = await page.goto('/ruta-que-no-existe');
  expect(response?.status()).toBe(404);
  await expect(page.locator('main h1')).toContainText('Página no encontrada');
});

test('admin: la pantalla de login muestra el formulario sin sesión', async ({ page }) => {
  const response = await page.goto('/admin/login');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  await expect(page.locator('#supabase-email')).toBeVisible();
  await expect(page.locator('#supabase-password')).toBeVisible();
});

test('admin: el formulario de login es visible aunque JavaScript falle', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto('/admin/login');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  await context.close();
});
