// Preview-only account picker (#105): "Se connecter comme…" signs in as a seeded @test.local
// account. The dev server builds with __PREVIEW_TOOLS__ on and points at a local stack, so it's
// enabled here the way it is on a preview deployment. Only sessions change; no data is written.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { adminNav as adminSidebar } from './support/admin.js';
import {
  grantEditionRoles,
  revokeEditionRoles,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));
const pv = JSON.parse(readFileSync(new URL('../src/locales/fr.preview.json', import.meta.url), 'utf-8'));

const accountMenu = (page) => page.locator('header button[aria-haspopup="menu"]');
const marker = (page, email) => page.getByText(pv.marker.replace('{email}', email), { exact: true });
const adminNav = (page) => page.getByRole('navigation', { name: fr.mainNavLabel }).getByRole('link', { name: fr.navAdmin });

const openPicker = async (page) => {
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: pv.switchAccount }).click();
  return page.getByRole('dialog', { name: pv.pickerTitle });
};

for (const { label, viewport } of [
  { label: 'phone', viewport: { width: 390, height: 844 } },
  { label: 'desktop', viewport: { width: 1280, height: 800 } }
]) {
  test(`${label}: an admin picks a member from the list, then switches back in one click`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    await loginAs(page, TEST_USERS.admin);
    await expect(marker(page, TEST_USERS.admin.email)).toBeVisible();

    let picker = await openPicker(page);
    const memberRow = picker.getByRole('listitem').getByRole('button', { name: new RegExp(TEST_USERS.member.email.replace('.', '\\.')) });
    await expect(memberRow).toBeVisible();
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/picker-admin-${label}.png` });
    await memberRow.click();

    await expect(marker(page, TEST_USERS.member.email)).toBeVisible();
    await expect(adminNav(page)).toHaveCount(0);

    // A member can't list profiles, but can always get back to the test admin.
    picker = await openPicker(page);
    await expect(picker.getByText(pv.adminOnlyHint)).toBeVisible();
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/picker-member-${label}.png` });
    await picker.getByRole('button', { name: new RegExp(pv.quickAdmin) }).click();

    await expect(marker(page, TEST_USERS.admin.email)).toBeVisible();
    await expect(adminNav(page)).toBeVisible();
  });
}

test('signed out, the quick links sign in; a non-test address is refused', async ({ page }) => {
  await page.goto('/');
  let picker = await openPicker(page);
  await picker.getByLabel(pv.emailLabel).fill('someone@gmail.com');
  await picker.getByRole('button', { name: pv.signIn, exact: true }).click();
  await expect(picker.getByRole('alert')).toHaveText(pv.emailInvalid.replace('{domain}', '@test.local'));

  await picker.getByRole('button', { name: new RegExp(pv.quickMember) }).click();
  await expect(marker(page, TEST_USERS.member.email)).toBeVisible();
});

// The edition roles (#217) the picker's levels come from: both seeded accounts hold theirs on the
// active event.
test.describe('levels on the active edition', () => {
  test.describe.configure({ mode: 'serial' });
  let seeded;
  test.beforeEach(async () => {
    seeded = await seedActiveEventWithMemberParty();
    await grantEditionRoles(seeded.eventId);
  });
  test.afterEach(async () => {
    if (seeded) {
      await revokeEditionRoles(seeded.eventId);
      await teardownActiveEventWithMemberParty(seeded);
    }
    seeded = null;
  });

  const rowFor = (picker, email) => picker.getByRole('listitem').filter({ hasText: email });

  test('each account shows its level, and each chip narrows the list to that level', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin);
    const picker = await openPicker(page);
    await expect(rowFor(picker, TEST_USERS.admin.email)).toContainText(fr.editionRoleAdmin);
    await expect(rowFor(picker, TEST_USERS.organiser.email)).toContainText(fr.editionRoleOrganiser);
    await expect(rowFor(picker, TEST_USERS.committee.email)).toContainText(fr.editionRoleCommittee);
    await expect(rowFor(picker, TEST_USERS.member.email)).toContainText(fr.accountLevelMember);

    const chip = name => picker.getByRole('radio', { name, exact: true });
    const emails = picker.getByRole('listitem').locator('.font-data.text-xs');
    await chip(fr.editionRoleOrganiser).check({ force: true });
    await expect(emails).toHaveText([TEST_USERS.organiser.email]);
    await chip(fr.editionRoleCommittee).check({ force: true });
    await expect(emails).toHaveText([TEST_USERS.committee.email]);
    await chip(fr.accountLevelAdminShort).check({ force: true });
    await expect(emails).toHaveText([TEST_USERS.admin.email]);
    await chip(fr.accountLevelMember).check({ force: true });
    await expect(picker.getByRole('listitem').filter({ hasText: TEST_USERS.member.email })).toHaveCount(1);
    await expect(picker.getByRole('listitem').filter({ hasText: TEST_USERS.organiser.email })).toHaveCount(0);

    // Combined with the search: no organiser among the members.
    await picker.getByRole('searchbox').fill('organiser');
    await expect(picker.getByText(fr.accountsNoMatch)).toBeVisible();
    await chip(fr.accountLevelAll).check({ force: true });
    await expect(emails).toHaveText([TEST_USERS.organiser.email]);
    if (process.env.E2E_SCREENSHOT_DIR) {
      await picker.getByRole('searchbox').fill('');
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/picker-levels-desktop.png` });
    }
  });

  test('the Organisateur and Comité quick buttons sign in with the right access', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin);
    let picker = await openPicker(page);
    await expect(picker.getByRole('button', { name: new RegExp(pv.quickAdmin) })).toBeDisabled();
    await picker.getByRole('button', { name: new RegExp(pv.quickOrganiser) }).click();
    await expect(marker(page, TEST_USERS.organiser.email)).toBeVisible();
    await page.getByRole('link', { name: fr.navAdmin }).click();
    await expect(adminSidebar(page).getByRole('link', { name: fr.adminTabBudget })).toBeVisible();

    await page.goto('/');
    picker = await openPicker(page);
    await expect(picker.getByRole('button', { name: new RegExp(pv.quickOrganiser) })).toBeDisabled();
    await picker.getByRole('button', { name: new RegExp(pv.quickCommittee) }).click();
    await expect(marker(page, TEST_USERS.committee.email)).toBeVisible();
    await page.getByRole('link', { name: fr.navAdmin }).click();
    await expect(adminSidebar(page).getByRole('link', { name: fr.adminTabLogistics })).toBeVisible();
    await expect(adminSidebar(page).getByRole('link', { name: fr.adminTabBudget })).toHaveCount(0);
  });
});
