// The member's post-mortem page, « bilan » (#316), at /bilan/:eventId, over the database's
// my_event_feedback() and submit_event_feedback() (#315, ADR 0029): the pass links to it while the
// window is open; submit, return, edit and switch named ↔ anonymous; the explanation of who reads
// what; the empty form refused; after the close a named answer read-only and one neutral message
// otherwise; the not-eligible and not-yet-open messages; « Voir comme » shows the same hidden state
// whether the member answered named, anonymously or not at all; unsaved text survives a tab
// refocus and is never written to the browser's storage.
//
// Each test has its own fresh event (a bilan's close is final, so the shared e2e event can't be
// reused), made the active one: the spec runs in its own serial project.
//
// E2E_SCREENSHOT_DIR=<dir> saves the page and the pass card at 390, 1440, 1920x1080 and 2560x1440.
import { test, expect } from './support/test.js';
import { readFileSync } from 'node:fs';
import { adminMain, openPartyDetail } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  closeFeedback,
  endOpenImpersonations,
  seedFeedbackEvent,
  submitFeedbackAs,
  teardownFeedbackEvent
} from './support/testData.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const SIZES = [[390, 844], [1440, 900], [1920, 1080], [2560, 1440]];

let seeded;

test.afterEach(async () => {
  await endOpenImpersonations();
  if (seeded) await teardownFeedbackEvent(seeded);
  seeded = null;
});

const body = page => page.getByTestId('bilan-body');
const passCard = page => page.getByTestId('bilan-pass-card');
const field = (page, label) => body(page).getByLabel(label, { exact: true });
const submitButton = page => body(page).getByRole('button', { name: new RegExp(`^(${fr.bilanSubmit}|${fr.bilanSubmitEdit})$`) });
const identity = (page, label) => body(page).getByRole('radio', { name: label, exact: true });

async function shoot(page, name) {
  if (!SHOTS) return;
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    // Let the layout settle at the new width, from the top (the sticky header otherwise lands mid-shot).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, `${name} at ${width}px scrolls sideways`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('switch off (#341): the member sees no card and the database refuses; the admin still sees the card and can answer', async ({ page, browser }) => {
  seeded = await seedFeedbackEvent({ memberVisible: false, adminRegistered: true });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(passCard(page)).toHaveCount(0);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'error');
  await expect(body(page).getByLabel(fr.bilanCategoryOther, { exact: true })).toHaveCount(0);

  const adminPage = await (await browser.newContext()).newPage();
  await loginAs(adminPage, TEST_USERS.admin);
  await adminPage.goto('/');
  await expect(passCard(adminPage)).toBeVisible();
  await adminPage.goto(`/bilan/${seeded.eventId}`);
  await expect(body(adminPage)).toHaveAttribute('data-state', 'open');
  await field(adminPage, fr.bilanCategoryOther).fill('Test admin');
  await submitButton(adminPage).click();
  await expect(body(adminPage).getByText(fr.bilanSavedTitle)).toBeVisible();
  await adminPage.context().close();
});

test('member: from the pass, submit, return, edit and switch named ↔ anonymous', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.member);

  // The pass links to the bilan while it is open, with its close date.
  await expect(passCard(page)).toBeVisible();
  await expect(passCard(page)).toContainText(fr.bilanPassTitle);
  await shoot(page, 'bilan-pass-card-member');
  await passCard(page).getByRole('link', { name: fr.bilanPassAction }).click();
  await expect(page).toHaveURL(new RegExp(`/bilan/${seeded.eventId}$`));
  await expect(body(page)).toHaveAttribute('data-state', 'open');

  // The eight categories, the choice, and who reads what next to it.
  for (const key of ['bilanCategoryWelcome', 'bilanCategoryPartyMusic', 'bilanCategorySafety', 'bilanCategoryLodging',
    'bilanCategoryFood', 'bilanCategoryCommunications', 'bilanCategorySchedule', 'bilanCategoryOther']) {
    await expect(field(page, fr[key])).toBeVisible();
  }
  await expect(identity(page, fr.bilanIdentityNamed)).toBeChecked();
  for (const key of ['bilanWhoSeesNamed', 'bilanWhoSeesAnonymous', 'bilanWhoSeesAfterClose']) {
    await expect(body(page)).toContainText(fr[key]);
  }
  await expect(body(page)).toContainText(fr.bilanWhoSeesNobodyBefore.split('{date}')[0]);
  await shoot(page, 'bilan-form-member');

  // The empty form is refused, in French (blank text counts as empty).
  await field(page, fr.bilanCategoryFood).fill('   ');
  await submitButton(page).click();
  await expect(body(page).getByRole('alert')).toHaveText(fr.dbErrorEventFeedbackEmpty);

  // Submit, anonymous: the confirmation.
  await field(page, fr.bilanCategoryFood).fill('Les repas étaient excellents');
  await field(page, fr.bilanCategoryWelcome).fill('Accueil chaleureux');
  await identity(page, fr.bilanIdentityAnonymous).check({ force: true });
  await submitButton(page).click();
  await expect(body(page).getByRole('status')).toContainText(fr.bilanSavedTitle);
  await expect(submitButton(page)).toHaveText(fr.bilanSubmitEdit);
  await shoot(page, 'bilan-saved-member');

  // Nothing of the answer is kept in the browser's storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('excellents');

  // Return: the saved texts and choice are prefilled.
  await page.reload();
  await expect(field(page, fr.bilanCategoryFood)).toHaveValue('Les repas étaient excellents');
  await expect(field(page, fr.bilanCategoryWelcome)).toHaveValue('Accueil chaleureux');
  await expect(identity(page, fr.bilanIdentityAnonymous)).toBeChecked();

  // Edit and switch to named.
  await field(page, fr.bilanCategoryWelcome).fill('');
  await field(page, fr.bilanCategorySchedule).fill('Un peu serré le samedi');
  await identity(page, fr.bilanIdentityNamed).check({ force: true });
  await submitButton(page).click();
  await expect(body(page).getByRole('status')).toContainText(fr.bilanSavedTitle);
  await page.reload();
  await expect(field(page, fr.bilanCategoryWelcome)).toHaveValue('');
  await expect(field(page, fr.bilanCategorySchedule)).toHaveValue('Un peu serré le samedi');
  await expect(identity(page, fr.bilanIdentityNamed)).toBeChecked();
});

test('member: unsaved text survives the tab regaining focus, and stays out of storage', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.member);
  await page.goto(`/bilan/${seeded.eventId}`);
  await field(page, fr.bilanCategoryLodging).fill('Chalet un peu froid la nuit');

  // What the browser does when the member switches tabs and comes back; Supabase answers with an
  // auth event, which re-renders App (#139).
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(500);
  await expect(field(page, fr.bilanCategoryLodging)).toHaveValue('Chalet un peu froid la nuit');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('Chalet');
});

test('member: after the close, a named answer read-only', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await submitFeedbackAs(TEST_USERS.member, seeded.eventId, { safety: 'Rien à signaler', other: 'Merci!' }, false);
  await closeFeedback(seeded.eventId);
  await loginAs(page, TEST_USERS.member);

  // No card once closed.
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
  await expect(passCard(page)).toHaveCount(0);

  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'closed_named');
  await expect(body(page)).toContainText(fr.bilanClosedNamedTitle);
  await expect(body(page)).toContainText('Rien à signaler');
  await expect(body(page)).toContainText('Merci!');
  await expect(body(page).getByRole('textbox')).toHaveCount(0);
  await expect(body(page).getByRole('button', { name: fr.bilanSubmitEdit })).toHaveCount(0);
  await shoot(page, 'bilan-closed-named-member');
});

test('member: after the close, an anonymous answer is replaced by the message', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await submitFeedbackAs(TEST_USERS.member, seeded.eventId, { food: 'Texte anonyme du membre' }, true);
  await closeFeedback(seeded.eventId);
  await loginAs(page, TEST_USERS.member);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'closed');
  await expect(body(page)).toContainText(fr.bilanClosedTitle);
  await expect(body(page)).toContainText(fr.bilanClosedMessage);
  await expect(page.getByText('Texte anonyme du membre')).toHaveCount(0);
  await shoot(page, 'bilan-closed-member');
});

test('member: closed without an answer, not open yet, not eligible: French messages, no form', async ({ page }) => {
  // Closed, never answered: the same message as an anonymous answer.
  seeded = await seedFeedbackEvent();
  await closeFeedback(seeded.eventId);
  await loginAs(page, TEST_USERS.member);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'closed');
  await expect(body(page)).toContainText(fr.bilanClosedMessage);
  await teardownFeedbackEvent(seeded);

  // Running today (first day, #339): the card is already on the pass and the page takes answers.
  seeded = await seedFeedbackEvent({ startDaysAgo: 0, durationDays: 3 });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await expect(passCard(page)).toBeVisible();
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'open');
  await teardownFeedbackEvent(seeded);

  // Not started yet: no card on the pass, and the page says when it opens.
  seeded = await seedFeedbackEvent({ startDaysAgo: -10 });
  await page.goto('/');
  await expect(page.getByRole('article', { name: fr.passLabel })).toBeVisible();
  await expect(passCard(page)).toHaveCount(0);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'not_yet');
  await expect(body(page)).toContainText(fr.bilanNotYetTitle);
  await expect(body(page)).toContainText(fr.bilanNotYetMessage.split('{date}')[0]);
  await shoot(page, 'bilan-not-yet-member');
  await expect(body(page).getByRole('textbox')).toHaveCount(0);
});

test('admin: not registered, the page refuses; the database refuses a submit too', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.admin);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'not_eligible');
  await expect(body(page)).toContainText(fr.bilanNotEligibleMessage);
  await expect(body(page).getByRole('textbox')).toHaveCount(0);
  await shoot(page, 'bilan-not-eligible-admin');
  await expect(submitFeedbackAs(TEST_USERS.admin, seeded.eventId, { food: 'x' })).rejects.toThrow(/event_feedback_not_eligible/);
});

// « Voir comme » (ADR 0025): the member's own session, read-only. The page shows the database's
// hidden state, the same whether the member answered nothing, anonymously or named.
test('admin « Voir comme »: the same hidden state for no answer, an anonymous one and a named one', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.admin);

  const cases = [
    { name: 'none', submit: null },
    { name: 'anonymous', submit: () => submitFeedbackAs(TEST_USERS.member, seeded.eventId, { food: 'Secret anonyme' }, true) },
    { name: 'named', submit: () => submitFeedbackAs(TEST_USERS.member, seeded.eventId, { food: 'Secret signé' }, false) }
  ];
  const seen = [];
  for (const { name, submit } of cases) {
    if (submit) await submit();
    await endOpenImpersonations();
    await page.goto('/admin/users');
    await expect(adminMain(page).getByRole('button', { name: 'Test Member', exact: true })).toBeVisible();
    const dialog = await openPartyDetail(page);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), dialog.getByRole('button', { name: fr.voirCommeAction, exact: true }).click()]);
    await expect(tab.getByRole('status', { name: fr.voirCommeBannerLabel })).toBeVisible({ timeout: 30_000 });

    // The pass card doesn't depend on the answer; through it (a typed URL would end the session).
    await expect(passCard(tab)).toBeVisible();
    await passCard(tab).getByRole('link', { name: fr.bilanPassAction }).click();
    await expect(body(tab)).toHaveAttribute('data-state', 'hidden');
    await expect(body(tab)).toContainText(fr.bilanHiddenMessage);
    await expect(body(tab).getByRole('textbox')).toHaveCount(0);
    await expect(tab.getByText(/Secret/)).toHaveCount(0);
    if (name === 'named') await shoot(tab, 'bilan-voir-comme-admin');
    seen.push(await body(tab).innerText());
    await tab.close();
  }
  // Word for word the same page in the three cases.
  expect(new Set(seen).size).toBe(1);
});
