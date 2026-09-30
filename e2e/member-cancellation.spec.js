// Member self-cancellation (issue #35): "Se désinscrire" is a soft status change, and after the
// registration close date the member can no longer cancel.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { getParty, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Both tests reseed the one shared active event, so they run one after the other.
test.describe.configure({ mode: 'serial' });

const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

let seeded;
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

test('before the close date, a member cancels and the row is kept as cancelled', async ({ page }) => {
  // The weekend is two months away: the close date (one week before) hasn't passed.
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inDays(60), x_reg_close_weeks: 1 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');

  await page.getByRole('button', { name: fr.cancelRegistration }).click();
  const dialog = page.getByRole('dialog', { name: fr.cancelRegistrationConfirmTitle });
  await expect(dialog).toContainText(fr.cancelRegistrationConfirm);
  await dialog.getByRole('button', { name: fr.cancelRegistration }).click();

  await expect(page.getByText(fr.registrationCancelledNotice)).toBeVisible();
  await expect(page.getByRole('link', { name: fr.registerGroupButton })).toBeVisible();
  await expect(page.getByRole('button', { name: fr.cancelRegistration })).toHaveCount(0);

  // Soft: the row is still there, only its status changed.
  const party = await getParty(seeded.partyId);
  expect(party.status).toBe('cancelled');
  expect(party.attendees).toHaveLength(2);

  // Registering again starts a fresh form, not an edit of the cancelled registration.
  await page.getByRole('link', { name: fr.registerGroupButton }).click();
  await expect(page.getByRole('heading', { name: fr.registrationFormTitle })).toBeVisible();
});

test('after the close date, a member cannot cancel and is told why', async ({ page }) => {
  // The weekend is in three days: the close date (one week before) is already past.
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inDays(3), x_reg_close_weeks: 1 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');

  await expect(page.getByRole('button', { name: fr.editRegistration })).toBeVisible();
  await expect(page.getByRole('button', { name: fr.cancelRegistration })).toHaveCount(0);
  await expect(page.getByText(fr.cancelRegistrationLocked.split('({date})')[0])).toBeVisible();

  const party = await getParty(seeded.partyId);
  expect(party.status).toBe('registered');
});

test('after the close date, removing an attendee is refused with the close date, in French', async ({ page }) => {
  // The database refuses it (registration_attendee_removal_locked, #102); the app maps the code.
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inDays(3), x_reg_close_weeks: 1 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');

  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await page.getByRole('button', { name: fr.removeAttendeeLabel.replace('{name}', 'Bob E2E') }).click();
  await page.getByRole('button', { name: fr.saveChangesButton }).click();

  const closeDate = new Date(`${inDays(-4)}T12:00:00`).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const refusal = fr.dbErrorAttendeeRemovalLocked.replace('{date}', closeDate);
  // Both the form's error banner and a toast say it.
  await expect(page.getByRole('main').getByText(refusal).first()).toBeVisible();
  expect((await getParty(seeded.partyId)).attendees).toHaveLength(2);
});
