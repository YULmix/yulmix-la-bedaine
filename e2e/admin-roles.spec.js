// Edition roles (#217, ADR 0023): member < Comité < Organisateur (per edition) < admin. Each role
// sees exactly its sections and views, a URL it may not open goes to the first one it may, and the
// actions it may not take aren't on screen. An organiser marks a payment and saves a place; an
// admin grants, changes and removes a role in « Équipe », and sees each in the log.
//
// E2E_SCREENSHOT_DIR=<dir> saves « Équipe » at 390 and 1440 px wide.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adminMain, adminNav, moreButton, openPartyDetail } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  COMMITTEE_ID,
  MEMBER_ID,
  ORGANISER_ID,
  deleteLocations,
  addParty,
  assignPlace,
  createAccounts,
  createThrowawayMember,
  deleteParty,
  deleteAccounts,
  deleteThrowawayMember,
  ensureOtherEvent,
  ensureRootAdmin,
  rpcAs,
  setEventMaxAttendees,
  setIsAdminFlag,
  deleteVenueGalleries,
  getEditionRole,
  getLocations,
  getParty,
  grantEditionRoles,
  revokeEditionRoles,
  seedActiveEventWithMemberParty,
  seedEmailLog,
  seedGallery,
  seedPlaces,
  setPartyAnswers,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { pickPlace } from './support/placePicker.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const MEMBER_NAME = 'Test Member';
const ALICE = 'Alice E2E';

let seeded;

test.beforeEach(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
  await grantEditionRoles(seeded.eventId);
  // The venue's assignments gallery (Comité and above) and an email to follow up (Organisateur and above).
  await seedGallery(seeded.eventId, { kind: 'assignments' }, 1);
  await seedEmailLog(seeded.partyId, [{ template: 'payment', status: 'failed', recipient: 'member@test.local', error: 'e2e' }]);
});

test.afterEach(async () => {
  await setIsAdminFlag(ORGANISER_ID, false);
  if (seeded) {
    await revokeEditionRoles(seeded.eventId);
    await deleteVenueGalleries(seeded.eventId);
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

const panel = page => adminMain(page);
const navLinks = page => adminNav(page).getByRole('link');
const sectionNames = (...keys) => keys.map(key => fr[key]);
const assignmentsGallery = page => page.getByRole('button', {
  name: fr.galleryOpen.replace('{name}', `E2E Venue · ${fr.galleryVenueAssignmentsTitle}`).replace('{count}', 1)
});
const picker = page => panel(page).getByRole('list', { name: fr.teamSearchLabel });
const emailProblems = page => panel(page).getByText(fr.emailProblemsTitleOne.replace('{count}', 1));

// A party's finances (#290, ADR 0026): what Comité never receives.
const FINANCES = ['payment_status', 'calculated_amount_owed', 'locked_selling_price_whole_event', 'locked_ratio_main_whole'];
const MONEY = /\d\s?\$/;

// Every row the page receives from user_parties, registration_edits and edition_parties(), with
// the user it is about: Comité must get the finances of none but their own.
function recordParties(page) {
  const rows = [];
  page.on('response', async response => {
    if (!/\/rest\/v1\/(user_parties|registration_edits|rpc\/edition_parties)/.test(response.url())) return;
    const body = await response.json().catch(() => null);
    for (const row of [body].flat()) if (row && typeof row === 'object') rows.push({ url: response.url(), row });
  });
  return rows;
}

// E2E_SCREENSHOT_DIR: the page at each width, then back to the size it had.
async function shoot(page, name, widths = [1440, 390]) {
  if (!process.env.E2E_SCREENSHOT_DIR) return;
  const before = page.viewportSize();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize(before);
}

// The profile dialog, opened from a Logistique card.
async function openProfileFromLogistics(page, name = MEMBER_NAME) {
  await page.goto('/admin/logistics');
  await panel(page).getByRole('button', { name, exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: fr.userProfileModalTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: fr.userProfileEventHistory })).toBeVisible();
  return dialog;
}

// The admin, entered from the header's « Admin » link, as a person would.
async function enterAdmin(page) {
  await page.getByRole('link', { name: fr.navAdmin }).click();
  await expect(page).toHaveURL(/\/admin\/overview$/);
}

// The sidebar's section links (and, under the current section, its views').
async function expectSidebar(page, names) {
  await expect(navLinks(page)).toHaveText(names);
}

// A URL the role may not open lands on Résumé (or `target`), replacing it in the history.
async function expectRedirected(page, path, target = /\/admin\/overview$/) {
  await page.goto('/admin/overview');
  await page.goto(path);
  await expect(page).toHaveURL(target);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/overview$/);
}

// Every page title (h1) the tab shows from now on, even for one frame, across page loads (kept in
// sessionStorage): returns a reader.
async function watchHeadings(page) {
  await page.addInitScript(() => {
    const KEY = 'e2e-headings';
    new MutationObserver(() => {
      const seen = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      for (const h1 of document.querySelectorAll('h1')) seen.push(h1.textContent);
      sessionStorage.setItem(KEY, JSON.stringify(seen));
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-headings') || '[]'));
}

test('member: no « Admin » entry, and the admin says it is restricted', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await expect(page.getByRole('link', { name: fr.navAdmin })).toHaveCount(0);
  await page.goto('/admin/logistics');
  await expect(page.getByText(fr.adminOnlyAccessMessage)).toBeVisible();
  await expect(adminNav(page)).toHaveCount(0);
});

// The level on the badge (#260): a ring in the level's tone, the label in the menu, and the level in
// the button's accessible name. Members have none. E2E_SCREENSHOT_DIR saves the badge and its menu.
const LEVELS = [
  ['member', null, null],
  ['committee', 'committee', fr.editionRoleCommittee],
  ['organiser', 'organiser', fr.editionRoleOrganiser],
  ['admin', 'admin', fr.editionRoleAdmin]
];
for (const [user, level, label] of LEVELS) {
  test(`${user}: level ${label ?? 'none'} on the badge and in the menu`, async ({ page }) => {
    await loginAs(page, TEST_USERS[user]);
    const account = page.locator('header button[aria-haspopup="menu"]');
    const avatar = account.locator('[aria-hidden="true"]').first();
    await expect(account).toBeVisible();
    if (level) {
      await expect(avatar).toHaveAttribute('data-level', level);
      await expect(account).toHaveAccessibleName(new RegExp(`, ${label}$`));
    } else {
      await expect(avatar).not.toHaveAttribute('data-level', /.*/);
      await expect(account).not.toHaveAccessibleName(/, (Administrateur|Organisateur|Comité)$/);
    }
    const ring = await avatar.evaluate(el => getComputedStyle(el).boxShadow);
    expect(ring === 'none' || ring === '').toBe(!level);
    await account.click();
    if (level) await expect(page.getByTestId('account-level')).toHaveText(label);
    else await expect(page.getByTestId('account-level')).toHaveCount(0);
    if (process.env.E2E_SCREENSHOT_DIR) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/header-${user}-${width}.png`, clip: { x: 0, y: 0, width, height: 300 } });
      }
    }
  });
}

test('Comité: reads Résumé, Participants and Logistique, and changes nothing', async ({ page }) => {
  // A place and a note on the member's party: Comité reads both (#290: through edition_parties()).
  const [room] = await getLocations(seeded.eventId);
  await assignPlace(room.places.find(place => place.label === 'Lit A').id, seeded.partyId, 1);
  await setPartyAnswers(seeded.partyId, { admin_notes: 'Note E2E' });
  const received = recordParties(page);
  await loginAs(page, TEST_USERS.committee);
  await enterAdmin(page);
  await expectSidebar(page, sectionNames('adminTabOverview', 'adminTabParticipants', 'adminTabLogistics'));
  // Résumé without the budget card, nor « Groupes payés » (#290).
  await expect(panel(page).getByRole('heading', { name: fr.kpiTiersTitle, exact: true })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: fr.budgetTitle, exact: true })).toHaveCount(0);
  await expect(panel(page).getByText(fr.registeredGroupsStatLabel)).toBeVisible();
  await expect(panel(page).getByText(fr.kpiPaidGroups)).toHaveCount(0);
  // Nor the prices per tier, nor any other amount.
  await expect(panel(page).getByRole('heading', { name: fr.tierPricesTitle })).toHaveCount(0);
  await expect(panel(page).getByText(MONEY)).toHaveCount(0);
  await shoot(page, 'resume-committee', [1440, 390, 2560]);
  // Nor the emails to follow up: those are Organisateur's.
  await expect(emailProblems(page)).toHaveCount(0);

  // « Participants » is a section of its own (#291), first after Résumé: every attendee, read-only.
  await adminNav(page).getByRole('link', { name: fr.adminTabParticipants, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/participants$/);
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabParticipants })).toBeVisible();
  for (const name of [ALICE, 'Bob E2E']) await expect(panel(page).getByRole('row').filter({ hasText: name })).toBeVisible();
  await expect(panel(page).getByText(MONEY)).toHaveCount(0);
  await expect(page.getByRole('button', { name: fr.adminExportAction })).toHaveCount(0);
  // No Inscrits, nor its views, anywhere in the navigation.
  for (const name of [fr.adminTabUsers, fr.usersViewList, fr.usersViewHistory]) {
    await expect(adminNav(page).getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  await shoot(page, 'participants-committee', [1440, 390, 2560]);

  // Every Inscrits URL lands on « Participants », replacing it, and never shows « Liste » on the way.
  const headings = await watchHeadings(page);
  for (const path of ['/admin/users', '/admin/users/list', '/admin/users/participants', '/admin/users/history']) {
    await expectRedirected(page, path, /\/admin\/participants$/);
  }
  expect((await headings()).filter(text => text.includes(fr.adminTabUsers))).toEqual([]);

  // Logistique: every view; places, notes and messages read-only, no Save.
  await page.goto('/admin/logistics');
  await expect(panel(page).getByText(fr.logisticsNoPlaceAssigned).first()).toBeVisible();
  await expect(panel(page).getByText('Chambre 1 · Lit A', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('Note E2E', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
  await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: fr.save, exact: true })).toHaveCount(0);
  await expect(assignmentsGallery(page)).toBeVisible();
  for (const view of ['logisticsViewFood', 'logisticsViewVolunteering', 'logisticsViewTransport', 'logisticsViewComments']) {
    await expect(adminNav(page).getByRole('link', { name: fr[view] })).toBeVisible();
  }

  // The profile dialog, from Logistique: the member's registration, without its payment or amount.
  const profile = await openProfileFromLogistics(page);
  await expect(profile.getByText(fr.statusRegistered, { exact: true })).toBeVisible();
  await expect(profile.getByText(fr.unpaidShort, { exact: true })).toHaveCount(0);
  await expect(profile.getByText(fr.paid, { exact: true })).toHaveCount(0);
  await expect(profile.getByText(MONEY)).toHaveCount(0);
  await shoot(page, 'profile-committee');
  await profile.getByRole('button', { name: fr.close, exact: true }).click();

  for (const path of ['/admin/budget', '/admin/events', '/admin/venues', '/admin/team', '/admin/feedback']) {
    await expectRedirected(page, path);
  }

  // The parties came through edition_parties(), none with its finances; user_parties and
  // registration_edits gave Comité (not registered here) no row at all (#290).
  expect(received.some(({ url }) => url.includes('/rpc/edition_parties'))).toBe(true);
  expect(received.filter(({ url }) => !url.includes('/rpc/edition_parties'))).toEqual([]);
  const withFinances = received.filter(({ row }) => FINANCES.some(column => column in row));
  expect(withFinances.filter(({ row }) => row.user_id !== COMMITTEE_ID)).toEqual([]);
});

test('Comité who registered: their own Pass shows the amount; « Participants » lists their party without it (#290)', async ({ page }) => {
  const own = await addParty(COMMITTEE_ID, seeded.eventId);
  try {
    await loginAs(page, TEST_USERS.committee);
    await page.goto('/');
    const pass = page.getByRole('article', { name: fr.passLabel });
    await expect(pass.getByText(fr.amountDue, { exact: true })).toBeVisible();
    await expect(pass.getByText(MONEY).first()).toBeVisible();

    await page.goto('/admin/participants');
    await expect(panel(page).getByRole('row').filter({ hasText: 'Test Comité' }).first()).toBeVisible();
    await expect(panel(page).getByText(MONEY)).toHaveCount(0);
    await expect(panel(page).getByText(fr.unpaidShort, { exact: true })).toHaveCount(0);
  } finally {
    await deleteParty(own);
  }
});

// The payment changed elsewhere (another tab, another organiser) shows without a reload: the
// store's user_parties channel is live now that the table is in supabase_realtime (#296).
for (const [role, other] of [['organiser', 'admin'], ['admin', 'organiser']]) {
  test(`${role}: Liste's amounts and payment; ${other} marking it paid elsewhere shows live (#290, #296)`, async ({ page }) => {
    await loginAs(page, TEST_USERS[role]);
    await page.goto('/admin/users');
    await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toBeVisible();
    await expect(panel(page).getByText(fr.amountDue)).toBeVisible();
    await expect(panel(page).getByText(MONEY).locator('visible=true').first()).toBeVisible();
    await expect(panel(page).getByRole('button', { name: fr.unpaidShort, exact: true })).toBeVisible();
    expect(await rpcAs(TEST_USERS[other], 'set_payment_status', { p_party_id: seeded.partyId, p_payment_status: 'paid' })).toBeNull();
    await expect(panel(page).getByRole('button', { name: fr.paid, exact: true })).toBeVisible({ timeout: 30000 });
  });
}

for (const role of ['organiser', 'admin']) {
  test(`${role}: Résumé's « Groupes payés » and the profile dialog's payment and amount still show (#290)`, async ({ page }) => {
    await loginAs(page, TEST_USERS[role]);
    await page.goto('/admin/overview');
    await expect(panel(page).getByText(fr.kpiPaidGroups)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: fr.tierPricesTitle })).toBeVisible();
    await shoot(page, `resume-${role}`, [1440, 390, 2560]);
    const profile = await openProfileFromLogistics(page);
    await expect(profile.getByText(fr.unpaidShort, { exact: true })).toBeVisible();
    await expect(profile.getByText(MONEY)).toBeVisible();
    await shoot(page, `profile-${role}`);
  });
}

test('Organisateur: plus Budget, Historique and the export; marks a payment and saves a place', async ({ page }) => {
  await loginAs(page, TEST_USERS.organiser);
  await enterAdmin(page);
  await expectSidebar(page, sectionNames('adminTabOverview', 'adminTabUsers', 'adminTabLogistics', 'adminTabBudget'));
  await expect(panel(page).getByRole('heading', { name: fr.budgetTitle, exact: true })).toBeVisible();
  // No top-level « Participants » (Comité's, #291): its URL lands on Inscrits' view.
  await expectRedirected(page, '/admin/participants', /\/admin\/users\/participants$/);
  await expect(emailProblems(page)).toBeVisible();
  // The list names the party; opening it is the admin's god-mode editor.
  await panel(page).getByRole('button', { name: fr.emailProblemsShow }).click();
  await expect(panel(page).locator('#email-problems-list')).toContainText(MEMBER_NAME);
  await expect(panel(page).getByRole('button', { name: fr.emailProblemsOpenParty })).toHaveCount(0);

  // Inscrits: the payment toggle and the export, but neither the editor nor the admin flag.
  await page.goto('/admin/users');
  await expect(page.getByRole('button', { name: fr.adminExportAction })).toBeVisible();
  await expect(adminNav(page).getByRole('link', { name: fr.usersViewHistory })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(0);
  await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
  // The registration opens read-only with the email log (the seeded failed email), never « Modifier ».
  const detail = await openPartyDetail(page);
  await expect(detail.getByText(fr.emailLogTitle)).toBeVisible();
  await expect(detail.getByText('e2e', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: fr.edit, exact: true })).toHaveCount(0);
  if (process.env.E2E_SCREENSHOT_DIR) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/inscription-organiser-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await detail.getByRole('button', { name: fr.close, exact: true }).click();
  await panel(page).getByRole('button', { name: fr.unpaidShort, exact: true }).click();
  const confirm = page.getByRole('dialog', { name: fr.markPaid });
  await confirm.getByRole('button', { name: fr.markPaid }).click();
  await expect(panel(page).getByRole('button', { name: fr.paid, exact: true })).toBeVisible();
  await expect.poll(async () => (await getParty(seeded.partyId)).payment_status).toBe('paid');

  // Logistique: assign a place and save it.
  await page.goto('/admin/logistics');
  await expect(assignmentsGallery(page)).toBeVisible();
  const picker = panel(page).getByRole('combobox', { name: `${fr.logisticsTableSleepingAssigned}, ${ALICE}` });
  await pickPlace(page, picker, 'Chambre 1 · Lit A');
  await panel(page).getByRole('button', { name: fr.save, exact: true }).click();
  await expect(page.getByText(fr.logisticsAllSavedToast).last()).toBeVisible();
  await expect.poll(async () => (await getParty(seeded.partyId)).attendees[0].place?.bed_label).toBe('Chambre 1 · Lit A');

  // Historique opens on the edition they organise.
  await page.goto('/admin/users/history');
  await expect(page).toHaveURL(/\/admin\/users\/history$/);
  await expect(page.getByRole('combobox', { name: fr.changeHistoryEventLabel })).toBeVisible();

  for (const path of ['/admin/events', '/admin/venues', '/admin/team', '/admin/feedback']) {
    await expectRedirected(page, path);
  }
});

test('admin: grants, changes and removes a role in « Équipe », each in the log', async ({ page }) => {
  await revokeEditionRoles(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/team');
  await expect(page.getByRole('heading', { name: fr.adminTabTeam, level: 1 })).toBeVisible();
  await expect(panel(page).getByText(fr.teamMembersEmpty)).toBeVisible();

  // Grant: Organisateur, found by email. Test Organisateur isn't registered: « Inscrits seulement » hides them until it is off.
  await panel(page).getByLabel(fr.teamAddRoleLabel).selectOption('organiser');
  await panel(page).getByRole('searchbox', { name: fr.teamSearchLabel }).fill('organiser@test');
  await expect(panel(page).getByText(fr.teamSearchEmpty)).toBeVisible();
  await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
  await panel(page).getByRole('searchbox', { name: fr.teamSearchLabel }).fill('organiser@test');
  const add = panel(page).getByRole('button', {
    name: fr.teamAddFor.replace('{role}', fr.editionRoleOrganiser).replace('{name}', 'Test Organisateur')
  });
  await add.click();
  await expect(page.getByText(fr.teamRoleSetToast.replace('{name}', 'Test Organisateur').replace('{role}', fr.editionRoleOrganiser)).last()).toBeVisible();
  await expect.poll(() => getEditionRole(seeded.eventId, ORGANISER_ID)).toBe('organiser');
  const roleSelect = panel(page).getByRole('combobox', { name: fr.teamRoleFor.replace('{name}', 'Test Organisateur') });
  await expect(roleSelect).toHaveValue('organiser');

  // An admin can't be given one.
  await panel(page).getByRole('searchbox', { name: fr.teamSearchLabel }).fill('admin@test');
  await expect(picker(page).getByRole('listitem').filter({ hasText: 'Test Admin' }).getByText(fr.editionRoleAdmin, { exact: true })).toBeVisible();

  // Change: Comité.
  await roleSelect.selectOption('committee');
  await expect.poll(() => getEditionRole(seeded.eventId, ORGANISER_ID)).toBe('committee');

  if (process.env.E2E_SCREENSHOT_DIR) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/equipe-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  // Remove, after confirming.
  await panel(page).getByRole('button', { name: fr.teamRemoveFor.replace('{name}', 'Test Organisateur') }).click();
  await page.getByRole('dialog', { name: fr.teamRemoveTitle }).getByRole('button', { name: fr.teamRemoveTitle }).click();
  await expect(panel(page).getByText(fr.teamMembersEmpty)).toBeVisible();
  await expect.poll(() => getEditionRole(seeded.eventId, ORGANISER_ID)).toBeNull();

  // The log, newest first, names the admin who did each.
  const log = panel(page).getByRole('list', { name: fr.teamLogTitle }).getByRole('listitem');
  const line = (key, values) => Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, v), fr[key]);
  await expect(log.nth(0)).toContainText(line('teamLogRemoved', { actor: 'Test Admin', role: fr.editionRoleCommittee, person: 'Test Organisateur' }));
  await expect(log.nth(1)).toContainText(line('teamLogChanged', { actor: 'Test Admin', person: 'Test Organisateur', old: fr.editionRoleOrganiser, new: fr.editionRoleCommittee }));
  await expect(log.nth(2)).toContainText(line('teamLogGranted', { actor: 'Test Admin', role: fr.editionRoleOrganiser, person: 'Test Organisateur' }));
});

test('admin: Inscrits keeps « Liste », « Participants » and « Historique »; no top-level « Participants » (#291)', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  await expect(adminNav(page).getByRole('link', { name: fr.adminTabUsers, exact: true })).toBeVisible();
  for (const view of ['usersViewList', 'usersViewParticipants', 'usersViewHistory']) {
    await expect(adminNav(page).getByRole('link', { name: fr[view], exact: true })).toHaveCount(1);
  }
  await expectRedirected(page, '/admin/participants', /\/admin\/users\/participants$/);
  await shoot(page, 'nav-admin');
});

test('admin: « Équipe » lists the people with their level; « Inscrits seulement » is on and filters', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/team');
  // The roles help is closed, and has one entry per role.
  const help = panel(page).locator('details');
  await expect(help).not.toHaveAttribute('open', '');
  await help.getByText(fr.teamHelpTitle).click();
  for (const key of ['teamHelpAdmin', 'teamHelpOrganiser', 'teamHelpCommittee']) await expect(help.getByText(fr[key])).toBeVisible();

  // Before typing: the edition's registrants, with their level. Admins are listed above the edition's roles.
  const admins = panel(page).getByRole('list', { name: fr.teamAdminsTitle });
  await expect(admins.getByRole('listitem').filter({ hasText: 'Test Admin' })).toBeVisible();
  const toggle = panel(page).getByRole('switch', { name: fr.teamRegisteredOnly });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(picker(page).getByRole('listitem').filter({ hasText: MEMBER_NAME })).toBeVisible();
  await expect(picker(page).getByRole('listitem').filter({ hasText: 'Test Organisateur' })).toHaveCount(0);
  // Typing narrows; off shows everyone, with their level.
  await panel(page).getByRole('searchbox', { name: fr.teamSearchLabel }).fill('member@');
  await expect(picker(page).getByRole('listitem')).toHaveCount(1);
  await panel(page).getByRole('searchbox', { name: fr.teamSearchLabel }).fill('');
  await toggle.click();
  const organiser = picker(page).getByRole('listitem').filter({ hasText: 'Test Organisateur' });
  await expect(organiser.getByText(fr.editionRoleOrganiser, { exact: true })).toBeVisible();
  await expect(picker(page).getByRole('listitem').filter({ hasText: 'Test Admin' }).getByText(fr.editionRoleAdmin, { exact: true })).toBeVisible();
});

test('admin: grants Admin (replacing the edition roles) and removes it, both in the log of every edition; one\'s own can\'t go', async ({ page }) => {
  // The same person is Organisateur on two editions: A (the active one) and B.
  const otherId = await ensureOtherEvent();
  await grantEditionRoles(otherId);
  try {
    await grantAndRemoveAdmin(page, otherId);
  } finally {
    await revokeEditionRoles(otherId);
  }
});

async function grantAndRemoveAdmin(page, otherId) {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/team');
  await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
  await panel(page).getByLabel(fr.teamAddRoleLabel).selectOption('admin');
  const name = 'Test Organisateur';
  await panel(page).getByRole('button', { name: fr.teamChangeFor.replace('{role}', fr.editionRoleAdmin).replace('{name}', name) }).click();
  const grant = page.getByRole('dialog', { name: fr.teamAdminGrantTitle });
  await expect(grant).toContainText(fr.teamAdminGrantConfirm.replace('{name}', name));
  await grant.getByRole('button', { name: fr.teamAdminGrantTitle }).click();
  await expect(page.getByText(fr.teamAdminGrantedToast.replace('{name}', name)).last()).toBeVisible();

  // In Administrateurs; the edition role is gone (the database drops it).
  const admins = panel(page).getByRole('list', { name: fr.teamAdminsTitle });
  await expect(admins.getByRole('listitem').filter({ hasText: name })).toBeVisible();
  await expect.poll(() => getEditionRole(seeded.eventId, ORGANISER_ID)).toBeNull();
  await expect.poll(() => getEditionRole(otherId, ORGANISER_ID)).toBeNull();
  await expect(panel(page).getByRole('combobox', { name: fr.teamRoleFor.replace('{name}', name) })).toHaveCount(0);

  // One's own flag and the root admin's can't be removed from here.
  const own = fr.teamAdminRemoveFor.replace('{name}', 'Test Admin');
  await expect(panel(page).getByRole('button', { name: own })).toBeDisabled();
  await expect(admins.getByRole('listitem').filter({ hasText: 'Test Admin' })).toContainText(fr.teamAdminRemoveSelf);

  // Remove, after confirming.
  await panel(page).getByRole('button', { name: fr.teamAdminRemoveFor.replace('{name}', name) }).click();
  const removal = page.getByRole('dialog', { name: fr.teamAdminRemoveTitle });
  await removal.getByRole('button', { name: fr.teamAdminRemoveTitle }).click();
  await expect(page.getByText(fr.teamAdminRemovedToast.replace('{name}', name)).last()).toBeVisible();
  await expect(admins.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);

  // The log, newest first: removed, then granted (with the role it dropped under it).
  const log = panel(page).getByRole('list', { name: fr.teamLogTitle }).getByRole('listitem');
  const line = (key, values) => Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, v), fr[key]);
  await expect(log.nth(0)).toContainText(line('teamLogAdminRemoved', { actor: 'Test Admin', person: name }));
  await expect(log.nth(1)).toContainText(line('teamLogAdminGranted', { actor: 'Test Admin', person: name }));
  await expect(log.nth(2)).toContainText(line('teamLogRemoved', { actor: 'Test Admin', role: fr.editionRoleOrganiser, person: name }));

  // Edition B's log has the same, in the same order: its own role removal, and the admin entries.
  await panel(page).getByRole('combobox', { name: fr.teamEditionLabel }).selectOption(otherId);
  await expect(log.nth(0)).toContainText(line('teamLogAdminRemoved', { actor: 'Test Admin', person: name }));
  await expect(log.nth(1)).toContainText(line('teamLogAdminGranted', { actor: 'Test Admin', person: name }));
  await expect(log.nth(2)).toContainText(line('teamLogRemoved', { actor: 'Test Admin', role: fr.editionRoleOrganiser, person: name }));
}

// The picker's three levels of refusal, forced through the real rpc: the request is pointed at
// someone the database protects, and the French message shows.
test('admin: the database refuses one\'s own and the root admin\'s flag, and the toast is French', async ({ page }) => {
  const root = await ensureRootAdmin();
  try {
    await loginAs(page, TEST_USERS.admin);
    await page.goto('/admin/team');
    await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
    await panel(page).getByLabel(fr.teamAddRoleLabel).selectOption('admin');
    const admins = panel(page).getByRole('list', { name: fr.teamAdminsTitle });
    // The root admin's row can't be removed; nor one's own.
    await expect(admins.getByRole('listitem').filter({ hasText: 'yulmixalabedaine@gmail.com' }).getByRole('button')).toBeDisabled();
    await expect(admins.getByRole('listitem').filter({ hasText: 'yulmixalabedaine@gmail.com' })).toContainText(fr.teamAdminRemoveRoot);

    for (const [targetId, message] of [[root.id, fr.dbErrorRootAdminCannotBeDemoted], [ADMIN_ID, fr.selfAdminToggleError]]) {
      // Grant Admin to Test Organisateur, then point the removal at the protected account.
      await picker(page).getByRole('listitem').filter({ hasText: 'Test Organisateur' }).getByRole('button').click();
      await page.getByRole('dialog', { name: fr.teamAdminGrantTitle }).getByRole('button', { name: fr.teamAdminGrantTitle }).click();
      await panel(page).getByRole('button', { name: fr.teamAdminRemoveFor.replace('{name}', 'Test Organisateur') }).click();
      await page.route('**/rpc/admin_set_is_admin', async route => {
        const body = JSON.parse(route.request().postData());
        await route.continue({ postData: JSON.stringify({ ...body, target_user_id: targetId }) });
      }, { times: 1 });
      await page.getByRole('dialog', { name: fr.teamAdminRemoveTitle }).getByRole('button', { name: fr.teamAdminRemoveTitle }).click();
      await expect(page.getByText(message).last()).toBeVisible();
      await setIsAdminFlag(ORGANISER_ID, false);
      await page.reload();
      await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
      await panel(page).getByLabel(fr.teamAddRoleLabel).selectOption('admin');
    }
  } finally {
    if (root.created) await deleteAccounts([root.id]);
  }
});

test('admin: « Inscrits seulement » keeps the waitlisted and drops the cancelled', async ({ page }) => {
  await setEventMaxAttendees(seeded.eventId, 2);
  const waitlisted = await createThrowawayMember('waitlisted');
  const cancelled = await createThrowawayMember('cancelled');
  try {
    await addParty(waitlisted.id, seeded.eventId);
    await addParty(cancelled.id, seeded.eventId, 'cancelled');
    await loginAs(page, TEST_USERS.admin);
    await page.goto('/admin/team');
    const row = person => picker(page).getByRole('listitem').filter({ hasText: person.email });
    await expect(row(waitlisted)).toBeVisible();
    await expect(row(cancelled)).toHaveCount(0);
    await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
    await expect(row(cancelled)).toBeVisible();
    await expect(row(waitlisted)).toBeVisible();
  } finally {
    await deleteThrowawayMember(waitlisted.id);
    await deleteThrowawayMember(cancelled.id);
  }
});

test('admin: past the cap the picker searches on the server, narrowed by « Inscrits seulement »', async ({ page }) => {
  // The listing is answered as if there were more accounts than the cap; the typed searches are real.
  await page.route(/\/rest\/v1\/profiles\?(?!.*\bor=).*limit=201/, route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(Array.from({ length: 201 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, full_name: `Fake ${n}`, email: `fake${n}@x`, is_admin: false })))
  }));
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/team');
  await expect(panel(page).getByText(fr.teamPeopleTooMany)).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  const search = panel(page).getByRole('searchbox', { name: fr.teamSearchLabel });
  // Filter on: the registered member is found, the unregistered organiser isn't.
  await search.fill('member@');
  await expect(picker(page).getByRole('listitem').filter({ hasText: MEMBER_NAME })).toBeVisible();
  await search.fill('organiser@');
  await expect(panel(page).getByText(fr.teamSearchEmpty)).toBeVisible();
  // Filter off: found.
  await panel(page).getByRole('switch', { name: fr.teamRegisteredOnly }).click();
  await expect(picker(page).getByRole('listitem').filter({ hasText: 'Test Organisateur' })).toBeVisible();
});

test('Comité and Organisateur: « Équipe » is out of reach, and admin_set_is_admin is refused', async ({ page }) => {
  for (const user of [TEST_USERS.committee, TEST_USERS.organiser]) {
    await loginAs(page, user);
    await expectRedirected(page, '/admin/team');
    const error = await rpcAs(user, 'admin_set_is_admin', { target_user_id: MEMBER_ID, new_is_admin: true });
    expect(error?.message).toContain('admin_only');
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Comité has three sections in the bar (Résumé, Participants, Logistique) and no « Plus »; Organisateur four', async ({ page }) => {
    await loginAs(page, TEST_USERS.committee);
    await page.goto('/admin/overview');
    await expect(navLinks(page)).toHaveText(sectionNames('adminTabOverviewShort', 'adminTabParticipantsShort', 'adminTabLogisticsShort'));
    await expect(moreButton(page)).toHaveCount(0);
    await shoot(page, 'nav-committee', [390]);
    // « Participants » from the bar: the attendees, no view tabs, no horizontal scroll.
    await navLinks(page).filter({ hasText: fr.adminTabParticipantsShort }).click();
    await expect(page).toHaveURL(/\/admin\/participants$/);
    await expect(panel(page).getByRole('row').filter({ hasText: ALICE })).toBeVisible();
    await expect(navLinks(page).filter({ hasText: fr.adminTabParticipantsShort })).toHaveAttribute('aria-current', 'page');
    await expect(navLinks(page).filter({ hasText: fr.adminTabOverviewShort })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await shoot(page, 'participants-committee-phone', [390]);

    await loginAs(page, TEST_USERS.organiser);
    await page.goto('/admin/overview');
    await expect(navLinks(page)).toHaveText(sectionNames('adminTabOverviewShort', 'adminTabUsersShort', 'adminTabLogisticsShort', 'adminTabBudgetShort'));
    await expect(moreButton(page)).toHaveCount(0);
  });
});
