import { expect, test } from '@playwright/test';
import { signIn } from '../helpers/session';

// The membership journey, on the instance the earlier specs built: invite a
// viewer, watch them accept and find every mutation gone, then read the admin
// surfaces that recorded it. This is also where the read-only pass lives — it
// was deferred from the auth PR because creating a non-admin needs invites.

const GRACE = { email: 'grace.chen@acme.io', name: 'Grace Chen', password: 'a-longer-passphrase' };

test('invites a viewer, who accepts and finds every mutation gone', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/members');

  await page.getByRole('button', { name: 'Invite member' }).click();
  const invite = page.getByRole('dialog');
  await invite.getByLabel('Email', { exact: true }).fill(GRACE.email);
  await invite.getByRole('radio', { name: /Viewer/ }).click();
  // No SMTP on this instance, so the copyable link is the whole delivery.
  await invite.getByLabel('Send invitation email now').uncheck();
  await invite.getByRole('button', { name: 'Send invite' }).click();

  const inviteUrl = await invite.getByLabel('Invitation link').inputValue();
  expect(inviteUrl).toContain('/accept-invite?token=');
  await invite.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('row').filter({ hasText: GRACE.email })).toContainText('Invited');

  // A second browser context: a different person, on a different machine.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(inviteUrl);

  await expect(viewer.getByRole('heading', { name: 'Join Acme Corp' })).toBeVisible();
  // The role's own label, read off the row rather than a compiled-in map.
  await expect(viewer.getByText(/invited with the Viewer role/)).toBeVisible();
  await viewer.getByLabel('Your name').fill(GRACE.name);
  await viewer.getByLabel('Password').fill(GRACE.password);
  await viewer.getByRole('button', { name: 'Join workspace' }).click();
  await expect(viewer.getByRole('navigation')).toBeVisible();

  // Read-only everywhere: the lists open, nothing on them acts.
  const nav = viewer.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Assets' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);

  await viewer.goto('/assets');
  await expect(viewer.getByRole('row').filter({ hasText: 'AST-0001' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'New asset' })).toHaveCount(0);

  await viewer.goto('/employees');
  await expect(viewer.getByRole('button', { name: 'Add employee' })).toHaveCount(0);

  await viewer.goto('/members');
  await expect(viewer.getByRole('row').filter({ hasText: GRACE.email })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /Actions for/ })).toHaveCount(0);

  await viewer.getByRole('row').filter({ hasText: 'AST-0001' }).count();
  await viewer.goto('/assets');
  await viewer.getByRole('row').filter({ hasText: 'AST-0001' }).click();
  await expect(viewer.getByRole('heading', { name: 'MacBook Pro 14"' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Assign' })).toHaveCount(0);

  // Both admin URLs are guarded, not just hidden from the sidebar.
  await viewer.goto('/admin');
  await expect(viewer.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await viewer.goto('/activity');
  await expect(viewer.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await viewerContext.close();
});

test('the activity log tells the story, in sentences', async ({ page }) => {
  await signIn(page);
  await page.goto('/activity');

  // A page of its own now, reached from the sidebar rather than a tab.
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Activity log' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const table = page.getByRole('table');
  await expect(table).toContainText(`Invited ${GRACE.email} as a Viewer`);
  await expect(table).toContainText('Grace Chen joined the workspace');
  await expect(table).toContainText('Assigned MacBook Pro 14" to Maya Lindqvist');
  // Sentences, never action slugs.
  await expect(table).not.toContainText('member.invited');

  // Filtering narrows the rows and stays in the URL, so the view is shareable.
  await page.getByRole('button', { name: /^Auth / }).click();
  await expect(page).toHaveURL(/type=auth/);
  await expect(table).toContainText(`Invited ${GRACE.email} as a Viewer`);
  await expect(table).not.toContainText('Assigned MacBook Pro 14"');
});

test('exports the log as a CSV attachment whose rows match the screen', async ({ page }) => {
  await signIn(page);
  await page.goto('/activity');

  const href = await page.getByRole('link', { name: 'Export log' }).getAttribute('href');
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  expect(response.headers()['content-disposition']).toContain('attachment');

  const csv = await response.text();
  expect(csv.split('\n')[0]).toBe('Time,Actor,Event,Type');
  expect(csv).toContain(`Invited ${GRACE.email} as a Viewer`);
  expect(csv).toContain('Tomasz Kowalski');
});

test('changes the tag prefix, and the next asset is numbered under it', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin');

  const prefix = page.getByLabel('Asset tag prefix');
  await expect(prefix).toHaveValue('AST');
  await prefix.fill('inv');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  // Uppercased on the way in, so INV-0001 and inv-0001 can never both exist.
  await expect(page.getByLabel('Asset tag prefix')).toHaveValue('INV');

  // Numbering is per prefix: nothing is called INV-anything yet, so the
  // sequence starts over rather than continuing the AST count.
  await page.goto('/assets');
  await page.getByRole('button', { name: 'New asset' }).click();
  await expect(page.getByRole('dialog').getByLabel('Asset tag')).toHaveValue('INV-0001');
});

test('issues a reset link for a member who has joined', async ({ page }) => {
  await signIn(page);
  await page.goto('/members');

  await page
    .getByRole('row')
    .filter({ hasText: GRACE.email })
    .getByRole('button', { name: /Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Copy password reset link' }).click();

  const dialog = page.getByRole('dialog');
  const url = await dialog.getByLabel('Password reset link').inputValue();
  expect(url).toContain('/reset-password?token=');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The link really works: it is the recovery path when there is no SMTP.
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /choose a new password/i })).toBeVisible();
});
