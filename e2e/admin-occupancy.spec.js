// The overview's sleeping figures (#115): per-location occupancy, attendees without a place, and
// overbooked places, following what's assigned in the Logistique tab.
import { test, expect } from '@playwright/test';
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

const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const panel = page => page.getByRole('tabpanel');
const occupancy = page => panel(page).locator('section').filter({ has: page.getByRole('heading', { name: fr.occupancyTitle }) });
const unassigned = page => occupancy(page).getByText(fr.occupancyUnassigned).locator('xpath=following-sibling::p[1]');
const location = (page, name) => occupancy(page).locator('summary').filter({ hasText: name });
const left = count => (count === 1 ? fr.occupancyLeftOne : fr.occupancyLeftOther).replace('{count}', count);
const picker = (page, name) => panel(page).getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, ${name}` });

const assign = async (page, name, place) => {
  await pickPlace(page, picker(page, name), place);
  await panel(page).getByRole('button', { name: fr.saveAssignments }).click();
  await expect(page.getByText(fr.logisticsUpdatedToast).last()).toBeVisible();
};

test('the overview follows assignments made in Logistique, and warns about an overbooked place', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  await expect(unassigned(page)).toHaveText('2');
  await expect(location(page, 'Chambre 1')).toContainText(`0/2, ${left(2)}`);
  await expect(location(page, 'Salon')).toContainText(`0/2, ${left(2)}`);

  // Both of the member's attendees in the one-person Lit A.
  await tab(page, fr.adminTabLogistics).click();
  await assign(page, ALICE, 'Chambre 1 · Lit A');
  await assign(page, BOB, 'Chambre 1 · Lit A');

  await tab(page, fr.adminTabOverview).click();
  await expect(unassigned(page)).toHaveText('0');
  // Lit A's extra person doesn't take Lit B's spot.
  await expect(location(page, 'Chambre 1')).toContainText(`2/2, ${left(1)}`);
  await expect(location(page, 'Salon')).toContainText(`0/2, ${left(2)}`);
  await expect(panel(page).getByText(fr.overbookedTitleOne.replace('{count}', 1))).toBeVisible();
  await expect(panel(page).getByText(
    fr.overbookedPlace.replace('{location}', 'Chambre 1').replace('{place}', 'Lit A').replace('{taken}', 2).replace('{capacity}', 1)
  )).toBeVisible();

  // The location's places are on expand.
  // (Not getByRole: it skips the hidden rows, so it would find the location's own item instead.)
  const litA = location(page, 'Chambre 1').locator('xpath=following-sibling::ul/li').filter({ hasText: 'Lit A' });
  await expect(litA).toBeHidden();
  await location(page, 'Chambre 1').click();
  await expect(litA).toBeVisible();
  await expect(litA).toContainText('2/1');
});

test('an event without places shows no occupancy', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteLocations(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  await expect(panel(page).getByRole('heading', { name: fr.kpiTiersTitle })).toBeVisible();
  await expect(occupancy(page)).toHaveCount(0);
});
