import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = [
  '/',
  '/entradas/',
  '/entradas/1er-simposio/',
  '/museo-memorias/',
  '/museo-memorias/1/',
  '/buscar/',
  '/admin/login/',
];

for (const route of routes) {
  test(`accesibilidad WCAG A/AA: ${route}`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    }));
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}
