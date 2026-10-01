// The Outils tab's « Historique des changements » (#173): one event's registrations and edits,
// newest first, with their author; a CSV download and a Google Sheets copy of the same rows, one
// per changed field. Members can't reach it; their own history still reads in French.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  createThrowawayMember,
  deleteParty,
  deleteThrowawayMember,
  ensureOtherEvent,
  saveRegistrationAs,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const person = (name) => ({ name, type: 'Adult', participation: 'Whole', is_new_member: false });
const people = (n) => (n === 1 ? fr.countPersonOne : fr.countPersonOther).replace('{count}', n);

let seeded;
let registrant;
let otherMember;

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  // A member who registers and then adds someone, both themselves.
  registrant = await createThrowawayMember('history');
  await saveRegistrationAs(registrant, seeded.eventId, [person('Hélène')]);
  await saveRegistrationAs(registrant, seeded.eventId, [person('Hélène'), person('Hugo')]);
  // Another event, with one registration made by the admin.
  otherMember = await createThrowawayMember('history-other');
  await addParty(otherMember.id, await ensureOtherEvent());
});

test.afterEach(async () => {
  if (registrant) await deleteThrowawayMember(registrant.id);
  if (otherMember) await deleteThrowawayMember(otherMember.id);
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
  registrant = null;
  otherMember = null;
});

const card = page => page.locator('section').filter({ has: page.getByRole('heading', { name: fr.changeHistoryTitle }) });
const entries = page => card(page).getByTestId('change-history-entry');

test('the active event\'s history, newest first, with authors, head counts and amounts', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(card(page).getByLabel(fr.changeHistoryEventLabel)).toHaveValue(seeded.eventId);

  // The member's edit, their registration, then the seeded member's registration made by the admin.
  await expect(entries(page)).toHaveCount(3);
  const [edit, created] = [entries(page).nth(0), entries(page).nth(1)];
  await expect(edit).toContainText(registrant.fullName);
  await expect(edit).toContainText(fr.changeHistoryBy.replace('{author}', registrant.fullName));
  await expect(edit).toContainText(`${fr.historyFieldAttendees} ${people(1)}`);
  await expect(edit).toContainText(people(2));
  await expect(edit).toContainText(fr.amountDue);
  await expect(created).toContainText(fr.historyFieldCreated);
  await expect(created).toContainText(fr.changeHistoryBy.replace('{author}', registrant.fullName));
  await expect(entries(page).nth(2)).toContainText(fr.changeHistoryBy.replace('{author}', 'Test Admin'));
  await expect(card(page)).not.toContainText(/calculated_amount_owed|attendees|created|registered/);
});

test('switching events shows only that event\'s entries', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(3);

  await card(page).getByLabel(fr.changeHistoryEventLabel).selectOption(await ensureOtherEvent());
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText(otherMember.fullName);
  await expect(card(page)).not.toContainText(registrant.fullName);
});

test('the CSV holds only the selected event\'s rows, one per changed field', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(3);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card(page).getByRole('button', { name: fr.exportCSVButton }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^historique_.*_\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync(await download.path(), 'utf-8');
  expect(text.startsWith('﻿')).toBe(true);
  const lines = text.replace('﻿', '').split('\r\n');
  expect(lines[0]).toBe('"Horodatage","Auteur","Inscription","Champ","Ancienne valeur","Nouvelle valeur"');
  // The edit (attendees, amount), the member's creation, the seeded creation.
  expect(lines).toHaveLength(5);
  expect(lines[1]).toMatch(new RegExp(`^"\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}","${registrant.fullName}","${registrant.fullName}","${fr.historyFieldAttendees}","${people(1)}","${people(2)}"$`));
  expect(lines[2]).toContain(`"${fr.amountDue}"`);
  expect(lines[3]).toContain(`"${fr.historyFieldCreated}",""`);
  expect(text).not.toContain(otherMember.fullName);
});

test('the Google Sheets copy says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(3);
  await card(page).getByRole('button', { name: fr.exportCopyTSVButton }).click();
  await expect(page.getByText(fr.changeHistoryCopyToast)).toBeVisible();
  const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect(lines).toHaveLength(5);
  expect(lines[0].split('\t')).toEqual(['Horodatage', 'Auteur', 'Inscription', 'Champ', 'Ancienne valeur', 'Nouvelle valeur']);
});

test('at phone width the history doesn\'t scroll the page sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

const addEdits = async () => {
  // 20 more edits: well past a screen of entries.
  for (let i = 0; i < 10; i += 1) {
    await saveRegistrationAs(registrant, seeded.eventId, [person('Hélène')]);
    await saveRegistrationAs(registrant, seeded.eventId, [person('Hélène'), person('Hugo')]);
  }
};
const scrollBox = page => card(page).getByTestId('change-history-scroll');
const measure = page => scrollBox(page).evaluate(el => {
  const bar = document.querySelector('[data-bottom-bar]');
  const barTop = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : window.innerHeight;
  return { bottom: el.getBoundingClientRect().bottom, barTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };
});

// One scrollbar at a time. On a laptop the list scrolls inside a box that ends on screen with the
// page at the top, and uses the height there is. (At 800 px tall, the dev banners leave too little
// room for a useful box and the page scrolls instead, like on a phone.)
test('on a laptop, a long history scrolls inside a box that ends on screen', async ({ page }) => {
  await addEdits();
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(23);

  const box = await measure(page);
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
  expect(box.bottom).toBeLessThanOrEqual(box.barTop);
  expect(box.bottom).toBeGreaterThan(box.barTop - 80);
  await scrollBox(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(entries(page).last()).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

// On a phone there's no room for a useful box under the controls: no inner scroll, the page scrolls.
test('on a phone, a long history scrolls with the page, not inside a box', async ({ page }) => {
  await addEdits();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=tools&view=history');
  await expect(entries(page)).toHaveCount(23);

  const box = await measure(page);
  expect(box.scrollHeight).toBe(box.clientHeight);
  await entries(page).last().scrollIntoViewIfNeeded();
  await expect(entries(page).last()).toBeInViewport();
});

test('a member can\'t open the history; their own history reads in French', async ({ page }) => {
  // The seeded member's registration, made by themselves this time, then edited.
  await deleteParty(seeded.partyId);
  seeded.partyId = await saveRegistrationAs(TEST_USERS.member, seeded.eventId, [person('Alice E2E')]);
  await saveRegistrationAs(TEST_USERS.member, seeded.eventId, [person('Alice E2E'), person('Bob E2E')]);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin?tab=tools&view=history');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(page.getByRole('heading', { name: fr.changeHistoryTitle })).toHaveCount(0);

  await page.goto('/');
  const history = page.locator('details').filter({ hasText: fr.editHistoryTitle });
  await history.locator('summary').click();
  await expect(history).toContainText(fr.historyFieldCreated);
  await expect(history).toContainText(`${fr.historyFieldAttendees} ${people(1)}`);
  await expect(history).not.toContainText(/calculated_amount_owed|attendees|created|registered|\{/);
});
