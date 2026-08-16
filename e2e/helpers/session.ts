import { expect, type Page } from '@playwright/test';

/**
 * The account `auth.spec.ts` creates during first-run setup. Spec files run in
 * path order on one shared instance, so every later spec signs in with it.
 */
export const ADMIN = {
  orgName: 'Acme Corp',
  name: 'Tomasz Kowalski',
  email: 'tomasz@acme.io',
  password: 'correct-horse-battery',
};

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
