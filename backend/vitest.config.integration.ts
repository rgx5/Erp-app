import { defineConfig } from 'vitest/config';

// Integration tests: real PostgreSQL (migrated, connected as the real application role) and the real HTTP stack.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.spec.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
