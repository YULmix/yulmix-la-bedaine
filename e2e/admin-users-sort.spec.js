// Inscrits « Liste » sorting (#259): by name (default), « Inscrit le » and « Modifié le », from the
// column headers (aria-sort) or, on a phone, the « Trier par » chips; the choice is in ?tri=.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adminMain } from './support/admin.js';
import { loginAs, TEST_USERS } from './support/auth.js';
import {
  addParty,
  createThrowawayMember,
  deleteThrowawayMember,
  seedActiveEventWithMemberParty,
  setPartyTimestamps,
  teardownActiveEventWithMemberParty
} from './support/testData.js';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

test.describe.configure({ mode: 'serial' });

let seeded;
let members = [];

// Registered: member (seeded, now), early (2026-01-01), late (2026-02-01). A trigger stamps
// last_edited_at with now() on every update, so « Modifié le » follows the order the rows were
// touched here (early, then late); the never-edited fallback is covered by the unit tests.
test.beforeEach(async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  const early = await createThrowawayMember('sortA');
  const late = await createThrowawayMember('sortB');
  members = [early, late];
  const earlyParty = await addParty(early.id, seeded.eventId);
  const lateParty = await addParty(late.id, seeded.eventId);
  await setPartyTimestamps(earlyParty, { created_at: '2026-01-01T12:00:00Z' });
  await setPartyTimestamps(lateParty, { created_at: '2026-02-01T12:00:00Z' });
  await loginAs(page, TEST_USERS.admin);
});

test.afterEach(async () => {
  for (const member of members) await deleteThrowawayMember(member.id);
  members = [];
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const panel = page => adminMain(page);
const rows = page => panel(page).getByRole('rowgroup').getByRole('row');
const names = async page => (await rows(page).getByRole('button').filter({ hasText: /^E2E |Test Member/ }).allTextContents());
const mine = async page => (await names(page)).filter(n => /E2E sort/.test(n));
const header = (page, name) => panel(page).getByRole('columnheader', { name });

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('headers sort, the URL keeps the choice', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(header(page, fr.logisticsTableName)).toHaveAttribute('aria-sort', 'ascending');
    await expect(header(page, fr.partyDetailRegisteredOn)).toHaveAttribute('aria-sort', 'none');
    const alpha = await mine(page);
    expect(alpha).toHaveLength(2);
    expect(alpha[0] < alpha[1]).toBe(true);

    // « Inscrit le »: newest first on the first click; the seeded member (just registered) leads.
    await header(page, fr.partyDetailRegisteredOn).getByRole('button').click();
    await expect(page).toHaveURL(/\/admin\/users\?tri=-inscription$/);
    await expect(header(page, fr.partyDetailRegisteredOn)).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => mine(page)).toEqual([alpha[1], alpha[0]]);
    await expect(rows(page).first()).toContainText('Test Member');

    await header(page, fr.partyDetailRegisteredOn).getByRole('button').click();
    await expect(page).toHaveURL(/\?tri=inscription$/);
    await expect.poll(() => mine(page)).toEqual(alpha);

    // « Modifié le »: never-edited parties count from their registration.
    await header(page, fr.sortModifiedOn).getByRole('button').click();
    await expect(page).toHaveURL(/\?tri=-modification$/);
    await expect.poll(() => mine(page)).toEqual([alpha[1], alpha[0]]);

    // Reload keeps it, and so do the filters and the search.
    await page.reload();
    await expect(header(page, fr.sortModifiedOn)).toHaveAttribute('aria-sort', 'descending');
    await panel(page).getByRole('group', { name: fr.filterLabel }).getByRole('button', { name: new RegExp('^' + fr.paid) }).click();
    await expect(page).toHaveURL(/\?tri=-modification$/);
    await panel(page).getByRole('group', { name: fr.filterLabel }).getByRole('button', { name: new RegExp('^' + fr.filterAll) }).click();

    // Name is the default: no param; then Z→A.
    await header(page, fr.logisticsTableName).getByRole('button').click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect.poll(() => mine(page)).toEqual(alpha);
    await header(page, fr.logisticsTableName).getByRole('button').click();
    await expect(page).toHaveURL(/\?tri=-nom$/);
    await expect.poll(() => mine(page)).toEqual([alpha[1], alpha[0]]);
  });

  test('an unknown value falls back to the default', async ({ page }) => {
    await page.goto('/admin/users?tri=bogus');
    await expect(header(page, fr.logisticsTableName)).toHaveAttribute('aria-sort', 'ascending');
  });

  test('the dates are shown in the table', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(rows(page).filter({ hasText: 'E2E sortB' })).toContainText('1 février 2026');
    await expect(rows(page).filter({ hasText: 'E2E sortA' })).toContainText('1 janvier 2026');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('chips and the direction button sort the cards', async ({ page }) => {
    await page.goto('/admin/users');
    const group = panel(page).getByRole('group', { name: fr.participantsSortLabel });
    await expect(group.getByRole('button', { name: fr.logisticsTableName })).toHaveAttribute('aria-pressed', 'true');
    const alpha = await mine(page);
    await group.getByRole('button', { name: fr.partyDetailRegisteredOn }).click();
    await expect(page).toHaveURL(/\?tri=-inscription$/);
    await expect.poll(() => mine(page)).toEqual([alpha[1], alpha[0]]);
    await group.getByRole('button', { name: fr.sortDirectionDescending }).click();
    await expect(page).toHaveURL(/\?tri=inscription$/);
    await expect.poll(() => mine(page)).toEqual(alpha);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// Screenshots for review: E2E_SCREENSHOT_DIR=… npx playwright test --project=admin-users-sort -g screenshots
test('« Inscrits » sorted screenshots', async ({ page }) => {
  test.skip(!process.env.E2E_SCREENSHOT_DIR, 'set E2E_SCREENSHOT_DIR to take screenshots');
  for (const width of [390, 1440, 2560]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/admin/users?tri=-inscription');
    await expect(rows(page).first()).toBeVisible();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/inscrits-sorted-admin-${width}.png` });
  }
});
