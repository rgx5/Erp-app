import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('delivery challan: create it with vehicle details, print it, then invoice it (stock and tax move only then)', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'dc' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.evaluate(() => { window.print = () => undefined })

  await goTo(page, 'Delivery challans')
  await expect(page.getByText('No delivery challans yet.')).toBeVisible()
  await page.getByRole('button', { name: 'New delivery challan' }).click()
  await expect(page.getByRole('heading', { name: 'New delivery challan' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Customer', exact: true }).fill('asha'); await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Vehicle number (optional)').fill('MH12AB1234')
  await page.getByLabel('Transporter (optional)').fill('Swift Logistics')
  await page.getByLabel('Item', { exact: true }).fill('wid'); await page.getByLabel('Item', { exact: true }).press('Enter')
  await page.getByLabel('Quantity').first().fill('3'); await page.getByLabel('Price').first().fill('1000')
  await page.getByRole('button', { name: 'Save challan' }).click()
  await expect(page.getByRole('cell', { name: /^DLV\// })).toBeVisible()
  const orders = ((await s.call('GET', `/v1/sales/delivery-challans?companyId=${s.company.id}`)).items as unknown as { id: string; vehicleNo: string; status: string }[])
  expect(orders).toHaveLength(1); expect(orders[0]).toMatchObject({ vehicleNo: 'MH12AB1234', status: 'open' })
  const invoices = async () => ((await s.call('GET', `/v1/sales/invoices?companyId=${s.company.id}`)).items ?? []).length
  expect(await invoices()).toBe(0)

  await page.getByRole('cell', { name: /^DLV\// }).click()
  await page.getByRole('button', { name: 'Print delivery challan' }).click()
  const read = () => page.evaluate(() => document.querySelector('iframe:last-of-type')?.getAttribute('srcdoc') ?? '')
  await expect.poll(read).toContain('Delivery Challan')
  const printed = await read()
  expect(printed).toContain('Delivery Challan'); expect(printed).toContain('MH12AB1234'); expect(printed).toContain('Swift Logistics'); expect(printed).toContain('not a tax invoice')

  await page.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByText(/posted from DLV\//)).toBeVisible()
  expect(await invoices()).toBe(1)
  expect(((await s.call('GET', `/v1/sales/delivery-challans?companyId=${s.company.id}`)).items as unknown as { status: string }[])[0]?.status).toBe('invoiced')
})
