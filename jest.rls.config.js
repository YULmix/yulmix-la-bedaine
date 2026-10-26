// Config for the RLS integration suite (`npm run test:rls`).
// Identical to jest.config.js except it does not exclude src/__tests__/rlsPolicies.test.js —
// that exclusion in the default config is what keeps `npm test` green without a live Supabase.
import baseConfig from './jest.config.js';
import { readStatusEnv, resolveStack } from './scripts/lib/stack.js';

// The suite only ever targets the local Supabase, so take its URL and keys from the running
// instance, as playwright.config.js does. A hand-copied .env.test goes stale whenever the local
// keys change (every JWT then fails with PGRST301), so it is only the fallback, in the main
// checkout, for when `supabase status` can't answer. A worktree uses its own stack
// (`npm run stack:up`) and errors rather than fall back onto another one (#312). Set here, before
// the workers start, so they inherit it and src/__tests__/setup.js's dotenv load of .env.test
// (which never overrides) leaves it alone.
const stack = resolveStack(); // throws in a worktree with no stack
try {
  const env = readStatusEnv(stack);
  if (env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY) {
    process.env.VITE_SUPABASE_URL = env.API_URL;
    process.env.VITE_SUPABASE_ANON_KEY = env.ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
    if (env.DB_URL) process.env.SUPABASE_DB_URL = env.DB_URL;
  }
} catch (error) {
  if (stack) throw error;
  // Main checkout, no local Supabase running, or no CLI: fall back to .env.test, and to the
  // default stack's database port.
  process.env.SUPABASE_DB_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

export default {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/'],
};
