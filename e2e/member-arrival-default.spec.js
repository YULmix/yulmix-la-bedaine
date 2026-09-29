// A new registration's transport arrival defaults to the event's first day (#123); a saved
// arrival is never overwritten, and the input stays inside the event's dates and its container.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
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

// Steps 1 and 2 hold no required input: jump straight to the transport step ("Coups de main").
// A new registration prefills the member's name asynchronously (#133); moving forward validates
// names, so wait for it first.
const openTransportStep = async page => {
  await expect(page.getByLabel(fr.fullNameLabel).first()).not.toHaveValue('');
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
};

test('a new registration pre-fills arrival with the first day and lets the member change it', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await deleteParty(seeded.partyId);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);

  await expect(arrival(page)).toHaveValue(`${START}T12:00`);
  await expect(arrival(page)).toHaveAttribute('min', `${START}T00:00`);
  await expect(arrival(page)).toHaveAttribute('max', `${LAST}T23:59`);

  await arrival(page).fill(`${LAST}T18:30`);
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepReview) }).click();
  await page.getByRole('button', { name: fr.saveRegistrationButton }).click();

  await expect.poll(() => findMemberParty(seeded.eventId)).not.toBeNull();
  const saved = await findMemberParty(seeded.eventId);
  seeded.partyId = saved.id;
  expect(saved.transport.arrival).toContain(`${LAST}T18:30`);
});

test('an existing registration keeps its saved arrival', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await setPartyTransport(seeded.partyId, { type: '', seats: 0, arrival: `${LAST}T09:15`, departure: '' });

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue(`${LAST}T09:15`);
});

test('an existing registration with no saved arrival gets the default', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue(`${START}T12:00`);
});

test("an admin editing a member's registration keeps the saved arrival", async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty(EVENT);
  await setPartyTransport(seeded.partyId, { type: '', seats: 0, arrival: `${LAST}T09:15`, departure: '' });

  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin?tab=users');
  await page.getByRole('button', { name: fr.editRegistrationButton }).first().click();
  const dialog = page.getByRole('dialog');
  await openTransportStep(dialog);
  await expect(dialog.getByLabel(fr.transportArrival)).toHaveValue(`${LAST}T09:15`);
});

test('an event without a start date leaves arrival blank, with no bounds', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteParty(seeded.partyId);
  seeded.partyId = null;

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await openTransportStep(page);
  await expect(arrival(page)).toHaveValue('');
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
