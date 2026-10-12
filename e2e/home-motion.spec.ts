/* global SVGPathElement */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Las verificaciones de movimiento no dependen del servidor de vídeo ni del codec.
  await page.route('https://cms-media.web.red-memorias.duckdns.org/**', (route) => route.abort());
});

test('el vector y la expansión del video siguen el scroll en ambas direcciones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const intro = page.locator('[data-reel-intro]');
  const stage = page.locator('[data-video-stage]');
  const frame = page.locator('[data-video-frame]');
  const path = page.locator('[data-vector-path]');
  await expect(path).toHaveAttribute('d', /^M/);
  const introBounds = (await intro.boundingBox())!;
  const heroBounds = (await page.locator('[data-home-hero]').boundingBox())!;
  const startY = await path.evaluate((element) => {
    const vector = element.closest('svg')!;
    return vector.getBoundingClientRect().top + (element as SVGPathElement).getPointAtLength(0).y;
  });
  expect(startY).toBeGreaterThan(heroBounds.y + heroBounds.height + 6);
  expect(startY).toBeGreaterThanOrEqual(introBounds.y);
  expect(startY).toBeLessThan(introBounds.y + introBounds.height);
  await expect(page.locator('[data-vector-tip]')).toHaveAttribute('opacity', '0');
  const introTop = await intro.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY
  );
  const stageTop = await stage.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY
  );
  const drawnProgress = () =>
    path.evaluate(
      (element) =>
        1 -
        Number(element.getAttribute('stroke-dashoffset')) /
          Number(element.getAttribute('stroke-dasharray'))
    );

  await page.evaluate((top) => window.scrollTo(0, top - 650), introTop);
  await expect(page.locator('[data-vector-tip]')).toHaveAttribute('opacity', '1');
  const initialProgress = await drawnProgress();
  await page.evaluate((top) => window.scrollTo(0, top - 200), introTop);
  await expect.poll(drawnProgress).toBeGreaterThan(initialProgress);

  await page.evaluate((top) => window.scrollTo(0, top - 680), stageTop);
  await page.waitForTimeout(500);
  const compactWidth = (await frame.boundingBox())!.width;
  await page.evaluate((top) => window.scrollTo(0, top + 180), stageTop);
  await expect
    .poll(async () => (await frame.boundingBox())!.width)
    .toBeGreaterThan(compactWidth * 1.2);

  await page.evaluate((top) => window.scrollTo(0, top - 680), stageTop);
  await expect
    .poll(async () => (await frame.boundingBox())!.width)
    .toBeLessThan(compactWidth * 1.05);
  await page.evaluate((top) => window.scrollTo(0, top - 650), introTop);
  await expect.poll(drawnProgress).toBeCloseTo(initialProgress, 3);
});

test('movimiento reducido conserva el contenido y desactiva la escena fija', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('[data-vector-path]')).toHaveAttribute('d', /^M/);
  await page.locator('[data-reel-video]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-reel-video]')).toBeVisible();
  await expect(page.locator('.home-video-sticky')).toHaveCSS('position', 'relative');
  await expect(page.locator('[data-video-frame]')).toHaveCSS('transform', 'none');
  expect(await page.evaluate(() => document.querySelector('video')?.paused)).toBe(true);
  await page.locator('a[href="/simposios"]').last().scrollIntoViewIfNeeded();
  await expect(page.locator('a[href="/simposios"]').last()).toBeVisible();
});

test('el home se adapta al móvil sin desbordamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const selector of [
    'main h1',
    '#home-reel-title',
    '[data-reel-video]',
    '.home-explore-card',
  ]) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await expect(page.locator(selector).first()).toBeVisible();
    if (selector === '.home-explore-card') {
      await expect(page.locator(selector).first()).toHaveAttribute('data-home-reveal', 'visible');
      await expect(page.locator(selector).first()).toHaveCSS('clip-path', 'inset(-24px)');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
  }
  await expect(page.locator('.home-video-sticky')).toHaveCSS('position', 'relative');
});

test('el vector continúa por Cartel Oficial, Explora e Instagram y se recoge al subir', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'networkidle' });
  const path = page.locator('[data-vector-path]');
  const tip = page.locator('[data-vector-tip]');
  let previousOffset = Number(await path.getAttribute('stroke-dashoffset'));
  for (const name of ['poster', 'explore', 'instagram']) {
    const section = page.locator(`[data-vector-section="${name}"]`);
    await section.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY + bounds.top + bounds.height * 0.5 - window.innerHeight * 0.82
      );
    });
    await expect
      .poll(async () => Number(await path.getAttribute('stroke-dashoffset')))
      .toBeLessThan(previousOffset);
    const content = section.locator('[data-home-reveal]').first();
    await expect(content).toHaveAttribute('data-home-reveal', 'visible');
    await expect(content).toHaveCSS('clip-path', 'inset(-24px)');
    if (name === 'poster') {
      await expect
        .poll(
          async () =>
            await section.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
        )
        .toBeGreaterThan(0);
    }
    previousOffset = Number(await path.getAttribute('stroke-dashoffset'));
    const sectionBounds = (await section.boundingBox())!;
    const tipBounds = (await tip.boundingBox())!;
    expect(tipBounds.y).toBeGreaterThan(sectionBounds.y);
    expect(tipBounds.y).toBeLessThan(sectionBounds.y + sectionBounds.height);
    expect(tipBounds.y + tipBounds.height / 2).toBeCloseTo(900 * 0.82, -1);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => Number(await path.getAttribute('stroke-dashoffset'))).toBe(0);
  await page.locator('[data-vector-section="poster"]').evaluate((element) => {
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 150);
  });
  await expect
    .poll(async () => Number(await path.getAttribute('stroke-dashoffset')))
    .toBeGreaterThan(previousOffset);
});

test('el recorrido se recalcula al cambiar a móvil y al variar la altura del cartel', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const vector = page.locator('[data-home-vector]');
  const originalViewBox = await vector.getAttribute('viewBox');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => await vector.getAttribute('viewBox')).not.toBe(originalViewBox);
  const mobileViewBox = await vector.getAttribute('viewBox');
  await page.locator('[data-vector-section="poster"]').evaluate((section) => {
    (section as HTMLElement).style.paddingBottom = '400px';
  });
  await expect.poll(async () => await vector.getAttribute('viewBox')).not.toBe(mobileViewBox);
  for (const name of ['poster', 'explore', 'instagram']) {
    await page.locator(`[data-vector-section="${name}"]`).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY + bounds.top + bounds.height * 0.5 - window.innerHeight * 0.82
      );
    });
    await expect
      .poll(async () => {
        const tipBounds = (await page.locator('[data-vector-tip]').boundingBox())!;
        return Math.abs(tipBounds.y + tipBounds.height / 2 - 844 * 0.82);
      })
      .toBeLessThan(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
  }
});

test('sin JavaScript siguen disponibles el video y los enlaces del home', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('[data-vector-path]')).not.toHaveAttribute('d');
  await expect(page.locator('[data-vector-tip]')).toHaveAttribute('opacity', '0');
  await page.locator('[data-reel-video]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-reel-video]')).toBeVisible();
  await expect(page.locator('[data-reel-video]')).toHaveAttribute('controls', '');
  await page.locator('.home-explore-card').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.home-explore-card').first()).toBeVisible();
  await context.close();
});
