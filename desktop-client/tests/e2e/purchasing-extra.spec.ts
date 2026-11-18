import { expect, test, type Page } from '@playwright/test'
import { seedBusiness } from '../seed'

async function signIn(page: Page, s: { base: string; slug: string; email: string; password: string }) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('purchasing: freight added to the cost of received goods, and a debit note against a bill', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pex' })
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10)
  const po = await s.call('POST', '/v1/purchasing/orders', { companyId: c, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, orderDate: d, lines: [{ itemId: s.widget.id, quantity: '10', unitPrice: '100' }] })
  const poFull = (await s.call('GET', `/v1/purchasing/orders/${po.id}`)) as unknown as { lines: { id: string }[] }
  const gr = await s.call('POST', '/v1/purchasing/receipts', { companyId: c, supplierId: s.supplier.id, purchaseOrderId: po.id, receiptDate: d, lines: [{ orderLineId: poFull.lines[0]!.id, warehouseId: s.warehouse.id, quantity: '10' }] })
  const grFull = (await s.call('GET', `/v1/purchasing/receipts/${gr.id}`)) as unknown as { lines: { id: string }[] }
  await s.call('POST', '/v1/purchasing/bills', { companyId: c, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, supplierInvoiceNo: 'V-9', supplierInvoiceDate: d, billDate: d, lines: [{ itemId: s.widget.id, quantity: '10', unitPrice: '100', grnLineId: grFull.lines[0]!.id }] })
  await signIn(page, s)

  // ---- landed cost ----
  await page.getByRole('link', { name: 'Landed costs' }).click()
  await page.getByRole('button', { name: 'New voucher' }).click()
  const v = page.getByRole('dialog', { name: 'New landed-cost voucher' })
  await v.getByLabel('Description').fill('Freight inward')
  await v.getByLabel('Goods receipt').selectOption({ index: 1 })
  await v.getByLabel('Line WIDGET').check()
  await v.getByLabel('Amount').fill('500')
  await v.getByLabel('Booked to (expense account)').fill('5900')
  await v.getByRole('listbox').getByRole('option', { name: /5900/ }).click()
  await v.getByRole('button', { name: 'Post voucher' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'LC/' })).toBeVisible()
  await page.getByRole('cell', { name: 'Freight inward' }).click()
  await expect(page.getByRole('table', { name: 'Allocation' })).toContainText('500.00')
  await page.keyboard.press('Escape')

  // ---- a debit note against the bill ----
  await page.getByRole('link', { name: 'Supplier bills' }).click()
  await page.getByRole('row', { name: /V-9|BILL|PB/ }).first().click()
  await page.getByRole('button', { name: 'Debit note' }).click()
  const dn = page.getByRole('dialog', { name: /Debit note against/ })
  await dn.getByLabel('Debit quantity for line 1').fill('2')
  await dn.getByLabel('Reason').fill('Damaged in transit')
  await dn.getByRole('button', { name: 'Post debit note' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'PDN/' })).toBeVisible()
})
