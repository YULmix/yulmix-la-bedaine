// Attendees are rows of their own table, saved through save_registration() (issue #126, ADR 0018):
// editing a registration updates each attendee in place, adds and removes the others, and keeps
// what an admin set on an attendee (their bed).
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  assignBed,
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

// The "who" step's card of the nth attendee (1-based).
const attendeeCard = (page, n) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${fr.participantNumberLabel}${n}`, exact: true }) });

test('a member renames, removes and adds attendees; each keeps their row and the history says so', async ({ page }) => {
  const [alice, bob] = (await getParty(seeded.partyId)).attendees;
  await assignBed(seeded.partyId, 1, 'Chambre 1');

  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();

  await attendeeCard(page, 1).getByLabel(fr.fullNameLabel).fill('Alice Renamed');
  await page.getByRole('button', { name: fr.removeAttendeeLabel.replace('{name}', bob.name) }).click();
  await page.getByRole('button', { name: fr.addParticipantButton }).click();
  await attendeeCard(page, 2).getByLabel(fr.fullNameLabel).fill('Carol E2E');
  await page.getByRole('button', { name: fr.saveChangesButton }).click();

  await expect.poll(async () => (await getParty(seeded.partyId)).attendees.map(a => a.name))
    .toEqual(['Alice Renamed', 'Carol E2E']);
  const [renamed, carol] = (await getParty(seeded.partyId)).attendees;
  expect(renamed.id).toBe(alice.id);
  expect(renamed.assigned_bed).toBe('Chambre 1');
  expect(carol.id).not.toBe(bob.id);
  expect(carol.assigned_bed).toBe('');

  // The summary lists the new group, and its history records the change of participants.
  await expect(page.getByText('Alice Renamed')).toBeVisible();
  await expect(page.getByText('Carol E2E')).toBeVisible();
  const history = page.locator('details').filter({ hasText: fr.editHistoryTitle });
  await history.getByText(fr.editHistoryTitle, { exact: true }).click();
  await expect(history.getByText(fr.historyFieldAttendees, { exact: true })).toBeVisible();
});

test("an admin editing a member's registration keeps the beds and the member's attendees", async ({ page }) => {
  await assignBed(seeded.partyId, 2, 'Chambre 2');
  const before = (await getParty(seeded.partyId)).attendees;

  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=users');
  await page.getByRole('button', { name: fr.editRegistrationButton }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: `${fr.participantNumberLabel}2`, exact: true }) })
    .getByLabel(fr.fullNameLabel)
    .fill('Bob Renamed');
  await dialog.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByText(fr.changesSavedToast)).toBeVisible();

  const after = (await getParty(seeded.partyId)).attendees;
  expect(after.map(a => [a.id, a.name, a.assigned_bed])).toEqual([
    [before[0].id, E2E_ATTENDEES[0].name, ''],
    [before[1].id, 'Bob Renamed', 'Chambre 2']
  ]);
});
