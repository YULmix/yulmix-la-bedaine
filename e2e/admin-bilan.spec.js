// The admin « Bilan » section (#317, live since #356) over the database's event_feedback_counts()
// (#345/#346) and event_feedback_answers() (#315, ADR 0029), on the per-item payloads of #354. The
// same screen before and after the close: the « Réponses reçues » dashboard (signed comments,
// private ones or « moins de 3 », the members who signed over the eligible registrations, no
// breakdown per category, #363), its tag saying whether the window is open or closed, then the comments by
// category. Signed ones show live, with their author and no date, on the next load; private ones
// only once 3 different members wrote one, with nothing that leads back to their authors (not in
// the page, not in a payload), in the database's order. No polling. An event never released stays
// hidden after the close. No eligible registration, the loading and error states; Comité,
// Organisateur and members don't get the section.
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
const CATEGORIES = ['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'];
const categoryName = c => fr[{ welcome: 'bilanCategoryWelcome', party_music: 'bilanCategoryPartyMusic', safety: 'bilanCategorySafety', lodging: 'bilanCategoryLodging', food: 'bilanCategoryFood', communications: 'bilanCategoryCommunications', schedule: 'bilanCategorySchedule', other: 'bilanCategoryOther' }[c]];

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

// More members registered on the event, one per name.
async function registered(eventId, names) {
  const members = [];
  for (const [i, fullName] of names.entries()) {
    const member = await createThrowawayMember(`bilan-${i}`, { fullName });
    throwaways.push(member);
    await addParty(member.id, eventId);
    members.push(member);
  }
  return members;
}

const answersBox = page => page.getByTestId('bilan-answers');
const dashboard = page => page.getByTestId('bilan-dashboard');
const category = (page, name) => adminMain(page).getByRole('region', { name });
const isAnswersCall = response => response.url().includes('/rpc/event_feedback_answers');
const isCountsCall = response => response.url().includes('/rpc/event_feedback_counts');
const forEvent = (isCall, eventId) => response => isCall(response) && (response.request().postData() ?? '').includes(eventId);
// A figure cell of the dashboard, by its label.
const cell = (page, label) => dashboard(page).locator('div.bg-surface').filter({ has: page.getByText(label, { exact: true }) });
const categoryCards = page => adminMain(page).locator('section[aria-labelledby^="bilan-category-"]');

// The dashboard's figures: signed comments, private ones (a number, or null for « moins de 3 »),
// the members who signed over `eligible`.
async function expectCounts(page, { signed, private: privateTotal, members, eligible }) {
  const hidden = privateTotal === null;
  const rate = eligible > 0 ? Math.round((members / eligible) * 100) : 0;
  await expect(cell(page, fr.adminBilanCountsSigned)).toHaveText(fr.adminBilanCountsSigned + signed + fr.adminBilanCountsSignedHint);
  await expect(cell(page, fr.adminBilanCountsPrivate)).toHaveText(fr.adminBilanCountsPrivate
    + (hidden ? fr.adminBilanCountsPrivateHidden + fr.adminBilanCountsPrivateHiddenHint : privateTotal + fr.adminBilanCountsPrivateHint));
  await expect(cell(page, fr.adminBilanCountsMembers)).toHaveText(fr.adminBilanCountsMembers
    + `${members} ${fr.adminBilanCountsMembersOf.replace('{n}', eligible)}` + fr.adminBilanCountsMembersHint.replace('{rate}', rate));
  await expect(dashboard(page).getByRole('img'))
    .toHaveAccessibleName(fr.adminBilanCountsBar.replace('{n}', members).replace('{eligible}', eligible).replace('{rate}', rate));
}

// Each category's counts match its card: the payload's signed and private (or null) numbers, the
// card's count, and the comments it lists, against the payloads. The dashboard shows no per-category tile (#363).
async function expectCategoriesMatch(page, { counts, answers }) {
  for (const c of CATEGORIES) {
    const row = counts.categories.find(entry => entry.category === c);
    const signed = answers.signed.filter(item => item.category === c).length;
    const shown = answers.private.filter(item => item.category === c).length;
    expect(row.signed, `${c} signed`).toBe(signed);
    expect(row.private, `${c} private`).toBe(counts.released ? shown : null);
    const card = category(page, categoryName(c));
    await expect(card.locator('h2 + span')).toHaveText(String(signed + shown));
    await expect(card.getByRole('listitem')).toHaveCount(signed + shown);
  }
}

// #363: no per-category tile in the dashboard, and the summary card is never wider than two columns
// of the category-card grid below it (one column at 390). Checked at every screenshot width.
async function expectSummaryWidth(page) {
  await expect(dashboard(page).getByRole('listitem')).toHaveCount(0);
  await expect(dashboard(page)).not.toContainText(/Par catégorie/);
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    const { card, first, second, columns } = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const cards = [...document.querySelectorAll('section[aria-labelledby^="bilan-category-"]')].map(box);
      const rowTop = cards[0].top;
      const row = cards.filter(c => Math.abs(c.top - rowTop) < 2);
      return { card: box(document.querySelector('[data-testid="bilan-dashboard"]')).width, first: row[0].width, second: row[1]?.width ?? null, columns: row.length };
    });
    const gap = 16;
    const limit = columns === 1 ? first : first * Math.min(columns, 2) + gap * (Math.min(columns, 2) - 1);
    expect(card, `summary card at ${width}px (${columns} columns, ${first}/${second})`).toBeLessThanOrEqual(limit + 1);
    if (width === 390) expect(columns).toBe(1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

// The French date the page shows for a 'YYYY-MM-DD' (src/lib/format.js formatDate).
const frenchDate = day => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
};

// Opens the section on an event, by its picker, and returns the payloads of event_feedback_counts()
// and event_feedback_answers(), both asked before and after the close.
async function openBilan(page, eventId, { closed = false } = {}) {
  const counts = page.waitForResponse(forEvent(isCountsCall, eventId));
  const answers = page.waitForResponse(forEvent(isAnswersCall, eventId));
  await page.goto('/admin/bilan');
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabBilan })).toBeVisible();
  const picker = adminMain(page).getByLabel(fr.adminBilanEventLabel);
  if (await picker.inputValue() !== eventId) await picker.selectOption(eventId);
  const payload = { counts: await (await counts).json(), answers: await (await answers).json() };
  await expect(answersBox(page)).toHaveAttribute('data-state', closed ? 'closed' : 'open');
  return payload;
}

// No time and no date on the comments: the tag's date is the section's only one.
async function expectNoTime(page) {
  await expect(answersBox(page)).not.toContainText(/\d{1,2}[:h]\d{2}/);
  await expect(answersBox(page).locator('time')).toHaveCount(0);
  for (const text of await categoryCards(page).allTextContents()) expect(text).not.toMatch(/20\d\d/);
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

const SIGNED_MEMBER = {
  welcome: 'Accueil chaleureux, on s\'est senti attendus dès l\'arrivée.',
  food: 'Les repas du samedi étaient copieux, merci à l\'équipe cuisine!'
};

test('admin, before and after the close: signed comments live, private ones from 3 members, the same screen closed', async ({ page }) => {
  test.setTimeout(120_000);
  const event = await seedEvent();
  const [julie, marc, sophie, karim] = await registered(event.eventId, ['Julie Bouchard', 'Marc-André Roy', 'Sophie Gagnon', 'Karim Haddad']);
  let countsCalls = 0;
  page.on('request', request => { if (isCountsCall(request)) countsCalls += 1; });
  await loginAs(page, TEST_USERS.admin);

  // Through the navigation, as an admin would: nothing written yet.
  await page.goto('/admin/overview');
  await expect(sectionLink(page, fr.adminTabOverview)).toBeVisible();
  const first = Promise.all([page.waitForResponse(isCountsCall), page.waitForResponse(isAnswersCall)]);
  await openSection(page, fr.adminTabBilan);
  await expect(page).toHaveURL(/\/admin\/bilan$/);
  const [counts0] = await Promise.all((await first).map(response => response.json()));
  expect(counts0).toMatchObject({ closed: false, eligible: 5, signed_members: 0, released: false, private_total: null });
  await expect(answersBox(page)).toHaveAttribute('data-state', 'open');
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsOpenUntil.replace('{date}', frenchDate(counts0.closes_on)));
  await expect(answersBox(page)).toContainText(fr.adminBilanEmptySignedTitle);
  await expect(answersBox(page)).toContainText(fr.adminBilanPrivateHidden);
  await expectCounts(page, { signed: 0, private: null, members: 0, eligible: 5 });

  // No polling: once loaded (twice in dev, React's StrictMode), nothing asks again by itself.
  const loaded = countsCalls;
  await page.waitForTimeout(3000);
  expect(countsCalls).toBe(loaded);

  // The member signs two comments; Julie signs one and writes a private one; Marc writes a private
  // one: two private authors, below the threshold.
  await submitFeedbackAs(TEST_USERS.member, event.eventId, SIGNED_MEMBER, false);
  await submitFeedbackAs(julie, event.eventId, [
    { category: 'party_music', text: 'Le DJ du samedi soir, incroyable. On en veut encore!' },
    { category: 'safety', private: true, text: 'Un peu sombre près du feu la nuit, prévoir des lampes.' }
  ]);
  await submitFeedbackAs(marc, event.eventId, [{ category: 'lodging', private: true, text: 'Le chalet du fond était froid la nuit.' }]);
  // Sophie signs one too.
  await submitFeedbackAs(sophie, event.eventId, [{ category: 'schedule', text: 'Horaire bien affiché, rien à redire.' }]);
  expect(countsCalls).toBe(loaded);

  // On the next load: the signed comments with their author, no date; no private text, « moins de 3 ».
  const below = await openBilan(page, event.eventId);
  expect(below.answers).toMatchObject({ closed: false, released: false, private: [] });
  expect(below.answers.signed).toHaveLength(4);
  expect(below.counts).toMatchObject({ eligible: 5, signed_members: 3, released: false, signed_total: 4, private_total: null });
  expect(JSON.stringify(below)).not.toMatch(/sombre|chalet du fond/);
  await expect(category(page, fr.bilanCategoryWelcome).getByRole('listitem')).toHaveText(['Test Member' + SIGNED_MEMBER.welcome]);
  await expect(category(page, fr.bilanCategoryPartyMusic).getByRole('listitem')).toHaveText(['Julie Bouchard' + 'Le DJ du samedi soir, incroyable. On en veut encore!']);
  await expect(adminMain(page).getByText(fr.adminBilanPrivate, { exact: true })).toHaveCount(0);
  await expect(categoryCards(page).filter({ hasText: fr.adminBilanPrivateHidden })).toHaveCount(8);
  await expectCounts(page, { signed: 4, private: null, members: 3, eligible: 5 });
  await expectCategoriesMatch(page, below);
  await expectNoTime(page);
  await shoot(page, 'bilan-below-threshold-admin');

  // A third private author (two private comments, and a signed one): released, for good.
  await submitFeedbackAs(karim, event.eventId, [
    { category: 'safety', private: true, text: 'Le stationnement mériterait un éclairage.' },
    { category: 'food', private: true, text: 'Plus d\'options végétariennes, svp.' },
    { category: 'communications', text: 'Les courriels avant l\'événement étaient clairs.' }
  ]);
  const released = await openBilan(page, event.eventId);
  expect(released.answers.released).toBe(true);
  expect(released.answers.private).toHaveLength(4);
  for (const entry of released.answers.private) expect(Object.keys(entry).sort()).toEqual(['category', 'text']);
  expect(released.counts).toMatchObject({ eligible: 5, signed_members: 4, released: true, signed_total: 5, private_total: 4 });
  // Nothing in a payload or the page leads to a private author.
  const raw = JSON.stringify(released.answers.private);
  const html = await categoryCards(page).evaluateAll(cards => cards.map(card => card.innerHTML).join(''));
  for (const member of [julie, marc, karim]) {
    for (const trace of [member.id, member.email]) {
      expect(raw).not.toContain(trace);
      expect(html).not.toContain(trace);
    }
  }
  await expect(answersBox(page)).not.toContainText('Marc-André Roy');
  // Sécurité: the two private comments, « Anonyme » and no name, in the payload's order.
  const safetyOrder = released.answers.private.filter(entry => entry.category === 'safety').map(entry => fr.adminBilanPrivate + entry.text);
  await expect(category(page, fr.bilanCategorySafety).getByRole('listitem')).toHaveText(safetyOrder);
  const item = category(page, fr.bilanCategorySafety).getByRole('listitem').first();
  expect(await item.evaluate(li => li.getAttributeNames())).toEqual(['class']);
  // Nourriture: the signed one first, then the private one.
  await expect(category(page, fr.bilanCategoryFood).getByRole('listitem'))
    .toHaveText(['Test Member' + SIGNED_MEMBER.food, fr.adminBilanPrivate + 'Plus d\'options végétariennes, svp.']);
  await expect(adminMain(page).getByText(fr.adminBilanPrivateHidden)).toHaveCount(0);
  await expectCounts(page, { signed: 5, private: 4, members: 4, eligible: 5 });
  await expectCategoriesMatch(page, released);
  await expectNoTime(page);
  await expectSummaryWidth(page);
  // Every category, in order, their colours cycling as on the member's form (#352).
  await expect(adminMain(page).locator('h2[id^="bilan-category-"]')).toHaveText(CATEGORIES.map(categoryName));
  const tints = await adminMain(page).locator('h2[id^="bilan-category-"]')
    .evaluateAll(titles => titles.map(title => title.parentElement.className.match(/\btint-\w+/)?.[0]));
  expect(tints).toEqual(['tint-neon', 'tint-info', 'tint-ok', 'tint-warn', 'tint-neon', 'tint-info', 'tint-ok', 'tint-warn']);
  await shoot(page, 'bilan-released-admin');

  // After the close: the same screen, « Clos le », the final set (the levée gave the private ones fresh ids, same texts).
  await closeFeedback(event.eventId);
  const closed = await openBilan(page, event.eventId, { closed: true });
  expect(closed.answers).toMatchObject({ closed: true, released: true });
  expect(closed.answers.signed).toEqual(released.answers.signed);
  expect(closed.answers.private.map(entry => entry.text).sort()).toEqual(released.answers.private.map(entry => entry.text).sort());
  expect(closed.counts).toMatchObject({ closed: true, signed_members: 4, signed_total: 5, private_total: 4 });
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsClosedOn.split('{date}')[0]);
  await expect(dashboard(page)).not.toContainText(fr.adminBilanCountsOpenUntil.split('{date}')[0]);
  await expectCounts(page, { signed: 5, private: 4, members: 4, eligible: 5 });
  await expectCategoriesMatch(page, closed);
  await expectNoTime(page);
  await shoot(page, 'bilan-closed-admin');
});

test('admin, before the event\'s first day: the tag says when the retours open, not « Ouvert jusqu\'au »', async ({ page }) => {
  // Starts in 3 days (Toronto), so the window opens then.
  const event = await seedEvent({ startDaysAgo: -3 });
  await loginAs(page, TEST_USERS.admin);
  const payload = await openBilan(page, event.eventId);
  const opensOn = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsOpensOn.replace('{date}', frenchDate(opensOn)));
  await expect(dashboard(page)).not.toContainText(fr.adminBilanCountsOpenUntil.split('{date}')[0]);
  await expect(dashboard(page)).not.toContainText(fr.adminBilanCountsClosedOn.split('{date}')[0]);
  expect(payload.counts.closed).toBe(false);
  await shoot(page, 'bilan-not-yet-admin');
});

test('admin, closed without a release: the private comments stay hidden for good, « moins de 3 »', async ({ page }) => {
  const event = await seedEvent();
  const [a, b] = await registered(event.eventId, ['Annie Lavoie', 'Bruno Côté']);
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { lodging: 'Chalet parfait' }, false);
  await submitFeedbackAs(a, event.eventId, { lodging: 'Hébergement privé A' }, true);
  await submitFeedbackAs(b, event.eventId, { lodging: 'Hébergement privé B' }, true);
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.admin);

  const payload = await openBilan(page, event.eventId, { closed: true });
  expect(payload.answers).toMatchObject({ closed: true, released: false, private: [] });
  expect(payload.counts).toMatchObject({ closed: true, eligible: 3, signed_members: 1, released: false, private_total: null });
  expect(JSON.stringify(payload)).not.toContain('Hébergement privé');
  await expectCounts(page, { signed: 1, private: null, members: 1, eligible: 3 });
  await expectCategoriesMatch(page, payload);
  await expect(category(page, fr.bilanCategoryLodging).getByRole('listitem')).toHaveText(['Test Member' + 'Chalet parfait']);
  await expect(categoryCards(page).filter({ hasText: fr.adminBilanPrivateNeverShown })).toHaveCount(8);
  await expect(adminMain(page).getByText(fr.adminBilanPrivate, { exact: true })).toHaveCount(0);
});

test('admin: no eligible registration, then loading and error states, in French', async ({ page }) => {
  const event = await seedEvent();
  await teardownFeedbackEvent({ partyId: event.partyId });
  await loginAs(page, TEST_USERS.admin);

  // Loading: held until released, then an error with « Réessayer », then the section.
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
  await expect(answersBox(page)).toHaveAttribute('data-state', 'open');
  // Without a registration: the card and its tag, a sentence, no figure or bar.
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsNoEligible);
  await expect(dashboard(page)).toContainText(fr.adminBilanCountsOpenUntil.split('{date}')[0]);
  await expect(dashboard(page).getByRole('img')).toHaveCount(0);
  await expect(answersBox(page)).toContainText(fr.adminBilanEmptySignedTitle);
  await shoot(page, 'bilan-noeligible-admin');
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
