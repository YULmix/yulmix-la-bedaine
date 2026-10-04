import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Supabase environment variables not configured!');
}

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

// « Voir comme » (#267, ADR 0025): an admin opens /voir-comme/<member id> in a new tab, and that
// tab runs the whole app in the member's read-only session. The tab is marked in sessionStorage
// (this tab only, gone when it closes), so it stays one after the URL moves on. Its client keeps
// the session in sessionStorage under its own key: it never reads or overwrites the admin's
// session (localStorage, the default key), which the other tabs keep using.
export const VOIR_COMME_PATH = '/voir-comme';
const VOIR_COMME_TAB_KEY = 'bedaine-voir-comme-tab';
const VOIR_COMME_STORAGE_KEY = 'bedaine-voir-comme-auth';

const readTabMark = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location.pathname.startsWith(`${VOIR_COMME_PATH}/`)) {
      window.sessionStorage.setItem(VOIR_COMME_TAB_KEY, '1');
      return true;
    }
    return window.sessionStorage.getItem(VOIR_COMME_TAB_KEY) === '1';
  } catch {
    // No sessionStorage: the tab can't hold an impersonated session, so it is an ordinary one.
    return false;
  }
};

/** This tab is a « Voir comme » tab: `supabase` is the member's read-only session. */
export const isVoirCommeTab = readTabMark();

/** Turns the tab back into an ordinary one (its next load is the admin's own app). */
export const clearVoirCommeTab = (): void => {
  try {
    window.sessionStorage.removeItem(VOIR_COMME_TAB_KEY);
  } catch {
    // Nothing to clear.
  }
};

// Typed with the schema the migrations build (database.types.ts, `npm run db:types`, #201): a
// query against a renamed column or an RPC with the wrong arguments fails `npm run typecheck`.
export const supabase = isVoirCommeTab
  ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.sessionStorage,
      storageKey: VOIR_COMME_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  })
  : createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * The admin's own session, read in a « Voir comme » tab to start the session (the default storage,
 * the one every ordinary tab uses). It never refreshes on its own and never signs anything out:
 * it only lends its access token to the `impersonate` call.
 */
export const createAdminSessionReader = () =>
  createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false }
  });

/** The `impersonate` Edge Function's URL and the headers it needs besides the bearer token. */
export const functionUrl = (name: string): string => `${SUPABASE_URL}/functions/v1/${name}`;
export const functionHeaders = (accessToken: string): Record<string, string> => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
});

declare global {
  interface Window { __supabase?: typeof supabase }
}

// Dev-only escape hatch so Playwright can inject a session for a seeded test user
// (there is no email/password UI — sign-in is OAuth-only) without reverse-engineering
// the storage format. Dead-code-eliminated from production builds by Vite/Rollup.
if (import.meta.env.DEV) {
  window.__supabase = supabase;
}
