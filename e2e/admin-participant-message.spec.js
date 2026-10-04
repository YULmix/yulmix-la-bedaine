// #216: « Assignation des places » lists bed requests for health, then young children, first, and
// shows each party's message to the organisers under its places. The organisers write a message
// to the participants, saved with the one Save, logged in the change history and shown in the
// member's « Logistique » card; their private notes never are.
import { test, expect } from '@playwright/test';
import { adminMain, openSection } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  createParty,
  deleteLocations,
  deleteParty,
  getParty,
  seedActiveEventWithMemberParty,
  seedPlaces,
  setPartyAnswers,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const ZOE = { name: 'Zoé Santé', type: 'Adult', participation: 'Whole', is_new_member: false, sleeping_preference: 'bed', bed_reason: 'health' };
const SECRET_NOTE = 'Note secrète des organisateurs';
const ORGANIZERS_MESSAGE = 'On arrive tard vendredi';
const MESSAGE = 'Votre lit est dans la chambre du fond.';

let seeded;
let extraPartyId;

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
  // Registered after the member, but asks for a bed for health reasons.
  extraPartyId = await createParty(seeded.eventId, ADMIN_ID, [ZOE]);
  await setPartyAnswers(seeded.partyId, { message_to_organizers: ORGANIZERS_MESSAGE, admin_notes: SECRET_NOTE });
});

test.afterEach(async () => {
  if (extraPartyId) await deleteParty(extraPartyId);
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
  extraPartyId = null;
});

const panel = page => adminMain(page);
// The party cards, in order (the attendee rows inside them hold no textbox).
const cards = page => panel(page).getByRole('listitem')
  .filter({ has: page.getByRole('textbox', { name: fr.logisticsTableParticipantMessage }) });
const card = (page, text) => cards(page).filter({ hasText: text });
const messageBox = (page, text) => card(page, text).getByRole('textbox', { name: fr.logisticsTableParticipantMessage });
const pending = n => fr.eventEditorUnsaved.replace('{n}', n);
const logisticsCard = page => page.locator('div').filter({ has: page.getByRole('heading', { name: fr.logisticsSummary, exact: true }) }).last();

test('health requests come first; each card shows what its party wrote to the organisers', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics');
  await expect(cards(page)).toHaveCount(2);

  await expect(cards(page).nth(0)).toContainText(ZOE.name);
  await expect(cards(page).nth(1)).toContainText('Alice E2E');

  await expect(card(page, 'Alice E2E').getByText(fr.messageToOrganizers)).toBeVisible();
  await expect(card(page, 'Alice E2E')).toContainText(ORGANIZERS_MESSAGE);
  await expect(card(page, ZOE.name).getByText(fr.messageToOrganizers)).toHaveCount(0);
  await expect(card(page, ZOE.name).getByRole('textbox', { name: fr.logisticsTableAdminNotes })).toBeVisible();
  await expect(messageBox(page, ZOE.name)).toHaveAttribute('placeholder', fr.participantMessagePlaceholder);
});

test('the admin writes a message: unsaved until the Save, kept across sections, logged, and the member sees it, not the notes', async ({ page, browser }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics');
  await messageBox(page, 'Alice E2E').fill(MESSAGE);
  await expect(panel(page).getByText(pending(1))).toBeVisible();
  await expect(card(page, 'Alice E2E').getByText(fr.unsavedTag)).toBeVisible();
  expect((await getParty(seeded.partyId)).message_to_participants).toBeNull();

  // Another section and back: the draft is still there.
  await openSection(page, fr.adminTabUsers);
  await openSection(page, fr.adminTabLogistics);
  await expect(messageBox(page, 'Alice E2E')).toHaveValue(MESSAGE);
  await expect(panel(page).getByText(pending(1))).toBeVisible();

  await panel(page).getByRole('button', { name: fr.save, exact: true }).click();
  await expect(page.getByText(fr.logisticsAllSavedToast)).toBeVisible();
  await expect(panel(page).getByText(fr.eventEditorAllSaved)).toBeVisible();
  const saved = await getParty(seeded.partyId);
  expect([saved.message_to_participants, saved.admin_notes]).toEqual([MESSAGE, SECRET_NOTE]);

  // The change history has it, under its own label.
  await page.goto('/admin/tools/history');
  const entry = page.getByTestId('change-history-entry').filter({ hasText: fr.historyFieldMessageToParticipants });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(MESSAGE);

  // The member reads the message in their Logistique card; the private notes appear nowhere.
  const memberPage = await (await browser.newContext()).newPage();
  // Nor in any response the member's browser receives (#227: they came with the party's row).
  const leaks = [];
  memberPage.on('response', async response => {
    const body = await response.text().catch(() => '');
    if (body.includes(SECRET_NOTE)) leaks.push(response.url());
  });
  await loginAs(memberPage, TEST_USERS.member);
  await memberPage.goto('/');
  await expect(logisticsCard(memberPage).getByRole('heading', { name: fr.messageFromOrganizers })).toBeVisible();
  await expect(logisticsCard(memberPage)).toContainText(MESSAGE);
  await expect(memberPage.getByText(SECRET_NOTE)).toHaveCount(0);
  await expect(memberPage.locator('body')).not.toContainText(SECRET_NOTE);
  await memberPage.waitForLoadState('networkidle');
  expect(leaks).toEqual([]);
});

test('no message, or only spaces: the member sees no message and no notes', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: fr.inputSummary })).toBeVisible();
  await expect(page.getByRole('heading', { name: fr.messageFromOrganizers })).toHaveCount(0);
  // Nothing assigned and no message: no Logistique card at all.
  await expect(page.getByRole('heading', { name: fr.logisticsSummary, exact: true })).toHaveCount(0);

  // Written by an admin (the test client signs in as one).
  await setPartyAnswers(seeded.partyId, { message_to_participants: '   \n ' });
  await page.reload();
  await expect(page.getByRole('heading', { name: fr.inputSummary })).toBeVisible();
  await expect(page.getByRole('heading', { name: fr.messageFromOrganizers })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(SECRET_NOTE);
});

// A pasted link or any long unbroken text wraps on a phone: no card gets wider than the screen.
test('long unbroken messages wrap on a phone, in their cards (390 px)', async ({ page }) => {
  const toMember = `https://example.com/${'a'.repeat(280)}`;
  const toOrganizers = `https://example.org/${'b'.repeat(280)}`;
  await setPartyAnswers(seeded.partyId, { message_to_participants: toMember, message_to_organizers: toOrganizers });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: fr.messageFromOrganizers })).toBeVisible();
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/member-long-message-390.png`, fullPage: true });
  }

  for (const text of [toMember, toOrganizers]) {
    const fits = await page.getByText(text, { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth);
    expect(fits, text.slice(0, 25)).toBe(true);
  }
  // Every card (ui Card: a section.rounded-card) ends inside the viewport.
  const rights = await page.locator('section.rounded-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().right));
  expect(rights.length).toBeGreaterThan(2);
  rights.forEach(right => expect(right).toBeLessThanOrEqual(390));
});
