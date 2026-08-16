import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Cookie, type Page } from '@playwright/test';

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

const STATE_FILE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));

/** A real sign-in through the form. Use where signing in *is* the subject. */
export async function signInFresh(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

/**
 * Signs in once per suite run and replays the session cookie afterwards.
 *
 * Browser contexts are per-test, so a spec of a dozen tests would otherwise
 * post a dozen logins and trip the API's brute-force rate limit — which is the
 * limit working correctly, not a test-only problem. Reusing one session is
 * also what a real person does.
 */
export async function signIn(page: Page): Promise<void> {
  if (existsSync(STATE_FILE)) {
    const cookies = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Cookie[];
    await page.context().addCookies(cookies);
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation')).toBeVisible();
    return;
  }

  await signInFresh(page);
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(await page.context().cookies(), null, 2));
}
