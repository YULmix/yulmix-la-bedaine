/**
 * @jest-environment node
 *
 * RLS Policy Tests for La Bédaine Supabase Security
 * Tests Row Level Security policies for profiles, events, user_parties, and app_feedback tables.
 *
 * This is an integration suite, not a unit suite: it needs a running local Supabase instance and
 * a real SUPABASE_SERVICE_ROLE_KEY, and is excluded from the default `npm test` run (see
 * jest.config.js). The @jest-environment pragma above gives it Node's global `fetch`, which the
 * default jsdom environment does not provide — without it, every request fails with
 * "ReferenceError: fetch is not defined" regardless of whether Supabase is reachable.
 *
 * Setup:
 * 1. Start local Supabase: `supabase start` (applies supabase/migrations/; `supabase db reset` rebuilds)
 * 2. Do NOT run `supabase db push` for this: on a linked checkout it targets production.
 * 3. Set environment variables in .env.test
 * 4. Run tests: `npm run test:rls`
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in .env.test for RLS testing');
}

// Admin client with service role key (bypasses RLS)
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'public' }
});

// UUIDs for test data
const TEST_UUIDS = {
  USER_ID: '11111111-1111-1111-1111-111111111111',
  ADMIN_ID: '22222222-2222-2222-2222-222222222222',
  DRAFT_EVENT_ID: '33333333-3333-3333-3333-333333333333',
  ACTIVE_EVENT_ID: '44444444-4444-4444-4444-444444444444',
  ARCHIVED_EVENT_ID: '55555555-5555-5555-5555-555555555555',
  USER_REGISTRATION_ID: '66666666-6666-6666-6666-666666666666',
  ADMIN_REGISTRATION_ID: '77777777-7777-7777-7777-777777777777',
  USER_FEEDBACK_ID: '88888888-8888-8888-8888-888888888888',
  ADMIN_FEEDBACK_ID: '99999999-9999-9999-9999-999999999999'
};

describe('🔐 RLS Policy Enforcement', () => {
  jest.setTimeout(30000); // 30 seconds for Supabase operations
  beforeAll(async () => {
    // Seed test data using admin client (bypasses RLS)
    try {
      await adminClient.rpc('seed_test_data');
    } catch (error) {
      // If seed_test_data function doesn't exist, seed manually
      console.log('seed_test_data function not found, seeding manually...');
      await seedTestDataManually();
    }
  });

  afterAll(async () => {
    // Clean up test data
    await adminClient.from('user_parties').delete().in('id', [
      TEST_UUIDS.USER_REGISTRATION_ID, 
      TEST_UUIDS.ADMIN_REGISTRATION_ID
    ]);
    await adminClient.from('app_feedback').delete().in('id', [
      TEST_UUIDS.USER_FEEDBACK_ID, 
      TEST_UUIDS.ADMIN_FEEDBACK_ID
    ]);
    await adminClient.from('events').delete().in('id', [
      TEST_UUIDS.DRAFT_EVENT_ID,
      TEST_UUIDS.ACTIVE_EVENT_ID,
      TEST_UUIDS.ARCHIVED_EVENT_ID
    ]);
    await adminClient.from('profiles').delete().in('id', [
      TEST_UUIDS.USER_ID,
      TEST_UUIDS.ADMIN_ID
    ]);
  });

  test('EVENTS: Public can read ACTIVE and ARCHIVED events', async () => {
    const publicClient = createClient(SUPABASE_URL, ANON_KEY);
    
    const { data: activeEvents, error: activeError } = await publicClient
      .from('events')
      .select('id, status')
      .eq('status', 'ACTIVE');
    
    expect(activeError).toBeNull();
    expect(activeEvents.length).toBeGreaterThan(0);
  });

  test('EVENTS: Regular user cannot see DRAFT events', async () => {
    const publicClient = createClient(SUPABASE_URL, ANON_KEY);
    
    const { data: draftEvents, error } = await publicClient
      .from('events')
      .select('id, status')
      .eq('status', 'DRAFT');
    
    expect(error).toBeNull();
    // Should see 0 draft events (RLS hides them)
    expect(draftEvents.length).toBe(0);
  });

  test('EVENTS: Admin can see DRAFT events', async () => {
    const { data: draftEvents, error } = await adminClient
      .from('events')
      .select('id, status')
      .eq('status', 'DRAFT');

    expect(error).toBeNull();
    expect(draftEvents.length).toBeGreaterThan(0);
  });
});

// Regression tests for #31: enforce_calculated_amount_owed() (the trigger added for #30) must
// grandfather a party that has already paid — further edits (or a price change) must not
// silently overwrite the amount it actually paid.
//
// Uses signed-in `authenticated` clients (member@test.local / admin@test.local from
// supabase/seed.sql), not `adminClient` (the service_role key): the local baseline schema never
// GRANTs service_role anything on events/user_parties (see the "EVENTS: Admin can see DRAFT
// events" failure above, which is that same pre-existing gap, unrelated to #31), while
// `authenticated` has full grants and is what the app actually uses.
const ONE_ADULT_WHOLE = [{ type: 'Adult', participation: 'Whole', is_new_member: false }];
const TWO_ADULTS_WHOLE = [
  { type: 'Adult', participation: 'Whole', is_new_member: false },
  { type: 'Adult', participation: 'Whole', is_new_member: false }
];

const signIn = async (email) => {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return client;
};

describe('💰 calculated_amount_owed grandfathering (#31)', () => {
  jest.setTimeout(30000);

  const GF_EVENT_ID = 'a0000000-a000-a000-a000-a00000000031';
  const UNPAID_PARTY_ID = 'a0000000-a000-a000-a000-a00000000032';
  const PAID_PARTY_ID = 'a0000000-a000-a000-a000-a00000000033';

  let memberClient;
  let adminAuthClient;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    // Events can't be deleted (trg_prevent_event_deletion enforces archiving instead), so reuse
    // the same row across tests via upsert and just reset its price before each one.
    await adminAuthClient.from('user_parties').delete().in('id', [UNPAID_PARTY_ID, PAID_PARTY_ID]);
    const { error } = await adminAuthClient.from('events').upsert({
      id: GF_EVENT_ID,
      theme: 'Grandfathering Test Event',
      status: 'ACTIVE',
      selling_price_whole_event: 100
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', [UNPAID_PARTY_ID, PAID_PARTY_ID]);
  });

  test('an unpaid party keeps being recomputed on every save', async () => {
    const { error: insertError } = await memberClient.from('user_parties').insert({
      id: UNPAID_PARTY_ID,
      user_id: '00000000-0000-0000-0000-000000000001',
      event_id: GF_EVENT_ID,
      attendees: ONE_ADULT_WHOLE,
      payment_status: 'unpaid'
    });
    expect(insertError).toBeNull();

    // Selling price is 100 for a whole-event adult (2.0 pts = the full price), regardless of
    // the estimate a client might have sent.
    const { data: afterInsert } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(afterInsert.calculated_amount_owed)).toBe(100);

    // Raising the price and editing the party recomputes fresh — unpaid parties are not
    // grandfathered.
    await adminAuthClient.from('events').update({ selling_price_whole_event: 500 }).eq('id', GF_EVENT_ID);
    await memberClient.from('user_parties').update({ attendees: TWO_ADULTS_WHOLE }).eq('id', UNPAID_PARTY_ID);

    const { data: afterUpdate } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(afterUpdate.calculated_amount_owed)).toBe(1000);
  });

  test('a paid party keeps its stored amount across a price change and further edits', async () => {
    const { error: insertError } = await memberClient.from('user_parties').insert({
      id: PAID_PARTY_ID,
      user_id: '00000000-0000-0000-0000-000000000001',
      event_id: GF_EVENT_ID,
      attendees: ONE_ADULT_WHOLE,
      payment_status: 'unpaid'
    });
    expect(insertError).toBeNull();
    // Mark as paid at the current (100) price — an admin action, and the row's own persisted
    // state, the only thing the trigger is allowed to trust.
    await adminAuthClient.from('user_parties').update({ payment_status: 'paid' }).eq('id', PAID_PARTY_ID);

    const { data: paidAt } = await adminAuthClient
      .from('user_parties')
      .select('calculated_amount_owed, payment_status')
      .eq('id', PAID_PARTY_ID)
      .single();
    expect(Number(paidAt.calculated_amount_owed)).toBe(100);
    expect(paidAt.payment_status).toBe('paid');

    // Raise the price and have the member edit their own party's attendees, even trying to
    // smuggle a different amount and a "still unpaid" flag through the client-writable columns
    // (exactly what a devtools/REST client attack would send) — the trigger must ignore all of
    // that and keep the amount frozen from the row's own prior payment_status.
    await adminAuthClient.from('events').update({ selling_price_whole_event: 500 }).eq('id', GF_EVENT_ID);
    await memberClient
      .from('user_parties')
      .update({ attendees: TWO_ADULTS_WHOLE, calculated_amount_owed: 1, payment_status: 'unpaid' })
      .eq('id', PAID_PARTY_ID);

    const { data: afterEdit } = await adminAuthClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', PAID_PARTY_ID)
      .single();
    // Frozen at the amount owed when it was still marked paid, not recomputed (1000) and not
    // the spoofed value (1) — the row's payment_status at the time of THIS update was 'paid'.
    expect(Number(afterEdit.calculated_amount_owed)).toBe(100);
  });
});

// Regression tests for #32: changing events.selling_price_whole_event must retroactively reprice
// every existing *unpaid* registration for that event, without waiting for the member to resave
// their own row — and must leave paid registrations untouched (the #31 grandfathering still
// applies).
describe('💵 reprice unpaid registrations on price change (#32)', () => {
  jest.setTimeout(30000);

  const REPRICE_EVENT_ID = 'a0000000-a000-a000-a000-a00000000041';
  const UNPAID_PARTY_ID = 'a0000000-a000-a000-a000-a00000000042';
  const PAID_PARTY_ID = 'a0000000-a000-a000-a000-a00000000043';

  let memberClient;
  let adminAuthClient;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', [UNPAID_PARTY_ID, PAID_PARTY_ID]);
    const { error } = await adminAuthClient.from('events').upsert({
      id: REPRICE_EVENT_ID,
      theme: 'Reprice Test Event',
      status: 'ACTIVE',
      selling_price_whole_event: 100
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', [UNPAID_PARTY_ID, PAID_PARTY_ID]);
  });

  test('changing the price alone reprices unpaid registrations, without any member edit', async () => {
    await memberClient.from('user_parties').insert({
      id: UNPAID_PARTY_ID,
      user_id: '00000000-0000-0000-0000-000000000001',
      event_id: REPRICE_EVENT_ID,
      attendees: ONE_ADULT_WHOLE,
      payment_status: 'unpaid'
    });

    const { data: before } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(before.calculated_amount_owed)).toBe(100);

    // Only the event's price changes here — the member never touches their own row.
    const { error } = await adminAuthClient
      .from('events')
      .update({ selling_price_whole_event: 500 })
      .eq('id', REPRICE_EVENT_ID);
    expect(error).toBeNull();

    const { data: after } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(after.calculated_amount_owed)).toBe(500);
  });

  test('a paid registration is not repriced by a price change', async () => {
    await memberClient.from('user_parties').insert({
      id: PAID_PARTY_ID,
      user_id: '00000000-0000-0000-0000-000000000001',
      event_id: REPRICE_EVENT_ID,
      attendees: ONE_ADULT_WHOLE,
      payment_status: 'unpaid'
    });
    await adminAuthClient.from('user_parties').update({ payment_status: 'paid' }).eq('id', PAID_PARTY_ID);

    await adminAuthClient
      .from('events')
      .update({ selling_price_whole_event: 500 })
      .eq('id', REPRICE_EVENT_ID);

    const { data: afterPriceChange } = await adminAuthClient
      .from('user_parties')
      .select('calculated_amount_owed, payment_status')
      .eq('id', PAID_PARTY_ID)
      .single();
    expect(afterPriceChange.payment_status).toBe('paid');
    expect(Number(afterPriceChange.calculated_amount_owed)).toBe(100);
  });
});

describe('✉️ email_log is admin-only (#12)', () => {
  jest.setTimeout(30000);

  const EMAIL_EVENT_ID = 'a0000000-a000-a000-a000-a00000000012';
  const EMAIL_PARTY_ID = 'a0000000-a000-a000-a000-a00000000013';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';

  let memberClient;
  let adminAuthClient;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    await adminAuthClient.from('user_parties').delete().eq('id', EMAIL_PARTY_ID);
    const { error: eventError } = await adminAuthClient.from('events').upsert({ id: EMAIL_EVENT_ID, theme: 'Email Log Test', status: 'ACTIVE' });
    if (eventError) throw eventError;
    const { error: partyError } = await adminAuthClient.from('user_parties').insert({ id: EMAIL_PARTY_ID, user_id: MEMBER_ID, event_id: EMAIL_EVENT_ID });
    if (partyError) throw partyError;
    // The service role writes the log, as the send-party-email Edge Function does.
    const { error: logError } = await adminClient.from('email_log')
      .upsert({ party_id: EMAIL_PARTY_ID, template: 'registration', status: 'dry_run' }, { onConflict: 'party_id,template' });
    if (logError) throw logError;
  });

  afterAll(async () => {
    // Deleting the party cascades to its email_log rows.
    await adminAuthClient.from('user_parties').delete().eq('id', EMAIL_PARTY_ID);
  });

  test('a member cannot read the log, even for their own party', async () => {
    const { data, error } = await memberClient.from('email_log').select('id').eq('party_id', EMAIL_PARTY_ID);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('an admin can read the log', async () => {
    const { data, error } = await adminAuthClient.from('email_log').select('template').eq('party_id', EMAIL_PARTY_ID);
    expect(error).toBeNull();
    expect(data).toEqual([{ template: 'registration' }]);
  });

  test('neither can write to it', async () => {
    for (const client of [memberClient, adminAuthClient]) {
      const { error } = await client.from('email_log').insert({ party_id: EMAIL_PARTY_ID, template: 'payment' });
      expect(error).not.toBeNull();
    }
  });
});

describe('🚪 member self-cancellation (#35)', () => {
  jest.setTimeout(30000);

  const CANCEL_EVENT_ID = 'a0000000-a000-a000-a000-a00000000035';
  const CANCEL_PARTY_ID = 'a0000000-a000-a000-a000-a00000000036';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

  let memberClient;
  let adminAuthClient;

  const seed = async (eventStartDate) => {
    await adminAuthClient.from('user_parties').delete().eq('id', CANCEL_PARTY_ID);
    const { error: eventError } = await adminAuthClient.from('events').upsert({
      id: CANCEL_EVENT_ID, theme: 'Cancellation Test', status: 'ACTIVE', event_start_date: eventStartDate, x_reg_close_weeks: 1
    });
    if (eventError) throw eventError;
    const { error: partyError } = await adminAuthClient.from('user_parties').insert({
      id: CANCEL_PARTY_ID, user_id: MEMBER_ID, event_id: CANCEL_EVENT_ID, status: 'registered'
    });
    if (partyError) throw partyError;
  };
  const statusOf = async () => (await adminAuthClient.from('user_parties').select('status').eq('id', CANCEL_PARTY_ID).single()).data?.status;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', CANCEL_PARTY_ID);
  });

  test('a member can no longer hard-delete their registration', async () => {
    await seed(isoDay(60));
    await memberClient.from('user_parties').delete().eq('id', CANCEL_PARTY_ID);
    expect(await statusOf()).toBe('registered');
  });

  test('before the close date, a member cancels: the row stays, as cancelled', async () => {
    await seed(isoDay(60));
    const { error } = await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(error).toBeNull();
    expect(await statusOf()).toBe('cancelled');
  });

  test('a cancelled registration can be taken up again by the member', async () => {
    await seed(isoDay(60));
    await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    const { error } = await memberClient.from('user_parties')
      .upsert({ user_id: MEMBER_ID, event_id: CANCEL_EVENT_ID, status: 'registered' }, { onConflict: 'user_id,event_id' });
    expect(error).toBeNull();
    expect(await statusOf()).toBe('registered');
  });

  test('after the close date, a member cannot cancel but an admin can', async () => {
    await seed(isoDay(3));
    const { error: memberError } = await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(memberError?.message).toMatch(/verrouillées/);
    expect(await statusOf()).toBe('registered');

    const { error: adminError } = await adminAuthClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(adminError).toBeNull();
    expect(await statusOf()).toBe('cancelled');
  });
});

// #94: payment_status, admin_notes and attendees[].assigned_bed are admin-only. A member's value is
// ignored (not refused), since the member form sends them back on every save; beds carry over by
// attendee name.
describe('🛡️ admin-only registration fields (#94)', () => {
  jest.setTimeout(30000);

  const ADMIN_FIELDS_EVENT_ID = 'a0000000-a000-a000-a000-a00000000094';
  const ADMIN_FIELDS_PARTY_ID = 'a0000000-a000-a000-a000-a00000000095';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const attendee = (name, assignedBed = '') => ({
    name, type: 'Adult', participation: 'Whole', is_new_member: false, assigned_bed: assignedBed
  });

  let memberClient;
  let adminAuthClient;

  const partyRow = async () => (await adminAuthClient.from('user_parties')
    .select('payment_status, admin_notes, attendees, calculated_amount_owed, status')
    .eq('id', ADMIN_FIELDS_PARTY_ID).single()).data;
  const bedsOf = (row) => row.attendees.map(a => [a.name, a.assigned_bed]);

  // What the member form does: an upsert on (user_id, event_id) sending everything back.
  const memberFormSave = (fields) => memberClient.from('user_parties')
    .upsert({ user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, status: 'registered', ...fields }, { onConflict: 'user_id,event_id' });

  // A party the admin has marked paid, annotated and given beds.
  const seedAdminManagedParty = async () => {
    const { error: insertError } = await adminAuthClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID,
      attendees: [attendee('Ann', 'B1'), attendee('Bob', 'B2')],
      payment_status: 'paid', admin_notes: 'secret'
    });
    if (insertError) throw insertError;
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert({
      id: ADMIN_FIELDS_EVENT_ID, theme: 'Admin Fields Test', status: 'ACTIVE', selling_price_whole_event: 100
    });
    if (error) throw error;
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ADMIN_FIELDS_EVENT_ID);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ADMIN_FIELDS_EVENT_ID);
  });

  test('a member inserting a party cannot set payment, notes or beds', async () => {
    const { error } = await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID,
      attendees: [attendee('Ann', 'B1')], payment_status: 'paid', admin_notes: 'hax'
    });
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('a member updating their party cannot mark it paid, write notes or assign beds', async () => {
    await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, attendees: [attendee('Ann')]
    });
    const { error } = await memberClient.from('user_parties')
      .update({ payment_status: 'paid', admin_notes: 'hax', attendees: [attendee('Ann', 'B1')] })
      .eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('an admin can set payment, notes and beds', async () => {
    await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, attendees: [attendee('Ann')]
    });
    const { error } = await adminAuthClient.from('user_parties')
      .update({ payment_status: 'paid', admin_notes: 'secret', attendees: [attendee('Ann', 'B1')] })
      .eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
    expect(bedsOf(row)).toEqual([['Ann', 'B1']]);
  });

  test("a member's form save keeps a paid party paid, its notes and its grandfathered amount (#31)", async () => {
    await seedAdminManagedParty();
    await adminAuthClient.from('events').update({ selling_price_whole_event: 500 }).eq('id', ADMIN_FIELDS_EVENT_ID);
    const { error } = await memberFormSave({
      attendees: [attendee('Ann', 'B1'), attendee('Bob', 'B2')], payment_status: 'unpaid', admin_notes: null
    });
    await adminAuthClient.from('events').update({ selling_price_whole_event: 100 }).eq('id', ADMIN_FIELDS_EVENT_ID);
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
    expect(Number(row.calculated_amount_owed)).toBe(200);
    expect(bedsOf(row)).toEqual([['Ann', 'B1'], ['Bob', 'B2']]);
  });

  test('beds follow attendee names: removing the first attendee does not shift beds', async () => {
    await seedAdminManagedParty();
    // The form sends beds back by position, so after removing Ann, Bob arrives with Ann's bed.
    const { error } = await memberFormSave({ attendees: [attendee('Bob', 'B1'), attendee('Cat', 'B9')] });
    expect(error).toBeNull();
    expect(bedsOf(await partyRow())).toEqual([['Bob', 'B2'], ['Cat', '']]);
  });

  test('renaming an attendee clears only that attendee\'s bed', async () => {
    await seedAdminManagedParty();
    const { error } = await memberFormSave({ attendees: [attendee('Ann', 'B1'), attendee('Rob', 'B2')] });
    expect(error).toBeNull();
    expect(bedsOf(await partyRow())).toEqual([['Ann', 'B1'], ['Rob', '']]);
  });

  test('re-registering over their own cancelled paid party keeps it paid (#35)', async () => {
    await seedAdminManagedParty();
    await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', ADMIN_FIELDS_PARTY_ID);
    const { error } = await memberFormSave({ attendees: [attendee('Ann'), attendee('Bob')], payment_status: 'unpaid' });
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.status).toBe('registered');
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
  });
});

// #36: "Supprimer mon compte" is a soft delete through delete_my_account(). Each test uses its
// own throwaway user (created with the service role's auth admin API), since a deleted account
// can't be restored through the API and the seeded member is shared by every other suite.
describe('🗑️ soft account deletion (#36)', () => {
  jest.setTimeout(30000);

  const UPCOMING_EVENT_ID = 'a0000000-a000-a000-a000-a00000000361';
  const LOCKED_EVENT_ID = 'a0000000-a000-a000-a000-a00000000362';
  const PAST_EVENT_ID = 'a0000000-a000-a000-a000-a00000000363';
  const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const ONE_ATTENDEE = [{ name: 'Del', type: 'Adult', participation: 'Whole', is_new_member: false }];

  let adminAuthClient;
  const createdUserIds = [];

  // A fresh member, signed in. Returns { id, client }.
  const newMember = async (label) => {
    const email = `del36-${label}-${Date.now()}@test.local`;
    const { data, error } = await adminClient.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
    if (error) throw error;
    createdUserIds.push(data.user.id);
    return { id: data.user.id, client: await signIn(email) };
  };
  const register = async (userId, eventId) => {
    const { data, error } = await adminAuthClient.from('user_parties')
      .insert({ user_id: userId, event_id: eventId, attendees: ONE_ATTENDEE, status: 'registered' })
      .select('id').single();
    if (error) throw error;
    return data.id;
  };
  const partiesOf = async (userId) => (await adminAuthClient.from('user_parties')
    .select('event_id, status').eq('user_id', userId).order('event_id')).data;
  const deletedAtOf = async (userId) => (await adminAuthClient.from('profiles')
    .select('deleted_at').eq('id', userId).single()).data?.deleted_at;

  beforeAll(async () => {
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert([
      { id: UPCOMING_EVENT_ID, theme: 'Deletion Upcoming', status: 'ACTIVE', event_start_date: isoDay(60), x_reg_close_weeks: 1 },
      { id: LOCKED_EVENT_ID, theme: 'Deletion Locked', status: 'ACTIVE', event_start_date: isoDay(3), x_reg_close_weeks: 1 },
      { id: PAST_EVENT_ID, theme: 'Deletion Past', status: 'ARCHIVED', event_start_date: isoDay(-300), x_reg_close_weeks: 1 }
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    // Test cleanup only. The registrations go first, deleted by the admin: that also removes their
    // registration_edits rows, whose edited_by references auth.users without a cascade, and an
    // admin is exempt from the close-date lock that would refuse the cascade from auth.users.
    for (const id of createdUserIds) {
      const { error: partiesError } = await adminAuthClient.from('user_parties').delete().eq('user_id', id);
      if (partiesError) throw partiesError;
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) throw error;
    }
  });

  test('deleting cancels registrations to come, keeps past ones, and deletes no row', async () => {
    const member = await newMember('ok');
    await register(member.id, UPCOMING_EVENT_ID);
    await register(member.id, PAST_EVENT_ID);

    const { error } = await member.client.rpc('delete_my_account');
    expect(error).toBeNull();

    expect(await deletedAtOf(member.id)).not.toBeNull();
    expect(await partiesOf(member.id)).toEqual([
      { event_id: UPCOMING_EVENT_ID, status: 'cancelled' },
      { event_id: PAST_EVENT_ID, status: 'registered' }
    ]);
  });

  test('past the close date of an event they are registered for, deletion is refused and nothing changes', async () => {
    const member = await newMember('locked');
    await register(member.id, UPCOMING_EVENT_ID);
    await register(member.id, LOCKED_EVENT_ID);

    const { error } = await member.client.rpc('delete_my_account');
    expect(error?.message).toMatch(/ne peut pas être supprimé.*Deletion Locked/);

    expect(await deletedAtOf(member.id)).toBeNull();
    expect((await partiesOf(member.id)).map(p => p.status)).toEqual(['registered', 'registered']);
  });

  test('a member cannot set deleted_at directly, on their own profile or another one', async () => {
    const member = await newMember('direct');
    const other = await newMember('other');

    await member.client.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', member.id);
    await member.client.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', other.id);

    expect(await deletedAtOf(member.id)).toBeNull();
    expect(await deletedAtOf(other.id)).toBeNull();
  });

  test('a deleted account keeps no member access, but can read that it was deleted', async () => {
    const member = await newMember('after');
    await register(member.id, PAST_EVENT_ID);
    await member.client.rpc('delete_my_account');

    const { data: ownParties } = await member.client.from('user_parties').select('id');
    expect(ownParties).toEqual([]);

    const { error: insertError } = await member.client.from('user_parties')
      .insert({ user_id: member.id, event_id: UPCOMING_EVENT_ID, attendees: ONE_ATTENDEE });
    expect(insertError).not.toBeNull();

    const { error: feedbackError } = await member.client.from('app_feedback').insert({ user_id: member.id, content: 'x' });
    expect(feedbackError).not.toBeNull();

    const { data: ownProfile } = await member.client.from('profiles').select('deleted_at').eq('id', member.id).single();
    expect(ownProfile.deleted_at).not.toBeNull();
  });

  test('an admin no longer lists the deleted member, but still sees their history', async () => {
    const member = await newMember('history');
    await register(member.id, PAST_EVENT_ID);
    await member.client.rpc('delete_my_account');

    const { data: activeProfiles } = await adminAuthClient.from('profiles').select('id').is('deleted_at', null).eq('id', member.id);
    expect(activeProfiles).toEqual([]);

    const { data: history } = await adminAuthClient.from('user_event_history').select('event_id').eq('user_id', member.id);
    expect(history).toEqual([{ event_id: PAST_EVENT_ID }]);
  });
});

// Manual seeding if function doesn't exist
async function seedTestDataManually() {
  // Clear existing test data
  await adminClient.from('user_parties').delete().in('user_id', [TEST_UUIDS.USER_ID, TEST_UUIDS.ADMIN_ID]);
  await adminClient.from('app_feedback').delete().in('user_id', [TEST_UUIDS.USER_ID, TEST_UUIDS.ADMIN_ID]);
  await adminClient.from('events').delete().in('id', [
    TEST_UUIDS.DRAFT_EVENT_ID,
    TEST_UUIDS.ACTIVE_EVENT_ID,
    TEST_UUIDS.ARCHIVED_EVENT_ID
  ]);
  await adminClient.from('profiles').delete().in('id', [TEST_UUIDS.USER_ID, TEST_UUIDS.ADMIN_ID]);

  // Insert test profiles
  await adminClient.from('profiles').insert([
    {
      id: TEST_UUIDS.USER_ID,
      email: 'user@test.com',
      full_name: 'Test User',
      is_admin: false
    },
    {
      id: TEST_UUIDS.ADMIN_ID,
      email: 'admin@test.com',
      full_name: 'Test Admin',
      is_admin: true
    }
  ]);

  // Insert test events
  await adminClient.from('events').insert([
    {
      id: TEST_UUIDS.DRAFT_EVENT_ID,
      theme: 'Draft Event',
      status: 'DRAFT'
    },
    {
      id: TEST_UUIDS.ACTIVE_EVENT_ID,
      theme: 'Active Event',
      status: 'ACTIVE'
    },
    {
      id: TEST_UUIDS.ARCHIVED_EVENT_ID,
      theme: 'Archived Event',
      status: 'ARCHIVED'
    }
  ]);

  // Insert test registrations
  await adminClient.from('user_parties').insert([
    {
      id: TEST_UUIDS.USER_REGISTRATION_ID,
      user_id: TEST_UUIDS.USER_ID,
      event_id: TEST_UUIDS.ACTIVE_EVENT_ID,
      status: 'registered'
    },
    {
      id: TEST_UUIDS.ADMIN_REGISTRATION_ID,
      user_id: TEST_UUIDS.ADMIN_ID,
      event_id: TEST_UUIDS.DRAFT_EVENT_ID,
      status: 'registered'
    }
  ]);

  // Insert test feedback
  await adminClient.from('app_feedback').insert([
    {
      id: TEST_UUIDS.USER_FEEDBACK_ID,
      user_id: TEST_UUIDS.USER_ID,
      feedback_type: 'BUG',
      message: 'Test bug report',
      is_resolved: false
    },
    {
      id: TEST_UUIDS.ADMIN_FEEDBACK_ID,
      user_id: TEST_UUIDS.ADMIN_ID,
      feedback_type: 'FEATURE',
      message: 'Test feature request',
      is_resolved: false
    }
  ]);
}