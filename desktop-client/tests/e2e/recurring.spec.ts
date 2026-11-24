import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('recurring invoices: set up a monthly schedule, raise what is due, and see the history', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'rc' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Recurring invoices')
  await expect(page.getByText('No recurring invoices yet.')).toBeVisible()
  await page.getByRole('button', { name: 'New recurring invoice' }).click()
  await page.getByLabel('Name of this schedule').fill('Annual maintenance')
  await page.getByLabel('Repeats').selectOption('yearly')
  await page.getByRole('textbox', { name: 'Customer', exact: true }).fill('asha'); await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Item', { exact: true }).fill('wid'); await page.getByLabel('Item', { exact: true }).press('Enter')
  await page.getByLabel('Quantity').first().fill('1'); await page.getByLabel('Price').first().fill('1000')
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByRole('cell', { name: 'Annual maintenance' })).toBeVisible()
  const invoices = async () => ((await s.call('GET', `/v1/sales/invoices?companyId=${s.company.id}`)).items ?? []).length
  // the first invoice is due on the start date (today), so it was raised when the app next opened, or now
  await page.getByRole('button', { name: 'Raise due invoices now' }).click()
  await expect.poll(invoices).toBe(1)
  await page.getByRole('cell', { name: 'Annual maintenance' }).click()
  const history = page.getByRole('table', { name: 'History' })
  await expect(history).toContainText('INV/')
  await expect(history).toContainText('1,180.00')
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText(/Paused\./)).toBeVisible()
})
