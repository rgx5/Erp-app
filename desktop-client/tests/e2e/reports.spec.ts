import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('reports: sales analysis groups by item and by day, and the day-end report loads', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'rep' })
  const today = new Date().toISOString().slice(0, 10)
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '2', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Sales analysis')
  const table = page.getByRole('table', { name: 'Sales analysis' })
  await expect(table).toContainText('WIDGET')
  await expect(table).toContainText('2,000.00')
  await page.getByLabel('Group by').selectOption('day')
  await expect(table).toContainText(today)
  await page.getByLabel('From').fill('2030-01-01')
  await expect(page.getByText('The start date is after the end date.')).toBeVisible()

  await goTo(page, 'Day-end report')
  await expect(page.getByRole('heading', { name: 'Day-end report' })).toBeVisible()
  await expect(page.getByText(/No shifts on/)).toBeVisible()
})
