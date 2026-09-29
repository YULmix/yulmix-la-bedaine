// Assigning sleeping places from the Logistique tab (#114): a searchable dropdown of the event's
// places, preference-matching ones first, full ones last and still pickable with a warning.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  E2E_ATTENDEES,
  createParty,
  deleteLocations,
  deleteParty,
  getParty,
  seedActiveEventWithMemberParty,
  seedPlaces,
  assignPlace,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { pickPlace, placeOption } from './support/placePicker.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const [ALICE, BOB] = E2E_ATTENDEES.map(attendee => attendee.name);
const ZOE = { name: 'Zoé Sofa', type: 'Adult', participation: 'Whole', is_new_member: false, sleeping_preference: 'sofa' };

let seeded;
let places;
let extraPartyId;

const seed = async (eventOverrides) => {
  seeded = await seedActiveEventWithMemberParty(eventOverrides);
  places = await seedPlaces(seeded.eventId);
  extraPartyId = await createParty(seeded.eventId, ADMIN_ID, [ZOE]);
};

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
// The party card holding the attendee called `name` (the one with a save button, not the row).
const card = (page, name) => panel(page).getByRole('listitem')
  .filter({ has: page.getByRole('button', { name: fr.saveAssignments }) })
  .filter({ has: pickerIn(page, name) });
const saveCard = async (page, name) => {
  await card(page, name).getByRole('button', { name: fr.saveAssignments }).click();
  await expect(page.getByText(fr.logisticsUpdatedToast).last()).toBeVisible();
};
const bedsOf = async (partyId) => (await getParty(partyId)).attendees.map(a => [a.name, a.place?.bed_label ?? '']);

test('an admin assigns, reassigns and unassigns places; search narrows, preferences first, full places warn', async ({ page }) => {
  await seed();
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=logistics');

  // Zoé asked for a sofa: the sofa comes first. Alice asked for nothing: display order.
  await picker(page, ZOE.name).click();
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Salon · Sofa/);
  await picker(page, ZOE.name).press('Escape');
  await picker(page, ALICE).click();
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Chambre 1 · Lit A/);

  // Search narrows the list, by place and location, ignoring accents.
  await picker(page, ALICE).fill('lit b');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(placeOption(page, 'Chambre 1 · Lit B')).toBeVisible();
  await picker(page, ALICE).fill('zzz');
  await expect(page.getByText(fr.placePickerNoMatch)).toBeVisible();
  await picker(page, ALICE).press('Escape');

  // Keyboard: arrow down to the first option, Enter picks it.
  await picker(page, ALICE).press('ArrowDown');
  await picker(page, ALICE).press('Enter');
  await expect(picker(page, ALICE)).toHaveValue('Chambre 1 · Lit A');
  await saveCard(page, ALICE);
  await expect.poll(() => bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, '']]);

  // Lit A is now full: listed last, marked, and still pickable with a warning.
  await picker(page, BOB).click();
  const full = placeOption(page, 'Chambre 1 · Lit A');
  await expect(page.getByRole('option').last()).toHaveAccessibleName(/^Chambre 1 · Lit A/);
  await expect(full).toContainText(fr.placePickerFull);
  await full.click();
  // Both people in the bed are warned.
  await expect(card(page, BOB).getByText(fr.placeOverbooked.replace('{taken}', 2).replace('{capacity}', 1))).toHaveCount(2);
  await saveCard(page, BOB);
  await expect.poll(() => bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, 'Chambre 1 · Lit A']]);

  // Reassign, then unassign.
  await pickPlace(page, picker(page, BOB), 'Chambre 1 · Lit B', 'lit b');
  await saveCard(page, BOB);
  await expect.poll(() => bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, 'Chambre 1 · Lit B']]);

  await picker(page, BOB).click();
  await page.getByRole('option', { name: fr.placePickerUnassign }).click();
  await expect(picker(page, BOB)).toHaveValue('');
  await saveCard(page, BOB);
  await expect.poll(() => bedsOf(seeded.partyId)).toEqual([[ALICE, 'Chambre 1 · Lit A'], [BOB, '']]);

  // Picking the saved place again is no change at all.
  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit B');
  await expect(card(page, ALICE).getByText(fr.unsavedTag)).toBeVisible();
  await pickPlace(page, picker(page, ALICE), 'Chambre 1 · Lit A');
  await expect(card(page, ALICE).getByText(fr.unsavedTag)).toHaveCount(0);
});

test('the member sees the place an admin gave them', async ({ page }) => {
  await seed();
  await assignPlace(places['Salon · Sofa'], seeded.partyId, 2);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await expect(page.getByText('Salon · Sofa')).toBeVisible();
});

test("a waitlisted party's attendees can't be given a place", async ({ page }) => {
  // Room for the member's two only: the admin's party lands on the waitlist.
  await seed({ max_attendees: E2E_ATTENDEES.length });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=logistics');

  await expect(picker(page, ZOE.name)).toBeDisabled();
  await expect(panel(page).getByText(fr.placePickerWaitlisted)).toBeVisible();
  await expect(picker(page, ALICE)).toBeEnabled();
});

test('an event without places says where to define them', async ({ page }) => {
  await seed();
  await deleteLocations(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=logistics');

  await expect(panel(page).getByText(fr.logisticsNoPlacesTitle)).toBeVisible();
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
});
