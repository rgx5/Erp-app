import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('quotation and order print, and a proforma invoice is made from either (no posting)', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pf' })
  const today = new Date().toISOString().slice(0, 10)
  const line = { itemId: s.widget.id, quantity: '2', unitPrice: '1000', discountPercent: '0' }
  const quote = await s.call('POST', '/v1/sales/quotes', { companyId: s.company.id, gstRegistrationId: s.registration.id, customerId: s.customer.id, quoteDate: today, validUntil: `${s.year + 1}-03-31`, lines: [line] })
  const order = await s.call('POST', '/v1/sales/orders', { companyId: s.company.id, gstRegistrationId: s.registration.id, customerId: s.customer.id, orderDate: today, lines: [line] })
  const invoicesBefore = ((await s.call('GET', `/v1/sales/invoices?companyId=${s.company.id}`)).items ?? []).length
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const printed = () => page.evaluate(() => document.querySelector('iframe:last-of-type')?.getAttribute('srcdoc') ?? '')
  await page.evaluate(() => { window.print = () => undefined }) // the print dialog is not needed to read what would print

  await goTo(page, 'Quotes')
  await page.getByRole('cell', { name: quote.quoteNo as string }).click()
  await page.getByRole('button', { name: 'Print proforma invoice' }).click()
  await expect.poll(printed).toContain('Proforma Invoice')
  expect(await printed()).toContain('not a tax invoice')
  expect(await printed()).toContain('2,000.00')       // taxable value, from the server's pricing
  expect(await printed()).toContain('2,360.00')       // with 18% GST
  await page.getByRole('button', { name: 'Print quotation' }).click()
  await expect.poll(printed).toContain('Quotation')

  await page.getByRole('button', { name: 'Close' }).first().click() // the print frame had taken the keyboard focus
  await goTo(page, 'Orders')
  await page.getByRole('cell', { name: order.orderNo as string }).click()
  await page.getByRole('button', { name: 'Print order' }).click()
  await expect.poll(printed).toContain('Sales Order')

  // nothing was posted: no invoice appeared
  expect(((await s.call('GET', `/v1/sales/invoices?companyId=${s.company.id}`)).items ?? []).length).toBe(invoicesBefore)
})
