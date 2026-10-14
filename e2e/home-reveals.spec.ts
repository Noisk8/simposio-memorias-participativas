import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('https://cms-media.web.red-memorias.duckdns.org/**', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-home]')).toHaveAttribute('data-motion', 'on');
  await page.evaluate(() => document.fonts.ready);
});

test('el título y el bloque de eventos entran por separado y el bloque de eventos termina completo', async ({
  page,
}) => {
  const title = page.locator('[data-vector-section="agenda"] h2');
  const card = page.locator('.home-agenda-card').first();
  test.skip(
    (await card.count()) === 0,
    'No hay eventos publicados para comprobar la animación de tarjetas.'
  );
  await expect(title).toHaveAttribute('data-home-reveal', 'pending');
  await expect(card).toHaveAttribute('data-home-reveal', 'pending');
  await expect(title).toHaveAccessibleName('Agenda');
  await expect(title.locator('.home-word').first()).toHaveCSS('opacity', '0');
  await title.evaluate((element) =>
    window.scrollTo(
      0,
      window.scrollY + element.getBoundingClientRect().top - window.innerHeight * 0.82
    )
  );
  await expect(title).toHaveAttribute('data-home-reveal', 'visible');
  await expect(card).toHaveAttribute('data-home-reveal', 'pending');
  await expect(title.locator('.home-word').last()).toHaveCSS('transform', 'none');
  await card
    .locator('..')
    .evaluate((element) =>
      window.scrollTo(
        0,
        window.scrollY + element.getBoundingClientRect().top - window.innerHeight * 0.55
      )
    );
  await expect(card).toHaveAttribute('data-home-reveal', 'visible');
  await expect(card).toHaveCSS('opacity', '1');
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(card).toHaveCSS('clip-path', 'inset(-24px)');
  await expect
    .poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test('las tarjetas aparecen en secuencia y el borde de la sección responde al scroll', async ({
  page,
}) => {
  const section = page.locator('[data-vector-section="explore"]');
  const cards = section.locator('.home-explore-card');
  const edgeShift = () =>
    section.evaluate((element) =>
      parseFloat(getComputedStyle(element).getPropertyValue('--section-edge-shift'))
    );
  await section.evaluate((element) =>
    window.scrollTo(
      0,
      window.scrollY + element.getBoundingClientRect().top - window.innerHeight * 0.9
    )
  );
  await expect.poll(edgeShift).toBeGreaterThan(30);
  const earlyShift = await edgeShift();
  await section
    .locator('.home-explore-grid')
    .evaluate((element) =>
      window.scrollTo(
        0,
        window.scrollY + element.getBoundingClientRect().top - window.innerHeight * 0.55
      )
    );
  await expect(cards.first()).toHaveAttribute('data-home-reveal', 'visible');
  await expect
    .poll(() => cards.first().evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeGreaterThan(0.08);
  const opacities = await cards.evaluateAll((elements) =>
    elements.map((element) => Number(getComputedStyle(element).opacity))
  );
  expect(opacities[0]).toBeGreaterThan(opacities[3]);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('opacity', '1');
    await expect(card).toHaveCSS('clip-path', 'inset(-24px)');
  }
  await expect.poll(edgeShift).toBeLessThan(earlyShift);
  await section.evaluate((element) =>
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top)
  );
  await expect.poll(edgeShift).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('el foco muestra inmediatamente Instagram y el movimiento reducido deja todo visible', async ({
  page,
}) => {
  const cta = page.locator('.home-social-cta');
  await expect(cta).toHaveAttribute('data-home-reveal', 'pending');
  await cta.focus();
  await expect(cta).toBeFocused();
  for (const selector of [
    '.home-social-card',
    '.home-social-icon',
    '.home-social-handle',
    '.home-social-cta',
  ]) {
    await expect(page.locator(selector)).toHaveAttribute('data-home-reveal', 'visible');
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-home]')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('[data-home-reveal="pending"]')).toHaveCount(0);
  for (const selector of [
    '.home-agenda-card',
    '.home-explore-card',
    '.home-social-card',
    '.home-word',
  ]) {
    for (const element of await page.locator(selector).all()) {
      await expect(element).toHaveCSS('transform', 'none');
      await expect(element).toHaveCSS('opacity', '1');
    }
  }
});
