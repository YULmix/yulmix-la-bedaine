// Cancelled registrations in the admin (issue #101): no refunds, so a cancelled party counts for
// nothing. It stays out of the totals, "Tous" and logistics, and shows only under an "Annulées"
// pill that exists only while there is one.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  E2E_ATTENDEES,
  addParty,
  createThrowawayMember,
  deleteThrowawayMember,
  seedActiveEventWithMemberParty,
  teardownActiveEventWithMemberParty
} from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

const MEMBER_NAME = 'Test Member';

// Both tests use the one shared active event.
test.describe.configure({ mode: 'serial' });

let seeded;
let cancelledMember;

test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await loginAs(page, TEST_USERS.admin);
});

test.afterEach(async () => {
  await deleteThrowawayMember(cancelledMember?.id);
  cancelledMember = null;
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

// The admin tab's panel; the Logistique tab nests its views' own tabpanel inside (#179).
const panel = (page) => page.locator('[role="tabpanel"][id^="admin-tabpanel-"]');
const pill = (page, label) => panel(page).getByRole('group', { name: fr.filterLabel }).getByRole('button', { name: label });
// A <Stat>'s value is the paragraph right after its label.
const kpi = (page, label) => panel(page).getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');

test('with no cancelled party there is no "Annulées" pill', async ({ page }) => {
  await page.goto('/admin?tab=users');
  await expect(pill(page, fr.filterAll)).toContainText('1');
  await expect(pill(page, fr.filterCancelled)).toHaveCount(0);
});

test('a cancelled party is left out of totals, "Tous" and logistics, and listed under "Annulées"', async ({ page }) => {
  cancelledMember = await createThrowawayMember('cancelled');
  await addParty(cancelledMember.id, seeded.eventId, 'cancelled');

  // Overview: only the active party's two attendees and one group.
  await page.goto('/admin?tab=overview');
  await expect(kpi(page, fr.kpiPeople)).toHaveText(String(E2E_ATTENDEES.length));
  await expect(kpi(page, fr.registeredGroupsStatLabel)).toHaveText('1');

  // Users tab: "Tous" has the active party only.
  await page.goto('/admin?tab=users');
  await expect(pill(page, fr.filterAll)).toContainText('1');
  await expect(pill(page, fr.unpaidShort)).toContainText('1');
  await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toHaveCount(1);
  await expect(panel(page).getByRole('button', { name: cancelledMember.fullName })).toHaveCount(0);

  // "Annulées (1)": the cancelled party, tagged, with no payment toggle, still editable.
  await expect(pill(page, fr.filterCancelled)).toContainText('1');
  await pill(page, fr.filterCancelled).click();
  const list = panel(page).getByRole('listitem');
  await expect(list).toHaveCount(1);
  await expect(list.getByRole('button', { name: cancelledMember.fullName })).toBeVisible();
  await expect(list.getByText(fr.statusCancelled, { exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: fr.unpaidShort, exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: fr.paid, exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: fr.editRegistrationButton })).toBeVisible();

  // Logistics: only the active party.
  await page.goto('/admin?tab=logistics');
  await expect(panel(page).getByRole('button', { name: MEMBER_NAME, exact: true })).toHaveCount(1);
  await expect(panel(page).getByRole('button', { name: cancelledMember.fullName })).toHaveCount(0);
  for (const attendee of E2E_ATTENDEES) {
    await expect(panel(page).getByText(attendee.name, { exact: true })).toHaveCount(1);
  }

  // CSV export: a header row, the active party, and the totals row. No cancelled party.
  await page.goto('/admin?tab=tools');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).getByRole('button', { name: fr.exportCSVButton }).click()
  ]);
  const csv = readFileSync(await download.path(), 'utf-8');
  expect(csv).toContain(MEMBER_NAME);
  expect(csv).not.toContain(cancelledMember.fullName);
  expect(csv).not.toContain(cancelledMember.email);
});
