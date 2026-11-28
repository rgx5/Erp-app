import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('TCS: the register opens, the usual sections are there and a rate can be changed', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'tcs' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'TCS register')
  await expect(page.getByRole('heading', { name: 'TCS register' })).toBeVisible()
  await expect(page.getByText('No TCS collected in this period.')).toBeVisible()
  await page.getByRole('button', { name: 'Sections and rates' }).click()
  await expect(page.getByText('206C(1)-SCRAP')).toBeVisible()
  const rate = page.getByLabel('Rate for 206C(1)-SCRAP')
  await rate.fill('1.5'); await rate.blur()
  await page.getByRole('button', { name: 'Close' }).first().click()
  await page.getByRole('button', { name: 'Sections and rates' }).click()
  await expect(page.getByLabel('Rate for 206C(1)-SCRAP')).toHaveValue('1.5')
})
