// The event editor page (Événements tab): unsaved edits to the event's fields are a draft that
// survives the app re-rendering (it used to remount the whole admin page, e.g. when the browser tab
// regained focus), a trip to another admin tab, and a reload.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { getEvent, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
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

const openEditor = async (page) => {
  await page.goto('/admin?tab=events');
  await page.getByRole('tabpanel').getByRole('button', { name: fr.edit }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/events/${seeded.eventId}$`));
  await expect(page.getByRole('tab', { name: fr.adminTabEvents })).toHaveAttribute('aria-selected', 'true');
  return page.getByRole('tabpanel', { name: fr.eventSectionDetails });
};

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

test('an unsaved edit survives an app re-render, the browser tab refocusing, another admin tab and a reload', async ({ page }) => {
  const details = await openEditor(page);
  const title = details.getByLabel(fr.eventTitle);
  await title.fill('Soirée mousse');
  await expect(details.getByRole('status')).toHaveText(fr.eventEditorUnsaved.replace('{n}', 1));

  // Anything that re-renders App (here, opening the feedback dialog) or makes Supabase emit an
  // auth event (the tab regaining focus) must not remount the page: the field keeps its value
  // and no "restored" notice shows, which is what a remount would fall back to.
  await page.getByRole('contentinfo').getByRole('button', { name: fr.reportProblem }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
  await expect(title).toHaveValue('Soirée mousse');
  await expect(page.getByText(fr.eventEditorRestored)).toHaveCount(0);

  await page.getByRole('tab', { name: fr.adminTabOverview }).click();
  await expect(page.getByRole('tab', { name: fr.adminTabEvents }).getByLabel(fr.unsavedTag)).toBeVisible();
  // Événements shows the list again; the event's row says it has unsaved edits, and reopening it
  // brings them back.
  await page.getByRole('tab', { name: fr.adminTabEvents }).click();
  await expect(page.getByRole('tabpanel').getByText(fr.unsavedTag)).toBeVisible();
  await page.getByRole('tabpanel').getByRole('button', { name: fr.edit }).click();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue('Soirée mousse');

  await page.reload();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue('Soirée mousse');
  await expect(page.getByText(fr.eventEditorRestored)).toBeVisible();
  await screenshot(page, 'event-editor-desktop');

  await page.getByRole('button', { name: fr.save, exact: true }).click();
  await expect.poll(async () => (await getEvent(seeded.eventId)).theme).toBe('Soirée mousse');
  await expect(page.getByRole('tabpanel', { name: fr.eventSectionDetails }).getByRole('status')).toHaveText(fr.eventEditorAllSaved);
  await expect(page.getByText(fr.eventEditorRestored)).toHaveCount(0);

  // Back to the list, which shows the saved title and no unsaved marker.
  await page.getByRole('button', { name: fr.eventEditorBack }).click();
  await expect(page).toHaveURL(/\/admin\?tab=events$/);
  await expect(page.getByRole('tabpanel').getByText('Soirée mousse')).toBeVisible();
  await expect(page.getByRole('tabpanel').getByText(fr.unsavedTag)).toHaveCount(0);
});

test('numbers can be cleared and retyped, an invalid one blocks saving, and edits can be discarded', async ({ page }) => {
  const details = await openEditor(page);
  const max = details.getByLabel(fr.eventMaxAttendeesLabel);
  const save = details.getByRole('button', { name: fr.save, exact: true });
  await expect(save).toBeDisabled();

  await max.fill('');
  await expect(details.getByText(fr.eventFieldInteger)).toBeVisible();
  await expect(details.getByRole('status')).toHaveText(fr.eventEditorInvalid);
  await expect(save).toBeDisabled();

  await max.fill('85');
  await expect(details.getByText(fr.eventFieldInteger)).toHaveCount(0);
  await save.click();
  await expect.poll(async () => (await getEvent(seeded.eventId)).max_attendees).toBe(85);

  const description = details.getByLabel(fr.eventDescriptionLabel);
  const saved = await description.inputValue();
  await description.fill('Brouillon à jeter');
  await details.getByRole('button', { name: fr.eventEditorDiscard }).click();
  await expect(description).toHaveValue(saved);
  await expect(details.getByRole('status')).toHaveText(fr.eventEditorAllSaved);

  await page.setViewportSize({ width: 390, height: 844 });
  await description.fill('Sur téléphone');
  await screenshot(page, 'event-editor-phone');
});

test('a title, the date order and well-formed links are required to save', async ({ page }) => {
  const details = await openEditor(page);
  const save = details.getByRole('button', { name: fr.save, exact: true });

  await details.getByLabel(fr.eventTitle).fill('');
  await expect(details.getByText(fr.eventFieldRequired)).toBeVisible();
  await expect(save).toBeDisabled();
  await details.getByLabel(fr.eventTitle).fill('E2E Admin Tabs Event 2');

  await details.getByLabel(fr.eventStartDateLabel).fill('2026-07-10');
  await details.getByLabel(fr.eventRegStartDateLabel).fill('2026-07-10');
  await expect(details.getByText(fr.eventRegStartOrder)).toBeVisible();
  await expect(save).toBeDisabled();
  await details.getByLabel(fr.eventRegStartDateLabel).fill('2026-05-01');
  await expect(details.getByText(fr.eventRegStartOrder)).toHaveCount(0);

  const addLink = details.getByRole('button', { name: fr.eventExternalLinksAddRow });
  await addLink.click();
  await addLink.click();
  const labels = details.getByLabel(fr.eventExternalLinksLabelPlaceholder, { exact: true });
  const urls = details.getByLabel(fr.eventExternalLinksUrlPlaceholder, { exact: true });
  const firstNew = (await labels.count()) - 2;
  await labels.nth(firstNew).fill('Plan');
  await expect(details.getByText(fr.eventLinkIncomplete)).toBeVisible();
  await urls.nth(firstNew).fill('plan.pdf');
  await expect(details.getByText(fr.eventLinkUrl)).toBeVisible();
  await expect(save).toBeDisabled();
  await urls.nth(firstNew).fill('https://example.org/plan.pdf');
  await expect(details.getByText(fr.eventLinkUrl)).toHaveCount(0);

  // The second new row stays empty: it's dropped on save, not refused.
  await save.click();
  await expect.poll(async () => {
    const saved = await getEvent(seeded.eventId);
    return [saved.theme, saved.reg_start_date, saved.event_start_date, saved.external_links.at(-1)];
  }).toEqual(['E2E Admin Tabs Event 2', '2026-05-01', '2026-07-10', { label: 'Plan', url: 'https://example.org/plan.pdf' }]);
  await expect(details.getByLabel(fr.eventExternalLinksLabelPlaceholder, { exact: true })).toHaveCount(firstNew + 1);
});

test('the database refuses an out-of-order registration date, and the editor shows it in French (#141)', async ({ page }) => {
  const details = await openEditor(page);
  const before = await getEvent(seeded.eventId);

  // Client validation would stop this, so send the out-of-order dates behind its back.
  await page.route('**/rest/v1/events?*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.continue({
      postData: JSON.stringify({ ...route.request().postDataJSON(), event_start_date: '2026-07-10', reg_start_date: '2026-07-10' })
    });
  });
  await details.getByLabel(fr.eventTitle).fill('E2E Refused Event');
  await details.getByRole('button', { name: fr.save, exact: true }).click();

  await expect(page.getByText(fr.dbErrorEventRegStartNotBeforeEventStart)).toBeVisible();
  const after = await getEvent(seeded.eventId);
  expect([after.theme, after.reg_start_date, after.event_start_date]).toEqual([before.theme, before.reg_start_date, before.event_start_date]);
});
