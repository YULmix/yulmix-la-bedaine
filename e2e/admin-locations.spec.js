// Sleeping locations and places (#113) of the event's venue (#145), on the Couchage section of the
// event editor page. Every change saves right away; an occupied place or location can't be
// deleted, and says who's in it.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME,
  assignPlace,
  deleteLocations,
  getEventVenue,
  getLocations,
  getPlaceLabels,
  seedActiveEventWithMemberParty,
  setVenueAddress,
  teardownActiveEventWithMemberParty,
  unassignPlace,
  unlinkVenue
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteLocations(seeded.eventId);
  await setVenueAddress(seeded.eventId, null);
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  if (seeded?.eventId) {
    await deleteLocations(seeded.eventId);
    await setVenueAddress(seeded.eventId, null);
  }
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const openSleeping = async (page, ready = fr.sleepingAutosave) => {
  await page.goto('/admin?tab=events');
  await page.getByRole('tabpanel').getByRole('button', { name: fr.edit }).click();
  await page.getByRole('tab', { name: fr.eventFieldsetSleeping }).click();
  const section = page.getByRole('tabpanel', { name: fr.eventFieldsetSleeping });
  await expect(section.getByText(ready)).toBeVisible();
  return section;
};

const locationList = page => page.getByRole('navigation', { name: fr.locationsListLabel });
const selectLocation = (page, name) => locationList(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

// Types into a save-on-blur field and leaves it.
const fillAndLeave = async (input, value) => {
  await input.fill(value);
  await input.press('Tab');
};

const locationNames = async eventId => (await getLocations(eventId)).map(l => l.name);
const placesOf = async (eventId, name) => ((await getLocations(eventId)).find(l => l.name === name)?.places || [])
  .map(({ label, type, capacity }) => ({ label, type, capacity }))
  .sort((a, b) => a.label.localeCompare(b.label));

test('an admin builds a sleeping plan: locations, places in bulk, reorder, duplicate; all saved as it goes', async ({ page }) => {
  const section = await openSleeping(page);
  await expect(section.getByText(fr.locationsEmpty)).toBeVisible();

  await section.getByRole('button', { name: fr.locationAdd }).click();
  await fillAndLeave(page.getByLabel(fr.locationNameLabel), 'Chambre 2');
  await locationList(page).getByRole('button', { name: fr.locationAdd }).click();
  await expect(page.getByLabel(fr.locationNameLabel)).toHaveValue(fr.locationDefaultName.replace('{n}', 2));
  await fillAndLeave(page.getByLabel(fr.locationNameLabel), 'Cour');
  await expect.poll(() => locationNames(seeded.eventId)).toEqual(['Chambre 2', 'Cour']);

  await page.getByRole('button', { name: fr.locationMoveUp.replace('{name}', 'Cour') }).click();
  await expect.poll(() => locationNames(seeded.eventId)).toEqual(['Cour', 'Chambre 2']);
  await expect(locationList(page).getByRole('button').first()).toHaveText(/^Cour/);

  // Three beds in one go, numbered after the type.
  await selectLocation(page, 'Chambre 2');
  const chambre = page.getByRole('region', { name: 'Chambre 2' });
  const addCount = chambre.getByRole('group', { name: fr.placeAddCountLabel });
  await addCount.getByRole('button', { name: fr.stepperMore }).click();
  await addCount.getByRole('button', { name: fr.stepperMore }).click();
  await chambre.getByLabel(fr.placeAddTypeLabel).selectOption('bed');
  await chambre.getByRole('button', { name: fr.placeAddButton }).click();
  const bed = n => fr.placeDefaultLabel.replace('{type}', fr.accommodationBed).replace('{n}', n);
  await expect.poll(() => placesOf(seeded.eventId, 'Chambre 2')).toEqual([1, 2, 3].map(n => ({ label: bed(n), type: 'bed', capacity: 1 })));

  // Edit one: rename, retype, and a capacity of 3 (two clicks, one debounced write).
  const first = chambre.getByRole('listitem', { name: bed(1) });
  await first.getByLabel(fr.placeTypeLabel).selectOption('sofa');
  await first.getByRole('button', { name: fr.stepperMore }).click();
  await first.getByRole('button', { name: fr.stepperMore }).click();
  await fillAndLeave(first.getByLabel(fr.placeLabelLabel), 'Sofa');
  await expect.poll(() => placesOf(seeded.eventId, 'Chambre 2'))
    .toEqual([{ label: bed(2), type: 'bed', capacity: 1 }, { label: bed(3), type: 'bed', capacity: 1 }, { label: 'Sofa', type: 'sofa', capacity: 3 }]);
  await expect(section.getByText(fr.sleepingSaved, { exact: true })).toBeVisible();
  await expect(chambre.getByText(fr.locationTotals.replace('{places}', 3).replace('{capacity}', 5))).toBeVisible();

  await chambre.getByRole('button', { name: fr.locationDuplicate.replace('{name}', 'Chambre 2') }).click();
  const copyName = fr.locationCopyName.replace('{name}', 'Chambre 2');
  await expect(page.getByRole('region', { name: copyName })).toBeVisible();
  await expect.poll(() => placesOf(seeded.eventId, copyName)).toEqual(await placesOf(seeded.eventId, 'Chambre 2'));

  // The page is addressed by the URL: a reload comes back to the same location.
  await page.reload();
  await expect(page.getByRole('region', { name: copyName }).getByLabel(fr.locationNameLabel)).toHaveValue(copyName);
  await screenshot(page, 'locations-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: fr.locationsBackToList })).toBeVisible();
  await screenshot(page, 'locations-phone-detail');
  await page.getByRole('button', { name: fr.locationsBackToList }).click();
  await expect(locationList(page)).toBeVisible();
  await expect(page.getByRole('region', { name: copyName })).toBeHidden();
  await screenshot(page, 'locations-phone-list');
});

test("an occupied place or location can't be deleted, and says who is in it", async ({ page }) => {
  const section = await openSleeping(page);
  await section.getByRole('button', { name: fr.locationAdd }).click();
  await fillAndLeave(page.getByLabel(fr.locationNameLabel), 'Salon');
  const salon = page.getByRole('region', { name: 'Salon' });
  await salon.getByLabel(fr.placeAddTypeLabel).selectOption('sofa');
  await salon.getByRole('button', { name: fr.placeAddButton }).click();
  await fillAndLeave(salon.getByLabel(fr.placeLabelLabel), 'Sofa');
  await expect.poll(async () => (await getLocations(seeded.eventId))[0]?.places.map(p => p.label)).toEqual(['Sofa']);

  const [{ places: [sofa] }] = await getLocations(seeded.eventId);
  await assignPlace(sofa.id, seeded.partyId, 1);
  expect(await getPlaceLabels(seeded.partyId)).toEqual({ 'Alice E2E': 'Salon · Sofa' });

  await page.reload();
  const occupied = page.getByRole('region', { name: 'Salon' });
  await expect(occupied.getByText(fr.placeOccupants.replace('{names}', 'Alice E2E'))).toBeVisible();
  await expect(page.getByRole('navigation', { name: fr.locationsListLabel }).getByText('1/1')).toBeVisible();

  for (const name of [fr.placeDelete.replace('{label}', 'Sofa'), fr.locationDelete.replace('{name}', 'Salon')]) {
    await occupied.getByRole('button', { name }).click();
    const refusal = page.getByRole('dialog', { name: fr.occupiedDeleteTitle });
    await expect(refusal.getByRole('listitem').filter({ hasText: 'Alice E2E' })).toBeVisible();
    await refusal.getByRole('button', { name: fr.close }).last().click();
    await expect(refusal).toBeHidden();
  }
  expect((await getLocations(seeded.eventId))[0].places).toHaveLength(1);

  // Renaming the place renames the label people see.
  await fillAndLeave(occupied.getByLabel(fr.placeLabelLabel), 'Canapé');
  await expect.poll(() => getPlaceLabels(seeded.partyId)).toEqual({ 'Alice E2E': 'Salon · Canapé' });

  // Once empty, the place goes.
  await unassignPlace(sofa.id);
  await page.reload();
  await page.getByRole('button', { name: fr.placeDelete.replace('{label}', 'Canapé') }).click();
  await expect.poll(async () => (await getLocations(seeded.eventId))[0].places).toEqual([]);
  await expect(page.getByText(fr.placesEmpty)).toBeVisible();
});

test("the section edits the event's venue, and members see its address", async ({ page, browser }) => {
  const section = await openSleeping(page);
  const venueCard = section.getByRole('region', { name: fr.venueTitle });
  await expect(venueCard.getByText(fr.venueSharedHint)).toBeVisible();
  await fillAndLeave(venueCard.getByLabel(fr.venueAddressLabel), '17 rue Stewart, Stanstead');
  await expect(section.getByText(fr.sleepingSaved)).toBeVisible();
  await expect.poll(async () => (await getEventVenue(seeded.eventId)).address).toBe('17 rue Stewart, Stanstead');
  // The general section no longer has an address of its own.
  await page.getByRole('tab', { name: fr.eventSectionDetails }).click();
  await expect(page.getByLabel(fr.venueAddressLabel)).toHaveCount(0);

  const member = await browser.newPage();
  await loginAs(member, TEST_USERS.member);
  await expect(member.getByRole('link', { name: '17 rue Stewart, Stanstead' }).first()).toBeVisible();
  await member.close();
});

test('an event without a venue offers to create one, named after it', async ({ page }) => {
  // Each run leaves one venue behind: venues are archived, never deleted.
  await unlinkVenue(seeded.eventId);
  const section = await openSleeping(page, fr.venueNone);
  await screenshot(page, 'sleeping-no-venue');

  await section.getByRole('button', { name: fr.venueCreate }).click();
  await expect(section.getByRole('region', { name: fr.venueTitle })).toBeVisible();
  await expect(section.getByLabel(fr.venueNameLabel)).toHaveValue(E2E_EVENT_THEME);
  await expect(section.getByText(fr.locationsEmpty)).toBeVisible();
  const venue = await getEventVenue(seeded.eventId);
  expect(venue.name).toBe(E2E_EVENT_THEME);
});
