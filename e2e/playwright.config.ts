import { defineConfig } from '@playwright/test';

const PORT = 4173;

/**
 * E2E runs against the real production artifact: the built API serving the
 * built SPA from one process, exactly as the Docker image will. The data
 * directory is wiped on every run so the suite always starts at first-run
 * setup, and the server is never reused for the same reason.
 *
 * One instance means one workspace: tests run serially and in declaration
 * order, with the setup test first.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: [
      'rm -rf e2e/.data e2e/.auth',
      'npm run build',
      `NODE_ENV=production APP_URL=http://localhost:${PORT} PORT=${PORT} DATA_DIR=e2e/.data WEB_DIST=apps/web/dist LOG_LEVEL=warn node apps/api/dist/index.js`,
    ].join(' && '),
    port: PORT,
    cwd: '..',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
