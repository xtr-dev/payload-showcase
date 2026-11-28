import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://localhost:${PORT}`

/**
 * E2E tests run against a production build (`next build && next start`) backed by a freshly
 * seeded SQLite database in `.e2e/`, so they never touch the developer's local database.
 * See scripts/e2e-server.sh for the server lifecycle.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  // No retries, in CI either: a test that only passes on a second attempt is a failure to look
  // into, and a retry would report it as passed.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bash scripts/e2e-server.sh',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
})
