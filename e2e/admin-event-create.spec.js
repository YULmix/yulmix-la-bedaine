// Creating an event (#111): « Nouvel événement » in the Événements header opens the event editor,
// empty, at /admin/events/new. Saving asks for a confirmation (an event can't be deleted, ADR 0008),
// inserts a draft (inactive, registrations closed) and opens it. Creation never touches the active
// event.
import { test, expect } from '@playwright/test';
import { adminMain, backLink, eventRow, moreButton, openSection, sectionLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_EVENT_THEME,
  eventThemesVisibleToMember,
  findEventsByTheme,
  getEvent,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
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

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

const box = async (locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found;
};
const overlaps = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

const expectNoSideScroll = async (page) => {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
};

const newEventButton = page => page.getByRole('button', { name: fr.eventNew });
const uniqueTheme = () => `E2E Created ${Date.now()}`;
const START = '2027-03-05T20:00';

const fillNewEvent = async (page, theme, start = START) => {
  if (theme) await page.getByLabel(fr.eventTitle).fill(theme);
  if (start) await page.getByLabel(fr.eventStartDateLabel).fill(start);
};

test('creates a draft while another event is active: Brouillon, closed, and the active event untouched', async ({ page }) => {
  const theme = uniqueTheme();
  await page.goto('/admin/events');
  await newEventButton(page).click();
  await expect(page).toHaveURL(/\/admin\/events\/new$/);

  // The same editor, empty: back link, a creation title, only the details (no Couchage yet), and
  // registrations can't be opened from here.
  await expect(backLink(page, fr.adminTabEvents)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fr.eventNew);
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue('');
  await expect(page.getByRole('tab', { name: fr.eventFieldsetSleeping })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: fr.eventRegOpenLabel })).toHaveCount(0);

  await fillNewEvent(page, theme);
  await page.getByRole('button', { name: fr.eventCreate }).click();
  const confirm = page.getByRole('dialog', { name: fr.eventCreateConfirmTitle });
  await expect(confirm).toContainText(theme);
  await expect(confirm).toContainText(/ne peut pas être supprimé/);
  expect(await findEventsByTheme(theme)).toHaveLength(0);
  await confirm.getByRole('button', { name: fr.eventCreate }).click();

  // The new draft opens, as an existing event does.
  await expect(page).toHaveURL(/\/admin\/events\/(?!new$)[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(theme);
  await expect(page.getByText(fr.draft, { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: fr.eventFieldsetSleeping })).toBeVisible();

  const [created] = await findEventsByTheme(theme);
  expect(created).toMatchObject({ status: 'DRAFT', is_active: false, is_reg_open: false });
  expect(new Date(created.event_start_date).getTime()).toBeGreaterThan(Date.parse('2027-03-04'));
  expect(await getEvent(seeded.eventId)).toMatchObject({ status: 'ACTIVE', is_active: true });

  // Back on the list: Brouillon with Modifier and Activer; the active event is still « En cours ».
  await backLink(page, fr.adminTabEvents).click();
  const row = eventRow(page, theme);
  await expect(row.getByText(fr.draft, { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: fr.edit })).toBeVisible();
  await expect(row.getByRole('button', { name: fr.activateEventButton })).toBeVisible();
  await expect(eventRow(page, E2E_EVENT_THEME).getByText(fr.eventStatusActive, { exact: true })).toBeVisible();

  // The draft can be edited like any event.
  await row.getByRole('button', { name: fr.edit }).click();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue(theme);

  // And the member doesn't see it.
  expect(await eventThemesVisibleToMember()).not.toContain(theme);
});

test('a missing title or start date is refused with a French message, and nothing is created', async ({ page }) => {
  const theme = uniqueTheme();
  await page.goto('/admin/events/new');

  // Nothing complains before the first try.
  await expect(page.getByText(fr.eventFieldRequired)).toHaveCount(0);
  await page.getByRole('button', { name: fr.eventCreate }).click();
  await expect(page.getByText(fr.eventFieldRequired)).toBeVisible();
  await expect(page.getByText(fr.eventStartDateRequired)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Once tried, what is missing stays flagged, and creating waits for it.
  const create = page.getByRole('button', { name: fr.eventCreate });
  await expect(create).toBeDisabled();
  await fillNewEvent(page, theme, '');
  await expect(page.getByText(fr.eventFieldRequired)).toHaveCount(0);
  await expect(page.getByText(fr.eventStartDateRequired)).toBeVisible();
  await expect(create).toBeDisabled();

  await fillNewEvent(page, '   ', START);
  await expect(page.getByText(fr.eventFieldRequired)).toBeVisible();
  await expect(page.getByText(fr.eventStartDateRequired)).toHaveCount(0);
  await expect(create).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await findEventsByTheme(theme)).toHaveLength(0);
});

test('cancelling the confirmation creates nothing and keeps the form; the draft survives leaving the page', async ({ page }) => {
  const theme = uniqueTheme();
  await page.goto('/admin/events/new');
  await fillNewEvent(page, theme);
  await page.getByRole('button', { name: fr.eventCreate }).click();
  await page.getByRole('dialog', { name: fr.eventCreateConfirmTitle }).getByRole('button', { name: fr.cancel }).click();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue(theme);
  expect(await findEventsByTheme(theme)).toHaveLength(0);

  await openSection(page, fr.adminTabOverview);
  await page.goto('/admin/events');
  await newEventButton(page).click();
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue(theme);
});

test('a database refusal shows a French message, never the raw one, and keeps the form', async ({ page }) => {
  const theme = uniqueTheme();
  await page.route('**/rest/v1/events*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "events"' })
    });
  });
  await page.goto('/admin/events/new');
  await fillNewEvent(page, theme);
  await page.getByRole('button', { name: fr.eventCreate }).click();
  await page.getByRole('dialog', { name: fr.eventCreateConfirmTitle }).getByRole('button', { name: fr.eventCreate }).click();
  await expect(page.getByText(/row-level security/)).toHaveCount(0);
  await expect(page.getByText(fr.eventCreateError)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/events\/new$/);
  await expect(page.getByLabel(fr.eventTitle)).toHaveValue(theme);
});

test('as a member, /admin/events/new shows the lock message', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/events/new');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(page.getByLabel(fr.eventTitle)).toHaveCount(0);
});

test('on a phone, the header action does not push the title around, and the new-event form fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/events');
  const heading = page.getByRole('heading', { level: 1 });
  const action = newEventButton(page);
  await expect(action).toBeVisible();
  const title = await box(heading);
  const button = await box(action);
  expect(overlaps(title, button)).toBe(false);
  expect(title.x + title.width).toBeLessThanOrEqual(390);
  expect(button.x + button.width).toBeLessThanOrEqual(390);
  expect(button.x).toBeGreaterThanOrEqual(0);
  // One line, whether the button sits beside it or under it.
  expect(title.height).toBeLessThan(40);
  await expectNoSideScroll(page);
  await screenshot(page, 'event-create-list-390');

  await action.click();
  await expect(page).toHaveURL(/\/admin\/events\/new$/);
  const back = await box(backLink(page, fr.adminTabEvents));
  const newTitle = await box(page.getByRole('heading', { level: 1 }));
  expect(newTitle.y).toBeGreaterThanOrEqual(back.y + back.height - 1);
  await expectNoSideScroll(page);
  await screenshot(page, 'event-create-form-390');

  await page.getByRole('button', { name: fr.eventCreate }).click();
  await expect(page.getByText(fr.eventStartDateRequired)).toBeVisible();
  const save = await box(page.getByRole('button', { name: fr.eventCreate }));
  const nav = await box(page.getByRole('navigation', { name: fr.adminTabsAriaLabel }));
  expect(save.y + save.height).toBeLessThanOrEqual(nav.y + 1);
  await expectNoSideScroll(page);
  await screenshot(page, 'event-create-errors-390');
});

test('on a desktop, the action sits at the right of the Événements header, and the form is laid out', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/events');
  const title = await box(page.getByRole('heading', { level: 1 }));
  const button = await box(newEventButton(page));
  expect(overlaps(title, button)).toBe(false);
  expect(button.x).toBeGreaterThan(title.x + title.width);
  await expectNoSideScroll(page);
  await screenshot(page, 'event-create-list-1440');

  await newEventButton(page).click();
  await fillNewEvent(page, 'Week-end de test', START);
  await expectNoSideScroll(page);
  await screenshot(page, 'event-create-form-1440');
  await adminMain(page).getByRole('button', { name: fr.eventCreate }).click();
  await expect(page.getByRole('dialog', { name: fr.eventCreateConfirmTitle })).toBeVisible();
  await screenshot(page, 'event-create-confirm-1440');
});

// The new event's draft is flagged like any event's: on Événements in the sidebar (on « Plus » on a
// phone), and it clears once the event is created. An empty form isn't unsaved.
for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  test(`on a ${name}, a new event with something typed marks Événements as unsaved until it is created`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const marked = () => (name === 'phone'
      ? moreButton(page).getByLabel(fr.unsavedTag)
      : sectionLink(page, fr.adminTabEvents).getByLabel(fr.unsavedTag));
    const theme = uniqueTheme();

    await page.goto('/admin/events/new');
    await expect(page.getByLabel(fr.eventTitle)).toBeVisible();
    await expect(marked()).toHaveCount(0);

    await page.getByLabel(fr.eventTitle).fill(theme);
    await expect(marked()).toBeVisible();
    await openSection(page, fr.adminTabOverview);
    await expect(marked()).toBeVisible();

    await page.goto('/admin/events/new');
    await fillNewEvent(page, theme);
    await page.getByRole('button', { name: fr.eventCreate }).click();
    await page.getByRole('dialog', { name: fr.eventCreateConfirmTitle }).getByRole('button', { name: fr.eventCreate }).click();
    await expect(page).toHaveURL(/\/admin\/events\/(?!new$)[0-9a-f-]{36}$/);
    await expect(marked()).toHaveCount(0);
  });
}
