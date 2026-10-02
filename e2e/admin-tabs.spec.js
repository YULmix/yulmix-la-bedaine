// Admin sub-navigation tabs (issues #29, #83): /admin/<tab>, overview | users | logistics | budget |
// events | venues | tools (#196, ADR 0022). Older ?tab= links redirect to their path.
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
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

const OVERVIEW_TAB = fr.adminTabOverview;
const USERS_TAB = fr.adminTabUsers;
const LOGISTICS_TAB = fr.adminTabLogistics;
const USERS_HEADING = fr.adminUsersManagementTitle;
const LOGISTICS_HEADING = fr.logisticsViewTitle;
const TAB_COUNT = 7;
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

const tab = (page, name) => page.getByRole('tab', { name, exact: true });
// The admin tab's panel; the Logistique tab nests its views' own tabpanel inside (#179).
const panel = (page) => page.locator('[role="tabpanel"][id^="admin-tabpanel-"]');
const tabBar = (page) => page.getByRole('tablist', { name: fr.adminTabsAriaLabel });
const bedInputs = (page) => placePickers(panel(page));
// Modals are native <dialog>s, labelled by their title.
const modal = (page, title) => page.getByRole('dialog', { name: title });
const closeModal = (dialog) => dialog.getByRole('button', { name: fr.close, exact: true }).click();

async function openAdmin(page, path = '') {
  await page.goto('/admin' + path);
  await expect(tabBar(page)).toBeVisible();
}

async function expectOverviewTabActive(page) {
  await expect(tab(page, OVERVIEW_TAB)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, USERS_TAB)).toHaveAttribute('aria-selected', 'false');
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByText(fr.kpiPeople, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: USERS_HEADING })).toHaveCount(0);
}

async function expectUsersTabActive(page) {
  await expect(tab(page, USERS_TAB)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, LOGISTICS_TAB)).toHaveAttribute('aria-selected', 'false');
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByRole('heading', { name: USERS_HEADING })).toBeVisible();
  // Only the active panel is rendered: nothing from logistics is in the DOM.
  await expect(page.getByRole('heading', { name: LOGISTICS_HEADING })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
}

async function expectLogisticsTabActive(page) {
  await expect(tab(page, LOGISTICS_TAB)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, USERS_TAB)).toHaveAttribute('aria-selected', 'false');
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByRole('heading', { name: LOGISTICS_HEADING })).toBeVisible();
  await expect(page.getByRole('heading', { name: USERS_HEADING })).toHaveCount(0);
  await expect(page.getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(0);
  await expect(bedInputs(page)).toHaveCount(E2E_ATTENDEES.length);
}

async function expectProfileModalWorks(page) {
  await panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }).click();
  const profile = modal(page, fr.userProfileModalTitle);
  await expect(profile).toBeVisible();
  await expect(profile.getByText(fr.userProfileEventHistory)).toBeVisible();
  // History actually loads for this member (needs profile.id in the parties query).
  await expect(profile.getByText(E2E_EVENT_THEME)).toBeVisible();
  await expect(page.getByText(fr.historyFetchError)).toHaveCount(0);
  await closeModal(profile);
  await expect(profile).toHaveCount(0);
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

async function expectMobileTabBarUsable(page) {
  const tablist = tabBar(page);
  // All tabs fit without scrolling the tab bar itself (it's the fixed bottom bar on phones).
  const { scrollWidth, clientWidth } = await tablist.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }));
  expect(scrollWidth, 'tab bar needs horizontal scrolling').toBeLessThanOrEqual(clientWidth);
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(TAB_COUNT);
  for (let i = 0; i < TAB_COUNT; i++) {
    await expectWithinViewportWidth(page, tabs.nth(i));
    const box = await tabs.nth(i).boundingBox();
    expect(box.height, `tab ${i} is shorter than a 44px touch target`).toBeGreaterThanOrEqual(44);
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
    await expect(tabBar(page).getByRole('tab')).toHaveCount(TAB_COUNT);
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
    await expect(tab(page, LOGISTICS_TAB)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: fr.logisticsViewFood })).toHaveAttribute('aria-selected', 'true');

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectUsersTabActive(page);
  });

  test('users tab lists the seeded party with its controls', async ({ page }) => {
    await openAdmin(page, '/users');
    await expectUsersTabActive(page);
    // One party seeded -> exactly one of each per-party control (markup is cards/grid, not a table).
    await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toHaveCount(1);
    await expect(panel(page).getByRole('checkbox', { name: 'Admin' })).toHaveCount(1);
    await expect(panel(page).getByRole('checkbox', { name: 'Admin' })).not.toBeChecked();
    await expect(panel(page).getByRole('button', { name: fr.unpaidShort, exact: true })).toHaveCount(1);
    await expect(panel(page).getByRole('button', { name: fr.editRegistrationButton })).toHaveCount(1);
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

    await tab(page, LOGISTICS_TAB).click();
    await expect(page).toHaveURL(/\/admin\/logistics$/);
    await expectLogisticsTabActive(page);

    await tab(page, USERS_TAB).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectUsersTabActive(page);
  });

  test('deep link to /admin/logistics opens logistics directly', async ({ page }) => {
    await openAdmin(page, '/logistics');
    await expectLogisticsTabActive(page);
  });

  test('browser back/forward switch tabs', async ({ page }) => {
    await openAdmin(page, '/users');
    await tab(page, LOGISTICS_TAB).click();
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
    await expectProfileModalWorks(page);

    await tab(page, LOGISTICS_TAB).click();
    await expectLogisticsTabActive(page);
    await expectProfileModalWorks(page);
  });

  test('god-mode edit modal opens from the users tab', async ({ page }) => {
    await openAdmin(page, '/users');
    await panel(page).getByRole('button', { name: fr.editRegistrationButton }).click();
    const edit = modal(page, fr.adminEditRegistrationTitle);
    await expect(edit).toBeVisible();
    // It's editing the seeded registration, not an empty form.
    await expect(edit.locator('input').first()).toBeVisible();
    const names = await edit.locator('input').evaluateAll((els) => els.map((el) => el.value));
    expect(names).toEqual(expect.arrayContaining(E2E_ATTENDEES.map((a) => a.name)));
    await closeModal(edit);
    await expect(edit).toHaveCount(0);
  });

  test('mobile: no horizontal overflow, tappable tabs, controls within the viewport', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'mobile-only layout checks');

    await openAdmin(page, '/users');
    await expectUsersTabActive(page);
    await expectMobileTabBarUsable(page);
    await expectNoHorizontalOverflow(page);
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }));
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: fr.unpaidShort, exact: true }));
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: fr.editRegistrationButton }));
    await expectWithinViewportWidth(page, panel(page).getByRole('checkbox', { name: 'Admin' }));
    await shot(page, 'mobile-tab-users');

    await panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }).click();
    const profile = modal(page, fr.userProfileModalTitle);
    await expect(profile.getByText(E2E_EVENT_THEME)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-modal-profile');
    await closeModal(profile);

    await panel(page).getByRole('button', { name: fr.editRegistrationButton }).click();
    const edit = modal(page, fr.adminEditRegistrationTitle);
    await expect(edit).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-modal-edit');
    await closeModal(edit);

    await tab(page, LOGISTICS_TAB).click();
    await expectLogisticsTabActive(page);
    await expectMobileTabBarUsable(page);
    await expectNoHorizontalOverflow(page);
    await expectWithinViewportWidth(page, panel(page).getByRole('button', { name: MEMBER_NAME, exact: true }));
    for (let i = 0; i < E2E_ATTENDEES.length; i++) {
      await expectWithinViewportWidth(page, bedInputs(page).nth(i));
    }
    await expectWithinViewportWidth(page, panel(page).locator('textarea'));
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
    await panel(page).locator('textarea').fill('Note non sauvegardée');
    await expect(saveButton).toBeEnabled();

    await tab(page, USERS_TAB).click();
    await expectUsersTabActive(page);
    await tab(page, LOGISTICS_TAB).click();
    await expectLogisticsTabActive(page);

    await expect(bedInputs(page).first()).toHaveValue('Chambre 1 · Lit A');
    await expect(panel(page).locator('textarea')).toHaveValue('Note non sauvegardée');
    await expect(saveButton).toBeEnabled();

    // Nothing was written: the draft only lives in page state.
    const party = await getParty(seeded.partyId);
    expect(party.attendees[0].place).toBeNull();
    expect(party.admin_notes).toBeNull();
  });

  test('saving a bed assignment persists across reload', async ({ page }) => {
    await openAdmin(page, '/logistics');
    await pickPlace(page, bedInputs(page).nth(1), 'Salon · Sofa');
    await panel(page).locator('textarea').fill('Arrive tard vendredi');
    const saveButton = panel(page).getByRole('button', { name: fr.save, exact: true });
    await saveButton.click();

    await expect(page.getByText(fr.logisticsAllSavedToast)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await page.reload();
    await expectLogisticsTabActive(page);
    await expect(bedInputs(page).nth(1)).toHaveValue('Salon · Sofa');
    await expect(bedInputs(page).first()).toHaveValue('');
    await expect(panel(page).locator('textarea')).toHaveValue('Arrive tard vendredi');

    const party = await getParty(seeded.partyId);
    expect(party.attendees[1].place?.bed_label).toBe('Salon · Sofa');
    expect(party.attendees[1].name).toBe(E2E_ATTENDEES[1].name);
    expect(party.admin_notes).toBe('Arrive tard vendredi');
  });
});

test('member visiting /admin/logistics is blocked and sees no tabs', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);
  await page.goto('/admin/logistics');
  await expect(page.getByText(fr.adminOnlyAccessMessage.replace(/\.$/, ''))).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
});
