import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('special rates: agree a price with a customer, then see it start the price on their next invoice', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pr' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Customers')
  await page.getByRole('cell', { name: 'Asha Traders' }).click()
  await page.getByRole('tab', { name: 'Special rates' }).click()
  await expect(page.getByText('No special rates for this party yet.')).toBeVisible()
  await page.getByLabel('Item', { exact: true }).fill('widget')
  await page.getByRole('option', { name: /WIDGET/ }).click()
  await page.getByLabel('Rate', { exact: true }).fill('777')
  await page.getByRole('button', { name: 'Save rate' }).click()
  await expect(page.getByRole('cell', { name: /WIDGET/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: /777\.00/ })).toBeVisible()

  await page.getByRole('button', { name: 'New invoice' }).click()
  await expect(page.getByRole('heading', { name: /New (tax )?invoice|Sales invoice/i })).toBeVisible()
  await page.getByLabel('Item', { exact: true }).first().fill('widget')
  await page.getByRole('option', { name: /WIDGET/ }).first().click()
  await expect(page.getByLabel('Price').first()).toHaveValue('777')
})
