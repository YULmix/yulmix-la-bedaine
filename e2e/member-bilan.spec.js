// The member's retour page (#316), at /bilan/:eventId, over the database's my_event_feedback() and
// submit_event_feedback() (#315, #354, ADR 0029): the pass links to it while the window is open;
// per category a comment signed by default, a « Anonyme » switch, the other kind added beside it and
// never a third (#355); submit, return, edit, remove one or all; the explanation of who reads what;
// nothing to send while nothing is written or saved; after the close the signed comments read-only and one neutral message otherwise;
// the not-eligible and not-yet-open messages; « Voir comme » shows the same hidden state whether the
// member wrote signed, private or nothing; unsaved text survives a tab refocus and is never written
// to the browser's storage.
//
// Each test has its own fresh event (a retour's close is final, so the shared e2e event can't be
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
  feedbackAnswersAs,
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
// A comment's text: named by its card's title and its kind (#355).
const field = (page, label, isPrivate = false) =>
  body(page).getByRole('textbox', { name: isPrivate ? `${label} ${fr.bilanCommentPrivate}` : label, exact: true });
const privateSwitch = (page, label) => body(page).getByRole('switch', { name: fr.bilanPrivateSwitchLabel.replace('{category}', label), exact: true });
// A category's card on the form: the block under its title.
const card = (page, label) => body(page).getByRole('heading', { level: 3, name: label, exact: true }).locator('xpath=../..');
const submitButton = page => body(page).getByRole('button', { name: fr.bilanSubmit, exact: true });
const kinds = locator => locator.getByTestId('bilan-comment').evaluateAll(comments => comments.map(comment => comment.dataset.kind));

// The categories in display order, with their colour (#346's cycle, shared with the admin Bilan
// through FeedbackCategoryCard, #352).
const CATEGORIES = [
  ['bilanCategoryWelcome', 'tint-neon'], ['bilanCategoryPartyMusic', 'tint-info'], ['bilanCategorySafety', 'tint-ok'],
  ['bilanCategoryLodging', 'tint-warn'], ['bilanCategoryFood', 'tint-neon'], ['bilanCategoryCommunications', 'tint-info'],
  ['bilanCategorySchedule', 'tint-ok'], ['bilanCategoryOther', 'tint-warn']
];
// A card's header: the tinted strip holding the icon chip and the title.
const cardHeader = title => title.locator('xpath=..');

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

test('switch off (#341): the member sees no card and the page says it is not open; the admin still sees the card and can answer', async ({ page, browser }) => {
  seeded = await seedFeedbackEvent({ memberVisible: false, adminRegistered: true });
  await loginAs(page, TEST_USERS.member);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(passCard(page)).toHaveCount(0);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'not_yet');
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

test('member: from the pass, a signed and a private comment on one card, return, edit, remove', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.member);

  // The pass links to the retour while it is open, with its close date.
  await expect(passCard(page)).toBeVisible();
  await expect(passCard(page)).toContainText(fr.bilanPassTitle);
  await shoot(page, 'bilan-pass-card-member');
  await passCard(page).getByRole('link', { name: fr.bilanPassAction }).click();
  await expect(page).toHaveURL(new RegExp(`/bilan/${seeded.eventId}$`));
  await expect(body(page)).toHaveAttribute('data-state', 'open');

  // The eight categories, each one blank comment, signed, its « Anonyme » switch off.
  for (const [key] of CATEGORIES) {
    await expect(field(page, fr[key])).toBeVisible();
    await expect(privateSwitch(page, fr[key])).toHaveAttribute('aria-checked', 'false');
  }
  await expect(body(page).getByRole('textbox')).toHaveCount(CATEGORIES.length);
  // Each a card (#352): its title in a header tinted with the category's colour, with an icon; one
  // icon per category; the textareas in display order, one column.
  const cards = await body(page).getByRole('textbox').evaluateAll(areas => areas.map(area => {
    const title = document.getElementById(area.getAttribute('aria-labelledby').split(' ')[0]);
    const header = title.parentElement;
    return { label: title.textContent, header: header.textContent, tint: header.className.match(/\btint-\w+/)?.[0], icon: header.querySelector('svg')?.innerHTML };
  }));
  expect(cards.map(entry => [entry.label, entry.tint])).toEqual(CATEGORIES.map(([key, tint]) => [fr[key], tint]));
  // No count on the member's card, and one icon per category.
  expect(cards.map(entry => entry.header)).toEqual(cards.map(entry => entry.label));
  expect(new Set(cards.map(entry => entry.icon)).size).toBe(CATEGORIES.length);
  // One column on a phone and on a wide screen.
  for (const [width, height] of [[390, 844], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    const lefts = await body(page).getByRole('textbox').evaluateAll(areas => areas.map(area => Math.round(area.getBoundingClientRect().left)));
    expect(new Set(lefts).size, `one column at ${width}px`).toBe(1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  // Tab order: a card's text, then its switch, then the next card.
  await field(page, fr.bilanCategoryWelcome).focus();
  for (const [key] of CATEGORIES.slice(1)) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(field(page, fr[key])).toBeFocused();
  }
  await page.evaluate(() => document.activeElement?.blur());

  // Who reads what, live: no word of a close hiding anything, and none of the admins' or builders' words.
  const whoSees = body(page).getByTestId('bilan-who-sees');
  await expect(whoSees).toContainText(fr.bilanWhoSeesSigned);
  await expect(whoSees).toContainText(fr.bilanWhoSeesPrivate);
  await expect(whoSees).toContainText(fr.bilanWhoSeesAfterClose.split('{date}')[0]);
  await expect(body(page)).not.toContainText(/bilan|voir comme|levée|signée|n'importe quel appareil|aucune réponse n'est lue|pas montrée aux administrateurs/i);
  await shoot(page, 'bilan-form-member');

  // Every text field opts out of password managers; the toggle reads « Anonyme »; no « signé »/« privé ».
  for (const area of await body(page).getByRole('textbox').all()) {
    await expect(area).toHaveAttribute('autocomplete', 'off');
    for (const opt of ['data-1p-ignore', 'data-lpignore', 'data-bwignore']) await expect(area).toHaveAttribute(opt, 'true');
  }
  await expect(body(page).getByText(fr.bilanPrivateToggle, { exact: true }).first()).toBeVisible();
  await expect(body(page)).not.toContainText(/signé|privé/i);

  // Annuler: disabled until something changes, then drops the edits.
  const cancelButton = body(page).getByRole('button', { name: fr.bilanCancel, exact: true });
  await expect(cancelButton).toBeDisabled();
  await field(page, fr.bilanCategoryFood).fill('À jeter');
  await expect(cancelButton).toBeEnabled();
  await cancelButton.click();
  await expect(field(page, fr.bilanCategoryFood)).toHaveValue('');
  await expect(cancelButton).toBeDisabled();

  // Nothing written and nothing saved: nothing to send (blank text counts as nothing).
  await expect(submitButton(page)).toBeDisabled();
  await field(page, fr.bilanCategoryFood).fill('   ');
  await expect(submitButton(page)).toBeDisabled();
  await field(page, fr.bilanCategoryFood).fill('');

  // « Party + musique »: a signed comment, then the private one added beside it; the focus follows.
  const party = card(page, fr.bilanCategoryPartyMusic);
  await expect(party.getByRole('button', { name: fr.bilanAddPrivate })).toHaveCount(0);
  await field(page, fr.bilanCategoryPartyMusic).fill('Le DJ du samedi était génial');
  await party.getByRole('button', { name: fr.bilanAddPrivate }).click();
  await expect(field(page, fr.bilanCategoryPartyMusic, true)).toBeFocused();
  await page.keyboard.type('Le son était trop fort près du bar');
  // Two comments: no third offered, and no switch (it would make two of one kind).
  await expect(party.getByRole('button', { name: new RegExp(`^(${fr.bilanAddPrivate}|${fr.bilanAddSigned})$`) })).toHaveCount(0);
  await expect(privateSwitch(page, fr.bilanCategoryPartyMusic)).toHaveCount(0);
  expect(await kinds(party)).toEqual(['signed', 'private']);

  // « Nourriture »: the switch makes the one comment private; then a signed one can be added.
  const food = card(page, fr.bilanCategoryFood);
  await field(page, fr.bilanCategoryFood).fill('Les repas étaient excellents');
  await privateSwitch(page, fr.bilanCategoryFood).click();
  await expect(field(page, fr.bilanCategoryFood, true)).toHaveValue('Les repas étaient excellents');
  await expect(food).toContainText(fr.bilanPrivateHint);
  await expect(food.getByRole('button', { name: fr.bilanAddSigned })).toBeVisible();
  await shoot(page, 'bilan-form-both-member');

  await submitButton(page).click();
  await expect(body(page).getByRole('status')).toContainText(fr.bilanSavedTitle);
  await expect(submitButton(page)).toHaveText(fr.bilanSubmit);
  await shoot(page, 'bilan-saved-member');

  // Nothing of the answer is kept in the browser's storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('excellents');
  expect(stored).not.toContain('trop fort');

  // Annuler after the save returns to the saved state, a removed comment included.
  await field(page, fr.bilanCategoryFood, true).fill('Autre chose');
  await body(page).getByRole('button', { name: fr.bilanCancel, exact: true }).click();
  await expect(field(page, fr.bilanCategoryFood, true)).toHaveValue('Les repas étaient excellents');

  // Return: both kinds on the « Party + musique » card, the private one on « Nourriture ».
  await page.reload();
  await expect(field(page, fr.bilanCategoryPartyMusic)).toHaveValue('Le DJ du samedi était génial');
  await expect(field(page, fr.bilanCategoryPartyMusic, true)).toHaveValue('Le son était trop fort près du bar');
  expect(await kinds(card(page, fr.bilanCategoryPartyMusic))).toEqual(['signed', 'private']);
  await expect(field(page, fr.bilanCategoryFood, true)).toHaveValue('Les repas étaient excellents');
  await expect(privateSwitch(page, fr.bilanCategoryFood)).toHaveAttribute('aria-checked', 'true');
  // The admin reads the signed one live, with its author.
  let answers = await feedbackAnswersAs(TEST_USERS.admin, seeded.eventId);
  expect(answers.signed.map(item => [item.category, item.text])).toEqual([['party_music', 'Le DJ du samedi était génial']]);

  // Remove the signed comment, edit another: the private one stays alone, and the admin no longer sees it.
  await card(page, fr.bilanCategoryPartyMusic)
    .getByRole('button', { name: fr.bilanRemoveSignedLabel.replace('{category}', fr.bilanCategoryPartyMusic) }).click();
  await expect(field(page, fr.bilanCategoryPartyMusic, true)).toBeFocused();
  await field(page, fr.bilanCategorySchedule).fill('Un peu serré le samedi');
  await submitButton(page).click();
  await expect(body(page).getByRole('status')).toContainText(fr.bilanSavedTitle);
  await page.reload();
  await expect(card(page, fr.bilanCategoryPartyMusic).getByRole('textbox')).toHaveCount(1);
  await expect(field(page, fr.bilanCategoryPartyMusic, true)).toHaveValue('Le son était trop fort près du bar');
  await expect(field(page, fr.bilanCategorySchedule)).toHaveValue('Un peu serré le samedi');
  answers = await feedbackAnswersAs(TEST_USERS.admin, seeded.eventId);
  expect(answers.signed.map(item => [item.category, item.text])).toEqual([['schedule', 'Un peu serré le samedi']]);

  // Remove everything and save: the empty set deletes all the member's comments (#354), signed and private.
  for (const [label, isPrivate] of [[fr.bilanCategoryPartyMusic, true], [fr.bilanCategoryFood, true], [fr.bilanCategorySchedule, false]]) {
    await card(page, label)
      .getByRole('button', { name: (isPrivate ? fr.bilanRemovePrivateLabel : fr.bilanRemoveSignedLabel).replace('{category}', label) }).click();
  }
  await expect(body(page).getByRole('textbox')).toHaveCount(CATEGORIES.length);
  await expect(submitButton(page)).toBeEnabled();
  await submitButton(page).click();
  await expect(body(page).getByRole('status')).toContainText(fr.bilanSavedTitle);
  await expect(submitButton(page)).toHaveText(fr.bilanSubmit);
  await expect(submitButton(page)).toBeDisabled();
  await page.reload();
  for (const [key] of CATEGORIES) {
    await expect(field(page, fr[key])).toHaveValue('');
  }
  await expect(body(page).getByTestId('bilan-comment')).toHaveCount(CATEGORIES.length);
  answers = await feedbackAnswersAs(TEST_USERS.admin, seeded.eventId);
  expect(answers.signed).toEqual([]);
  expect(answers.private).toEqual([]);
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

test('member: after the close, the signed comments read-only, the private ones not shown', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await submitFeedbackAs(TEST_USERS.member, seeded.eventId, [
    { category: 'safety', private: false, text: 'Rien à signaler' },
    { category: 'safety', private: true, text: 'Texte privé du membre' },
    { category: 'other', private: false, text: 'Merci!' }
  ]);
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
  await expect(body(page)).toContainText(fr.bilanClosedNamedMessage);
  await expect(page.getByText('Texte privé du membre')).toHaveCount(0);
  await expect(body(page).getByRole('textbox')).toHaveCount(0);
  await expect(body(page).getByRole('switch')).toHaveCount(0);
  await expect(body(page).getByRole('button', { name: fr.bilanSubmit })).toHaveCount(0);
  // The answered categories only, as read-only cards in the form's style and colours (#352).
  await expect(body(page).getByRole('heading', { level: 3 })).toHaveText([fr.bilanCategorySafety, fr.bilanCategoryOther]);
  await expect(body(page).getByRole('region', { name: fr.bilanCategorySafety })).toContainText('Rien à signaler');
  await expect(body(page).getByRole('region', { name: fr.bilanCategoryOther })).toContainText('Merci!');
  await expect(cardHeader(body(page).getByRole('heading', { name: fr.bilanCategorySafety }))).toHaveClass(/\btint-ok\b/);
  await expect(cardHeader(body(page).getByRole('heading', { name: fr.bilanCategoryOther }))).toHaveClass(/\btint-warn\b/);
  await expect(body(page)).not.toContainText(/bilan/i);
  await shoot(page, 'bilan-closed-named-member');
});

test('member: after the close, private comments only: the neutral message', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await submitFeedbackAs(TEST_USERS.member, seeded.eventId, { food: 'Texte privé du membre' }, true);
  await closeFeedback(seeded.eventId);
  await loginAs(page, TEST_USERS.member);
  await page.goto(`/bilan/${seeded.eventId}`);
  await expect(body(page)).toHaveAttribute('data-state', 'closed');
  await expect(body(page)).toContainText(fr.bilanClosedTitle);
  await expect(body(page)).toContainText(fr.bilanClosedMessage);
  await expect(page.getByText('Texte privé du membre')).toHaveCount(0);
  await shoot(page, 'bilan-closed-member');
});

test('member: closed without an answer, not open yet, not eligible: French messages, no form', async ({ page }) => {
  // Closed, never answered: the same message as private comments only.
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
// hidden state, the same whether the member wrote nothing, private comments or signed ones.
test('admin « Voir comme »: the same hidden state for no comment, a private one and a signed one', async ({ page }) => {
  seeded = await seedFeedbackEvent();
  await loginAs(page, TEST_USERS.admin);

  const cases = [
    { name: 'none', submit: null },
    { name: 'private', submit: () => submitFeedbackAs(TEST_USERS.member, seeded.eventId, { food: 'Secret privé' }, true) },
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
