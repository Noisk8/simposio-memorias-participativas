import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4325',
  },
  webServer: {
    command: 'node scripts/preview-static.mjs',
    url: 'http://localhost:4325',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
