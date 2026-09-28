// "Supprimer mon compte" (issue #36): a soft delete from the account menu, refused after the
// registration close date. Uses a throwaway member: a deleted account can't be restored.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  createThrowawayMember,
  deleteThrowawayMember,
  getParty,
  getProfile,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Both tests reseed the one shared active event, so they run one after the other.
test.describe.configure({ mode: 'serial' });

const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

let seeded;
let member;
test.afterEach(async () => {
  await deleteThrowawayMember(member?.id);
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
  member = null;
});

const openAccountMenu = (page) => page.locator('header button[aria-haspopup="menu"]').click();

test('a member deletes their account: registration cancelled, signed out, and shut out on return', async ({ page, browser }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inDays(60), x_reg_close_weeks: 1 });
  member = await createThrowawayMember('delete');
  const partyId = await addParty(member.id, seeded.eventId);

  // The admin's users tab lists the member while they're registered.
  const adminPage = await (await browser.newContext()).newPage();
  await loginAs(adminPage, TEST_USERS.admin);
  await adminPage.goto('/admin?tab=users');
  await expect(adminPage.getByRole('tabpanel').getByText(member.fullName).first()).toBeVisible();

  await loginAs(page, member);
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: fr.deleteAccount }).click();
  const dialog = page.getByRole('dialog', { name: fr.deleteAccountConfirmTitle });
  await expect(dialog).toContainText(fr.deleteAccountConfirm);
  await dialog.getByRole('button', { name: fr.deleteAccount }).click();

  // Signed out, back on the public home.
  await expect(page.getByRole('button', { name: fr.signIn })).toBeVisible();
  expect((await getProfile(member.id)).deleted_at).not.toBeNull();
  expect((await getParty(partyId)).status).toBe('cancelled');

  // ...and no longer once the account is deleted.
  await adminPage.reload();
  await expect(adminPage.getByRole('tabpanel')).toBeVisible();
  await expect(adminPage.getByRole('tabpanel').getByText(member.fullName)).toHaveCount(0);

  // Signing in again shows the deleted-account state, not the app.
  await loginAs(page, member);
  await expect(page.getByRole('heading', { name: fr.accountDeletedTitle })).toBeVisible();
  await expect(page.getByRole('link', { name: fr.navInfo })).toHaveCount(0);
  await openAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: fr.deleteAccount })).toHaveCount(0);
});

test('after the close date, deletion is refused and the member is told why', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ event_start_date: inDays(3), x_reg_close_weeks: 1 });
  member = await createThrowawayMember('locked');
  const partyId = await addParty(member.id, seeded.eventId);

  await loginAs(page, member);
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: fr.deleteAccount }).click();
  const dialog = page.getByRole('dialog', { name: fr.deleteAccountConfirmTitle });
  await dialog.getByRole('button', { name: fr.deleteAccount }).click();

  // The database raises a code; the dialog shows its French text, with the event's name.
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText(fr.dbErrorAccountDeletionLocked.split('«')[0].trim());
  await expect(alert).toContainText('« E2E Admin Tabs Event »');
  await expect(alert).not.toContainText('account_deletion_locked');
  expect((await getProfile(member.id)).deleted_at).toBeNull();
  expect((await getParty(partyId)).status).toBe('registered');
});
