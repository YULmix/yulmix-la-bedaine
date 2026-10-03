// The Sites tab (#146): venues with their capacity and events, a venue's page to edit its
// locations and places, and archiving instead of deleting.
import { test, expect } from '@playwright/test';
import { adminMain, backLink, moreButton, sectionLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME,
  assignPlace,
  deleteLocations,
  getEventVenue,
  getPlaceLabels,
  renamePlace,
  seedActiveEventWithMemberParty,
  seedPlaces,
  setVenueArchived,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

let seeded;
let placeIds;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  placeIds = await seedPlaces(seeded.eventId);
  await setVenueArchived(seeded.eventId, false);
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  if (seeded?.eventId) {
    // The seed puts the event back on its live venue (one test archives it onto a frozen copy).
    await seedActiveEventWithMemberParty();
    await deleteLocations(seeded.eventId);
    await setVenueArchived(seeded.eventId, false);
  }
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};
const venueRow = (page, name) => page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

test("the list shows each venue's capacity and events; its page shows the venue, not who sleeps where", async ({ page }) => {
  const { name } = await getEventVenue(seeded.eventId);
  await assignPlace(placeIds['Chambre 1 · Lit A'], seeded.partyId, 1);

  await page.goto('/admin/venues');
  const row = venueRow(page, name);
  // E2E_PLACES: two single beds and a sofa for two.
  await expect(row.getByText(fr.venueTotals.replace('{locations}', 2).replace('{places}', 3).replace('{capacity}', 4))).toBeVisible();
  await expect(row.getByText(fr.venueUsedBy.replace('{events}', E2E_EVENT_THEME))).toBeVisible();
  await screenshot(page, 'venues-list');

  await row.getByRole('button', { name: fr.venueOpen.replace('{name}', name) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/venues\/[^/?]+$/);
  await page.getByRole('navigation', { name: fr.locationsListLabel }).getByRole('button', { name: /^Chambre 1/ }).click();
  // A venue lives outside its events: their assignments are the Logistique tab's.
  const chambre = page.getByRole('region', { name: 'Chambre 1' });
  await expect(chambre.getByRole('listitem', { name: 'Lit A' })).toBeVisible();
  await expect(page.getByText('Alice E2E')).toHaveCount(0);
  await expect(page.getByText(fr.sleepingStatAssigned)).toHaveCount(0);
  await screenshot(page, 'venue-page');

  await backLink(page, fr.adminTabVenues).click();
  await expect(page.getByRole('heading', { name: fr.venuesTitle })).toBeVisible();
});

test('the venue page splits its places by type, and follows edits without a reload (#164)', async ({ page }) => {
  const { id, name } = await getEventVenue(seeded.eventId);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/venues/${id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const byType = page.getByRole('list', { name: fr.sleepingByTypeLabel });
  // E2E_PLACES: two single beds and a sofa for two; no other type shows.
  await expect(byType.getByRole('listitem')).toHaveText([
    `${fr.accommodationBed} : 2 · 2 personnes`,
    `${fr.accommodationSofa} : 1 · 2 personnes`
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await screenshot(page, 'venue-by-type-phone');

  await page.getByRole('navigation', { name: fr.locationsListLabel }).getByRole('button', { name: /^Chambre 1/ }).click();
  const room = page.getByRole('region', { name: 'Chambre 1' });
  const bedB = room.getByRole('listitem', { name: 'Lit B' });
  await bedB.getByLabel(fr.placeTypeLabel, { exact: true }).selectOption('camping');
  await bedB.getByRole('group', { name: fr.placeCapacityLabel }).getByRole('button', { name: fr.stepperMore }).click();
  await expect(byType.getByRole('listitem').first()).toHaveText(`${fr.accommodationCamping} : 1 · 2 personnes`);
  // Adding places reloads them: let the (debounced) capacity write land first.
  await expect(page.getByText(fr.sleepingSaved, { exact: true })).toBeVisible();
  await room.getByLabel(fr.placeAddTypeLabel).selectOption('floor');
  await room.getByRole('button', { name: fr.placeAddButton }).click();

  // Types in option order (Camping, Plancher, Lit, Sofa); they add up to the totals.
  await expect(byType.getByRole('listitem')).toHaveText([
    `${fr.accommodationCamping} : 1 · 2 personnes`,
    `${fr.accommodationFloor} : 1 · 1 personne`,
    `${fr.accommodationBed} : 1 · 1 personne`,
    `${fr.accommodationSofa} : 1 · 2 personnes`
  ]);
  const summary = byType.locator('..');
  await expect(summary.getByText(fr.sleepingStatPlaces, { exact: true }).locator('..')).toContainText('4');
  await expect(summary.getByText(fr.sleepingStatCapacity, { exact: true }).locator('..')).toContainText('6');
});

test('an admin creates a venue, gives it a location, and archives it', async ({ page }) => {
  const venueName = `Chalet E2E ${Date.now()}`;
  await page.goto('/admin/venues');
  await page.getByRole('button', { name: fr.venueNew }).first().click();
  const dialog = page.getByRole('dialog', { name: fr.venueNewTitle });
  await dialog.getByRole('button', { name: fr.venueCreate }).click();
  await expect(dialog.getByText(fr.venueNameRequired)).toBeVisible();
  await dialog.getByLabel(fr.venueNameLabel).fill(venueName);
  await dialog.getByLabel(fr.venueAddressLabel).fill('1 chemin du Lac, Val-David');
  await dialog.getByRole('button', { name: fr.venueCreate }).click();

  await expect(page.getByRole('heading', { level: 1, name: venueName })).toBeVisible();
  await expect(page.getByText(fr.venueUnused)).toBeVisible();
  await expect(page.getByLabel(fr.venueAddressLabel)).toHaveValue('1 chemin du Lac, Val-David');
  await page.getByRole('button', { name: fr.locationAdd }).click();
  await expect(page.getByLabel(fr.locationNameLabel)).toHaveValue(fr.locationDefaultName.replace('{n}', 1));

  // Archived: gone from the list, back with the toggle, and restorable.
  await page.getByRole('button', { name: fr.venueArchive }).click();
  await expect(page.getByText(fr.venueArchivedHint)).toBeVisible();
  await backLink(page, fr.adminTabVenues).click();
  await expect(venueRow(page, venueName)).toHaveCount(0);
  await page.getByRole('switch', { name: /Afficher les sites archivés/ }).click();
  await expect(venueRow(page, venueName).getByText(fr.venueArchivedTag)).toBeVisible();
  await venueRow(page, venueName).getByRole('button', { name: fr.venueOpen.replace('{name}', venueName) }).click();
  await page.getByRole('button', { name: fr.venueRestore }).click();
  await expect(page.getByText(fr.venueArchivedHint)).toHaveCount(0);
  // Leave nothing to clutter later runs' lists: archived again.
  await page.getByRole('button', { name: fr.venueArchive }).click();
  await expect(page.getByText(fr.venueArchivedHint)).toBeVisible();
});

test('on a phone Sites is under « Plus », which is highlighted there, and Logistique reads « Gestion »', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/venues');
  await expect(page.getByRole('heading', { name: fr.venuesTitle })).toBeVisible();
  await expect(sectionLink(page, fr.adminTabLogistics).getByText(fr.adminTabLogisticsShort, { exact: true })).toBeVisible();
  await expect(sectionLink(page, fr.adminTabVenues)).toHaveCount(0);
  await expect(moreButton(page)).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await screenshot(page, 'venues-phone');
});

test('an archived edition keeps its layout and who slept where, under its venue', async ({ page }) => {
  const { id: liveId, name } = await getEventVenue(seeded.eventId);
  await assignPlace(placeIds['Chambre 1 · Lit A'], seeded.partyId, 1);

  await page.goto('/admin/events');
  await adminMain(page).getByRole('button', { name: fr.archiveEventButton }).click();
  await page.getByRole('dialog', { name: fr.archiveEventConfirmTitle }).getByRole('button', { name: fr.archiveEventButton }).click();
  // Archived: the event is now on a frozen copy (same name, another venue).
  await expect.poll(async () => (await getEventVenue(seeded.eventId)).id).not.toBe(liveId);
  expect((await getEventVenue(seeded.eventId)).name).toBe(name);

  // The live venue changes; the archived edition doesn't follow.
  await renamePlace(placeIds['Chambre 1 · Lit A'], 'Queen');
  expect(await getPlaceLabels(seeded.partyId)).toEqual({ 'Alice E2E': 'Chambre 1 · Lit A' });

  // One row for the venue (its frozen copy isn't listed), still naming the archived edition.
  await page.goto('/admin/venues');
  await expect(venueRow(page, name)).toHaveCount(1);
  await expect(venueRow(page, name).getByText(fr.venueUsedBy.replace('{events}', E2E_EVENT_THEME))).toBeVisible();

  // Its Couchage section shows the layout as it was, without controls.
  await page.goto(`/admin/events/${seeded.eventId}?section=sleeping`);
  const section = page.getByRole('tabpanel', { name: fr.eventFieldsetSleeping });
  await expect(section.getByText(fr.eventVenueFrozen)).toBeVisible();
  const chambre = section.getByRole('region', { name: 'Chambre 1' });
  await expect(chambre.getByRole('listitem', { name: 'Lit A' }).getByText(fr.placeOccupants.replace('{names}', 'Alice E2E'), { exact: false })).toBeVisible();
  await expect(section.getByRole('switch')).toHaveCount(0);
  await expect(section.getByLabel(fr.eventVenuePickerLabel)).toBeDisabled();
  await screenshot(page, 'archived-event-layout');
});
