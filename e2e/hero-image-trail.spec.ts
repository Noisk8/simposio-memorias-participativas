import { expect, test } from '@playwright/test';

const trailPhotoPattern =
  /^https:\/\/cms-media\.web\.red-memorias\.duckdns\.org\/images\/2026\/10\/[^/]+\.webp$/;
const imageFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6n8AAAAASUVORK5CYII=',
  'base64'
);

test.beforeEach(async ({ page }) => {
  await page.route('https://cms-media.web.red-memorias.duckdns.org/**', (route) =>
    trailPhotoPattern.test(route.request().url())
      ? route.fulfill({ contentType: 'image/png', body: imageFixture })
      : route.abort()
  );
});

const visibleCards = async (page: import('@playwright/test').Page) =>
  page
    .locator('.home-hero-trail-card')
    .evaluateAll(
      (cards) => cards.filter((card) => Number(getComputedStyle(card).opacity) > 0.1).length
    );

async function moveAcrossHero(page: import('@playwright/test').Page) {
  const bounds = (await page.locator('[data-home-hero]').boundingBox())!;
  await page.mouse.move(180, bounds.y + bounds.height * 0.4);
  await expect(page.locator('.home-hero-trail-card')).toHaveCount(8);
  await expect(page.locator('[data-hero-trail] img[data-image-ready]')).not.toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('[data-hero-trail] img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
        )
    )
    .toBe(true);
  for (const [x, fraction] of [
    [300, 0.4],
    [500, 0.55],
    [700, 0.35],
    [900, 0.5],
    [1100, 0.45],
  ]) {
    await page.mouse.move(x, bounds.y + bounds.height * fraction, { steps: 4 });
    await page.waitForTimeout(90);
  }
}

test('la estela sigue el mouse, conserva el título y se desvanece al detenerse', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  const title = page.locator('.home-hero h1');
  const text = await title.textContent();
  const originalBounds = await title.boundingBox();
  await expect(page.locator('[data-hero-trail] img')).toHaveCount(0);
  await moveAcrossHero(page);
  await expect.poll(() => visibleCards(page)).toBeGreaterThanOrEqual(3);
  await expect(title).toBeVisible();
  await expect(title).toHaveText(text!);
  expect(await title.boundingBox()).toEqual(originalBounds);
  await expect(page.locator('.home-hero-copy')).toHaveCSS('opacity', '1');
  await expect(page.locator('.home-hero-copy')).toHaveCSS('z-index', '2');
  await expect(page.locator('[data-hero-trail]')).toHaveCSS('z-index', '1');
  await expect(page.locator('[data-hero-trail]')).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => visibleCards(page)).toBe(0);

  // La segunda pasada reutiliza el mismo grupo de imágenes.
  await moveAcrossHero(page);
  await expect.poll(() => visibleCards(page)).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.home-hero-trail-card')).toHaveCount(8);
  await page.mouse.move(10, 10);
  await expect.poll(() => visibleCards(page)).toBe(0);
  await page.locator('.home-scroll-cue').click();
  await expect(page).toHaveURL(/#videoresumen$/);
});

test('el movimiento reducido evita cargar la estela y cancela imágenes ya activas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (trailPhotoPattern.test(request.url())) requests.push(request.url());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = (await page.locator('[data-home-hero]').boundingBox())!;
  await page.mouse.move(500, hero.y + hero.height / 2);
  await page.mouse.move(900, hero.y + hero.height / 2, { steps: 6 });
  expect(requests).toHaveLength(0);
  await expect(page.locator('[data-hero-trail] img')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await moveAcrossHero(page);
  await expect.poll(() => visibleCards(page)).toBeGreaterThanOrEqual(3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-hero-trail]')).toHaveCSS('display', 'none');
  await expect.poll(() => visibleCards(page)).toBe(0);
  await expect(page.locator('.home-hero h1')).toBeVisible();
});

test.describe('estela en pantalla táctil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('los gestos táctiles conservan el hero y no descargan las imágenes decorativas', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (trailPhotoPattern.test(request.url())) requests.push(request.url());
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-home-hero]').dispatchEvent('pointermove', {
      pointerType: 'touch',
      clientX: 200,
      clientY: 400,
    });
    await page.mouse.move(200, 450);
    await expect(page.locator('[data-hero-trail]')).toHaveCSS('display', 'none');
    await expect(page.locator('[data-hero-trail] img')).toHaveCount(0);
    expect(requests).toHaveLength(0);
    await expect(page.locator('.home-hero h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    await page.locator('.home-scroll-cue').click();
    await expect(page).toHaveURL(/#videoresumen$/);
  });
});

for (const failedImage of [false, true]) {
  test(
    'el banco mezcla todas las fotos sin repetir' +
      (failedImage ? ' y omite una foto fallida' : ''),
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        const shown: string[] = [];
        Object.assign(window, { trailShown: shown });
        const original = Element.prototype.animate;
        Element.prototype.animate = function (...args: Parameters<typeof original>) {
          if (this.classList.contains('home-hero-trail-card')) {
            shown.push(this.querySelector('img')!.src);
          }
          return original.apply(this, args);
        };
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const bank: string[] = await page
        .locator('[data-hero-trail]')
        .evaluate((element) => JSON.parse((element as HTMLElement).dataset.trailImages!));
      expect(bank).toHaveLength(30);
      expect(new Set(bank).size).toBe(30);
      if (failedImage) await page.route(bank[0], (route) => route.abort());
      const cycleSize = failedImage ? 29 : 30;
      for (let step = 0; step < 70; step++) {
        await page.mouse.move(step % 2 ? 1100 : 200, 360);
        await page.waitForTimeout(100);
        const count = await page.evaluate(
          () => (window as unknown as { trailShown: string[] }).trailShown.length
        );
        if (count >= cycleSize * 2 + 1) break;
      }
      const shown = await page.evaluate(
        () => (window as unknown as { trailShown: string[] }).trailShown
      );
      expect(shown.length).toBeGreaterThanOrEqual(cycleSize * 2 + 1);
      for (const start of [0, cycleSize]) {
        const cycle = shown.slice(start, start + cycleSize);
        expect(new Set(cycle).size).toBe(cycleSize);
        expect([...cycle].sort()).toEqual(
          bank.filter((src) => !failedImage || src !== bank[0]).sort()
        );
      }
      expect(shown[cycleSize]).not.toBe(shown[cycleSize - 1]);
      expect(shown.slice(0, cycleSize)).not.toEqual(shown.slice(cycleSize, cycleSize * 2));
      await expect(page.locator('.home-hero-trail-card')).toHaveCount(8);
      expect(await page.locator('[data-hero-trail] img').count()).toBeLessThanOrEqual(8);
    }
  );
}
