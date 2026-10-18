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

// Who sleeps where (#303): an occupied chip shows its occupants in a bubble.
const MONEY = /\d\s?\$/;
const placeButton = (page, label) => occupancy(page).getByRole('button').filter({ hasText: label });
const bubble = page => page.getByRole('tooltip');
const line = name => fr.occupantLine.replace('{name}', name).replace('{type}', 'Adulte');

// E2E_SCREENSHOT_DIR: the page with the bubble open, at each width.
async function shoot(page, name, widths) {
  if (!process.env.E2E_SCREENSHOT_DIR) return;
  const before = page.viewportSize();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await placeButton(page, 'Lit A').hover();
    await expect(bubble(page)).toBeVisible();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/couchage-bubble-${name}-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize(before);
}

// Both of the member's attendees in the one-person Lit A: overbooked, so it lists both.
async function seedOccupiedLitA() {
  seeded = await seedActiveEventWithMemberParty();
  const ids = await seedPlaces(seeded.eventId);
  await assignPlace(ids['Chambre 1 · Lit A'], seeded.partyId, 1);
  await assignPlace(ids['Chambre 1 · Lit A'], seeded.partyId, 2);
}

async function expectLitABubble(page) {
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText(fr.occupantsTitle.replace('{place}', 'Lit A').replace('{taken}', 2).replace('{capacity}', 1));
  await expect(bubble(page).getByRole('listitem')).toHaveText([line(ALICE), line(BOB)]);
  await expect(bubble(page).getByText(MONEY)).toHaveCount(0);
}

test('as admin, hovering an occupied chip shows who sleeps there; leaving, or Escape after focus, closes it', async ({ page }) => {
  await seedOccupiedLitA();
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');

  const litA = placeButton(page, 'Lit A');
  await litA.hover();
  await expectLitABubble(page);
  await expect(litA).toHaveAttribute('aria-expanded', 'true');
  await expect(litA).toHaveAccessibleDescription(new RegExp(ALICE));
  await shoot(page, 'admin', [1440, 2560]);
  await page.mouse.move(0, 0);
  await expect(bubble(page)).toHaveCount(0);

  // Keyboard: the chip before it, then Tab.
  await occupancy(page).getByRole('heading', { name: fr.occupancyTitle }).click();
  await litA.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(bubble(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(litA).toBeFocused();
  await expectLitABubble(page);
  await page.keyboard.press('Escape');
  await expect(bubble(page)).toHaveCount(0);

  // An empty place is a plain chip: not a button, no bubble.
  await expect(placeButton(page, 'Lit B')).toHaveCount(0);
  await chip(page, 'Chambre 1', 'Lit B').hover();
  await expect(bubble(page)).toHaveCount(0);
});

test('as Comité, the same bubble with the same names, and no amounts', async ({ page }) => {
  await seedOccupiedLitA();
  await grantEditionRoles(seeded.eventId);
  await loginAs(page, TEST_USERS.committee);
  await page.goto('/admin/overview');

  await placeButton(page, 'Lit A').hover();
  await expectLitABubble(page);
  await shoot(page, 'committee', [1440]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tapping an occupied chip opens its bubble inside the screen; tapping outside closes it', async ({ page }) => {
    await seedOccupiedLitA();
    await loginAs(page, TEST_USERS.admin);
    await page.goto('/admin');

    await placeButton(page, 'Lit A').tap();
    await expectLitABubble(page);
    const box = await bubble(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.E2E_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/couchage-bubble-admin-390.png`, animations: 'disabled' });
    }

    await occupancy(page).getByRole('heading', { name: fr.occupancyTitle }).tap();
    await expect(bubble(page)).toHaveCount(0);
  });
});
