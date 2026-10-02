// Where a lift leaves from (#181): the start of a postal code (for matching, #180) and a note.
// Only with « Offre » or « Besoin »; the code is optional but must be well formed. Kept in the
// draft, saved normalised, shown on the summary, in the history and to admins; « Aucun » drops it.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  getParty,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

let seeded;

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
});

test.afterEach(async () => {
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
});

const fsa = page => page.getByLabel(fr.transportDepartureFsa);
const place = page => page.getByLabel(fr.transportDeparturePlace);
const steps = page => page.getByRole('navigation', { name: fr.registrationStepsLabel });
const transportChip = (page, label) => page.locator('label').filter({ hasText: label }).first();

const openHelpStep = async (page) => {
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await expect(page.getByLabel(fr.fullNameLabel).first()).not.toHaveValue('');
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
};

const save = async (page) => {
  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
};

test('a member needing a lift gives a postal code start and a note; draft, summary, history, admin', async ({ page, browser }) => {
  // A reload with unsaved changes raises beforeunload: accept it, as a member would.
  page.on('dialog', dialog => dialog.accept());
  await loginAs(page, TEST_USERS.member);
  await openHelpStep(page);

  // No lift: no fields.
  await expect(fsa(page)).toHaveCount(0);
  await expect(place(page)).toHaveCount(0);
  await transportChip(page, fr.transportTypeNeed).click();

  // Not a Canadian postal code: the next step is refused, with the reason.
  await fsa(page).fill('W1A');
  await steps(page).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
  await expect(page.getByText(fr.transportDepartureFsaInvalid)).toBeVisible();
  await expect(fsa(page)).toBeFocused();

  // Upper case as it's typed (the database only takes upper case); a full postal code is cut to
  // its start when the field is left.
  await fsa(page).fill('h2g 1a1');
  await expect(fsa(page)).toHaveValue('H2G 1A1');
  await place(page).fill('  métro Jean-Talon ');
  await expect(fsa(page)).toHaveValue('H2G');
  await expect(page.getByText(fr.transportDepartureFsaInvalid)).toHaveCount(0);

  // The unsaved draft keeps both through a reload.
  await page.reload();
  await expect(page.getByText(fr.registrationDraftRestored)).toBeVisible();
  await steps(page).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
  await expect(fsa(page)).toHaveValue('H2G');
  await expect(place(page)).toHaveValue('  métro Jean-Talon ');

  await save(page);
  await expect.poll(async () => (await getParty(seeded.partyId)).transport)
    .toMatchObject({ type: 'need', departure_fsa: 'H2G', departure_place: 'métro Jean-Talon' });
  await expect(page.getByText(`${fr.transportDeparturePlaceLabel} H2G · métro Jean-Talon`, { exact: true })).toBeVisible();

  // Editing shows them again; a change is in the history, in French.
  await openHelpStep(page);
  await expect(fsa(page)).toHaveValue('H2G');
  await fsa(page).fill('G1R');
  await place(page).fill('');
  await save(page);
  await expect(page.getByText(`${fr.transportDeparturePlaceLabel} G1R`, { exact: true })).toBeVisible();
  const history = page.locator('details').filter({ hasText: fr.editHistoryTitle });
  await history.getByText(fr.editHistoryTitle, { exact: true }).click();
  // Newest first: the change from H2G to G1R.
  const change = history.locator('li li').filter({ hasText: fr.transport }).first();
  await expect(change.locator('span').nth(1)).toContainText(`${fr.transportDeparturePlaceShort}: H2G · métro Jean-Talon`);
  await expect(change.locator('span').nth(2)).toContainText(`${fr.transportDeparturePlaceShort}: G1R`);

  // The admin's Transport view shows the code.
  const admin = await browser.newPage();
  await loginAs(admin, TEST_USERS.admin);
  await admin.goto('/admin/logistics/transport');
  const row = admin.getByRole('tabpanel', { name: fr.logisticsViewTransport }).getByRole('listitem').filter({ hasText: 'Test Member' });
  await expect(row).toContainText(`${fr.transportDepartureFsa}G1R`);
  await expect(row).toContainText(`${fr.transportDeparturePlace}${fr.emptyValue}`);
  await admin.close();
});

test('« Aucun » hides where the lift leaves from and saves none of it', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await openHelpStep(page);
  await transportChip(page, fr.transportTypeOffer).click();
  await fsa(page).fill('J1H');
  await place(page).fill('Sherbrooke');
  await transportChip(page, fr.transportTypeNone).click();
  await expect(fsa(page)).toHaveCount(0);
  await expect(place(page)).toHaveCount(0);
  // Back to an offer: the fields start empty again.
  await transportChip(page, fr.transportTypeOffer).click();
  await expect(fsa(page)).toHaveValue('');
  await expect(place(page)).toHaveValue('');
  await transportChip(page, fr.transportTypeNone).click();
  await save(page);
  const { transport } = await getParty(seeded.partyId);
  expect(transport).not.toHaveProperty('departure_fsa');
  expect(transport).not.toHaveProperty('departure_place');
  await expect(page.getByText(fr.transportDeparturePlaceLabel)).toHaveCount(0);
});
