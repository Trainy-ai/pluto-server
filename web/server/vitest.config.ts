import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testMatch: ['**/*.test.ts'],
    setupFiles: [],
    // Increase timeout for smoke tests that may involve network calls
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov', 'json'],
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts', 'trpc/**/*.ts', 'routes/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/node_modules/**',
        'lib/env.ts', // env validation only
        'prisma/**',
      ],
    },
  },
});
