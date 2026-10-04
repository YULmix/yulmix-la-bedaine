// The Budget admin tab (issue #109): categorized cost lines saved to the admin-only
// event_budgets table, and the simulator whose "apply" sets the base price and main-event ratio.
// That price applies to new registrations only: existing ones keep the price they locked (#117).
import { test, expect } from '@playwright/test';
import { adminMain, eventRow } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  ADMIN_ID,
  E2E_ATTENDEES,
  E2E_EVENT_THEME,
  createParty,
  deleteBudget,
  deleteParty,
  getBudget,
  getEvent,
  getParty,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

// Both tests reseed the one shared active event.
test.describe.configure({ mode: 'serial' });

let seeded;

test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await deleteBudget(seeded.eventId);
  await loginAs(page, TEST_USERS.admin);
});

test.afterEach(async () => {
  if (seeded) {
    await deleteBudget(seeded.eventId);
    await teardownActiveEventWithMemberParty(seeded);
  }
  seeded = null;
});

const panel = (page) => adminMain(page);
// A <Stat>'s value is the paragraph right after its label.
const stat = (page, label) => panel(page).getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
// Same formatting as src/lib/format.js (fr-CA, e.g. "1 000,00 $").
// The two informative sections are collapsed by default; their title is the disclosure button.
const expand = async (page, title) => {
  const toggle = panel(page).getByRole('button', { name: new RegExp(`^${title}`) });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
};
const money = (amount) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(amount);

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(scrollWidth, 'page scrolls horizontally').toBeLessThanOrEqual(innerWidth);
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`${viewport.name}: budget lines are saved and drive the break-even price`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/admin/budget');
    // Collapsed: only the pricing section shows its fields.
    await expect(panel(page).getByRole('button', { name: fr.budgetLineAdd })).toHaveCount(0);
    await expect(panel(page).getByLabel(fr.scenarioAdultWholeCount, { exact: true })).toHaveCount(0);
    await expect(panel(page).getByLabel(fr.ratioMainWholeLabel)).toBeVisible();

    await expand(page, fr.budgetLinesTitle);
    await expect(stat(page, fr.budgetTotalCost)).toHaveText(money(0));

    // Two lines, with categories picked from the per-line dropdown.
    await panel(page).getByRole('button', { name: fr.budgetLineAdd }).click();
    await panel(page).getByRole('button', { name: fr.budgetLineAdd }).click();
    const categories = panel(page).getByRole('combobox', { name: fr.budgetLineCategory });
    const descriptions = panel(page).getByRole('textbox', { name: fr.budgetLineDescription });
    const amounts = panel(page).getByRole('spinbutton', { name: fr.budgetLineAmount });
    await categories.nth(0).selectOption({ label: fr.eventExpenseCategoryChalet });
    await descriptions.nth(0).fill('Location chalet');
    await amounts.nth(0).fill('700');
    await categories.nth(1).selectOption({ label: fr.eventExpenseCategoryFood });
    await descriptions.nth(1).fill('Épicerie');
    await amounts.nth(1).fill('300');
    await expect(stat(page, fr.budgetTotalCost)).toHaveText(money(1000));
    await expectNoHorizontalOverflow(page);

    await expand(page, fr.scenarioSimulatorTitle);
    // Headcount comes from the seeded registration: one adult whole weekend, one adult main event.
    await expect(panel(page).getByLabel(fr.scenarioAdultWholeCount, { exact: true })).toHaveValue('1');
    await expect(panel(page).getByLabel(fr.scenarioAdultMainCount, { exact: true })).toHaveValue('1');
    // 1000 × 1.20 / (1 + 0.5375) = 780.49 → rounded up to 790.
    await expect(stat(page, fr.breakEvenPriceLabel)).toHaveText(money(790));

    await panel(page).getByRole('button', { name: fr.budgetSave }).click();
    await expect(page.getByText(fr.budgetSavedToast)).toBeVisible();
    const budget = await getBudget(seeded.eventId);
    expect(Number(budget.total_cost)).toBe(1000);
    expect(budget.lines).toEqual([
      { category: 'Chalet', description: 'Location chalet', amount: 700 },
      { category: 'Food', description: 'Épicerie', amount: 300 }
    ]);

    // Saving the budget reprices nothing: it is only what the simulator works from.
    expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(308);

    // "Copier dans le prix de vente" puts the break-even price in the price field, marked modified.
    await panel(page).getByRole('button', { name: fr.scenarioUseBreakEven }).click();
    await expect(panel(page).getByLabel(fr.eventSellingPriceLabel)).toHaveValue('790');
    await expect(panel(page).getByText(fr.modifiedTag, { exact: true })).toHaveCount(1);

    await page.reload();
    await expand(page, fr.budgetLinesTitle);
    await expect(stat(page, fr.budgetTotalCost)).toHaveText(money(1000));
  });
}

test('a new price and ratio apply to new registrations; existing ones keep their locked price', async ({ page, browser }) => {
  await page.goto('/admin/budget');
  // Seeded at 200 $, default ratio: 200 + 0.5375 × 200 = 307.50 → 308.
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(308);

  const apply = panel(page).getByRole('button', { name: fr.scenarioApply, exact: true });
  const modified = panel(page).getByText(fr.modifiedTag, { exact: true });
  await expect(apply).toBeDisabled();
  await expect(modified).toHaveCount(0);

  // Both change: each is tagged, and the confirmation lists one change per line.
  await panel(page).getByLabel(fr.eventSellingPriceLabel).fill('250');
  await panel(page).getByLabel(fr.ratioMainWholeLabel).fill('60');
  await expect(modified).toHaveCount(2);
  await apply.click();
  const confirm = page.getByRole('dialog', { name: fr.scenarioApplyConfirmTitle });
  await expect(confirm.getByRole('listitem')).toHaveText([
    fr.applyImpactPrice.replace('{before}', money(200)).replace('{after}', money(250)),
    fr.applyImpactRatio.replace('{before}', '53,75 %').replace('{after}', '60 %'),
    fr.applyImpactExisting
  ]);
  await confirm.getByRole('button', { name: fr.scenarioApply, exact: true }).click();
  await expect(page.getByText(fr.pricingAppliedToast)).toBeVisible();

  const event = await getEvent(seeded.eventId);
  expect(Number(event.ratio_main_whole)).toBe(0.6);
  expect(Number(event.selling_price_whole_event)).toBe(250);

  // The existing registration is untouched.
  const existing = await getParty(seeded.partyId);
  expect(Number(existing.calculated_amount_owed)).toBe(308);
  expect(Number(existing.locked_selling_price_whole_event)).toBe(200);
  expect(Number(existing.locked_ratio_main_whole)).toBe(0.5375);

  // The simulator now starts from the saved values, so there is nothing to apply.
  await expect(panel(page).getByLabel(fr.ratioMainWholeLabel)).toHaveValue('60');
  await expect(modified).toHaveCount(0);
  await expect(apply).toBeDisabled();

  // A registration made now, with the same people, pays the new price: 250 + 0.6 × 250 = 400.
  const newPartyId = await createParty(seeded.eventId, ADMIN_ID, E2E_ATTENDEES);
  try {
    expect(Number((await getParty(newPartyId)).calculated_amount_owed)).toBe(400);

    // The admin's totals are the stored amounts, not a recalculation at today's price.
    await page.goto('/admin/users');
    const members = panel(page);
    await expect(members.getByText(money(308), { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(members.getByText(money(400), { exact: true }).filter({ visible: true })).toHaveCount(1);

    // The member sees the same amount, and their form estimates at the locked price: adding a
    // whole-weekend adult adds 200, not 250.
    const memberPage = await (await browser.newContext()).newPage();
    await loginAs(memberPage, TEST_USERS.member);
    await memberPage.goto('/');
    const pass = memberPage.getByRole('article', { name: fr.passLabel });
    await expect(pass.getByText(money(308), { exact: true })).toBeVisible();
    await pass.getByRole('button', { name: fr.editRegistration }).click();
    const estimate = memberPage.getByText(fr.estimatedAmountDueLabel).locator('xpath=following-sibling::p[1]');
    await expect(estimate).toHaveText(money(308));
    await memberPage.getByRole('button', { name: fr.addParticipantButton }).click();
    await expect(estimate).toHaveText(money(508));
  } finally {
    await deleteParty(newPartyId);
  }
});

// #192: the member pages read the event from the app shell, which used to keep the one it loaded
// on arrival until a reload.
test('a new price shows on the member pages at once, without a reload', async ({ page }) => {
  await page.goto('/admin/budget');
  await panel(page).getByLabel(fr.eventSellingPriceLabel).fill('250');
  await panel(page).getByRole('button', { name: fr.scenarioApply, exact: true }).click();
  await page.getByRole('dialog', { name: fr.scenarioApplyConfirmTitle }).getByRole('button', { name: fr.scenarioApply, exact: true }).click();
  await expect(page.getByText(fr.pricingAppliedToast)).toBeVisible();

  await page.getByRole('link', { name: fr.homeLinkLabel }).click();
  await expect(page.getByText(fr.invitePriceLabel).locator('..')).toContainText('250');
  await page.getByRole('link', { name: fr.registerGroupButton }).click();
  const estimate = page.getByText(fr.estimatedAmountDueLabel).locator('xpath=following-sibling::p[1]');
  await expect(estimate).toHaveText(money(250));
});

test('the event editor and Inscrits no longer hold money settings', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(panel(page).getByRole('heading', { name: fr.scenarioSimulatorTitle })).toHaveCount(0);
  await page.goto('/admin/events');
  await eventRow(page, E2E_EVENT_THEME).getByRole('button', { name: fr.edit }).click();
  // The editor nests its own section tabpanel, so look page-wide.
  await expect(page.getByLabel(fr.eventTitle)).toBeVisible();
  await expect(page.getByLabel(fr.eventSellingPriceLabel)).toHaveCount(0);
});

// #236: « Payé par » on an expense line, picked from the event's attendees.
for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
  test(`${viewport.name}: an expense names who paid it, which survives a reload and can be cleared`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/admin/budget');
    await expand(page, fr.budgetLinesTitle);
    await panel(page).getByRole('button', { name: fr.budgetLineAdd }).click();
    await panel(page).getByRole('textbox', { name: fr.budgetLineDescription }).fill('Épicerie');
    await panel(page).getByRole('spinbutton', { name: fr.budgetLineAmount }).fill('120');

    const payer = panel(page).getByRole('combobox', { name: fr.budgetLinePaidBy });
    await expect(payer).toHaveAttribute('placeholder', fr.budgetPayerPlaceholder);
    await payer.click();
    // Accent- and case-insensitive: « bob e2e » finds « Bob E2E ».
    await payer.fill('BOB e2e');
    const options = panel(page).getByRole('listbox', { name: fr.budgetLinePaidBy }).getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Bob E2E');
    await page.screenshot({ path: `${process.env.HOME}/code/yulmix-la-bedaine.worktrees/screenshots/236/budget-payer-open-admin-${viewport.width}.png` });
    await options.first().click();
    await expect(payer).toHaveValue('Bob E2E');
    await expectNoHorizontalOverflow(page);

    await panel(page).getByRole('button', { name: fr.budgetSave }).click();
    await expect(page.getByText(fr.budgetSavedToast)).toBeVisible();
    const attendeeId = (await getBudget(seeded.eventId)).lines[0].paid_by_attendee_id;
    expect(attendeeId).toBeTruthy();
    // No effect on money.
    expect(Number((await getBudget(seeded.eventId)).total_cost)).toBe(120);
    expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(308);

    await page.reload();
    await expand(page, fr.budgetLinesTitle);
    await expect(panel(page).getByRole('combobox', { name: fr.budgetLinePaidBy })).toHaveValue('Bob E2E');
    await page.screenshot({ path: `${process.env.HOME}/code/yulmix-la-bedaine.worktrees/screenshots/236/budget-payer-saved-admin-${viewport.width}.png` });

    // Clear it: « Personne / fonds commun ».
    await panel(page).getByRole('combobox', { name: fr.budgetLinePaidBy }).click();
    await panel(page).getByRole('listbox', { name: fr.budgetLinePaidBy }).getByRole('option', { name: fr.budgetPayerNone }).click();
    await expect(panel(page).getByRole('combobox', { name: fr.budgetLinePaidBy })).toHaveValue('');
    await panel(page).getByRole('button', { name: fr.budgetSave }).click();
    await expect(page.getByText(fr.budgetSavedToast)).toBeVisible();
    expect((await getBudget(seeded.eventId)).lines[0]).toEqual({ category: 'Other', description: 'Épicerie', amount: 120 });
  });
}
