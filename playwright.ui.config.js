import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui-smoke.spec.js',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:client -- --host 127.0.0.1',
    url: 'http://localhost:5183',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'compact', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 720 } } },
  ],
});
