import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('GSTR-2B check: the portal file against purchase bills, and the annual working', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'g2' })
  const today = new Date().toISOString().slice(0, 10); const period = today.slice(0, 7)
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  const svc = await s.call('POST', '/v1/items', { code: 'REPAIR', name: 'Repair service', baseUomId: nos.id, itemType: 'service', taxCodeId: tax.id, hsnSacCode: '998719' })
  const bill = (no: string, price: string) => s.call('POST', '/v1/purchasing/bills', { companyId: s.company.id, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, supplierInvoiceNo: no, supplierInvoiceDate: today, billDate: today, lines: [{ itemId: svc.id, quantity: '1', unitPrice: price }] })
  await bill('V-1', '1000'); await bill('V-2', '500')
  const supplierGstin = ((await s.call('GET', '/v1/parties?role=supplier&limit=5')).items as unknown as { gstin: string }[])[0]?.gstin as string
  const d = today.split('-').reverse().join('-')
  const file = { data: { gstin: s.registration.gstin, rtnprd: `${period.slice(5)}${period.slice(0, 4)}`, docdata: { b2b: [{ ctin: supplierGstin, trdnm: 'Vendor Supplies', inv: [
    { inum: 'V-1', dt: d, val: 1180, items: [{ txval: 1000, igst: 0, cgst: 90, sgst: 90 }] },
    { inum: 'V-9', dt: d, val: 118, items: [{ txval: 100, igst: 0, cgst: 9, sgst: 9 }] }] }] } } }
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await goTo(page, 'GST returns')
  await page.getByRole('tab', { name: 'GSTR-2B check' }).click()
  await page.getByLabel('GSTR-2B file').setInputFiles({ name: 'gstr2b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(page.getByText(/2 documents in GSTR-2B/)).toBeVisible()
  const rec = page.getByRole('table', { name: 'Reconciliation' })
  await expect(rec.getByRole('row', { name: /Matched.*V-1/ })).toBeVisible()
  await expect(rec.getByRole('row', { name: /In GSTR-2B only.*V-9/ })).toBeVisible()
  await expect(rec.getByRole('row', { name: /In books only.*V-2/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Annual (GSTR-9)' }).click()
  await expect(page.getByRole('table', { name: 'GSTR-9 working' })).toBeVisible()
  await expect(page.getByText(/This is a working, not the return/)).toBeVisible()
})
