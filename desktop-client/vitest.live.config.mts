// Tests that talk to a real backend (BACKEND_URL, default http://127.0.0.1:3100) started by tests/live/global-setup.ts.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve('src') } },
  test: { environment: 'node', include: ['tests/live/**/*.test.ts'], globalSetup: ['tests/live/global-setup.ts'], testTimeout: 30_000, hookTimeout: 120_000, fileParallelism: false },
})
