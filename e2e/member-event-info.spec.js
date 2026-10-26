// The member event info never shows the maximum capacity (#305): it is an internal planning
// threshold (max_attendees), still enforced by the database and shown to admins in the editor.
import { test, expect } from './support/test.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import { seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';

test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeEach(async () => { seeded = await seedActiveEventWithMemberParty({ max_attendees: 90 }); });
test.afterEach(async () => {
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
});

test('the event details page does not show the maximum capacity', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/event-details');
  await page.locator('main').first().waitFor();
  await expect(page.getByText('Instructions', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Capacité maximale')).toHaveCount(0);
  await expect(page.getByText('90 participants')).toHaveCount(0);
});
