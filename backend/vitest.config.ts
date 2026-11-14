import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/helpers/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    env: { TZ: 'UTC', NODE_ENV: 'test' },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
