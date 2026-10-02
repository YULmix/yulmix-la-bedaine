// Per-party email log (#93): a short, honest summary for the member under their Pass, every
// detail for admins in the party's edit dialog, and failed/pending emails surfaced in Vue
// d'ensemble. Run at a phone width and a desktop width.
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './support/auth.js';
import { seedActiveEventWithMemberParty, seedEmailLog, teardownActiveEventWithMemberParty } from './support/testData.js';
import { readFileSync } from 'node:fs';

const fr = JSON.parse(readFileSync(new URL('../src/locales/fr.json', import.meta.url), 'utf-8'));

const MEMBER_NAME = 'Test Member';
const RECIPIENT = 'member@test.local';
const RESEND_ID = 're_e2e_123';
const RESEND_ERROR = '422 e2e: the recipient address was refused';

// One row per status. Only registration (sent) and payment (failed) may reach the member.
const EMAIL_ROWS = [
  { template: 'registration', status: 'sent', recipient: RECIPIENT, resend_id: RESEND_ID },
  { template: 'payment', status: 'failed', recipient: RECIPIENT, error: RESEND_ERROR },
  { template: 'waitlist', status: 'backfilled' },
  { template: 'promotion', status: 'dry_run', recipient: RECIPIENT },
  { template: 'accommodation', status: 'pending', recipient: RECIPIENT }
];

// The specs share the single active e2e event, so they run one at a time.
test.describe.configure({ mode: 'serial' });

let seeded;
test.afterEach(async () => {
  await teardownActiveEventWithMemberParty(seeded ?? {});
  seeded = null;
});

const screenshot = async (page, name) => {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

for (const { label, viewport } of [
  { label: 'phone', viewport: { width: 390, height: 844 } },
  { label: 'desktop', viewport: { width: 1280, height: 800 } }
]) {
  test(`${label}: the member sees only sent and failed emails, the admin sees everything`, async ({ browser }) => {
    seeded = await seedActiveEventWithMemberParty();
    await seedEmailLog(seeded.partyId, EMAIL_ROWS);

    // Member: under the Pass, sent and "non envoyé" only, and nothing an admin alone may see.
    const memberPage = await (await browser.newContext({ viewport })).newPage();
    await loginAs(memberPage, TEST_USERS.member);
    await memberPage.goto('/');
    const emails = memberPage.getByRole('region', { name: fr.emailsTitle });
    await expect(emails.getByText(fr.emailTemplateRegistration, { exact: true })).toBeVisible();
    await expect(emails.getByText(fr.emailTemplatePayment, { exact: true })).toBeVisible();
    await expect(emails.getByText(fr.emailStatusNotSent, { exact: true })).toBeVisible();
    await expect(emails.getByText(fr.emailsNotReceivedHint)).toBeVisible();
    for (const hidden of [fr.emailTemplateWaitlist, fr.emailTemplatePromotion, fr.emailTemplateAccommodation]) {
      await expect(emails.getByText(hidden, { exact: true })).toHaveCount(0);
    }
    // In the page's content: the preview-only header marker (src/preview/TestAccounts.jsx) shows
    // the signed-in test account's own address, which is no leak, once its lazy chunk has loaded.
    for (const secret of [RESEND_ERROR, RESEND_ID, RECIPIENT]) {
      await expect(memberPage.locator('#main').getByText(secret)).toHaveCount(0);
    }
    await screenshot(memberPage, `email-log-member-${label}`);

    // Admin: Vue d'ensemble counts failed + pending and lists them by party.
    const adminPage = await (await browser.newContext({ viewport })).newPage();
    await loginAs(adminPage, TEST_USERS.admin);
    await adminPage.goto('/admin/overview');
    const problems = adminPage.getByRole('status').filter({ hasText: fr.emailProblemsTitleOther.replace('{count}', 2) });
    await expect(problems).toBeVisible();
    await problems.getByRole('button', { name: fr.emailProblemsShow }).click();
    const list = problems.getByRole('list');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText(MEMBER_NAME).first()).toBeVisible();
    await expect(list.getByText(RESEND_ERROR)).toBeVisible();
    await screenshot(adminPage, `email-log-overview-${label}`);

    // ...and opens the party's edit dialog, where every row is spelled out.
    await list.getByRole('button', { name: fr.emailProblemsOpenParty }).first().click();
    const dialog = adminPage.getByRole('dialog', { name: fr.adminEditRegistrationTitle });
    await expect(dialog.getByText(fr.emailLogTitle)).toBeVisible();
    for (const status of [fr.emailStatusSent, fr.emailStatusFailed, fr.emailStatusPending, fr.emailStatusDryRun, fr.emailStatusBackfilled]) {
      await expect(dialog.getByText(status, { exact: true })).toBeVisible();
    }
    for (const template of [fr.emailTemplateRegistration, fr.emailTemplatePayment, fr.emailTemplateWaitlist, fr.emailTemplatePromotion, fr.emailTemplateAccommodation]) {
      await expect(dialog.getByText(template, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByText(RESEND_ERROR)).toBeVisible();
    await expect(dialog.getByText(`${fr.emailLogRecipient} ${RECIPIENT}`).first()).toBeVisible();
    await screenshot(adminPage, `email-log-admin-dialog-${label}`);
  });
}

test('with no email problems, Vue d\'ensemble shows no warning', async ({ page }) => {
  seeded = await seedActiveEventWithMemberParty();
  await seedEmailLog(seeded.partyId, [{ template: 'registration', status: 'sent', recipient: RECIPIENT }]);
  await loginAs(page, TEST_USERS.admin);
  await page.goto('/admin/overview');
  await expect(page.getByText(fr.kpiPeople)).toBeVisible();
  await expect(page.getByText(fr.emailProblemsHint)).toHaveCount(0);
});
