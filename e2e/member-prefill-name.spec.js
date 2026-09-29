// A new registration starts with the member's own name as the first attendee (#133); editing a
// registration keeps the names it was saved with.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { E2E_ATTENDEES, deleteParty, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Both tests reseed the one shared active event, so they run one after the other.
test.describe.configure({ mode: 'serial' });

let seeded;
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const names = page => page.getByLabel(fr.fullNameLabel);

test("a new registration's first attendee is the member, and stays editable", async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteParty(seeded.partyId);
  seeded.partyId = null;

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page)).toHaveCount(1);
  // The seeded member's profile name.
  await expect(names(page).first()).toHaveValue('Test Member');
  await names(page).first().fill('Quelqu’un d’autre');
  await expect(names(page).first()).toHaveValue('Quelqu’un d’autre');
});

test('editing a registration keeps its saved names', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();

  await loginAs(page, TEST_USERS.member);
  await page.goto('/inscription');
  await expect(names(page)).toHaveCount(E2E_ATTENDEES.length);
  await expect(names(page).first()).toHaveValue(E2E_ATTENDEES[0].name);
});
