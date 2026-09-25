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
  return { VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_ANON_KEY: env.ANON_KEY };
}

const supabaseEnv = loadLocalSupabaseEnv();
Object.assign(process.env, supabaseEnv);

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
      use: { ...devices['Desktop Chrome'] }
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
