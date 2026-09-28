// Test data for specs that need an active event with a registration. The seed
// (supabase/seed.sql) only creates the two users, so specs create what they need here,
// signed in as the seeded admin: the "Admin full access" RLS policies let an admin manage
// events and any member's registration. (The service role key is not an option locally:
// the baseline migration grants service_role nothing on the public tables.)
//
// Events can't be deleted (prevent_event_delete trigger), so the event is find-or-create by
// theme and archived again on teardown; the registration is deleted on teardown and
// recreated on setup, so re-runs start from the same state.
import { createClient } from '@supabase/supabase-js';
import { TEST_USERS } from './auth.js';

export const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
export const E2E_EVENT_THEME = 'E2E Admin Tabs Event';
export const E2E_ATTENDEES = [
  { name: 'Alice E2E', type: 'Adult', participation: 'Whole', is_new_member: false },
  { name: 'Bob E2E', type: 'Adult', participation: 'Main', is_new_member: false }
];

async function adminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing; is local Supabase running?');
  }
  // This writes test rows: refuse to point it at anything but a local stack.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`Refusing to seed e2e data against non-local Supabase URL ${url}`);
  }
  const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword(TEST_USERS.admin);
  if (error) throw new Error(`admin sign-in for e2e seeding failed: ${error.message}`);
  return db;
}

function check({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// Makes our event the single active one and gives the seeded member a fresh registration
// (2 attendees, no bed assignments, no admin notes). Returns { eventId, partyId }.
// eventOverrides sets extra event fields for one spec (e.g. an event_start_date that puts the
// registration close date in the past). Every seed resets them, so specs don't inherit each
// other's dates through the shared, reused event.
export async function seedActiveEventWithMemberParty(eventOverrides = {}) {
  const db = await adminClient();

  const existing = check(
    await db.from('events').select('id').eq('theme', E2E_EVENT_THEME).limit(1),
    'find e2e event'
  );

  // only_one_active_event: deactivate anything else first (local DB only, see guard above).
  check(
    await db.from('events').update({ is_active: false }).eq('is_active', true).neq('theme', E2E_EVENT_THEME),
    'deactivate other events'
  );

  const eventFields = {
    theme: E2E_EVENT_THEME,
    description: 'Created by e2e/support/testData.js',
    status: 'ACTIVE',
    is_active: true,
    is_reg_open: true,
    selling_price_whole_event: 200,
    max_attendees: 90,
    event_start_date: null,
    x_reg_close_weeks: 1,
    ...eventOverrides
  };
  let eventId;
  if (existing.length > 0) {
    eventId = existing[0].id;
    check(await db.from('events').update(eventFields).eq('id', eventId), 'activate e2e event');
  } else {
    eventId = check(await db.from('events').insert(eventFields).select('id').single(), 'create e2e event').id;
  }

  check(
    await db.from('user_parties').delete().eq('event_id', eventId).eq('user_id', MEMBER_ID),
    'delete old e2e party'
  );
  const party = check(
    await db
      .from('user_parties')
      .insert({
        user_id: MEMBER_ID,
        event_id: eventId,
        attendees: E2E_ATTENDEES,
        status: 'registered',
        payment_status: 'unpaid'
      })
      .select('id')
      .single(),
    'create e2e party'
  );

  return { eventId, partyId: party.id };
}

export async function getParty(partyId) {
  const db = await adminClient();
  return check(
    await db.from('user_parties').select('attendees, admin_notes, payment_status, status').eq('id', partyId).single(),
    'read e2e party'
  );
}

export async function teardownActiveEventWithMemberParty({ eventId, partyId }) {
  const db = await adminClient();
  if (partyId) check(await db.from('user_parties').delete().eq('id', partyId), 'delete e2e party');
  if (eventId) {
    check(
      await db.from('events').update({ is_active: false, status: 'ARCHIVED' }).eq('id', eventId),
      'archive e2e event'
    );
  }
}

// Throwaway members, for specs that do something a shared test user can't undo (deleting an
// account, #36). Created with the auth admin API, which needs the service role key: that works
// locally even though the service role has no grants on the public tables.
function authAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY missing; see playwright.config.js');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`Refusing to create e2e users against non-local Supabase URL ${url}`);
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

export async function createThrowawayMember(label) {
  const email = `e2e-${label}-${Date.now()}@test.local`;
  const password = 'password123';
  const fullName = `E2E ${label} ${Date.now()}`;
  const { data, error } = await authAdmin().createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName }
  });
  if (error) throw new Error(`create throwaway member: ${error.message}`);
  return { id: data.user.id, email, password, fullName };
}

// Test cleanup only. The registrations go first, deleted by the admin: that also removes their
// registration_edits rows, whose edited_by references auth.users without a cascade, and an admin is
// exempt from the close-date lock that would refuse the cascade from auth.users.
export async function deleteThrowawayMember(userId) {
  if (!userId) return;
  const db = await adminClient();
  check(await db.from('user_parties').delete().eq('user_id', userId), 'delete throwaway parties');
  const { error } = await authAdmin().deleteUser(userId);
  if (error) throw new Error(`delete throwaway member: ${error.message}`);
}

export async function addParty(userId, eventId) {
  const db = await adminClient();
  return check(
    await db.from('user_parties')
      .insert({ user_id: userId, event_id: eventId, attendees: E2E_ATTENDEES, status: 'registered' })
      .select('id')
      .single(),
    'create throwaway party'
  ).id;
}

export async function getProfile(userId) {
  const db = await adminClient();
  return check(await db.from('profiles').select('deleted_at').eq('id', userId).single(), 'read e2e profile');
}

// email_log is written only by the send-party-email Edge Function, with the service role (#12).
// Specs stand in for it the same way (#93). Upserts on (party_id, template), so a row the local
// function may have written for the seeded party is replaced, not duplicated.
export async function seedEmailLog(partyId, rows) {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY missing; see playwright.config.js');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`Refusing to seed email_log against non-local Supabase URL ${url}`);
  }
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  check(
    await db.from('email_log').upsert(rows.map(row => ({ party_id: partyId, ...row })), { onConflict: 'party_id,template' }),
    'seed email_log'
  );
}
