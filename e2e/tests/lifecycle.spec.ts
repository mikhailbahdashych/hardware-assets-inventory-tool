import { expect, test } from '@playwright/test';
import { choose } from '../helpers/dropdown';
import { signIn } from '../helpers/session';

// Continues where inventory.spec.ts stops: AST-0001 exists and Maya Lindqvist
// is holding it. This is the round trip — take it back, hand it out again from
// the person's side, and watch the ownership history record every leg.

async function openAsset(page: import('@playwright/test').Page) {
  await page.goto('/assets');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();
  await expect(page.getByRole('heading', { name: 'MacBook Pro 14"' })).toBeVisible();
}

test('checks the asset in and writes the return into its history', async ({ page }) => {
  await signIn(page);
  await openAsset(page);

  await page.getByRole('button', { name: 'Check in' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Returning from Maya Lindqvist');
  await dialog.getByLabel('Return date').fill('2026-07-01');
  await choose(page, dialog, 'Condition', 'Good');
  await dialog.getByRole('button', { name: 'Return to stock' }).click();
  await dialog.getByRole('button', { name: 'Check in asset' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Nobody is holding this asset')).toBeVisible();

  // The timeline keeps the closed holding and opens with the in-stock spell.
  const timeline = page.getByRole('list').first();
  await expect(timeline.getByRole('listitem').first()).toContainText('In stock');
  await expect(timeline).toContainText('Maya Lindqvist');
  await expect(timeline).toContainText('returned');
  await expect(timeline).toContainText('Added to inventory');
});

test('refuses to hand out an asset that is in repair, offering a status change instead', async ({
  page,
}) => {
  await signIn(page);
  await openAsset(page);

  await page.getByRole('button', { name: 'Assign' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByRole('button', { name: 'Cancel' }).click();

  // Move it to In repair, and the primary action becomes Change status —
  // the prototype wires this button to Assign, which has no holder to change.
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog');
  await choose(page, edit, 'Status', 'In repair');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();

  await expect(page.getByRole('button', { name: 'Change status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Change status' }).click();
  const status = page.getByRole('dialog');
  await status.getByRole('combobox', { name: 'New status' }).click();
  // Nothing reaches Assigned except an assignment, so it is not on offer.
  await expect(page.getByRole('option', { name: 'Assigned' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Available', exact: true }).click();
  await status.getByRole('button', { name: 'Change status' }).click();
  await expect(status).toBeHidden();
});

test('hands the asset out again from the employee page', async ({ page }) => {
  await signIn(page);
  await page.goto('/employees');
  await page.getByRole('row').filter({ hasText: 'maya.lindqvist@acme.io' }).click();
  await expect(page.getByText('Currently holding · 0')).toBeVisible();
  // The closed holding shows up as history with its outcome.
  await expect(page.getByText(/→ Jul 2026 · returned/)).toBeVisible();

  await page.getByRole('button', { name: 'Assign asset' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('option', { name: /MacBook Pro 14"/ }).click();
  await dialog.getByLabel('Checkout date').fill('2026-08-01');
  await dialog.getByRole('button', { name: 'Assign asset' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Currently holding · 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in →' })).toBeVisible();
});

test('checks in straight from the holder without leaving their page', async ({ page }) => {
  await signIn(page);
  await page.goto('/employees');
  await page.getByRole('row').filter({ hasText: 'maya.lindqvist@acme.io' }).click();

  await page.getByRole('button', { name: 'Check in →' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Check in AST-0001');
  await dialog.getByLabel('Return date').fill('2026-08-10');
  await dialog.getByRole('button', { name: 'Check in asset' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Currently holding · 0')).toBeVisible();
});

test('attaches a file to the asset and offers it back as a download', async ({ page }) => {
  await signIn(page);
  await openAsset(page);

  await page.getByLabel('Upload attachment').setInputFiles({
    name: 'invoice-ast-0001.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 fake invoice bytes'),
  });

  const link = page.getByRole('link', { name: 'invoice-ast-0001.pdf' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('download', '');

  // The file really is served back, and never as something the browser renders.
  const href = await link.getAttribute('href');
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('attachment');
  expect(await response.text()).toBe('%PDF-1.7 fake invoice bytes');
});

test('adds a custom field, which then appears on every asset form', async ({ page }) => {
  await signIn(page);
  await openAsset(page);

  await page.getByRole('button', { name: 'Manage fields' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New field').fill('Warranty provider');
  await choose(page, dialog, 'Type', 'Text');
  await dialog.getByRole('button', { name: 'Add field' }).click();

  // The key is derived from the label, because values hang off the key.
  await expect(dialog.getByText('warranty_provider')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText('Warranty provider', { exact: true })).toBeVisible();
  await page.goto('/assets');
  await page.getByRole('button', { name: 'New asset' }).click();
  await expect(page.getByRole('dialog').getByLabel('Warranty provider')).toBeVisible();
});

test('records every leg of the journey in the asset audit trail', async ({ page }) => {
  await signIn(page);
  await openAsset(page);

  const trail = page.getByText('Audit log').locator('..');
  await expect(trail).toContainText('Assigned MacBook Pro 14" to Maya Lindqvist');
  await expect(trail).toContainText('Checked in MacBook Pro 14" from Maya Lindqvist');
  await expect(trail).toContainText('Attached invoice-ast-0001.pdf');
  await expect(trail).toContainText('Tomasz Kowalski');
  // Sentences, not action slugs.
  await expect(trail).not.toContainText('asset.assigned');
});
