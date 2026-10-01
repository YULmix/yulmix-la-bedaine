// Galleries (#177): admins edit the venue's two galleries and each location's on the venue's page
// of the Sites tab; members and admins view them through the same thumbnail button and carousel.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  assignPlace,
  deleteLocations,
  deleteVenueGalleries,
  galleryObjectExists,
  getEventVenue,
  getGalleryPaths,
  getLocations,
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
test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteLocations(seeded.eventId);
  await deleteVenueGalleries(seeded.eventId);
  venue = await getEventVenue(seeded.eventId);
});
test.afterEach(async () => {
  if (seeded?.eventId) {
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
  await page.goto(`/admin?tab=venues&venue=${venue.id}`);
  const section = page.getByRole('tabpanel', { name: fr.adminTabVenues });
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
  await admin.goto('/admin?tab=logistics');
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
