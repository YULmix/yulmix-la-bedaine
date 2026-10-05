// Logs a Playwright page in as one of the seeded local test users (supabase/seed.sql)
// without going through the UI, which only offers Google OAuth. We get a real
// session via Supabase's password grant, then hand it to the app's own supabase client
// (exposed on window in dev builds, see src/lib/supabase.ts) rather than poking at
// localStorage directly, so this doesn't depend on the auth-js storage format.
export const TEST_USERS = {
  member: { email: 'member@test.local', password: 'password123' },
  admin: { email: 'admin@test.local', password: 'password123' },
  // Edition roles (#217): e2e/support/testData.js grants them on the e2e event.
  committee: { email: 'committee@test.local', password: 'password123' },
  organiser: { email: 'organiser@test.local', password: 'password123' }
};

// Password grants are cached per Node process (a Playwright worker), so a user is granted a
// session once, not once per test: the grant answers with a session valid for an hour, and a worker
// lives a few minutes. The session is handed to the page before the app loads, in the key the
// Supabase client reads on start-up (auth-js's default storage key), so the app boots already
// signed in: one page load instead of load + setSession + reload.
const sessions = new Map(); // email -> Promise<session>
const MAX_AGE_MS = 20 * 60 * 1000;

async function sessionFor(request, { email, password }) {
  const cached = sessions.get(email);
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.session;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const response = await request.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email, password }
    }
  );
  if (!response.ok()) {
    sessions.delete(email);
    throw new Error(`Password grant for ${email} failed: ${response.status()} ${await response.text()}`);
  }
  const session = await response.json();
  sessions.set(email, { at: Date.now(), session });
  return session;
}

let loginCount = 0;
export async function loginAs(page, { email, password }) {
  const session = await sessionFor(page.request, { email, password });
  const storageKey = `sb-${new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  // Written once per loginAs call (a marker in sessionStorage), so a spec that signs out and
  // reloads stays signed out; a later loginAs on the same page, as another user, wins.
  await page.addInitScript(({ storageKey, session, marker }) => {
    if (sessionStorage.getItem(marker)) return;
    sessionStorage.setItem(marker, '1');
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, { storageKey, session, marker: `e2e-login-${++loginCount}` });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__supabase);
}
