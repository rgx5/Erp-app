import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
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

test('inventory: stock in with a new batch and serial numbers, see them, hold stock and release it', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'trk' })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  await s.call('POST', '/v1/items', { code: 'MILK', name: 'Milk', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax.id, hsnSacCode: '0401', tracking: 'batch' })
  await s.call('POST', '/v1/items', { code: 'PHONE', name: 'Phone', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax.id, hsnSacCode: '8517', tracking: 'serial' })
  await signIn(page, s)

  await goTo(page, 'Stock on hand')
  await page.getByRole('button', { name: 'Adjust stock' }).click()
  const adj = page.getByRole('dialog', { name: 'Adjust stock' })
  await adj.getByLabel('Reason').fill('Opening tracked stock')
  // a batch item, coming in as a new batch
  await adj.getByLabel('Item', { exact: true }).fill('milk'); await adj.getByRole('option', { name: /MILK/ }).click()
  await adj.getByLabel('Direction').selectOption('in')
  await adj.getByLabel('Quantity').fill('20'); await adj.getByLabel('Cost each').fill('30')
  await adj.getByLabel('New batch number for MILK').fill('B-100')
  await adj.getByRole('button', { name: '+ Add line' }).click()
  // a serial item with two serial numbers
  await adj.getByLabel('Item', { exact: true }).last().fill('phone'); await adj.getByRole('option', { name: /PHONE/ }).click()
  await adj.getByLabel('Direction').last().selectOption('in')
  await adj.getByLabel('Quantity').last().fill('2'); await adj.getByLabel('Cost each').last().fill('9000')
  await adj.getByLabel('Serial numbers for PHONE').fill('SN-1\nSN-2')
  await adj.getByRole('button', { name: 'Post adjustment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'SA/' })).toBeVisible()

  // ---- what was created ----
  await goTo(page, 'Batches and serials')
  await page.getByLabel('Batch-tracked item', { exact: true }).fill('milk'); await page.getByRole('option', { name: /MILK/ }).click()
  await expect(page.getByRole('table', { name: 'Batches' })).toContainText('B-100')
  await page.getByRole('button', { name: 'Block B-100' }).click()
  await expect(page.getByRole('table', { name: 'Batches' })).toContainText('Blocked')
  await page.getByRole('tab', { name: 'Serial numbers' }).click()
  await page.getByLabel('Serial-tracked item', { exact: true }).fill('phone'); await page.getByRole('option', { name: /PHONE/ }).click()
  await expect(page.getByRole('table', { name: 'Serial numbers' })).toContainText('SN-2')

  // ---- a warehouse may be allowed to go below zero ----
  await page.getByRole('tab', { name: 'Accounts' }).click()
  await page.getByLabel(/Allow negative stock in/).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'may go below zero' })).toBeVisible()
  await expect(page.getByLabel(/Allow negative stock in/).first()).toBeChecked()
  await page.getByRole('tab', { name: 'Holds' }).click()

  // ---- hold stock, then release it ----
  await page.getByRole('tab', { name: 'Holds' }).click()
  await page.getByRole('button', { name: 'Hold stock' }).first().click()
  const hold = page.getByRole('dialog', { name: 'Hold stock' })
  await hold.getByLabel('Item', { exact: true }).fill('milk'); await hold.getByRole('option', { name: /MILK/ }).click()
  await expect(hold.getByLabel('Availability')).toContainText('On hand')
  await hold.getByLabel('Quantity').fill('5'); await hold.getByLabel('Held for').fill('SO-77')
  await hold.getByRole('button', { name: 'Hold stock' }).click()
  await expect(page.getByRole('table', { name: 'Reservations' })).toContainText('SO-77')
  await page.getByRole('button', { name: 'Release SO-77' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Released' })).toBeVisible()
})

test('tracked goods: received into a batch against an order, then sold from that batch', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'trs' })
  const d = new Date().toISOString().slice(0, 10)
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  const milk = await s.call('POST', '/v1/items', { code: 'MILK', name: 'Milk', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax.id, hsnSacCode: '0401', tracking: 'batch' })
  await s.call('POST', '/v1/purchasing/orders', { companyId: s.company.id, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, orderDate: d, lines: [{ itemId: milk.id, quantity: '10', unitPrice: '30', warehouseId: s.warehouse.id }] })
  await signIn(page, s)

  await goTo(page, 'Purchase orders')
  await page.getByRole('row', { name: /PO\// }).click()
  await page.getByRole('button', { name: 'Receive goods' }).click()
  const recv = page.getByRole('dialog', { name: /Receive goods/ })
  await recv.getByLabel('Batch number for MILK').fill('LOT-7')
  await recv.getByRole('button', { name: 'Record receipt' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'GRN/' })).toBeVisible()

  // two litres were spoiled: send them back from that batch
  await goTo(page, 'Goods receipts')
  await page.getByRole('row', { name: /GRN\// }).click()
  await page.getByRole('button', { name: 'Return goods to the supplier' }).click()
  const back = page.getByRole('dialog', { name: /GRN\// })
  await back.getByLabel('Return MILK').fill('2')
  await back.getByLabel('Batch returned for MILK').selectOption({ label: 'LOT-7' })
  await back.getByLabel('Reason').fill('Spoiled')
  await back.getByRole('button', { name: 'Return goods', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'returned to the supplier' })).toBeVisible()
  await page.keyboard.press('Escape')

  await goTo(page, 'Invoices')
  await page.getByRole('button', { name: 'New invoice' }).click()
  await page.getByLabel('Customer', { exact: true }).fill('Asha'); await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Item', { exact: true }).first().fill('milk'); await page.getByRole('option', { name: /MILK/ }).first().click()
  await page.getByLabel('Price', { exact: true }).first().fill('50')
  await page.getByLabel('Batch for MILK').selectOption({ label: 'LOT-7' })
  await expect(page.getByLabel('Totals')).toContainText('Grand total')
  await page.getByRole('button', { name: 'Post invoice' }).click()
  await expect(page.getByRole('heading', { name: /INV\// })).toBeVisible()
})
