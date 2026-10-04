// The admin navigation (#29, #83, #208): /admin/<section>, overview | users | logistics | budget |
// events | venues | team | feedback (#196, ADR 0022), from a sidebar on desktop and a bottom bar plus « Plus »
// on phones. Older ?tab= links redirect to their path.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  E2E_EVENT_THEME,
  deleteLocations,
  getParty,
  seedActiveEventWithMemberParty,
  seedPlaces,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { pickPlace, placeOption, placePickers } from './support/placePicker.js';
import { adminMain, adminNav, moreButton, moreSheet, openPartyDetail, openPartyEditor, openSection, partyDetail, sectionLink } from './support/admin.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

const OVERVIEW_TAB = fr.adminTabOverview;
const USERS_TAB = fr.adminTabUsers;
const LOGISTICS_TAB = fr.adminTabLogistics;
// The page titles (h1): the section, and the view after a dot.
const USERS_HEADING = `${fr.adminTabUsers} · ${fr.usersViewList}`;
const LOGISTICS_HEADING = `${fr.adminTabLogistics} · ${fr.logisticsViewTitle}`;
const pageTitle = (scope, name) => scope.getByRole('heading', { level: 1, name, exact: true });
const SECTION_COUNT = 8;
// The phone bar's sections (ADR 0022); the others are under « Plus ».
const BAR_SECTIONS = [fr.adminTabOverview, fr.adminTabUsers, fr.adminTabLogistics, fr.adminTabBudget];
const MORE_SECTIONS = [fr.adminTabEvents, fr.adminTabVenues, fr.adminTabTeam, fr.adminTabFeedback];
const MEMBER_NAME = 'Test Member';

// The tests share one seeded registration (and the last one writes to it), so run them in
// order in a single worker rather than letting fullyParallel reseed it concurrently.
test.describe.configure({ mode: 'serial' });

let seeded;

test.beforeAll(async () => {
  seeded = await seedActiveEventWithMemberParty();
  await seedPlaces(seeded.eventId);
});

test.afterAll(async () => {
  if (seeded) {
    await deleteLocations(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
});

const tab = (page, name) => sectionLink(page, name);
const panel = (page) => adminMain(page);
// The party's private notes, and its message to the participants (#216).
const adminNotes = (page) => panel(page).getByRole('textbox', { name: fr.logisticsTableAdminNotes });
const participantMessage = (page) => panel(page).getByRole('textbox', { name: fr.logisticsTableParticipantMessage });
const bedInputs = (page) => placePickers(panel(page));
// Modals are native <dialog>s, labelled by their title.
const modal = (page, title) => page.getByRole('dialog', { name: title });
const closeModal = (dialog) => dialog.getByRole('button', { name: fr.close, exact: true }).click();

async function openAdmin(page, path = '') {
  await page.goto('/admin' + path);
  await expect(adminNav(page)).toBeVisible();
}

async function expectOverviewTabActive(page) {
  await expect(tab(page, OVERVIEW_TAB)).toHaveAttribute('aria-current', /page|true/);
  await expect(tab(page, USERS_TAB)).not.toHaveAttribute('aria-current', /.+/);
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByText(fr.kpiPeople, { exact: true })).toBeVisible();
  await expect(pageTitle(page, USERS_HEADING)).toHaveCount(0);
}

async function expectUsersTabActive(page) {
  await expect(tab(page, USERS_TAB)).toHaveAttribute('aria-current', /page|true/);
  await expect(tab(page, LOGISTICS_TAB)).not.toHaveAttribute('aria-current', /.+/);
  await expect(panel(page)).toHaveCount(1);
  await expect(pageTitle(page, USERS_HEADING)).toBeVisible();
  // Only the active panel is rendered: nothing from logistics is in the DOM.
  await expect(pageTitle(page, LOGISTICS_HEADING)).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
}

async function expectLogisticsTabActive(page) {
  await expect(tab(page, LOGISTICS_TAB)).toHaveAttribute('aria-current', /page|true/);
  await expect(tab(page, USERS_TAB)).not.toHaveAttribute('aria-current', /.+/);
  await expect(panel(page)).toHaveCount(1);
  await expect(pageTitle(page, LOGISTICS_HEADING)).toBeVisible();
  await expect(pageTitle(page, USERS_HEADING)).toHaveCount(0);
  await expect(page.getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(0);
  await expect(bedInputs(page)).toHaveCount(E2E_ATTENDEES.length);
}

async function expectProfileModalWorks(page, { viaDetail = false } = {}) {
  if (viaDetail) {
    // Inscrits: the name opens the « Inscription », whose « Voir le profil » opens the profile.
    const detail = await openPartyDetail(page);
    await detail.getByRole('button', { name: fr.partyDetailViewProfile }).click();
  } else {
    await panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }).click();
  }
  const profile = modal(page, fr.userProfileModalTitle);
  await expect(profile).toBeVisible();
  await expect(profile.getByText(fr.userProfileEventHistory)).toBeVisible();
  // History actually loads for this member (needs profile.id in the parties query).
  await expect(profile.getByText(E2E_EVENT_THEME)).toBeVisible();
  await expect(page.getByText(fr.historyFetchError)).toHaveCount(0);
  await closeModal(profile);
  await expect(profile).toHaveCount(0);
  // The profile opened over the « Inscription », which is still there underneath.
  if (viaDetail) await closeModal(partyDetail(page));
}

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(scrollWidth, 'page scrolls horizontally').toBeLessThanOrEqual(innerWidth);
}

async function expectWithinViewportWidth(page, locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const width = page.viewportSize().width;
  expect(box.x, 'control starts off-screen left').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'control overflows viewport right').toBeLessThanOrEqual(width);
}

// The phone bar: four sections and « Plus », side by side, each a 44 px target, none off-screen.
async function expectMobileTabBarUsable(page) {
  const bar = adminNav(page);
  const { scrollWidth, clientWidth } = await bar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, 'the bar needs horizontal scrolling').toBeLessThanOrEqual(clientWidth);
  await expect(bar.getByRole('link')).toHaveCount(BAR_SECTIONS.length);
  const items = [...BAR_SECTIONS.map(name => sectionLink(page, name)), moreButton(page)];
  for (const item of items) {
    await expectWithinViewportWidth(page, item);
    const box = await item.boundingBox();
    expect(box.height, 'a bar item is shorter than a 44px touch target').toBeGreaterThanOrEqual(44);
  }
}

// Screenshots for visual review, only when E2E_SCREENSHOT_DIR is set (kept out of the repo).
async function shot(page, name) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.describe('admin tabs', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin);
  });

  test('no tab param or an unknown one shows the overview tab', async ({ page }) => {
    await openAdmin(page);
    // The sidebar lists every section (and only the current one's views); a phone's bar, four.
    const phone = page.viewportSize().width < 768;
    await expect(adminNav(page).getByRole('link')).toHaveCount(phone ? BAR_SECTIONS.length : SECTION_COUNT);
    await expectOverviewTabActive(page);
    await expect(page).toHaveURL(/\/admin\/overview$/);

    await openAdmin(page, '/bogus');
    await expectOverviewTabActive(page);
    await expect(page).toHaveURL(/\/admin\/overview$/);
  });

  test('an older ?tab= link lands on its path, and Back skips it', async ({ page }) => {
    await openAdmin(page, '/users');
    await page.goto('/admin?tab=logistics&view=food');
    await expect(page).toHaveURL(/\/admin\/logistics\/food$/);
    await expect(tab(page, LOGISTICS_TAB)).toHaveAttribute('aria-current', /page|true/);
    // The view is current: in the sidebar, or the phone's view tabs.
    await expect(page.viewportSize().width < 768
      ? page.getByRole('tab', { name: fr.logisticsViewFood })
      : adminNav(page).getByRole('link', { name: fr.logisticsViewFood })).toHaveAttribute(...(page.viewportSize().width < 768 ? ['aria-selected', 'true'] : ['aria-current', 'page']));

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectUsersTabActive(page);
  });

  test('users tab lists the seeded party with its controls', async ({ page }) => {
    await openAdmin(page, '/users');
    await expectUsersTabActive(page);
    // One party seeded -> exactly one of each per-party control (markup is cards/grid, not a table).
    await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toHaveCount(1);
    // The admin flag is not here any more: it is managed in « Équipe » (#257).
    await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: fr.unpaidShort, exact: true })).toHaveCount(1);
    await expect(panel(page).getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(0);
  });

  test('payment toggle asks for confirmation and cancelling writes nothing', async ({ page }) => {
    await openAdmin(page, '/users');
    await panel(page).getByRole('button', { name: fr.unpaidShort, exact: true }).click();
    const confirm = modal(page, fr.markPaid);
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: fr.cancel, exact: true }).click();
    await expect(confirm).toHaveCount(0);
    const party = await getParty(seeded.partyId);
    expect(party.payment_status).toBe('unpaid');
  });

  test('clicking tabs switches panels and syncs the URL', async ({ page }) => {
    await openAdmin(page);

    await openSection(page, LOGISTICS_TAB);
    await expect(page).toHaveURL(/\/admin\/logistics$/);
    await expectLogisticsTabActive(page);

    await openSection(page, USERS_TAB);
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectUsersTabActive(page);
  });

  test('deep link to /admin/logistics opens logistics directly', async ({ page }) => {
    await openAdmin(page, '/logistics');
    await expectLogisticsTabActive(page);
  });

  // Each section loads its own data (#195): one failing query doesn't take the others down.
  test('with the feedback query failing, Logistique still renders and Retours says so', async ({ page }) => {
    await page.route('**/rest/v1/app_feedback*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
    await openAdmin(page, '/logistics');
    await expectLogisticsTabActive(page);
    await openAdmin(page, '/feedback');
    await expect(panel(page).getByText(fr.adminLoadError)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: fr.retry })).toBeVisible();
  });

  test('browser back/forward switch tabs', async ({ page }) => {
    await openAdmin(page, '/users');
    await openSection(page, LOGISTICS_TAB);
    await expectLogisticsTabActive(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectUsersTabActive(page);

    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/logistics$/);
    await expectLogisticsTabActive(page);
  });

  test('profile modal opens from both tabs', async ({ page }) => {
    await openAdmin(page, '/users');
    await expectProfileModalWorks(page, { viaDetail: true });

    await openSection(page, LOGISTICS_TAB);
    await expectLogisticsTabActive(page);
    await expectProfileModalWorks(page);
  });

  test('« Inscription » is read-only; « Modifier » opens the editor, and the pencil column is gone (#258)', async ({ page }) => {
    await openAdmin(page, '/users');
    const detail = await openPartyDetail(page);
    await expect(detail.getByText('member@test.local')).toBeVisible();
    await expect(detail.getByText(fr.partyDetailRegisteredOn)).toBeVisible();
    for (const attendee of E2E_ATTENDEES) await expect(detail.getByText(attendee.name, { exact: true })).toBeVisible();
    // Read-only: no field, and « Modifier » is the only way on.
    await expect(detail.locator('input, textarea, select')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: fr.edit, exact: true })).toBeVisible();
    if (process.env.E2E_SCREENSHOT_DIR) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/inscription-admin-${width}.png` });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await closeModal(detail);
    await expect(detail).toHaveCount(0);
  });

  test('god-mode edit modal opens from the users tab', async ({ page }) => {
    await openAdmin(page, '/users');
    const edit = await openPartyEditor(page);
    // It's editing the seeded registration, not an empty form.
    await expect(edit.locator('input').first()).toBeVisible();
    const names = await edit.locator('input').evaluateAll((els) => els.map((el) => el.value));
    expect(names).toEqual(expect.arrayContaining(E2E_ATTENDEES.map((a) => a.name)));
    await closeModal(edit);
    await expect(edit).toHaveCount(0);
  });

  test('a toast shows above the open edit dialog, not behind it', async ({ page }) => {
    await openAdmin(page, '/users');
    const edit = await openPartyEditor(page);
    // The app-wide stack (src/lib/toasts.ts), notified the way a save inside the dialog would.
    await page.evaluate(() => import('/src/lib/toasts.ts').then(({ notify }) => notify('Toast au-dessus', 'error')));
    const toast = page.getByRole('alert').filter({ hasText: 'Toast au-dessus' });
    await expect(toast).toBeVisible();
    // In the top layer, shown after the dialog, so drawn over it. (Not hit-testable: the modal
    // dialog makes the rest of the page inert, the toasts too, so this checks the layer.)
    expect(await toast.evaluate(el => el.closest('[popover]')?.matches(':popover-open') ?? false)).toBe(true);
    await closeModal(edit);
  });

  test('mobile: no horizontal overflow, tappable tabs, controls within the viewport', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'mobile-only layout checks');

    await openAdmin(page, '/users');
    await expectUsersTabActive(page);
    await expectMobileTabBarUsable(page);
    await expectNoHorizontalOverflow(page);
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }));
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: fr.unpaidShort, exact: true }));
    await shot(page, 'mobile-tab-users');

    const detail = await openPartyDetail(page);
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-modal-inscription');
    await detail.getByRole('button', { name: fr.partyDetailViewProfile }).click();
    const profile = modal(page, fr.userProfileModalTitle);
    await expect(profile.getByText(E2E_EVENT_THEME)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-modal-profile');
    await closeModal(profile);
    await closeModal(detail);

    const edit = await openPartyEditor(page);
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-modal-edit');
    await closeModal(edit);

    await openSection(page, LOGISTICS_TAB);
    await expectLogisticsTabActive(page);
    await expectMobileTabBarUsable(page);
    await expectNoHorizontalOverflow(page);
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }));
    for (let i = 0; i < E2E_ATTENDEES.length; i++) {
      await expectWithinViewportWidth(page, bedInputs(page).nth(i));
    }
    await expectWithinViewportWidth(page, adminNotes(page));
    await expectWithinViewportWidth(page, participantMessage(page));
    await shot(page, 'mobile-tab-logistics');
    // The open list fits the phone too.
    await bedInputs(page).first().click();
    await expectWithinViewportWidth(page, placeOption(page, 'Chambre 1 · Lit A'));
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-tab-logistics-picker');
    // A draft enables the save bar (never clicked here).
    await placeOption(page, 'Chambre 1 · Lit A').click();
    await expect(panel(page).getByRole('button', { name: fr.save, exact: true })).toBeEnabled();
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: fr.save, exact: true }));
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-tab-logistics-editing');
  });

  test('unsaved logistics edits survive switching tabs', async ({ page }) => {
    await openAdmin(page, '/logistics');
    const saveButton = panel(page).getByRole('button', { name: fr.save, exact: true });
    await expect(saveButton).toBeDisabled();
    await expect(bedInputs(page).first()).toHaveValue('');

    await pickPlace(page, bedInputs(page).first(), 'Chambre 1 · Lit A');
    await adminNotes(page).fill('Note non sauvegardée');
    await expect(saveButton).toBeEnabled();

    await openSection(page, USERS_TAB);
    await expectUsersTabActive(page);
    await openSection(page, LOGISTICS_TAB);
    await expectLogisticsTabActive(page);

    await expect(bedInputs(page).first()).toHaveValue('Chambre 1 · Lit A');
    await expect(adminNotes(page)).toHaveValue('Note non sauvegardée');
    await expect(saveButton).toBeEnabled();

    // Nothing was written: the draft only lives in page state.
    const party = await getParty(seeded.partyId);
    expect(party.attendees[0].place).toBeNull();
    expect(party.admin_notes).toBeNull();
  });

  test('saving a bed assignment persists across reload', async ({ page }) => {
    await openAdmin(page, '/logistics');
    await pickPlace(page, bedInputs(page).nth(1), 'Salon · Sofa');
    await adminNotes(page).fill('Arrive tard vendredi');
    const saveButton = panel(page).getByRole('button', { name: fr.save, exact: true });
    await saveButton.click();

    await expect(page.getByText(fr.logisticsAllSavedToast)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await page.reload();
    await expectLogisticsTabActive(page);
    await expect(bedInputs(page).nth(1)).toHaveValue('Salon · Sofa');
    await expect(bedInputs(page).first()).toHaveValue('');
    await expect(adminNotes(page)).toHaveValue('Arrive tard vendredi');

    const party = await getParty(seeded.partyId);
    expect(party.attendees[1].place?.bed_label).toBe('Salon · Sofa');
    expect(party.attendees[1].name).toBe(E2E_ATTENDEES[1].name);
    expect(party.admin_notes).toBe('Arrive tard vendredi');
  });
});

test('member visiting /admin/logistics is blocked and sees no admin navigation', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/logistics');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(adminNav(page)).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
});

// The navigation shell (#208): the layout ADR 0022 decided.
test.describe('admin navigation shell', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin);
  });

  test('phone: four sections and « Plus » in the bar, every section within two taps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdmin(page, '/overview');
    await expectMobileTabBarUsable(page);
    await expectNoHorizontalOverflow(page);

    for (const name of BAR_SECTIONS) {
      await sectionLink(page, name).click();
      await expect(sectionLink(page, name)).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await expectNoHorizontalOverflow(page);
    }
    for (const name of MORE_SECTIONS) {
      await moreButton(page).click();
      const sheet = moreSheet(page);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('link')).toHaveCount(MORE_SECTIONS.length);
      await sheet.getByRole('link', { name }).click();
      await expect(sheet).toHaveCount(0);
      // The section is behind « Plus », so « Plus » is the bar's current item.
      await expect(moreButton(page)).toHaveAttribute('aria-current', 'true');
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await expectNoHorizontalOverflow(page);
    }
    await shot(page, 'phone-more-section');

    // The sheet is a native dialog: Escape closes it and focus goes back to « Plus ».
    await moreButton(page).click();
    await expect(moreSheet(page)).toBeVisible();
    await shot(page, 'phone-more-open');
    await page.keyboard.press('Escape');
    await expect(moreSheet(page)).toHaveCount(0);
    await expect(moreButton(page)).toBeFocused();
  });

  // ADR 0022: on 1280×800 the content starts at about 160 px or less, under the app header and
  // the page's one header line (#190 measured the change history at 533 px).
  test('desktop: a sidebar with the current section\'s views, and the content starts high', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Measured as in production: the app header's own 64 px (h-16) and what's under it. The
    // header here also holds the test-account banner, which production doesn't have.
    const fromHeader = async (locator) => 64 + (await locator.boundingBox()).y - (await page.locator('#main').boundingBox()).y;

    await openAdmin(page, '/users');
    // The sections, and Inscrits' two views under it.
    await expect(adminNav(page).getByRole('link')).toHaveCount(SECTION_COUNT + 2);
    await expect(page.getByRole('tablist', { name: fr.adminTabsAriaLabel })).toHaveCount(0);
    const filters = adminMain(page).getByRole('group', { name: fr.filterLabel });
    await expect(filters).toBeVisible();
    expect(await fromHeader(filters), 'Inscrits starts low').toBeLessThanOrEqual(160);
    await shot(page, 'desktop-users');

    await openAdmin(page, '/users/history');
    await expect(adminNav(page).getByRole('link', { name: fr.usersViewHistory })).toHaveAttribute('aria-current', 'page');
    // No view tabs on desktop: the sidebar lists the views.
    await expect(page.getByRole('tablist', { name: fr.usersViewsLabel })).toBeHidden();
    const history = page.getByRole('tabpanel', { name: fr.usersViewHistory });
    await expect(history).toBeVisible();
    expect(await fromHeader(history), 'the change history starts low').toBeLessThanOrEqual(160);
    await shot(page, 'desktop-history');
  });

  // The page review of #223: what geometry checks alone let through.
  test('desktop: the overview uses the width, and its figures and their labels never wrap', async ({ page }) => {
    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await openAdmin(page, '/overview');
      const budget = adminMain(page).getByRole('heading', { name: fr.budgetTitle });
      await expect(budget).toBeVisible();
      // Full width (dense): the page's cards reach the page's right edge.
      const [main, kpis] = await Promise.all([panel(page).boundingBox(), panel(page).locator('> div > *').last().boundingBox()]);
      expect(main.x + main.width - (kpis.x + kpis.width), `space left unused at ${width} px`).toBeLessThanOrEqual(40);
      // Each figure (font-data) and the label above it fit on one line.
      const wrapped = await adminMain(page).locator('.font-data').evaluateAll(els => els
        .flatMap(el => [el, el.previousElementSibling].filter(Boolean))
        .filter(el => el.offsetHeight > 1.6 * parseFloat(getComputedStyle(el).lineHeight))
        .map(el => el.textContent));
      expect(wrapped, `figures or labels wrap at ${width} px`).toEqual([]);
    }
  });

  test('desktop: the sidebar stays put while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openAdmin(page, '/logistics');
    await expect(panel(page).getByRole('heading', { name: fr.occupancyTitle })).toBeVisible();
    const top = () => sectionLink(page, OVERVIEW_TAB).evaluate(el => el.getBoundingClientRect().top);
    const before = await top();
    await page.evaluate(() => window.scrollBy(0, 300));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await top()).toBe(before);
  });

  test('desktop: Couchage keeps each count next to its type on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await openAdmin(page, '/logistics');
    const row = panel(page).getByRole('row').filter({ has: page.getByRole('rowheader') }).first();
    // The texts, not the cells: a cell stretches to its neighbour.
    const [type, count] = await Promise.all([
      row.getByRole('rowheader').locator('span.truncate').boundingBox(),
      row.getByRole('cell').locator('span').first().boundingBox()
    ]);
    expect(count.x - (type.x + type.width), 'the count is far from its type').toBeLessThanOrEqual(200);
  });

  // An ultra-wide screen: the admin (sidebar and page) is clamped and centred, and the header's
  // content lines up with it.
  test('ultra-wide: the admin is clamped to 1536 px and centred, the header aligned with it', async ({ page }) => {
    await page.setViewportSize({ width: 3440, height: 1440 });
    await openAdmin(page, '/overview');
    await expect(adminMain(page).getByRole('heading', { name: fr.budgetTitle })).toBeVisible();
    const sidebar = await adminNav(page).boundingBox();
    const main = await adminMain(page).boundingBox();
    const left = sidebar.x;
    const right = 3440 - (main.x + main.width);
    expect(main.x + main.width - left, 'the admin is wider than its clamp').toBeLessThanOrEqual(1536);
    expect(Math.abs(left - right), 'the admin is off-centre').toBeLessThanOrEqual(2);
    const logo = await page.getByRole('link', { name: fr.homeLinkLabel }).boundingBox();
    expect(logo.x, 'the logo starts left of the admin').toBeGreaterThanOrEqual(left);
    expect(logo.x - left, 'the logo isn\'t lined up with the sidebar').toBeLessThanOrEqual(32);
    await shot(page, 'ultrawide-overview');
  });
});
