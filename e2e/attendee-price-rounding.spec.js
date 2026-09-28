// Each attendee's price is rounded up to the dollar, and a party owes the sum of those rounded
// prices (issue #120): the lines in the registration form always add up to its estimate, and to
// what the database stores.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { getParty, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

// Same formatting as src/lib/format.js (fr-CA, e.g. "46,00 $").
const money = (amount) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(amount);

let seeded;

test.afterEach(async () => {
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
});

// Opens the member's registration (Alice, adult whole weekend; Bob, adult main event) for editing.
async function editRegistration(page, eventOverrides) {
  seeded = await seedActiveEventWithMemberParty(eventOverrides);
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
}

const estimate = (page) => page.getByText(fr.estimatedAmountDueLabel).locator('xpath=following-sibling::p[1]');
// The "who" step's card of the nth attendee (1-based).
const attendeeCard = (page, n) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${fr.participantNumberLabel}${n}`, exact: true }) });

// ChipGroup's radios are visually hidden: pick an option by clicking its chip, as a member does.
async function addAttendee(page, n, name) {
  await page.getByRole('button', { name: fr.addParticipantButton }).click();
  await attendeeCard(page, n).getByLabel(fr.fullNameLabel).fill(name);
  return attendeeCard(page, n);
}

test('at 85 $, an adult on the main event is shown at 46,00 $ on the who and review steps', async ({ page }) => {
  await editRegistration(page, { selling_price_whole_event: 85 });

  // 0.5375 × 85 = 45.6875.
  await expect(attendeeCard(page, 1).getByText(money(85), { exact: true })).toBeVisible();
  await expect(attendeeCard(page, 2).getByText(money(46), { exact: true })).toBeVisible();
  await expect(estimate(page)).toHaveText(money(131));

  await page.getByRole('button', { name: fr.stepReview }).click();
  const summary = page.getByRole('listitem').filter({ hasText: 'Bob E2E' });
  await expect(summary.getByText(money(46), { exact: true })).toBeVisible();
});

test('two adults on the main event at 200 $ owe 216 $, in the form and in the database', async ({ page }) => {
  await editRegistration(page);

  await attendeeCard(page, 1).getByText(fr.participationMainShort, { exact: true }).click();
  await expect(attendeeCard(page, 1).getByText(money(108), { exact: true })).toBeVisible();
  await expect(attendeeCard(page, 2).getByText(money(108), { exact: true })).toBeVisible();
  // 108 + 108, not ceil(2 × 107.50) = 215.
  await expect(estimate(page)).toHaveText(money(216));

  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect.poll(async () => Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(216);
});

test('a party mixing tiers owes exactly the sum of its lines', async ({ page }) => {
  await editRegistration(page, { selling_price_whole_event: 205, ratio_main_whole: 0.6 });

  const teen = await addAttendee(page, 3, 'Carol E2E');
  await teen.getByText(fr.attendeeTypeTeenager, { exact: true }).click();
  await teen.getByText(fr.participationMainShort, { exact: true }).click();
  const newbieTeen = await addAttendee(page, 4, 'Dan E2E');
  await newbieTeen.getByText(fr.attendeeTypeTeenager, { exact: true }).click();
  await newbieTeen.getByRole('switch', { name: fr.firstTimeAttendee }).click();
  const kid = await addAttendee(page, 5, 'Eve E2E');
  await kid.getByText(fr.attendeeTypeKid, { exact: true }).click();

  // 205 + 0.6 × 205 + two teens at 0.3 × 205 = 61.50 each + a kid.
  const lines = [205, 123, 62, 62, 0];
  for (const [index, amount] of lines.entries()) {
    await expect(attendeeCard(page, index + 1).getByText(money(amount), { exact: true })).toBeVisible();
  }
  // 452, where rounding the total would give ceil(451) = 451.
  await expect(estimate(page)).toHaveText(money(452));

  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect.poll(async () => Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(452);
});
