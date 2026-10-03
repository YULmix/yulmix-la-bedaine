import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';

test('unauthenticated visitor sees the sign-in prompt, not event data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Connectez-vous pour voir les événements')).toBeVisible();
});

test('member: no admin nav, /admin blocked, RLS limits profiles to own row', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);

  await page.getByRole('button', { name: 'Test Member' }).click();
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toHaveCount(0);

  await page.goto('/admin');
  await expect(page.getByText('Accès réservé aux administrateurs')).toBeVisible();

  const profiles = await page.evaluate(async () => {
    const { data, error } = await window.__supabase.from('profiles').select('email');
    if (error) throw error;
    return data;
  });
  expect(profiles).toHaveLength(1);
  expect(profiles[0].email).toBe(TEST_USERS.member.email);
});

test('admin: sees admin nav, can open the admin, RLS exposes all profiles', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);

  await page.getByRole('button', { name: 'Test Admin' }).click();
  const adminNavButton = page.getByRole('menuitem', { name: 'Admin', exact: true });
  await expect(adminNavButton).toBeVisible();
  await adminNavButton.click();

  await expect(page).toHaveURL(/\/admin\/overview$/);
  await expect(page.getByText('Accès réservé aux administrateurs')).toHaveCount(0);

  const profiles = await page.evaluate(async () => {
    const { data, error } = await window.__supabase.from('profiles').select('email');
    if (error) throw error;
    return data;
  });
  // RLS scope, not a head count (#170): the admin sees other people's profiles too, so both
  // seeded users. Other specs' throwaway members may exist at the same time; the member test
  // proves a member sees only their own row.
  const emails = profiles.map((p) => p.email);
  expect(emails).toEqual(expect.arrayContaining([TEST_USERS.admin.email, TEST_USERS.member.email]));
});
