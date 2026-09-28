// Preview-only account picker (#105): "Se connecter comme…" signs in as a seeded @test.local
// account. The dev server builds with __PREVIEW_TOOLS__ on and points at a local stack, so it's
// enabled here the way it is on a preview deployment. Only sessions change; no data is written.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
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
