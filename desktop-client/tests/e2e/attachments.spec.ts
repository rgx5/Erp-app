import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

test('attachments: a photo on an item and a scanned file on an invoice', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'at' })
  const today = new Date().toISOString().slice(0, 10)
  const inv = await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Items')
  await page.getByRole('cell', { name: 'WIDGET', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Steel widget' })
  await expect(drawer.getByText('No photo')).toBeVisible()
  await drawer.getByLabel('Choose a photo').setInputFiles({ name: 'widget.png', mimeType: 'image/png', buffer: PNG })
  await expect(drawer.getByRole('img', { name: 'Item photo' })).toBeVisible()
  const photos = ((await s.call('GET', `/v1/attachments?entityType=item&entityId=${s.widget.id}`)).items as unknown as { kind: string; contentType: string }[])
  expect(photos).toHaveLength(1); expect(photos[0]).toMatchObject({ kind: 'photo', contentType: 'image/jpeg' }) // shrunk and re-saved as a JPEG
  await drawer.getByRole('button', { name: 'Remove' }).click()
  await expect(drawer.getByText('No photo')).toBeVisible()

  await page.goto(`/#/sales/invoices/${inv.id as string}`)
  const panel = page.getByRole('region', { name: 'Attachments' })
  await expect(panel.getByText('Nothing attached.')).toBeVisible()
  await panel.getByLabel('Choose files to attach').setInputFiles({ name: 'signed-delivery.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(panel.getByRole('button', { name: 'signed-delivery.pdf', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Remove signed-delivery.pdf' }).click()
  await expect(panel.getByText('Nothing attached.')).toBeVisible()
})
