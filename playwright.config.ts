import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @iconic/web dev --port 4325 --ignore-lock',
      url: 'http://127.0.0.1:4325',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @iconic/mail dev',
      url: 'http://127.0.0.1:6070',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
