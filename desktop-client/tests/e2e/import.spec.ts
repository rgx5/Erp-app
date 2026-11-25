import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('import: a Vyapar backup for customers (asking what its codes mean), and a JSON file of items with other names for the columns', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'im' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // a backup file with several tables: the one holding the people is picked, the columns are matched, the codes are asked
  await goTo(page, 'Import data')
  await page.getByRole('button', { name: /Import customers/ }).click()
  await page.getByLabel('Data file').setInputFiles({ name: 'company.vyb', mimeType: 'application/octet-stream', buffer: readFileSync('tests/fixtures/import/small.vyb') })
  await expect(page.getByText(/Vyapar backup: company\.vyb/)).toBeVisible()
  await expect(page.getByLabel('Table or sheet')).toHaveValue('0')
  await expect(page.getByLabel('Column for Legal name')).toHaveText(/full_name/)
  await expect(page.getByLabel('Column for GSTIN')).toHaveValue(/\d/)
  await page.getByLabel('Role for 1').selectOption('customer'); await page.getByLabel('Role for 2').selectOption('supplier')
  await page.getByRole('button', { name: /Check 3 rows/ }).click()
  await expect(page.getByText(/3 rows · 3 ready/)).toBeVisible()
  await page.getByRole('button', { name: 'Import 3 rows' }).click()
  await expect(page.getByText(/3 created/)).toBeVisible()
  const parties = (await s.call('GET', '/v1/parties?limit=50')).items as unknown as { code: string; legalName: string; isCustomer: boolean; isSupplier: boolean; gstTreatment: string; phone: string | null }[]
  const mine = (n: string) => parties.find((p) => p.legalName === n)
  expect(mine('Ravi Stores')).toMatchObject({ code: 'RAVI-STORES', isCustomer: true, gstTreatment: 'consumer', phone: '9812345678' })
  expect(mine('Mehta Supplies')).toMatchObject({ isSupplier: true })
  expect(mine('Kiran Hardware')).toMatchObject({ gstTreatment: 'registered_regular' })
  await page.getByRole('button', { name: 'Done' }).click()

  // a JSON file whose columns are named differently: matched by name, units and tax rates understood
  await goTo(page, 'Import data')
  await page.getByRole('button', { name: /Import items/ }).click()
  const json = [{ productName: 'Brass tap', sku: 'BT-1', hsnCode: '8481', uom: 'Pcs', taxRate: '18%', retailPrice: '250' }, { productName: 'Copper pipe', sku: 'CP-1', hsnCode: '7411', uom: 'Mtr', taxRate: '18', retailPrice: '' }]
  await page.getByLabel('Data file').setInputFiles({ name: 'products.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ products: json })) })
  await expect(page.getByLabel('Column for Name')).toHaveText(/productName/)
  await expect(page.getByLabel('Column for Code')).toHaveText(/sku/)
  await page.getByLabel('Column for MRP').selectOption({ label: 'retailPrice' })
  await page.getByRole('button', { name: /Check 2 rows/ }).click()
  await expect(page.getByText(/2 rows · 2 ready/)).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 rows' }).click()
  await expect(page.getByText(/2 created/)).toBeVisible()
  const items = (await s.call('GET', '/v1/items?limit=50')).items as unknown as { code: string; hsnSacCode: string | null; mrp: string | null }[]
  expect(items.find((i) => i.code === 'BT-1')).toMatchObject({ hsnSacCode: '8481', mrp: '250.0000' })
  expect(items.find((i) => i.code === 'CP-1')).toMatchObject({ hsnSacCode: '7411' })
})
