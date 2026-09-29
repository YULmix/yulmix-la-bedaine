// Sleeping locations and places (#113), edited in the event dialog of the Événements tab. Every
// change saves right away; an occupied place or location can't be deleted, and says who's in it.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  assignPlace,
  deleteLocations,
  getLocations,
  getParty,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty,
  unassignPlace
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  if (seeded?.eventId) await deleteLocations(seeded.eventId);
  seeded = null;
});

const openEditor = async (page) => {
  await page.goto('/admin?tab=events');
  await page.getByRole('tabpanel').getByRole('button', { name: fr.edit }).click();
  const dialog = page.getByRole('dialog', { name: fr.editEventMetadataTitle });
  await expect(dialog.getByRole('group', { name: fr.eventFieldsetSleeping })).toBeVisible();
  return dialog;
};

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png` });
};

// Types into a save-on-blur field and leaves it.
const fillAndLeave = async (input, value) => {
  await input.fill(value);
  await input.press('Tab');
};

test('an admin adds, renames, reorders and fills locations; changes are saved immediately', async ({ page }) => {
  let dialog = await openEditor(page);
  await expect(dialog.getByText(fr.locationsEmpty)).toBeVisible();

  await dialog.getByRole('button', { name: fr.locationAdd }).click();
  await fillAndLeave(dialog.getByLabel(fr.locationNameLabel).first(), 'Chambre 2');
  await dialog.getByRole('button', { name: fr.locationAdd }).click();
  await expect(dialog.getByLabel(fr.locationNameLabel)).toHaveCount(2);
  await fillAndLeave(dialog.getByLabel(fr.locationNameLabel).nth(1), 'Cour');
  await expect.poll(async () => (await getLocations(seeded.eventId)).map(l => l.name)).toEqual(['Chambre 2', 'Cour']);

  await dialog.getByRole('button', { name: fr.locationMoveUp.replace('{name}', 'Cour') }).click();
  await expect.poll(async () => (await getLocations(seeded.eventId)).map(l => l.name)).toEqual(['Cour', 'Chambre 2']);
  await expect(dialog.getByLabel(fr.locationNameLabel).first()).toHaveValue('Cour');

  const chambre = dialog.getByRole('listitem', { name: 'Chambre 2' });
  await chambre.getByRole('button', { name: fr.placeAdd }).click();
  await fillAndLeave(chambre.getByLabel(fr.placeLabelLabel), 'Lit A');
  await chambre.getByLabel(fr.placeTypeLabel).selectOption('sofa');
  await fillAndLeave(chambre.getByLabel(fr.placeCapacityLabel), '2');
  await expect(chambre.getByText(fr.locationTotals.replace('{places}', 1).replace('{capacity}', 2))).toBeVisible();
  await expect.poll(async () => (await getLocations(seeded.eventId))[1].places)
    .toEqual([expect.objectContaining({ label: 'Lit A', type: 'sofa', capacity: 2 })]);

  // Nothing waits for the dialog's Save: closing and reopening shows what was stored.
  await dialog.getByRole('button', { name: fr.cancel }).click();
  dialog = await openEditor(page);
  await expect(dialog.getByLabel(fr.locationNameLabel)).toHaveCount(2);
  await expect(dialog.getByRole('listitem', { name: 'Chambre 2' }).getByLabel(fr.placeLabelLabel)).toHaveValue('Lit A');
  await dialog.getByRole('group', { name: fr.eventFieldsetSleeping }).scrollIntoViewIfNeeded();
  await screenshot(page, 'locations-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('group', { name: fr.eventFieldsetSleeping }).scrollIntoViewIfNeeded();
  await screenshot(page, 'locations-phone');
});

test("an occupied place or location can't be deleted, and says who is in it", async ({ page }) => {
  let dialog = await openEditor(page);
  await dialog.getByRole('button', { name: fr.locationAdd }).click();
  await fillAndLeave(dialog.getByLabel(fr.locationNameLabel), 'Salon');
  const salon = dialog.getByRole('listitem', { name: 'Salon' });
  await salon.getByRole('button', { name: fr.placeAdd }).click();
  await fillAndLeave(salon.getByLabel(fr.placeLabelLabel), 'Sofa');
  await expect.poll(async () => (await getLocations(seeded.eventId))[0]?.places.map(p => p.label)).toEqual(['Sofa']);

  const [{ places: [sofa] }] = await getLocations(seeded.eventId);
  await assignPlace(sofa.id, seeded.partyId, 0);
  const [alice] = (await getParty(seeded.partyId)).attendees;
  expect(alice.assigned_bed).toBe('Salon · Sofa');

  await dialog.getByRole('button', { name: fr.cancel }).click();
  dialog = await openEditor(page);
  const occupied = dialog.getByRole('listitem', { name: 'Salon' });
  await expect(occupied.getByText(fr.placeOccupants.replace('{names}', 'Alice E2E'))).toBeVisible();

  for (const name of [fr.placeDelete.replace('{label}', 'Sofa'), fr.locationDelete.replace('{name}', 'Salon')]) {
    await occupied.getByRole('button', { name }).click();
    const refusal = page.getByRole('dialog', { name: fr.occupiedDeleteTitle });
    await expect(refusal.getByRole('listitem').filter({ hasText: 'Alice E2E' })).toBeVisible();
    await refusal.getByRole('button', { name: fr.close }).last().click();
    await expect(refusal).toBeHidden();
  }
  expect((await getLocations(seeded.eventId))[0].places).toHaveLength(1);

  // Renaming the place renames the member's label with it.
  await fillAndLeave(occupied.getByLabel(fr.placeLabelLabel), 'Canapé');
  await expect.poll(async () => (await getParty(seeded.partyId)).attendees[0].assigned_bed).toBe('Salon · Canapé');

  // Once empty, the place goes.
  await unassignPlace(sofa.id);
  await dialog.getByRole('button', { name: fr.cancel }).click();
  dialog = await openEditor(page);
  await dialog.getByRole('button', { name: fr.placeDelete.replace('{label}', 'Canapé') }).click();
  await expect.poll(async () => (await getLocations(seeded.eventId))[0].places).toEqual([]);
});
