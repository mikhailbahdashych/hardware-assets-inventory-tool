import { expect, test } from '@playwright/test';
import { signIn } from '../helpers/session';

// One continuous journey against the real API: add a person, register a device
// already in their hands, then read it back from every surface that should
// know about it. Runs after auth.spec.ts, which creates the admin account.

const EMPLOYEE = {
  firstName: 'Maya',
  lastName: 'Lindqvist',
  email: 'maya.lindqvist@acme.io',
};

test('adds an employee', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Employees' }).click();
  await expect(
    page.getByText('No employees yet — add the people who will hold your assets.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Add employee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(EMPLOYEE.firstName);
  await dialog.getByLabel('Last name').fill(EMPLOYEE.lastName);
  await dialog.getByLabel('Work email').fill(EMPLOYEE.email);
  await dialog.getByLabel('Job title').fill('Product Designer');
  await dialog.getByLabel('Department').selectOption('Design');
  await dialog.getByLabel('Location').fill('Stockholm');
  await dialog.getByRole('button', { name: 'Add employee' }).click();

  await expect(dialog).toBeHidden();
  // Scoped to the row: the success toast names the person too.
  const row = page.getByRole('row').filter({ hasText: EMPLOYEE.email });
  await expect(row).toContainText('Maya Lindqvist');
  await expect(row).toContainText('Product Designer');
  await expect(row).toContainText('Design');
  await expect(page.getByText('1 employee')).toBeVisible();
});

test('registers an asset that is already in somebody’s hands', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Assets' }).click();

  await page.getByRole('button', { name: 'New asset' }).click();
  const dialog = page.getByRole('dialog');
  // The tag is suggested from the organization prefix and stays editable.
  await expect(dialog.getByLabel('Asset tag')).toHaveValue('AST-0001');

  await dialog.getByLabel('Name', { exact: true }).fill('MacBook Pro 14"');
  await dialog.getByLabel('Category').selectOption('laptops');
  await dialog.getByLabel('Status').selectOption('assigned');
  await dialog.getByLabel('Assigned to').selectOption({ label: 'Maya Lindqvist' });
  await dialog.getByLabel('Checkout date').fill('2026-03-14');
  await dialog.getByLabel('Serial number').fill('C02XK1AZQ6L7');
  await dialog.getByLabel('Purchase price').fill('2,340.00');
  await dialog.getByLabel('Purchase date').fill('2026-03-12');
  await dialog.getByLabel('MDM enrolled').check();
  await dialog.getByRole('button', { name: 'Create asset' }).click();

  await expect(dialog).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: 'AST-0001' });
  await expect(row).toContainText('MacBook Pro 14"');
  await expect(row).toContainText('Assigned');
  await expect(row).toContainText('Maya Lindqvist');
  await expect(page.getByText('1 asset')).toBeVisible();
});

test('filters the list and keeps the filter in the URL', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');

  await expect(page.getByRole('button', { name: 'All 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Available 0' }).click();
  await expect(page).toHaveURL(/status=available/);
  await expect(page.getByText('No assets match these filters.')).toBeVisible();

  await page.goto('/assets?q=c02xk1');
  await expect(page.getByText('MacBook Pro 14"')).toBeVisible();
});

test('reads the asset back on its detail page and follows the holder', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();

  await expect(page.getByRole('heading', { name: 'MacBook Pro 14"' })).toBeVisible();
  await expect(page.getByText('Assets / AST-0001')).toBeVisible();
  await expect(page.getByText('AST-0001 · C02XK1AZQ6L7')).toBeVisible();
  // Money is stored in cents and rendered in the organization's currency.
  await expect(page.getByText('€2,340')).toBeVisible();
  await expect(page.getByText('Yes')).toBeVisible();

  await page.getByRole('link', { name: /Maya Lindqvist/ }).click();
  await expect(page.getByRole('heading', { name: 'Maya Lindqvist' })).toBeVisible();
  await expect(page.getByText('Currently holding · 1')).toBeVisible();
  await expect(page.getByText('MacBook Pro 14"')).toBeVisible();
});

test('edits the asset without offering to reassign it', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Status')).toBeDisabled();
  await expect(dialog.getByLabel('Assigned to')).toHaveCount(0);

  await dialog.getByLabel('Supplier').fill('Insight EMEA');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Insight EMEA')).toBeVisible();
});

test('refuses to delete an asset somebody is holding', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete asset' }).click();
  await dialog.getByRole('button', { name: 'Confirm delete' }).click();

  await expect(dialog.getByRole('alert')).toContainText('Check this asset in before deleting it');
});

test('the density control changes row padding', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  const row = page.getByRole('row').filter({ hasText: 'AST-0001' });
  await expect(row).toHaveCSS('padding-top', '12px');

  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(row).toHaveCSS('padding-top', '7px');

  // Density is a member preference, so it survives a reload like the theme.
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'AST-0001' })).toHaveCSS(
    'padding-top',
    '7px',
  );
});
