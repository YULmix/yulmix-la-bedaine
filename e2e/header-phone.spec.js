// The header on a narrow phone (#151): the brand name never wraps onto two lines or crowds the
// nav icons, and the account button stays on screen however long the member's name is. Below
// 440px the brand text is hidden and only the logo shows.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { createThrowawayMember, deleteThrowawayMember } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

const BRAND_MIN_WIDTH = 440;
const WIDTHS = [320, 360, 390, 439, 440, 480, 640];

const box = async (locator) => locator.boundingBox();

async function expectHeaderFits(page, width, { hasNav }) {
  const header = page.locator('header');
  const brand = header.getByText(fr.brandName, { exact: true });
  const account = header.locator('button[aria-haspopup="menu"]');

  // Nothing pushes the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  const accountBox = await box(account);
  expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(width);

  if (width < BRAND_MIN_WIDTH) {
    await expect(brand).toBeHidden();
    return;
  }
  await expect(brand).toBeVisible();
  const brandBox = await box(brand);
  // One line: the two-line wrap is what made the header look cramped.
  const lineHeight = await brand.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
  expect(brandBox.height).toBeLessThanOrEqual(lineHeight + 1);
  // The brand ends before whatever follows it: the nav icons, or the account/sign-in button.
  const next = hasNav ? await box(header.getByRole('navigation').first()) : accountBox;
  expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(next.x);
  if (hasNav) {
    const navBox = await box(header.getByRole('navigation').first());
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(accountBox.x);
  }
}

for (const width of WIDTHS) {
  test(`${width}px: signed out`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: fr.signIn })).toBeVisible();
    await expectHeaderFits(page, width, { hasNav: false });
  });

  // Infos, Covoiturage (#180: an admin always sees the board, registered or not) and Admin.
  test(`${width}px: admin (three nav icons)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loginAs(page, TEST_USERS.admin);
    const nav = page.getByRole('navigation', { name: fr.mainNavLabel });
    await expect(nav.getByRole('link', { name: fr.navCarpool })).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expectHeaderFits(page, width, { hasNav: true });
  });

  test(`${width}px: member with a long name`, async ({ page }) => {
    const member = await createThrowawayMember('header');
    try {
      await page.setViewportSize({ width, height: 800 });
      await loginAs(page, member);
      await expect(page.getByRole('navigation', { name: fr.mainNavLabel })).toBeVisible();
      await expectHeaderFits(page, width, { hasNav: true });
    } finally {
      await deleteThrowawayMember(member.id);
    }
  });
}
