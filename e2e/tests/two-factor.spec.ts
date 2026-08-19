import { expect, test, type Page } from '@playwright/test';
import { ADMIN, signIn } from '../helpers/session';
import { totpCode } from '../helpers/totp';

// The two-factor journey, end to end: the workspace switches it on, the admin
// enrols, spends a recovery code getting back in, watches the count drop, has
// the set reset out from under them and is handed a fresh ten by the very
// sign-in that needed it.
//
// It leaves the workspace as it found it — the requirement off, which is what
// wipes every secret and code — because every later spec signs in with a
// password alone.
//
// **The name is load-bearing**, like `zz-workspace-delete`'s: specs run in path
// order, and this one writes a dozen events (sign-ins, an enrolment, two
// settings changes). Sorting before `overview` would push the check-in the
// dashboard's recent-activity widget is asserted on off the bottom of it.

const CODE_PATTERN = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
/** The same shape, unanchored — for asserting a code is nowhere in a page. */
const ANY_CODE = /[a-z0-9]{5}-[a-z0-9]{5}/;

/** The admin's own row on the Members page. */
const adminRow = (page: Page) => page.getByRole('row').filter({ hasText: ADMIN.email });

/** Signs in from a clean browser, stopping at whatever the second step shows. */
async function passwordStep(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
}

async function setRequireMfa(page: Page, required: boolean): Promise<void> {
  await page.goto('/admin');
  const toggle = page.getByRole('switch', { name: 'Require two-factor authentication' });
  await expect(toggle).toHaveAttribute('aria-checked', String(!required));
  await toggle.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
}

test('two-factor: enrol, spend a code, and be handed a fresh set at sign-in', async ({ page }) => {
  await signIn(page);
  await setRequireMfa(page, true);

  // The requirement is read per request, so a reload is all it takes for the
  // signed-in admin to meet the one screen they are now allowed on.
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Set up two-factor authentication' }),
  ).toBeVisible();

  // What an authenticator app would scan, typed in by hand instead.
  const secret = await page.locator('code').innerText();
  await page.getByLabel('Code from the app').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Confirm and finish' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const firstSet = await page.getByText(CODE_PATTERN).allTextContents();
  expect(firstSet).toHaveLength(10);
  await page.getByLabel('I have saved these somewhere safe').check();
  await page.getByRole('button', { name: 'Continue to Inventory' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();

  // The admin surface says where everybody stands, which is the whole point of
  // the column: enrolled, with the full set still in hand.
  await page.goto('/members');
  await expect(adminRow(page)).toContainText('Enrolled');
  await expect(adminRow(page)).toContainText('10 of 10 codes left');

  // Signing in on a recovery code spends it, and the count says so.
  await passwordStep(page);
  await page.getByLabel('Authentication code').fill(firstSet[0]!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.goto('/members');
  await expect(adminRow(page)).toContainText('9 of 10 codes left');

  // An admin resets the set — the authenticator stays, so this session does
  // too, and there is nothing to hand over yet.
  await adminRow(page)
    .getByRole('button', { name: /Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Reset recovery codes' }).click();
  await expect(
    page.getByText('Tomasz Kowalski will get fresh codes at their next sign-in.'),
  ).toBeVisible();
  await expect(adminRow(page)).toContainText('0 of 10 codes left');

  // …and the next sign-in is where the new set arrives, before the app does.
  await passwordStep(page);
  await page.getByLabel('Authentication code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.getByText(/were reset/)).toBeVisible();
  const secondSet = await page.getByText(CODE_PATTERN).allTextContents();
  expect(secondSet).toHaveLength(10);
  // A genuinely new set: nothing survives from the one that was reset.
  expect(secondSet.filter((code) => firstSet.includes(code))).toEqual([]);
  // Nobody is in the app until they say they have kept them.
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await page.getByLabel('I have saved these somewhere safe').check();
  await page.getByRole('button', { name: 'Continue to Inventory' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();

  await page.goto('/members');
  await expect(adminRow(page)).toContainText('10 of 10 codes left');
});

test('the log records both halves of it, and neither names a code', async ({ page }) => {
  await signIn(page);
  await page.goto('/activity');

  const table = page.getByRole('table');
  await expect(table).toContainText('Tomasz Kowalski set up two-factor authentication');
  await expect(table).toContainText('Reset the recovery codes for Tomasz Kowalski');
  await expect(table).toContainText('Tomasz Kowalski’s recovery codes were reissued');
  // The log says a set changed, never what was in it.
  await expect(table).not.toContainText(ANY_CODE);
});

test('turning the requirement off takes every secret and code with it', async ({ page }) => {
  await signIn(page);
  await setRequireMfa(page, false);

  // The secret went with it, which is what "not enrolled" on this row means —
  // and what every later spec in this suite assumes when it signs in with a
  // password alone. The em dash is the design's empty cell.
  await page.goto('/members');
  await expect(adminRow(page)).not.toContainText('Enrolled');
  await expect(adminRow(page)).not.toContainText('codes left');
});
