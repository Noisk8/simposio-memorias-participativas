import { defineConfig } from '@playwright/test';

const remoteBaseUrl = String(process.env.E2E_BASE_URL || '').replace(/\/+$/, '');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: remoteBaseUrl || 'http://localhost:4325',
  },
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: 'node scripts/preview-static.mjs',
        url: 'http://localhost:4325',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
