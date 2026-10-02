// The member's Pass labels the amount to match its stamp (issue #90): "Montant dû" while unpaid,
// "Montant payé" once an admin has marked the party paid.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { getParty, seedActiveEventWithMemberParty, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

let seeded;
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

test('the Pass says "Montant dû" until an admin marks the party paid, then "Montant payé"', async ({ browser }) => {
  seeded = await seedActiveEventWithMemberParty();

  const memberPage = await (await browser.newContext()).newPage();
  await loginAs(memberPage, TEST_USERS.member);
  await memberPage.goto('/');
  const pass = memberPage.getByRole('article', { name: fr.passLabel });
  await expect(pass.getByText(fr.amountDue, { exact: true })).toBeVisible();
  await expect(pass.getByText(fr.stampUnpaid, { exact: true })).toBeVisible();

  const adminPage = await (await browser.newContext()).newPage();
  await loginAs(adminPage, TEST_USERS.admin);
  await adminPage.goto('/admin/users');
  await adminPage.getByRole('tabpanel').getByRole('button', { name: fr.unpaidShort, exact: true }).click();
  const confirm = adminPage.getByRole('dialog', { name: fr.markPaid });
  await confirm.getByRole('button', { name: fr.markPaid, exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect.poll(async () => (await getParty(seeded.partyId)).payment_status).toBe('paid');

  await memberPage.reload();
  await expect(pass.getByText(fr.amountPaid, { exact: true })).toBeVisible();
  await expect(pass.getByText(fr.stampPaid, { exact: true })).toBeVisible();
  await expect(pass.getByText(fr.amountDue, { exact: true })).toHaveCount(0);
});
