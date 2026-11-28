import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('loans: record a loan taken, see its schedule, pay the first instalment, then close it early', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ln' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Loans taken')
  await expect(page.getByText('No loans taken yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Record a loan' }).click()
  await page.getByLabel('Lender').fill('HDFC Bank term loan')
  await page.getByLabel('Amount').fill('100000')
  await page.getByLabel('Interest per year (%)').fill('12')
  await page.getByLabel('Months to repay').fill('12')
  await expect(page.getByText('8,884.88')).toBeVisible()            // the instalment, worked out as you type
  await page.getByLabel('Bank or cash account it came into').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Save loan' }).click()

  await expect(page.getByRole('heading', { name: 'HDFC Bank term loan' })).toBeVisible()
  await expect(page.getByText('Repayment schedule')).toBeVisible()
  await page.getByRole('button', { name: /Pay instalment 1/ }).click()
  await page.getByRole('button', { name: 'Pay instalment 1' }).last().click()
  await expect(page.getByText(/Paid /).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close early' }).click()
  await page.getByRole('button', { name: 'Close the loan early' }).last().click()
  await expect(page.getByText('Closed', { exact: true })).toBeVisible()
})
