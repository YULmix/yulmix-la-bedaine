// Archiving the active event (Événements tab) asks first (#22): cancelling leaves it untouched,
// confirming archives it. Archiving is one-way in the app, and the dialog says so.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { E2E_EVENT_THEME, getEvent, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

let seeded;
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await loginAs(page, TEST_USERS.admin);
});
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const openArchiveDialog = async (page) => {
  await page.goto('/admin?tab=events');
  await page.getByRole('tabpanel').getByRole('button', { name: fr.archiveEventButton }).click();
  const dialog = page.getByRole('dialog', { name: fr.archiveEventConfirmTitle });
  await expect(dialog).toContainText(fr.archiveEventConfirm.replace('{theme}', E2E_EVENT_THEME));
  return dialog;
};

test('cancelling the archive confirmation leaves the event active', async ({ page }) => {
  const dialog = await openArchiveDialog(page);
  await dialog.getByRole('button', { name: fr.cancel }).click();
  await expect(dialog).toHaveCount(0);

  expect(await getEvent(seeded.eventId)).toMatchObject({ status: 'ACTIVE', is_active: true });
  await expect(page.getByRole('tabpanel').getByRole('button', { name: fr.archiveEventButton })).toBeVisible();
});

test('confirming archives the event, with no way to reactivate it', async ({ page }) => {
  const dialog = await openArchiveDialog(page);
  await dialog.getByRole('button', { name: fr.archiveEventButton }).click();
  await expect(page.getByText(fr.eventArchivedToast.replace('{theme}', E2E_EVENT_THEME))).toBeVisible();

  await expect.poll(() => getEvent(seeded.eventId)).toMatchObject({ status: 'ARCHIVED', is_active: false });
  const row = page.getByRole('tabpanel').getByRole('listitem').filter({ hasText: E2E_EVENT_THEME });
  await expect(row.getByRole('button', { name: fr.activateEventButton })).toHaveCount(0);
  await expect(row.getByRole('button', { name: fr.archiveEventButton })).toHaveCount(0);
});
