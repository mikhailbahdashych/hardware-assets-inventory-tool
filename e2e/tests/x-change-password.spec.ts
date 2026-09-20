import { expect, test } from '@playwright/test';

// Grace has existed since members.spec invited her and roles.spec promoted
// her; nothing after this file signs in as her, which is why this spec may
// change her password — and why it sorts late (`x-`), per the rule that what a
// spec leaves behind decides where it may sit. It also spends two of the
// suite's login budget (see e2e/CLAUDE.md) — which is why the multi-browser
// revocation and the old-password refusal stay pinned by the API integration
// tests rather than being re-proven here with more sign-ins.
const GRACE = { email: 'grace.chen@acme.io', password: 'a-longer-passphrase' };
const NEW_PASSWORD = 'an-even-longer-passphrase';

test('a member changes their own password from the sidebar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(GRACE.email);
  await page.getByLabel('Password').fill(GRACE.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Inventory' })).toBeVisible();

  await page.getByRole('button', { name: 'Change password' }).click();
  const dialog = page.getByRole('dialog');

  // The wrong current password is the server's call, and its sentence lands
  // under the field it names rather than in a toast nobody can act on.
  await dialog.getByLabel('Current password').fill('not-my-password-at-all');
  await dialog.getByLabel('New password').fill(NEW_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByText('That is not your current password.')).toBeVisible();

  await dialog.getByLabel('Current password').fill(GRACE.password);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog).not.toBeVisible();
  // The consequence is announced, and this session survives it.
  await expect(page.getByText(/signed out everywhere else/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Inventory' })).toBeVisible();

  // Around the loop: the new password is the account now. (That the old one
  // is refused is the API test's fact; a failed login here would spend the
  // shared budget on something already pinned.)
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await page.getByLabel('Email').fill(GRACE.email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Inventory' })).toBeVisible();
});
