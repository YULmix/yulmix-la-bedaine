// Inscrits' « Exporter » dialog (#178, #209): « Par groupe » and « Par participant », each as a CSV
// download (BOM, quoted cells) and a Google Sheets copy (TSV, one line per row). A waitlisted
// party is listed with its status; members are blocked.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  createParty,
  createThrowawayMember,
  deleteParty,
  deleteThrowawayMember,
  isWaitlisted,
  seedActiveEventWithMemberParty,
  setPartyAnswers,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const ZOE = { name: 'Zoé Végé', type: 'Adult', participation: 'Whole', is_new_member: false, dietary_needs: ['vegan', 'other'], dietary_other: 'Pas de coriandre' };
const WANDA = { name: 'Wanda Attente', type: 'Adult', participation: 'Whole', is_new_member: false, dietary_needs: ['dairy_free'] };

let seeded;
let adminPartyId;
let waitlisted;

test.beforeEach(async () => {
  // Room for the member's two and the admin's one: the throwaway party after them is waitlisted.
  seeded = await seedActiveEventWithMemberParty({ max_attendees: 3 });
  await setPartyAnswers(seeded.partyId, {
    logistics: { volunteering: ['cook_meal', 'other'], volunteering_other: 'Jongler au feu' },
    transport: { type: 'offer', seats: 3, arrival: '2026-07-10T17:30', departure: '2026-07-12T14:00' },
    music_requests: 'Daft Punk\nJustice',
    message_to_organizers: 'On a dit "merci", deux fois'
  });
  adminPartyId = await createParty(seeded.eventId, ADMIN_ID, [ZOE]);
  const member = await createThrowawayMember('export-waitlisted');
  waitlisted = { ...member, partyId: await createParty(seeded.eventId, member.id, [WANDA]) };
  expect(await isWaitlisted(waitlisted.partyId)).toBe(true);
});

test.afterEach(async () => {
  if (waitlisted) await deleteThrowawayMember(waitlisted.id);
  if (adminPartyId) await deleteParty(adminPartyId);
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
  adminPartyId = null;
  waitlisted = null;
});

const card = page => page.getByRole('dialog', { name: fr.dataExportTitle });
const openExport = async page => {
  await page.getByRole('button', { name: fr.adminExportAction }).click();
  await expect(card(page)).toBeVisible();
};

const downloadCsv = async (page, exportLabel) => {
  await card(page).getByText(exportLabel, { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card(page).getByRole('button', { name: fr.exportCSVButton }).click()
  ]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf-8') };
};

test('« Par groupe » CSV: the new columns, the waitlisted party\'s status, escaped text', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await openExport(page);
  const { name, text } = await downloadCsv(page, fr.exportByParty);

  expect(name).toMatch(/^inscriptions_.*\.csv$/);
  expect(text.startsWith('﻿')).toBe(true);
  for (const header of [fr.exportStatus, fr.exportTransportType, fr.exportTransportSeats, fr.exportArrival, fr.exportDeparture, fr.exportVolunteering, fr.exportMusicRequests, fr.exportMessageToOrganizers]) {
    expect(text).toContain(`"${header}"`);
  }
  expect(text).toContain(`"${fr.transportKindOffer}","3"`);
  expect(text).toContain(`"${fr.volunteeringCookMeal}, Jongler au feu"`);
  // A line break stays inside its quoted cell; quotes are doubled.
  expect(text).toContain('"Daft Punk\nJustice"');
  expect(text).toContain('"On a dit ""merci"", deux fois"');
  expect(text).toContain(`"${fr.filterWaitlist}"`);
  expect(text).not.toMatch(/"(offer|need|None|cook_meal|registered)"/);
});

test('« Par participant » CSV: one row per attendee with dietary needs, no money', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await openExport(page);
  const { name, text } = await downloadCsv(page, fr.exportByAttendee);

  expect(name).toMatch(/^participants_.*\.csv$/);
  const lines = text.replace('﻿', '').split('\r\n');
  // Header, the member's two, the admin's one, the waitlisted one.
  expect(lines).toHaveLength(5);
  expect(lines[0]).toContain(`"${fr.exportDietaryNeeds}","${fr.exportDietaryOther}"`);
  expect(lines[0]).not.toContain(fr.exportAmountOwed);
  const zoe = lines.find(line => line.startsWith(`"${ZOE.name}"`));
  expect(zoe).toContain(`"${fr.vegan}, ${fr.otherDietary}","Pas de coriandre"`);
  const wanda = lines.find(line => line.startsWith(`"${WANDA.name}"`));
  expect(wanda).toContain(`"${fr.dairyFree}"`);
  expect(wanda).toContain(`"${fr.filterWaitlist}"`);
});

test('the Google Sheets copy puts one line per row in the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await openExport(page);
  await card(page).getByText(fr.exportByParty, { exact: true }).click();
  await card(page).getByRole('button', { name: fr.exportCopyTSVButton }).click();
  await expect(page.getByText(fr.exportCopyToast)).toBeVisible();

  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  const lines = tsv.split('\n');
  // Header, three parties, totals: the music request's line break didn't split a row.
  expect(lines).toHaveLength(5);
  expect(lines[0].split('\t')).toContain(fr.exportVolunteering);
  expect(tsv).toContain('Daft Punk Justice');
});

test('the dialog is a bottom sheet on a phone, and the old export URL lands on Inscrits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/tools/exports');
  await expect(page).toHaveURL(/\/admin\/users$/);
  await openExport(page);
  const box = await card(page).boundingBox();
  expect(box.width, 'full width').toBeGreaterThanOrEqual(388);
  expect(box.y + box.height, 'against the bottom edge').toBeGreaterThanOrEqual(795);
  await expect(card(page).getByRole('button', { name: fr.exportCSVButton })).toBeVisible();
  await expect(card(page).getByRole('button', { name: fr.exportCopyTSVButton })).toBeVisible();
});

test('a member opening Inscrits is blocked from exporting', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/users');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(page.getByRole('button', { name: fr.adminExportAction })).toHaveCount(0);
});
