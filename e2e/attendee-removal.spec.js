// Removing someone from a registration (#237) keeps their attendee row, marked removed, and every
// reader ignores it: the member's Pass and amount owed, the admin's Inscrits list, Logistique, the
// « Par participant » export and the carpool board. Whether the member or an admin removes them.
import { test, expect } from '@playwright/test';
import { adminMain, openPartyEditor } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  assignPlace,
  deleteLocations,
  getParty,
  seedActiveEventWithMemberParty,
  seedPlaces,
  setPartyTransport,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

// Same formatting as src/lib/format.js (fr-CA, e.g. "200,00 $").
const money = (amount) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(amount);

let seeded;
let places;

// The seeded party: Alice (adult, whole weekend, 200 $) and Bob (adult, main event, 108 $).
test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  places = await seedPlaces(seeded.eventId);
});

test.afterEach(async () => {
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

const pass = page => page.getByRole('article', { name: fr.passLabel });
const removeButton = (scope, name) => scope.getByRole('button', { name: fr.removeAttendeeLabel.replace('{name}', name) });
const needCard = page => page.getByRole('region', { name: fr.carpoolNeedsTitle }).getByRole('article', { name: 'Test Member' });

const downloadByAttendeeCsv = async (page) => {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: fr.adminExportAction }).click();
  const dialog = page.getByRole('dialog', { name: fr.dataExportTitle });
  await dialog.getByText(fr.exportByAttendee, { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: fr.exportCSVButton }).click()
  ]);
  return readFileSync(await download.path(), 'utf-8');
};

test('a member removes an attendee: gone from their Pass, the admin lists, Logistique, the export and the carpool board', async ({ page, browser }) => {
  await assignPlace(places['Chambre 1 · Lit A'], seeded.partyId, 2);
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(308);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await expect(pass(page).getByText(money(308), { exact: true })).toBeVisible();
  await pass(page).getByRole('button', { name: fr.editRegistration }).click();
  await removeButton(page, 'Bob E2E').click();
  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(pass(page)).toBeVisible();

  await expect.poll(async () => (await getParty(seeded.partyId)).attendees.map(a => a.name)).toEqual(['Alice E2E']);
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(200);
  // A need with no seat count asks for a seat per (live) attendee.
  await setPartyTransport(seeded.partyId, { type: 'need', seats: 0, arrival: '', departure: '' });

  await page.reload();
  await expect(pass(page).getByText(money(200), { exact: true })).toBeVisible();
  // Only the collapsed change history still names him.
  await expect(page.getByText('Bob E2E', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText('Alice E2E', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.goto('/carpool');
  await expect(needCard(page)).toContainText(`${fr.transportSeatsNeeded}1`);

  const admin = await (await browser.newContext()).newPage();
  await loginAs(admin, TEST_USERS.admin);
  await admin.goto('/admin/users');
  const search = adminMain(admin).getByRole('searchbox', { name: fr.searchPartiesPlaceholder });
  await search.fill('Alice E2E');
  await expect(adminMain(admin).getByRole('button', { name: 'Test Member' })).toBeVisible();
  await search.fill('Bob E2E');
  await expect(adminMain(admin).getByText(fr.noMatchingParties)).toBeVisible();

  await admin.goto('/admin/logistics');
  await expect(admin.getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, Alice E2E` })).toBeVisible();
  await expect(adminMain(admin).getByText('Bob E2E')).toHaveCount(0);

  const csv = await downloadByAttendeeCsv(admin);
  expect(csv).toContain('"Alice E2E"');
  expect(csv).not.toContain('Bob E2E');

  await admin.goto('/carpool');
  await expect(needCard(admin)).toContainText(`${fr.transportSeatsNeeded}1`);
  await admin.close();
});

test("an admin removes an attendee from a member's registration: the amount owed drops, and the member sees it", async ({ page, browser }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await openPartyEditor(page);
  const dialog = page.getByRole('dialog');
  await removeButton(dialog, 'Alice E2E').click();
  await dialog.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByText(fr.changesSavedToast)).toBeVisible();

  await expect.poll(async () => (await getParty(seeded.partyId)).attendees.map(a => a.name)).toEqual(['Bob E2E']);
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(108);
  await expect(adminMain(page).getByText(money(108), { exact: true }).filter({ visible: true })).toHaveCount(1);

  const member = await (await browser.newContext()).newPage();
  await loginAs(member, TEST_USERS.member);
  await member.goto('/');
  await expect(pass(member).getByText(money(108), { exact: true })).toBeVisible();
  await expect(member.getByText('Alice E2E', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(member.getByText('Bob E2E', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await member.close();
});
