// « Voir comme » (#267, ADR 0025): an admin opens a member's real, read-only session in a new tab,
// from the « Inscription » dialog or the header's « Voir comme… ». The tab shows what the member
// sees (their RLS), with a banner; every write is refused; « Quitter », a reload or the 30 minutes
// end it; the admin's own tab is untouched; « Équipe » logs it. Needs the local stack's
// `impersonate` Edge Function and the custom access token hook (supabase/config.toml).
//
// E2E_SCREENSHOT_DIR=<dir> saves the dialog, the tab with its banner, the picker and the log at
// 390 and 1440 px wide.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adminMain, adminNav, openPartyDetail } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  MEMBER_ID,
  addParty,
  createThrowawayMember,
  deleteParty,
  deleteThrowawayMember,
  endOpenImpersonations,
  getImpersonationLog,
  getParty,
  grantEditionRoles,
  insertPendingImpersonation,
  revokeEditionRoles,
  seedActiveEventWithMemberParty,
  seedEmailLog,
  teardownActiveEventWithMemberParty
} from './support/testData.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// The specs share the single active e2e event and the member's pending « Voir comme » slot.
test.describe.configure({ mode: 'serial' });

const MEMBER_NAME = 'Test Member';
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

let seeded;
let other;

test.beforeEach(async () => {
  await endOpenImpersonations();
  seeded = await seedActiveEventWithMemberParty();
  await grantEditionRoles(seeded.eventId);
  await seedEmailLog(seeded.partyId, [{ template: 'registration', status: 'sent', recipient: 'member@test.local' }]);
  // Someone else's registration, which the member's session must not see.
  other = (await createThrowawayMember('voir-comme')).id;
  await addParty(other, seeded.eventId);
});

test.afterEach(async () => {
  await endOpenImpersonations();
  if (other) await deleteThrowawayMember(other);
  if (seeded) {
    await revokeEditionRoles(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
  other = null;
});

const banner = page => page.getByRole('status', { name: fr.voirCommeBannerLabel });
const accountMenu = page => page.locator('header button[aria-haspopup="menu"]');
const viewAsButton = dialog => dialog.getByRole('button', { name: fr.voirCommeAction, exact: true });

// The « Inscription » of the member, then « Voir comme »: the new tab, once its session is open.
async function viewAsFromInscrits(page, name = MEMBER_NAME) {
  await page.goto('/admin/users');
  const dialog = await openPartyDetail(page, name);
  const [tab] = await Promise.all([page.context().waitForEvent('page'), viewAsButton(dialog).click()]);
  return { tab, dialog };
}

async function shoot(page, name, widths = [1440, 390]) {
  if (!SHOTS) return;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('admin: the member\'s own app in a new tab, read-only, while the admin tab stays the admin', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  const { tab, dialog } = await viewAsFromInscrits(page);
  await shoot(page, 'inscription-dialog-admin');

  // The banner, on every page of the tab, and no token in the URL.
  await expect(banner(tab)).toContainText(fr.voirCommeBannerViewing.replace('{name}', MEMBER_NAME));
  await expect(banner(tab)).toContainText(fr.voirCommeReadOnly);
  await expect(banner(tab)).toContainText(fr.voirCommeMinutesLeft.replace('{minutes}', '30'));
  expect(new URL(tab.url()).pathname).toBe('/');
  expect(tab.url()).not.toMatch(/token/i);

  // The member's Pass and « Courriels », no « Admin ».
  await expect(tab.getByRole('article', { name: fr.passLabel })).toBeVisible();
  await expect(tab.getByRole('heading', { name: fr.emailsTitle })).toBeVisible();
  await expect(tab.getByRole('link', { name: fr.navAdmin })).toHaveCount(0);
  await shoot(tab, 'voir-comme-tab-member');
  // In-app navigation keeps the session (a reload or a typed URL ends it, see below).
  await tab.getByRole('link', { name: fr.navInfo }).click();
  await expect(tab).toHaveURL(/\/event-details$/);
  await expect(banner(tab)).toBeVisible();
  await tab.getByRole('link', { name: fr.homeLinkLabel }).click();

  // Nothing of other members: the tab's client reads with the member's RLS.
  const owners = await tab.evaluate(async () => {
    const { data, error } = await window.__supabase.from('user_parties').select('user_id');
    if (error) throw new Error(error.message);
    return [...new Set(data.map(row => row.user_id))];
  });
  expect(owners).toEqual([MEMBER_ID]);
  const claims = await tab.evaluate(async () => {
    const { data } = await window.__supabase.auth.getSession();
    return JSON.parse(atob(data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  });
  expect(claims.sub).toBe(MEMBER_ID);
  expect(claims.impersonated_by).toBe(ADMIN_ID);

  // The account menu: « Quitter », no account deletion, no « Voir comme… ».
  await accountMenu(tab).click();
  await expect(tab.getByRole('menuitem', { name: fr.voirCommeQuit })).toBeVisible();
  await expect(tab.getByRole('menuitem', { name: fr.deleteAccount })).toHaveCount(0);
  await expect(tab.getByRole('menuitem', { name: fr.voirCommeMenuItem })).toHaveCount(0);
  await expect(tab.getByRole('menuitem', { name: fr.signOut })).toHaveCount(0);
  await tab.keyboard.press('Escape');

  // Cancelling is refused, in French, and nothing changed.
  await tab.getByRole('button', { name: fr.cancelRegistration }).click();
  await tab.getByRole('dialog', { name: fr.cancelRegistrationConfirmTitle }).getByRole('button', { name: fr.cancelRegistration }).click();
  await expect(tab.getByText(fr.dbErrorReadOnlyImpersonation).first()).toBeVisible();
  expect((await getParty(seeded.partyId)).status).toBe('registered');

  // Saving the registration is refused too.
  await tab.getByRole('article', { name: fr.passLabel }).getByRole('button', { name: fr.editRegistration }).click();
  await tab.getByRole('button', { name: fr.removeAttendeeLabel.replace('{name}', 'Bob E2E') }).click();
  await tab.getByRole('button', { name: fr.saveChangesButton }).click();
  await expect(tab.getByRole('main').getByText(fr.dbErrorReadOnlyImpersonation).first()).toBeVisible();
  expect((await getParty(seeded.partyId)).attendees).toHaveLength(2);

  // The first tab is still the admin, after a reload too.
  await expect(dialog).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: fr.navAdmin })).toBeVisible();
  const adminEmail = await page.evaluate(async () => (await window.__supabase.auth.getUser()).data.user?.email);
  expect(adminEmail).toBe(TEST_USERS.admin.email);

  // « Quitter » ends the session and closes the tab.
  const [row] = await getImpersonationLog(MEMBER_ID);
  expect(row.admin_id).toBe(ADMIN_ID);
  expect(row.session_id).toBe(claims.session_id);
  expect(row.ended_at).toBeNull();
  await expect(banner(tab)).toBeVisible();
  const closed = tab.waitForEvent('close');
  await banner(tab).getByRole('button', { name: fr.voirCommeQuit }).click();
  await closed;
  expect((await getImpersonationLog(MEMBER_ID))[0].ended_at).not.toBeNull();

  // « Équipe » logs it.
  await page.goto('/admin/team');
  const log = adminMain(page).getByRole('list', { name: fr.voirCommeLogTitle });
  const entry = log.getByRole('listitem').first();
  await expect(entry).toContainText(fr.voirCommeLogLine.replace('{admin}', 'Test Admin').replace('{person}', MEMBER_NAME));
  await expect(entry).toContainText(fr.voirCommeLogEnded.replace('{time}', ''));
  if (SHOTS) {
    await adminMain(page).getByRole('heading', { name: fr.voirCommeLogTitle }).scrollIntoViewIfNeeded();
    await shoot(page, 'equipe-log-admin', [1440, 390, 2560]);
  }

  // The member's own sign-in isn't affected.
  const memberPage = await page.context().browser().newPage();
  await loginAs(memberPage, TEST_USERS.member);
  await expect(memberPage.getByRole('article', { name: fr.passLabel })).toBeVisible();
  await expect(banner(memberPage)).toHaveCount(0);
  await memberPage.close();
});

test('« Voir comme » is for admins only, on non-admin accounts', async ({ page }) => {
  const adminParty = await addParty(ADMIN_ID, seeded.eventId);
  try {
    await adminsOnly(page);
  } finally {
    await deleteParty(adminParty);
  }
});

async function adminsOnly(page) {
  for (const user of [TEST_USERS.committee, TEST_USERS.organiser]) {
    await loginAs(page, user);
    await page.goto('/admin/users');
    const dialog = await openPartyDetail(page);
    await expect(dialog.getByRole('button', { name: fr.partyDetailViewProfile })).toBeVisible();
    await expect(viewAsButton(dialog)).toHaveCount(0);
    await dialog.getByRole('button', { name: fr.close, exact: true }).click();
    await accountMenu(page).click();
    await expect(page.getByRole('menuitem', { name: fr.about })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: fr.voirCommeMenuItem })).toHaveCount(0);
  }

  await loginAs(page, TEST_USERS.member);
  await accountMenu(page).click();
  await expect(page.getByRole('menuitem', { name: fr.about })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: fr.voirCommeMenuItem })).toHaveCount(0);

  // An admin's own registration: no « Voir comme ».
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/users');
  const dialog = await openPartyDetail(page, 'Test Admin');
  await expect(viewAsButton(dialog)).toHaveCount(0);
  await dialog.getByRole('button', { name: fr.close, exact: true }).click();
  await expect(viewAsButton(await openPartyDetail(page))).toBeVisible();
}

test('the header\'s « Voir comme… »: Comité accounts, admins not choosable; the tab is Comité\'s read-only admin', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: fr.voirCommeMenuItem }).click();
  const picker = page.getByRole('dialog', { name: fr.voirCommePickerTitle });
  await expect(picker.getByRole('listitem').filter({ hasText: TEST_USERS.member.email })).toBeVisible();
  await shoot(page, 'voir-comme-picker-admin');

  const chip = name => picker.getByRole('radio', { name, exact: true });
  const rows = picker.getByRole('listitem');
  await chip(fr.accountLevelAdminShort).check({ force: true });
  await expect(rows.filter({ hasText: TEST_USERS.admin.email }).getByRole('button')).toBeDisabled();
  for (const button of await rows.getByRole('button').all()) await expect(button).toBeDisabled();

  await chip(fr.editionRoleCommittee).check({ force: true });
  await expect(rows.locator('.font-data.text-xs')).toHaveText([TEST_USERS.committee.email]);
  const [tab] = await Promise.all([page.context().waitForEvent('page'), rows.getByRole('button').click()]);
  await expect(picker).toHaveCount(0);

  await expect(banner(tab)).toContainText(fr.voirCommeBannerViewing.replace('{name}', 'Test Comité'));
  await tab.getByRole('link', { name: fr.navAdmin }).click();
  await expect(adminNav(tab).getByRole('link', { name: fr.adminTabUsers })).toBeVisible();
  await expect(adminNav(tab).getByRole('link', { name: fr.adminTabBudget })).toHaveCount(0);
  await expect(banner(tab)).toBeVisible();
  await shoot(tab, 'voir-comme-tab-committee', [1440, 390, 2560]);

  // The header's « Se déconnecter » is « Quitter » there.
  const closed = tab.waitForEvent('close');
  await accountMenu(tab).click();
  await tab.getByRole('menuitem', { name: fr.voirCommeQuit }).click();
  await closed;
});

test('a member already being opened: the tab says so, and « Réessayer » works once it is free', async ({ page }) => {
  await insertPendingImpersonation(ADMIN_ID, MEMBER_ID);
  const rowsBefore = (await getImpersonationLog(MEMBER_ID)).length;
  await loginAs(page, TEST_USERS.admin);
  const { tab } = await viewAsFromInscrits(page);
  await expect(tab.getByRole('heading', { name: fr.voirCommeStartFailedTitle })).toBeVisible();
  await expect(tab.getByRole('alert')).toHaveText(fr.dbErrorImpersonationTargetPending);
  await shoot(tab, 'voir-comme-error-admin');
  // Refused before anything was written.
  expect(await getImpersonationLog(MEMBER_ID)).toHaveLength(rowsBefore);

  await endOpenImpersonations();
  await tab.getByRole('button', { name: fr.retry }).click();
  await expect(banner(tab)).toContainText(MEMBER_NAME);
});

test('reloading the tab ends the session; so does closing it', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  let { tab } = await viewAsFromInscrits(page);
  await expect(banner(tab)).toBeVisible();
  await tab.reload();
  await expect(tab.getByRole('heading', { name: fr.voirCommeEndedTitle })).toBeVisible();
  await expect(tab.getByText(fr.voirCommeEndedLeft.replace('{name}', MEMBER_NAME))).toBeVisible();
  await shoot(tab, 'voir-comme-ended-admin');
  await expect.poll(async () => (await getImpersonationLog(MEMBER_ID))[0].ended_at).not.toBeNull();

  // « Revenir à mon compte »: the tab is the admin's own app again.
  await tab.getByRole('button', { name: fr.voirCommeBackToMyAccount }).click();
  await expect(tab.getByRole('link', { name: fr.navAdmin })).toBeVisible();
  await expect(banner(tab)).toHaveCount(0);
  await tab.close();

  await page.locator('dialog[open]').getByRole('button', { name: fr.close, exact: true }).click();
  ({ tab } = await viewAsFromInscrits(page));
  await expect(banner(tab)).toBeVisible();
  await tab.close({ runBeforeUnload: true });
  await expect.poll(async () => (await getImpersonationLog(MEMBER_ID))[0].ended_at).not.toBeNull();
});

test('after its 30 minutes the tab says the session is over', async ({ page }) => {
  await page.clock.install();
  await loginAs(page, TEST_USERS.admin);
  const { tab } = await viewAsFromInscrits(page);
  await expect(banner(tab)).toContainText(fr.voirCommeMinutesLeft.replace('{minutes}', '30'));
  await tab.clock.fastForward('29:30');
  await expect(banner(tab)).toContainText(fr.voirCommeLessThanAMinute);
  await tab.clock.fastForward('01:00');
  await expect(tab.getByText(fr.voirCommeEndedExpired.replace('{name}', MEMBER_NAME))).toBeVisible();
  await expect(banner(tab)).toHaveCount(0);
});
