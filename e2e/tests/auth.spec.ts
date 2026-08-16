import { expect, test } from '@playwright/test';
import { ADMIN, signInFresh as signIn } from '../helpers/session';

// The suite shares one instance, so these run in order: the first test performs
// first-run setup and every later test signs in with the account it created.
// Browser contexts are per-test, so each test starts signed out.

test('first-run setup creates the workspace and signs the admin in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel('Organization name').fill(ADMIN.orgName);
  await page.getByLabel('Your name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(ADMIN.orgName)).toBeVisible();
  await expect(page.getByText(ADMIN.name)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('setup is unreachable once the instance is initialized', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Sign in to Inventory' })).toBeVisible();
});

test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
  await page.goto('/assets');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Inventory' })).toBeVisible();
  await expect(page.getByText('Self-hosted hardware asset tracking for Acme Corp')).toBeVisible();
});

test('rejects the wrong password with the server message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signs in, navigates the shell, and signs out again', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('link', { name: 'Assets' }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('link', { name: 'Assets' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The session is really gone, not just the client-side state.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('remembers the theme across a reload without flashing the old one', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  // Asserted before the app has a chance to hydrate: the inline script in
  // index.html must have applied the theme already.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 14, 17)');
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('carries the stored theme to a fresh session on the same browser', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('inv.theme', 'dark'));
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('falls back to the system color scheme for a first-time visitor', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('serves an unknown deep link through the SPA instead of a 404', async ({ page }) => {
  const response = await page.goto('/employees/does-not-exist-yet');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Sign in to Inventory' })).toBeVisible();
});
