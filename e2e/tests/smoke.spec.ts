import { expect, test } from '@playwright/test';

test('renders the app with the Inventory wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Inventory');
  await expect(page.getByText('Inventory', { exact: true })).toBeVisible();
});

test('applies a stored dark theme before first paint', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('inv.theme', 'dark'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(14, 14, 17)'); // --bg in the dark token set
});

test('falls back to the system color scheme when nothing is stored', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
