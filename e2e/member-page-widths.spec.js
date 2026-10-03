// The member pages use the two page widths (#211): the canvas is clamped and centred, the narrow
// pages stay at max-w-3xl, and nothing scrolls horizontally at phone and laptop widths.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';

test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeEach(async () => { seeded = await seedActiveEventWithMemberParty(); });
test.afterEach(async () => {
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  seeded = null;
});

const PAGES = ['/', '/inscription', '/event-details', '/carpool', '/a-propos'];

for (const width of [390, 1280]) {
  test(`no member page scrolls horizontally at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loginAs(page, TEST_USERS.member);
    for (const path of PAGES) {
      await page.goto(path);
      await page.locator('main').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}

test('the narrow pages are clamped and centred at 2560px, the carpool board fills the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  await loginAs(page, TEST_USERS.member);
  const box = async (path) => {
    await page.goto(path);
    await page.locator('main').first().waitFor();
    return page.locator('main > div').first().boundingBox();
  };
  for (const path of ['/', '/event-details', '/a-propos', '/inscription']) {
    const b = await box(path);
    expect(b.width, path).toBeLessThanOrEqual(768);
    expect(Math.abs(b.x + b.width / 2 - 1280), path).toBeLessThan(2);
  }
  expect((await box('/carpool')).width).toBeGreaterThan(768);
});

test('the signed-out home is narrow too: clamped and centred at 2560px, no horizontal scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto('/');
  await page.locator('main > div').first().waitFor();
  const b = await page.locator('main > div').first().boundingBox();
  expect(b.width).toBeLessThanOrEqual(768);
  expect(Math.abs(b.x + b.width / 2 - 1280)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
