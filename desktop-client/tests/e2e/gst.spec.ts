import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
import { makeGstin, seedBusiness } from '../seed'

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

test('GST returns: GSTR-1, GSTR-3B and the ITC register for the month of the documents', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'gst' })
  const today = new Date().toISOString().slice(0, 10)
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '2', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.walkIn.id, lines: [{ itemId: s.cheap.id, quantity: '1', unitPrice: '100', warehouseId: s.warehouse.id }] })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  const svc = await s.call('POST', '/v1/items', { code: 'REPAIR', name: 'Repair service', baseUomId: nos.id, itemType: 'service', taxCodeId: tax.id, hsnSacCode: '998719' })
  await s.call('POST', '/v1/purchasing/bills', { companyId: s.company.id, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, supplierInvoiceNo: 'V-1', supplierInvoiceDate: today, billDate: today, lines: [{ itemId: svc.id, quantity: '1', unitPrice: '500' }] })
  await signIn(page, s)

  await goTo(page, 'Report centre')
  await page.getByRole('link', { name: /^GSTR-1/ }).click()
  await expect(page.getByRole('heading', { name: 'GST returns' })).toBeVisible()
  await page.getByLabel('Month').fill(today.slice(0, 7))

  // GSTR-1: the registered buyer's invoice is in B2B, the walk-in sale in B2C small, and HSN lists both items.
  await expect(page.getByRole('table', { name: 'B2B' }).getByRole('cell', { name: /^INV/ })).toBeVisible()
  await expect(page.getByRole('table', { name: 'B2CS' }).getByRole('cell', { name: '100.00' }).first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'HSN' }).getByRole('cell', { name: '8479' })).toBeVisible()

  // GSTR-3B: outward tax is 18% of 2,000 plus 5% of 100 and the bill's credit of 90 is used against it.
  await page.getByRole('tab', { name: 'GSTR-3B' }).click()
  await expect(page.getByRole('table', { name: '3.1' }).getByRole('cell', { name: '2,100.00' })).toBeVisible()
  await expect(page.getByRole('table', { name: '6' })).toContainText('Payable in cash')

  // ITC register
  await page.getByRole('tab', { name: 'ITC register' }).click()
  await expect(page.getByRole('table', { name: 'ITC register' }).getByRole('cell', { name: /V-1|BILL|PB/ }).first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'ITC register' })).toContainText('90.00')
})

test('GST returns: a composition registration prepares CMP-08 once its rate is set', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'cmp' })
  const comp = await s.call('POST', `/v1/companies/${s.company.id}/gst-registrations`, { gstin: makeGstin('29', 'ABCDE1234F'), legalName: 'Sunrise Karnataka', registrationType: 'composition', effectiveFrom: '2025-04-01' })
  await signIn(page, s)
  await goTo(page, 'GST returns')
  await page.getByLabel('GST registration').selectOption(comp.id)
  await expect(page.getByRole('tab', { name: 'CMP-08' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'GSTR-1' })).toHaveCount(0)
  await expect(page.getByText('Set the composition rate for this registration first')).toBeVisible()
  await page.getByRole('button', { name: /Composition rate/ }).click()
  await page.getByRole('dialog').getByLabel('Rate (%)').fill('1')
  await page.getByRole('button', { name: 'Save rate' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Composition rate saved' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'CMP-08' })).toContainText('Total tax payable')
})
