import { defineConfig } from 'vitest/config';

// Capacity run (opt-in, minutes not seconds): many clients on one database, each with a large ledger. `npm run capacity`.
export default defineConfig({
  test: {
    include: ['test/capacity/**/*.cap.spec.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
