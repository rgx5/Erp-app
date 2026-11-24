import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('payment reminders: an overdue customer gets a WhatsApp message, and it is logged', async ({ page, context }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'rm' })
  const buyer = await s.call('POST', '/v1/parties', { code: 'DUE1', legalName: 'Late Payer Stores', gstTreatment: 'unregistered', isCustomer: true, phone: '98765 43210' })
  const d = new Date(); d.setDate(d.getDate() - 70)
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: d.toISOString().slice(0, 10), customerId: buyer.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Payment reminders')
  const row = page.getByRole('row', { name: /Late Payer Stores/ })
  await expect(row).toContainText('1,180.00')
  await expect(row).toContainText('Never')
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' })) // no real WhatsApp here
  const popup = context.waitForEvent('page')
  await row.getByRole('button', { name: 'WhatsApp' }).click()
  const tab = await popup; await tab.waitForURL(/wa\.me/); const url = tab.url()
  expect(url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
  expect(decodeURIComponent(url)).toContain('Late Payer Stores')
  expect(decodeURIComponent(url)).toContain('1,180.00 is overdue (61 to 90 days)')
  await expect(row).toContainText('by WhatsApp')
  const latest = (await s.call('GET', `/v1/sales/reminders?companyId=${s.company.id}`)).items as unknown as { channel: string }[]
  expect(latest).toHaveLength(1); expect(latest[0]?.channel).toBe('whatsapp')
})
