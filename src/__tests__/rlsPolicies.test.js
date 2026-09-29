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
 * 3. Run tests: `npm run test:rls`. jest.rls.config.js reads the URL and keys from
 *    `supabase status`; .env.test is only the fallback when that fails.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required: start the local Supabase (`supabase start`) or set it in .env.test');
}

// Admin client with service role key (bypasses RLS)
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'public' }
});

// One event per status, created by this block and nothing else.
const TEST_EVENTS = [
  { id: '33333333-3333-3333-3333-333333333333', theme: 'RLS Draft Event', status: 'DRAFT' },
  { id: '44444444-4444-4444-4444-444444444444', theme: 'RLS Active Event', status: 'ACTIVE' },
  { id: '55555555-5555-5555-5555-555555555555', theme: 'RLS Archived Event', status: 'ARCHIVED' }
];
const TEST_EVENT_IDS = TEST_EVENTS.map((event) => event.id);

describe('🔐 RLS Policy Enforcement', () => {
  jest.setTimeout(30000); // 30 seconds for Supabase operations

  let adminAuthClient;

  // Seeded as the admin user: service_role can only read events. supabase-js returns errors
  // rather than throwing them, so check, and a failed seed fails here instead of as an empty
  // result in some test below.
  beforeAll(async () => {
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert(TEST_EVENTS);
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('events').delete().in('id', TEST_EVENT_IDS);
  });

  test('EVENTS: Public can read ACTIVE and ARCHIVED events', async () => {
    const publicClient = createClient(SUPABASE_URL, ANON_KEY);

    const { data: events, error } = await publicClient
      .from('events')
      .select('id, status')
      .in('id', TEST_EVENT_IDS);

    expect(error).toBeNull();
    expect(events.map((event) => event.status).sort()).toEqual(['ACTIVE', 'ARCHIVED']);
  });

  test('EVENTS: Regular user cannot see DRAFT events', async () => {
    for (const client of [createClient(SUPABASE_URL, ANON_KEY), await signIn('member@test.local')]) {
      const { data: draftEvents, error } = await client
        .from('events')
        .select('id, status')
        .eq('status', 'DRAFT');

      expect(error).toBeNull();
      expect(draftEvents).toEqual([]);
    }
  });

  test('EVENTS: Admin can see DRAFT events', async () => {
    const { data: draftEvents, error } = await adminAuthClient
      .from('events')
      .select('id, status')
      .eq('id', TEST_EVENTS[0].id);

    expect(error).toBeNull();
    expect(draftEvents).toEqual([{ id: TEST_EVENTS[0].id, status: 'DRAFT' }]);
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

// What the registration form does (ADR 0018): save a party and its attendees through
// save_registration(). Attendees without a name get one (names are required). `id` is the party's
// id when this creates it; `userId` is whose registration, for an admin saving someone else's.
// Returns supabase-js's { data, error }.
const save = (client, eventId, attendees, { id, userId, party = {} } = {}) => client.rpc('save_registration', {
  p_event_id: eventId,
  p_attendees: attendees.map((attendee, index) => ({ name: `Person ${index + 1}`, ...attendee })),
  p_party: id ? { ...party, id } : party,
  ...(userId ? { p_user_id: userId } : {})
});
const saveOk = async (...args) => {
  const { data, error } = await save(...args);
  if (error) throw error;
  return data;
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

  test('an unpaid party keeps being recomputed on every save, at its locked price', async () => {
    await saveOk(memberClient, GF_EVENT_ID, ONE_ADULT_WHOLE, { id: UNPAID_PARTY_ID });

    // Selling price is 100 for a whole-event adult (2.0 pts = the full price), regardless of
    // the estimate a client might have sent.
    const { data: afterInsert } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(afterInsert.calculated_amount_owed)).toBe(100);

    // Editing the party recomputes it (unpaid parties are not grandfathered), but at the price it
    // locked when it was made (#117), not the event's new one.
    await adminAuthClient.from('events').update({ selling_price_whole_event: 500 }).eq('id', GF_EVENT_ID);
    await saveOk(memberClient, GF_EVENT_ID, TWO_ADULTS_WHOLE);

    const { data: afterUpdate } = await memberClient
      .from('user_parties')
      .select('calculated_amount_owed')
      .eq('id', UNPAID_PARTY_ID)
      .single();
    expect(Number(afterUpdate.calculated_amount_owed)).toBe(200);
  });

  test('a paid party keeps its stored amount across a price change and further edits', async () => {
    await saveOk(memberClient, GF_EVENT_ID, ONE_ADULT_WHOLE, { id: PAID_PARTY_ID });
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
    await saveOk(memberClient, GF_EVENT_ID, TWO_ADULTS_WHOLE);
    await memberClient
      .from('user_parties')
      .update({ calculated_amount_owed: 1, payment_status: 'unpaid' })
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

// #117 (reverses #32): a registration locks the base price and main-event ratio in force when it is
// made. Changing them afterwards only affects registrations made afterwards.
describe('🔒 price locked per registration (#117)', () => {
  jest.setTimeout(30000);

  const LOCK_EVENT_ID = 'a0000000-a000-a000-a000-a00000000117';
  const MEMBER_PARTY_ID = 'a0000000-a000-a000-a000-a00000000118';
  const ADMIN_PARTY_ID = 'a0000000-a000-a000-a000-a00000000119';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
  const PARTY_IDS = [MEMBER_PARTY_ID, ADMIN_PARTY_ID];

  let memberClient;
  let adminAuthClient;

  const row = async (id) => (await adminAuthClient.from('user_parties')
    .select('calculated_amount_owed, locked_selling_price_whole_event, locked_ratio_main_whole, edit_count, is_waitlisted')
    .eq('id', id).single()).data;
  const setEvent = async (fields) => {
    const { error } = await adminAuthClient.from('events').update(fields).eq('id', LOCK_EVENT_ID);
    expect(error).toBeNull();
  };
  const register = (client, id, userId, attendees = ONE_ADULT_WHOLE) => saveOk(client, LOCK_EVENT_ID, attendees, { id, userId });

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', PARTY_IDS);
    const { error } = await adminAuthClient.from('events').upsert({
      id: LOCK_EVENT_ID,
      theme: 'Price Lock Test Event',
      status: 'ACTIVE',
      selling_price_whole_event: 200,
      ratio_main_whole: 0.5375,
      max_attendees: null
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', PARTY_IDS);
  });

  test('a price change writes nothing to existing registrations; new ones pay the new price', async () => {
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID);
    const before = await row(MEMBER_PARTY_ID);
    expect(Number(before.calculated_amount_owed)).toBe(200);
    expect(Number(before.locked_selling_price_whole_event)).toBe(200);

    await setEvent({ selling_price_whole_event: 250 });
    expect(await row(MEMBER_PARTY_ID)).toEqual(before);

    await register(adminAuthClient, ADMIN_PARTY_ID, ADMIN_ID);
    expect(Number((await row(ADMIN_PARTY_ID)).calculated_amount_owed)).toBe(250);

    // The member adds someone: priced at their locked 200, not 250.
    await saveOk(memberClient, LOCK_EVENT_ID, TWO_ADULTS_WHOLE);
    const after = await row(MEMBER_PARTY_ID);
    expect(Number(after.calculated_amount_owed)).toBe(400);
    expect(Number(after.locked_selling_price_whole_event)).toBe(200);
  });

  test('the same for a ratio change', async () => {
    const adultMain = [{ type: 'Adult', participation: 'Main', is_new_member: false }];
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID, adultMain);
    const before = await row(MEMBER_PARTY_ID);
    expect(Number(before.calculated_amount_owed)).toBe(108); // 0.5375 × 200 = 107.50 → 108

    await setEvent({ ratio_main_whole: 0.6 });
    expect(await row(MEMBER_PARTY_ID)).toEqual(before);

    await register(adminAuthClient, ADMIN_PARTY_ID, ADMIN_ID, adultMain);
    expect(Number((await row(ADMIN_PARTY_ID)).calculated_amount_owed)).toBe(120); // 0.6 × 200

    await saveOk(memberClient, LOCK_EVENT_ID, [...adultMain, ...adultMain]);
    expect(Number((await row(MEMBER_PARTY_ID)).calculated_amount_owed)).toBe(216); // 108 + 108, each attendee rounded up (#120)
  });

  test('a member cannot write the locked price or ratio, on insert or update', async () => {
    const { error } = await memberClient.from('user_parties').insert({
      id: MEMBER_PARTY_ID, user_id: MEMBER_ID, event_id: LOCK_EVENT_ID,
      locked_selling_price_whole_event: 1, locked_ratio_main_whole: 0.1
    });
    expect(error).toBeNull();
    await saveOk(memberClient, LOCK_EVENT_ID, ONE_ADULT_WHOLE);
    let locked = await row(MEMBER_PARTY_ID);
    expect(Number(locked.locked_selling_price_whole_event)).toBe(200);
    expect(Number(locked.locked_ratio_main_whole)).toBe(0.5375);
    expect(Number(locked.calculated_amount_owed)).toBe(200);

    await memberClient.from('user_parties')
      .update({ locked_selling_price_whole_event: 1, locked_ratio_main_whole: 0.1 })
      .eq('id', MEMBER_PARTY_ID);
    await saveOk(memberClient, LOCK_EVENT_ID, TWO_ADULTS_WHOLE);
    locked = await row(MEMBER_PARTY_ID);
    expect(Number(locked.locked_selling_price_whole_event)).toBe(200);
    expect(Number(locked.locked_ratio_main_whole)).toBe(0.5375);
    expect(Number(locked.calculated_amount_owed)).toBe(400);
  });

  test('a paid registration stays frozen when edited', async () => {
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID);
    await adminAuthClient.from('user_parties').update({ payment_status: 'paid' }).eq('id', MEMBER_PARTY_ID);
    await setEvent({ selling_price_whole_event: 500 });
    await saveOk(adminAuthClient, LOCK_EVENT_ID, TWO_ADULTS_WHOLE, { userId: MEMBER_ID });
    expect(Number((await row(MEMBER_PARTY_ID)).calculated_amount_owed)).toBe(200);
  });

  test('a waitlisted registration keeps its locked price when promoted', async () => {
    await setEvent({ max_attendees: 1 });
    await register(adminAuthClient, ADMIN_PARTY_ID, ADMIN_ID);
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID);
    expect((await row(MEMBER_PARTY_ID)).is_waitlisted).toBe(true);

    await setEvent({ selling_price_whole_event: 300 });
    await adminAuthClient.from('user_parties').update({ status: 'cancelled' }).eq('id', ADMIN_PARTY_ID);
    const promoted = await row(MEMBER_PARTY_ID);
    expect(promoted.is_waitlisted).toBe(false);
    expect(Number(promoted.calculated_amount_owed)).toBe(200);
  });

  test('re-registering over a cancelled registration takes the current price', async () => {
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID);
    await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', MEMBER_PARTY_ID);
    await setEvent({ selling_price_whole_event: 250 });
    await saveOk(memberClient, LOCK_EVENT_ID, ONE_ADULT_WHOLE);
    const again = await row(MEMBER_PARTY_ID);
    expect(Number(again.locked_selling_price_whole_event)).toBe(250);
    expect(Number(again.calculated_amount_owed)).toBe(250);
  });

  test('a registration made before the event had a price is locked at the first price set', async () => {
    await setEvent({ selling_price_whole_event: 0 });
    await register(memberClient, MEMBER_PARTY_ID, MEMBER_ID);
    const unpriced = await row(MEMBER_PARTY_ID);
    expect(unpriced.locked_selling_price_whole_event).toBeNull();
    expect(Number(unpriced.calculated_amount_owed)).toBe(0);

    await setEvent({ selling_price_whole_event: 300 });
    const priced = await row(MEMBER_PARTY_ID);
    expect(Number(priced.locked_selling_price_whole_event)).toBe(300);
    expect(Number(priced.calculated_amount_owed)).toBe(300);

    // From then on it is locked like any other.
    await setEvent({ selling_price_whole_event: 350 });
    expect(await row(MEMBER_PARTY_ID)).toEqual(priced);
  });
});

// #109: the main-event ratio is a per-event setting (locked per registration since #117, see above),
// and the budget is readable and writable by admins only.
describe('💵 main-event ratio and admin-only budget (#109)', () => {
  jest.setTimeout(30000);

  const RATIO_EVENT_ID = 'a0000000-a000-a000-a000-a00000000109';
  const RATIO_PARTY_ID = 'a0000000-a000-a000-a000-a00000000110';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const ADULT_MAIN_AND_TEEN = [
    { type: 'Adult', participation: 'Main', is_new_member: false },
    { type: 'Teenager', participation: 'Whole', is_new_member: false }
  ];

  let memberClient;
  let adminAuthClient;
  let anonClient;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    anonClient = createClient(SUPABASE_URL, ANON_KEY);
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', RATIO_PARTY_ID);
    await adminAuthClient.from('event_budgets').delete().eq('event_id', RATIO_EVENT_ID);
    const { error } = await adminAuthClient.from('events').upsert({
      id: RATIO_EVENT_ID,
      theme: 'Ratio Test Event',
      status: 'ACTIVE',
      selling_price_whole_event: 200,
      ratio_main_whole: 0.5375
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', RATIO_PARTY_ID);
    await adminAuthClient.from('event_budgets').delete().eq('event_id', RATIO_EVENT_ID);
  });

  test('the main-event ratio prices a registration; teens pay half', async () => {
    await saveOk(memberClient, RATIO_EVENT_ID, ADULT_MAIN_AND_TEEN, { id: RATIO_PARTY_ID });
    const owed = async () => Number((await memberClient.from('user_parties')
      .select('calculated_amount_owed').eq('id', RATIO_PARTY_ID).single()).data.calculated_amount_owed);
    // 0.5375 × 200 + 0.5 × 200 = 207.50 → 208.
    expect(await owed()).toBe(208);

    // A new registration at another ratio: 0.6 × 200 + 0.5 × 200 = 220.
    const { error } = await adminAuthClient.from('events').update({ ratio_main_whole: 0.6 }).eq('id', RATIO_EVENT_ID);
    expect(error).toBeNull();
    await adminAuthClient.from('user_parties').delete().eq('id', RATIO_PARTY_ID);
    await saveOk(memberClient, RATIO_EVENT_ID, ADULT_MAIN_AND_TEEN, { id: RATIO_PARTY_ID });
    expect(await owed()).toBe(220);
  });

  // #120: same case as pricingEngine.test.js. Each attendee is rounded up to the dollar and the party
  // owes the sum of the lines: 205 + 123 + 61.50 → 62 + 61.50 → 62 + 0 = 452 (the rounded sum is 451).
  test('a party owes the sum of its attendees\' rounded prices', async () => {
    const { error } = await adminAuthClient.from('events')
      .update({ selling_price_whole_event: 205, ratio_main_whole: 0.6 }).eq('id', RATIO_EVENT_ID);
    expect(error).toBeNull();
    await saveOk(memberClient, RATIO_EVENT_ID, [
      { type: 'Adult', participation: 'Whole', is_new_member: false },
      { type: 'Adult', participation: 'Main', is_new_member: false },
      { type: 'Teenager', participation: 'Main', is_new_member: false },
      { type: 'Teenager', participation: 'Whole', is_new_member: true },
      { type: 'Kid', participation: 'Whole', is_new_member: false }
    ], { id: RATIO_PARTY_ID });
    const { data } = await memberClient.from('user_parties')
      .select('calculated_amount_owed').eq('id', RATIO_PARTY_ID).single();
    expect(Number(data.calculated_amount_owed)).toBe(452);
  });

  test('a ratio outside (0, 1] is refused', async () => {
    for (const ratio of [0, 1.2]) {
      const { error } = await adminAuthClient.from('events').update({ ratio_main_whole: ratio }).eq('id', RATIO_EVENT_ID);
      expect(error).not.toBeNull();
    }
  });

  test('a member cannot change the ratio', async () => {
    await memberClient.from('events').update({ ratio_main_whole: 0.9 }).eq('id', RATIO_EVENT_ID);
    const { data } = await adminAuthClient.from('events').select('ratio_main_whole').eq('id', RATIO_EVENT_ID).single();
    expect(Number(data.ratio_main_whole)).toBe(0.5375);
  });

  test('an admin writes the budget; the database computes its total', async () => {
    const { data, error } = await adminAuthClient.from('event_budgets').upsert({
      event_id: RATIO_EVENT_ID,
      lines: [{ category: 'Chalet', description: 'Location', amount: 700 }, { category: 'Food', description: '', amount: 300.5 }],
      total_cost: 1
    }).select().single();
    expect(error).toBeNull();
    expect(Number(data.total_cost)).toBe(1000.5);
    expect(Number(data.contingency_pct)).toBe(20);
  });

  test('a budget line with an unknown category or a negative amount is refused', async () => {
    for (const line of [{ category: 'Bogus', amount: 1 }, { category: 'Food', amount: -1 }]) {
      const { error } = await adminAuthClient.from('event_budgets').upsert({ event_id: RATIO_EVENT_ID, lines: [line] });
      expect(error).not.toBeNull();
    }
  });

  test('members and signed-out visitors can neither read nor write the budget', async () => {
    await adminAuthClient.from('event_budgets').upsert({ event_id: RATIO_EVENT_ID, lines: [{ category: 'Tech', amount: 50 }] });

    const { data: memberRows } = await memberClient.from('event_budgets').select('*').eq('event_id', RATIO_EVENT_ID);
    expect(memberRows).toEqual([]);
    const { error: memberWrite } = await memberClient.from('event_budgets')
      .upsert({ event_id: RATIO_EVENT_ID, lines: [] });
    expect(memberWrite).not.toBeNull();

    const { data: anonRows, error: anonRead } = await anonClient.from('event_budgets').select('*');
    expect(anonRows ?? []).toEqual([]);
    expect(anonRead).not.toBeNull();

    const { data } = await adminAuthClient.from('event_budgets').select('total_cost').eq('event_id', RATIO_EVENT_ID).single();
    expect(Number(data.total_cost)).toBe(50);
  });

  test('the budget columns are gone from the public events row', async () => {
    const { error } = await anonClient.from('events').select('total_cost').limit(1);
    expect(error).not.toBeNull();
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

describe("✉️ my_party_emails: the member's summary of their own emails (#93)", () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000000093';
  const MEMBER_PARTY_ID = 'a0000000-a000-a000-a000-a00000000094';
  const ADMIN_PARTY_ID = 'a0000000-a000-a000-a000-a00000000095';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';

  let memberClient;
  let adminAuthClient;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    await adminAuthClient.from('user_parties').delete().in('id', [MEMBER_PARTY_ID, ADMIN_PARTY_ID]);
    const { error: eventError } = await adminAuthClient.from('events').upsert({ id: EVENT_ID, theme: 'My Party Emails Test', status: 'ACTIVE' });
    if (eventError) throw eventError;
    const { error: partyError } = await adminAuthClient.from('user_parties').insert([
      { id: MEMBER_PARTY_ID, user_id: MEMBER_ID, event_id: EVENT_ID },
      { id: ADMIN_PARTY_ID, user_id: ADMIN_ID, event_id: EVENT_ID }
    ]);
    if (partyError) throw partyError;
    const rows = [
      { party_id: MEMBER_PARTY_ID, template: 'registration', status: 'sent', recipient: 'member@test.local', resend_id: 're_1' },
      { party_id: MEMBER_PARTY_ID, template: 'payment', status: 'failed', recipient: 'member@test.local', error: '422 refused' },
      { party_id: MEMBER_PARTY_ID, template: 'waitlist', status: 'backfilled' },
      { party_id: MEMBER_PARTY_ID, template: 'promotion', status: 'dry_run' },
      { party_id: MEMBER_PARTY_ID, template: 'accommodation', status: 'pending' },
      { party_id: ADMIN_PARTY_ID, template: 'registration', status: 'sent', recipient: 'admin@test.local' }
    ];
    const { error: logError } = await adminClient.from('email_log').upsert(rows, { onConflict: 'party_id,template' });
    if (logError) throw logError;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().in('id', [MEMBER_PARTY_ID, ADMIN_PARTY_ID]);
  });

  test('returns only sent and failed rows, simplified, with no recipient, error or Resend id', async () => {
    const { data, error } = await memberClient.rpc('my_party_emails', { p_party_id: MEMBER_PARTY_ID });
    expect(error).toBeNull();
    expect(data.map(row => [row.template, row.status]).sort()).toEqual([['payment', 'not_sent'], ['registration', 'sent']]);
    expect(Object.keys(data[0]).sort()).toEqual(['sent_at', 'status', 'template']);
  });

  test("returns nothing for someone else's party", async () => {
    const { data, error } = await memberClient.rpc('my_party_emails', { p_party_id: ADMIN_PARTY_ID });
    expect(error).toBeNull();
    expect(data).toEqual([]);
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
    const { error } = await save(memberClient, CANCEL_EVENT_ID, [{ type: 'Adult', participation: 'Whole' }]);
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

// #94: payment_status, admin_notes and the attendees' assigned_bed are admin-only. A member's
// party-level values are ignored (not refused); save_registration() never writes a bed, and a bed
// stays with its attendee (by id, ADR 0018) whatever the member edits.
describe('🛡️ admin-only registration fields (#94)', () => {
  jest.setTimeout(30000);

  const ADMIN_FIELDS_EVENT_ID = 'a0000000-a000-a000-a000-a00000000094';
  const ADMIN_FIELDS_PARTY_ID = 'a0000000-a000-a000-a000-a00000000095';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const attendee = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', is_new_member: false, ...fields });

  let memberClient;
  let adminAuthClient;

  const partyRow = async () => (await adminAuthClient.from('user_parties')
    .select('payment_status, admin_notes, calculated_amount_owed, status, attendees(id, name, assigned_bed)')
    .eq('id', ADMIN_FIELDS_PARTY_ID)
    .order('position', { referencedTable: 'attendees' })
    .single()).data;
  const bedsOf = (row) => row.attendees.map(a => [a.name, a.assigned_bed]);
  const idOf = (row, name) => row.attendees.find(a => a.name === name).id;

  // A party the admin has marked paid, annotated and given beds.
  const seedAdminManagedParty = async () => {
    await saveOk(adminAuthClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann'), attendee('Bob')], { id: ADMIN_FIELDS_PARTY_ID, userId: MEMBER_ID });
    const row = await partyRow();
    for (const [name, bed] of [['Ann', 'B1'], ['Bob', 'B2']]) {
      const { error } = await adminAuthClient.from('attendees').update({ assigned_bed: bed }).eq('id', idOf(row, name));
      if (error) throw error;
    }
    const { error } = await adminAuthClient.from('user_parties')
      .update({ payment_status: 'paid', admin_notes: 'secret' }).eq('id', ADMIN_FIELDS_PARTY_ID);
    if (error) throw error;
    return partyRow();
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

  test('a member creating a party cannot set payment, notes or beds', async () => {
    const { error } = await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, payment_status: 'paid', admin_notes: 'hax'
    });
    expect(error).toBeNull();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann', { assigned_bed: 'B1' })]);
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('a member updating their party cannot mark it paid, write notes or assign beds', async () => {
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann')], { id: ADMIN_FIELDS_PARTY_ID });
    const annId = idOf(await partyRow(), 'Ann');
    const { error } = await memberClient.from('user_parties')
      .update({ payment_status: 'paid', admin_notes: 'hax' })
      .eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(error).toBeNull();
    const { error: bedError } = await memberClient.from('attendees').update({ assigned_bed: 'B1' }).eq('id', annId);
    expect(bedError).not.toBeNull();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann', { id: annId, assigned_bed: 'B1' })]);
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('an admin can set payment, notes and beds', async () => {
    const row = await seedAdminManagedParty();
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
    expect(bedsOf(row)).toEqual([['Ann', 'B1'], ['Bob', 'B2']]);
  });

  test('an admin cannot change anything but the bed outside save_registration()', async () => {
    const row = await seedAdminManagedParty();
    const { error } = await adminAuthClient.from('attendees').update({ name: 'Zed' }).eq('id', idOf(row, 'Ann'));
    expect(error?.message).toBe('attendees_write_through_save_registration');
  });

  test("a member's form save keeps a paid party paid, its notes, its beds and its grandfathered amount (#31)", async () => {
    const seeded = await seedAdminManagedParty();
    await adminAuthClient.from('events').update({ selling_price_whole_event: 500 }).eq('id', ADMIN_FIELDS_EVENT_ID);
    const { error } = await save(memberClient, ADMIN_FIELDS_EVENT_ID, seeded.attendees.map(a => attendee(a.name, { id: a.id })));
    await adminAuthClient.from('events').update({ selling_price_whole_event: 100 }).eq('id', ADMIN_FIELDS_EVENT_ID);
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
    expect(Number(row.calculated_amount_owed)).toBe(200);
    expect(bedsOf(row)).toEqual([['Ann', 'B1'], ['Bob', 'B2']]);
  });

  test('beds stay with their attendee: removing the first one does not shift them', async () => {
    const seeded = await seedAdminManagedParty();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Bob', { id: idOf(seeded, 'Bob') }), attendee('Cat')]);
    expect(bedsOf(await partyRow())).toEqual([['Bob', 'B2'], ['Cat', '']]);
  });

  test('renaming an attendee keeps their bed: it is the same person', async () => {
    const seeded = await seedAdminManagedParty();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [
      attendee('Ann', { id: idOf(seeded, 'Ann') }), attendee('Rob', { id: idOf(seeded, 'Bob') })
    ]);
    expect(bedsOf(await partyRow())).toEqual([['Ann', 'B1'], ['Rob', 'B2']]);
  });

  test('re-registering over their own cancelled paid party keeps it paid (#35)', async () => {
    await seedAdminManagedParty();
    await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', ADMIN_FIELDS_PARTY_ID);
    const { error } = await save(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann'), attendee('Bob')]);
    expect(error).toBeNull();
    const row = await partyRow();
    expect(row.status).toBe('registered');
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
  });
});

// #118: the capacity check counts every party of the event, whoever writes.
describe('👥 capacity and waitlist see every party (#118)', () => {
  jest.setTimeout(30000);

  const CAPACITY_EVENT_ID = 'a0000000-a000-a000-a000-a00000000118';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';

  let memberClient;
  let adminAuthClient;

  const waitlistedOf = async (userId) => (await adminAuthClient.from('user_parties')
    .select('is_waitlisted').eq('event_id', CAPACITY_EVENT_ID).eq('user_id', userId).single()).data.is_waitlisted;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', CAPACITY_EVENT_ID);
    const { error } = await adminAuthClient.from('events').upsert({
      id: CAPACITY_EVENT_ID, theme: 'Capacity Test', status: 'ACTIVE', max_attendees: 1
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', CAPACITY_EVENT_ID);
  });

  test('a member registering past capacity is waitlisted', async () => {
    await saveOk(adminAuthClient, CAPACITY_EVENT_ID, ONE_ADULT_WHOLE);
    const party = await saveOk(memberClient, CAPACITY_EVENT_ID, ONE_ADULT_WHOLE);
    expect(party.is_waitlisted).toBe(true);
  });

  test("a member cancelling their own registration promotes someone else's waitlisted party", async () => {
    const party = await saveOk(memberClient, CAPACITY_EVENT_ID, ONE_ADULT_WHOLE);
    await saveOk(adminAuthClient, CAPACITY_EVENT_ID, ONE_ADULT_WHOLE);
    expect(await waitlistedOf(ADMIN_ID)).toBe(true);

    const { error } = await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', party.id);
    expect(error).toBeNull();
    expect(await waitlistedOf(ADMIN_ID)).toBe(false);
  });
});

// #126 (ADR 0018): attendees are rows of their own table, with the party's access, written only
// through save_registration().
describe('🧑‍🤝‍🧑 attendees table (#126)', () => {
  jest.setTimeout(30000);

  const ATTENDEES_EVENT_ID = 'a0000000-a000-a000-a000-a00000000126';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const person = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', ...fields });

  let memberClient;
  let adminAuthClient;
  let memberParty;
  let adminParty;

  const attendeesOf = async (partyId) => (await adminAuthClient.from('attendees')
    .select('id, name, position').eq('party_id', partyId).order('position')).data;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ATTENDEES_EVENT_ID);
    const { error } = await adminAuthClient.from('events').upsert({
      id: ATTENDEES_EVENT_ID, theme: 'Attendees Test', status: 'ACTIVE', selling_price_whole_event: 100,
      event_start_date: isoDay(60), x_reg_close_weeks: 1
    });
    if (error) throw error;
    memberParty = await saveOk(memberClient, ATTENDEES_EVENT_ID, [person('Ann'), person('Bob')]);
    adminParty = await saveOk(adminAuthClient, ATTENDEES_EVENT_ID, [person('Zed')]);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ATTENDEES_EVENT_ID);
  });

  test("a member reads their own party's attendees, in order, and no one else's", async () => {
    const { data } = await memberClient.from('user_parties')
      .select('id, attendees(name)').eq('event_id', ATTENDEES_EVENT_ID)
      .order('position', { referencedTable: 'attendees' });
    expect(data).toEqual([{ id: memberParty.id, attendees: [{ name: 'Ann' }, { name: 'Bob' }] }]);

    const { data: others } = await memberClient.from('attendees').select('id').eq('party_id', adminParty.id);
    expect(others).toEqual([]);
  });

  test('a member cannot write attendees directly, even in their own party', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const writes = [
      memberClient.from('attendees').insert({ party_id: memberParty.id, position: 9, name: 'X', type: 'Adult', participation: 'Whole' }),
      memberClient.from('attendees').update({ name: 'X' }).eq('id', ann.id),
      memberClient.from('attendees').delete().eq('id', ann.id)
    ];
    for (const { error } of await Promise.all(writes)) expect(error).not.toBeNull();
    expect((await attendeesOf(memberParty.id)).map(a => a.name)).toEqual(['Ann', 'Bob']);
  });

  test("a member cannot save someone else's registration, nor take over their attendees by id", async () => {
    const { error } = await save(memberClient, ATTENDEES_EVENT_ID, [person('X')], { userId: adminParty.user_id });
    expect(error).not.toBeNull();

    const [zed] = await attendeesOf(adminParty.id);
    await saveOk(memberClient, ATTENDEES_EVENT_ID, [person('Ann'), person('Stolen', { id: zed.id })]);
    expect(await attendeesOf(adminParty.id)).toEqual([zed]);
    expect((await attendeesOf(memberParty.id)).map(a => a.name)).toEqual(['Ann', 'Stolen']);
  });

  test('saving updates attendees by id, adds new ones, removes the others and keeps the order', async () => {
    const [ann, bob] = await attendeesOf(memberParty.id);
    await saveOk(memberClient, ATTENDEES_EVENT_ID, [person('Cat'), person('Bobby', { id: bob.id })]);
    const after = await attendeesOf(memberParty.id);
    expect(after.map(a => [a.name, a.position])).toEqual([['Cat', 1], ['Bobby', 2]]);
    expect(after[1].id).toBe(bob.id);
    expect(after.map(a => a.id)).not.toContain(ann.id);
  });

  test('an attendee with an invalid type or no name is refused, and nothing is saved', async () => {
    for (const bad of [person('Ann', { type: 'Alien' }), person('  ')]) {
      const { error } = await save(memberClient, ATTENDEES_EVENT_ID, [bad]);
      expect(error).not.toBeNull();
    }
    expect((await attendeesOf(memberParty.id)).map(a => a.name)).toEqual(['Ann', 'Bob']);
  });

  test("the edit history records attendee changes; creating the registration isn't an edit", async () => {
    const edits = async () => (await memberClient.from('registration_edits')
      .select('changes').eq('registration_id', memberParty.id)).data;
    expect(await edits()).toEqual([]);
    expect(memberParty.edit_count).toBe(0);

    await saveOk(memberClient, ATTENDEES_EVENT_ID, [person('Ann')]);
    const [edit] = await edits();
    expect(edit.changes.attendees.old.map(a => a.name)).toEqual(['Ann', 'Bob']);
    expect(edit.changes.attendees.new.map(a => a.name)).toEqual(['Ann']);
    expect(edit.changes.calculated_amount_owed).toEqual({ old: 200, new: 100 });
  });

  test('after the close date a member cannot remove an attendee, but can replace one', async () => {
    await adminAuthClient.from('events').update({ event_start_date: isoDay(3) }).eq('id', ATTENDEES_EVENT_ID);
    const [ann] = await attendeesOf(memberParty.id);

    const { error: removeError } = await save(memberClient, ATTENDEES_EVENT_ID, [person('Ann', { id: ann.id })]);
    expect(removeError?.message).toMatch(/verrouillées/);

    const { error: replaceError } = await save(memberClient, ATTENDEES_EVENT_ID, [person('Ann', { id: ann.id }), person('Cat')]);
    expect(replaceError).toBeNull();
  });

  test("deleting a party deletes its attendees", async () => {
    const { error } = await adminAuthClient.from('user_parties').delete().eq('id', memberParty.id);
    expect(error).toBeNull();
    expect(await attendeesOf(memberParty.id)).toEqual([]);
  });
});

// #113: per-event sleeping locations and places, and which place each attendee holds.
describe('🛏️ locations, places and assignments (#113)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000001131';
  const OTHER_EVENT_ID = 'a0000000-a000-a000-a000-a00000001132';
  const person = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', ...fields });

  let memberClient;
  let adminAuthClient;
  let memberParty;
  let adminParty;

  const attendeesOf = async (partyId) => (await adminAuthClient.from('attendees')
    .select('id, name').eq('party_id', partyId).order('position')).data;
  const addLocation = async (name, eventId = EVENT_ID) => {
    const { data, error } = await adminAuthClient.from('event_locations')
      .insert({ event_id: eventId, name }).select('id').single();
    if (error) throw error;
    return data.id;
  };
  const addPlace = async (locationId, label, type = 'bed') => {
    const { data, error } = await adminAuthClient.from('event_places')
      .insert({ location_id: locationId, label, type }).select('id').single();
    if (error) throw error;
    return data.id;
  };
  const assign = (placeId, attendeeId) => adminAuthClient.from('place_assignments')
    .insert({ place_id: placeId, attendee_id: attendeeId });
  const bedsOf = async (partyId) => (await adminAuthClient.from('attendee_places')
    .select('attendee_name, bed_label').eq('party_id', partyId).order('attendee_name')).data
    .map(({ attendee_name: name, bed_label: bed }) => [name, bed]);

  const cleanUp = async () => {
    await adminAuthClient.from('user_parties').delete().in('event_id', [EVENT_ID, OTHER_EVENT_ID]);
    await adminAuthClient.from('event_locations').delete().in('event_id', [EVENT_ID, OTHER_EVENT_ID]);
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert([
      { id: EVENT_ID, theme: 'Locations Test', status: 'ACTIVE', selling_price_whole_event: 100, max_attendees: 3 },
      { id: OTHER_EVENT_ID, theme: 'Other Locations Test', status: 'DRAFT' }
    ]);
    if (error) throw error;
  });

  beforeEach(async () => {
    await cleanUp();
    memberParty = await saveOk(memberClient, EVENT_ID, [person('Ann'), person('Bob')]);
    adminParty = await saveOk(adminAuthClient, EVENT_ID, [person('Zed')]);
  });

  afterAll(cleanUp);

  test("members can't write locations, places or assignments", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 1');
    const placeId = await addPlace(locationId, 'Lit A');

    const writes = [
      memberClient.from('event_locations').insert({ event_id: EVENT_ID, name: 'Hax' }),
      memberClient.from('event_places').insert({ location_id: locationId, label: 'Hax', type: 'bed' }),
      memberClient.from('place_assignments').insert({ place_id: placeId, attendee_id: ann.id })
    ];
    for (const { error } of await Promise.all(writes)) expect(error).not.toBeNull();
    expect(await bedsOf(memberParty.id)).toEqual([]);
  });

  test('a member reads where their own attendees sleep, and nothing else', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const [zed] = await attendeesOf(adminParty.id);
    const bedroom = await addLocation('Chambre 2');
    const bed = await addPlace(bedroom, 'Lit A');
    await addPlace(bedroom, 'Lit B');
    const yard = await addLocation('Cour');
    const tent = await addPlace(yard, 'Tente', 'camping');
    expect((await assign(bed, ann.id)).error).toBeNull();
    expect((await assign(tent, zed.id)).error).toBeNull();

    const { data: mine } = await memberClient.from('attendee_places').select('attendee_name, bed_label');
    expect(mine).toEqual([{ attendee_name: 'Ann', bed_label: 'Chambre 2 · Lit A' }]);
    expect((await memberClient.from('event_places').select('label')).data).toEqual([{ label: 'Lit A' }]);
    expect((await memberClient.from('event_locations').select('name')).data).toEqual([{ name: 'Chambre 2' }]);
    expect((await memberClient.from('place_assignments').select('attendee_id')).data).toEqual([{ attendee_id: ann.id }]);
  });

  test('the label follows renames; a member saving keeps the place; removing the attendee frees it', async () => {
    const [ann, bob] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Salon');
    const sofa = await addPlace(locationId, 'Sofa', 'sofa');
    await assign(sofa, ann.id);
    await assign(sofa, bob.id); // over capacity: allowed, the UI warns

    await adminAuthClient.from('event_locations').update({ name: 'Grand salon' }).eq('id', locationId);
    await adminAuthClient.from('event_places').update({ label: 'Canapé' }).eq('id', sofa);
    expect(await bedsOf(memberParty.id)).toEqual([['Ann', 'Grand salon · Canapé'], ['Bob', 'Grand salon · Canapé']]);

    await saveOk(memberClient, EVENT_ID, [person('Bobby', { id: bob.id })]);
    expect(await bedsOf(memberParty.id)).toEqual([['Bobby', 'Grand salon · Canapé']]);
  });

  test('one place per attendee', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 3');
    await assign(await addPlace(locationId, 'Lit A'), ann.id);
    expect((await assign(await addPlace(locationId, 'Lit B'), ann.id)).error).not.toBeNull();
  });

  test('cancelling the party frees its places, and a cancelled party cannot be assigned', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const placeId = await addPlace(await addLocation('Chambre 4'), 'Lit A');
    await assign(placeId, ann.id);

    expect((await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', memberParty.id)).error).toBeNull();
    expect(await bedsOf(memberParty.id)).toEqual([]);
    expect((await assign(placeId, ann.id)).error?.message).toBe('place_assignment_party_inactive');
  });

  test('a party that becomes waitlisted frees its places, and a waitlisted party cannot be assigned', async () => {
    const [ann, bob] = await attendeesOf(memberParty.id);
    const placeId = await addPlace(await addLocation('Chambre 5'), 'Lit A');
    await assign(placeId, ann.id);

    // 3 places: Zed plus a member party grown to 3 people is over capacity.
    const party = await saveOk(memberClient, EVENT_ID, [
      person('Ann', { id: ann.id }), person('Bob', { id: bob.id }), person('Cat')
    ]);
    expect(party.is_waitlisted).toBe(true);
    expect(await bedsOf(memberParty.id)).toEqual([]);
    expect((await assign(placeId, ann.id)).error?.message).toBe('place_assignment_party_inactive');
  });

  test("a place of another event can't be assigned, and places can't move to another event", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const otherLocation = await addLocation('Ailleurs', OTHER_EVENT_ID);
    const otherPlace = await addPlace(otherLocation, 'Lit Z');
    expect((await assign(otherPlace, ann.id)).error?.message).toBe('place_assignment_wrong_event');

    const locationId = await addLocation('Chambre 6');
    const placeId = await addPlace(locationId, 'Lit A');
    const { error: moveLocation } = await adminAuthClient.from('event_locations')
      .update({ event_id: OTHER_EVENT_ID }).eq('id', locationId);
    expect(moveLocation?.message).toBe('place_event_fixed');
    const { error: movePlace } = await adminAuthClient.from('event_places')
      .update({ location_id: otherLocation }).eq('id', placeId);
    expect(movePlace?.message).toBe('place_event_fixed');

    // Within the same event, a place can change location.
    const { error: sameEvent } = await adminAuthClient.from('event_places')
      .update({ location_id: await addLocation('Chambre 7') }).eq('id', placeId);
    expect(sameEvent).toBeNull();
  });

  test('an occupied place or location cannot be deleted; an empty one can', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 8');
    const placeId = await addPlace(locationId, 'Lit A');
    const emptyPlaceId = await addPlace(locationId, 'Lit B');
    await assign(placeId, ann.id);

    expect((await adminAuthClient.from('event_places').delete().eq('id', placeId)).error).not.toBeNull();
    expect((await adminAuthClient.from('event_locations').delete().eq('id', locationId)).error).not.toBeNull();
    expect((await adminAuthClient.from('event_places').delete().eq('id', emptyPlaceId)).error).toBeNull();
    const { data: places } = await adminAuthClient.from('event_places').select('id').eq('location_id', locationId);
    expect(places).toEqual([{ id: placeId }]);
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
  const register = async (userId, eventId) => (await saveOk(adminAuthClient, eventId, ONE_ATTENDEE, { userId })).id;
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
    // A code for the app to translate, not French text (see src/lib/dbErrors.js).
    expect(error?.message).toBe('account_deletion_locked');
    expect(JSON.parse(error.details)).toEqual({ event: 'Deletion Locked', close_date: isoDay(3 - 7) });

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

    const { error: insertError } = await save(member.client, UPCOMING_EVENT_ID, ONE_ATTENDEE);
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
