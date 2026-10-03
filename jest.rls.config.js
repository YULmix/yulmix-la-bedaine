// Config for the RLS integration suite (`npm run test:rls`).
// Identical to jest.config.js except it does not exclude src/__tests__/rlsPolicies.test.js —
// that exclusion in the default config is what keeps `npm test` green without a live Supabase.
import { execSync } from 'node:child_process';
import baseConfig from './jest.config.js';

// The suite only ever targets the local Supabase, so take its URL and keys from the running
// instance, as playwright.config.js does. A hand-copied .env.test goes stale whenever the local
// keys change (every JWT then fails with PGRST301), so it is only the fallback for when
// `supabase status` can't answer. Set here, before the workers start, so they inherit it and
// src/__tests__/setup.js's dotenv load of .env.test (which never overrides) leaves it alone.
try {
  const status = execSync('supabase status -o env', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env = Object.fromEntries(
    status.split('\n').map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((m) => [m[1], m[2]])
  );
  if (env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY) {
    process.env.VITE_SUPABASE_URL = env.API_URL;
    process.env.VITE_SUPABASE_ANON_KEY = env.ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
    if (env.DB_URL) process.env.SUPABASE_DB_URL = env.DB_URL;
  }
} catch {
  // No local Supabase running, or no CLI: fall back to .env.test.
}

export default {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/'],
};
