import { expect, test } from '@playwright/test';

const assertImagesRendered = async (page: import('@playwright/test').Page) => {
  const images = page.locator('img');
  expect(await images.count()).toBeGreaterThan(0);

  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every((image) => image instanceof HTMLImageElement && image.complete)
      )
    )
    .toBe(true);

  const states = await images.evaluateAll((elements) =>
    elements.map((image) => {
      const element = image as HTMLImageElement;
      return {
        source: element.currentSrc || element.src,
        naturalWidth: element.naturalWidth,
        opacity: getComputedStyle(element).opacity,
      };
    })
  );

  for (const state of states) {
    expect(state.naturalWidth, state.source).toBeGreaterThan(0);
    expect(state.opacity, state.source).not.toBe('0');
  }
};

test('las imágenes cargan y el skeleton las revela', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await assertImagesRendered(page);
  await expect(page.locator('html')).toHaveClass(/image-loading-active/);
  await expect(page.locator('img:not([data-image-ready])')).toHaveCount(0);
});

test.describe('skeleton fail-open', () => {
  test.use({ javaScriptEnabled: false });

  test('las imágenes permanecen visibles si JavaScript no se ejecuta', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await assertImagesRendered(page);
    await expect(page.locator('html')).not.toHaveClass(/image-loading-active/);
  });
});
