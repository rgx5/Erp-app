import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('data export: the owner downloads all records as a file with no credentials in it', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'exp' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await goTo(page, 'Data export')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
  expect(download.suggestedFilename()).toMatch(/^onesync-data-\d{4}-\d{2}-\d{2}\.json$/)
  const text = (await import('node:fs')).readFileSync(await download.path(), 'utf8')
  const data = JSON.parse(text) as { tables: Record<string, unknown[]> }
  expect(data.tables['items']?.length).toBeGreaterThan(0)
  expect(text).not.toContain('password_hash')
  await expect(page.getByText(/Saved .* records/)).toBeVisible()
})
