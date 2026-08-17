import { expect, test } from '@playwright/test';
import { choose } from '../helpers/dropdown';
import { signIn } from '../helpers/session';

// Statuses stopped being an enum compiled into both apps, and this is the
// journey that proves it: an admin invents one, rewires the graph around it,
// and every surface downstream — the asset form, the change-status modal, the
// filter pills, the dashboard tiles — obeys without anybody redeploying.
//
// Runs after overview.spec.ts, which leaves AST-0001 sitting in Available.

const EDGE_TO_RETIRED = '[data-edge="available→retired"]';
const EDGE_TO_ON_LOAN = '[data-edge="available→on_loan"]';
const EDGE_BACK = '[data-edge="on_loan→available"]';

test('an admin adds a status and rewires the graph around it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Workflow', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Add status' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('On loan');
  // The id is derived from the label the once, and the form says so first.
  await expect(dialog.getByText('Stored as on_loan')).toBeVisible();
  // Colour options carry the `sv` key as their description, so the option
  // reads "Blue info" while the closed field only ever shows the colour.
  await choose(page, dialog, 'Color', 'Blue info', 'Blue');
  await dialog.getByRole('button', { name: 'Add status' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Added the status "On loan".')).toBeVisible();
  // A new status arrives inert: no behaviour until somebody gives it some.
  await expect(page.getByRole('switch', { name: 'On loan can be handed out' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'On loan accepts check-ins' })).not.toBeChecked();

  // Rewire: lending replaces retiring as what an available asset may do next,
  // and a loan comes back.
  await expect(page.locator(EDGE_TO_RETIRED)).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Available → Retired' }).uncheck();
  await page.getByRole('checkbox', { name: 'Available → On loan' }).check();
  await page.getByRole('checkbox', { name: 'On loan → Available' }).check();

  // The diagram is drawn from the draft, so it answers before the save does.
  await expect(page.locator(EDGE_TO_RETIRED)).toHaveCount(0);
  await expect(page.locator(EDGE_TO_ON_LOAN)).toHaveCount(1);
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await expect(page.getByText('Everything here is saved')).toBeVisible();

  // And the graph really is the stored one now, not a hopeful local set.
  await page.reload();
  await expect(page.locator(EDGE_TO_ON_LOAN)).toHaveCount(1);
  await expect(page.locator(EDGE_BACK)).toHaveCount(1);
  await expect(page.locator(EDGE_TO_RETIRED)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Available → Retired' })).not.toBeChecked();
});

test('the API refuses the move the admin took off the graph', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();
  await expect(page.getByRole('heading', { name: 'MacBook Pro 14"' })).toBeVisible();

  // The form offers every status — it is the server that owns the graph, and
  // it says so in the admin's own vocabulary.
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, dialog, 'Status', 'Retired');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'The workflow does not allow Available → Retired.',
  );

  // The move that replaced it goes through.
  await choose(page, dialog, 'Status', 'On loan');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('On loan', { exact: true }).first()).toBeVisible();
});

test('the workspace-made status counts on the list and the dashboard', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets?status=on_loan');

  await expect(page.getByRole('button', { name: 'On loan 1' })).toHaveAttribute(
    'data-active',
    'true',
  );
  await expect(page.getByRole('row').filter({ hasText: 'AST-0001' })).toContainText('On loan');

  // The dashboard's tiles are that same list, so a seventh one is a row
  // nobody had to make room for.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'On loan 1' }).click();
  await expect(page).toHaveURL(/\/assets\?status=on_loan/);
});

test('the change-status modal offers exactly what the graph allows', async ({ page }) => {
  await signIn(page);
  await page.goto('/assets?status=on_loan');
  await page.getByRole('row').filter({ hasText: 'AST-0001' }).click();

  // Nothing can be handed out of On loan, so the contextual primary action is
  // the status move rather than Assign.
  await page.getByRole('button', { name: 'Change status' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'New status' }).click();

  // One edge out of On loan, so exactly one option — the rest of the six are
  // not on offer, because the workflow has no way there.
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Available', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Available', exact: true }).click();

  await dialog.getByRole('button', { name: 'Change status' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('AST-0001 is now Available.')).toBeVisible();
});
