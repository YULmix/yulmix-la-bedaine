// The carpool board (#180): members registered for the active event, and admins, see the lifts of
// its confirmed parties, with name, email, departure, times and seats, and each one's closest
// matches by detour. Anyone else gets no nav item and a « not available » page.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  createThrowawayMember,
  deleteThrowawayMember,
  getEventVenue,
  getParty,
  getVenueCoordinates,
  seedActiveEventWithMemberParty,
  setPartyAnswers,
  setPartyTransport,
  setVenueCoordinates,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Every test reseeds the one shared active event.
test.describe.configure({ mode: 'serial' });

let seeded;
const throwaways = [];

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await setVenueCoordinates(seeded.eventId, 45.005, -72.1);
});

test.afterEach(async () => {
  while (throwaways.length) await deleteThrowawayMember(throwaways.pop().id);
  if (seeded) {
    await setVenueCoordinates(seeded.eventId, null, null);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

const throwaway = async (label) => {
  const member = await createThrowawayMember(label);
  throwaways.push(member);
  return member;
};
const LIFT_TIMES = { arrival: '2026-07-10T18:00', departure: '2026-07-12T14:00' };
// A throwaway member registered for the event, with this transport.
const registeredWith = async (label, transport) => {
  const member = await throwaway(label);
  const partyId = await addParty(member.id, seeded.eventId);
  await setPartyTransport(partyId, { seats: 1, ...LIFT_TIMES, ...transport });
  return member;
};

const transportChip = (page, label) => page.locator('label').filter({ hasText: label }).first();
const nav = page => page.getByRole('navigation', { name: fr.mainNavLabel });
const section = (page, title) => page.getByRole('region', { name: title });
const card = (scope, name) => scope.getByRole('article', { name });

const openHelpStep = async (page) => {
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await expect(page.getByLabel(fr.fullNameLabel).first()).not.toHaveValue('');
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();
};

const save = async (page) => {
  await page.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
};

test('a member offers a lift; another registered member sees it, with its closest need', async ({ page, browser }) => {
  const rider = await registeredWith('rider', { type: 'need', departure_fsa: 'H4C' });
  const walker = await registeredWith('walker', { type: '', seats: 0 });

  await loginAs(page, TEST_USERS.member);
  await openHelpStep(page);
  await transportChip(page, fr.transportTypeOffer).click();
  await page.getByRole('group', { name: fr.transportSeats }).getByRole('button', { name: fr.stepperMore }).click({ clickCount: 3 });
  await page.getByLabel(fr.transportArrival).fill(LIFT_TIMES.arrival);
  await page.getByLabel(fr.transportDeparture).fill(LIFT_TIMES.departure);
  await page.getByLabel(fr.transportDepartureFsa).fill('H2G');
  await page.getByLabel(fr.transportDeparturePlace).fill('métro Jean-Talon');
  await save(page);
  await expect.poll(async () => (await getParty(seeded.partyId)).transport)
    .toMatchObject({ type: 'offer', seats: 3, departure_fsa: 'H2G' });

  const riderPage = await browser.newPage();
  await loginAs(riderPage, rider);
  await nav(riderPage).getByRole('link', { name: fr.navCarpool }).click();
  await expect(riderPage).toHaveURL(/\/carpool$/);
  await expect(riderPage.getByRole('heading', { level: 1, name: fr.carpoolTitle })).toBeVisible();

  const offer = card(section(riderPage, fr.carpoolOffersTitle), 'Test Member');
  await expect(offer.getByRole('link', { name: fr.carpoolEmailLabel.replace('{name}', 'Test Member') }))
    .toHaveAttribute('href', 'mailto:member@test.local');
  await expect(offer).toContainText('H2G · métro Jean-Talon');
  await expect(offer).toContainText('10 juillet 2026');
  await expect(offer).toContainText('12 juillet 2026');
  await expect(offer).toContainText(`${fr.transportSeatsOffered}3`);
  // Its closest need is the rider, by detour to the venue, and their times line up.
  await expect(offer.getByRole('listitem').filter({ hasText: rider.fullName })).toContainText(/~\d+ km de détour/);
  await expect(offer).not.toContainText(fr.carpoolTimesDiffer);

  const needs = section(riderPage, fr.carpoolNeedsTitle);
  await expect(card(needs, rider.fullName)).toContainText(fr.carpoolYou);
  await expect(card(needs, rider.fullName).getByRole('listitem').filter({ hasText: 'Test Member' })).toBeVisible();
  // A party with no lift isn't there.
  await expect(riderPage.getByText(walker.fullName)).toHaveCount(0);
  await riderPage.close();
});

// Not registered, or waitlisted: neither is on the board, so it isn't theirs to see.
for (const { label, waitlisted } of [{ label: 'without a registration', waitlisted: false }, { label: 'on the waitlist', waitlisted: true }]) {
  test(`a member ${label} has no nav item and cannot open the board`, async ({ page }) => {
    const member = await throwaway(waitlisted ? 'waitlisted' : 'stranger');
    if (waitlisted) {
      const partyId = await addParty(member.id, seeded.eventId);
      await setPartyAnswers(partyId, { is_waitlisted: true, transport: { type: 'need', seats: 1, departure_fsa: 'H2G' } });
    }
    await loginAs(page, member);
    await expect(nav(page).getByRole('link', { name: fr.navInfo })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: fr.navCarpool })).toHaveCount(0);
    await page.goto('/carpool');
    await expect(page.getByRole('heading', { name: fr.dbErrorCarpoolBoardForbidden })).toBeVisible();
    await expect(page.getByRole('region', { name: fr.carpoolOffersTitle })).toHaveCount(0);
  });
}

test('an admin sees the board; a member on it without a postal code is told to add one', async ({ page, browser }) => {
  await setPartyTransport(seeded.partyId, { type: 'need', seats: 2, ...LIFT_TIMES });

  await loginAs(page, TEST_USERS.admin);
  await nav(page).getByRole('link', { name: fr.navCarpool }).click();
  const need = card(page.getByRole('region', { name: fr.carpoolNeedsTitle }), 'Test Member');
  await expect(need).toContainText(`${fr.transportDeparturePlaceShort}${fr.carpoolNotSpecified}`);
  await expect(need).toContainText(fr.carpoolNoFsa);
  await expect(page.getByRole('region', { name: fr.carpoolOffersTitle })).toContainText(fr.carpoolOffersEmpty);

  const member = await browser.newPage();
  await loginAs(member, TEST_USERS.member);
  await member.goto('/carpool');
  await expect(member.getByText(fr.carpoolAddFsaHint)).toBeVisible();
  // The link opens the registration on its transport card.
  await member.getByRole('link', { name: fr.carpoolAddFsa }).click();
  await expect(member.getByLabel(fr.transportDepartureFsa)).toBeVisible();
  await member.close();
});

test("an admin enters the venue's coordinates, pasted from a map; anything else is refused", async ({ page }) => {
  await setVenueCoordinates(seeded.eventId, null, null);
  await loginAs(page, TEST_USERS.admin);
  // The venue's page in the Sites tab, where its name and address are edited too.
  await page.goto(`/admin/venues/${(await getEventVenue(seeded.eventId)).id}`);
  const field = page.getByLabel(fr.venueCoordinatesLabel);
  await expect(field).toHaveValue('');

  await field.fill('Stanstead');
  await field.blur();
  await expect(page.getByText(fr.venueCoordinatesInvalid)).toBeVisible();

  await field.fill('45.0050, -72.1000');
  await field.blur();
  await expect(page.getByText(fr.venueCoordinatesInvalid)).toHaveCount(0);
  await expect.poll(() => getVenueCoordinates(seeded.eventId)).toEqual({ lat: 45.005, lng: -72.1 });
  await expect(field).toHaveValue('45.005, -72.1');

  // Blank clears them.
  await field.fill('');
  await field.blur();
  await expect.poll(() => getVenueCoordinates(seeded.eventId)).toEqual({ lat: null, lng: null });
});
