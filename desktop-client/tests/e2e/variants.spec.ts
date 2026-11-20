import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('variants: sizes and colours become separate items, each with a barcode', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'var' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Items')
  await page.getByRole('button', { name: 'New variants' }).click()
  const d = page.getByRole('dialog', { name: 'New variants' })
  await d.getByLabel('Style code').fill('POLO'); await d.getByLabel('Product name').fill('Polo shirt')
  await d.getByLabel('Sizes').fill('S, M'); await d.getByLabel('Colours').fill('Red, Blue')
  await d.getByLabel('HSN code').fill('6105'); await d.getByLabel('MRP (each)').fill('799')
  await expect(d.getByLabel('Preview')).toContainText('4 items will be created')
  await d.getByRole('button', { name: 'Create items' }).click()
  await expect(d.getByText(/4 created/)).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByLabel('Search').fill('POLO')
  await expect(page.getByRole('cell', { name: 'POLO-M-BLUE', exact: true })).toBeVisible()
  const items = ((await s.call('GET', '/v1/items?q=POLO&limit=20')).items as unknown as { id: string; size: string; colour: string; styleCode: string }[])
  expect(items).toHaveLength(4); expect(items.every((i) => i.styleCode === 'POLO')).toBe(true)
  for (const it of items) { const b = ((await s.call('GET', `/v1/items/${it.id}/barcodes`)).items as unknown as { barcode: string }[]); expect(b[0]?.barcode).toMatch(/^2\d{12}$/) }
})
