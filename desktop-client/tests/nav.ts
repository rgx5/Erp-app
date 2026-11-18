import type { Page } from '@playwright/test'

/** Goes to a page by its menu name, the way a keyboard user does: Ctrl+K, type, Enter. */
export async function goTo(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+k')
  const box = page.getByLabel('Search or run a command').last()
  await box.fill(name)
  await box.press('Enter')
}
