import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';

test('unauthenticated visitor sees the sign-in prompt, not event data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Connectez-vous pour voir les événements')).toBeVisible();
});

test('member: no admin nav, /admin blocked, RLS limits profiles to own row', async ({ page }) => {
  await loginAs(page, TEST_USERS.member);

  await page.getByRole('button', { name: 'Test Member' }).click();
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);

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

test('admin: sees admin nav, can open /admin, RLS exposes all profiles', async ({ page }) => {
  await loginAs(page, TEST_USERS.admin);

  await page.getByRole('button', { name: 'Test Admin' }).click();
  const adminNavButton = page.getByRole('button', { name: 'Admin', exact: true });
  await expect(adminNavButton).toBeVisible();
  await adminNavButton.click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Accès réservé aux administrateurs')).toHaveCount(0);

  const profiles = await page.evaluate(async () => {
    const { data, error } = await window.__supabase.from('profiles').select('email');
    if (error) throw error;
    return data;
  });
  const emails = profiles.map((p) => p.email).sort();
  expect(emails).toEqual([TEST_USERS.admin.email, TEST_USERS.member.email].sort());
});
