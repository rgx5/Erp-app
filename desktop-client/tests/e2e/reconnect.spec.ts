import { expect, test } from '@playwright/test'
import { seedBusiness } from '../seed'

test('connection: the app says plainly when the server cannot be reached, keeps trying, and recovers', async ({ page, context }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'rc' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText(/Cannot reach the server/)).toHaveCount(0)

  // the server goes away: pressing Refresh finds out, and the screen says so
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Refresh' }).click()
  const note = page.getByText(/Cannot reach the server\. Your work is safe/)
  await expect(note).toBeVisible()
  await context.setOffline(false)
  // the server answers again: the app notices by itself (or on the button) and the banner clears
  await expect(note).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})
