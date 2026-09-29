// Saving a registration says so (#155). A new one is confirmed on a screen of its own, with what
// to do about paying, instead of dropping the member on the home page; the save shows it is in
// flight; an edit returns to the pass with a toast.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  deleteParty,
  findMemberParty,
  getParty,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

const ORGANISERS_EMAIL = 'yulmixalabedaine@gmail.com';

let seeded;
test.afterEach(async () => {
  if (seeded) {
    // A registration the test saved is not the seeded one: find it so teardown removes it.
    if (!seeded.partyId) seeded.partyId = (await findMemberParty(seeded.eventId))?.id ?? null;
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

// The active event with no registration for the member yet.
const seedNewRegistration = async (eventOverrides) => {
  const result = await seedActiveEventWithMemberParty(eventOverrides);
  await deleteParty(result.partyId);
  return { ...result, partyId: null };
};

const pad = n => String(n).padStart(2, '0');
const dateOnly = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const names = page => page.getByLabel(fr.fullNameLabel);
const stepsNav = page => page.getByRole('navigation', { name: fr.registrationStepsLabel });

// A new registration prefills the member's name asynchronously (#133), and moving forward
// validates names, so wait for it before jumping to the last step.
const openReviewStep = async page => {
  await expect(names(page).first()).not.toHaveValue('');
  await stepsNav(page).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
};

const confirmation = (page, title) => page.getByRole('region', { name: title });

test('a new registration shows it is saving, then confirms with how to pay, before the pass', async ({ page }) => {
  seeded = await seedNewRegistration();

  // Hold the save back so the in-flight state can be looked at.
  await page.route('**/rest/v1/rpc/save_registration', async route => {
    if (route.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openReviewStep(page);
  const save = page.getByRole('button', { name: fr.saveRegistrationButton });
  await save.click();

  // In flight: the button says so, spins, and can't be pressed a second time.
  const saving = page.getByRole('button', { name: fr.savingInProgress });
  await expect(saving).toBeDisabled();
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  await expect(saving.locator('svg.animate-spin')).toBeVisible();

  // Saved: the page confirms it, in place, rather than bouncing to the home page.
  const done = confirmation(page, fr.registrationSuccessTitle);
  await expect(done).toBeVisible();
  await expect(page).toHaveURL(/\/inscription$/);
  await expect(done.getByRole('heading', { name: fr.registrationSuccessTitle })).toBeFocused();
  await expect(save).toHaveCount(0);

  // What to do next: the Interac transfer, for the amount the database computed.
  const saved = await findMemberParty(seeded.eventId);
  expect(saved).not.toBeNull();
  const { calculated_amount_owed: owed } = await getParty(saved.id);
  await expect(done.getByText(fr.registrationSuccessPaymentText)).toBeVisible();
  await expect(done.getByText(Number(owed).toFixed(2).replace('.', ','))).toBeVisible();
  await expect(done.getByText(ORGANISERS_EMAIL)).toBeVisible();
  await expect(done.getByText(fr.registrationSuccessPaymentNoteValue.replace('{name}', 'Test Member'))).toBeVisible();

  // The member moves on when they choose to.
  await done.getByRole('button', { name: fr.registrationSuccessCta }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
});

test('a waitlisted registration is told not to send a payment yet', async ({ page }) => {
  // Room for one person, and the group is two: the database waitlists it.
  seeded = await seedNewRegistration({ max_attendees: 1 });

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page).first()).not.toHaveValue('');
  await page.getByRole('button', { name: fr.addParticipantButton }).click();
  await names(page).nth(1).fill('Invitée E2E');
  await openReviewStep(page);
  await page.getByRole('button', { name: fr.saveRegistrationButton }).click();

  const done = confirmation(page, fr.registrationSuccessTitle);
  await expect(done).toBeVisible();
  await expect(done.getByText(fr.registrationSuccessWaitlistText)).toBeVisible();
  await expect(done.getByText(ORGANISERS_EMAIL)).toHaveCount(0);
  await expect(done.getByText(fr.registrationSuccessPaymentText)).toHaveCount(0);
});

test('an intention says that no payment is due yet', async ({ page }) => {
  // Registration opens in a month and the intent phase opens two months before that.
  const opens = new Date();
  opens.setDate(opens.getDate() + 30);
  seeded = await seedNewRegistration({ reg_start_date: dateOnly(opens), z_intent_months: 2 });

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openReviewStep(page);
  await page.getByRole('button', { name: fr.saveIntentButton }).click();

  const done = confirmation(page, fr.registrationSuccessIntentTitle);
  await expect(done).toBeVisible();
  await expect(done.getByText(fr.registrationSuccessIntentNext)).toBeVisible();
  await expect(done.getByText(ORGANISERS_EMAIL)).toHaveCount(0);
});

test('editing a registration returns to its pass with a toast, and no new-registration confirmation', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page)).toHaveCount(E2E_ATTENDEES.length);
  await stepsNav(page).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
  await page.getByLabel(fr.musicRequests).fill('Du disco, svp');
  await page.getByRole('button', { name: fr.saveChangesButton, exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: fr.changesSavedToast })).toBeVisible();
  await expect(page.getByRole('region', { name: fr.registrationSuccessTitle })).toHaveCount(0);
});
