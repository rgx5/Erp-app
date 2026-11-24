import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('e-invoice and e-way bill: file for the portal, the reply loaded back, shown on the invoice, and the invoice protected until the IRN is cancelled', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ei' })
  const today = new Date().toISOString().slice(0, 10)
  const mk = (qty: string) => s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: qty, unitPrice: '1000', warehouseId: s.warehouse.id }] })
  const one = await mk('1'); const two = await mk('60')
  const consumer = await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.walkIn.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  const gstin = (await s.call('GET', `/v1/companies/${s.company.id}/gst-registrations`)).items?.[0]?.gstin ?? s.registration.gstin
  const fy = (d: string) => { const y = Number(d.slice(0, 4)); const st = Number(d.slice(5, 7)) >= 4 ? y : y - 1; return `${st}-${String((st + 1) % 100).padStart(2, '0')}` }
  const irnOf = (no: string) => createHash('sha256').update(`${gstin as string}${fy(today)}INV${no}`).digest('hex')

  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // a sale to a consumer has no e-invoice card
  await page.goto(`/#/sales/invoices/${consumer.id as string}`)
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'E-invoice (IRN)' })).toHaveCount(0)

  // the bulk page lists the two business sales and makes one file
  await goTo(page, 'E-invoicing')
  await expect(page.getByRole('heading', { name: 'E-invoicing' })).toBeVisible()
  await expect(page.getByRole('link', { name: one.invoiceNo as string })).toBeVisible()
  await page.getByLabel('Choose all').check()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download file \(2\)/ }).click()
  const file = JSON.parse(readFileSync(await (await dl).path(), 'utf8')) as { DocDtls: { No: string }; ValDtls: { TotInvVal: number } }[]
  expect(file.map((f) => f.DocDtls.No).sort()).toEqual([one.invoiceNo as string, two.invoiceNo as string].sort())

  // the portal's reply, for one of them only
  const reply = [{ Irn: irnOf(one.invoiceNo as string), AckNo: 112010099999, AckDt: `${today} 11:05:09`, SignedQRCode: 'eyJhbGciOiJSUzI1NiJ9.signed.qr', DocNo: one.invoiceNo }]
  await page.getByLabel('Portal reply file').setInputFiles({ name: 'reply.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(reply)) })
  await expect(page.getByText(/1 recorded/)).toBeVisible()
  await page.getByLabel('Show').selectOption('issued')
  await expect(page.getByText(/Recorded · Ack 112010099999/)).toBeVisible()

  // on the invoice
  await page.goto(`/#/sales/invoices/${one.id as string}`)
  await expect(page.getByText('IRN recorded')).toBeVisible()
  await expect(page.getByText(irnOf(one.invoiceNo as string))).toBeVisible()
  // cancelling is refused until the IRN is cancelled on the portal and recorded here
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByLabel('Reason').fill('Wrong buyer'); await page.getByRole('button', { name: 'Cancel invoice' }).click()
  await expect(page.getByText(/has an IRN/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Record IRN cancellation' }).click()
  await page.getByLabel('Reason').fill('Wrong buyer'); await page.getByRole('button', { name: 'Record cancellation' }).click()
  await expect(page.getByText('No IRN yet')).toBeVisible()

  // the second invoice: an IRN typed in by hand must be the right one, and the e-way bill
  await page.goto(`/#/sales/invoices/${two.id as string}`)
  await page.getByRole('button', { name: 'Enter the IRN by hand' }).click()
  await page.getByLabel('IRN', { exact: true }).fill(irnOf(one.invoiceNo as string)); await page.getByLabel('Acknowledgement number').fill('77'); await page.getByLabel(/Acknowledgement date/).fill(`${today} 10:00:00`); await page.getByLabel('Signed QR code text').fill('eyJ.manual.qrtext')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/does not belong to this invoice/)).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Prepare file for the portal' }).click()
  await page.getByLabel('Distance in km').fill('850')
  await page.getByRole('button', { name: 'Make the e-way bill file' }).click()
  await expect(page.getByText(/vehicle number, or the transporter/i)).toBeVisible()
  await page.getByLabel(/Vehicle number \(road\)/).fill('MH12AB1234')
  const dl2 = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Make the e-way bill file' }).click()
  const eway = JSON.parse(readFileSync(await (await dl2).path(), 'utf8')) as { billLists: { docNo: string; vehicleNo: string; totalValue: number }[] }
  expect(eway.billLists[0]).toMatchObject({ docNo: two.invoiceNo, vehicleNo: 'MH12AB1234', totalValue: 60000 })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Record the e-way bill number' }).click()
  await page.getByLabel(/E-way bill number/).fill('271012345678'); await page.getByLabel(/Generated on/).fill(`${today} 12:00:00`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('271012345678')).toBeVisible()
})
