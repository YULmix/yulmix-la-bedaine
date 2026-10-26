// Member self-cancellation (issue #35): "Se désinscrire" is a soft status change, and after the
// registration close date the member can no longer cancel. From the event's start the whole
// registration is frozen for members (#314); admins keep editing.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { adminMain, openPartyDetail, openPartyEditor } from './support/admin.js';
import {
  ADMIN_ID, E2E_ATTENDEES, createParty, deleteParty, endOpenImpersonations, getParty, seedActiveEventWithMemberParty,
  setPartyAnswers, teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Both tests reseed the one shared active event, so they run one after the other.
test.describe.configure({ mode: 'serial' });

const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// An instant, n hours from now (event_start_date is a timestamptz).
const inHours = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

let seeded;
let adminPartyId;
test.afterEach(async () => {
  if (adminPartyId) await deleteParty(adminPartyId);
  adminPartyId = null;
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

test('from the start, a member sees a frozen pass: no edit, no cancel, no form', async ({ page }) => {
  // The weekend started an hour ago (the seed runs as the admin, whom the freeze lets through).
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 1 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');

  const pass = page.getByRole('article', { name: fr.passLabel });
  await expect(pass.getByText(fr.registrationFrozenNotice)).toBeVisible();
  await expect(page.getByRole('button', { name: fr.editRegistration })).toHaveCount(0);
  await expect(page.getByRole('button', { name: fr.cancelRegistration })).toHaveCount(0);
  await expect(page.getByText(fr.cancelRegistrationLocked.split('({date})')[0])).toHaveCount(0);

  // The form's route leads back to the pass.
  await page.goto('/inscription');
  await expect(page).toHaveURL(/\/$/);
  await expect(pass.getByText(fr.registrationFrozenNotice)).toBeVisible();

  expect((await getParty(seeded.partyId)).status).toBe('registered');
});

test('from the start, a cancelled member is told registrations are closed, not invited back', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 1 });
  await setPartyAnswers(seeded.partyId, { status: 'cancelled' });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');

  await expect(page.getByText(fr.registrationFrozenClosed)).toBeVisible();
  await expect(page.getByRole('link', { name: fr.registerGroupButton })).toHaveCount(0);
  await expect(page.getByText(fr.registrationCancelledNotice)).toHaveCount(0);
});

test("from the start, an admin's own pass still offers the edit", async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 1 });
  adminPartyId = await createParty(seeded.eventId, ADMIN_ID, E2E_ATTENDEES);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/');

  const pass = page.getByRole('article', { name: fr.passLabel });
  await expect(pass.getByRole('button', { name: fr.editRegistration })).toBeVisible();
  await expect(pass.getByText(fr.registrationFrozenNotice)).toHaveCount(0);
  await page.goto('/inscription');
  await expect(page.getByRole('heading', { name: fr.editRegistrationTitle })).toBeVisible();
});

test('a form left open past the start is refused in French on save', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(1), x_reg_close_weeks: 0 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await expect(page.getByRole('heading', { name: fr.editRegistrationTitle })).toBeVisible();

  // Meanwhile the weekend starts (reseeded: same event, the member's registration made again).
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 0 });
  await page.getByRole('button', { name: fr.saveChangesButton }).click();

  await expect(page.getByRole('main').getByText(fr.dbErrorRegistrationFrozen).first()).toBeVisible();
  await expect(page.getByText('registration_frozen')).toHaveCount(0);
});

test("from the start, an admin still edits a member's registration and marks it paid", async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 0 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');

  const editor = await openPartyEditor(page);
  await editor.getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: `${fr.participantNumberLabel}2`, exact: true }) })
    .getByLabel(fr.fullNameLabel)
    .fill('Bob Frozen');
  await editor.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByText(fr.changesSavedToast)).toBeVisible();
  expect((await getParty(seeded.partyId)).attendees.map(a => a.name)).toEqual([E2E_ATTENDEES[0].name, 'Bob Frozen']);

  await page.goto('/admin/users');
  await adminMain(page).getByRole('button', { name: fr.unpaidShort, exact: true }).click();
  await page.getByRole('dialog', { name: fr.markPaid }).getByRole('button', { name: fr.markPaid }).click();
  await expect(adminMain(page).getByRole('button', { name: fr.paid, exact: true })).toBeVisible();
  expect((await getParty(seeded.partyId)).payment_status).toBe('paid');
});

test("from the start, « Voir comme » shows the member's frozen pass", async ({ page }) => {
  await endOpenImpersonations();
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inHours(-1), x_reg_close_weeks: 0 });
  try {
    await loginAs(page, TEST_USERS.admin);
    await page.goto('/admin/users');
    const dialog = await openPartyDetail(page);
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      dialog.getByRole('button', { name: fr.voirCommeAction, exact: true }).click()
    ]);
    // A cold start of the impersonate function can take a few seconds (see voir-comme.spec.js).
    const pass = tab.getByRole('article', { name: fr.passLabel });
    await expect(pass.getByText(fr.registrationFrozenNotice)).toBeVisible({ timeout: 30_000 });
    await expect(pass.getByRole('button', { name: fr.editRegistration })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: fr.cancelRegistration })).toHaveCount(0);
    await tab.close();
  } finally {
    await endOpenImpersonations();
  }
});
