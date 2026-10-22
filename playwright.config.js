import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
