// Retours (#209): the feedback inbox, its « Afficher résolus » filter, and the count of
// unresolved items on the section's marker. Members can't reach it.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { resetFeedback } from './support/testData.js';
import { adminMain, adminNav, moreButton } from './support/admin.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

const ITEMS = ['Le bouton est trop petit', 'Il manque un lien vers la carte'];

test.beforeEach(async () => {
  await resetFeedback(ITEMS);
});

test.afterAll(async () => {
  await resetFeedback();
});

const count = (page, n) => page.getByLabel(fr.adminFeedbackUnresolvedCount.replace('{count}', n));

test('Retours lists the feedback; resolving one lowers the section\'s count', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/feedback');
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabFeedback })).toBeVisible();
  await expect(adminMain(page).getByText(ITEMS[0])).toBeVisible();
  await expect(adminMain(page).getByText(ITEMS[1])).toBeVisible();
  await expect(count(page, 2)).toBeVisible();

  await adminMain(page).getByRole('button', { name: fr.adminFeedbackResolve }).first().click();
  await expect(count(page, 1)).toBeVisible();
  await expect(adminMain(page).getByRole('button', { name: fr.adminFeedbackResolve })).toHaveCount(1);

  // Resolved items are hidden until asked for.
  await expect(adminMain(page).getByText(fr.adminFeedbackResolved, { exact: true })).toHaveCount(0);
  await adminMain(page).getByLabel(fr.adminFeedbackShowResolved).check();
  await expect(adminMain(page).getByText(fr.adminFeedbackResolved, { exact: true })).toHaveCount(1);

  await adminMain(page).getByRole('button', { name: fr.adminFeedbackResolve }).click();
  // Nothing left to deal with: no count at all.
  await expect(page.getByLabel(fr.adminFeedbackUnresolvedCount.replace('{count}', '0'))).toHaveCount(0);
  await expect(count(page, 1)).toHaveCount(0);
});

test('on a phone the count shows on « Plus », and on Retours inside it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/overview');
  await expect(moreButton(page).getByLabel(fr.adminMoreMarked)).toBeVisible();
  await moreButton(page).click();
  await expect(page.getByRole('dialog', { name: fr.adminMore }).getByLabel(fr.adminFeedbackUnresolvedCount.replace('{count}', '2'))).toBeVisible();
  await page.getByRole('dialog', { name: fr.adminMore }).getByRole('link', { name: fr.adminTabFeedback }).click();
  await expect(page).toHaveURL(/\/admin\/feedback$/);
  await expect(adminMain(page).getByText(ITEMS[0])).toBeVisible();
});

test('the old Outils feedback URLs land on Retours', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/tools/feedback');
  await expect(page).toHaveURL(/\/admin\/feedback$/);
  await page.goto('/admin?tab=tools&view=feedback');
  await expect(page).toHaveURL(/\/admin\/feedback$/);
  await page.goto('/admin?tab=tools&view=history');
  await expect(page).toHaveURL(/\/admin\/users\/history$/);
});

test('a member can\'t open Retours or the history', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  for (const path of ['/admin/feedback', '/admin/users/history']) {
    await page.goto(path);
    await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
    await expect(page.getByText(ITEMS[0])).toHaveCount(0);
    await expect(page.getByRole('heading', { name: fr.changeHistoryTitle })).toHaveCount(0);
  }
  await expect(adminNav(page)).toHaveCount(0);
});
