import { expect, test } from '@playwright/test';
import { ADMIN, signIn } from '../helpers/session';

// The `zz-` prefix is load-bearing: spec files run in path order on one shared
// instance, and this one empties it. Anything that runs after would find a
// workspace waiting to be set up. New specs sort before this by default; give
// them ordinary names and they stay safe.

test('will not delete the workspace on a near-miss confirmation', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Delete…' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Delete workspace' });
  await expect(confirm).toBeDisabled();

  // Right letters, wrong case — the API compares exactly, and so does this.
  await dialog.getByLabel(`Type ${ADMIN.orgName} to confirm`).fill(ADMIN.orgName.toLowerCase());
  await expect(confirm).toBeDisabled();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/assets');
  await expect(page.getByRole('row').filter({ hasText: 'AST-0001' })).toBeVisible();
});

test('deletes the workspace and leaves an instance asking to be set up', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Delete…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(`Type ${ADMIN.orgName} to confirm`).fill(ADMIN.orgName);
  await dialog.getByRole('button', { name: 'Delete workspace' }).click();

  await expect(page.getByRole('heading', { name: /set up inventory/i })).toBeVisible();

  // The session went with everything else, so no route leads back in.
  await page.goto('/assets');
  await expect(page.getByRole('heading', { name: /set up inventory/i })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /set up inventory/i })).toBeVisible();

  // And it really is a fresh instance: setup runs again, from the top.
  await page.getByLabel('Organization name').fill('Globex');
  await page.getByLabel('Your name').fill('Priya Sharma');
  await page.getByLabel('Email').fill('priya@globex.io');
  await page.getByLabel('Password').fill('another-good-passphrase');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByText('Globex')).toBeVisible();
  // Nothing came back with it.
  await page.goto('/assets');
  await expect(page.getByText(/No assets yet/)).toBeVisible();
});
