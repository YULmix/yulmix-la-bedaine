// Unsaved admin edits survive the app re-rendering (#139). ProtectedRoute used to be declared
// inside App, so every App render (e.g. Supabase's auth event when the browser tab regains focus)
// remounted the whole admin page and dropped whatever wasn't saved.
import { test, expect } from '@playwright/test';
import { sectionLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import { seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

let seeded;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

test('an unsaved admin note survives an app re-render and the tab regaining focus', async ({ page }) => {
  await page.goto('/admin/logistics');
  const note = page.getByRole('tabpanel', { name: fr.logisticsViewTitle }).getByLabel(fr.logisticsTableAdminNotes).first();
  await note.fill('Arrive tard vendredi');

  // Opening the footer's feedback dialog re-renders App.
  await page.getByRole('contentinfo').getByRole('button', { name: fr.reportProblem }).click();
  await page.keyboard.press('Escape');
  // What the browser does when the admin switches tabs and comes back; Supabase answers with an
  // auth event, which re-renders App too.
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });

  await expect(note).toHaveValue('Arrive tard vendredi');
  await expect(sectionLink(page, fr.adminTabLogistics).getByLabel(fr.unsavedTag)).toBeVisible();
});

test('an unsaved message to participants survives an app re-render too, and counts as unsaved (#216)', async ({ page }) => {
  await page.goto('/admin/logistics');
  const message = page.getByRole('tabpanel', { name: fr.logisticsViewTitle }).getByLabel(fr.logisticsTableParticipantMessage).first();
  await message.fill('Bienvenue au chalet');
  await expect(page.getByText(fr.eventEditorUnsaved.replace('{n}', 1))).toBeVisible();

  await page.getByRole('contentinfo').getByRole('button', { name: fr.reportProblem }).click();
  await page.keyboard.press('Escape');

  await expect(message).toHaveValue('Bienvenue au chalet');
  await expect(sectionLink(page, fr.adminTabLogistics).getByLabel(fr.unsavedTag)).toBeVisible();
});
