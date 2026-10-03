// The member's summary never shows a raw transport value (#232): the column default 'None' and
// '' both read « Je me débrouille »; offer and need keep their wording, seats and departure.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  seedActiveEventWithMemberParty,
  setPartyTransport,
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

for (const type of ['None', '']) {
  test(`transport type ${JSON.stringify(type)} reads « ${fr.transportTypeNone} », never « None »`, async ({ page }) => {
    await setPartyTransport(seeded.partyId, { type, seats: 3, departure_fsa: 'H2G' });
    await loginAs(page, TEST_USERS.member);
    await page.goto('/');
    await expect(page.getByText(fr.transportTypeNone, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('None', { exact: true })).toHaveCount(0);
    // No lift: no seats and no departure.
    await expect(page.getByText(fr.transportDeparturePlaceLabel)).toHaveCount(0);
    await expect(page.getByText(/3 place\(s\)/)).toHaveCount(0);
  });
}

test('offer and need render with their wording, seats and departure', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  for (const [type, label] of [['offer', fr.transportTypeOffer], ['need', fr.transportTypeNeed]]) {
    await setPartyTransport(seeded.partyId, { type, seats: 2, departure_fsa: 'H2G' });
    await page.goto('/');
    await expect(page.getByText(label).first()).toBeVisible();
    await expect(page.getByText(fr.transportTypeNone, { exact: true })).toHaveCount(0);
    await expect(page.getByText(new RegExp(`${fr.transportDeparturePlaceLabel}.*H2G`))).toBeVisible();
  }
});
