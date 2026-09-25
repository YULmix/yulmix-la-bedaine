// Logs a Playwright page in as one of the seeded local test users (supabase/seed.sql)
// without going through the UI, which only offers Google/Facebook OAuth. We get a real
// session via Supabase's password grant, then hand it to the app's own supabase client
// (exposed on window in dev builds, see src/lib/supabase.js) rather than poking at
// localStorage directly, so this doesn't depend on the auth-js storage format.
export const TEST_USERS = {
  member: { email: 'member@test.local', password: 'password123' },
  admin: { email: 'admin@test.local', password: 'password123' }
};

export async function loginAs(page, { email, password }) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  const response = await page.request.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email, password }
    }
  );
  if (!response.ok()) {
    throw new Error(`Password grant for ${email} failed: ${response.status()} ${await response.text()}`);
  }
  const { access_token, refresh_token } = await response.json();

  await page.goto('/');
  await page.waitForFunction(() => !!window.__supabase);
  await page.evaluate(
    async ({ access_token, refresh_token }) => {
      const { error } = await window.__supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
    },
    { access_token, refresh_token }
  );
  await page.reload();
}
