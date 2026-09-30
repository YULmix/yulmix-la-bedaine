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
export const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
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

// A registration saved the way the app saves one (save_registration(), ADR 0018), for userId.
// Returns its id.
async function saveParty(db, eventId, userId, attendees, what) {
  return check(
    await db.rpc('save_registration', { p_event_id: eventId, p_attendees: attendees, p_user_id: userId }),
    what
  ).id;
}

// Makes our event the single active one and gives the seeded member a fresh registration
// (2 attendees, no bed assignments, no admin notes). Returns { eventId, partyId }.
// eventOverrides sets extra event fields for one spec (e.g. an event_start_date that puts the
// registration close date in the past). Every seed resets them, so specs don't inherit each
// other's dates through the shared, reused event.
export async function seedActiveEventWithMemberParty(eventOverrides = {}) {
  const db = await adminClient();
  const venueId = await e2eVenueId(db);

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
    ratio_main_whole: 0.5375,
    max_attendees: 90,
    event_start_date: null,
    x_reg_close_weeks: 1,
    // The column defaults: registration opened long ago, so no intent phase unless a spec asks.
    reg_start_date: '2026-05-01',
    z_intent_months: 2,
    external_links: [],
    venue_id: venueId,
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
  const partyId = await saveParty(db, eventId, MEMBER_ID, E2E_ATTENDEES, 'create e2e party');

  return { eventId, partyId };
}

// The e2e event's venue (#145), found by name or created. Venues are never deleted, so it is
// reused from run to run. Not a frozen copy of it (#148), which has the same name.
const E2E_VENUE_NAME = 'E2E Venue';
async function e2eVenueId(db) {
  const existing = check(
    await db.from('venues').select('id').eq('name', E2E_VENUE_NAME).is('snapshot_of', null).order('created_at').limit(1),
    'find e2e venue'
  );
  if (existing.length) return existing[0].id;
  return check(await db.from('venues').insert({ name: E2E_VENUE_NAME }).select('id').single(), 'create e2e venue').id;
}

async function venueOf(db, eventId) {
  return check(await db.from('events').select('venue_id').eq('id', eventId).single(), 'read e2e event venue').venue_id;
}

// The event's venue as the app reads it, or null (#145).
export async function getEventVenue(eventId) {
  const db = await adminClient();
  return check(
    await db.from('events').select('venue:venues(id, name, address)').eq('id', eventId).single(),
    'read e2e event venue'
  ).venue;
}

// Sets the e2e venue's address (null to clear it).
export async function setVenueAddress(eventId, address) {
  const db = await adminClient();
  check(await db.from('venues').update({ address }).eq('id', await venueOf(db, eventId)), 'set e2e venue address');
}

// Archives (or restores) the e2e event's venue.
export async function setVenueArchived(eventId, archived) {
  const db = await adminClient();
  check(await db.from('venues').update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', await venueOf(db, eventId)), 'archive e2e venue');
}

// A venue found by name or created (never deleted, so reused across runs), archived or not.
export async function ensureVenue(name, { archived = false } = {}) {
  const db = await adminClient();
  const existing = check(
    await db.from('venues').select('id').eq('name', name).is('snapshot_of', null).order('created_at').limit(1),
    'find venue'
  );
  const id = existing.length
    ? existing[0].id
    : check(await db.from('venues').insert({ name }).select('id').single(), 'create venue').id;
  check(await db.from('venues').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id), 'archive venue');
  return id;
}

// The event's settings of its venue's places (#147), by "<location> · <place>".
export async function getOverrides(eventId) {
  const db = await adminClient();
  const rows = check(
    await db.from('event_place_overrides')
      .select('is_excluded, capacity, place:places(label, location:locations(name))')
      .eq('event_id', eventId),
    'read e2e overrides'
  );
  return Object.fromEntries(rows.map(row => [
    `${row.place.location.name} · ${row.place.label}`, { is_excluded: row.is_excluded, capacity: row.capacity }
  ]));
}

// Leaves one of the venue's places out of the event (#147), as the event editor would.
export async function excludePlace(eventId, placeId) {
  const db = await adminClient();
  check(await db.from('event_place_overrides').upsert({ event_id: eventId, place_id: placeId, is_excluded: true, capacity: null }), 'exclude e2e place');
}

// Takes the event off its venue, as if it never had one. The next seed puts it back.
export async function unlinkVenue(eventId) {
  const db = await adminClient();
  check(await db.from('events').update({ venue_id: null }).eq('id', eventId), 'unlink e2e venue');
}

// The event's admin-only budget row (#109), or null.
export async function getBudget(eventId) {
  const db = await adminClient();
  return check(await db.from('event_budgets').select('*').eq('event_id', eventId).maybeSingle(), 'read e2e budget');
}

export async function deleteBudget(eventId) {
  const db = await adminClient();
  check(await db.from('event_budgets').delete().eq('event_id', eventId), 'delete e2e budget');
}

export async function getEvent(eventId) {
  const db = await adminClient();
  return check(
    await db.from('events').select('selling_price_whole_event, ratio_main_whole, theme, max_attendees, reg_start_date, event_start_date, external_links').eq('id', eventId).single(),
    'read e2e event'
  );
}

export async function getParty(partyId) {
  const db = await adminClient();
  return check(
    await db
      .from('user_parties')
      .select('attendees(*, place:attendee_places(place_id, bed_label)), transport, admin_notes, payment_status, status, calculated_amount_owed, locked_selling_price_whole_event, locked_ratio_main_whole')
      .eq('id', partyId)
      .order('position', { referencedTable: 'attendees' })
      .single(),
    'read e2e party'
  );
}

// A registration for someone other than the seeded member (e.g. the admin's own), made now. The
// caller deletes it with deleteParty.
export async function createParty(eventId, userId, attendees) {
  const db = await adminClient();
  check(await db.from('user_parties').delete().eq('event_id', eventId).eq('user_id', userId), 'delete old extra party');
  return saveParty(db, eventId, userId, attendees, 'create extra party');
}

// The seeded member's registration for an event (id and transport), or null.
export async function findMemberParty(eventId) {
  const db = await adminClient();
  return check(
    await db.from('user_parties').select('id, transport').eq('event_id', eventId).eq('user_id', MEMBER_ID).maybeSingle(),
    'find e2e member party'
  );
}

// Sets the transport JSON of a registration, as if the member had saved it earlier.
export async function setPartyTransport(partyId, transport) {
  const db = await adminClient();
  check(await db.from('user_parties').update({ transport }).eq('id', partyId), 'set e2e party transport');
}

export async function deleteParty(partyId) {
  const db = await adminClient();
  check(await db.from('user_parties').delete().eq('id', partyId), 'delete extra party');
}

// The sleeping locations of the event's venue with their places (#113, #145), in display order.
export async function getLocations(eventId) {
  const db = await adminClient();
  return check(
    await db
      .from('locations')
      .select('id, name, sort_order, places(id, label, type, capacity)')
      .eq('venue_id', await venueOf(db, eventId))
      .order('sort_order'),
    'read e2e locations'
  );
}

// Puts the party's attendee at `position` (from 1) in the place (the Logistique dropdown is #114).
export async function assignPlace(placeId, partyId, position) {
  const db = await adminClient();
  const { id: attendeeId } = check(
    await db.from('attendees').select('id').eq('party_id', partyId).eq('position', position).single(),
    'read e2e attendee'
  );
  check(await db.from('place_assignments').insert({ place_id: placeId, attendee_id: attendeeId }), 'assign e2e place');
}

export async function unassignPlace(placeId) {
  const db = await adminClient();
  check(await db.from('place_assignments').delete().eq('place_id', placeId), 'unassign e2e place');
}

// The "<location> · <place>" label of each of the party's assigned attendees, by name.
export async function getPlaceLabels(partyId) {
  const db = await adminClient();
  const rows = check(
    await db.from('attendee_places').select('attendee_name, bed_label').eq('party_id', partyId),
    'read e2e place labels'
  );
  return Object.fromEntries(rows.map(row => [row.attendee_name, row.bed_label]));
}

// The locations of the event's venue, and so their places. Whoever still holds one is unassigned
// first: an occupied place can't be deleted.
export async function deleteLocations(eventId) {
  const db = await adminClient();
  const placeIds = (await getLocations(eventId)).flatMap(location => location.places.map(place => place.id));
  check(await db.from('place_assignments').delete().in('place_id', placeIds), 'unassign e2e places');
  check(await db.from('locations').delete().eq('venue_id', await venueOf(db, eventId)), 'delete e2e locations');
}

// Replaces the event's places with a small house (#114): two single beds in "Chambre 1" and a
// sofa for two in "Salon". Returns the place ids by "<location> · <place>".
export const E2E_PLACES = [
  { name: 'Chambre 1', places: [{ label: 'Lit A', type: 'bed', capacity: 1 }, { label: 'Lit B', type: 'bed', capacity: 1 }] },
  { name: 'Salon', places: [{ label: 'Sofa', type: 'sofa', capacity: 2 }] }
];
export async function seedPlaces(eventId) {
  await deleteLocations(eventId);
  const db = await adminClient();
  const venueId = await venueOf(db, eventId);
  const ids = {};
  for (const [order, { name, places }] of E2E_PLACES.entries()) {
    const location = check(
      await db.from('locations').insert({ venue_id: venueId, name, sort_order: order }).select('id').single(),
      'create e2e location'
    );
    const rows = check(
      await db.from('places')
        .insert(places.map((place, index) => ({ ...place, location_id: location.id, sort_order: index })))
        .select('id, label'),
      'create e2e places'
    );
    rows.forEach(row => { ids[`${name} · ${row.label}`] = row.id; });
  }
  return ids;
}

export async function teardownActiveEventWithMemberParty({ eventId, partyId }) {
  const db = await adminClient();
  if (partyId) check(await db.from('user_parties').delete().eq('id', partyId), 'delete e2e party');
  // Back to a draft, not archived: archiving freezes the event's venue layout into a copy (#148),
  // one more per test for nothing.
  if (eventId) {
    check(
      await db.from('events').update({ is_active: false, status: 'DRAFT' }).eq('id', eventId),
      'deactivate e2e event'
    );
  }
}

// Renames one of the venue's places (#148 checks an archived edition doesn't follow).
export async function renamePlace(placeId, label) {
  const db = await adminClient();
  check(await db.from('places').update({ label }).eq('id', placeId), 'rename e2e place');
}

// A place's own capacity, as editing the venue in Sites would set it (no event override).
export async function setPlaceCapacity(placeId, capacity) {
  const db = await adminClient();
  check(await db.from('places').update({ capacity }).eq('id', placeId), 'resize e2e place');
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

export async function addParty(userId, eventId, status = 'registered') {
  const db = await adminClient();
  const partyId = await saveParty(db, eventId, userId, E2E_ATTENDEES, 'create throwaway party');
  if (status !== 'registered') {
    check(await db.from('user_parties').update({ status }).eq('id', partyId), 'set throwaway party status');
  }
  return partyId;
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
