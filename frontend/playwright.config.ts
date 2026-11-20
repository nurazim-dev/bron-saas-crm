import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Asia/Bishkek',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start -w backend',
      cwd: '..',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        RATE_LIMIT_AUTH_MAX: '50',
        RATE_LIMIT_GLOBAL_MAX: '1000',
      },
    },
    {
      command: 'npm run start -w frontend',
      cwd: '..',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
