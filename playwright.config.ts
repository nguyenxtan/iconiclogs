import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    {
      command:
        'pnpm --filter @iconic/web build && pnpm --filter @iconic/mail exec wrangler dev --config ../web/wrangler.jsonc --local --port 4325',
      url: 'http://127.0.0.1:4325',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @iconic/mail dev',
      url: 'http://127.0.0.1:6070',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
