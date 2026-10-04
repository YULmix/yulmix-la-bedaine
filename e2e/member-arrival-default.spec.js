// A new registration's transport arrival defaults to the event's first day and its departure to
// the last (#123); saved times are never overwritten, and the inputs stay inside the event's
// dates and their container.
import { test, expect } from '@playwright/test';
import { openPartyEditor } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  deleteParty,
  findMemberParty,
  seedActiveEventWithMemberParty,
  setPartyTransport,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

// A 3-day event a few weeks out, so registration is open. Local dates, like the app's.
const pad = n => String(n).padStart(2, '0');
const dateOnly = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const start = new Date();
start.setDate(start.getDate() + 60);
const last = new Date(start);
last.setDate(last.getDate() + 2);
const START = dateOnly(start);
const LAST = dateOnly(last);
const EVENT = { event_start_date: START, duration_days: 3, x_reg_close_weeks: 1 };

let seeded;
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const arrival = page => page.getByLabel(fr.transportArrival);
const departure = page => page.getByLabel(fr.transportDeparture);

// Steps 1 and 2 hold no required input: jump straight to the transport step ("Coups de main").
// A new registration prefills the member's name asynchronously (#133); moving forward validates
// names, so wait for it first.
const openTransportStep = async page => {
  await expect(page.getByLabel(fr.fullNameLabel).first()).not.toHaveValue('');
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
};

test('a new registration pre-fills arrival and departure with the first and last day and lets the member change them', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await deleteParty(seeded.partyId);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);

  await expect(arrival(page)).toHaveValue(`${START}T12:00`);
  await expect(arrival(page)).toHaveAttribute('min', `${START}T00:00`);
  await expect(arrival(page)).toHaveAttribute('max', `${LAST}T23:59`);
  await expect(departure(page)).toHaveValue(`${LAST}T15:00`);
  await expect(departure(page)).toHaveAttribute('min', `${START}T00:00`);
  await expect(departure(page)).toHaveAttribute('max', `${LAST}T23:59`);

  await arrival(page).fill(`${START}T18:30`);
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
  await page.getByRole('button', { name: fr.saveRegistrationButton }).click();

  await expect.poll(() => findMemberParty(seeded.eventId)).not.toBeNull();
  const saved = await findMemberParty(seeded.eventId);
  seeded.partyId = saved.id;
  expect(saved.transport.arrival).toContain(`${START}T18:30`);
  expect(saved.transport.departure).toContain(`${LAST}T15:00`);
});

test('an existing registration keeps its saved arrival and departure', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await setPartyTransport(seeded.partyId, { type: '', seats: 0, arrival: `${START}T09:15`, departure: `${START}T20:45` });

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue(`${START}T09:15`);
  await expect(departure(page)).toHaveValue(`${START}T20:45`);
});

test('an existing registration with no saved times gets the defaults', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue(`${START}T12:00`);
  await expect(departure(page)).toHaveValue(`${LAST}T15:00`);
});

// An edited registration is never a new one, even with every saved attendee removed (#194): an
// arrival the member cleared stays cleared when a reload restores the draft.
test('a cleared arrival on an edited registration stays cleared across a reload', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await setPartyTransport(seeded.partyId, { type: '', seats: 0, arrival: `${START}T09:15`, departure: `${START}T20:45` });
  // The reload asks first (unsaved changes): go ahead.
  page.on('dialog', dialog => dialog.accept());

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  const names = page.getByLabel(fr.fullNameLabel);
  await expect(names.first()).toHaveValue(E2E_ATTENDEES[0].name);
  await page.getByRole('button', { name: fr.addParticipantButton }).click();
  await names.nth(2).fill('Chloé E2E');
  for (const { name } of E2E_ATTENDEES) {
    await page.getByRole('button', { name: fr.removeAttendeeLabel.replace('{name}', name) }).click();
  }
  await expect(names).toHaveCount(1);
  await openTransportStep(page);
  await arrival(page).fill('');
  await expect(arrival(page)).toHaveValue('');

  await page.reload();
  await expect(page.getByText(fr.registrationDraftRestored)).toBeVisible();
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue('');
  await expect(departure(page)).toHaveValue(`${START}T20:45`);
});

test("an admin editing a member's registration keeps the saved arrival and departure", async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await setPartyTransport(seeded.partyId, { type: '', seats: 0, arrival: `${START}T09:15`, departure: `${START}T20:45` });

  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await openPartyEditor(page);
  const dialog = page.getByRole('dialog');
  await openTransportStep(dialog);
  await expect(dialog.getByLabel(fr.transportArrival)).toHaveValue(`${START}T09:15`);
  await expect(dialog.getByLabel(fr.transportDeparture)).toHaveValue(`${START}T20:45`);
});

test('an event without a start date leaves arrival and departure blank, with no bounds', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteParty(seeded.partyId);
  seeded.partyId = null;

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue('');
  await expect(departure(page)).toHaveValue('');
  await expect(arrival(page)).not.toHaveAttribute('min');
  await expect(arrival(page)).not.toHaveAttribute('max');
});

test.describe('on a phone', () => {
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('the arrival and departure inputs fit their container', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);

  const card = page.locator('div').filter({ has: arrival(page) }).filter({ hasText: fr.transport }).last();
  const cardBox = await card.boundingBox();
  for (const label of [fr.transportArrival, fr.transportDeparture]) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
});
