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

test('404: una ruta inexistente devuelve la página personalizada', async ({ page }) => {
  const response = await page.goto('/ruta-que-no-existe');
  expect(response?.status()).toBe(404);
  await expect(page.locator('main h1')).toContainText('Página no encontrada');
});

test('admin: la pantalla de login carga sin sesión', async ({ page }) => {
  const response = await page.goto('/admin/login');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
});
