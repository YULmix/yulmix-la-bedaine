// « Lieu de départ » (#181): a party that offers or needs a lift says where it leaves from. Kept
// in the draft, saved trimmed, shown on the summary, in the history and to admins; « Aucun »
// hides and drops it.
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

const place = page => page.getByLabel(fr.transportDeparturePlace);
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

test('a member needing a lift says where from; it survives a reload, shows on the summary and in the history', async ({ page, browser }) => {
  // A reload with unsaved changes raises beforeunload: accept it, as a member would.
  page.on('dialog', dialog => dialog.accept());
  await loginAs(page, TEST_USERS.member);
  await openHelpStep(page);

  // No lift: no field.
  await expect(place(page)).toHaveCount(0);
  await transportChip(page, fr.transportTypeNeed).click();
  await expect(place(page)).toHaveAttribute('placeholder', fr.transportDeparturePlacePlaceholder);
  await place(page).fill('  Montréal (Rosemont) ');

  // The unsaved draft keeps it through a reload.
  await page.reload();
  await expect(page.getByText(fr.registrationDraftRestored)).toBeVisible();
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
  await expect(place(page)).toHaveValue('  Montréal (Rosemont) ');

  await save(page);
  await expect.poll(async () => (await getParty(seeded.partyId)).transport).toMatchObject({ type: 'need', departure_place: 'Montréal (Rosemont)' });
  await expect(page.getByText(`${fr.transportDeparturePlaceLabel} Montréal (Rosemont)`, { exact: true })).toBeVisible();

  // Editing shows it again; a change is in the history, in French.
  await openHelpStep(page);
  await expect(place(page)).toHaveValue('Montréal (Rosemont)');
  await place(page).fill('Québec');
  await save(page);
  await expect(page.getByText(`${fr.transportDeparturePlaceLabel} Québec`, { exact: true })).toBeVisible();
  const history = page.locator('details').filter({ hasText: fr.editHistoryTitle });
  await history.getByText(fr.editHistoryTitle, { exact: true }).click();
  // Newest first: the change from Montréal to Québec.
  const change = history.locator('li li').filter({ hasText: fr.transport }).first();
  await expect(change.locator('span').nth(1)).toContainText(`${fr.transportDeparturePlace}: Montréal (Rosemont)`);
  await expect(change.locator('span').nth(2)).toContainText(`${fr.transportDeparturePlace}: Québec`);

  // The admin's Transport view shows it.
  const admin = await browser.newPage();
  await loginAs(admin, TEST_USERS.admin);
  await admin.goto('/admin?tab=logistics&view=transport');
  await expect(admin.getByRole('tabpanel', { name: fr.logisticsViewTransport }).getByRole('listitem').filter({ hasText: 'Test Member' }))
    .toContainText(`${fr.transportDeparturePlace}Québec`);
  await admin.close();
});

test('« Aucun » hides the departure place and saves none', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await openHelpStep(page);
  await transportChip(page, fr.transportTypeOffer).click();
  await place(page).fill('Sherbrooke');
  await transportChip(page, fr.transportTypeNone).click();
  await expect(place(page)).toHaveCount(0);
  // Back to an offer: the field starts empty again.
  await transportChip(page, fr.transportTypeOffer).click();
  await expect(place(page)).toHaveValue('');
  await transportChip(page, fr.transportTypeNone).click();
  await save(page);
  const { transport } = await getParty(seeded.partyId);
  expect(transport).not.toHaveProperty('departure_place');
  await expect(page.getByText(fr.transportDeparturePlaceLabel)).toHaveCount(0);
});
