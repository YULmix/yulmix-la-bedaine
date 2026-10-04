// One app canvas (#226): the header, the page and the footer share the same left and right edges
// on member and admin pages, the admin sidebar sits on the canvas's left edge, narrow pages stay
// at most 768 px, and nothing scrolls horizontally.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';

test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeAll(async () => { seeded = await seedActiveEventWithMemberParty(); });
test.afterAll(async () => { if (seeded) await teardownActiveEventWithMemberParty(seeded); });

// An element's content box (its box minus its padding).
const contentBox = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) };
});

const edges = async (page, path) => {
  await page.goto(path);
  await page.locator('main').first().waitFor();
  const isAdmin = path.startsWith('/admin');
  const canvas = isAdmin ? page.locator('main').first().locator('xpath=..') : page.locator('main').first();
  return {
    header: await contentBox(page.locator('header > div.max-w-screen-2xl')),
    footer: await contentBox(page.locator('footer > div.max-w-screen-2xl')),
    page: await contentBox(canvas),
  };
};

for (const width of [1280, 1920, 2560]) {
  test(`header, page and footer share the canvas's edges at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginAs(page, TEST_USERS.admin);
    const seen = [];
    for (const path of ['/', '/carpool', '/admin/overview']) {
      const e = await edges(page, path);
      for (const part of ['footer', 'page']) {
        expect(Math.abs(e[part].left - e.header.left), `${path} ${part} left`).toBeLessThan(1);
        expect(Math.abs(e[part].right - e.header.right), `${path} ${part} right`).toBeLessThan(1);
      }
      seen.push(e.header);
    }
    // Moving between the member pages and the admin changes nothing.
    for (const h of seen) {
      expect(Math.abs(h.left - seen[0].left)).toBeLessThan(1);
      expect(Math.abs(h.right - seen[0].right)).toBeLessThan(1);
    }
    // In-app navigation from `/` to `/admin`, too.
    await page.goto('/');
    await page.locator('header a[href^="/admin"]').first().click();
    await page.waitForURL(/\/admin/);
    await page.locator('main').first().waitFor();
    const h = await contentBox(page.locator('header > div.max-w-screen-2xl'));
    expect(Math.abs(h.left - seen[0].left)).toBeLessThan(1);
    expect(Math.abs(h.right - seen[0].right)).toBeLessThan(1);
  });
}

test('at 2560px the admin sidebar starts at the canvas\'s left edge and the canvas is centred', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 900 });
  await loginAs(page, TEST_USERS.admin);
  const e = await edges(page, '/admin/overview');
  const sidebar = await page.locator('nav[class*="md:block"]').first().boundingBox();
  expect(sidebar.x).toBeGreaterThan(100);
  expect(Math.abs(sidebar.x - e.page.left)).toBeLessThan(1);
  expect(Math.abs((e.page.left + e.page.right) / 2 - 1280)).toBeLessThan(1);
  expect(e.page.right - e.page.left).toBeGreaterThan(1400);
});

test('narrow member pages stay at 768px, no page scrolls horizontally at 390, 1280 and 2560', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);
  for (const width of [390, 1280, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/inscription', '/event-details', '/carpool', '/admin/overview']) {
      await page.goto(path);
      await page.locator('main').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(0);
      if (['/', '/event-details'].includes(path)) {
        const b = await page.locator('main > div').first().boundingBox();
        expect(b.width, path).toBeLessThanOrEqual(768);
      }
    }
  }
});
