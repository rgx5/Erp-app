import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const bundled = '/opt/pw-browsers/chromium'

// Drives the renderer in a real browser against a real backend (started by tests/e2e/global-setup.ts) and PostgreSQL.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: process.env['E2E_ELECTRON'] ? /electron\.smoke\.ts$/ : /\.spec\.ts$/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'off', launchOptions: existsSync(bundled) ? { executablePath: bundled } : {} },
  webServer: { command: 'npx vite --config vite.web.config.mts', url: 'http://localhost:5173', reuseExistingServer: !process.env['CI'], timeout: 60_000 },
})
