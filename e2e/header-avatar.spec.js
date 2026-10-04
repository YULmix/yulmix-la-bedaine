// The header badge's picture (#261): provider picture, else Gravatar, else initials. The image
// hosts are intercepted so the tests never touch the network.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const badge = (page) => page.locator('header button[aria-haspopup="menu"] span[aria-hidden="true"]').first();

test('no provider picture and no Gravatar: the initials show, no image', async ({ page }) => {
  await page.route('https://www.gravatar.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, TEST_USERS.member);
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(badge(page)).toHaveText(/\S+/);
  await expect(badge(page).locator('img[src]')).toHaveCount(0);
  await expect(badge(page).locator('img')).not.toBeVisible();
});

test('a Gravatar shows in the badge, asked for with a hash and d=404', async ({ page }) => {
  const requests = [];
  await page.route('https://www.gravatar.com/**', (route) => {
    requests.push(route.request());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await loginAs(page, TEST_USERS.admin);
  await expect(badge(page).locator('img')).toHaveAttribute('src', /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=64&d=404$/);
  await expect(badge(page).locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(requests.length).toBeGreaterThan(0);
});

test('the provider picture (user_metadata.avatar_url) wins over Gravatar', async ({ page }) => {
  const gravatar = [];
  await page.route('https://www.gravatar.com/**', (route) => { gravatar.push(route.request().url()); return route.fulfill({ status: 404, body: '' }); });
  await page.route('https://lh3.googleusercontent.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await loginAs(page, TEST_USERS.member);
  await page.evaluate(() => window.__supabase.auth.updateUser({ data: { avatar_url: 'https://lh3.googleusercontent.com/a/test-picture' } }));
  gravatar.length = 0; // the login's first load asked for it, before the picture was set
  await page.reload();
  const img = badge(page).locator('img');
  await expect(img).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/test-picture');
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(gravatar).toHaveLength(0);
  // Leave the seeded user as it was.
  await page.evaluate(() => window.__supabase.auth.updateUser({ data: { avatar_url: null } }));
});
