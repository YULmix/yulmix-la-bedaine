// The registration form keeps unsaved changes across a reload of the tab, and asks before they
// are lost by closing the tab or leaving the form (#144).
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

let seeded;
test.afterEach(async () => {
  if (seeded) {
    // A registration the test saved is not the seeded one: find it so teardown removes it.
    if (!seeded.partyId) seeded.partyId = (await findMemberParty(seeded.eventId))?.id ?? null;
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

const names = page => page.getByLabel(fr.fullNameLabel);
const restoredNotice = page => page.getByText(fr.registrationDraftRestored);
const leaveDialog = page => page.getByRole('dialog', { name: fr.registrationLeaveTitle });

// A reload with unsaved changes raises the browser's beforeunload prompt: accept it, as a member
// would, so the reload goes through.
const acceptPrompts = page => page.on('dialog', dialog => dialog.accept());

test('a new registration survives a reload until it is saved', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteParty(seeded.partyId);
  seeded.partyId = null;
  acceptPrompts(page);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page).first()).not.toHaveValue('');
  // Nothing typed yet: the prefilled name is not a change.
  await expect(restoredNotice(page)).toHaveCount(0);

  await page.getByRole('button', { name: fr.addParticipantButton }).click();
  await names(page).nth(1).fill('Invitée E2E');
  await page.reload();

  await expect(restoredNotice(page)).toBeVisible();
  await expect(names(page)).toHaveCount(2);
  await expect(names(page).nth(1)).toHaveValue('Invitée E2E');

  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
  await page.getByRole('button', { name: fr.saveRegistrationButton }).click();
  await expect(page.getByRole('region', { name: fr.registrationSuccessTitle })).toBeVisible();

  // Saved: the draft is gone, and the form shows the saved registration.
  await page.goto('/inscription');
  await expect(names(page)).toHaveCount(2);
  await expect(names(page).nth(1)).toHaveValue('Invitée E2E');
  await expect(restoredNotice(page)).toHaveCount(0);
});

test('an edit survives a reload; leaving asks, and cancelling the question keeps the form', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  acceptPrompts(page);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
  await names(page).first().fill('Alice Modifiée');
  await page.reload();

  await expect(restoredNotice(page)).toBeVisible();
  await expect(names(page).first()).toHaveValue('Alice Modifiée');

  // Another page of the app: asked; staying keeps the change.
  await page.getByRole('navigation', { name: fr.mainNavLabel }).getByRole('link', { name: fr.navInfo }).click();
  await expect(leaveDialog(page)).toBeVisible();
  await leaveDialog(page).getByRole('button', { name: fr.cancel }).click();
  await expect(page).toHaveURL(/\/inscription$/);
  await expect(names(page).first()).toHaveValue('Alice Modifiée');

  // The form's own cancel: asked again; leaving drops the draft.
  // The page header's close button (the leave dialog's own « Annuler » sits in the form below).
  await page.getByRole('main').getByRole('button', { name: fr.cancel }).first().click();
  await leaveDialog(page).getByRole('button', { name: fr.registrationLeaveConfirm }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/inscription');
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
  await expect(restoredNotice(page)).toHaveCount(0);
  expect((await getParty(seeded.partyId)).attendees[0].name).toBe(E2E_ATTENDEES[0].name);
});

test('a draft over a registration saved since (another tab) gives way to the saved one', async ({ page, context }) => {
  seeded = await seedActiveEventWithMemberParty();
  acceptPrompts(page);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
  await names(page).first().fill('Brouillon');

  // The same member saves a different change in a second tab.
  const other = await context.newPage();
  await other.goto('/inscription');
  await names(other).nth(1).fill('Bob Enregistré');
  await other.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(other).toHaveURL(/\/$/);
  await other.close();

  await page.reload();
  await expect(restoredNotice(page)).toHaveCount(0);
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
  await expect(names(page).nth(1)).toHaveValue('Bob Enregistré');
});

test('closing the tab asks only when there are unsaved changes', async ({ page, context }) => {
  seeded = await seedActiveEventWithMemberParty();
  await loginAs(page, TEST_USERS.member);

  const closeAsks = async (tab) => {
    let asked = false;
    tab.on('dialog', dialog => { asked = dialog.type() === 'beforeunload'; dialog.accept(); });
    await tab.close({ runBeforeUnload: true });
    await expect.poll(() => tab.isClosed()).toBe(true);
    return asked;
  };

  await page.goto('/inscription');
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
  // A click gives the page the user activation Chrome wants before it shows the prompt.
  await names(page).first().click();
  expect(await closeAsks(page)).toBe(false);

  const tab = await context.newPage();
  await tab.goto('/inscription');
  await names(tab).first().fill('Alice Modifiée');
  expect(await closeAsks(tab)).toBe(true);
});
