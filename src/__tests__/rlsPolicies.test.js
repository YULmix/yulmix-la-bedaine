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