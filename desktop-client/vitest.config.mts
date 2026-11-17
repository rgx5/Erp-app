import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src') } },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'], css: false },
})
