import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
// Use a pre-installed Chromium when provided (e.g. sandboxed dev containers).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'off',
    serviceWorkers: 'block',
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : {}
  },
  projects: [
    { name: 'desktop-chromium', testIgnore: /mobile\.spec\.mjs/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      testMatch: /mobile\.spec\.mjs/,
      use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' }
    }
  ],
  webServer: {
    command: `node scripts/serve-static.mjs ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
