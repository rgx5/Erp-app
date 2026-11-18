import { expect, test, type Page } from '@playwright/test'
import { makeGstin, seedBusiness, type Seed } from '../seed'

async function signIn(page: Page, s: Seed) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('sales: raise an invoice with live server totals, credit it, take a receipt, see receivables, cancel another', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'sales' })
  // a second customer in another state, to see IGST
  const other = await s.call('POST', '/v1/parties', { code: 'C-002', legalName: 'Bengaluru Retail', gstTreatment: 'registered_regular', gstin: makeGstin('29', 'KLMNO9012P'), isCustomer: true })
  await s.call('POST', `/v1/parties/${other.id}/addresses`, { kind: 'billing', line1: '9 MG Road', city: 'Bengaluru', stateCode: '29', pincode: '560001', isDefault: true })
  await signIn(page, s)

  await page.getByRole('link', { name: 'Invoices' }).click()
  await expect(page.getByRole('heading', { name: 'Sales invoices' })).toBeVisible()
  await page.getByRole('button', { name: 'New invoice' }).click()
  await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible()

  // customer, then the line grid driven from the keyboard
  await page.getByRole('textbox', { name: 'Customer' }).fill('asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Item', { exact: true }).fill('wid')
  await page.getByLabel('Item', { exact: true }).press('Enter')
  await page.getByLabel('Quantity').fill('2')
  await page.getByLabel('Quantity').press('Enter')
  await page.getByLabel('Price', { exact: true }).fill('1000')
  const totals = page.getByLabel('Totals')
  await expect(totals.getByText('₹ 2,360.00')).toBeVisible()
  await expect(totals.getByText('CGST')).toBeVisible()
  await expect(totals.getByText('₹ 180.00').first()).toBeVisible()

  // another state: the same lines are priced with IGST, by the server
  await page.getByRole('textbox', { name: 'Customer' }).fill('benga')
  await page.getByRole('option', { name: /Bengaluru Retail/ }).click()
  await expect(totals.getByText('IGST')).toBeVisible()
  await expect(totals.getByText('₹ 360.00')).toBeVisible()
  await page.getByRole('textbox', { name: 'Customer' }).fill('asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await expect(totals.getByText('CGST')).toBeVisible()

  await page.keyboard.press('Control+s')
  await expect(page.getByRole('heading', { name: /Tax invoice INV\/\d{4}\/00001/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'posted for ₹ 2,360.00' })).toBeVisible()
  const detailHash = new URL(page.url()).hash

  // print does not fail in a browser
  await page.getByRole('button', { name: 'Print' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // credit note for one unit
  await page.getByRole('button', { name: 'Credit note' }).click()
  const note = page.getByRole('dialog', { name: /Credit note against/ })
  await note.getByLabel('Quantity for line 1').fill('1')
  await note.getByLabel('Reason').fill('One unit returned')
  await note.getByRole('button', { name: 'Issue credit note' }).click()
  await expect(page.getByRole('heading', { name: /Credit note CN\/\d{4}\/00001/ })).toBeVisible()
  await expect(page.getByText('₹ 1,180.00').first()).toBeVisible()

  // receipt from the invoice, settling oldest first
  await page.evaluate((h) => { location.hash = h }, detailHash)
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible()
  await page.getByRole('link', { name: 'Record receipt' }).click()
  const receipt = page.getByRole('dialog', { name: 'Record a receipt' })
  await expect(receipt.getByRole('textbox', { name: 'Customer' })).toHaveValue(/Asha Traders/)
  await receipt.getByLabel('Amount received').fill('1000')
  await expect(receipt.getByLabel(/Settle INV/)).toBeVisible() // the open invoices have loaded
  await receipt.getByRole('button', { name: 'Oldest first' }).click()
  await expect(receipt.getByText('Settling ₹ 1,000.00 of ₹ 1,000.00')).toBeVisible()
  await receipt.getByRole('button', { name: 'Record receipt' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'RCT/' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /RCT\/\d{4}\/000001/ })).toBeVisible()

  // receivables: ₹ 1,360 still owed on the invoice; the statement lists both documents
  await page.getByRole('link', { name: 'Receivables', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Total outstanding' })).toContainText('₹ 1,360.00')
  await page.getByRole('cell', { name: 'Asha Traders' }).click()
  const panel = page.getByRole('dialog', { name: 'Asha Traders' })
  await expect(panel.getByLabel('Open invoices').getByRole('link', { name: /INV\// })).toBeVisible()
  await expect(panel.getByLabel('Statement').getByText(/RCT\//)).toBeVisible()
  await page.keyboard.press('Escape')

  // cancel an invoice that has no money against it
  const second = await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: new Date().toISOString().slice(0, 10), customerId: s.walkIn.id, lines: [{ itemId: s.cheap.id, quantity: '1', unitPrice: '100', warehouseId: s.warehouse.id }] })
  await page.evaluate((id) => { location.hash = `#/sales/invoices/${id}` }, second.id)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: /Cancel INV/ })
  await cancel.getByRole('button', { name: 'Cancel invoice' }).click()
  await expect(cancel.getByText('A reason is required')).toBeVisible()
  await cancel.getByLabel('Reason').fill('Entered by mistake')
  await cancel.getByRole('button', { name: 'Cancel invoice' }).click()
  await expect(page.getByText('Entered by mistake')).toBeVisible()
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
})
