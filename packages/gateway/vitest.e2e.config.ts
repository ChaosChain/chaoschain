import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
