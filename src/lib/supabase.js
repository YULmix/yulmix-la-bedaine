import { createClient } from '@supabase/supabase-js';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Supabase environment variables not configured!');
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Dev-only escape hatch so Playwright can inject a session for a seeded test user
// (there is no email/password UI — sign-in is OAuth-only) without reverse-engineering
// the storage format. Dead-code-eliminated from production builds by Vite/Rollup.
if (import.meta.env.DEV) {
  window.__supabase = supabase;
}