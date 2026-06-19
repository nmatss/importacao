import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Several API tests intentionally mutate process.env before importing
    // singleton modules. Running files in parallel can leak provider settings
    // across AI tests and trigger external calls.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
