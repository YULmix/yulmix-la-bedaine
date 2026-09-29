// Dietary needs (#152, #153): several per attendee, « Sans produits laitiers » among them,
// « Aucune restriction » on its own, « Autre » with its text. Saved, shown to the member, and
// counted per need in the admin overview.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
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

// The nth dietary chip group on the stay step (0-based), and its chips.
const dietGroup = (page, n = 0) => page.getByRole('group', { name: fr.dietaryNeeds }).nth(n);
const chip = (page, n, label) => dietGroup(page, n).getByRole('checkbox', { name: label, exact: true });
// The checkbox is visually hidden inside its chip: tap the chip, as a person would.
const tap = (page, n, label) => dietGroup(page, n).locator('label')
  .filter({ has: page.getByRole('checkbox', { name: label, exact: true }) }).click();

const openStayStep = async (page) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepStay) }).click();
  await expect(dietGroup(page)).toBeVisible();
};

const needsOf = async (partyId) => (await getParty(partyId)).attendees
  .map(a => [a.name, a.dietary_needs, a.dietary_other]);

test('a member picks several needs per attendee; « Aucune restriction » stands alone; « Autre » needs its text', async ({ page }) => {
  await openStayStep(page);
  await page.getByRole('switch', { name: fr.sameForEveryone }).click();

  // Alice: gluten-free and dairy-free, plus something else.
  await tap(page, 0, fr.glutenFree);
  await tap(page, 0, fr.dairyFree);
  await tap(page, 0, fr.otherDietary);
  await expect(chip(page, 0, fr.glutenFree)).toBeChecked();
  await expect(chip(page, 0, fr.dairyFree)).toBeChecked();

  // Bob: vegan, then « Aucune restriction » replaces it; then vegan replaces « Aucune restriction ».
  await tap(page, 1, fr.vegan);
  await tap(page, 1, fr.noDietaryNeeds);
  await expect(chip(page, 1, fr.vegan)).not.toBeChecked();
  await expect(chip(page, 1, fr.noDietaryNeeds)).toBeChecked();
  await tap(page, 1, fr.vegan);
  await expect(chip(page, 1, fr.noDietaryNeeds)).not.toBeChecked();
  await tap(page, 1, fr.noDietaryNeeds);

  // « Autre » left blank: saving is refused with a message on the field, nothing written.
  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByText(fr.dietaryOtherRequired)).toBeVisible();
  expect((await getParty(seeded.partyId)).attendees.map(a => a.dietary_needs)).toEqual([[], []]);

  await page.getByLabel(fr.pleaseSpecify).fill('Noix');
  await expect(page.getByText(fr.dietaryOtherRequired)).toHaveCount(0);
  await page.getByRole('button', { name: fr.saveChangesButton }).click();

  await expect.poll(() => needsOf(seeded.partyId)).toEqual([
    ['Alice E2E', ['gluten_free', 'dairy_free', 'other'], 'Noix'],
    ['Bob E2E', ['none'], '']
  ]);

  // The summary shows each need; « Aucune restriction » isn't shown.
  const participant = name => page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
  for (const label of [fr.glutenFree, fr.dairyFree, 'Noix']) {
    await expect(participant('Alice E2E').getByText(label, { exact: true })).toBeVisible();
  }
  await expect(participant('Bob E2E').getByText(fr.noDietaryNeeds, { exact: true })).toHaveCount(0);

  // Editing again shows the saved choices, per attendee (they differ).
  await page.reload();
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepStay) }).click();
  await expect(chip(page, 0, fr.glutenFree)).toBeChecked();
  await expect(chip(page, 0, fr.dairyFree)).toBeChecked();
  await expect(chip(page, 0, fr.otherDietary)).toBeChecked();
  await expect(page.getByLabel(fr.pleaseSpecify)).toHaveValue('Noix');
  await expect(chip(page, 1, fr.noDietaryNeeds)).toBeChecked();
  await expect(chip(page, 1, fr.vegan)).not.toBeChecked();
});

test('unticking « Autre » drops its text', async ({ page }) => {
  await openStayStep(page);
  await tap(page, 0, fr.vegetarian);
  await tap(page, 0, fr.otherDietary);
  await page.getByLabel(fr.pleaseSpecify).fill('Arachides');
  await tap(page, 0, fr.otherDietary);
  await expect(page.getByLabel(fr.pleaseSpecify)).toHaveCount(0);
  await tap(page, 0, fr.otherDietary);
  await expect(page.getByLabel(fr.pleaseSpecify)).toHaveValue('');
  await tap(page, 0, fr.otherDietary);

  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  // Same for everyone: both attendees get it.
  await expect.poll(() => needsOf(seeded.partyId)).toEqual([
    ['Alice E2E', ['vegetarian'], ''],
    ['Bob E2E', ['vegetarian'], '']
  ]);
});

test('the admin overview counts each need once per attendee', async ({ page }) => {
  await openStayStep(page);
  await page.getByRole('switch', { name: fr.sameForEveryone }).click();
  await tap(page, 0, fr.glutenFree);
  await tap(page, 0, fr.dairyFree);
  await tap(page, 1, fr.dairyFree);
  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect.poll(async () => (await getParty(seeded.partyId)).attendees.map(a => a.dietary_needs))
    .toEqual([['gluten_free', 'dairy_free'], ['dairy_free']]);

  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin');
  const food = page.locator('div').filter({ has: page.getByRole('heading', { name: fr.foodPreferences }) }).last();
  const row = label => food.getByRole('listitem').filter({ hasText: label });
  await expect(row(fr.dairyFree)).toContainText('2');
  await expect(row(fr.glutenFree)).toContainText('1');
});
