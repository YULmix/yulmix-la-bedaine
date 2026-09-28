// The Budget admin tab (issue #109): categorized cost lines saved to the admin-only
// event_budgets table, and the simulator whose "apply" sets the base price and main-event ratio,
// which reprices unpaid registrations.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  deleteBudget,
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

const panel = (page) => page.getByRole('tabpanel');
// A <Stat>'s value is the paragraph right after its label.
const stat = (page, label) => panel(page).getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
// Same formatting as src/lib/format.js (fr-CA, e.g. "1 000,00 $").
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
    await page.goto('/admin?tab=budget');
    await expect(panel(page).getByRole('heading', { name: fr.adminTabBudget, exact: true })).toBeVisible();
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

    await page.reload();
    await expect(stat(page, fr.budgetTotalCost)).toHaveText(money(1000));
  });
}

test('applying a price and main-event ratio reprices the unpaid registration', async ({ page }) => {
  await page.goto('/admin?tab=budget');
  // Seeded at 200 $, default ratio: 200 + 0.5375 × 200 = 307.50 → 308.
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(308);

  const apply = panel(page).getByRole('button', { name: fr.scenarioApply, exact: true });
  const modified = panel(page).getByText(fr.modifiedTag, { exact: true });
  await expect(apply).toBeDisabled();
  await expect(modified).toHaveCount(0);

  // Only the ratio changes: it alone is tagged, and the confirmation lists one change per line.
  await panel(page).getByLabel(fr.ratioMainWholeLabel).fill('60');
  await expect(modified).toHaveCount(1);
  await apply.click();
  const confirm = page.getByRole('dialog', { name: fr.scenarioApplyConfirmTitle });
  const impacts = confirm.getByRole('listitem');
  await expect(impacts).toHaveText([
    fr.applyImpactRatio.replace('{before}', '53,75 %').replace('{after}', '60 %'),
    fr.applyImpactReprice.replace('{count}', 1),
    fr.applyImpactPaid
  ]);
  await confirm.getByRole('button', { name: fr.scenarioApply, exact: true }).click();
  await expect(page.getByText(fr.eventRepricedCountToast.replace('{count}', 1))).toBeVisible();

  const event = await getEvent(seeded.eventId);
  expect(Number(event.ratio_main_whole)).toBe(0.6);
  expect(Number(event.selling_price_whole_event)).toBe(200);
  // 200 + 0.6 × 200 = 320.
  expect(Number((await getParty(seeded.partyId)).calculated_amount_owed)).toBe(320);

  // The simulator now starts from the saved values, so there is nothing to apply.
  await expect(panel(page).getByLabel(fr.ratioMainWholeLabel)).toHaveValue('60');
  await expect(modified).toHaveCount(0);
  await expect(apply).toBeDisabled();
});

test('the event dialog and the tools tab no longer hold money settings', async ({ page }) => {
  await page.goto('/admin?tab=tools');
  await expect(panel(page).getByRole('heading', { name: fr.scenarioSimulatorTitle })).toHaveCount(0);
  await page.goto('/admin?tab=events');
  await panel(page).getByRole('button', { name: fr.edit }).click();
  const dialog = page.getByRole('dialog', { name: fr.editEventMetadataTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(fr.eventSellingPriceLabel)).toHaveCount(0);
});
