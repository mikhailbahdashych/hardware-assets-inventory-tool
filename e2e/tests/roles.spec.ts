import { expect, test, type Page } from '@playwright/test';
import { choose } from '../helpers/dropdown';
import { signIn } from '../helpers/session';

// Roles stopped being an enum ranked viewer < manager < admin, and this is the
// journey that proves it: an admin invents a fourth one, ticks two boxes, and a
// person who already had an account can suddenly read the activity log and
// still not create an asset — with the API agreeing, which is the half a
// hidden button never proves.
//
// Runs after members.spec.ts, which left Grace Chen holding Viewer.

const GRACE = { email: 'grace.chen@acme.io', name: 'Grace Chen', password: 'a-longer-passphrase' };

/** A row of the roles card — the matrix below repeats every label as a column. */
const roleRow = (page: Page, label: string) =>
  page.getByRole('table', { name: 'Roles' }).getByRole('row').filter({ hasText: label });

/** The two boxes that make an Auditor, as the matrix names them. */
const AUDIT_VIEW = 'Auditor: View the activity log';
const EXPORT_RUN = 'Auditor: Export all data';

test('an admin invents a role and grants it exactly two things', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Roles' }).click();
  await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Add role' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Auditor');
  // The id is derived from the label the once, and the form says so first.
  await expect(dialog.getByText('Stored as auditor')).toBeVisible();
  await dialog.getByLabel('Description').fill('Reads the books: activity log and exports');
  // Colour options carry the `sv` key as their description, so the option
  // reads "Amber warn" while the closed field only ever shows the colour.
  await choose(page, dialog, 'Color', 'Amber warn', 'Amber');
  await dialog.getByRole('button', { name: 'Add role' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Added the role "Auditor".')).toBeVisible();
  // A new role arrives inert: nobody holds it and it may do nothing at all.
  // Scoped to the roles card, because the matrix below now has a column
  // header by the same name — which is the point of it.
  await expect(roleRow(page, 'Auditor')).toContainText('0 members');
  await expect(page.getByRole('checkbox', { name: AUDIT_VIEW })).not.toBeChecked();

  await page.getByRole('checkbox', { name: AUDIT_VIEW }).check();
  await page.getByRole('checkbox', { name: EXPORT_RUN }).check();
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByText('Permissions saved.')).toBeVisible();
  await expect(page.getByText('Everything here is saved')).toBeVisible();

  // And the grants really are the stored ones now, not a hopeful local set.
  const response = await page.request.get('/api/v1/roles');
  const { roles } = (await response.json()) as {
    roles: { id: string; label: string; color: string; permissions: string[] }[];
  };
  const auditor = roles.find((role) => role.id === 'auditor');
  expect(auditor).toBeDefined();
  expect(auditor!.color).toBe('warn');
  expect(auditor!.permissions.sort()).toEqual(['audit.view', 'export.run']);
});

test('the Admin column is every action, and nobody may edit their own row', async ({ page }) => {
  await signIn(page);
  await page.goto('/roles');

  // The system role holds every action by definition, so its column is ticked
  // and locked rather than stored — which is also why it has no edit or delete.
  // The name is matched loosely because this admin holds Admin, so the cell
  // carries the own-role hint on top of being a system one.
  const adminBox = page.getByRole('checkbox', { name: /^Admin: Delete the workspace/ });
  await expect(adminBox).toBeChecked();
  await expect(adminBox).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Edit Admin/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete Admin/ })).toHaveCount(0);
});

test('the member who holds it reads the log and still creates nothing', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto('/members');

  await page
    .getByRole('row')
    .filter({ hasText: GRACE.email })
    .getByRole('button', { name: /Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Change role' }).click();

  const dialog = page.getByRole('dialog');
  // The cards are rows now, so the one the admin invented a moment ago is on
  // offer here with the description they wrote.
  await expect(dialog.getByText('Reads the books: activity log and exports')).toBeVisible();
  await dialog.getByRole('radio', { name: /Auditor/ }).click();
  await dialog.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByText('Grace Chen is now Auditor.')).toBeVisible();

  // A second browser context: a different person, on a different machine.
  const auditorContext = await browser.newContext();
  const auditor = await auditorContext.newPage();
  await auditor.goto('/login');
  await auditor.getByLabel('Email').fill(GRACE.email);
  await auditor.getByLabel('Password').fill(GRACE.password);
  await auditor.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(auditor.getByRole('navigation')).toBeVisible();

  // Two ticks in a grid is the whole difference: the log opens now, and it is
  // reached the way every other page is.
  await auditor.getByRole('link', { name: 'Activity log' }).click();
  await expect(auditor.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await expect(auditor.getByRole('link', { name: 'Export log' })).toBeVisible();

  // Nothing else moved. The pages a role can reach never changed — what a role
  // may *do* is what the matrix decides.
  const nav = auditor.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Roles' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await auditor.goto('/assets');
  await expect(auditor.getByRole('button', { name: 'New asset' })).toHaveCount(0);

  // And the door is shut, not just the button hidden: the guard reads the very
  // same set the sidebar did.
  const refused = await auditor.request.post('/api/v1/assets', {
    data: { name: 'Smuggled ThinkPad', category: 'laptops', status: 'available' },
  });
  expect(refused.status()).toBe(403);
  // The log the auditor may read is one they cannot write to either.
  const alsoRefused = await auditor.request.post('/api/v1/roles', {
    data: { label: 'Auditor Plus', color: 'ok' },
  });
  expect(alsoRefused.status()).toBe(403);

  await auditorContext.close();
});

test('deleting a role in use asks where its members go', async ({ page }) => {
  await signIn(page);
  await page.goto('/roles');

  // A role to throw away, and somebody standing on it.
  await page.getByRole('button', { name: 'Add role' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill('Contractor');
  await form.getByRole('button', { name: 'Add role' }).click();
  await expect(page.getByText('Added the role "Contractor".')).toBeVisible();

  await page.goto('/members');
  await page
    .getByRole('row')
    .filter({ hasText: GRACE.email })
    .getByRole('button', { name: /Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Change role' }).click();
  await page
    .getByRole('dialog')
    .getByRole('radio', { name: /Contractor/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByText('Grace Chen is now Contractor.')).toBeVisible();

  // The first press asks for the delete plainly; the server is what knows
  // somebody holds it, and only then does the form ask where they go.
  await page.goto('/roles');
  await expect(roleRow(page, 'Contractor')).toContainText('1 member');
  await page.getByRole('button', { name: /^Delete Contractor/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete role' }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 member holds this role');

  await choose(page, dialog, 'Move them to', 'Auditor');
  await dialog.getByRole('button', { name: 'Move and delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deleted "Contractor".')).toBeVisible();

  // The row is gone and its member came with it, which is the half of the
  // operation a disappearing row would not prove.
  await expect(roleRow(page, 'Contractor')).toHaveCount(0);
  await expect(roleRow(page, 'Auditor')).toContainText('1 member');

  // One summary event, not one per member — and it names both roles.
  await page.goto('/activity');
  await expect(page.getByRole('table')).toContainText(
    'Deleted the role Contractor · 1 member moved to Auditor',
  );
});
