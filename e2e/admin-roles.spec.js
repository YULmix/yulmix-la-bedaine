// Edition roles (#217, ADR 0023): member < Comité < Organisateur (per edition) < admin. Each role
// sees exactly its sections and views, a URL it may not open goes to the first one it may, and the
// actions it may not take aren't on screen. An organiser marks a payment and saves a place; an
// admin grants, changes and removes a role in « Équipe », and sees each in the log.
//
// E2E_SCREENSHOT_DIR=<dir> saves « Équipe » at 390 and 1440 px wide.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adminMain, adminNav, moreButton } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ORGANISER_ID,
  deleteLocations,
  deleteVenueGalleries,
  getEditionRole,
  getParty,
  grantEditionRoles,
  revokeEditionRoles,
  seedActiveEventWithMemberParty,
  seedEmailLog,
  seedGallery,
  seedPlaces,
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
const emailProblems = page => panel(page).getByText(fr.emailProblemsTitleOne.replace('{count}', 1));

// The admin, entered from the header's « Admin » link, as a person would.
async function enterAdmin(page) {
  await page.getByRole('link', { name: fr.navAdmin }).click();
  await expect(page).toHaveURL(/\/admin\/overview$/);
}

// The sidebar's section links (and, under the current section, its views').
async function expectSidebar(page, names) {
  await expect(navLinks(page)).toHaveText(names);
}

// A URL the role may not open lands on Résumé, replacing it in the history.
async function expectRedirected(page, path) {
  await page.goto('/admin/overview');
  await page.goto(path);
  await expect(page).toHaveURL(/\/admin\/overview$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/overview$/);
}

test('member: no « Admin » entry, and the admin says it is restricted', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await expect(page.getByRole('link', { name: fr.navAdmin })).toHaveCount(0);
  await page.goto('/admin/logistics');
  await expect(page.getByText(fr.adminOnlyAccessMessage)).toBeVisible();
  await expect(adminNav(page)).toHaveCount(0);
});

test('Comité: reads Résumé, the list of Inscrits and Logistique, and changes nothing', async ({ page }) => {
  await loginAs(page, TEST_USERS.committee);
  await enterAdmin(page);
  await expectSidebar(page, sectionNames('adminTabOverview', 'adminTabUsers', 'adminTabLogistics'));
  // Résumé without the budget card.
  await expect(panel(page).getByRole('heading', { name: fr.kpiTiersTitle })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: fr.budgetTitle, exact: true })).toHaveCount(0);
  // Nor the emails to follow up: those are Organisateur's.
  await expect(emailProblems(page)).toHaveCount(0);

  // Inscrits: the list, read-only. The payment is a tag, not a toggle.
  await page.goto('/admin/users');
  await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toBeVisible();
  await expect(panel(page).getByText(fr.unpaidShort, { exact: true }).first()).toBeVisible();
  await expect(panel(page).getByRole('button', { name: fr.unpaidShort, exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(0);
  await expect(panel(page).getByRole('checkbox', { name: fr.adminTableHeader })).toHaveCount(0);
  await expect(page.getByRole('button', { name: fr.adminExportAction })).toHaveCount(0);
  // Only the list: no Historique.
  await expect(adminNav(page).getByRole('link', { name: fr.usersViewHistory })).toHaveCount(0);

  // Logistique: every view; places, notes and messages read-only, no Save.
  await page.goto('/admin/logistics');
  await expect(panel(page).getByText(fr.logisticsNoPlaceAssigned).first()).toBeVisible();
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
  await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: fr.save, exact: true })).toHaveCount(0);
  await expect(assignmentsGallery(page)).toBeVisible();
  for (const view of ['logisticsViewFood', 'logisticsViewVolunteering', 'logisticsViewTransport', 'logisticsViewComments']) {
    await expect(adminNav(page).getByRole('link', { name: fr[view] })).toBeVisible();
  }

  for (const path of ['/admin/budget', '/admin/users/history', '/admin/events', '/admin/venues', '/admin/team', '/admin/feedback']) {
    await expectRedirected(page, path);
  }
});

test('Organisateur: plus Budget, Historique and the export; marks a payment and saves a place', async ({ page }) => {
  await loginAs(page, TEST_USERS.organiser);
  await enterAdmin(page);
  await expectSidebar(page, sectionNames('adminTabOverview', 'adminTabUsers', 'adminTabLogistics', 'adminTabBudget'));
  await expect(panel(page).getByRole('heading', { name: fr.budgetTitle, exact: true })).toBeVisible();
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
  await expect(panel(page).getByRole('checkbox', { name: fr.adminTableHeader })).toHaveCount(0);
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

  // Grant: Organisateur, found by email.
  await panel(page).getByLabel(fr.teamAddRoleLabel).selectOption('organiser');
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
  await expect(panel(page).getByRole('listitem').filter({ hasText: 'Test Admin' }).getByText(fr.teamAdminTag, { exact: true })).toBeVisible();

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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Comité has three sections in the bar and no « Plus »; Organisateur four', async ({ page }) => {
    await loginAs(page, TEST_USERS.committee);
    await page.goto('/admin/overview');
    await expect(navLinks(page)).toHaveText(sectionNames('adminTabOverviewShort', 'adminTabUsersShort', 'adminTabLogisticsShort'));
    await expect(moreButton(page)).toHaveCount(0);

    await loginAs(page, TEST_USERS.organiser);
    await page.goto('/admin/overview');
    await expect(navLinks(page)).toHaveCount(4);
    await expect(moreButton(page)).toHaveCount(0);
  });
});
