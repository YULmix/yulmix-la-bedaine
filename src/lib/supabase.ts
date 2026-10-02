import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Supabase environment variables not configured!');
}

// Typed with the schema the migrations build (database.types.ts, `npm run db:types`, #201): a
// query against a renamed column or an RPC with the wrong arguments fails `npm run typecheck`.
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

declare global {
  interface Window { __supabase?: typeof supabase }
}

// Dev-only escape hatch so Playwright can inject a session for a seeded test user
// (there is no email/password UI — sign-in is OAuth-only) without reverse-engineering
// the storage format. Dead-code-eliminated from production builds by Vite/Rollup.
if (import.meta.env.DEV) {
  window.__supabase = supabase;
}
