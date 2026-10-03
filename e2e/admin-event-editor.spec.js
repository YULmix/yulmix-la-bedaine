// The event editor page (Événements tab): unsaved edits to the event's fields are a draft that
// survives the app re-rendering (it used to remount the whole admin page, e.g. when the browser tab
// regained focus), a trip to another admin tab, and a reload.
import { test, expect } from '@playwright/test';
import { adminMain, eventRow, backLink, moreButton, moreSheet, openSection, sectionLink } from './support/admin.js';
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

const openEditor = async (page) => {
  await page.goto('/admin/events');
  await eventRow(page, E2E_EVENT_THEME).getByRole('button', { name: fr.edit }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/events/${seeded.eventId}$`));
  // The editor keeps Événements current: in the sidebar, or « Plus » on a phone.
  const current = page.viewportSize().width < 768 ? moreButton(page) : sectionLink(page, fr.adminTabEvents);
  await expect(current).toHaveAttribute('aria-current', /page|true/);
  return page.getByRole('tabpanel', { name: fr.eventSectionDetails });
};

// Instants as PostgREST returns them ("…+00:00"), compared as ISO strings.
const iso = value => (value ? new Date(value).toISOString() : value);

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

// Événements is under « Plus » on phones (#208): the marker shows on « Plus », and on its row.
test('on a phone, an unsaved event draft marks « Plus » and Événements in its sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const details = await openEditor(page);
  await details.getByLabel(fr.eventTitle).fill('Soirée mousse');
  await sectionLink(page, fr.adminTabOverview).click();
  await expect(moreButton(page).getByLabel(fr.unsavedTag)).toBeVisible();
  await expect(sectionLink(page, fr.adminTabOverview).getByLabel(fr.unsavedTag)).toHaveCount(0);
  await moreButton(page).click();
  await expect(moreSheet(page).getByRole('link', { name: fr.adminTabEvents }).getByLabel(fr.unsavedTag)).toBeVisible();
  await screenshot(page, 'phone-more-draft');
  await moreSheet(page).getByRole('link', { name: fr.adminTabEvents }).click();
  await eventRow(page, E2E_EVENT_THEME).getByRole('button', { name: fr.edit }).click();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue('Soirée mousse');
});

test('an unsaved edit survives an app re-render, the browser tab refocusing, another admin tab and a reload', async ({ page }) => {
  const details = await openEditor(page);
  const title = details.getByLabel(fr.eventTitle);
  await title.fill('Soirée mousse');
  await expect(details.getByRole('status')).toContainText(fr.eventEditorUnsaved.replace('{n}', 1));

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

  await openSection(page, fr.adminTabOverview);
  await expect(sectionLink(page, fr.adminTabEvents).getByLabel(fr.unsavedTag)).toBeVisible();
  // Événements shows the list again; the event's row says it has unsaved edits, and reopening it
  // brings them back.
  await openSection(page, fr.adminTabEvents);
  await expect(adminMain(page).getByText(fr.unsavedTag)).toBeVisible();
  await eventRow(page, E2E_EVENT_THEME).getByRole('button', { name: fr.edit }).click();
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
  await backLink(page, fr.adminTabEvents).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(adminMain(page).getByText('Soirée mousse')).toBeVisible();
  await expect(adminMain(page).getByText(fr.unsavedTag)).toHaveCount(0);
});

// #192: the member pages read the event from the app shell, which used to keep the one it loaded
// on arrival until a reload.
test('a saved title shows on the home page at once, without a reload', async ({ page }) => {
  const details = await openEditor(page);
  await details.getByLabel(fr.eventTitle).fill('Soirée mousse');
  await details.getByRole('button', { name: fr.save, exact: true }).click();
  await expect(details.getByRole('status')).toHaveText(fr.eventEditorAllSaved);

  await page.getByRole('link', { name: fr.homeLinkLabel }).click();
  // The home page, not the editor still on its way out: then its poster's title.
  await expect(page.getByRole('heading', { name: fr.inviteTitle })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Soirée mousse');
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

  // To the minute (#149): the same instant is refused, an hour earlier the same day is fine.
  await details.getByLabel(fr.eventStartDateLabel).fill('2026-07-10T18:00');
  await details.getByLabel(fr.eventRegStartDateLabel).fill('2026-07-10T18:00');
  await expect(details.getByText(fr.eventRegStartOrder)).toBeVisible();
  await expect(save).toBeDisabled();
  await details.getByLabel(fr.eventRegStartDateLabel).fill('2026-07-10T17:00');
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
    return [saved.theme, iso(saved.reg_start_date), iso(saved.event_start_date), saved.external_links.at(-1)];
  }).toEqual(['E2E Admin Tabs Event 2', '2026-07-10T21:00:00.000Z', '2026-07-10T22:00:00.000Z', { label: 'Plan', url: 'https://example.org/plan.pdf' }]);
  await expect(details.getByLabel(fr.eventExternalLinksLabelPlaceholder, { exact: true })).toHaveCount(firstNew + 1);
});

test('the database refuses an out-of-order registration date, and the editor shows it in French (#141)', async ({ page }) => {
  const details = await openEditor(page);
  const before = await getEvent(seeded.eventId);

  // Client validation would stop this, so send the out-of-order dates behind its back.
  await page.route('**/rest/v1/events?*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.continue({
      postData: JSON.stringify({ ...route.request().postDataJSON(), event_start_date: '2026-07-10T22:00:00Z', reg_start_date: '2026-07-10T22:00:00Z' })
    });
  });
  await details.getByLabel(fr.eventTitle).fill('E2E Refused Event');
  await details.getByRole('button', { name: fr.save, exact: true }).click();

  await expect(page.getByText(fr.dbErrorEventRegStartNotBeforeEventStart)).toBeVisible();
  const after = await getEvent(seeded.eventId);
  expect([after.theme, after.reg_start_date, after.event_start_date]).toEqual([before.theme, before.reg_start_date, before.event_start_date]);
});

// #149: both dates carry a time, entered and shown in Toronto time, whatever the browser's zone.
test.describe('from a browser in another time zone', () => {
  test.use({ timezoneId: 'Europe/Paris' });

  test('the admin sets a date and time for both fields, across a daylight-saving change; the member sees Toronto time', async ({ page, browser }) => {
    const details = await openEditor(page);
    // The registration opens in summer time (EDT), the event starts in winter time (EST).
    await details.getByLabel(fr.eventStartDateLabel).fill('2026-11-20T19:30');
    await details.getByLabel(fr.eventRegStartDateLabel).fill('2026-09-15T12:00');
    await details.getByRole('button', { name: fr.save, exact: true }).click();

    await expect.poll(async () => {
      const saved = await getEvent(seeded.eventId);
      return [iso(saved.event_start_date), iso(saved.reg_start_date)];
    }).toEqual(['2026-11-21T00:30:00.000Z', '2026-09-15T16:00:00.000Z']);

    await page.reload();
    const reloaded = page.getByRole('tabpanel', { name: fr.eventSectionDetails });
    await expect(reloaded.getByLabel(fr.eventStartDateLabel)).toHaveValue('2026-11-20T19:30');
    await expect(reloaded.getByLabel(fr.eventRegStartDateLabel)).toHaveValue('2026-09-15T12:00');
    // In Paris it's already the 21st, 01:30: the dates still say the 20th, from 19 h 30.
    await expect(page.getByText(/20 novembre au 21 novembre 2026, dès 19\sh\s30/).first()).toBeVisible();

    const memberContext = await browser.newContext({ timezoneId: 'Pacific/Auckland' });
    const member = await memberContext.newPage();
    await loginAs(member, TEST_USERS.member);
    await member.goto('/');
    await expect(member.getByRole('article', { name: fr.passLabel }).getByText(/20 novembre au 21 novembre 2026, dès 19\sh\s30/)).toBeVisible();
    await memberContext.close();
  });
});
