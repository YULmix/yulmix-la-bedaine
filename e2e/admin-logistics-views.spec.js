// The Logistique tab's five views (#179): places, and the form's answers (food, volunteering,
// transport, comments) of confirmed parties. The view is in the URL; pending place changes
// survive moving between views; a waitlisted party's answers are left out; members are blocked.
import { test, expect } from '@playwright/test';
import { adminNav, sectionLink, viewLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  createParty,
  createThrowawayMember,
  deleteLocations,
  deleteParty,
  deleteThrowawayMember,
  getParty,
  isWaitlisted,
  seedActiveEventWithMemberParty,
  seedPlaces,
  setPartyAnswers,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { pickPlace } from './support/placePicker.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const MEMBER = 'Test Member';
const ADMIN = 'Test Admin';
const ZOE = { name: 'Zoé Végé', type: 'Adult', participation: 'Whole', is_new_member: false, dietary_needs: ['vegan', 'other'], dietary_other: 'Pas de coriandre' };
const WANDA = { name: 'Wanda Attente', type: 'Adult', participation: 'Whole', is_new_member: false, dietary_needs: ['dairy_free'] };

let seeded;
let adminPartyId;
let waitlisted;

test.beforeEach(async () => {
  // Room for the member's two and the admin's one: the throwaway party after them is waitlisted.
  seeded = await seedActiveEventWithMemberParty({ max_attendees: 3 });
  await seedPlaces(seeded.eventId);
  await setPartyAnswers(seeded.partyId, {
    logistics: { volunteering: ['cook_meal', 'other'], volunteering_other: 'Jongler au feu' },
    transport: { type: 'offer', seats: 3, arrival: '2026-07-10T17:30', departure: '2026-07-12T14:00' },
    music_requests: 'Daft Punk\nJustice',
    message_to_organizers: '  '
  });
  adminPartyId = await createParty(seeded.eventId, ADMIN_ID, [ZOE]);
  await setPartyAnswers(adminPartyId, {
    logistics: { volunteering: ['cook_meal'] },
    transport: { type: 'need', seats: 0, arrival: '', departure: '' },
    message_to_organizers: 'Merci pour tout!'
  });
  const member = await createThrowawayMember('waitlisted');
  waitlisted = { ...member, partyId: await createParty(seeded.eventId, member.id, [WANDA]) };
  await setPartyAnswers(waitlisted.partyId, {
    logistics: { volunteering: ['pharmacy'] },
    transport: { type: 'offer', seats: 2 },
    music_requests: 'Chanson en attente',
    message_to_organizers: 'Message en attente'
  });
  expect(await isWaitlisted(waitlisted.partyId)).toBe(true);
});

test.afterEach(async () => {
  if (waitlisted) await deleteThrowawayMember(waitlisted.id);
  if (adminPartyId) await deleteParty(adminPartyId);
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
  adminPartyId = null;
  waitlisted = null;
});

// The views are in the sidebar from md up, in ViewTabs on phones (#208).
const isPhone = page => page.viewportSize().width < 768;
const viewTab = (page, label) => (isPhone(page)
  ? page.getByRole('tablist', { name: fr.logisticsViewsLabel }).getByRole('tab', { name: label })
  : viewLink(page, label));
const view = (page, label) => page.getByRole('tabpanel', { name: label });
const expectView = async (page, label) => {
  await expect(viewTab(page, label)).toHaveAttribute(...(isPhone(page) ? ['aria-selected', 'true'] : ['aria-current', 'page']));
  await expect(page.getByRole('heading', { level: 1, name: `${fr.adminTabLogistics} · ${label}` })).toBeVisible();
  await expect(view(page, label)).toBeVisible();
};
// The view in the URL, /admin/logistics/<view>; null for the default one (no segment).
const viewParam = page => new URL(page.url()).pathname.match(/^\/admin\/logistics\/([^/]+)$/)?.[1] ?? null;
const pending = n => fr.eventEditorUnsaved.replace('{n}', n);
// Screenshots for visual review, only when E2E_SCREENSHOT_DIR is set (kept out of the repo).
const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

test('each view has its URL; Back and Forward move between them; pending places survive', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics/food');
  await expectView(page, fr.logisticsViewFood);
  await page.goto('/admin/logistics/nope');
  await expectView(page, fr.logisticsViewTitle);
  await page.goto('/admin/logistics');
  await expectView(page, fr.logisticsViewTitle);

  const picker = page.getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, Alice E2E` });
  await pickPlace(page, picker, 'Chambre 1 · Lit A');
  await expect(page.getByText(pending(1))).toBeVisible();

  await viewTab(page, fr.logisticsViewFood).click();
  await expectView(page, fr.logisticsViewFood);
  expect(viewParam(page)).toBe('food');
  // The save bar stays in reach on the other views.
  await expect(view(page, fr.logisticsViewFood).getByText(pending(1))).toBeVisible();

  await viewTab(page, fr.logisticsViewTransport).click();
  await expectView(page, fr.logisticsViewTransport);
  expect(viewParam(page)).toBe('transport');

  await page.goBack();
  await expectView(page, fr.logisticsViewFood);
  await page.goBack();
  await expectView(page, fr.logisticsViewTitle);
  expect(viewParam(page)).toBeNull();
  await expect(picker).toHaveValue('Chambre 1 · Lit A');
  await expect(page.getByText(pending(1))).toBeVisible();
  await page.goForward();
  await expectView(page, fr.logisticsViewFood);

  await expect(page.getByText(pending(1))).toBeVisible();
});

test('the views show the confirmed parties\' answers, and none of the waitlisted party\'s', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);

  await page.goto('/admin/logistics/food');
  const food = view(page, fr.logisticsViewFood);
  await expect(food.getByRole('list', { name: fr.foodSummaryLabel })).toContainText(`1${fr.vegan}`);
  await expect(food.getByRole('list', { name: fr.foodSummaryLabel })).toContainText(`1${fr.otherDietary}`);
  await expect(food.getByText('Pas de coriandre')).toBeVisible();
  await expect(food.getByText(ZOE.name)).toHaveCount(2);
  await expect(food.getByText(fr.dairyFree)).toHaveCount(0);
  await expect(food.getByText(WANDA.name)).toHaveCount(0);
  await screenshot(page, 'logistics-food');

  await viewTab(page, fr.logisticsViewVolunteering).click();
  const volunteering = view(page, fr.logisticsViewVolunteering);
  const choice = label => volunteering.getByRole('listitem').filter({ has: page.getByRole('heading', { name: label }) });
  await expect(choice(fr.volunteeringCookMeal)).toContainText(fr.logisticsPartiesCount.replace('{n}', 2));
  await expect(choice(fr.volunteeringCookMeal)).toContainText(MEMBER);
  await expect(choice(fr.volunteeringCookMeal)).toContainText(ADMIN);
  await expect(choice(fr.volunteeringOther)).toContainText('Jongler au feu');
  await expect(choice(fr.volunteeringPharmacy)).toContainText(fr.volunteeringNobody);
  await expect(volunteering.getByRole('heading', { level: 3 }).first()).toContainText(`1. ${fr.volunteeringFoodPurchase}`);
  await screenshot(page, 'logistics-volunteering');

  await viewTab(page, fr.logisticsViewTransport).click();
  const transport = view(page, fr.logisticsViewTransport);
  const rows = transport.getByRole('listitem');
  // The parties with neither an offer nor a need aren't listed.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(MEMBER);
  await expect(rows.nth(0)).toContainText(fr.transportKindOffer);
  await expect(rows.nth(0)).toContainText(`${fr.transportSeatsOffered}3`);
  await expect(rows.nth(0)).toContainText('10 juillet 2026');
  await expect(rows.nth(0)).toContainText('12 juillet 2026');
  await expect(rows.nth(1)).toContainText(ADMIN);
  await expect(rows.nth(1)).toContainText(fr.transportKindNeed);
  // Saved without a count: a seat for each of the party's attendees.
  await expect(rows.nth(1)).toContainText(`${fr.transportSeatsNeeded}1`);
  await expect(rows.nth(1)).toContainText(`${fr.transportArrival}${fr.emptyValue}`);
  await expect(transport.getByText(waitlisted.fullName)).toHaveCount(0);
  await screenshot(page, 'logistics-transport');

  await viewTab(page, fr.logisticsViewComments).click();
  const comments = view(page, fr.logisticsViewComments);
  const music = comments.getByRole('list', { name: fr.musicRequests });
  await expect(music.getByRole('listitem')).toHaveCount(1);
  await expect(music).toContainText(MEMBER);
  await expect(music.getByText('Daft Punk Justice')).toBeVisible();
  const messages = comments.getByRole('list', { name: fr.messageToOrganizers });
  await expect(messages.getByRole('listitem')).toHaveCount(1);
  await expect(messages).toContainText('Merci pour tout!');
  await expect(comments.getByText('en attente')).toHaveCount(0);
  await screenshot(page, 'logistics-comments');
});

test('on a phone the views fit: the sub-navigation scrolls on its own, never the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/logistics/transport');
  await expectView(page, fr.logisticsViewTransport);
  await screenshot(page, 'logistics-phone-transport');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  // The last view is reachable: brought into sight, then chosen.
  const comments = viewTab(page, fr.logisticsViewComments);
  await comments.scrollIntoViewIfNeeded();
  await comments.click();
  await expectView(page, fr.logisticsViewComments);
  expect(await fits()).toBe(true);
  // Arrow keys move along the phone's view tabs, End to the last, Home back to the first.
  await page.keyboard.press('Home');
  await expectView(page, fr.logisticsViewTitle);
  await expect(viewTab(page, fr.logisticsViewTitle)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expectView(page, fr.logisticsViewFood);
  await page.keyboard.press('End');
  await expectView(page, fr.logisticsViewComments);
  // The phone bar calls Logistique « Gestion ».
  await expect(sectionLink(page, fr.adminTabLogistics).getByText(fr.adminTabLogisticsShort, { exact: true })).toBeVisible();
});

test('a member opening a Logistique view is blocked', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/logistics/food');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(adminNav(page)).toHaveCount(0);
  await expect(page.getByText('Pas de coriandre')).toHaveCount(0);
});

test('needing a lift counts the seats, starting at the party\'s size; the admin sees them', async ({ page, browser }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await expect(page.getByLabel(fr.fullNameLabel).first()).not.toHaveValue('');
  await page.getByRole('navigation', { name: fr.registrationStepsLabel }).getByRole('button', { name: new RegExp(fr.stepHelp) }).click();

  await page.locator('label').filter({ hasText: fr.transportTypeNeed }).click();
  await expect(page.getByRole('radio', { name: fr.transportTypeNeed })).toBeChecked();
  const seats = page.getByRole('group', { name: fr.transportSeatsNeededLabel });
  // Two attendees: two seats to begin with.
  await expect(seats.locator('output')).toHaveText('2');
  await seats.getByRole('button', { name: fr.stepperMore }).click();
  await expect(seats.locator('output')).toHaveText('3');
  await page.getByRole('button', { name: fr.saveChangesButton }).click();

  await expect.poll(async () => (await getParty(seeded.partyId)).transport).toMatchObject({ type: 'need', seats: 3 });
  await expect(page.getByText(`${fr.transportTypeNeed}, ${fr.transportSeatsShort.replace('{count}', 3)}`)).toBeVisible();

  const admin = await browser.newPage();
  await loginAs(admin, TEST_USERS.admin);
  await admin.goto('/admin/logistics/transport');
  const row = view(admin, fr.logisticsViewTransport).getByRole('listitem').filter({ hasText: MEMBER });
  await expect(row).toContainText(fr.transportKindNeed);
  await expect(row).toContainText(`${fr.transportSeatsNeeded}3`);
  await admin.close();
});
