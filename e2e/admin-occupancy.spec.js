// The overview's sleeping figures (#115): per-location occupancy, attendees without a place, and
// overbooked places, following what's assigned in the Logistique tab.
import { test, expect } from '@playwright/test';
import { adminMain } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  deleteLocations,
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

let seeded;

test.afterEach(async () => {
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

// The current admin page (the shell's main).
const panel = page => adminMain(page);
const occupancy = page => panel(page).locator('section').filter({ has: page.getByRole('heading', { name: fr.occupancyTitle }) });
const unassigned = count => (count === 1 ? fr.occupancyUnassignedOne : fr.occupancyUnassignedOther).replace('{count}', count);
// A location's row: its name, its assigned/capacity, and a chip per place with its own.
const location = (page, name) => occupancy(page).getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
const locationRatio = (page, name) => location(page, name).getByRole('heading').locator('xpath=following-sibling::*[1]');
const chip = (page, locationName, label) => location(page, locationName).getByRole('listitem').filter({ hasText: label });
const picker = (page, name) => panel(page).getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, ${name}` });

const assign = async (page, name, place) => {
  await pickPlace(page, picker(page, name), place);
  await panel(page).getByRole('button', { name: fr.save, exact: true }).click();
  await expect(page.getByText(fr.logisticsAllSavedToast).last()).toBeVisible();
};

test('the overview follows assignments made in Logistique, and warns about an overbooked place', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  await expect(occupancy(page).getByText(unassigned(2))).toBeVisible();
  await expect(locationRatio(page, 'Chambre 1')).toHaveText('0/2');
  await expect(locationRatio(page, 'Salon')).toHaveText('0/2');
  await expect(chip(page, 'Chambre 1', 'Lit A')).toContainText('0/1');

  // Both of the member's attendees in the one-person Lit A.
  await openSection(page, fr.adminTabLogistics);
  await assign(page, ALICE, 'Chambre 1 · Lit A');
  await assign(page, BOB, 'Chambre 1 · Lit A');

  await openSection(page, fr.adminTabOverview);
  await expect(occupancy(page).getByText(fr.occupancyAllPlaced)).toBeVisible();
  await expect(locationRatio(page, 'Chambre 1')).toHaveText('2/2');
  await expect(locationRatio(page, 'Salon')).toHaveText('0/2');
  await expect(chip(page, 'Chambre 1', 'Lit A')).toContainText('2/1');
  await expect(chip(page, 'Chambre 1', 'Lit B')).toContainText('0/1');
  await expect(panel(page).getByText(fr.overbookedTitleOne.replace('{count}', 1))).toBeVisible();
  await expect(panel(page).getByText(
    fr.overbookedPlace.replace('{location}', 'Chambre 1').replace('{place}', 'Lit A').replace('{taken}', 2).replace('{capacity}', 1)
  )).toBeVisible();
});

test('an event without places shows no occupancy', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteLocations(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  await expect(panel(page).getByRole('heading', { name: fr.kpiTiersTitle })).toBeVisible();
  await expect(occupancy(page)).toHaveCount(0);
});
