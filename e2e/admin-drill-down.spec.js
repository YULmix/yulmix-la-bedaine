// The admin's detail pages (#210): the event editor, a venue and a location all open the same way,
// a back link naming the parent and then the title, keep the parent section current in the
// navigation, and fit a phone. Geometry is asserted, not just visibility: boxes that overlap or a
// page that scrolls sideways pass a visibility check.
import { test, expect } from '@playwright/test';
import { adminMain, eventRow, backLink, moreButton, sectionLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME,
  deleteLocations,
  getEventVenue,
  seedActiveEventWithMemberParty,
  seedPlaces,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

let seeded;
let venue;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
  venue = await getEventVenue(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  if (seeded?.eventId) await deleteLocations(seeded.eventId);
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

const box = async locator => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found;
};
const bottom = b => b.y + b.height;

// The boxes are stacked: each starts at or below where the one before ends.
const expectStacked = async (...locators) => {
  const boxes = [];
  for (const locator of locators) boxes.push(await box(locator));
  boxes.slice(1).forEach((next, index) => expect(next.y).toBeGreaterThanOrEqual(bottom(boxes[index]) - 1));
};

const expectNoSideScroll = async (page) => {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
};

const expectNotTruncated = async (heading) => {
  const { scroll, client } = await heading.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
};

const LONG_TITLE = 'Grand week-end de printemps des amis de la Bédaine au bord du lac';

test('on a phone the event editor opens with its back link, title and tabs, with no sideways scroll, and Save clears the last field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/events/${seeded.eventId}`);
  const title = page.getByLabel(fr.eventTitle);
  await title.fill(LONG_TITLE);

  const back = backLink(page, fr.adminTabEvents);
  const heading = page.getByRole('heading', { level: 1 });
  const tabs = page.getByRole('tablist', { name: fr.eventEditorSectionsLabel });
  await expect(heading).toHaveText(LONG_TITLE);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expectStacked(back, heading, tabs);
  await expectNotTruncated(heading);
  await expectNoSideScroll(page);
  // The phone bar keeps Événements current, under « Plus ».
  await expect(moreButton(page)).toHaveAttribute('aria-current', /page|true/);
  await screenshot(page, 'drill-event-details-390');

  // The save bar sits above the bottom bar and, scrolled to the end, below the last field.
  const lastField = page.getByRole('button', { name: fr.eventExternalLinksAddRow });
  await lastField.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const saveButton = page.getByRole('button', { name: fr.save, exact: true });
  const nav = await box(page.getByRole('navigation', { name: fr.adminTabsAriaLabel }));
  const saveBox = await box(saveButton);
  const fieldBox = await box(lastField);
  expect(bottom(saveBox)).toBeLessThanOrEqual(nav.y + 1);
  expect(bottom(fieldBox)).toBeLessThanOrEqual(saveBox.y + 1);
  await screenshot(page, 'drill-event-details-bottom-390');

  await tabs.getByRole('tab', { name: fr.eventFieldsetSleeping }).click();
  await expect(page).toHaveURL(/\?section=sleeping$/);
  await expectStacked(back, heading, tabs);
  await expectNoSideScroll(page);
  await screenshot(page, 'drill-event-sleeping-390');
});

test('the back link goes to the parent, and the browser Back agrees', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/events');
  await eventRow(page, E2E_EVENT_THEME).getByRole('button', { name: fr.edit }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/events/${seeded.eventId}$`));
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await page.goForward();
  await backLink(page, fr.adminTabEvents).click();
  await expect(page).toHaveURL(/\/admin\/events$/);

  await page.goto('/admin/venues');
  await page.getByRole('button', { name: fr.venueOpen.replace('{name}', venue.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/venues/${venue.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: venue.name })).toBeVisible();
  await expect(moreButton(page)).toHaveAttribute('aria-current', /page|true/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/venues$/);
  await page.goForward();

  await page.getByRole('navigation', { name: fr.locationsListLabel }).getByRole('button', { name: /^Chambre 1/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/venues/${venue.id}/[^/]+$`));
  const back = backLink(page, venue.name);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Chambre 1');
  await expectStacked(back, heading);
  await expectNoSideScroll(page);
  await screenshot(page, 'drill-location-390');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/venues/${venue.id}$`));
  await page.goForward();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/admin/venues/${venue.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: venue.name })).toBeVisible();
  await screenshot(page, 'drill-venue-390');
  await expectNoSideScroll(page);

  await backLink(page, fr.adminTabVenues).click();
  await expect(page).toHaveURL(/\/admin\/venues$/);
});

test('on a desktop the detail pages keep their section current and sit in the clamped page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/admin/events/${seeded.eventId}`);
  await expect(sectionLink(page, fr.adminTabEvents)).toHaveAttribute('aria-current', /page|true/);
  await expect(backLink(page, fr.adminTabEvents)).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(1); // the editor's tabs; the sidebar is a nav
  await screenshot(page, 'drill-event-details-1440');
  await page.getByRole('tab', { name: fr.eventFieldsetSleeping }).click();
  await screenshot(page, 'drill-event-sleeping-1440');

  await page.goto(`/admin/venues/${venue.id}`);
  await expect(sectionLink(page, fr.adminTabVenues)).toHaveAttribute('aria-current', /page|true/);
  await expect(backLink(page, fr.adminTabVenues)).toBeVisible();
  await screenshot(page, 'drill-venue-1440');
  await page.getByRole('navigation', { name: fr.locationsListLabel }).getByRole('button', { name: /^Chambre 1/ }).click();
  // From lg the location is master-detail under the venue's own header.
  await expect(page.getByRole('heading', { level: 1, name: venue.name })).toBeVisible();
  await expectNoSideScroll(page);
  await screenshot(page, 'drill-location-1440');
});
