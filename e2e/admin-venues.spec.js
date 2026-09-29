// The Sites tab (#146): venues with their capacity and events, a venue's page to edit its
// locations and places, and archiving instead of deleting.
import { test, expect } from '@playwright/test';
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

test("the list shows each venue's capacity and events; its page shows who of those events sleeps where", async ({ page }) => {
  const { name } = await getEventVenue(seeded.eventId);
  await assignPlace(placeIds['Chambre 1 · Lit A'], seeded.partyId, 1);

  await page.goto('/admin?tab=venues');
  const row = venueRow(page, name);
  // E2E_PLACES: two single beds and a sofa for two.
  await expect(row.getByText(fr.venueTotals.replace('{locations}', 2).replace('{places}', 3).replace('{capacity}', 4))).toBeVisible();
  await expect(row.getByText(fr.venueUsedBy.replace('{events}', E2E_EVENT_THEME))).toBeVisible();
  await screenshot(page, 'venues-list');

  await row.getByRole('button', { name: fr.venueOpen.replace('{name}', name) }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page).toHaveURL(/tab=venues&venue=/);
  await page.getByRole('navigation', { name: fr.locationsListLabel }).getByRole('button', { name: /^Chambre 1/ }).click();
  await expect(page.getByRole('region', { name: 'Chambre 1' }).getByText(fr.placeOccupants.replace('{names}', 'Alice E2E'))).toBeVisible();
  await screenshot(page, 'venue-page');

  await page.getByRole('button', { name: fr.venuesBack }).click();
  await expect(page.getByRole('heading', { name: fr.venuesTitle })).toBeVisible();
});

test('an admin creates a venue, gives it a location, and archives it', async ({ page }) => {
  const venueName = `Chalet E2E ${Date.now()}`;
  await page.goto('/admin?tab=venues');
  await page.getByRole('button', { name: fr.venueNew }).first().click();
  const dialog = page.getByRole('dialog', { name: fr.venueNewTitle });
  await dialog.getByRole('button', { name: fr.venueCreate }).click();
  await expect(dialog.getByText(fr.venueNameRequired)).toBeVisible();
  await dialog.getByLabel(fr.venueNameLabel).fill(venueName);
  await dialog.getByLabel(fr.venueAddressLabel).fill('1 chemin du Lac, Val-David');
  await dialog.getByRole('button', { name: fr.venueCreate }).click();

  await expect(page.getByRole('heading', { level: 2, name: venueName })).toBeVisible();
  await expect(page.getByText(fr.venueUnused)).toBeVisible();
  await expect(page.getByLabel(fr.venueAddressLabel)).toHaveValue('1 chemin du Lac, Val-David');
  await page.getByRole('button', { name: fr.locationAdd }).click();
  await expect(page.getByLabel(fr.locationNameLabel)).toHaveValue(fr.locationDefaultName.replace('{n}', 1));

  // Archived: gone from the list, back with the toggle, and restorable.
  await page.getByRole('button', { name: fr.venueArchive }).click();
  await expect(page.getByText(fr.venueArchivedHint)).toBeVisible();
  await page.getByRole('button', { name: fr.venuesBack }).click();
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

test('on a phone the tab bar fits seven tabs, Logistique reads « Dodo » and Sites is there', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin?tab=venues');
  await expect(page.getByRole('heading', { name: fr.venuesTitle })).toBeVisible();
  const bar = page.getByRole('tablist', { name: fr.adminTabsAriaLabel });
  await expect(bar.getByRole('tab', { name: fr.adminTabLogistics }).getByText(fr.adminTabLogisticsShort, { exact: true })).toBeVisible();
  await expect(bar.getByRole('tab', { name: fr.adminTabVenues })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await screenshot(page, 'venues-phone');
});

test('an archived edition keeps its layout and who slept where, under its venue', async ({ page }) => {
  const { name } = await getEventVenue(seeded.eventId);
  await assignPlace(placeIds['Chambre 1 · Lit A'], seeded.partyId, 1);

  await page.goto('/admin?tab=events');
  await page.getByRole('tabpanel').getByRole('button', { name: fr.archiveEventButton }).click();
  await page.getByRole('dialog', { name: fr.archiveEventConfirmTitle }).getByRole('button', { name: fr.archiveEventButton }).click();
  await expect.poll(async () => (await getEventVenue(seeded.eventId)).name).toBe(name);

  // The live venue changes; the archived edition doesn't follow.
  await renamePlace(placeIds['Chambre 1 · Lit A'], 'Queen');
  expect(await getPlaceLabels(seeded.partyId)).toEqual({ 'Alice E2E': 'Chambre 1 · Lit A' });

  // One row for the venue (its frozen copy isn't listed), still naming the archived edition.
  await page.goto('/admin?tab=venues');
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
