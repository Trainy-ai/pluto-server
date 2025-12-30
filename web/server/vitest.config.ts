import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testMatch: ['**/*.test.ts'],
    setupFiles: [],
    // Increase timeout for smoke tests that may involve network calls
    testTimeout: 10000,
  },
});
