// #329: the post-mortem offset in the event form (« Bilan : jours après la fin »): the close date it
// comes to, editing it before the close, the confirmation when it closes now, and the read-only
// field after. The close is final (#315), so the destructive cases use an event of their own.
import { test, expect } from './support/test.js';
import { eventRow } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME, archiveEvent, createActiveEvent, getEvent, shelveEvent,
  seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));
const DAY = 24 * 3600 * 1000;
const daysFromNow = n => new Date(Date.now() + n * DAY).toISOString();
const dayText = (iso, offsetDays = 0) => new Date(new Date(iso).getTime() + offsetDays * DAY)
  .toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'long', day: 'numeric' });

test.describe.configure({ mode: 'serial' });

let seeded;
let own;
test.afterEach(async () => {
  if (seeded) await teardownActiveEventWithMemberParty(seeded);
  if (own) await shelveEvent(own.id);
  seeded = null;
  own = null;
});

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.locator('#event-calendar').screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png` });
};

const openEditor = async (page, theme) => {
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/events');
  await eventRow(page, theme).getByRole('button', { name: fr.edit }).click();
  return page.getByRole('tabpanel', { name: fr.eventSectionDetails });
};

test('the offset shows with its close date, an edit before the close saves and moves the date', async ({ page }) => {
  // Started 3 days ago, lasting 1 day: the answers opened 2 days ago, 14 days by default.
  const start = daysFromNow(-3);
  seeded = await seedActiveEventWithMemberParty({ feedback_days: 14, event_start_date: start, duration_days: 1 });
  const details = await openEditor(page, E2E_EVENT_THEME);
  const field = details.getByLabel(fr.eventFeedbackDaysLabel);
  await expect(field).toHaveValue('14');
  const note = details.getByTestId('feedback-close-note');
  await expect(note).toContainText(dayText(start, 14));
  await expect(note).toContainText(fr.eventFeedbackOpenUntil.split('{date}')[0].trim());
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await field.scrollIntoViewIfNeeded();
    await screenshot(page, `event-feedback-days-${width}`);
  }

  await field.fill('20');
  await expect(note).toContainText(dayText(start, 20));
  await details.getByRole('button', { name: fr.save, exact: true }).click();
  await expect.poll(async () => (await getEvent(seeded.eventId)).feedback_days).toBe(20);
  await expect(details.getByRole('status')).toHaveText(fr.eventEditorAllSaved);
  await expect(note).toContainText(dayText(start, 20));
  expect((await getEvent(seeded.eventId)).feedback_closed_at).toBeNull();
});

test('an event not over yet says the feedback is not open, with the date it will close', async ({ page }) => {
  const start = daysFromNow(30);
  seeded = await seedActiveEventWithMemberParty({ feedback_days: 14, event_start_date: start, duration_days: 3 });
  const details = await openEditor(page, E2E_EVENT_THEME);
  const note = details.getByTestId('feedback-close-note');
  await expect(note).toContainText(fr.eventFeedbackNotYet.split('{date}')[0].trim());
  // Three days from the start, the last on the 3rd: the close is 14 days after it.
  await expect(note).toContainText(dayText(start, 2 + 14));
});

test('values below 1, above 365 and non-integers are refused in French and block saving', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty({ feedback_days: 14, event_start_date: daysFromNow(-3) });
  const details = await openEditor(page, E2E_EVENT_THEME);
  const field = details.getByLabel(fr.eventFeedbackDaysLabel);
  const save = details.getByRole('button', { name: fr.save, exact: true });
  for (const [typed, message] of [
    ['0', fr.eventFieldMin.replace('{min}', 1)],
    ['366', fr.eventFieldMax.replace('{max}', 365)],
    ['1.5', fr.eventFieldInteger],
    ['', fr.eventFieldInteger]
  ]) {
    await field.fill(typed);
    await expect(details.getByText(message)).toBeVisible();
    await expect(save).toBeDisabled();
  }
  await field.fill('365');
  await expect(save).toBeEnabled();
});

test('an offset that closes the feedback now asks first, then closes it for good and the field becomes read-only', async ({ page }) => {
  // Started 10 days ago: 3 days after the end was 6 days ago.
  const start = daysFromNow(-10);
  own = await createActiveEvent({ event_start_date: start, duration_days: 1 });
  const details = await openEditor(page, own.theme);
  const field = details.getByLabel(fr.eventFeedbackDaysLabel);
  await field.fill('3');
  await expect(details.getByTestId('feedback-close-note')).toContainText(fr.eventFeedbackWillClose);
  await details.getByRole('button', { name: fr.save, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: fr.eventFeedbackCloseConfirmTitle });
  await expect(dialog).toBeVisible();
  // Cancelling saves nothing.
  await dialog.getByRole('button', { name: fr.cancel }).click();
  expect((await getEvent(own.id)).feedback_days).toBe(14);
  await details.getByRole('button', { name: fr.save, exact: true }).click();
  await dialog.getByRole('button', { name: fr.eventFeedbackCloseConfirmButton }).click();

  await expect.poll(async () => (await getEvent(own.id)).feedback_closed_at).not.toBeNull();
  expect((await getEvent(own.id)).feedback_days).toBe(3);
  // Read-only, with the day it closed on: today, when the save did it (#315's marker is the earlier of the
  // old schedule and now).
  await expect(details.getByLabel(fr.eventFeedbackDaysLabel)).toHaveCount(0);
  await expect(details.getByTestId('feedback-close-note')).toHaveText(fr.eventFeedbackClosedOn.replace('{date}', dayText(new Date().toISOString())));
  await screenshot(page, 'event-feedback-days-closed-desktop');

  await page.reload();
  await expect(page.getByTestId('feedback-close-note')).toContainText(fr.eventFeedbackClosedOn.split('{date}')[0].trim());
});

test('an archived event shows its feedback as closed, read-only', async ({ page }) => {
  own = await createActiveEvent();
  await archiveEvent(own.id);
  await loginAs(page, TEST_USERS.admin);
  await page.goto(`/admin/events/${own.id}`);
  const details = page.getByRole('tabpanel', { name: fr.eventSectionDetails });
  await expect(details.getByTestId('feedback-close-note')).toContainText(fr.eventFeedbackClosedOn.split('{date}')[0].trim());
  await expect(details.getByLabel(fr.eventFeedbackDaysLabel)).toHaveCount(0);
});

test('the form stays clean on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  seeded = await seedActiveEventWithMemberParty({ feedback_days: 14, event_start_date: daysFromNow(-3) });
  const details = await openEditor(page, E2E_EVENT_THEME);
  const field = details.getByLabel(fr.eventFeedbackDaysLabel);
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await screenshot(page, 'event-feedback-days-phone');
  await field.fill('0');
  await screenshot(page, 'event-feedback-days-phone-error');
});
