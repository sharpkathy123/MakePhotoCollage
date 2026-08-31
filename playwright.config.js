// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Plain Python static server: zero extra dependency, and present by
    // default on GitHub Actions' ubuntu-latest runners.
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Some sandboxes pre-provision a Chromium build at a fixed path and
        // set this env var to skip Playwright's own download step; point
        // directly at it there since its bundled revision can lag behind
        // whatever @playwright/test version got installed. CI and normal
        // local setups (where this isn't set) use Playwright's own
        // `npx playwright install` browsers as usual.
        launchOptions: require('fs').existsSync('/opt/pw-browsers/chromium')
          ? { executablePath: '/opt/pw-browsers/chromium' }
          : {},
      },
    },
  ],
});
