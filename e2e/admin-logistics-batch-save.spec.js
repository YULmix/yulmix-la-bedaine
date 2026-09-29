// The Logistique tab saves every pending place and note at once (#150): one bar with the count,
// Save and Discard; a party the database refuses keeps its draft and says why; leaving with
// pending edits asks first; members can't use the save.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  E2E_ATTENDEES,
  createParty,
  deleteLocations,
  deleteParty,
  excludePlace,
  getParty,
  seedActiveEventWithMemberParty,
  seedPlaces,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { pickPlace } from './support/placePicker.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const [ALICE, BOB] = E2E_ATTENDEES.map(attendee => attendee.name);
const ZOE = { name: 'Zoé Sofa', type: 'Adult', participation: 'Whole', is_new_member: false, sleeping_preference: 'sofa' };

let seeded;
let places;
let extraPartyId;

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  places = await seedPlaces(seeded.eventId);
  extraPartyId = await createParty(seeded.eventId, ADMIN_ID, [ZOE]);
});

test.afterEach(async () => {
  if (extraPartyId) await deleteParty(extraPartyId);
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
  extraPartyId = null;
});

const panel = page => page.getByRole('tabpanel');
const pickerIn = (scope, name) => scope.getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, ${name}` });
const picker = (page, name) => pickerIn(panel(page), name);
// The party card holding the attendee called `name` (the one with the notes, not the row).
const card = (page, name) => panel(page).getByRole('listitem')
  .filter({ has: page.getByRole('textbox', { name: fr.logisticsTableAdminNotes }) })
  .filter({ has: pickerIn(page, name) });
const notes = (page, name) => card(page, name).getByRole('textbox', { name: fr.logisticsTableAdminNotes });
const saveButton = page => panel(page).getByRole('button', { name: fr.logisticsSaveAll });
const discardButton = page => panel(page).getByRole('button', { name: fr.eventEditorDiscard });
const pending = n => fr.eventEditorUnsaved.replace('{n}', n);
const bedsOf = async (partyId) => (await getParty(partyId)).attendees.map(a => [a.name, a.place?.bed_label ?? '']);

const openLogistics = async (page) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=logistics');
  await expect(picker(page, ALICE)).toBeVisible();
};

test('edits across parties are counted, marked, and saved with one click', async ({ page }) => {
  await openLogistics(page);
  await expect(panel(page).getByText(fr.eventEditorAllSaved)).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit A');
  await pickPlace(page, picker(page, BOB), 'Chambre 1 · Lit B');
  await pickPlace(page, picker(page, ZOE.name), 'Salon · Sofa');
  await notes(page, ZOE.name).fill('Arrive samedi');

  await expect(panel(page).getByText(pending(4))).toBeVisible();
  await expect(card(page, ALICE).getByText(fr.unsavedTag)).toBeVisible();
  await expect(card(page, ZOE.name).getByText(fr.unsavedTag)).toBeVisible();
  // Nothing written yet.
  expect(await bedsOf(seeded.partyId)).toEqual([[ALICE, ''], [BOB, '']]);

  // Losing window focus keeps the draft.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(panel(page).getByText(pending(4))).toBeVisible();

  await saveButton(page).click();
  await expect(page.getByText(fr.logisticsAllSavedToast)).toBeVisible();
  await expect(panel(page).getByText(fr.eventEditorAllSaved)).toBeVisible();
  await expect(panel(page).getByText(fr.unsavedTag)).toHaveCount(0);

  expect(await bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, 'Chambre 1 · Lit B']]);
  const zoe = await getParty(extraPartyId);
  expect([zoe.attendees[0].place?.bed_label, zoe.admin_notes]).toEqual(['Salon · Sofa', 'Arrive samedi']);
});

test('discard puts every card back to what is saved', async ({ page }) => {
  await openLogistics(page);
  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit A');
  await notes(page, ZOE.name).fill('Brouillon');
  await expect(panel(page).getByText(pending(2))).toBeVisible();

  await discardButton(page).click();
  await expect(picker(page, ALICE)).toHaveValue('');
  await expect(notes(page, ZOE.name)).toHaveValue('');
  await expect(panel(page).getByText(fr.unsavedTag)).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
});

test('a party the database refuses keeps its draft and says why; the others are saved', async ({ page }) => {
  await openLogistics(page);
  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit A');
  await pickPlace(page, picker(page, ZOE.name), 'Salon · Sofa');
  await notes(page, ZOE.name).fill('Canapé demandé');
  // Meanwhile the sofa is taken out of this edition (event editor, another tab…).
  await excludePlace(seeded.eventId, places['Salon · Sofa']);

  await saveButton(page).click();
  await expect(page.getByText(fr.logisticsSomeFailedToast.replace('{n}', 1).split(' :')[0])).toBeVisible();
  await expect(card(page, ZOE.name).getByText(fr.dbErrorPlaceAssignmentPlaceExcluded)).toBeVisible();
  await expect(card(page, ZOE.name).getByText(fr.unsavedTag)).toBeVisible();
  await expect(picker(page, ZOE.name)).toHaveValue('Salon · Sofa');
  await expect(notes(page, ZOE.name)).toHaveValue('Canapé demandé');
  await expect(card(page, ALICE).getByText(fr.unsavedTag)).toHaveCount(0);
  await expect(panel(page).getByText(pending(2))).toBeVisible();

  expect(await bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, '']]);
  // All or nothing for the refused party: its note wasn't saved either.
  const zoe = await getParty(extraPartyId);
  expect([zoe.attendees[0].place, zoe.admin_notes]).toEqual([null, null]);
});

test('leaving the admin pages with pending edits asks first; switching tabs or leaving without edits does not', async ({ page }) => {
  await openLogistics(page);
  const leaveDialog = page.getByRole('dialog', { name: fr.logisticsLeaveTitle });

  // No edits: leaves straight away.
  await page.getByRole('link', { name: fr.homeLinkLabel }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/admin?tab=logistics');

  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit A');
  // Another admin tab keeps the draft without asking.
  await page.getByRole('tab', { name: fr.adminTabUsers, exact: true }).click();
  await expect(leaveDialog).toHaveCount(0);
  await page.getByRole('tab', { name: fr.adminTabLogistics, exact: true }).click();
  await expect(picker(page, ALICE)).toHaveValue('Chambre 1 · Lit A');

  // Leaving asks; staying keeps everything.
  await page.getByRole('link', { name: fr.homeLinkLabel }).click();
  await expect(leaveDialog).toBeVisible();
  await expect(leaveDialog).toContainText(fr.logisticsLeaveBody.replace('{n}', 1));
  await leaveDialog.getByRole('button', { name: fr.cancel }).click();
  await expect(page).toHaveURL(/\/admin\?tab=logistics/);
  await expect(picker(page, ALICE)).toHaveValue('Chambre 1 · Lit A');

  // Closing or reloading the browser tab asks through the browser; dismissing stays.
  const beforeUnload = new Promise(resolve => page.once('dialog', dialog => { resolve(dialog.type()); dialog.dismiss(); }));
  await page.close({ runBeforeUnload: true });
  expect(await beforeUnload).toBe('beforeunload');
  await expect(picker(page, ALICE)).toHaveValue('Chambre 1 · Lit A');

  // Confirming leaves, and nothing was written.
  await page.getByRole('link', { name: fr.homeLinkLabel }).click();
  await leaveDialog.getByRole('button', { name: fr.logisticsLeaveConfirm }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await bedsOf(seeded.partyId)).toEqual([[ALICE, ''], [BOB, '']]);
});

test("a member can't save logistics, even calling the database directly", async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  const member = await getParty(seeded.partyId);
  const result = await page.evaluate(async ({ partyId, attendeeId, placeId }) => {
    const { data, error } = await window.__supabase.rpc('save_logistics', {
      p_changes: [{ party_id: partyId, admin_notes: 'moi', places: { [attendeeId]: placeId } }]
    });
    return { data, message: error?.message };
  }, { partyId: seeded.partyId, attendeeId: member.attendees[0].id, placeId: places['Chambre 1 · Lit A'] });

  expect(result).toEqual({ data: null, message: 'admin_only' });
  expect(await bedsOf(seeded.partyId)).toEqual([[ALICE, ''], [BOB, '']]);
  expect((await getParty(seeded.partyId)).admin_notes).toBeNull();
});
