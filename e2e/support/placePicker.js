// Driving the Logistique tab's place picker (#114), a combobox that filters a listbox.
import { expect } from '@playwright/test';

/** The place pickers inside `scope` (a page or a locator), one per attendee. */
export const placePickers = (scope) => scope.getByRole('combobox');

/** The picker's option whose text starts with `name` ("<location> · <place>"). */
export const placeOption = (page, name) => page.getByRole('option', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

/** Opens the picker, optionally types `query`, and chooses the place called `name`. */
export async function pickPlace(page, picker, name, query) {
  await picker.click();
  if (query !== undefined) await picker.fill(query);
  await placeOption(page, name).click();
  await expect(picker).toHaveValue(name);
}
