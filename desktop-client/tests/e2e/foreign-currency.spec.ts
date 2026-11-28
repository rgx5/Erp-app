import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('foreign currency: save a rate, raise a dollar invoice, and receive the payment at another rate', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'fx' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Foreign currency')
  await expect(page.getByText('Nothing is owed in a foreign currency.')).toBeVisible()
  await page.getByRole('button', { name: 'Exchange rates' }).click()
  await page.getByLabel('Currency', { exact: true }).fill('USD')
  await page.getByLabel('Rate (₹)').fill('80')
  await page.getByLabel('From').fill('2025-01-01')
  await page.getByRole('button', { name: 'Save rate' }).click()
  await expect(page.getByText('₹80', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).first().click()

  await goTo(page, 'Invoices')
  await page.getByRole('button', { name: 'New invoice' }).click()
  await page.getByRole('textbox', { name: 'Customer' }).fill('asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Currency', { exact: true }).selectOption('USD')
  await page.getByLabel('Item', { exact: true }).fill('wid')
  await page.getByLabel('Item', { exact: true }).press('Enter')
  await page.getByLabel('Quantity').fill('10')
  await page.getByLabel('Quantity').press('Enter')
  await page.getByLabel('Price', { exact: true }).fill('100')
  const totals = page.getByLabel('Totals')
  await expect(totals.getByText('₹ 80,000.00')).toBeVisible()          // 10 × $100 at ₹80
  await expect(totals.getByText(/In USD @ ₹80/)).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible()

  await goTo(page, 'Foreign currency')
  await expect(page.getByText(/USD$/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Receive' }).click()
  await page.getByLabel('Rate on the day (₹)').fill('82')
  await expect(page.getByText(/books an exchange gain/)).toBeVisible()
  await page.getByLabel('Into account').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Nothing is owed in a foreign currency.')).toBeVisible()
})
