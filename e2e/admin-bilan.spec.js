// The admin « Bilan » section (#317) over the database's event_feedback_counts() (#345/#346) and
// event_feedback_answers() (#315, ADR 0029). The counts dashboard (#346): before the close the
// counts and the close date only (no text, author or time, on screen or in a payload; the answers
// aren't even asked for), « moins de 3 » and the signed rate below 3 anonymous answers, 0 answers,
// no eligible registration, no reload by itself. After the close the same dashboard, consistent
// with the answers below it, grouped by category, named ones with their author, anonymous ones as
// « Anonyme » in the database's order, with nothing in the page or the payload that leads back to
// their authors; none listed when the database shows none (2 here; 0 and 1 are the same `[]`); an
// empty event, the loading and error states; Comité and Organisateur don't get the section.
//
// Each test has its own fresh event (a bilan's close is final, so the shared e2e event can't be
// reused), made the active one: the spec runs in its own serial project.
//
// E2E_SCREENSHOT_DIR=<dir> saves the section at 390, 1440, 1920x1080 and 2560x1440.
import { test, expect } from './support/test.js';
import { readFileSync } from 'node:fs';
import { adminMain, adminNav, openSection, sectionLink } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  closeFeedback,
  createThrowawayMember,
  deleteThrowawayMember,
  grantEditionRoles,
  revokeEditionRoles,
  rpcAs,
  seedFeedbackEvent,
  submitFeedbackAs,
  teardownFeedbackEvent
} from './support/testData.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const SIZES = [[390, 844], [1440, 900], [1920, 1080], [2560, 1440]];

let seeded = [];
let throwaways = [];

test.afterEach(async () => {
  for (const event of seeded) {
    await revokeEditionRoles(event.eventId);
    await teardownFeedbackEvent(event);
  }
  for (const member of throwaways) await deleteThrowawayMember(member.id);
  seeded = [];
  throwaways = [];
});

async function seedEvent(options) {
  const event = await seedFeedbackEvent(options);
  seeded.push(event);
  return event;
}

// `count` more members registered on the event, each answering anonymously with `answers(i)`.
async function anonymousAnswers(eventId, count, answers) {
  const members = [];
  for (let i = 0; i < count; i++) {
    const member = await createThrowawayMember(`bilan-anon-${i}`);
    throwaways.push(member);
    await addParty(member.id, eventId);
    await submitFeedbackAs(member, eventId, answers(i), true);
    members.push(member);
  }
  return members;
}

const answersBox = page => page.getByTestId('bilan-answers');
const dashboard = page => page.getByTestId('bilan-dashboard');
const category = (page, name) => adminMain(page).getByRole('region', { name });
const isAnswersCall = response => response.url().includes('/rpc/event_feedback_answers');
const categoryName = c => fr[{ welcome: 'bilanCategoryWelcome', party_music: 'bilanCategoryPartyMusic', safety: 'bilanCategorySafety', lodging: 'bilanCategoryLodging', food: 'bilanCategoryFood', communications: 'bilanCategoryCommunications', schedule: 'bilanCategorySchedule', other: 'bilanCategoryOther' }[c]];
const isCountsCall = response => response.url().includes('/rpc/event_feedback_counts');
const forEvent = (isCall, eventId) => response => isCall(response) && (response.request().postData() ?? '').includes(eventId);
// A figure cell of the dashboard, by its label.
const cell = (page, label) => dashboard(page).locator('div.bg-surface').filter({ has: page.getByText(label, { exact: true }) });

// The dashboard's three figures: signed, anonymous (a number, or « moins de 3 »), and the rate
// with its label (« Taux de réponse » or « Taux de réponse (signées) ») over `eligible`.
async function expectCounts(page, { signed, anonymous, rate, eligible }) {
  const hidden = anonymous === null;
  await expect(cell(page, fr.adminBilanCountsSigned)).toHaveText(fr.adminBilanCountsSigned + signed + fr.adminBilanCountsSignedHint);
  await expect(cell(page, fr.adminBilanCountsAnonymous)).toHaveText(fr.adminBilanCountsAnonymous
    + (hidden ? fr.adminBilanCountsAnonymousHidden + fr.adminBilanCountsAnonymousHiddenHint : anonymous + fr.adminBilanCountsAnonymousHint));
  const rateLabel = hidden ? fr.adminBilanCountsRateSigned : fr.adminBilanCountsRate;
  const onEligible = eligible === 1 ? fr.adminBilanCountsEligibleOne : fr.adminBilanCountsEligible.replace('{n}', eligible);
  await expect(cell(page, rateLabel)).toHaveText(`${rateLabel}${rate} %${onEligible}`);
  await expect(dashboard(page).getByRole('img'))
    .toHaveAccessibleName((hidden ? fr.adminBilanCountsBarSigned : fr.adminBilanCountsBarAll).replace('{rate}', rate));
}
// The French date the page shows for a 'YYYY-MM-DD' (src/lib/format.js formatDate).
const frenchDate = day => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
};

// Opens the section on an event, by its picker, and returns the payloads of event_feedback_counts()
// and, after the close, event_feedback_answers() (null before it: the page doesn't ask).
async function openBilan(page, eventId, { closed = true } = {}) {
  const counts = page.waitForResponse(forEvent(isCountsCall, eventId));
  const answers = closed ? page.waitForResponse(forEvent(isAnswersCall, eventId)) : null;
  await page.goto('/admin/bilan');
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabBilan })).toBeVisible();
  const picker = adminMain(page).getByLabel(fr.adminBilanEventLabel);
  if (await picker.inputValue() !== eventId) await picker.selectOption(eventId);
  const payload = { counts: await (await counts).json(), answers: answers && await (await answers).json() };
  await expect(answersBox(page)).toHaveAttribute('data-state', closed ? 'closed' : 'not_closed');
  return payload;
}

async function shoot(page, name) {
  if (!SHOTS) return;
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, `${name} at ${width}px scrolls sideways`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('admin, before the close: the counts and the close date; no text, author or time, on screen or in a payload', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { welcome: 'Accueil secret avant clôture' }, false);
  await anonymousAnswers(event.eventId, 3, i => ({ food: `Repas anonyme ${i}` }));
  const counted = [];
  page.on('request', request => {
    if (request.url().includes('/rest/v1/user_parties') && request.method() === 'HEAD') counted.push(request.url());
  });
  let answersCalled = false;
  let countsCalls = 0;
  page.on('request', request => {
    if (isAnswersCall(request)) answersCalled = true;
    if (isCountsCall(request)) countsCalls += 1;
  });
  await loginAs(page, TEST_USERS.admin);

  // Through the navigation, as an admin would.
  await page.goto('/admin/overview');
  await expect(sectionLink(page, fr.adminTabOverview)).toBeVisible();
  const counted$ = page.waitForResponse(isCountsCall);
  await openSection(page, fr.adminTabBilan);
  await expect(page).toHaveURL(/\/admin\/bilan$/);
  const payload = await (await counted$).json();

  // Counts only: the member's signed answer and the three anonymous ones, on four registrations.
  expect(payload).toEqual({ closed: false, closes_on: expect.any(String), eligible: 4, signed: 1, anonymous: 3, total: 4 });
  await expect(answersBox(page)).toHaveAttribute('data-state', 'not_closed');
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsTitle);
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsBeforeClose);
  await expectCounts(page, { signed: 1, anonymous: 3, rate: 100, eligible: 4 });
  await expect(answersBox(page)).toContainText(fr.adminBilanNotClosedTitle);
  await expect(answersBox(page)).toContainText(fr.adminBilanNotClosedMessage.replace('{date}', frenchDate(payload.closes_on)));
  await expect(adminMain(page)).not.toContainText('Accueil secret');
  await expect(adminMain(page)).not.toContainText('Repas anonyme');
  // No time anywhere in the section: the close date is its only date.
  await expect(answersBox(page)).not.toContainText(/\d{1,2}[:h]\d{2}/);
  await expect(answersBox(page).locator('time')).toHaveCount(0);
  expect(answersCalled).toBe(false);
  expect(counted).toEqual([]);

  // No polling: once loaded (twice in dev, React's StrictMode), nothing asks again by itself.
  const loaded = countsCalls;
  expect(loaded).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  expect(countsCalls).toBe(loaded);
  await shoot(page, 'bilan-before-ge3-admin');
});

test('admin, before the close with two anonymous answers: « moins de 3 », the signed rate only, and no total in the payload', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { welcome: 'Signé' }, false);
  await anonymousAnswers(event.eventId, 2, i => ({ food: `Repas anonyme ${i}` }));
  // A fourth registration that didn't answer: 1 signed on 4 = 25 %.
  const silent = await createThrowawayMember('bilan-silent');
  throwaways.push(silent);
  await addParty(silent.id, event.eventId);
  await loginAs(page, TEST_USERS.admin);

  const { counts } = await openBilan(page, event.eventId, { closed: false });
  expect(counts).toMatchObject({ closed: false, eligible: 4, signed: 1, anonymous: null, total: null });
  await expectCounts(page, { signed: 1, anonymous: null, rate: 25, eligible: 4 });
  await expect(cell(page, fr.adminBilanCountsRate)).toHaveCount(0);
  await shoot(page, 'bilan-before-lt3-admin');
});

test('admin, before the close: no answer yet, then no eligible registration', async ({ page }) => {
  const event = await seedEvent();
  await loginAs(page, TEST_USERS.admin);
  const { counts } = await openBilan(page, event.eventId, { closed: false });
  expect(counts).toMatchObject({ eligible: 1, signed: 0, anonymous: null, total: null });
  await expectCounts(page, { signed: 0, anonymous: null, rate: 0, eligible: 1 });
  await shoot(page, 'bilan-before-empty-admin');

  // Without its one registration: the card and its tag, a sentence, no figure and no bar.
  await teardownFeedbackEvent({ partyId: event.partyId });
  const again = await openBilan(page, event.eventId, { closed: false });
  expect(again.counts).toMatchObject({ eligible: 0, signed: 0 });
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsNoEligible);
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsBeforeClose);
  await expect(dashboard(page).getByRole('img')).toHaveCount(0);
  await expect(dashboard(page)).not.toContainText(fr.adminBilanCountsSigned);
  await shoot(page, 'bilan-before-noeligible-admin');
});

test('admin, after the close: named answers with their author, anonymous ones as « Anonyme » in the database\'s order, nothing leading back to their authors', async ({ page }) => {
  // A past edition: not the active event, picked in the section.
  const event = await seedEvent({ active: false });
  await submitFeedbackAs(TEST_USERS.member, event.eventId,
    { welcome: 'Accueil chaleureux, merci!', food: 'Repas copieux', other: 'Vivement l\'an prochain' }, false);
  const anonymous = await anonymousAnswers(event.eventId, 3, i => ({
    welcome: `Accueil anonyme ${i}`,
    ...(i !== 1 && { food: `Nourriture anonyme ${i}` }),
    ...(i === 2 && { safety: 'Un peu sombre près du feu la nuit, prévoir des lampes.\nSinon rien à signaler.' })
  }));
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.admin);

  const { counts, answers: payload } = await openBilan(page, event.eventId);
  expect(counts).toMatchObject({ closed: true, eligible: 4, signed: 1, anonymous: 3, total: 4 });
  expect(payload.closed).toBe(true);
  expect(payload.named).toHaveLength(1);
  expect(payload.anonymous).toHaveLength(3);
  // An anonymous answer is its texts, nothing else; no anonymous author anywhere in the payload.
  for (const entry of payload.anonymous) expect(Object.keys(entry)).toEqual(['answers']);
  const raw = JSON.stringify(payload);
  for (const member of anonymous) {
    for (const trace of [member.id, member.email, member.fullName]) expect(raw).not.toContain(trace);
  }

  await expect(answersBox(page)).toHaveAttribute('data-state', 'closed');
  // The dashboard, closed on its date: the answers listed below, on the four registrations.
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsClosedOn.split('{date}')[0]);
  await expect(dashboard(page)).not.toContainText(fr.adminBilanCountsBeforeClose);
  await expectCounts(page, { signed: 1, anonymous: 3, rate: 100, eligible: 4 });
  await expect(answersBox(page).getByText(fr.adminBilanNotClosedTitle)).toHaveCount(0);
  // Every category, in order.
  await expect(adminMain(page).locator('h2[id^="bilan-category-"]'))
    .toHaveText(['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'].map(categoryName));
  // Their colours cycle in that order, the same as on the member's retour form (#352).
  const tints = await adminMain(page).locator('h2[id^="bilan-category-"]')
    .evaluateAll(titles => titles.map(title => title.parentElement.className.match(/\btint-\w+/)?.[0]));
  expect(tints).toEqual(['tint-neon', 'tint-info', 'tint-ok', 'tint-warn', 'tint-neon', 'tint-info', 'tint-ok', 'tint-warn']);

  // Accueil: the named answer with its author, then the three anonymous ones, in the payload's order.
  const welcome = category(page, fr.bilanCategoryWelcome);
  const items = welcome.getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toHaveText('Test Member' + 'Accueil chaleureux, merci!');
  const order = payload.anonymous.map(entry => entry.answers.welcome);
  await expect(items).toHaveText(['Test Member' + 'Accueil chaleureux, merci!', ...order.map(text => fr.adminBilanAnonymous + text)]);
  // Nourriture: two anonymous ones (the second member left it blank), in the payload's order.
  const foodOrder = payload.anonymous.map(entry => entry.answers.food).filter(Boolean);
  await expect(category(page, fr.bilanCategoryFood).getByRole('listitem'))
    .toHaveText(['Test Member' + 'Repas copieux', ...foodOrder.map(text => fr.adminBilanAnonymous + text)]);
  await expect(category(page, fr.bilanCategorySchedule)).toContainText(fr.adminBilanCategoryEmpty);

  // Nothing in the page names an anonymous author or carries an id or date of one.
  const html = await adminMain(page).innerHTML();
  for (const member of anonymous) {
    for (const trace of [member.id, member.email, member.fullName]) expect(html).not.toContain(trace);
  }
  const anonymousItem = welcome.getByRole('listitem').filter({ hasText: order[0] });
  expect(await anonymousItem.evaluate(li => li.getAttributeNames())).toEqual(['class']);
  await shoot(page, 'bilan-closed-admin');
});

test('admin, after the close with two anonymous answers: « moins de 3 », and none of them in the payload', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { lodging: 'Chalet parfait' }, false);
  await anonymousAnswers(event.eventId, 2, i => ({ lodging: `Hébergement anonyme ${i}` }));
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.admin);

  const { counts, answers: payload } = await openBilan(page, event.eventId);
  expect(payload).toMatchObject({ closed: true, anonymous: [] });
  expect(counts).toMatchObject({ closed: true, eligible: 3, signed: 1, anonymous: null, total: null });
  expect(JSON.stringify(payload)).not.toContain('Hébergement anonyme');
  await expectCounts(page, { signed: 1, anonymous: null, rate: 33, eligible: 3 });
  await expect(category(page, fr.bilanCategoryLodging).getByRole('listitem')).toHaveText(['Test Member' + 'Chalet parfait']);
  await expect(adminMain(page).getByText(fr.adminBilanAnonymous, { exact: true })).toHaveCount(0);
  await shoot(page, 'bilan-two-anonymous-admin');
});

test('admin: an event without answers, then loading and error states, in French', async ({ page }) => {
  const event = await seedEvent();
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.admin);

  // Loading: held until released, then an error with « Réessayer », then the answers.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let fail = true;
  await page.route('**/rpc/event_feedback_counts', async route => {
    await held;
    if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom', code: 'XX000' }) });
    else await route.fallback();
  });
  await page.goto('/admin/bilan');
  await expect(answersBox(page)).toHaveAttribute('data-state', 'loading');
  await expect(answersBox(page).locator('[aria-busy="true"]')).toBeVisible();
  release();
  await expect(answersBox(page)).toHaveAttribute('data-state', 'error');
  await expect(answersBox(page)).toContainText(fr.adminLoadError);
  await expect(answersBox(page)).toContainText(fr.adminBilanLoadError);
  await shoot(page, 'bilan-error-admin');

  fail = false;
  await answersBox(page).getByRole('button', { name: fr.retry }).click();
  await expect(answersBox(page)).toHaveAttribute('data-state', 'closed');
  // No answer: the empty state, and the dashboard's zeros (« moins de 3 » as with one or two).
  await expect(answersBox(page)).toContainText(fr.adminBilanEmptyTitle);
  await expectCounts(page, { signed: 0, anonymous: null, rate: 0, eligible: 1 });
  await expect(category(page, fr.bilanCategoryWelcome)).toHaveCount(0);
  await shoot(page, 'bilan-empty-admin');
});

for (const role of ['committee', 'organiser']) {
  test(`${role}: no « Bilan » entry, the URL redirects to Résumé, and the database refuses the read`, async ({ page }) => {
    const event = await seedEvent();
    await submitFeedbackAs(TEST_USERS.member, event.eventId, { welcome: 'Lu par les admins seulement' }, false);
    await closeFeedback(event.eventId);
    await grantEditionRoles(event.eventId);
    let called = false;
    page.on('request', request => { if (isAnswersCall(request) || isCountsCall(request)) called = true; });
    await loginAs(page, TEST_USERS[role]);

    await page.goto('/admin/overview');
    await expect(adminNav(page)).toBeVisible();
    await expect(adminNav(page).getByRole('link', { name: fr.adminTabBilan })).toHaveCount(0);
    await page.goto('/admin/bilan');
    await expect(page).toHaveURL(/\/admin\/overview$/);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/admin\/bilan$/);
    await expect(page.getByText('Lu par les admins seulement')).toHaveCount(0);
    expect(called).toBe(false);

    const error = await rpcAs(TEST_USERS[role], 'event_feedback_answers', { p_event_id: event.eventId });
    expect(error?.message).toBe('admin_only');
    const countsError = await rpcAs(TEST_USERS[role], 'event_feedback_counts', { p_event_id: event.eventId });
    expect(countsError?.message).toBe('admin_only');
  });
}

test('member: no admin, no answers', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { welcome: 'Mon propre texte' }, false);
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/bilan');
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabBilan })).toHaveCount(0);
  await expect(page.getByTestId('bilan-answers')).toHaveCount(0);
  const error = await rpcAs(TEST_USERS.member, 'event_feedback_answers', { p_event_id: event.eventId });
  expect(error?.message).toBe('admin_only');
});
