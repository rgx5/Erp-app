import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedBusiness, type Seed } from '../seed'

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
const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h }, hash)

test('purchasing: order, receive, bill (with an approved price exception), pay, and see payables', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'buy' })
  await signIn(page, s)

  // ---- purchase order ----
  await page.getByRole('link', { name: 'Purchase orders' }).click()
  await page.getByRole('button', { name: 'New order' }).click()
  await page.getByRole('textbox', { name: 'Supplier', exact: true }).fill('vendor')
  await page.getByRole('option', { name: /Vendor Supplies/ }).click()
  await page.getByLabel('Item', { exact: true }).fill('wid')
  await page.getByLabel('Item', { exact: true }).press('Enter')
  await page.getByLabel('Quantity').fill('10')
  await page.getByLabel('Quantity').press('Enter')
  await page.getByLabel('Price', { exact: true }).fill('500')
  await expect(page.getByText('₹ 5,000.00').first()).toBeVisible()
  await page.getByRole('button', { name: 'Create order' }).click()
  await expect(page.getByRole('heading', { name: /Purchase order PO\/\d{4}\/000001/ })).toBeVisible()

  // ---- receive the goods ----
  await page.getByRole('button', { name: 'Receive goods' }).click()
  const receive = page.getByRole('dialog', { name: /Receive goods for/ })
  await receive.getByLabel(/Receiving/).fill('10')
  await receive.getByRole('button', { name: 'Record receipt' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'GRN/' })).toBeVisible()
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible()

  // ---- the supplier's bill, checked before it is posted ----
  await page.getByRole('link', { name: 'Enter bill' }).click()
  await expect(page.getByRole('textbox', { name: 'Supplier', exact: true })).toHaveValue(/Vendor Supplies/)
  await page.getByLabel("Supplier's invoice number").fill('V-100')
  await page.getByLabel(/Bill quantity for GRN/).fill('10')
  await page.getByRole('button', { name: 'Check bill' }).click()
  const totals = page.getByLabel('Bill totals')
  await expect(totals.getByText('₹ 5,900.00')).toBeVisible()
  await expect(page.getByText('Matched to receipt')).toBeVisible()
  await page.getByRole('button', { name: 'Post bill' }).click()
  await expect(page.getByRole('heading', { name: /Bill BILL\/\d{4}\/000001/ })).toBeVisible()
  const billHash = new URL(page.url()).hash

  // ---- pay part of it ----
  await page.getByRole('link', { name: 'Record payment' }).click()
  const pay = page.getByRole('dialog', { name: 'Record a payment' })
  await expect(pay.getByRole('textbox', { name: 'Supplier', exact: true })).toHaveValue(/Vendor Supplies/)
  await pay.getByLabel('Amount paid').fill('2000')
  await expect(pay.getByLabel(/Settle BILL/)).toBeVisible() // the open bills have loaded
  await pay.getByRole('button', { name: 'Earliest due first' }).click()
  await expect(pay.getByText('Settling ₹ 2,000.00 of ₹ 2,000.00')).toBeVisible()
  await pay.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'PAY/' })).toBeVisible()

  // ---- payables ----
  await page.getByRole('link', { name: 'Payables' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Total payable' })).toContainText('₹ 3,900.00')
  await page.getByRole('cell', { name: 'Vendor Supplies' }).click()
  await expect(page.getByRole('dialog', { name: 'Vendor Supplies' }).getByLabel('Open bills').getByRole('link', { name: /BILL\// })).toBeVisible()
  await page.keyboard.press('Escape')

  // ---- a price above the tolerance needs an approver's reason ----
  const po2 = await s.call('POST', '/v1/purchasing/orders', { companyId: s.company.id, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, orderDate: new Date().toISOString().slice(0, 10), lines: [{ itemId: s.widget.id, quantity: '10', unitPrice: '500', warehouseId: s.warehouse.id }] })
  await s.call('POST', '/v1/purchasing/receipts', { companyId: s.company.id, purchaseOrderId: po2.id, receiptDate: new Date().toISOString().slice(0, 10), lines: [{ orderLineId: ((po2['lines'] as { id: string }[])[0] as { id: string }).id, quantity: '10' }] })
  await go(page, '#/purchasing/bills/new')
  await page.getByRole('textbox', { name: 'Supplier', exact: true }).fill('vendor')
  await page.getByRole('option', { name: /Vendor Supplies/ }).click()
  await page.getByLabel("Supplier's invoice number").fill('V-101')
  await page.getByLabel(/Bill quantity for GRN/).fill('10')
  await page.getByLabel(/Supplier price for GRN/).fill('650')
  await page.getByRole('button', { name: 'Check bill' }).click()
  await expect(page.getByText("outside the company's price or quantity tolerance")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Post bill' })).toBeDisabled()
  await page.getByLabel('Approve anyway: reason').fill('Supplier price rise agreed by phone')
  await page.getByRole('button', { name: 'Check with approval' }).click()
  await expect(page.getByText('Approved outside tolerance')).toBeVisible()
  await page.getByRole('button', { name: 'Post bill' }).click()
  await expect(page.getByRole('heading', { name: /Bill BILL\/\d{4}\/000002/ })).toBeVisible()
  await expect(page.getByText('Supplier price rise agreed by phone')).toBeVisible()

  // cancelling needs a reason and works while nothing is paid against it
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: /Cancel BILL/ })
  await cancel.getByRole('button', { name: 'Cancel bill' }).click()
  await expect(cancel.getByText('A reason is required')).toBeVisible()
  await cancel.getByLabel('Reason').fill('Wrong supplier invoice')
  await cancel.getByRole('button', { name: 'Cancel bill' }).click()
  await expect(page.getByText('Wrong supplier invoice').first()).toBeVisible()
  void billHash
})

async function approverIn(browser: Browser, s: Seed) {
  const role = await s.call('POST', '/v1/roles', { name: 'Approver', permissions: ['approvals:decide', 'approvals:read', 'organization:read'] })
  const email = `approver@${s.slug}.example.com`
  await s.call('POST', '/v1/users', { email, displayName: 'Ravi Approver', password: s.password, roleIds: [role.id] })
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, { base: s.base, slug: s.slug, email, password: s.password })
  return page
}

test('approvals: a payment above the limit is requested, approved by someone else, then posted', async ({ page, browser }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'appr' })
  await s.call('POST', '/v1/approval-policies', { companyId: s.company.id, documentType: 'payment', thresholdAmount: '10000', requiredApprovals: 1 })
  await signIn(page, s)

  await page.getByRole('link', { name: 'Payments' }).click()
  await page.getByRole('button', { name: 'New payment' }).click()
  const pay = page.getByRole('dialog', { name: 'Record a payment' })
  await pay.getByRole('textbox', { name: 'Supplier', exact: true }).fill('vendor')
  await pay.getByRole('option', { name: /Vendor Supplies/ }).click()
  await pay.getByLabel('Amount paid').fill('12000')
  await pay.getByRole('button', { name: 'Record payment' }).click()
  await expect(pay.getByText('This needs approval.')).toBeVisible()
  await pay.getByRole('button', { name: 'Ask for approval' }).click()
  await expect(pay.getByText(/Request APR-000001 was sent/)).toBeVisible()
  await page.keyboard.press('Escape')

  // nobody can approve their own request
  await page.getByRole('link', { name: 'Approvals' }).click()
  await page.getByRole('cell', { name: 'APR-000001' }).click()
  const mine = page.getByRole('dialog', { name: /APR-000001/ })
  await expect(mine.getByText('someone else has to decide it')).toBeVisible()
  await expect(mine.getByRole('button', { name: 'Post now' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // the approver decides it from their own session
  const other = await approverIn(browser, s)
  await other.getByRole('link', { name: 'Approvals' }).click()
  await other.getByRole('cell', { name: 'APR-000001' }).click()
  const decide = other.getByRole('dialog', { name: /APR-000001/ })
  await expect(decide.getByText('₹ 12,000.00')).toBeVisible()
  await decide.getByLabel('Comment').fill('Within budget')
  await decide.getByRole('button', { name: 'Approve' }).click()
  await expect(other.getByRole('status').filter({ hasText: 'APR-000001 approved' })).toBeVisible()

  // back with the requester: it is ready to post exactly as approved
  await page.reload() // the session is kept for this browser tab
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible()
  await page.getByRole('tab', { name: 'My requests' }).click()
  await page.getByRole('cell', { name: 'APR-000001' }).click()
  const ready = page.getByRole('dialog', { name: /APR-000001/ })
  await expect(ready.getByText('Approved. Post it now')).toBeVisible()
  await ready.getByRole('button', { name: 'Post now' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'PAY/' })).toBeVisible()
  await go(page, '#/purchasing/payments')
  await expect(page.getByRole('cell', { name: /PAY\/\d{4}\/000001/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: '₹ 12,000.00' })).toBeVisible()
})
