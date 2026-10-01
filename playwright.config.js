import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

// Must run synchronously here, not in globalSetup: Playwright starts `webServer`
// before globalSetup runs, so setting process.env there is too late for the dev
// server Vite spawns below to pick up VITE_SUPABASE_*.
function loadLocalSupabaseEnv() {
  let output;
  try {
    output = execSync('supabase status -o env', { encoding: 'utf-8' });
  } catch (error) {
    throw new Error(
      'Local Supabase is not running. Start it first with `supabase start` (or ' +
      '`supabase db reset` for a guaranteed-fresh database with the seeded test users), ' +
      'then re-run the e2e tests.\n' + error.message
    );
  }

  const env = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/);
    if (match) env[match[1]] = match[2];
  }
  if (!env.API_URL || !env.ANON_KEY) {
    throw new Error('`supabase status -o env` did not return API_URL/ANON_KEY as expected.');
  }
  return {
    supabaseEnv: { VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_ANON_KEY: env.ANON_KEY },
    serviceRoleKey: env.SERVICE_ROLE_KEY
  };
}

const { supabaseEnv, serviceRoleKey } = loadLocalSupabaseEnv();
Object.assign(process.env, supabaseEnv);
// For the specs' own Node-side helpers only (creating throwaway auth users, e2e/support). Not in
// supabaseEnv, so the dev server, and the browser bundle, never see it.
process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey || '';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(member-(cancellation|pass|account-deletion)|email-log|admin-cancelled-parties|admin-budget|attendee-price-rounding|attendees-edit|admin-locations|admin-place-picker|admin-occupancy|member-prefill-name|admin-remount|admin-event-editor|admin-venues|admin-event-venue|member-arrival-default|member-registration-confirmation|admin-logistics-batch-save|member-dietary|member-registration-draft|admin-event-archive|admin-logistics-views|admin-data-export|member-departure-place|member-carpool-board)\.spec\.js/
    },
    {
      // Admin screens must work on a phone. Runs after `chromium` (not alongside it) because
      // admin-tabs.spec.js seeds and mutates the same single active event/registration.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: /admin-tabs\.spec\.js/,
      dependencies: ['chromium']
    },
    {
      // Also reseeds the shared active event (with a start date for the close-date lock), so it
      // runs after the admin-tabs projects rather than alongside them.
      name: 'member-cancellation',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-cancellation\.spec\.js/,
      dependencies: ['mobile-chrome']
    },
    {
      // Reseeds the same shared active event, so it runs last, on its own.
      name: 'member-pass',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-pass\.spec\.js/,
      dependencies: ['member-cancellation']
    },
    {
      // Reseeds the same shared active event, so it runs after member-pass, on its own.
      name: 'member-account-deletion',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-account-deletion\.spec\.js/,
      dependencies: ['member-pass']
    },
    {
      // Reseeds the same shared active event, so it runs after member-account-deletion, on its own.
      // Sets its own phone and desktop viewports.
      name: 'email-log',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /email-log\.spec\.js/,
      dependencies: ['member-account-deletion']
    },
    {
      // Reseeds the same shared active event, so it runs after email-log, on its own.
      name: 'admin-cancelled-parties',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-cancelled-parties\.spec\.js/,
      dependencies: ['email-log']
    },
    {
      // Reseeds the same shared active event (and changes its price), so it runs last, on its own.
      // Sets its own phone and desktop viewports.
      name: 'admin-budget',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-budget\.spec\.js/,
      dependencies: ['admin-cancelled-parties']
    },
    {
      // Reseeds the same shared active event at its own prices, so it runs after admin-budget, on
      // its own.
      name: 'attendee-price-rounding',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /attendee-price-rounding\.spec\.js/,
      dependencies: ['admin-budget']
    },
    {
      // Reseeds the same shared active event, so it runs after attendee-price-rounding, on its own.
      name: 'attendees-edit',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /attendees-edit\.spec\.js/,
      dependencies: ['attendee-price-rounding']
    },
    {
      // Reseeds the same shared active event and gives it sleeping locations, so it runs after
      // attendees-edit, on its own.
      name: 'admin-locations',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-locations\.spec\.js/,
      dependencies: ['attendees-edit']
    },
    {
      // Reseeds the same shared active event with places and assigns them, so it runs after
      // admin-locations, on its own.
      name: 'admin-place-picker',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-place-picker\.spec\.js/,
      dependencies: ['admin-locations']
    },
    {
      // Reseeds the same shared active event with places and assigns them, so it runs after
      // admin-place-picker, on its own.
      name: 'admin-occupancy',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-occupancy\.spec\.js/,
      dependencies: ['admin-place-picker']
    },
    {
      // Reseeds the same shared active event, so it runs after admin-occupancy, on its own.
      name: 'member-prefill-name',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-prefill-name\.spec\.js/,
      dependencies: ['admin-occupancy']
    },
    {
      // Reseeds the same shared active event, so it runs after member-prefill-name, on its own.
      name: 'admin-remount',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-remount\.spec\.js/,
      dependencies: ['member-prefill-name']
    },
    {
      // Reseeds the same shared active event and edits it, so it runs after admin-remount, on its
      // own.
      name: 'admin-event-editor',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-event-editor\.spec\.js/,
      dependencies: ['admin-remount']
    },
    {
      // Reseeds the same shared active event and edits its venue, so it runs after
      // admin-event-editor, on its own. The phone checks use a phone viewport inside the spec.
      name: 'admin-venues',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-venues\.spec\.js/,
      dependencies: ['admin-event-editor']
    },
    {
      // Reseeds the same shared active event and changes its venue, so it runs after
      // admin-venues, on its own.
      name: 'admin-event-venue',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-event-venue\.spec\.js/,
      dependencies: ['admin-venues']
    },
    {
      // Reseeds the same shared active event with its own dates, so it runs after
      // admin-event-venue, on its own.
      name: 'member-arrival-default',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-arrival-default\.spec\.js/,
      dependencies: ['admin-event-venue']
    },
    {
      // Reseeds the same shared active event (and moves its registration dates), so it runs after
      // member-arrival-default, on its own.
      name: 'member-registration-confirmation',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-registration-confirmation\.spec\.js/,
      dependencies: ['member-arrival-default']
    },
    {
      // Reseeds the same shared active event with places and a second party, so it runs after
      // member-registration-confirmation, on its own.
      name: 'admin-logistics-batch-save',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-logistics-batch-save\.spec\.js/,
      dependencies: ['member-registration-confirmation']
    },
    {
      // Reseeds the same shared active event and edits the member's registration, so it runs
      // after admin-logistics-batch-save, on its own.
      name: 'member-dietary',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-dietary\.spec\.js/,
      dependencies: ['admin-logistics-batch-save']
    },
    {
      // Reseeds the same shared active event and saves the member's registration, so it runs
      // after member-dietary, on its own.
      name: 'member-registration-draft',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-registration-draft\.spec\.js/,
      dependencies: ['member-dietary']
    },
    {
      // Reseeds the same shared active event and archives it, so it runs after
      // member-registration-draft, on its own.
      name: 'admin-event-archive',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-event-archive\.spec\.js/,
      dependencies: ['member-registration-draft']
    },
    {
      // Reseeds the same shared active event (with a small capacity, to waitlist a party), so it
      // runs after admin-event-archive, on its own.
      name: 'admin-logistics-views',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-logistics-views\.spec\.js/,
      dependencies: ['admin-event-archive']
    },
    {
      // Reseeds the same shared active event (a waitlisted party again), so it runs after
      // admin-logistics-views, on its own.
      name: 'admin-data-export',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-data-export\.spec\.js/,
      dependencies: ['admin-logistics-views']
    },
    {
      // Reseeds the same shared active event, so it runs after admin-data-export, on its own.
      name: 'member-departure-place',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-departure-place\.spec\.js/,
      dependencies: ['admin-data-export']
    },
    {
      // The carpool board (#180) reseeds the shared active event and sets its venue's coordinates.
      name: 'member-carpool-board',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /member-carpool-board\.spec\.js/,
      dependencies: ['member-departure-place']
    }
  ],
  webServer: {
    command: 'npm run dev -- --port ' + PORT + ' --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: supabaseEnv
  }
});
