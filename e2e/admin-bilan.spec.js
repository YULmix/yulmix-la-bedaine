// The admin « Bilan » section (#317) over the database's event_feedback_answers() (#315, ADR 0029):
// before the close only its date (the payload has no answer and no count); after it the answers
// grouped by category, named ones with their author, anonymous ones as « Anonyme » in the
// database's order, with nothing in the page or the payload that leads back to their authors; the
// neutral line when the database shows no anonymous answer (0 and 2 here; 1 is the same `[]`);
// an empty event, the loading and error states; Comité and Organisateur don't get the section.
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
const category = (page, name) => adminMain(page).getByRole('region', { name });
const isAnswersCall = response => response.url().includes('/rpc/event_feedback_answers');
// The French date the page shows for a 'YYYY-MM-DD' (src/lib/format.js formatDate).
const frenchDate = day => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
};

// Opens the section on an event, by its picker, and returns event_feedback_answers()'s payload.
async function openBilan(page, eventId) {
  const first = page.waitForResponse(isAnswersCall);
  await page.goto('/admin/bilan');
  await expect(page.getByRole('heading', { level: 1, name: fr.adminTabBilan })).toBeVisible();
  let response = await first;
  const picker = adminMain(page).getByLabel(fr.adminBilanEventLabel);
  if (await picker.inputValue() !== eventId) {
    const next = page.waitForResponse(r => isAnswersCall(r) && (r.request().postData() ?? '').includes(eventId));
    await picker.selectOption(eventId);
    response = await next;
  }
  await expect(answersBox(page)).not.toHaveAttribute('data-state', 'loading');
  return response.json();
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

test('admin, before the close: only the close date; no answer and no count, on screen or in the payload', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { welcome: 'Accueil secret avant clôture' }, false);
  await anonymousAnswers(event.eventId, 3, i => ({ food: `Repas anonyme ${i}` }));
  const counted = [];
  page.on('request', request => {
    if (request.url().includes('/rest/v1/user_parties') && request.method() === 'HEAD') counted.push(request.url());
  });
  await loginAs(page, TEST_USERS.admin);

  // Through the navigation, as an admin would.
  await page.goto('/admin/overview');
  await expect(sectionLink(page, fr.adminTabOverview)).toBeVisible();
  const answered = page.waitForResponse(isAnswersCall);
  await openSection(page, fr.adminTabBilan);
  await expect(page).toHaveURL(/\/admin\/bilan$/);
  const payload = await (await answered).json();

  expect(payload).toMatchObject({ closed: false, closed_at: null, named: null, anonymous: null });
  expect(Object.keys(payload).sort()).toEqual(['anonymous', 'closed', 'closed_at', 'closes_at', 'closes_on', 'named']);
  expect(JSON.stringify(payload)).not.toMatch(/Accueil secret|Repas anonyme/);

  await expect(answersBox(page)).toHaveAttribute('data-state', 'not_closed');
  await expect(answersBox(page)).toHaveText(
    fr.adminBilanNotClosedTitle + fr.adminBilanNotClosedMessage.replace('{date}', frenchDate(payload.closes_on))
  );
  await expect(adminMain(page)).not.toContainText('Accueil secret');
  await expect(adminMain(page)).not.toContainText(fr.adminBilanNamedCount.split('{named}')[0]);
  expect(counted).toEqual([]);
  await shoot(page, 'bilan-not-closed-admin');
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

  const payload = await openBilan(page, event.eventId);
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
  // The counts: named vs. registrations (the member and the three), and the anonymous ones shown.
  const summary = page.getByTestId('bilan-summary');
  await expect(summary).toContainText(fr.adminBilanNamedCount.replace('{named}', 1).replace('{registrations}', 4));
  await expect(summary).toContainText(fr.adminBilanAnonymousCount.replace('{n}', 3));
  await expect(summary).not.toContainText(fr.adminBilanAnonymousHidden);

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

test('admin, after the close with two anonymous answers: the neutral line, and none of them in the payload', async ({ page }) => {
  const event = await seedEvent();
  await submitFeedbackAs(TEST_USERS.member, event.eventId, { lodging: 'Chalet parfait' }, false);
  await anonymousAnswers(event.eventId, 2, i => ({ lodging: `Hébergement anonyme ${i}` }));
  await closeFeedback(event.eventId);
  await loginAs(page, TEST_USERS.admin);

  const payload = await openBilan(page, event.eventId);
  expect(payload).toMatchObject({ closed: true, anonymous: [] });
  expect(JSON.stringify(payload)).not.toContain('Hébergement anonyme');
  const summary = page.getByTestId('bilan-summary');
  await expect(summary).toContainText(fr.adminBilanNamedCount.replace('{named}', 1).replace('{registrations}', 3));
  await expect(summary).toContainText(fr.adminBilanAnonymousHidden);
  await expect(summary).not.toContainText(fr.adminBilanAnonymousCount.split('{n}')[0]);
  await expect(category(page, fr.bilanCategoryLodging).getByRole('listitem')).toHaveText(['Test Member' + 'Chalet parfait']);
  await expect(adminMain(page)).not.toContainText(fr.adminBilanAnonymous, { exact: true });
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
  await page.route('**/rpc/event_feedback_answers', async route => {
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
  // No answer: the empty state, and the same neutral line as with one or two anonymous answers.
  await expect(answersBox(page)).toContainText(fr.adminBilanEmptyTitle);
  await expect(page.getByTestId('bilan-summary')).toContainText(fr.adminBilanAnonymousHidden);
  await expect(page.getByTestId('bilan-summary')).toContainText(fr.adminBilanNamedCount.replace('{named}', 0).replace('{registrations}', 1));
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
    page.on('request', request => { if (isAnswersCall(request)) called = true; });
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
