import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** `screen` and anything `within(...)` returns both satisfy this. */
type Queries = Pick<ReturnType<typeof within>, 'getByRole' | 'findByRole'>;

/**
 * Picks an option from a `Dropdown`, the way a person does: open the control,
 * click the option.
 *
 * `userEvent.selectOptions` only drives a native `<select>`, and the app no
 * longer has any — the design's own dropdown is a button owning a portalled
 * listbox. Options are matched by their **label**, because that is what is on
 * screen; the value never appears in the DOM.
 */
export async function choose(
  scope: Queries,
  field: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  await userEvent.click(scope.getByRole('combobox', { name: field }));
  // The list is portalled to the body, so it is out of `scope` by design.
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
