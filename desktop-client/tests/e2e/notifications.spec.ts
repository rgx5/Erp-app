import { expect, test } from '@playwright/test'
import { seedBusiness } from '../seed'

test('notifications: the bell shows what needs attention and takes you there', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'nt' })
  const d = new Date(); d.setDate(d.getDate() - 70)
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: d.toISOString().slice(0, 10), customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const bell = page.getByRole('button', { name: /^Notifications: 1 need attention/ })
  await expect(bell).toBeVisible()
  await bell.click()
  await page.getByRole('menuitem', { name: /1 customer has overdue payments/ }).click()
  await expect(page.getByRole('heading', { name: 'Payment reminders' })).toBeVisible()
})
