import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('party screen: a customer shows what they owe and every document with them, and a supplier likewise', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pd' })
  const today = new Date().toISOString().slice(0, 10)
  const inv = (qty: string) => s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: qty, unitPrice: '1000', warehouseId: s.warehouse.id }] })
  const one = await inv('1'); await inv('2')
  await s.call('POST', '/v1/receivables/receipts', { companyId: s.company.id, customerId: s.customer.id, receiptDate: today, amount: '500', method: 'cash', depositAccountId: s.cash, allocations: [{ invoiceId: one.id, amount: '500' }] })
  await s.call('POST', '/v1/sales/quotes', { companyId: s.company.id, gstRegistrationId: s.registration.id, quoteDate: today, validUntil: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '900' }] })
  await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.walkIn.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] }) // someone else's: must not appear

  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Customers')
  await page.getByRole('cell', { name: 'Asha Traders' }).click()
  await expect(page.getByRole('heading', { name: /Asha Traders/ })).toBeVisible()
  await expect(page.getByText('They owe you', { exact: true })).toBeVisible()
  await expect(page.getByText(/3,040\.00/).first()).toBeVisible() // 1,180 + 2,360 less 500 received
  // the ledger tab is the first: invoices, the receipt, and a running balance
  await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('cell', { name: /Tax invoice/ }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: /Receipt/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Invoices & notes' }).click()
  await expect(page.getByRole('row', { name: /INV\// })).toHaveCount(2) // not the walk-in's
  await page.getByRole('tab', { name: 'Receipts' }).click()
  await expect(page.getByRole('cell', { name: /500\.00/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Quotes' }).click()
  await expect(page.getByRole('cell', { name: /1,062\.00/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Challans' }).click()
  await expect(page.getByText('No delivery challans.')).toBeVisible()
  // a row opens the document
  await page.getByRole('tab', { name: 'Invoices & notes' }).click()
  await page.getByRole('row', { name: /INV\// }).first().click()
  await expect(page.getByRole('heading', { name: /Tax invoice INV\// })).toBeVisible()
  // and new invoice starts with this customer already chosen
  await page.goBack()
  await page.getByRole('button', { name: 'New invoice' }).click()
  await expect(page.getByRole('textbox', { name: 'Customer', exact: true })).toHaveValue(/Asha Traders/)

  // a supplier: bills and payments
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  const svc = await s.call('POST', '/v1/items', { code: 'REPAIR', name: 'Repair service', baseUomId: nos.id, itemType: 'service', taxCodeId: tax.id, hsnSacCode: '998719' })
  const bill = await s.call('POST', '/v1/purchasing/bills', { companyId: s.company.id, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, supplierInvoiceNo: 'SI-1', supplierInvoiceDate: today, billDate: today, lines: [{ itemId: svc.id, quantity: '1', unitPrice: '500' }] })
  expect(bill.id).toBeTruthy()
  await goTo(page, 'Suppliers')
  await page.getByRole('cell', { name: 'Vendor Supplies' }).click()
  await expect(page.getByText('You owe them', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Bills & notes' }).click()
  await expect(page.getByRole('cell', { name: 'SI-1' })).toBeVisible()
  await page.getByRole('tab', { name: 'Payments' }).click()
  await expect(page.getByText('No payments yet.')).toBeVisible()
})
