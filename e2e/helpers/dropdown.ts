import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Picks an option from the app's `Dropdown`, the way a person does: open the
 * control, click the option.
 *
 * `selectOption` only drives a native `<select>`, and the app no longer has
 * any — the design's own dropdown is a button owning a listbox. The listbox is
 * portalled to `<body>`, so it is deliberately looked up on the **page** even
 * when the trigger lives inside a dialog. Options are matched by their label,
 * because that is what is on screen; the value never appears in the DOM.
 */
export async function choose(
  page: Page,
  scope: Locator | Page,
  field: string,
  option: string,
): Promise<void> {
  await scope.getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('combobox', { name: field })).toHaveText(option);
}
