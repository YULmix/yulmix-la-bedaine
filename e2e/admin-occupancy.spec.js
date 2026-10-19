// The overview's sleeping figures (#115): per-location occupancy, attendees without a place, and
// overbooked places, following what's assigned in the Logistique tab.
import { test, expect } from '@playwright/test';
import { adminMain, openSection } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  assignPlace,
  deleteLocations,
  grantEditionRoles,
  revokeEditionRoles,
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
    await revokeEditionRoles(seeded.eventId);
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

  await expect(panel(page).getByRole('heading', { name: fr.kpiTiersTitle, exact: true })).toBeVisible();
  await expect(occupancy(page)).toHaveCount(0);
});
// Who sleeps where (#303): the card's icon-only toggle lists each place's occupants under its chip,
// remembered on this device, off the first time.
// The Couchage card itself (the overview's own section holds it, and the money figures).
const card = page => occupancy(page).last();
const MONEY = /\d\s?\$/;
const toggle = page => card(page).getByRole('button', { name: fr.occupantsToggle });
const line = name => fr.occupantLine.replace('{name}', name).replace('{type}', 'Adulte');
const occupantsOf = (page, label) => chip(page, 'Chambre 1', label).getByRole('listitem');
const shot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) {
    await card(page).screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/couchage-${name}.png`, animations: 'disabled' });
  }
};

// Both of the member's attendees in the one-person Lit A: overbooked, so it lists both.
async function seedOccupiedLitA() {
  seeded = await seedActiveEventWithMemberParty();
  const ids = await seedPlaces(seeded.eventId);
  await assignPlace(ids['Chambre 1 · Lit A'], seeded.partyId, 1);
  await assignPlace(ids['Chambre 1 · Lit A'], seeded.partyId, 2);
}

async function expectNamesShown(page) {
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(occupantsOf(page, 'Lit A')).toHaveText([line(ALICE), line(BOB)]);
  await expect(chip(page, 'Chambre 1', 'Lit A')).toContainText('2/1');
  // An empty place: its chip, no names.
  await expect(chip(page, 'Chambre 1', 'Lit B')).toContainText('0/1');
  await expect(occupantsOf(page, 'Lit B')).toHaveCount(0);
  await expect(card(page).getByText(MONEY)).toHaveCount(0);
}

test('as admin, the toggle lists who sleeps in each place, and the page remembers it', async ({ page }) => {
  await seedOccupiedLitA();
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  // Off the first time: the chips, no names, nothing to hover.
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(chip(page, 'Chambre 1', 'Lit A')).toContainText('2/1');
  await expect(card(page).getByText(ALICE)).toHaveCount(0);
  await expect(card(page).getByRole('button')).toHaveCount(1);
  await shot(page, 'off-admin-1440');

  await toggle(page).click();
  await expectNamesShown(page);
  await expect(card(page).getByRole('button')).toHaveCount(1);
  await shot(page, 'on-admin-1440');

  await page.reload();
  await expectNamesShown(page);

  await toggle(page).click();
  await expect(card(page).getByText(ALICE)).toHaveCount(0);
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(card(page).getByText(ALICE)).toHaveCount(0);
});

test('as Comité, the same toggle and names, and no amounts', async ({ page }) => {
  await seedOccupiedLitA();
  await grantEditionRoles(seeded.eventId);
  await loginAs(page, TEST_USERS.committee);
  await page.goto('/admin/overview');

  await toggle(page).click();
  await expectNamesShown(page);
  await shot(page, 'on-committee-1440');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the names show in one column, with nothing overflowing sideways', async ({ page }) => {
    await seedOccupiedLitA();
    await loginAs(page, TEST_USERS.admin);
    await page.goto('/admin');

    await toggle(page).tap();
    await expectNamesShown(page);
    const [litA, litB] = await Promise.all(['Lit A', 'Lit B'].map(label => chip(page, 'Chambre 1', label).boundingBox()));
    expect(litB.x).toBe(litA.x);
    expect(litB.y).toBeGreaterThan(litA.y + litA.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await shot(page, 'on-admin-390');
  });
});
