import { expect, test } from '@playwright/test';
import { signIn } from '../helpers/session';

// The three things you reach for rather than navigate to: the dashboard, ⌘K,
// and a bulk import. Runs after members.spec, so the instance already has an
// asset, a person and a renamed tag prefix.

test('the dashboard counts the fleet and clicks through to a filtered list', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(/assets tracked$/)).toBeVisible();

  // Six tiles whatever the inventory holds, and Laptops has the one asset.
  await expect(page.getByRole('button', { name: /^Lost\/Stolen 0$/ })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Laptops' })).toHaveAttribute('aria-valuenow', '1');

  // The activity widget renders the same sentences the log does.
  await expect(page.getByText(/Checked in MacBook Pro 14" from Maya Lindqvist/)).toBeVisible();

  await page.getByRole('button', { name: 'Available 1' }).click();
  await expect(page).toHaveURL(/\/assets\?status=available/);
  await expect(page.getByRole('button', { name: 'Available 1' })).toHaveAttribute(
    'data-active',
    'true',
  );
});

test('hiding a widget sticks to the member, across a reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: /customize widgets/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('switch', { name: 'Assets by category' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('heading', { name: 'Assets by category' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assets by category' })).toBeHidden();

  // Put it back, so the rest of the suite sees the dashboard the design draws.
  await page.getByRole('button', { name: /customize widgets/i }).click();
  await page.getByRole('dialog').getByRole('switch', { name: 'Assets by category' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Assets by category' })).toBeVisible();
});

test('⌘K finds an asset and opens it without touching the mouse', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');
  // The shortcut is registered by the shell, so wait for the shell.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(palette).toContainText('↑↓ navigate');

  await page.keyboard.type('macbook');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'MacBook Pro 14"' })).toBeVisible();
  await expect(palette).toBeHidden();
});

test('⌘K opens a modal an action names, and esc closes the palette', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('invite');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /invite member/i })).toBeVisible();
});

test('imports a CSV, fixes the row it complains about, and imports it', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: /import csv/i }).click();
  const dialog = page.getByRole('dialog', { name: /import from csv/i });

  const upload = async (contents: string) =>
    dialog.getByLabel('CSV file').setInputFiles({
      name: 'assets.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(contents),
    });

  // One good row, one with a category nothing in this build answers to.
  await upload(
    [
      'asset_tag,name,category,serial_number,status',
      'INV-5001,ThinkPad X1 Carbon,Laptops,LR0ABC123,Available',
      'INV-5002,Herman Miller Aeron,Furniture,CHAIR-9,Available',
    ].join('\n'),
  );
  await expect(dialog.getByText(/2 rows/)).toBeVisible();
  await dialog.getByRole('button', { name: /continue to mapping/i }).click();

  // The headers match the canonical names, so nothing needs pointing.
  await expect(dialog.getByLabel('asset_tag')).toHaveValue('asset_tag');
  await dialog.getByRole('button', { name: /check the file/i }).click();

  await expect(dialog.getByText(/1 of 2 rows cannot be imported/)).toBeVisible();
  await expect(dialog.getByText(/Row 3 · category/)).toBeVisible();
  await expect(dialog.getByText(/"Furniture" is not one of the categories/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Import/ })).toHaveCount(0);

  // Fix it without leaving the wizard: back to the file step, upload again.
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await upload(
    [
      'asset_tag,name,category,serial_number,status',
      'INV-5001,ThinkPad X1 Carbon,Laptops,LR0ABC123,Available',
      'INV-5002,Herman Miller Aeron,Peripherals,CHAIR-9,Available',
    ].join('\n'),
  );
  await dialog.getByRole('button', { name: /continue to mapping/i }).click();
  await dialog.getByRole('button', { name: /check the file/i }).click();

  await expect(dialog.getByText('2 rows ready')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(dialog.getByText('Added 2 assets')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The list behind the modal has already refreshed.
  await expect(page.getByRole('row').filter({ hasText: 'INV-5001' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'INV-5002' })).toBeVisible();
});

test('an import that arrives assigned opens a real ownership record', async ({ page }) => {
  await signIn(page);
  await page.goto('/employees');
  await page.getByRole('button', { name: /import csv/i }).click();
  const dialog = page.getByRole('dialog', { name: /import from csv/i });

  // Employees first, matched by email — Maya already exists, Jonas does not.
  await dialog.getByRole('button', { name: 'Employees' }).click();
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'employees.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'first_name,last_name,email,job_title,department',
        'Maya,Lindqvist,maya.lindqvist@acme.io,Principal Designer,Design',
        'Jonas,Weber,jonas.weber@acme.io,Content Lead,Marketing',
      ].join('\n'),
    ),
  });
  await dialog.getByRole('button', { name: /continue to mapping/i }).click();
  await dialog.getByRole('button', { name: /check the file/i }).click();
  await expect(dialog.getByText(/1 employee to add · 1 to update/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(dialog.getByText(/Added 1 employee · updated 1/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The update kept the row rather than adding a second Maya.
  await expect(page.getByRole('row').filter({ hasText: 'maya.lindqvist@acme.io' })).toContainText(
    'Principal Designer',
  );
  await expect(page.getByRole('row').filter({ hasText: 'jonas.weber@acme.io' })).toBeVisible();

  // Now an asset already in somebody's hands.
  await page.goto('/assets');
  await page.getByRole('button', { name: /import csv/i }).click();
  const assets = page.getByRole('dialog', { name: /import from csv/i });
  await assets.getByLabel('CSV file').setInputFiles({
    name: 'assets.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'asset_tag,name,category,status,assigned_to_email,purchase_date',
        'INV-5003,Dell Latitude 7440,Laptops,Assigned,jonas.weber@acme.io,2025-02-03',
      ].join('\n'),
    ),
  });
  await assets.getByRole('button', { name: /continue to mapping/i }).click();
  await assets.getByRole('button', { name: /check the file/i }).click();
  await assets.getByRole('button', { name: 'Import 1 row' }).click();
  await assets.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('row').filter({ hasText: 'INV-5003' }).click();
  await expect(page.getByRole('heading', { name: 'Dell Latitude 7440' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Jonas Weber/ })).toBeVisible();
  // Not a status flag on the asset but a real ownership record, dated from the
  // row's own purchase date and readable on the timeline like any other.
  await expect(page.getByText(/Checked out Feb 3, 2025/)).toBeVisible();
  await expect(page.getByRole('list').first()).toContainText('Jonas Weber');
});

test('exports the whole workspace as JSON', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings');

  const href = await page.getByRole('link', { name: 'Export' }).getAttribute('href');
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('attachment');

  const body = await response.json();
  expect(body.formatVersion).toBe(1);
  expect(body.assets.length).toBeGreaterThan(2);
  expect(body.employees.length).toBeGreaterThan(1);
  // No secrets in a file people email around.
  expect(await response.text()).not.toContain('$argon2');
});
