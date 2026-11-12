import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database, no network.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
