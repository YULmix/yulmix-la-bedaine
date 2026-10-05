// Galleries (#177): admins edit the venue's two galleries and each location's on the venue's page
// of the Sites tab; members and admins view them through the same thumbnail button and carousel.
import { test, expect } from '@playwright/test';
import { adminMain } from './support/admin.js';
import { readFileSync } from 'node:fs';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  assignPlace,
  createAccounts,
  deleteLocations,
  deleteThrowawayMember,
  deleteVenueGalleries,
  galleryObjectExists,
  getEventVenue,
  getGalleryPaths,
  getLocations,
  grantEditionRoles,
  revokeEditionRoles,
  seedActiveEventWithMemberParty,
  seedGallery,
  seedPlaces,
  teardownActiveEventWithMemberParty
} from './support/testData.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

let seeded;
let venue;
let extraAccounts = [];
test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteLocations(seeded.eventId);
  await deleteVenueGalleries(seeded.eventId);
  venue = await getEventVenue(seeded.eventId);
});
test.afterEach(async () => {
  for (const id of extraAccounts) await deleteThrowawayMember(id);
  extraAccounts = [];
  if (seeded?.eventId) {
    await revokeEditionRoles(seeded.eventId);
    await deleteLocations(seeded.eventId);
    await deleteVenueGalleries(seeded.eventId);
  }
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGP4z9AARww4OQBkQBH1e29BNAAAAABJRU5ErkJggg==', 'base64');
const files = (...names) => names.map(name => ({ name, mimeType: 'image/png', buffer: PNG }));

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

const openVenuePage = async (page) => {
  await page.goto(`/admin/venues/${venue.id}`);
  const section = adminMain(page);
  await expect(section.getByText(fr.sleepingAutosave)).toBeVisible();
  return section;
};

const galleryButton = (page, name, count) => page.getByRole('button', {
  name: fr.galleryOpen.replace('{name}', name).replace('{count}', count), exact: true
});

// Uploads three images at once to an editor, moves the second to the front, then removes the
// third after confirming; the removed image's object leaves the bucket.
const editGallery = async (page, editor, title, readPaths) => {
  await expect(editor.getByText(fr.galleryEmpty)).toBeVisible();
  await editor.getByLabel(`${fr.galleryInputLabel} : ${title}`).setInputFiles(files('a.png', 'b.png', 'c.png'));
  await expect(editor.getByRole('listitem')).toHaveCount(3);
  await expect(editor.getByText(fr.galleryUploading.replace('{n}', 3).replace('{total}', 3))).toHaveCount(0);
  const [a, b, c] = await readPaths();
  expect([a, b, c].every(path => path.endsWith('.jpg'))).toBe(true);

  await editor.getByRole('button', { name: fr.galleryMoveEarlier.replace('{n}', 2) }).click();
  await expect.poll(readPaths).toEqual([b, a, c]);
  await expect(editor.getByRole('listitem').first().getByText(fr.galleryCover)).toBeVisible();

  await editor.getByRole('button', { name: fr.galleryRemove.replace('{n}', 3) }).click();
  const confirm = page.getByRole('dialog', { name: fr.galleryRemoveConfirmTitle });
  await confirm.getByRole('button', { name: fr.galleryRemoveAction }).click();
  await expect(editor.getByRole('listitem')).toHaveCount(2);
  await expect.poll(readPaths).toEqual([b, a]);
  await expect.poll(() => galleryObjectExists(c)).toBe(false);
  expect(await galleryObjectExists(a)).toBe(true);
  return [b, a];
};

test('an admin uploads several images, reorders them and removes one, for the venue and a location; deleting the location removes its files', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  const section = await openVenuePage(page);

  const general = section.getByRole('region', { name: fr.galleryVenueGeneralTitle });
  await editGallery(page, general, fr.galleryVenueGeneralTitle, () => getGalleryPaths(seeded.eventId, { kind: 'general' }));
  // The other venue gallery is untouched.
  expect(await getGalleryPaths(seeded.eventId, { kind: 'assignments' })).toEqual([]);
  await screenshot(page, 'gallery-editor-venue');

  await section.getByRole('button', { name: fr.locationAdd }).click();
  const input = page.getByLabel(fr.locationNameLabel);
  await input.fill('Grenier');
  await input.press('Tab');
  const grenier = page.getByRole('region', { name: 'Grenier' });
  const locationGallery = grenier.getByRole('region', { name: fr.galleryLocationTitle });
  await expect.poll(async () => (await getLocations(seeded.eventId)).map(l => l.name)).toEqual(['Grenier']);
  const kept = await editGallery(page, locationGallery, fr.galleryLocationTitle, () => getGalleryPaths(seeded.eventId, { location: 'Grenier' }));

  await page.getByRole('button', { name: fr.locationDelete.replace('{name}', 'Grenier') }).click();
  await expect(page.getByText(fr.locationsEmpty)).toBeVisible();
  for (const path of kept) await expect.poll(() => galleryObjectExists(path)).toBe(false);
});

test('a member opens the venue gallery: count, wrap-around, counter, Esc and background close it, the image does not', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  // Empty: nothing renders.
  await page.goto('/event-details');
  await expect(page.getByRole('heading', { name: fr.timelineTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(fr.galleryOpen.split('{name}')[0]) })).toHaveCount(0);

  await seedGallery(seeded.eventId, { kind: 'general' }, 3);
  await seedGallery(seeded.eventId, { kind: 'assignments' }, 1);
  await page.reload();
  const button = galleryButton(page, venue.name, 3);
  await expect(button).toBeVisible();
  await expect(button.getByText('3', { exact: true })).toBeVisible();
  // Members never see the assignments gallery.
  await expect(page.getByRole('button', { name: new RegExp(fr.galleryOpen.split('{name}')[0]) })).toHaveCount(1);

  await button.click();
  const dialog = page.getByRole('dialog', { name: fr.galleryDialogLabel.replace('{name}', venue.name) });
  const counter = dialog.getByText(/^\d+ \/ \d+$/);
  await expect(counter).toHaveText('1 / 3');
  const shown = dialog.getByRole('img', { name: fr.galleryImageAlt.replace('{name}', venue.name).replace('{n}', 1).replace('{total}', 3) });
  await expect.poll(() => shown.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await screenshot(page, 'gallery-viewer');

  await dialog.getByRole('button', { name: fr.galleryPrevious }).click();
  await expect(counter).toHaveText('3 / 3');
  await dialog.getByRole('button', { name: fr.galleryNext }).click();
  await expect(counter).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 3');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('3 / 3');

  // A click on the image does nothing.
  await dialog.getByRole('img', { name: fr.galleryImageAlt.replace('{name}', venue.name).replace('{n}', 3).replace('{total}', 3) }).click();
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();

  // A click on the background closes it, and reopening starts at the cover.
  await button.click();
  await expect(counter).toHaveText('1 / 3');
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();

  // The close button too.
  await button.click();
  await dialog.getByRole('button', { name: fr.close }).click();
  await expect(dialog).toBeHidden();
});

test('a member sees their location\'s gallery in Couchage; the admin sees the assignments gallery on the assignment page', async ({ page, browser }) => {
  await seedPlaces(seeded.eventId);
  const [chambre] = await getLocations(seeded.eventId);
  await assignPlace(chambre.places[0].id, seeded.partyId, 1);
  await seedGallery(seeded.eventId, { location: chambre.name }, 2);
  await seedGallery(seeded.eventId, { kind: 'assignments' }, 4);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  const logistics = page.getByRole('heading', { name: fr.logisticsSummary }).locator('..');
  await logistics.getByRole('button', { name: fr.galleryOpen.replace('{name}', chambre.name).replace('{count}', 2) }).click();
  const dialog = page.getByRole('dialog', { name: fr.galleryDialogLabel.replace('{name}', chambre.name) });
  await expect(dialog.getByText('1 / 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await screenshot(page, 'gallery-member-couchage');

  const admin = await browser.newPage();
  await loginAs(admin, TEST_USERS.admin);
  await admin.goto('/admin/logistics');
  const name = `${venue.name} · ${fr.galleryVenueAssignmentsTitle}`;
  await galleryButton(admin, name, 4).click();
  await expect(admin.getByRole('dialog', { name: fr.galleryDialogLabel.replace('{name}', name) }).getByText('1 / 4')).toBeVisible();
  await admin.close();
});

test('at a phone width the viewer fits without scrolling the page sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedGallery(seeded.eventId, { kind: 'general' }, 2);
  await loginAs(page, TEST_USERS.member);
  await page.goto('/event-details');
  const button = galleryButton(page, venue.name, 2);
  await expect(button).toBeVisible();
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideScroll()).toBe(true);

  await button.click();
  const dialog = page.getByRole('dialog', { name: fr.galleryDialogLabel.replace('{name}', venue.name) });
  await expect(dialog.getByRole('button', { name: fr.galleryNext })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: fr.galleryPrevious })).toBeInViewport();
  expect(await noSideScroll()).toBe(true);

  // A swipe left shows the next image.
  const box = await dialog.getByRole('img').first().boundingBox();
  const y = box.y + box.height / 2;
  await dialog.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 300, clientY: y }], changedTouches: [{ identifier: 1, clientX: 300, clientY: y }] });
  await dialog.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 200, clientY: y }] });
  await expect(dialog.getByText('2 / 2')).toBeVisible();
  await screenshot(page, 'gallery-viewer-phone');
});

// « Épingler le plan » (#293): the assignments gallery pinned as a strip stuck under the header
// while the parties scroll under it, remembered on the device.
const ASSIGNMENTS_NAME = () => `${venue.name} · ${fr.galleryVenueAssignmentsTitle}`;
const pinToggle = page => page.getByRole('button', { name: fr.galleryPin, exact: true });
const strip = page => page.getByRole('region', { name: fr.galleryStripLabel.replace('{name}', ASSIGNMENTS_NAME()) });

// A page long enough to scroll: the member's party and three more, with places to assign.
const seedLongPlacesPage = async (prefix) => {
  await seedPlaces(seeded.eventId);
  extraAccounts = await createAccounts(`${prefix}-${Date.now()}`, 3);
  for (const id of extraAccounts) await addParty(id, seeded.eventId);
  await seedGallery(seeded.eventId, { kind: 'assignments' }, 3);
};

// Scrolls the parties to their end (the last card's bottom at the screen's), then checks the strip
// is in view, right under the header, not under it. The parties' end, not the page's: below them
// come the footer and the end of the strip's section, which a sticky element leaves with.
const expectStuckUnderHeader = async (page) => {
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scrollable).toBeGreaterThan(200);
  const lastParty = adminMain(page).locator('section > ul > li').last();
  await expect(lastParty).toBeVisible();
  await lastParty.evaluate(card => card.scrollIntoView({ block: 'end' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  // Measured together and polled: the test-account line is lazy-loaded into the header, which
  // then grows, and --header-height follows it one ResizeObserver callback later.
  const gap = async () => {
    const header = await page.getByRole('banner').boundingBox();
    const box = await strip(page).boundingBox();
    return box.y - (header.y + header.height);
  };
  await expect.poll(gap).toBeGreaterThanOrEqual(-1);
  expect(await gap()).toBeLessThan(16);
  const frame = await strip(page).boundingBox();
  return frame;
};

const swipeLeft = async (page, target) => {
  const box = await target.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await target.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x + 60, clientY: y }], changedTouches: [{ identifier: 1, clientX: x + 60, clientY: y }] });
  await target.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: x - 60, clientY: y }] });
};

test('an admin pins the assignments plan: it stays under the header, steps, opens full screen on the same image, and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await seedLongPlacesPage('pin-admin');
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics');

  const toggle = pinToggle(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(strip(page)).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const counter = strip(page).getByText(/^\d+ \/ \d+$/);
  await expect(counter).toHaveText('1 / 3');
  const shown = strip(page).getByRole('img', { name: fr.galleryImageAlt.replace('{name}', ASSIGNMENTS_NAME()).replace('{n}', 1).replace('{total}', 3) });
  await expect.poll(() => shown.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

  // About a third of the screen from sm up.
  const frame = await expectStuckUnderHeader(page);
  expect(frame.height).toBeGreaterThan(800 * 0.3);
  expect(frame.height).toBeLessThan(800 * 0.4);
  await screenshot(page, 'plan-pinned-admin-1440');

  await strip(page).getByRole('button', { name: fr.galleryNext }).click();
  await expect(counter).toHaveText('2 / 3');
  await strip(page).getByRole('button', { name: fr.galleryPrevious }).click();
  await strip(page).getByRole('button', { name: fr.galleryPrevious }).click();
  await expect(counter).toHaveText('3 / 3');
  await swipeLeft(page, strip(page));
  await expect(counter).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 3');

  // Full screen on the same image; Esc goes back to the strip, on the image it closed on.
  const enlarge = strip(page).getByRole('button', { name: fr.galleryStripEnlarge.replace('{n}', 2).replace('{total}', 3) });
  await enlarge.click();
  const dialog = page.getByRole('dialog', { name: fr.galleryDialogLabel.replace('{name}', ASSIGNMENTS_NAME()) });
  await expect(dialog.getByText('2 / 3')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText('3 / 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(counter).toHaveText('3 / 3');
  await expect(strip(page).getByRole('button', { name: fr.galleryStripEnlarge.replace('{n}', 3).replace('{total}', 3) })).toBeFocused();

  // Remembered; the other Logistique views don't show it.
  await page.reload();
  await expect(strip(page)).toBeVisible();
  await expect(pinToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/admin/logistics/food');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await page.goto('/admin/logistics');

  // Unpinned from the strip itself, and remembered too.
  await strip(page).getByRole('button', { name: fr.galleryUnpin }).click();
  await expect(strip(page)).toHaveCount(0);
  await expect(pinToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(pinToggle(page)).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
});

for (const role of ['committee', 'admin']) {
  test(`at a phone width the pinned plan takes about a quarter of the screen, swipes, and leaves the parties usable (${role})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLongPlacesPage(`pin-${role}`);
    await grantEditionRoles(seeded.eventId);
    await loginAs(page, TEST_USERS[role]);
    await page.goto('/admin/logistics');
    await pinToggle(page).click();
    await expect(strip(page).getByText('1 / 3')).toBeVisible();

    const frame = await expectStuckUnderHeader(page);
    expect(frame.height).toBeGreaterThan(844 * 0.2);
    expect(frame.height).toBeLessThan(844 * 0.3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A sideways swipe on the strip steps.
    await swipeLeft(page, strip(page));
    await expect(strip(page).getByText('2 / 3')).toBeVisible();

    // The last party's card shows between the strip and the bottom bar; an admin's Save bar too.
    const lastCard = adminMain(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: /pin-/ }) }).last();
    await expect(lastCard).toBeInViewport();
    const bottomBar = await page.locator('[data-bottom-bar]').boundingBox();
    if (role === 'admin') {
      const save = page.getByRole('button', { name: fr.save, exact: true });
      await expect(save).toBeInViewport();
      const saveBox = await save.boundingBox();
      expect(saveBox.y).toBeGreaterThan(frame.y + frame.height);
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(bottomBar.y + 1);
    }
    await screenshot(page, `plan-pinned-${role}-390`);
  });
}

test('without assignments images there is no pin toggle and nothing pinned, even when pinned before', async ({ page }) => {
  await seedPlaces(seeded.eventId);
  await page.addInitScript(() => window.localStorage.setItem('bedaine:logistics-plan-pinned', '1'));
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics');
  await expect(page.getByRole('heading', { name: fr.occupancyTitle })).toBeVisible();
  await expect(pinToggle(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: new RegExp(fr.galleryStripLabel.split('{name}')[0]) })).toHaveCount(0);
});
