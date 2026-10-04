// Screenshots of Inscrits (« Participants », « Liste ») on whatever data the database holds, for the
// UI checklist (docs/05-frontend-guide.md): run it after `npm run db:local:demo` (70 parties, long
// names, every enum value), never on the e2e fixtures' few rows. Seeds nothing; skipped unless
// E2E_SCREENSHOT_DIR=<dir> is set. Saves each screen at 390, 768, 1024, 1440 and 2560 px, with the
// « Détails » pop-up and the sort sheet open, plus « Historique » and « Liste » (sorted, its sheet open).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginAs, TEST_USERS } from './support/auth.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test('Inscrits screenshots', async ({ page }) => {
  test.skip(!process.env.E2E_SCREENSHOT_DIR, 'set E2E_SCREENSHOT_DIR');
  const shot = (name, width) => page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}-admin-${width}.png`, fullPage: false });
  const settle = () => page.waitForTimeout(500); // the switch's and the dialogs' animation
  // The « Des ajustements… rafraîchir » banner (a resolved feedback in the seed) isn't the screen
  // under review: mark it dismissed (ResolutionBanner's key) before any page loads.
  await page.addInitScript(() => window.localStorage.setItem('feedbackBannerDismissedAt', '9999-12-31T00:00:00Z'));
  await loginAs(page, TEST_USERS.admin);
  for (const [width, height] of [[390, 1400], [768, 1100], [1024, 900], [1440, 1000], [2560, 1300]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/admin/users/participants');
    await expect(page.getByRole('main').locator('[data-participant-name]').first()).toBeVisible();
    await shot('participants', width);
    const details = page.getByRole('button', { name: new RegExp(`^${fr.participantsDetails}`) }).first();
    await details.click();
    await settle();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/participants-details-admin-${width}.png` });
    await page.keyboard.press('Escape');
    if (width < 1280) {
      await page.getByRole('button', { name: fr.participantsSortButton }).click();
      await settle();
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/participants-sortmenu-admin-${width}.png` });
      await page.keyboard.press('Escape');
    }
    await page.getByRole('switch', { name: fr.participantsGroupBy }).click();
    await expect(page.getByRole('switch', { name: fr.participantsGroupBy })).toHaveAttribute('aria-checked', 'true');
    await settle();
    await shot('participants-grouped', width);
    if (width >= 1280) {
      // Grouped, the desktop sorts the groups from the « Trier » sheet too.
      await page.getByRole('button', { name: fr.participantsSortButton }).click();
      await settle();
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/participants-sortmenu-admin-${width}.png` });
      await page.keyboard.press('Escape');
    }
    await page.goto('/admin/users/history');
    await expect(page.getByRole('main')).toBeVisible();
    await settle();
    await shot('historique', width);
    await page.goto('/admin/users');
    await expect(page.getByRole('main').getByRole('table')).toBeVisible();
    await shot('liste', width);
    if (width < 1024) {
      await page.getByRole('main').getByRole('button', { name: fr.participantsSortButton }).click();
      await settle();
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/liste-sortmenu-admin-${width}.png` });
      await page.keyboard.press('Escape');
    }
    // Sorted by a date, the dates show (in the table from lg, under each name below).
    await page.goto('/admin/users?tri=-modification');
    await expect(page.getByRole('main').getByRole('table')).toBeVisible();
    await shot('liste-sorted', width);
  }
});
