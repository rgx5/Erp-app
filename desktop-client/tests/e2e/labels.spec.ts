import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('barcodes: generate one for an item, and print labels for many items at once', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'lbl' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // one item: generate a barcode from its drawer
  await goTo(page, 'Items')
  await page.getByRole('cell', { name: 'WIDGET', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Steel widget' })
  await drawer.getByRole('button', { name: 'Generate a barcode' }).click()
  const region = drawer.getByRole('region', { name: 'Barcodes' })
  await expect(region).toContainText(/\b2\d{12}\b/)
  await drawer.getByRole('button', { name: 'Close' }).click().catch(() => page.keyboard.press('Escape'))

  // many items: the labels screen gives the one without a barcode a new one and leaves the first alone
  await goTo(page, 'Print labels')
  await page.getByLabel('Select all shown').check()
  await expect(page.getByText(/2 items · 2 labels/)).toBeVisible()
  await page.getByLabel('Copies of Plastic toy').fill('3')
  await expect(page.getByText(/2 items · 4 labels/)).toBeVisible()
  await page.getByRole('button', { name: 'Print labels' }).click()
  await expect(page.getByText(/1 new barcode created/)).toBeVisible()
  const items = (await s.call('GET', '/v1/items?limit=50')).items as { id: string; code: string }[]
  for (const it of items.filter((i) => ['WIDGET', 'TOY'].includes(i.code))) {
    const b = (await s.call('GET', `/v1/items/${it.id}/barcodes`)).items as unknown as { barcode: string }[]
    expect(b).toHaveLength(1); expect(b[0]?.barcode).toMatch(/^2\d{12}$/)
  }
})
