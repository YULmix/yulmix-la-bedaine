// Screenshots of Inscrits (« Participants », « Liste ») on whatever data the database holds, for the
// UI checklist (docs/05-frontend-guide.md): run it after `npm run db:local:demo` (70 parties, long
// names, every enum value), never on the e2e fixtures' few rows. Seeds nothing; skipped unless
// E2E_SCREENSHOT_DIR=<dir> is set. Saves each screen at 390, 768, 1024, 1440 and 2560 px, with the
// « Détails » pop-up and (below 1280) the sort sheet open.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginAs, TEST_USERS } from './support/auth.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test('Inscrits screenshots', async ({ page }) => {
  test.skip(!process.env.E2E_SCREENSHOT_DIR, 'set E2E_SCREENSHOT_DIR');
  const shot = (name, width) => page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}-admin-${width}.png`, fullPage: false });
  const settle = () => page.waitForTimeout(500); // the switch's and the dialogs' animation
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
    await page.goto('/admin/users');
    await expect(page.getByRole('main').getByRole('list').first()).toBeVisible();
    await shot('liste', width);
  }
});
