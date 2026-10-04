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

// Specs that need the shared active event (and the seeded member's registration) to themselves,
// in the order they run, one after the other, after the `chromium` project (which runs every
// other spec, one file at a time). Each entry becomes a project that depends on the previous
// entry, and its spec is ignored by `chromium`.
//
// To add a spec that reseeds or mutates the shared event: append ONE entry at the END of this list
// ({ name, why } is enough: `spec` defaults to the spec file name without `.spec.js`, and
// `device` to 'Desktop Chrome'). Nothing else in this file needs editing. Keep the `why`: it is
// the reason for the ordering. Don't reorder existing entries.
const SERIAL_ENTRIES = [
  // Admin screens must work on a phone. Runs after `chromium` (not alongside it) because
  // admin-tabs.spec.js seeds and mutates the same single active event/registration.
  { name: 'mobile-chrome', spec: 'admin-tabs', device: 'Pixel 7' },
  // Also reseeds the shared active event (with a start date for the close-date lock), so it
  // runs after the admin-tabs projects rather than alongside them.
  { name: 'member-cancellation' },
  // Reseeds the same shared active event, so it runs last, on its own.
  { name: 'member-pass' },
  // Reseeds the same shared active event, so it runs after member-pass, on its own.
  { name: 'member-account-deletion' },
  // Reseeds the same shared active event, so it runs after member-account-deletion, on its own.
  // Sets its own phone and desktop viewports.
  { name: 'email-log' },
  // Reseeds the same shared active event, so it runs after email-log, on its own.
  { name: 'admin-cancelled-parties' },
  // Reseeds the same shared active event (and changes its price), so it runs last, on its own.
  // Sets its own phone and desktop viewports.
  { name: 'admin-budget' },
  // Reseeds the same shared active event at its own prices, so it runs after admin-budget, on
  // its own.
  { name: 'attendee-price-rounding' },
  // Reseeds the same shared active event, so it runs after attendee-price-rounding, on its own.
  { name: 'attendees-edit' },
  // Reseeds the same shared active event and gives it sleeping locations, so it runs after
  // attendees-edit, on its own.
  { name: 'admin-locations' },
  // Reseeds the same shared active event with places and assigns them, so it runs after
  // admin-locations, on its own.
  { name: 'admin-place-picker' },
  // Reseeds the same shared active event with places and assigns them, so it runs after
  // admin-place-picker, on its own.
  { name: 'admin-occupancy' },
  // Reseeds the same shared active event, so it runs after admin-occupancy, on its own.
  { name: 'member-prefill-name' },
  // Reseeds the same shared active event, so it runs after member-prefill-name, on its own.
  { name: 'admin-remount' },
  // Reseeds the same shared active event and edits it, so it runs after admin-remount, on its
  // own.
  { name: 'admin-event-editor' },
  // Reseeds the same shared active event and edits its venue, so it runs after
  // admin-event-editor, on its own. The phone checks use a phone viewport inside the spec.
  { name: 'admin-venues' },
  // Reseeds the same shared active event and changes its venue, so it runs after
  // admin-venues, on its own.
  { name: 'admin-event-venue' },
  // Reseeds the same shared active event with its own dates, so it runs after
  // admin-event-venue, on its own.
  { name: 'member-arrival-default' },
  // Reseeds the same shared active event (and moves its registration dates), so it runs after
  // member-arrival-default, on its own.
  { name: 'member-registration-confirmation' },
  // Reseeds the same shared active event with places and a second party, so it runs after
  // member-registration-confirmation, on its own.
  { name: 'admin-logistics-batch-save' },
  // Reseeds the same shared active event and edits the member's registration, so it runs
  // after admin-logistics-batch-save, on its own.
  { name: 'member-dietary' },
  // Reseeds the same shared active event and saves the member's registration, so it runs
  // after member-dietary, on its own.
  { name: 'member-registration-draft' },
  // Reseeds the same shared active event and archives it, so it runs after
  // member-registration-draft, on its own.
  { name: 'admin-event-archive' },
  // Reseeds the same shared active event (with a small capacity, to waitlist a party), so it
  // runs after admin-event-archive, on its own.
  { name: 'admin-logistics-views' },
  // Reseeds the same shared active event (a waitlisted party again), so it runs after
  // admin-logistics-views, on its own.
  { name: 'admin-data-export' },
  // Reseeds the same shared active event, so it runs after admin-data-export, on its own.
  { name: 'member-departure-place' },
  // The carpool board (#180) reseeds the shared active event and sets its venue's coordinates.
  { name: 'member-carpool-board' },
  // Reseeds the same shared active event and its venue's galleries (#177), so it runs after
  // member-carpool-board, on its own. Sets its own phone viewport.
  { name: 'galleries' },
  // The admin detail pages' header and geometry (#210) reseed the same shared active event and
  // give its venue locations, so it runs after galleries, on its own. Sets its own viewports.
  { name: 'admin-drill-down' },
  // The summary's transport line (#232) reseeds the shared active event, so it runs last, alone.
  { name: 'member-transport-none' },
  // Creates events (#111) next to the shared active event it reseeds, so it runs after
  // member-transport-none, on its own. Sets its own viewports.
  { name: 'admin-event-create' },
];
const SERIAL_SPECS = SERIAL_ENTRIES.map(({ name, spec = name, device = 'Desktop Chrome' }) => ({ name, spec, device }));

// `chromium` and each serial project pick their files with these.
const specMatcher = (specs) => new RegExp('(' + specs.join('|') + ')\\.spec\\.js');

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
      // One file at a time: admin-tabs, admin-change-history and others seed and change the same
      // active event and the seeded member's registration, so in parallel they see each other's
      // parties and throwaway members (#170).
      workers: 1,
      // Every spec with its own project below runs there, not here (admin-tabs runs in both).
      testIgnore: specMatcher(SERIAL_SPECS.filter((s) => s.spec !== 'admin-tabs').map((s) => s.spec))
    },
    ...SERIAL_SPECS.map(({ name, spec, device }, i) => ({
      name,
      use: { ...devices[device] },
      testMatch: specMatcher([spec]),
      dependencies: [i === 0 ? 'chromium' : SERIAL_SPECS[i - 1].name]
    }))
  ],
  webServer: {
    command: 'npm run dev -- --port ' + PORT + ' --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: supabaseEnv
  }
});
