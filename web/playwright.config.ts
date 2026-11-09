import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests (spec QA-04): the studio flows people use, run in a real browser against the
 * dev server (the tests read the studio's state through its development-only handles). They use
 * the Chrome installed on this machine; set E2E_CHANNEL=msedge for Edge. Projects live in each
 * test's own fresh browser storage, so nothing on this device is touched.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    channel: process.env.E2E_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/dashboard', reuseExistingServer: true, timeout: 180_000 },
});
