// The event editor's Couchage section (#147): pick the event's venue, and choose what of it this
// edition uses (a place excluded, or another capacity). The venue itself is edited in Sites.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME,
  assignPlace,
  deleteLocations,
  ensureVenue,
  getEventVenue,
  getLocations,
  getOverrides,
  getPlaceLabels,
  seedActiveEventWithMemberParty,
  seedPlaces,
  teardownActiveEventWithMemberParty,
  unlinkVenue
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

const OTHER_VENUE = 'E2E Other Venue';
const ARCHIVED_VENUE = 'E2E Archived Venue';

let seeded;
let placeIds;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  placeIds = await seedPlaces(seeded.eventId);
  await ensureVenue(OTHER_VENUE);
  await ensureVenue(ARCHIVED_VENUE, { archived: true });
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  if (seeded?.eventId) {
    // The seed puts the event back on its venue; its places go.
    await seedActiveEventWithMemberParty();
    await deleteLocations(seeded.eventId);
  }
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

const openCouchage = async (page) => {
  await page.goto(`/admin/events/${seeded.eventId}?section=sleeping`);
  const section = page.getByRole('tabpanel', { name: fr.eventFieldsetSleeping });
  await expect(section.getByLabel(fr.eventVenuePickerLabel)).toBeVisible();
  return section;
};
const available = (place) => fr.placeAvailableLabel.replace('{place}', place);
const capacityOf = (place) => fr.placeEventCapacityLabel.replace('{place}', place);
const stat = (section, label) => section.getByText(label, { exact: true }).locator('..');

test('an edition excludes a place and resizes another; the venue stays as it is', async ({ page }) => {
  const section = await openCouchage(page);
  const { name } = await getEventVenue(seeded.eventId);
  const picker = section.getByLabel(fr.eventVenuePickerLabel);
  // E2E_PLACES: two single beds and a sofa for two.
  await expect(picker.locator('option:checked')).toHaveText(fr.eventVenueOption.replace('{name}', name).replace('{capacity}', 4));
  // Archived venues aren't offered.
  await expect(picker.locator('option', { hasText: OTHER_VENUE })).toHaveCount(1);
  await expect(picker.locator('option', { hasText: ARCHIVED_VENUE })).toHaveCount(0);

  await section.getByRole('switch', { name: available('Chambre 1 · Lit B') }).click();
  const sofa = section.getByRole('group', { name: capacityOf('Salon · Sofa') });
  await sofa.getByRole('button', { name: fr.stepperMore }).click();
  await expect.poll(() => getOverrides(seeded.eventId)).toEqual({
    'Chambre 1 · Lit B': { is_excluded: true, capacity: null },
    'Salon · Sofa': { is_excluded: false, capacity: 3 }
  });
  await expect(stat(section, fr.eventVenueStatVenueCapacity)).toContainText('4');
  await expect(stat(section, fr.eventVenueStatEventCapacity)).toContainText('4');
  await expect(stat(section, fr.eventVenueStatAvailable)).toContainText('2/3');
  await expect(section.getByRole('region', { name: 'Chambre 1' }).getByText(fr.placeExcluded)).toBeVisible();
  await screenshot(page, 'event-venue-overrides');

  // The venue's own places are untouched.
  const venuePlaces = (await getLocations(seeded.eventId)).flatMap(l => l.places.map(p => [p.label, p.capacity]));
  expect(venuePlaces.sort()).toEqual([['Lit A', 1], ['Lit B', 1], ['Sofa', 2]]);

  // Back to the venue's capacity and available again: no override left.
  await sofa.getByRole('button', { name: fr.stepperLess }).click();
  await section.getByRole('switch', { name: available('Chambre 1 · Lit B') }).click();
  await expect.poll(() => getOverrides(seeded.eventId)).toEqual({});

  // No place editing here: that's the Sites tab.
  await expect(section.getByRole('button', { name: fr.locationAdd })).toHaveCount(0);
  await section.getByRole('button', { name: fr.eventVenueEdit }).click();
  await expect(page).toHaveURL(/tab=venues&venue=/);
});

test("a place someone of the event holds can't be excluded, and says who", async ({ page }) => {
  await assignPlace(placeIds['Chambre 1 · Lit A'], seeded.partyId, 1);
  const section = await openCouchage(page);
  await section.getByRole('switch', { name: available('Chambre 1 · Lit A') }).click();
  const refusal = page.getByRole('dialog', { name: fr.placeExcludeBlockedTitle });
  await expect(refusal.getByRole('listitem').filter({ hasText: 'Alice E2E' })).toBeVisible();
  await refusal.getByRole('button', { name: fr.close }).last().click();
  expect(await getOverrides(seeded.eventId)).toEqual({});
  await expect(section.getByRole('switch', { name: available('Chambre 1 · Lit A') })).toHaveAttribute('aria-checked', 'true');
});

test('changing the venue names who loses their place, asks, then clears their places', async ({ page }) => {
  await assignPlace(placeIds['Salon · Sofa'], seeded.partyId, 1);
  await assignPlace(placeIds['Salon · Sofa'], seeded.partyId, 2);
  const section = await openCouchage(page);
  const picker = section.getByLabel(fr.eventVenuePickerLabel);

  await picker.selectOption({ label: fr.eventVenueOption.replace('{name}', OTHER_VENUE).replace('{capacity}', 0) });
  const confirm = page.getByRole('dialog', { name: fr.eventVenueChangeTitle });
  await expect(confirm.getByRole('listitem')).toHaveText(['Alice E2E', 'Bob E2E']);
  await screenshot(page, 'event-venue-change');
  await confirm.getByRole('button', { name: fr.cancel }).click();
  expect((await getEventVenue(seeded.eventId)).name).not.toBe(OTHER_VENUE);
  expect(await getPlaceLabels(seeded.partyId)).toEqual({ 'Alice E2E': 'Salon · Sofa', 'Bob E2E': 'Salon · Sofa' });

  await picker.selectOption({ label: fr.eventVenueOption.replace('{name}', OTHER_VENUE).replace('{capacity}', 0) });
  await page.getByRole('dialog', { name: fr.eventVenueChangeTitle }).getByRole('button', { name: fr.eventVenueChangeConfirm }).click();
  await expect.poll(async () => (await getEventVenue(seeded.eventId)).name).toBe(OTHER_VENUE);
  expect(await getPlaceLabels(seeded.partyId)).toEqual({});
  await expect(section.getByText(fr.eventVenueEmptyHint)).toBeVisible();
});

test('an event without a venue picks one, or gets one named after it', async ({ page }) => {
  await unlinkVenue(seeded.eventId);
  const section = await openCouchage(page);
  await expect(section.getByText(fr.venueNone)).toBeVisible();
  await screenshot(page, 'event-venue-none');

  // Each run leaves one venue behind: venues are archived, never deleted.
  await section.getByRole('button', { name: fr.eventVenueCreate }).click();
  await expect.poll(async () => (await getEventVenue(seeded.eventId))?.name).toBe(E2E_EVENT_THEME);
  await expect(section.getByText(fr.eventVenueEmptyHint)).toBeVisible();
});
