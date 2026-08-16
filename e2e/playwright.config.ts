import { defineConfig } from '@playwright/test';

// E2E runs against the production build (vite preview). The design targets
// desktop 1440×900 — the app is desktop-only.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run build -w apps/web && npm run preview -w apps/web -- --port 4173 --strictPort',
    port: 4173,
    cwd: '..',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
