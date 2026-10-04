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
import pg from 'pg';
import 'dotenv/config';

// Days counted in Toronto, the zone event dates are read in (#149): 'YYYY-MM-DD', today + n.
const isoDay = (offsetDays) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
};
// An event_start_date (timestamptz) at midnight, Toronto time, n days from today. A bare date
// would be read as UTC midnight: the evening before in Toronto.
const startsIn = (offsetDays) => `${isoDay(offsetDays)} 00:00 America/Toronto`;

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
    await seed(startsIn(60));
    await memberClient.from('user_parties').delete().eq('id', CANCEL_PARTY_ID);
    expect(await statusOf()).toBe('registered');
  });

  test('before the close date, a member cancels: the row stays, as cancelled', async () => {
    await seed(startsIn(60));
    const { error } = await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(error).toBeNull();
    expect(await statusOf()).toBe('cancelled');
  });

  test('a cancelled registration can be taken up again by the member', async () => {
    await seed(startsIn(60));
    await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    const { error } = await save(memberClient, CANCEL_EVENT_ID, [{ type: 'Adult', participation: 'Whole' }]);
    expect(error).toBeNull();
    expect(await statusOf()).toBe('registered');
  });

  test('after the close date, a member cannot cancel but an admin can', async () => {
    await seed(startsIn(3));
    const { error: memberError } = await memberClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(memberError?.message).toBe('registration_cancel_locked');
    expect(JSON.parse(memberError.details)).toHaveProperty('close_date');
    expect(await statusOf()).toBe('registered');

    const { error: adminError } = await adminAuthClient.from('user_parties').update({ status: 'cancelled' }).eq('id', CANCEL_PARTY_ID);
    expect(adminError).toBeNull();
    expect(await statusOf()).toBe('cancelled');
  });
});

// #94: payment_status, admin_notes and where attendees sleep are admin-only. A member's
// party-level values are ignored (not refused); the notes live in party_admin_notes, which members
// can neither read nor write (#227); only an admin writes place_assignments (#114), and
// a place stays with its attendee (by id, ADR 0018) whatever the member edits.
describe('🛡️ admin-only registration fields (#94)', () => {
  jest.setTimeout(30000);

  const ADMIN_FIELDS_EVENT_ID = 'a0000000-a000-a000-a000-a00000000094';
  const ADMIN_FIELDS_PARTY_ID = 'a0000000-a000-a000-a000-a00000000095';
  const ADMIN_FIELDS_VENUE_ID = 'a0000000-a000-a000-a000-a00000000096';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const attendee = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', is_new_member: false, ...fields });

  let memberClient;
  let adminAuthClient;

  const partyRow = async () => {
    const { data } = await adminAuthClient.from('user_parties')
      .select('payment_status, message_to_participants, calculated_amount_owed, status, attendees(id, name, place:attendee_places(bed_label)), note:party_admin_notes(notes)')
      .eq('id', ADMIN_FIELDS_PARTY_ID)
      .order('position', { referencedTable: 'attendees' })
      .single();
    const { note, ...row } = data;
    return { ...row, admin_notes: note?.notes ?? null };
  };
  const bedsOf = (row) => row.attendees.map(a => [a.name, a.place?.bed_label ?? '']);
  const idOf = (row, name) => row.attendees.find(a => a.name === name).id;
  let placeIds; // label → id of the event's places, in the location "Ch"

  // A party the admin has marked paid, annotated and given places.
  const seedAdminManagedParty = async () => {
    await saveOk(adminAuthClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann'), attendee('Bob')], { id: ADMIN_FIELDS_PARTY_ID, userId: MEMBER_ID });
    const row = await partyRow();
    for (const [name, bed] of [['Ann', 'B1'], ['Bob', 'B2']]) {
      const { error } = await adminAuthClient.from('place_assignments').insert({ attendee_id: idOf(row, name), place_id: placeIds[bed] });
      if (error) throw error;
    }
    const { error } = await adminAuthClient.from('user_parties')
      .update({ payment_status: 'paid' }).eq('id', ADMIN_FIELDS_PARTY_ID);
    if (error) throw error;
    const { error: notesError } = await adminAuthClient.from('party_admin_notes')
      .insert({ party_id: ADMIN_FIELDS_PARTY_ID, notes: 'secret' });
    if (notesError) throw notesError;
    return partyRow();
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error: venueError } = await adminAuthClient.from('venues').upsert({ id: ADMIN_FIELDS_VENUE_ID, name: 'Admin Fields Venue' });
    if (venueError) throw venueError;
    const { error } = await adminAuthClient.from('events').upsert({
      id: ADMIN_FIELDS_EVENT_ID, theme: 'Admin Fields Test', status: 'ACTIVE', selling_price_whole_event: 100, venue_id: ADMIN_FIELDS_VENUE_ID
    });
    if (error) throw error;
    await adminAuthClient.from('locations').delete().eq('venue_id', ADMIN_FIELDS_VENUE_ID);
    const { data: location } = await adminAuthClient.from('locations')
      .insert({ venue_id: ADMIN_FIELDS_VENUE_ID, name: 'Ch' }).select('id').single();
    const { data: places } = await adminAuthClient.from('places')
      .insert([{ location_id: location.id, label: 'B1', type: 'bed' }, { location_id: location.id, label: 'B2', type: 'bed' }])
      .select('id, label');
    placeIds = Object.fromEntries(places.map(place => [place.label, place.id]));
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ADMIN_FIELDS_EVENT_ID);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', ADMIN_FIELDS_EVENT_ID);
    await adminAuthClient.from('locations').delete().eq('venue_id', ADMIN_FIELDS_VENUE_ID);
  });

  test('a member creating a party cannot set payment, notes or beds', async () => {
    const { error } = await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, payment_status: 'paid'
    });
    expect(error).toBeNull();
    const { error: notesError } = await memberClient.from('party_admin_notes').insert({ party_id: ADMIN_FIELDS_PARTY_ID, notes: 'hax' });
    expect(notesError?.code).toBe('42501');
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann', { place_id: placeIds.B1 })]);
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('a member updating their party cannot mark it paid, write notes or assign beds', async () => {
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann')], { id: ADMIN_FIELDS_PARTY_ID });
    const annId = idOf(await partyRow(), 'Ann');
    const { error } = await memberClient.from('user_parties')
      .update({ payment_status: 'paid' })
      .eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(error).toBeNull();
    const { error: bedError } = await memberClient.from('place_assignments').insert({ attendee_id: annId, place_id: placeIds.B1 });
    expect(bedError).not.toBeNull();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Ann', { id: annId, place_id: placeIds.B1 })]);
    const row = await partyRow();
    expect(row.payment_status).toBe('unpaid');
    expect(row.admin_notes).toBeNull();
    expect(bedsOf(row)).toEqual([['Ann', '']]);
  });

  test('an admin can set payment, notes and beds', async () => {
    const row = await seedAdminManagedParty();
    expect(row.payment_status).toBe('paid');
    expect(row.admin_notes).toBe('secret');
    expect(bedsOf(row)).toEqual([['Ann', 'Ch · B1'], ['Bob', 'Ch · B2']]);
  });

  test('an admin cannot write attendees outside save_registration() either', async () => {
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
    expect(bedsOf(row)).toEqual([['Ann', 'Ch · B1'], ['Bob', 'Ch · B2']]);
  });

  test('beds stay with their attendee: removing the first one does not shift them', async () => {
    const seeded = await seedAdminManagedParty();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [attendee('Bob', { id: idOf(seeded, 'Bob') }), attendee('Cat')]);
    expect(bedsOf(await partyRow())).toEqual([['Bob', 'Ch · B2'], ['Cat', '']]);
  });

  test('renaming an attendee keeps their bed: it is the same person', async () => {
    const seeded = await seedAdminManagedParty();
    await saveOk(memberClient, ADMIN_FIELDS_EVENT_ID, [
      attendee('Ann', { id: idOf(seeded, 'Ann') }), attendee('Rob', { id: idOf(seeded, 'Bob') })
    ]);
    expect(bedsOf(await partyRow())).toEqual([['Ann', 'Ch · B1'], ['Rob', 'Ch · B2']]);
  });

  // #216: the organisers' message to the party is admin-only to write too, readable by its member.
  test('a member cannot set the message to participants: null on insert, the stored one on update (#216)', async () => {
    const { error } = await memberClient.from('user_parties').insert({
      id: ADMIN_FIELDS_PARTY_ID, user_id: MEMBER_ID, event_id: ADMIN_FIELDS_EVENT_ID, message_to_participants: 'hax'
    });
    expect(error).toBeNull();
    expect((await partyRow()).message_to_participants).toBeNull();

    const failed = await adminAuthClient.rpc('save_logistics', {
      p_changes: [{ party_id: ADMIN_FIELDS_PARTY_ID, places: {}, message_to_participants: 'Bienvenue' }]
    });
    expect(failed).toMatchObject({ data: [], error: null });

    const { error: updateError } = await memberClient.from('user_parties')
      .update({ message_to_participants: 'hax' }).eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(updateError).toBeNull();
    const row = await partyRow();
    expect(row.message_to_participants).toBe('Bienvenue');
    expect(row.admin_notes).toBeNull();

    const { data: own } = await memberClient.from('user_parties').select('message_to_participants').eq('id', ADMIN_FIELDS_PARTY_ID).single();
    expect(own.message_to_participants).toBe('Bienvenue');
  });

  test('save_logistics: an absent key keeps a text, a present one replaces it; one history entry per save (#216)', async () => {
    await seedAdminManagedParty();
    const saveTexts = async (texts) => {
      const result = await adminAuthClient.rpc('save_logistics', { p_changes: [{ party_id: ADMIN_FIELDS_PARTY_ID, places: {}, ...texts }] });
      expect(result).toMatchObject({ data: [], error: null });
    };
    await saveTexts({ message_to_participants: 'Bienvenue' });
    let row = await partyRow();
    expect([row.admin_notes, row.message_to_participants]).toEqual(['secret', 'Bienvenue']);
    await saveTexts({ admin_notes: 'Note 2' });
    row = await partyRow();
    expect([row.admin_notes, row.message_to_participants]).toEqual(['Note 2', 'Bienvenue']);
    await saveTexts({ admin_notes: 'Note 3', message_to_participants: '' });
    row = await partyRow();
    expect([row.admin_notes, row.message_to_participants]).toEqual(['Note 3', '']);

    const { data: edits } = await adminAuthClient.from('registration_edits')
      .select('changes').eq('registration_id', ADMIN_FIELDS_PARTY_ID).order('edited_at');
    expect(edits.slice(-3).map(edit => edit.changes)).toEqual([
      { message_to_participants: { old: null, new: 'Bienvenue' } },
      { admin_notes: { old: 'secret', new: 'Note 2' } },
      { admin_notes: { old: 'Note 2', new: 'Note 3' }, message_to_participants: { old: 'Bienvenue', new: '' } }
    ]);
  });

  test('a member cannot write the message through save_logistics either (#216)', async () => {
    await seedAdminManagedParty();
    const { error } = await memberClient.rpc('save_logistics', {
      p_changes: [{ party_id: ADMIN_FIELDS_PARTY_ID, places: {}, message_to_participants: 'hax' }]
    });
    // #217: Organisateur and above on the party's event.
    expect(error?.message).toBe('organiser_only');
    expect((await partyRow()).message_to_participants).toBeNull();
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

  // #227: the notes were a user_parties column, readable through the member's own-row policy.
  test('a member reads no notes, not even their own party\'s, by any path (#227)', async () => {
    const seeded = await seedAdminManagedParty();
    const { data: own, error } = await memberClient.from('user_parties').select('*').eq('id', ADMIN_FIELDS_PARTY_ID).single();
    expect(error).toBeNull();
    expect(own).not.toHaveProperty('admin_notes');
    expect(JSON.stringify(own)).not.toContain('secret');

    const { error: columnError } = await memberClient.from('user_parties').select('admin_notes').eq('id', ADMIN_FIELDS_PARTY_ID);
    expect(columnError).not.toBeNull();

    const { data: embedded } = await memberClient.from('user_parties').select('id, note:party_admin_notes(notes)').eq('id', ADMIN_FIELDS_PARTY_ID).single();
    expect(embedded.note).toBeNull();

    const { data: notes, error: notesError } = await memberClient.from('party_admin_notes').select('*');
    expect(notesError).toBeNull();
    expect(notes).toEqual([]);

    const { data: edits } = await memberClient.from('registration_edits').select('changes').eq('registration_id', ADMIN_FIELDS_PARTY_ID);
    expect(JSON.stringify(edits ?? [])).not.toContain('secret');

    const { data: saved, error: saveError } = await save(memberClient, ADMIN_FIELDS_EVENT_ID, seeded.attendees.map(a => attendee(a.name, { id: a.id })));
    expect(saveError).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('secret');
  });

  test('a member cannot insert, update or delete notes (#227)', async () => {
    await seedAdminManagedParty();
    const { error: insertError } = await memberClient.from('party_admin_notes').upsert({ party_id: ADMIN_FIELDS_PARTY_ID, notes: 'hax' });
    expect(insertError?.code).toBe('42501');
    const { data: updated } = await memberClient.from('party_admin_notes').update({ notes: 'hax' }).eq('party_id', ADMIN_FIELDS_PARTY_ID).select();
    expect(updated ?? []).toEqual([]);
    const { data: deleted } = await memberClient.from('party_admin_notes').delete().eq('party_id', ADMIN_FIELDS_PARTY_ID).select();
    expect(deleted ?? []).toEqual([]);
    const { error: rpcError } = await memberClient.rpc('save_logistics', {
      p_changes: [{ party_id: ADMIN_FIELDS_PARTY_ID, places: {}, admin_notes: 'hax' }]
    });
    // #217: Organisateur and above on the party's event.
    expect(rpcError?.message).toBe('organiser_only');
    expect((await partyRow()).admin_notes).toBe('secret');
  });

  test('save_logistics writes the notes table: absent keeps them, empty clears them (#227)', async () => {
    await seedAdminManagedParty();
    const saveTexts = async (texts) => {
      const result = await adminAuthClient.rpc('save_logistics', { p_changes: [{ party_id: ADMIN_FIELDS_PARTY_ID, places: {}, ...texts }] });
      expect(result).toMatchObject({ data: [], error: null });
    };
    const storedNotes = async () => (await adminAuthClient.from('party_admin_notes')
      .select('notes').eq('party_id', ADMIN_FIELDS_PARTY_ID).maybeSingle()).data?.notes;
    await saveTexts({ message_to_participants: 'Bienvenue' });
    expect(await storedNotes()).toBe('secret');
    await saveTexts({ admin_notes: '' });
    expect(await storedNotes()).toBe('');

    const { data: edits } = await adminAuthClient.from('registration_edits')
      .select('changes').eq('registration_id', ADMIN_FIELDS_PARTY_ID).order('edited_at');
    expect(edits.at(-1).changes).toEqual({ admin_notes: { old: 'secret', new: '' } });
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
      event_start_date: startsIn(60), x_reg_close_weeks: 1
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
    // Creating is logged as one « created » entry (#173), but doesn't count as an edit.
    const edits = async () => (await memberClient.from('registration_edits')
      .select('changes').eq('registration_id', memberParty.id).order('edited_at')).data;
    expect((await edits()).map(entry => Object.keys(entry.changes))).toEqual([['created']]);
    expect(memberParty.edit_count).toBe(0);

    await saveOk(memberClient, ATTENDEES_EVENT_ID, [person('Ann')]);
    const [, edit] = await edits();
    expect(edit.changes.attendees.old.map(a => a.name)).toEqual(['Ann', 'Bob']);
    expect(edit.changes.attendees.new.map(a => a.name)).toEqual(['Ann']);
    expect(edit.changes.calculated_amount_owed).toEqual({ old: 200, new: 100 });
  });

  test('after the close date a member cannot remove an attendee, but can replace one', async () => {
    await adminAuthClient.from('events').update({ event_start_date: startsIn(3) }).eq('id', ATTENDEES_EVENT_ID);
    const [ann] = await attendeesOf(memberParty.id);

    const { error: removeError } = await save(memberClient, ATTENDEES_EVENT_ID, [person('Ann', { id: ann.id })]);
    expect(removeError?.message).toBe('registration_attendee_removal_locked');
    expect(JSON.parse(removeError.details)).toHaveProperty('close_date');

    const { error: replaceError } = await save(memberClient, ATTENDEES_EVENT_ID, [person('Ann', { id: ann.id }), person('Cat')]);
    expect(replaceError).toBeNull();
  });

  test("deleting a party deletes its attendees", async () => {
    const { error } = await adminAuthClient.from('user_parties').delete().eq('id', memberParty.id);
    expect(error).toBeNull();
    expect(await attendeesOf(memberParty.id)).toEqual([]);
  });
});

// #237: removing an attendee marks their row removed (deleted_at) instead of deleting it. Clients
// never read a removed attendee, every count ignores them, and admins resolve them by id.
describe('🗑️ removed attendees (#237)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000000237';
  const person = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', ...fields });

  let memberClient;
  let adminAuthClient;
  let memberParty;
  let adminParty;

  // What clients can't see: the rows as stored, read as the superuser (local only).
  const dbQuery = async (sql, params = []) => {
    const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    expect(['127.0.0.1', 'localhost', '::1']).toContain(new URL(dbUrl).hostname);
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      return (await client.query(sql, params)).rows;
    } finally {
      await client.end();
    }
  };
  const storedAttendeesOf = (partyId) => dbQuery(
    'select id, name, position, deleted_at from public.attendees where party_id = $1 order by created_at, position', [partyId]
  );
  const attendeesOf = async (client, partyId) => (await client.from('attendees')
    .select('id, name').eq('party_id', partyId).order('position')).data;
  const partyOf = async (partyId) => (await adminAuthClient.from('user_parties')
    .select('calculated_amount_owed, is_waitlisted').eq('id', partyId).single()).data;

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
    const { error } = await adminAuthClient.from('events').upsert({
      id: EVENT_ID, theme: 'Removed Attendees Test', status: 'ACTIVE', selling_price_whole_event: 100,
      max_attendees: null, event_start_date: startsIn(60), x_reg_close_weeks: 1
    });
    if (error) throw error;
    memberParty = await saveOk(memberClient, EVENT_ID, [person('Ann'), person('Bob')]);
    adminParty = await saveOk(adminAuthClient, EVENT_ID, [person('Zed')]);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
  });

  test('saving without an attendee keeps their row, marked removed, and hides it from member and admin', async () => {
    const [ann, bob] = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);

    const stored = await storedAttendeesOf(memberParty.id);
    expect(stored.map(a => [a.id, a.deleted_at === null])).toEqual([[ann.id, true], [bob.id, false]]);

    for (const client of [memberClient, adminAuthClient]) {
      expect(await attendeesOf(client, memberParty.id)).toEqual([{ id: ann.id, name: 'Ann' }]);
      expect((await client.from('attendees').select('id').eq('id', bob.id)).data).toEqual([]);
      const { data } = await client.from('user_parties').select('attendees(name)').eq('id', memberParty.id).single();
      expect(data.attendees).toEqual([{ name: 'Ann' }]);
    }
  });

  // #217 made save_logistics() SECURITY DEFINER: the restrictive policy no longer hides the removed
  // attendee from it, its own deleted_at check does.
  test('save_logistics refuses a removed attendee (#217)', async () => {
    const [ann, bob] = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);
    const { data: failed, error } = await adminAuthClient.rpc('save_logistics', {
      p_changes: [{ party_id: memberParty.id, places: { [bob.id]: null } }]
    });
    expect(error).toBeNull();
    expect(failed).toEqual([expect.objectContaining({ party_id: memberParty.id, message: 'logistics_attendee_not_in_party' })]);
  });

  test("the amount owed, the party's size and the event's headcount ignore a removed attendee", async () => {
    const [ann] = await attendeesOf(memberClient, memberParty.id);
    expect((await partyOf(memberParty.id)).calculated_amount_owed).toBe(200);

    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);
    expect((await partyOf(memberParty.id)).calculated_amount_owed).toBe(100);
    const [counts] = await dbQuery(
      'select private.party_size($1) as size, private.event_headcount($2) as headcount', [memberParty.id, EVENT_ID]
    );
    expect(counts).toEqual({ size: 1, headcount: 2 });
    // #188's place history snapshot, read by a SECURITY DEFINER trigger too.
    const [{ snapshot }] = await dbQuery('select private.party_places_snapshot($1) as snapshot', [memberParty.id]);
    expect(snapshot.map(entry => entry.attendee_name)).toEqual(['Ann']);

    // 3 places: Ann, then Zed and Yan fit only if Bob isn't counted.
    await adminAuthClient.from('events').update({ max_attendees: 3 }).eq('id', EVENT_ID);
    const [zed] = await attendeesOf(adminAuthClient, adminParty.id);
    const party = await saveOk(adminAuthClient, EVENT_ID, [person('Zed', { id: zed.id }), person('Yan')]);
    expect(party.is_waitlisted).toBe(false);
  });

  test('re-adding someone creates a new row; a removed id in the payload is never revived', async () => {
    const [ann, bob] = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);

    for (const client of [memberClient, adminAuthClient]) {
      await saveOk(client, EVENT_ID, [person('Ann', { id: ann.id }), person('Bob', { id: bob.id })], {
        userId: client === adminAuthClient ? memberParty.user_id : undefined
      });
      const live = await attendeesOf(adminAuthClient, memberParty.id);
      expect(live.map(a => a.name)).toEqual(['Ann', 'Bob']);
      expect(live[1].id).not.toBe(bob.id);
      // Removed again, for the next round.
      await saveOk(client, EVENT_ID, [person('Ann', { id: ann.id })], {
        userId: client === adminAuthClient ? memberParty.user_id : undefined
      });
    }
    const stored = await storedAttendeesOf(memberParty.id);
    expect(stored.filter(a => a.deleted_at === null).map(a => a.id)).toEqual([ann.id]);
    expect(stored.filter(a => a.deleted_at !== null).map(a => a.name)).toEqual(['Bob', 'Bob', 'Bob']);
  });

  test('saving an unchanged registration keeps every id and logs no attendee change', async () => {
    const before = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, before.map(({ id, name }) => person(name, { id })));
    expect(await attendeesOf(memberClient, memberParty.id)).toEqual(before);
    expect((await storedAttendeesOf(memberParty.id)).every(a => a.deleted_at === null)).toBe(true);

    const { data: edits } = await memberClient.from('registration_edits')
      .select('changes').eq('registration_id', memberParty.id);
    expect(edits.some(entry => 'attendees' in entry.changes)).toBe(false);
  });

  test('the history logs a removal with live attendees only, before and after', async () => {
    const [ann] = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id }), person('Cat')]);

    const { data: edits } = await memberClient.from('registration_edits')
      .select('changes').eq('registration_id', memberParty.id).order('edited_at');
    const changes = edits.filter(entry => entry.changes.attendees).map(entry => entry.changes.attendees);
    expect(changes.map(({ old, new: after }) => [old.map(a => a.name), after.map(a => a.name)])).toEqual([
      [['Ann', 'Bob'], ['Ann']],
      [['Ann'], ['Ann', 'Cat']]
    ]);
  });

  test('an admin resolves a removed attendee by id; a member cannot', async () => {
    const [ann, bob] = await attendeesOf(memberClient, memberParty.id);
    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);

    const { data, error } = await adminAuthClient.rpc('attendee_by_id', { p_attendee_id: bob.id });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: bob.id, party_id: memberParty.id, name: 'Bob' });
    expect(data[0].deleted_at).not.toBeNull();
    expect((await adminAuthClient.rpc('attendee_by_id', { p_attendee_id: ann.id })).data)
      .toEqual([{ id: ann.id, party_id: memberParty.id, name: 'Ann', deleted_at: null }]);

    const { data: memberData, error: memberError } = await memberClient.rpc('attendee_by_id', { p_attendee_id: bob.id });
    expect(memberError?.message).toBe('admin_only');
    expect(memberData).toBeNull();
  });
});

// #113, #145: a venue's locations and places, shared by the events held there, and which place
// each attendee holds for their event.
describe('🛏️ venues, locations, places and assignments (#113, #145)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000001131';
  const OTHER_EVENT_ID = 'a0000000-a000-a000-a000-a00000001132';
  // Another edition at EVENT_ID's venue.
  const SAME_VENUE_EVENT_ID = 'a0000000-a000-a000-a000-a00000001133';
  const VENUE_ID = 'a0000000-a000-a000-a000-a00000001451';
  const OTHER_VENUE_ID = 'a0000000-a000-a000-a000-a00000001452';
  const EVENTS = [
    { id: EVENT_ID, theme: 'Locations Test', status: 'ACTIVE', selling_price_whole_event: 100, max_attendees: 3, venue_id: VENUE_ID },
    { id: OTHER_EVENT_ID, theme: 'Other Locations Test', status: 'DRAFT', venue_id: OTHER_VENUE_ID },
    { id: SAME_VENUE_EVENT_ID, theme: 'Same Venue Test', status: 'ACTIVE', selling_price_whole_event: 100, venue_id: VENUE_ID }
  ];
  const person = (name, fields = {}) => ({ name, type: 'Adult', participation: 'Whole', ...fields });

  let memberClient;
  let adminAuthClient;
  let memberParty;
  let adminParty;

  const attendeesOf = async (partyId) => (await adminAuthClient.from('attendees')
    .select('id, name').eq('party_id', partyId).order('position')).data;
  const addLocation = async (name, venueId = VENUE_ID) => {
    const { data, error } = await adminAuthClient.from('locations')
      .insert({ venue_id: venueId, name }).select('id').single();
    if (error) throw error;
    return data.id;
  };
  const addPlace = async (locationId, label, type = 'bed') => {
    const { data, error } = await adminAuthClient.from('places')
      .insert({ location_id: locationId, label, type }).select('id').single();
    if (error) throw error;
    return data.id;
  };
  const assign = (placeId, attendeeId) => adminAuthClient.from('place_assignments')
    .insert({ place_id: placeId, attendee_id: attendeeId });
  const override = (eventId, placeId, fields) => adminAuthClient.from('event_place_overrides')
    .upsert({ event_id: eventId, place_id: placeId, ...fields });
  const bedsOf = async (partyId) => (await adminAuthClient.from('attendee_places')
    .select('attendee_name, bed_label').eq('party_id', partyId).order('attendee_name')).data
    .map(({ attendee_name: name, bed_label: bed }) => [name, bed]);

  // Venues can't be deleted (they are archived), so the test venues stay, emptied.
  const cleanUp = async () => {
    const eventIds = EVENTS.map(event => event.id);
    await adminAuthClient.from('user_parties').delete().in('event_id', eventIds);
    await adminAuthClient.from('event_place_overrides').delete().in('event_id', eventIds);
    await adminAuthClient.from('locations').delete().in('venue_id', [VENUE_ID, OTHER_VENUE_ID]);
    const { error } = await adminAuthClient.from('events').upsert(EVENTS);
    if (error) throw error;
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('venues').upsert([
      { id: VENUE_ID, name: 'Le Chalet', address: '1 ch. du Lac', archived_at: null },
      { id: OTHER_VENUE_ID, name: 'Ailleurs', address: '2 rue Secrète', archived_at: null }
    ]);
    if (error) throw error;
  });

  beforeEach(async () => {
    await cleanUp();
    memberParty = await saveOk(memberClient, EVENT_ID, [person('Ann'), person('Bob')]);
    adminParty = await saveOk(adminAuthClient, EVENT_ID, [person('Zed')]);
  });

  afterAll(cleanUp);

  test("members can't write venues, locations, places, overrides or assignments", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 1');
    const placeId = await addPlace(locationId, 'Lit A');

    const writes = [
      memberClient.from('venues').insert({ name: 'Hax' }),
      memberClient.from('locations').insert({ venue_id: VENUE_ID, name: 'Hax' }),
      memberClient.from('places').insert({ location_id: locationId, label: 'Hax', type: 'bed' }),
      memberClient.from('event_place_overrides').insert({ event_id: EVENT_ID, place_id: placeId, is_excluded: true }),
      memberClient.from('place_assignments').insert({ place_id: placeId, attendee_id: ann.id })
    ];
    for (const { error } of await Promise.all(writes)) expect(error).not.toBeNull();
    const { data: renamed } = await memberClient.from('venues').update({ name: 'Hax' }).eq('id', VENUE_ID).select('id');
    expect(renamed ?? []).toEqual([]);
    expect((await adminAuthClient.from('venues').select('name').eq('id', VENUE_ID).single()).data.name).toBe('Le Chalet');
    expect(await bedsOf(memberParty.id)).toEqual([]);
  });

  test('anyone who sees an event sees its venue; nobody deletes a venue', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    for (const client of [memberClient, anonClient]) {
      const { data } = await client.from('events').select('venue:venues(name, address)').eq('id', EVENT_ID).single();
      expect(data.venue).toEqual({ name: 'Le Chalet', address: '1 ch. du Lac' });
      // A draft event is hidden, and so is its venue.
      expect((await client.from('venues').select('id').eq('id', OTHER_VENUE_ID)).data).toEqual([]);
    }

    const { error } = await adminAuthClient.from('venues').delete().eq('id', OTHER_VENUE_ID);
    expect(error).not.toBeNull();
    expect((await adminAuthClient.from('venues').select('id').eq('id', OTHER_VENUE_ID)).data).toHaveLength(1);
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

    const { data: mine } = await memberClient.from('attendee_places').select('attendee_name, event_id, bed_label');
    expect(mine).toEqual([{ attendee_name: 'Ann', event_id: EVENT_ID, bed_label: 'Chambre 2 · Lit A' }]);
    expect((await memberClient.from('places').select('label')).data).toEqual([{ label: 'Lit A' }]);
    expect((await memberClient.from('locations').select('name')).data).toEqual([{ name: 'Chambre 2' }]);
    expect((await memberClient.from('place_assignments').select('attendee_id')).data).toEqual([{ attendee_id: ann.id }]);
  });

  test('the label follows renames; a member saving keeps the place; removing the attendee frees it', async () => {
    const [ann, bob] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Salon');
    const sofa = await addPlace(locationId, 'Sofa', 'sofa');
    await assign(sofa, ann.id);
    await assign(sofa, bob.id); // over capacity: allowed, the UI warns

    await adminAuthClient.from('locations').update({ name: 'Grand salon' }).eq('id', locationId);
    await adminAuthClient.from('places').update({ label: 'Canapé' }).eq('id', sofa);
    expect(await bedsOf(memberParty.id)).toEqual([['Ann', 'Grand salon · Canapé'], ['Bob', 'Grand salon · Canapé']]);

    await saveOk(memberClient, EVENT_ID, [person('Bobby', { id: bob.id })]);
    expect(await bedsOf(memberParty.id)).toEqual([['Bobby', 'Grand salon · Canapé']]);
  });

  test("a removed attendee's place is freed, and a removed attendee can't be given one (#237)", async () => {
    const [ann, bob] = await attendeesOf(memberParty.id);
    const bed = await addPlace(await addLocation('Chambre 7'), 'Lit A');
    expect((await assign(bed, bob.id)).error).toBeNull();

    await saveOk(memberClient, EVENT_ID, [person('Ann', { id: ann.id })]);
    expect((await adminAuthClient.from('place_assignments').select('attendee_id').eq('place_id', bed)).data).toEqual([]);
    expect((await assign(bed, bob.id)).error?.message).toBe('place_assignment_attendee_removed');

    const failed = (await adminAuthClient.rpc('save_logistics', {
      p_changes: [{ party_id: memberParty.id, places: { [bob.id]: bed } }]
    })).data;
    expect(failed.map(f => f.message)).toEqual(['logistics_attendee_not_in_party']);
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

  test("a place of another venue can't be assigned, and places can't move to another venue", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const otherLocation = await addLocation('Ailleurs', OTHER_VENUE_ID);
    const otherPlace = await addPlace(otherLocation, 'Lit Z');
    expect((await assign(otherPlace, ann.id)).error?.message).toBe('place_assignment_wrong_event');

    const locationId = await addLocation('Chambre 6');
    const placeId = await addPlace(locationId, 'Lit A');
    const { error: moveLocation } = await adminAuthClient.from('locations')
      .update({ venue_id: OTHER_VENUE_ID }).eq('id', locationId);
    expect(moveLocation?.message).toBe('place_venue_fixed');
    const { error: movePlace } = await adminAuthClient.from('places')
      .update({ location_id: otherLocation }).eq('id', placeId);
    expect(movePlace?.message).toBe('place_venue_fixed');

    // Within the same venue, a place can change location.
    const { error: sameVenue } = await adminAuthClient.from('places')
      .update({ location_id: await addLocation('Chambre 7') }).eq('id', placeId);
    expect(sameVenue).toBeNull();
  });

  test('an occupied place or location cannot be deleted; an empty one can', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 8');
    const placeId = await addPlace(locationId, 'Lit A');
    const emptyPlaceId = await addPlace(locationId, 'Lit B');
    await assign(placeId, ann.id);

    expect((await adminAuthClient.from('places').delete().eq('id', placeId)).error).not.toBeNull();
    expect((await adminAuthClient.from('locations').delete().eq('id', locationId)).error).not.toBeNull();
    expect((await adminAuthClient.from('places').delete().eq('id', emptyPlaceId)).error).toBeNull();
    const { data: places } = await adminAuthClient.from('places').select('id').eq('location_id', locationId);
    expect(places).toEqual([{ id: placeId }]);
  });

  test('two events at one venue share its places, each with its own assignments', async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const yanParty = await saveOk(adminAuthClient, SAME_VENUE_EVENT_ID, [person('Yan')]);
    const [yan] = await attendeesOf(yanParty.id);
    const bed = await addPlace(await addLocation('Chambre 9'), 'Lit A');

    expect((await assign(bed, ann.id)).error).toBeNull();
    expect((await assign(bed, yan.id)).error).toBeNull();
    const { data } = await adminAuthClient.from('attendee_places')
      .select('attendee_name, event_id').eq('place_id', bed).order('attendee_name');
    expect(data).toEqual([
      { attendee_name: 'Ann', event_id: EVENT_ID },
      { attendee_name: 'Yan', event_id: SAME_VENUE_EVENT_ID }
    ]);
  });

  test("an event excludes a place or changes its capacity; excluding one its attendees hold is refused", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const yanParty = await saveOk(adminAuthClient, SAME_VENUE_EVENT_ID, [person('Yan')]);
    const [yan] = await attendeesOf(yanParty.id);
    const locationId = await addLocation('Chambre 10');
    const bed = await addPlace(locationId, 'Lit A');
    const sofa = await addPlace(locationId, 'Sofa', 'sofa');
    await assign(bed, ann.id);

    // Ann (this event) holds it: refused. The other edition at the venue may exclude it.
    expect((await override(EVENT_ID, bed, { is_excluded: true })).error?.message).toBe('place_exclusion_occupied');
    expect((await override(SAME_VENUE_EVENT_ID, bed, { is_excluded: true })).error).toBeNull();
    expect((await assign(bed, yan.id)).error?.message).toBe('place_assignment_place_excluded');

    expect((await override(EVENT_ID, sofa, { capacity: 3 })).error).toBeNull();
    expect((await override(EVENT_ID, sofa, { is_excluded: false, capacity: null })).error).not.toBeNull();
    const otherPlace = await addPlace(await addLocation('Ailleurs', OTHER_VENUE_ID), 'Lit Z');
    expect((await override(EVENT_ID, otherPlace, { is_excluded: true })).error?.message).toBe('place_override_wrong_venue');

    // The venue's own place is unchanged.
    const { data: place } = await adminAuthClient.from('places').select('capacity').eq('id', sofa).single();
    expect(place.capacity).toBe(1);
    expect((await memberClient.from('event_place_overrides').select('place_id')).data).toEqual([]);
  });

  // #202: two real connections with explicit transactions (PostgREST can't hold one open).
  // The second statement must wait for the first transaction, then see its commit and be refused.
  test('two concurrent assignments to one place do not block each other', async () => {
    const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    expect(['127.0.0.1', 'localhost', '::1']).toContain(new URL(dbUrl).hostname);
    const [ann, bob] = await attendeesOf(memberParty.id);
    const bed = await addPlace(await addLocation('Chambre 12'), 'Lit A');
    await adminAuthClient.from('places').update({ capacity: 2 }).eq('id', bed);
    const sql = 'insert into public.place_assignments (attendee_id, place_id) values ($1, $2)';
    const a = new pg.Client({ connectionString: dbUrl });
    const b = new pg.Client({ connectionString: dbUrl });
    await Promise.all([a.connect(), b.connect()]);
    try {
      await a.query('begin');
      await a.query(sql, [ann.id, bed]);
      await b.query('begin');
      // Would hang (and time the test out) if assignments took an exclusive lock.
      await b.query(sql, [bob.id, bed]);
      await a.query('commit');
      await b.query('commit');
    } finally {
      await a.end();
      await b.end();
    }
    const { data } = await adminAuthClient.from('place_assignments').select('attendee_id').eq('place_id', bed);
    expect(data).toHaveLength(2);
  });

  test('a concurrent assignment and exclusion of one place serialise: the second to commit is refused', async () => {
    // Superuser connections (they bypass RLS): the triggers are what's under test. Local only.
    const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    expect(['127.0.0.1', 'localhost', '::1']).toContain(new URL(dbUrl).hostname);
    const [ann, bob] = await attendeesOf(memberParty.id);
    const locationId = await addLocation('Chambre 11');
    const bed = await addPlace(locationId, 'Lit A');
    const other = await addPlace(locationId, 'Lit B');
    const insertAssignment = 'insert into public.place_assignments (attendee_id, place_id) values ($1, $2)';
    const insertExclusion = 'insert into public.event_place_overrides (event_id, place_id, is_excluded) values ($1, $2, true)';

    const a = new pg.Client({ connectionString: dbUrl });
    const b = new pg.Client({ connectionString: dbUrl });
    await Promise.all([a.connect(), b.connect()]);
    // Settles to 'pending' if `promise` is still waiting after the grace period.
    const state = (promise) => Promise.race([
      promise.then(() => 'done', () => 'done'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 800))
    ]);
    try {
      // 1. An assignment is open and uncommitted; the exclusion waits, then is refused.
      await a.query('begin');
      await a.query(insertAssignment, [ann.id, bed]);
      await b.query('begin');
      const exclusion = b.query(insertExclusion, [EVENT_ID, bed]);
      const exclusionResult = exclusion.then(() => null, error => error);
      expect(await state(exclusion)).toBe('pending');
      await a.query('commit');
      expect((await exclusionResult)?.message).toBe('place_exclusion_occupied');
      await b.query('rollback');

      // 2. An exclusion is open and uncommitted; the assignment waits, then is refused.
      await a.query('begin');
      await a.query(insertExclusion, [EVENT_ID, other]);
      await b.query('begin');
      const assignment = b.query(insertAssignment, [bob.id, other]);
      const assignmentResult = assignment.then(() => null, error => error);
      expect(await state(assignment)).toBe('pending');
      await a.query('commit');
      expect((await assignmentResult)?.message).toBe('place_assignment_place_excluded');
      await b.query('rollback');
    } finally {
      await a.end();
      await b.end();
    }

    // Never "excluded and still held".
    const { data: held } = await adminAuthClient.from('place_assignments').select('place_id').in('place_id', [bed, other]);
    const { data: excluded } = await adminAuthClient.from('event_place_overrides')
      .select('place_id').eq('event_id', EVENT_ID).eq('is_excluded', true).in('place_id', [bed, other]);
    expect(held).toEqual([{ place_id: bed }]);
    expect(excluded).toEqual([{ place_id: other }]);
  });

  test('create_event_venue: admins only, one venue per event however often it is called', async () => {
    await adminAuthClient.from('events').update({ venue_id: null }).eq('id', OTHER_EVENT_ID);
    const { error: memberError } = await memberClient.rpc('create_event_venue', { p_event_id: OTHER_EVENT_ID });
    expect(memberError).not.toBeNull();

    const { data: first, error } = await adminAuthClient.rpc('create_event_venue', { p_event_id: OTHER_EVENT_ID });
    expect(error).toBeNull();
    const { data: again } = await adminAuthClient.rpc('create_event_venue', { p_event_id: OTHER_EVENT_ID });
    expect(again).toBe(first);
    const { data: event } = await adminAuthClient.from('events')
      .select('venue:venues(id, name)').eq('id', OTHER_EVENT_ID).single();
    expect(event.venue).toEqual({ id: first, name: 'Other Locations Test' });
  });

  test("changing an event's venue clears its assignments and overrides, not another event's", async () => {
    const [ann] = await attendeesOf(memberParty.id);
    const yanParty = await saveOk(adminAuthClient, SAME_VENUE_EVENT_ID, [person('Yan')]);
    const [yan] = await attendeesOf(yanParty.id);
    const bed = await addPlace(await addLocation('Chambre 11'), 'Lit A');
    const sofa = await addPlace(await addLocation('Salon 2'), 'Sofa', 'sofa');
    await assign(bed, ann.id);
    await assign(bed, yan.id);
    await override(EVENT_ID, sofa, { is_excluded: true });

    // Saving the same venue again changes nothing.
    expect((await adminAuthClient.from('events').update({ venue_id: VENUE_ID }).eq('id', EVENT_ID)).error).toBeNull();
    expect(await bedsOf(memberParty.id)).toEqual([['Ann', 'Chambre 11 · Lit A']]);

    expect((await adminAuthClient.from('events').update({ venue_id: OTHER_VENUE_ID }).eq('id', EVENT_ID)).error).toBeNull();
    expect(await bedsOf(memberParty.id)).toEqual([]);
    expect((await adminAuthClient.from('event_place_overrides').select('place_id').eq('event_id', EVENT_ID)).data).toEqual([]);
    expect(await bedsOf(yanParty.id)).toEqual([['Yan', 'Chambre 11 · Lit A']]);
  });
});

// #148: archiving an event freezes its venue layout into a copy only it uses.
describe('🧊 archived events keep their layout (#148)', () => {
  jest.setTimeout(30000);

  const PAST_EVENT_ID = 'a0000000-a000-a000-a000-a00000001481';
  const NEXT_EVENT_ID = 'a0000000-a000-a000-a000-a00000001482';
  const person = (name) => ({ name, type: 'Adult', participation: 'Whole' });

  let adminAuthClient;
  let venueId; // a fresh live venue per test: venues are never deleted
  let pastParty;
  let nextParty;
  let places; // "<location> · <place>" → id, at the live venue

  const attendeeOf = async (partyId) => (await adminAuthClient.from('attendees').select('id').eq('party_id', partyId).single()).data.id;
  const bedOf = async (partyId) => (await adminAuthClient.from('attendee_places').select('bed_label').eq('party_id', partyId)).data.map(r => r.bed_label);
  const venueOf = async (eventId) => (await adminAuthClient.from('events').select('venue:venues(id, name, snapshot_of, archived_at)').eq('id', eventId).single()).data.venue;
  const ok = async (query) => { const { data, error } = await query; if (error) throw error; return data; };

  beforeAll(async () => {
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().in('event_id', [PAST_EVENT_ID, NEXT_EVENT_ID]);
    // Un-archive (allowed by SQL) so the events can be put on today's venue.
    await ok(adminAuthClient.from('events').upsert([
      { id: PAST_EVENT_ID, theme: 'Freeze Past', status: 'ACTIVE', selling_price_whole_event: 100 },
      { id: NEXT_EVENT_ID, theme: 'Freeze Next', status: 'DRAFT', selling_price_whole_event: 100 }
    ]));
    venueId = (await ok(adminAuthClient.from('venues').insert({ name: 'Le Moulin', address: '3 rue du Moulin' }).select('id').single())).id;
    await ok(adminAuthClient.from('events').update({ venue_id: venueId }).in('id', [PAST_EVENT_ID, NEXT_EVENT_ID]));
    const room = (await ok(adminAuthClient.from('locations').insert({ venue_id: venueId, name: 'Chambre 1' }).select('id').single())).id;
    const rows = await ok(adminAuthClient.from('places').insert([
      { location_id: room, label: 'Lit A', type: 'bed', capacity: 2 },
      { location_id: room, label: 'Lit B', type: 'bed', capacity: 1 }
    ]).select('id, label'));
    places = Object.fromEntries(rows.map(r => [`Chambre 1 · ${r.label}`, r.id]));
    pastParty = await saveOk(adminAuthClient, PAST_EVENT_ID, [person('Paula')]);
    await ok(adminAuthClient.from('events').update({ status: 'ACTIVE' }).eq('id', NEXT_EVENT_ID));
    nextParty = await saveOk(adminAuthClient, NEXT_EVENT_ID, [person('Nico')]);
    await ok(adminAuthClient.from('place_assignments').insert([
      { place_id: places['Chambre 1 · Lit A'], attendee_id: await attendeeOf(pastParty.id) },
      { place_id: places['Chambre 1 · Lit A'], attendee_id: await attendeeOf(nextParty.id) }
    ]));
    await ok(adminAuthClient.from('event_place_overrides').insert({ event_id: PAST_EVENT_ID, place_id: places['Chambre 1 · Lit B'], is_excluded: true }));
  });

  test('archiving moves the event onto a frozen copy; later venue edits only reach the others', async () => {
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', PAST_EVENT_ID));
    const frozen = await venueOf(PAST_EVENT_ID);
    expect(frozen).toMatchObject({ name: 'Le Moulin', snapshot_of: venueId });
    expect(frozen.archived_at).not.toBeNull();
    expect(await bedOf(pastParty.id)).toEqual(['Chambre 1 · Lit A']);
    // Its exclusion went with it, onto the copy's Lit B.
    const overrides = await ok(adminAuthClient.from('event_place_overrides')
      .select('is_excluded, place:places(label, location:locations(venue_id))').eq('event_id', PAST_EVENT_ID));
    expect(overrides).toEqual([{ is_excluded: true, place: { label: 'Lit B', location: { venue_id: frozen.id } } }]);

    // Rename, resize, add, remove at the live venue: the next edition sees it all…
    await ok(adminAuthClient.from('locations').update({ name: 'Grande chambre' }).eq('venue_id', venueId));
    await ok(adminAuthClient.from('places').update({ label: 'Queen' }).eq('id', places['Chambre 1 · Lit A']));
    expect((await adminAuthClient.from('places').delete().eq('id', places['Chambre 1 · Lit B'])).error).toBeNull();
    expect(await bedOf(nextParty.id)).toEqual(['Grande chambre · Queen']);

    // …the archived one still shows what it had.
    expect(await bedOf(pastParty.id)).toEqual(['Chambre 1 · Lit A']);
    const frozenPlaces = await ok(adminAuthClient.from('places').select('label, capacity, location:locations!inner(venue_id)')
      .eq('location.venue_id', frozen.id).order('label'));
    expect(frozenPlaces.map(p => [p.label, p.capacity])).toEqual([['Lit A', 2], ['Lit B', 1]]);

    // The live venue's occupied place no longer holds the archived attendee: it can go once the
    // next edition lets go of it.
    await adminAuthClient.from('place_assignments').delete().eq('place_id', places['Chambre 1 · Lit A']);
    expect((await adminAuthClient.from('places').delete().eq('id', places['Chambre 1 · Lit A'])).error).toBeNull();
    expect(await bedOf(pastParty.id)).toEqual(['Chambre 1 · Lit A']);
  });

  test('a frozen layout, and an archived event\'s venue and overrides, cannot change', async () => {
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', PAST_EVENT_ID));
    const frozen = await venueOf(PAST_EVENT_ID);
    const [frozenRoom] = await ok(adminAuthClient.from('locations').select('id').eq('venue_id', frozen.id));
    const [frozenBed] = await ok(adminAuthClient.from('places').select('id').eq('location_id', frozenRoom.id).eq('label', 'Lit A'));

    const refused = [
      adminAuthClient.from('venues').update({ name: 'Autre' }).eq('id', frozen.id),
      adminAuthClient.from('venues').insert({ name: 'Faux', snapshot_of: venueId }),
      adminAuthClient.from('locations').update({ name: 'Autre' }).eq('id', frozenRoom.id),
      adminAuthClient.from('locations').insert({ venue_id: frozen.id, name: 'Nouveau' }),
      adminAuthClient.from('places').update({ capacity: 5 }).eq('id', frozenBed.id),
      adminAuthClient.from('places').delete().eq('id', frozenBed.id),
      adminAuthClient.from('places').insert({ location_id: frozenRoom.id, label: 'Lit C', type: 'bed' })
    ];
    for (const { error } of await Promise.all(refused)) expect(error?.message).toBe('venue_layout_frozen');

    for (const query of [
      adminAuthClient.from('events').update({ venue_id: venueId }).eq('id', PAST_EVENT_ID),
      adminAuthClient.from('event_place_overrides').delete().eq('event_id', PAST_EVENT_ID)
    ]) expect((await query).error?.message).toBe('event_layout_frozen');
    expect(await bedOf(pastParty.id)).toEqual(['Chambre 1 · Lit A']);

    // Archiving the copy's venue itself (archived_at) is not a layout change.
    expect((await adminAuthClient.from('venues').update({ archived_at: new Date().toISOString() }).eq('id', frozen.id)).error).toBeNull();
  });

  test('un-archiving keeps the frozen copy and its places; archiving again copies nothing more', async () => {
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', PAST_EVENT_ID));
    const frozen = await venueOf(PAST_EVENT_ID);
    await ok(adminAuthClient.from('events').update({ status: 'DRAFT' }).eq('id', PAST_EVENT_ID));
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', PAST_EVENT_ID));
    expect((await venueOf(PAST_EVENT_ID)).id).toBe(frozen.id);
    expect(await ok(adminAuthClient.from('venues').select('id').eq('snapshot_of', venueId))).toHaveLength(1);
    expect(await bedOf(pastParty.id)).toEqual(['Chambre 1 · Lit A']);
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
      { id: UPCOMING_EVENT_ID, theme: 'Deletion Upcoming', status: 'ACTIVE', event_start_date: startsIn(60), x_reg_close_weeks: 1 },
      { id: LOCKED_EVENT_ID, theme: 'Deletion Locked', status: 'ACTIVE', event_start_date: startsIn(3), x_reg_close_weeks: 1 },
      { id: PAST_EVENT_ID, theme: 'Deletion Past', status: 'ARCHIVED', event_start_date: startsIn(-300), x_reg_close_weeks: 1 }
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
    // A code for the app to translate, not French text (see src/lib/dbErrors.ts).
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

// #177: galleries, which replaced the single location photo (#124). Images live in the public
// location-photos bucket, which only admins write; a gallery belongs to a location or to a venue
// (kind general or assignments), and its readers follow the owner.
describe('🖼️ galleries (#177)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000001241';
  const BUCKET = 'location-photos';
  const person = (name) => ({ name, type: 'Adult', participation: 'Whole' });
  // A few bytes are enough: the bucket checks the declared type, not the content.
  const image = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

  let memberClient;
  let adminAuthClient;
  let venueId; // a fresh venue per test: venues are never deleted
  let locationId;
  let uploaded; // every object this block put in the bucket, removed afterwards

  const ok = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  const upload = async (client, name = `${locationId}/${crypto.randomUUID()}.jpg`) => {
    const { error } = await client.storage.from(BUCKET).upload(name, image(), { contentType: 'image/jpeg' });
    if (!error) uploaded.push(name);
    return { name, error };
  };
  const exists = async (name) => {
    const [folder, file] = name.split('/');
    return (await ok(adminAuthClient.storage.from(BUCKET).list(folder, { search: file }))).length === 1;
  };
  const unused = async (client, paths) => client.rpc('unused_gallery_images', { p_paths: paths });
  const add = (client, path, owner) => client.rpc('add_gallery_image', {
    p_path: path, p_location_id: owner.locationId ?? null, p_venue_id: owner.venueId ?? null, p_kind: owner.kind ?? null
  });
  // A gallery's image paths in order, as `client` sees them.
  const pathsOf = async (client, filter) => {
    let query = client.from('galleries').select('images:gallery_images(path, position)');
    Object.entries(filter).forEach(([column, value]) => { query = query.eq(column, value); });
    const rows = await ok(query);
    return rows.flatMap(row => row.images.sort((x, y) => x.position - y.position).map(i => i.path));
  };
  // Seats a member's party in a new place of `location`.
  const sleepIn = async (location) => {
    const placeId = (await ok(adminAuthClient.from('places').insert({ location_id: location, label: 'Matelas', type: 'floor' }).select('id').single())).id;
    const party = await saveOk(memberClient, EVENT_ID, [person('Ann')]);
    const ann = (await ok(adminAuthClient.from('attendees').select('id').eq('party_id', party.id).single())).id;
    await ok(adminAuthClient.from('place_assignments').insert({ place_id: placeId, attendee_id: ann }));
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    uploaded = [];
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
    venueId = (await ok(adminAuthClient.from('venues').insert({ name: 'La Grange' }).select('id').single())).id;
    // Un-archive (allowed by SQL) so the event can be put on today's venue.
    await ok(adminAuthClient.from('events').upsert({
      id: EVENT_ID, theme: 'Galleries Test', status: 'ACTIVE', selling_price_whole_event: 100, venue_id: venueId
    }));
    locationId = (await ok(adminAuthClient.from('locations').insert({ venue_id: venueId, name: 'Grenier' }).select('id').single())).id;
  });

  afterEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
    if (uploaded.length) await adminAuthClient.storage.from(BUCKET).remove(uploaded);
  });

  test('an admin uploads, replaces and removes an object; a member can do none of it', async () => {
    const { name, error } = await upload(adminAuthClient);
    expect(error).toBeNull();
    const { error: replaceError } = await adminAuthClient.storage.from(BUCKET).upload(name, image(), { contentType: 'image/jpeg', upsert: true });
    expect(replaceError).toBeNull();

    const { error: memberUploadError } = await upload(memberClient);
    expect(memberUploadError).not.toBeNull();
    const { error: memberReplaceError } = await memberClient.storage.from(BUCKET).upload(name, image(), { contentType: 'image/jpeg', upsert: true });
    expect(memberReplaceError).not.toBeNull();
    // Storage reports a refused removal as nothing removed.
    await memberClient.storage.from(BUCKET).remove([name]);
    expect(await exists(name)).toBe(true);
    const { data: memberList } = await memberClient.storage.from(BUCKET).list(locationId);
    expect(memberList ?? []).toEqual([]);

    await ok(adminAuthClient.storage.from(BUCKET).remove([name]));
    expect(await exists(name)).toBe(false);
  });

  test('the bucket refuses what is not an image', async () => {
    const { error } = await adminAuthClient.storage.from(BUCKET)
      .upload(`${locationId}/x.txt`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' });
    expect(error).not.toBeNull();
  });

  test('a member writes no gallery and no image', async () => {
    const { name } = await upload(adminAuthClient);
    const image1 = await ok(add(adminAuthClient, name, { locationId }));

    expect((await add(memberClient, name, { locationId })).error?.message).toBe('admin_only');
    expect((await add(memberClient, name, { venueId, kind: 'general' })).error?.message).toBe('admin_only');
    expect((await memberClient.rpc('move_gallery_image', { p_image_id: image1.id, p_offset: 1 })).error?.message).toBe('admin_only');
    expect((await memberClient.from('galleries').insert({ venue_id: venueId, kind: 'general' })).error).not.toBeNull();
    expect((await memberClient.from('gallery_images').insert({ gallery_id: image1.gallery_id, path: name, position: 5 })).error).not.toBeNull();
    // RLS hides the rows from the member's update and delete: nothing changes.
    await memberClient.from('gallery_images').update({ position: 9 }).eq('id', image1.id);
    await memberClient.from('gallery_images').delete().eq('id', image1.id);
    await memberClient.from('galleries').delete().eq('id', image1.gallery_id);
    expect(await pathsOf(adminAuthClient, { location_id: locationId })).toEqual([name]);
    expect((await ok(adminAuthClient.from('gallery_images').select('position').eq('id', image1.id).single())).position).toBe(0);
  });

  test('a gallery belongs to one owner, once per location and once per venue kind', async () => {
    expect((await adminAuthClient.from('galleries').insert({ venue_id: venueId, location_id: locationId })).error).not.toBeNull();
    expect((await adminAuthClient.from('galleries').insert({ venue_id: venueId, kind: 'menu' })).error).not.toBeNull();
    expect((await adminAuthClient.from('galleries').insert({ location_id: locationId, kind: 'general' })).error).not.toBeNull();
    await ok(adminAuthClient.from('galleries').insert({ venue_id: venueId, kind: 'general' }));
    expect((await adminAuthClient.from('galleries').insert({ venue_id: venueId, kind: 'general' })).error).not.toBeNull();
    await ok(adminAuthClient.from('galleries').insert({ location_id: locationId }));
    expect((await adminAuthClient.from('galleries').insert({ location_id: locationId })).error).not.toBeNull();
  });

  test('images go last and move one step at a time; the first is the cover', async () => {
    const owner = { venueId, kind: 'general' };
    const [a, b, c] = ['a', 'b', 'c'].map(n => `${venueId}/${n}.jpg`);
    for (const path of [a, b, c]) await ok(add(adminAuthClient, path, owner));
    expect(await pathsOf(adminAuthClient, { venue_id: venueId, kind: 'general' })).toEqual([a, b, c]);

    const imageC = await ok(adminAuthClient.from('gallery_images').select('id').eq('path', c).single());
    await ok(adminAuthClient.rpc('move_gallery_image', { p_image_id: imageC.id, p_offset: -1 }));
    await ok(adminAuthClient.rpc('move_gallery_image', { p_image_id: imageC.id, p_offset: -1 }));
    expect(await pathsOf(adminAuthClient, { venue_id: venueId, kind: 'general' })).toEqual([c, a, b]);
    // Already first: nothing moves.
    await ok(adminAuthClient.rpc('move_gallery_image', { p_image_id: imageC.id, p_offset: -1 }));
    expect(await pathsOf(adminAuthClient, { venue_id: venueId, kind: 'general' })).toEqual([c, a, b]);
  });

  test('a 31st image is refused with gallery_full', async () => {
    for (let i = 0; i < 30; i += 1) await ok(add(adminAuthClient, `${locationId}/${i}.jpg`, { locationId }));
    const { error } = await add(adminAuthClient, `${locationId}/30.jpg`, { locationId });
    expect(error?.message).toBe('gallery_full');
    expect(JSON.parse(error.details)).toEqual({ max: 30 });
    expect(await pathsOf(adminAuthClient, { location_id: locationId })).toHaveLength(30);
  });

  test('a member reads the venue\'s general gallery and their location\'s, but no other location\'s nor any assignments gallery', async () => {
    const { name } = await upload(adminAuthClient);
    const otherLocation = (await ok(adminAuthClient.from('locations').insert({ venue_id: venueId, name: 'Cave' }).select('id').single())).id;
    await ok(add(adminAuthClient, name, { venueId, kind: 'general' }));
    await ok(add(adminAuthClient, name, { venueId, kind: 'assignments' }));
    await ok(add(adminAuthClient, name, { locationId }));
    await ok(add(adminAuthClient, name, { locationId: otherLocation }));

    // Before the member sleeps anywhere: only the venue's general gallery.
    const before = await ok(memberClient.from('galleries').select('venue_id, location_id, kind').or(`venue_id.eq.${venueId},location_id.in.(${locationId},${otherLocation})`));
    expect(before).toEqual([{ venue_id: venueId, location_id: null, kind: 'general' }]);

    await sleepIn(locationId);
    const after = await ok(memberClient.from('galleries').select('location_id, kind, images:gallery_images(path)').or(`venue_id.eq.${venueId},location_id.in.(${locationId},${otherLocation})`));
    expect(after).toHaveLength(2);
    expect(after).toEqual(expect.arrayContaining([
      { location_id: null, kind: 'general', images: [{ path: name }] },
      { location_id: locationId, kind: null, images: [{ path: name }] }
    ]));
    // Images too follow their gallery.
    const images = await ok(memberClient.from('gallery_images').select('gallery_id').eq('path', name));
    expect(images).toHaveLength(2);

    // Anonymous visitors read none (the info page is sign-in only).
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: anonRows } = await anonClient.from('galleries').select('id').eq('venue_id', venueId);
    expect(anonRows ?? []).toEqual([]);

    const response = await fetch(memberClient.storage.from(BUCKET).getPublicUrl(name).data.publicUrl);
    expect(response.status).toBe(200);
  });

  test('freezing copies the galleries; the frozen copies cannot change', async () => {
    const { name } = await upload(adminAuthClient);
    await ok(add(adminAuthClient, name, { venueId, kind: 'general' }));
    await ok(add(adminAuthClient, name, { venueId, kind: 'assignments' }));
    await ok(add(adminAuthClient, name, { locationId }));

    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', EVENT_ID));
    const frozen = await ok(adminAuthClient.from('events')
      .select('venue:venues(id, snapshot_of, galleries(kind, images:gallery_images(path)), locations(galleries(images:gallery_images(path))))')
      .eq('id', EVENT_ID).single());
    expect(frozen.venue.snapshot_of).toBe(venueId);
    expect(frozen.venue.galleries).toEqual(expect.arrayContaining([
      { kind: 'general', images: [{ path: name }] },
      { kind: 'assignments', images: [{ path: name }] }
    ]));
    // One gallery per location: PostgREST embeds it as an object.
    expect(frozen.venue.locations).toEqual([{ galleries: { images: [{ path: name }] } }]);

    const copyId = frozen.venue.id;
    const copyImage = await ok(adminAuthClient.from('gallery_images')
      .select('id, gallery_id, galleries!inner(venue_id)').eq('galleries.venue_id', copyId).eq('galleries.kind', 'general').single());
    expect((await add(adminAuthClient, `${copyId}/new.jpg`, { venueId: copyId, kind: 'general' })).error?.message).toBe('venue_layout_frozen');
    expect((await adminAuthClient.from('gallery_images').delete().eq('id', copyImage.id)).error?.message).toBe('venue_layout_frozen');
    expect((await adminAuthClient.from('gallery_images').update({ position: 3 }).eq('id', copyImage.id)).error?.message).toBe('venue_layout_frozen');
    expect((await adminAuthClient.from('galleries').delete().eq('id', copyImage.gallery_id)).error?.message).toBe('venue_layout_frozen');

    // The live venue's galleries still change.
    await ok(add(adminAuthClient, `${venueId}/later.jpg`, { venueId, kind: 'general' }));
  });

  test('unused_gallery_images is admin-only', async () => {
    const { error } = await unused(memberClient, []);
    expect(error?.message).toBe('admin_only');
  });

  test('unused_gallery_images names an unreferenced object, never one a gallery (or a frozen copy) points at', async () => {
    const { name: kept } = await upload(adminAuthClient);
    const { name: dropped } = await upload(adminAuthClient);
    const image1 = await ok(add(adminAuthClient, kept, { locationId }));

    expect(await ok(unused(adminAuthClient, [kept, dropped]))).toEqual([dropped]);

    // Archived: the frozen copy keeps the image, so removing it from the live gallery leaves it in use.
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', EVENT_ID));
    await ok(adminAuthClient.from('gallery_images').delete().eq('id', image1.id));
    expect(await pathsOf(adminAuthClient, { location_id: locationId })).toEqual([]);
    expect(await ok(unused(adminAuthClient, [kept]))).toEqual([]);
  });

  test('a deleted location takes its gallery, leaving its images unused', async () => {
    const { name } = await upload(adminAuthClient);
    const image1 = await ok(add(adminAuthClient, name, { locationId }));
    await ok(adminAuthClient.from('locations').delete().eq('id', locationId));
    expect(await ok(adminAuthClient.from('galleries').select('id').eq('id', image1.gallery_id))).toEqual([]);
    expect(await ok(unused(adminAuthClient, [name]))).toEqual([name]);
  });
});

// #180: the carpool board. Members can't read each other's parties; carpool_board() (SECURITY
// DEFINER) is how a registered member sees the confirmed parties' lifts, with only the board's
// fields. The board is the active event's (events.is_active), so this block
// makes its event the active one for its duration and gives the flag back after.
describe('🚗 carpool board (#180)', () => {
  jest.setTimeout(30000);

  const BOARD_EVENT_ID = 'a0000000-a000-a000-a000-a00000000180';
  const BOARD_VENUE_ID = 'a0000000-a000-a000-a000-a00000001801';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const BOARD_FIELDS = ['entry', 'kind', 'is_mine', 'contact_name', 'contact_email', 'departure_fsa',
    'departure_place', 'arrival', 'departure', 'seats', 'matches'].sort();
  const lift = (type, fields = {}) => ({
    transport: { type, seats: 2, arrival: '2026-07-10T18:00', departure: '2026-07-12T14:00', ...fields }
  });

  let adminAuthClient;
  let memberClient;
  let previouslyActive = [];
  const createdUserIds = [];
  const people = {};

  const newMember = async (label, fullName) => {
    const email = `carpool180-${label}-${Date.now()}@test.local`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email, password: 'password123', email_confirm: true, user_metadata: { full_name: fullName }
    });
    if (error) throw error;
    createdUserIds.push(data.user.id);
    return { id: data.user.id, email, client: await signIn(email) };
  };
  const register = async (person, party) => (await saveOk(person.client, BOARD_EVENT_ID, ONE_ADULT_WHOLE, { party })).id;
  const board = client => client.rpc('carpool_board');

  beforeAll(async () => {
    adminAuthClient = await signIn('admin@test.local');
    memberClient = await signIn('member@test.local');

    previouslyActive = (await adminAuthClient.from('events').select('id').eq('is_active', true)).data.map(event => event.id);
    if (previouslyActive.length) {
      const { error } = await adminAuthClient.from('events').update({ is_active: false }).in('id', previouslyActive);
      if (error) throw error;
    }
    const { error: venueError } = await adminAuthClient.from('venues')
      .upsert({ id: BOARD_VENUE_ID, name: 'Carpool Test Venue', lat: 45.005, lng: -72.1 });
    if (venueError) throw venueError;
    const { error } = await adminAuthClient.from('events').upsert({
      id: BOARD_EVENT_ID, theme: 'Carpool Test', status: 'ACTIVE', is_active: true, is_reg_open: true,
      venue_id: BOARD_VENUE_ID, event_start_date: startsIn(60), x_reg_close_weeks: 1, max_attendees: 90
    });
    if (error) throw error;
    await adminAuthClient.from('user_parties').delete().eq('event_id', BOARD_EVENT_ID);

    people.driver = await newMember('driver', 'Diane Driver');
    people.rider = await newMember('rider', 'Rémi Rider');
    people.walker = await newMember('walker', 'Wes Walker');
    people.waitlisted = await newMember('waitlisted', 'Wanda Waitlisted');
    people.cancelled = await newMember('cancelled', 'Carl Cancelled');
    people.stranger = await newMember('stranger', 'Sam Stranger');

    // The seeded member is registered without a lift: they may look, and aren't listed.
    await adminAuthClient.from('user_parties').delete().eq('event_id', BOARD_EVENT_ID).eq('user_id', MEMBER_ID);
    await saveOk(memberClient, BOARD_EVENT_ID, ONE_ADULT_WHOLE);

    await register(people.driver, lift('offer', { seats: 3, departure_fsa: 'H2G', departure_place: 'métro Jean-Talon' }));
    await register(people.rider, lift('need', { departure_fsa: 'H4C' }));
    await register(people.walker, lift('', { seats: 0 }));
    const waitlistedParty = await register(people.waitlisted, lift('offer', { departure_fsa: 'H1A' }));
    const cancelledParty = await register(people.cancelled, lift('need', { departure_fsa: 'H3B' }));

    // Cancelling first: a cancellation promotes whoever is waitlisted.
    const { error: cancelError } = await people.cancelled.client.from('user_parties').update({ status: 'cancelled' }).eq('id', cancelledParty);
    if (cancelError) throw cancelError;
    const { error: waitlistError } = await adminAuthClient.from('user_parties').update({ is_waitlisted: true }).eq('id', waitlistedParty);
    if (waitlistError) throw waitlistError;
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', BOARD_EVENT_ID);
    for (const id of createdUserIds) {
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) throw error;
    }
    await adminAuthClient.from('events').update({ is_active: false, status: 'ARCHIVED' }).eq('id', BOARD_EVENT_ID);
    if (previouslyActive.length) {
      await adminAuthClient.from('events').update({ is_active: true }).in('id', previouslyActive);
    }
  });

  test('a member with no registration for the active event, or a cancelled one, is refused', async () => {
    for (const person of [people.stranger, people.cancelled]) {
      const { data, error } = await board(person.client);
      expect(data).toBeNull();
      expect(error?.message).toBe('carpool_board_forbidden');
      expect((await person.client.rpc('can_view_carpool_board')).data).toBe(false);
    }
  });

  test('a registered member sees only the confirmed offers and needs, with the board fields only', async () => {
    const { data, error } = await board(memberClient);
    expect(error).toBeNull();
    expect(data.map(row => [row.kind, row.contact_name])).toEqual([['offer', 'Diane Driver'], ['need', 'Rémi Rider']]);
    data.forEach(row => expect(Object.keys(row).sort()).toEqual(BOARD_FIELDS));

    const [offer, need] = data;
    expect(offer).toMatchObject({
      is_mine: false, contact_email: people.driver.email, departure_fsa: 'H2G', departure_place: 'métro Jean-Talon',
      arrival: '2026-07-10T18:00', departure: '2026-07-12T14:00', seats: 3
    });
    // The offer's closest need is the rider, by detour to the venue; and the reverse.
    expect(offer.matches).toHaveLength(1);
    expect(offer.matches[0].entry).toBe(need.entry);
    expect(offer.matches[0].detour_km).toBeGreaterThan(0);
    expect(offer.matches[0].distance_km).toBeGreaterThan(0);
    expect(need.matches.map(match => match.entry)).toEqual([offer.entry]);
  });

  test("the caller's own listed party is marked as theirs", async () => {
    const { data } = await board(people.driver.client);
    expect(data.find(row => row.kind === 'offer')).toMatchObject({ contact_name: 'Diane Driver', is_mine: true });
    expect(data.find(row => row.kind === 'need').is_mine).toBe(false);
  });

  test('a waitlisted party is never listed, and its member is refused like anyone unconfirmed', async () => {
    expect((await board(memberClient)).data.map(row => row.contact_name)).not.toContain('Wanda Waitlisted');
    const { data, error } = await board(people.waitlisted.client);
    expect(data).toBeNull();
    expect(error?.message).toBe('carpool_board_forbidden');
    expect((await people.waitlisted.client.rpc('can_view_carpool_board')).data).toBe(false);
  });

  test('an admin sees the same board without being registered', async () => {
    const { data, error } = await board(adminAuthClient);
    expect(error).toBeNull();
    expect(data.map(row => row.contact_name)).toEqual(['Diane Driver', 'Rémi Rider']);
  });

  test("anon can't run it", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await anon.rpc('carpool_board');
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error.message).not.toBe('carpool_board_forbidden');
    expect((await anon.rpc('can_view_carpool_board')).error).not.toBeNull();
  });

  test("a member still can't read other parties directly", async () => {
    const { data, error } = await people.rider.client.from('user_parties').select('id, user_id, transport').eq('event_id', BOARD_EVENT_ID);
    expect(error).toBeNull();
    expect(data.map(row => row.user_id)).toEqual([people.rider.id]);
  });

  test('without venue coordinates, matches carry the distance only', async () => {
    await adminAuthClient.from('venues').update({ lat: null, lng: null }).eq('id', BOARD_VENUE_ID);
    try {
      const { data } = await board(memberClient);
      expect(data[0].matches[0].detour_km).toBeNull();
      expect(data[0].matches[0].distance_km).toBeGreaterThan(0);
    } finally {
      await adminAuthClient.from('venues').update({ lat: 45.005, lng: -72.1 }).eq('id', BOARD_VENUE_ID);
    }
  });

  test('venue coordinates go together', async () => {
    const { error } = await adminAuthClient.from('venues').update({ lat: 45, lng: null }).eq('id', BOARD_VENUE_ID);
    expect(error?.message).toMatch(/venues_lat_lng_together/);
  });
});

// #173: creating a registration writes a « created » entry to registration_edits, authored by
// whoever created it, with the attendees as saved. The read rule is unchanged: a member reads the
// entries they authored, an admin reads them all.
describe('📜 registration history logs creations (#173)', () => {
  jest.setTimeout(30000);

  const HISTORY_EVENT_ID = 'a0000000-a000-a000-a000-a00000000173';
  const HISTORY_PARTY_ID = 'a0000000-a000-a000-a000-a00000000174';
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';

  let memberClient;
  let adminAuthClient;

  const entriesAs = async (client) => {
    const { data, error } = await client
      .from('registration_edits')
      .select('edited_by, changes')
      .eq('registration_id', HISTORY_PARTY_ID)
      .order('edited_at');
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert({
      id: HISTORY_EVENT_ID, theme: 'History Test', status: 'ACTIVE', event_start_date: startsIn(60), selling_price_whole_event: 100
    });
    if (error) throw error;
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', HISTORY_PARTY_ID);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', HISTORY_PARTY_ID);
  });

  test('a member registering writes one creation entry, with what was saved', async () => {
    await saveOk(memberClient, HISTORY_EVENT_ID, TWO_ADULTS_WHOLE, { id: HISTORY_PARTY_ID });

    const [entry, ...rest] = await entriesAs(memberClient);
    expect(rest).toEqual([]);
    expect(entry.edited_by).toBe(MEMBER_ID);
    expect(entry.changes.created.old).toBeNull();
    const created = entry.changes.created.new;
    expect(created.attendees).toHaveLength(2);
    expect(created.status).toBe('registered');
    expect(created.is_waitlisted).toBe(false);
    expect(Number(created.calculated_amount_owed)).toBe(200);
  });

  test('edits are logged as before; the member reads only what they authored, the admin reads all', async () => {
    await saveOk(memberClient, HISTORY_EVENT_ID, ONE_ADULT_WHOLE, { id: HISTORY_PARTY_ID });
    await saveOk(memberClient, HISTORY_EVENT_ID, TWO_ADULTS_WHOLE);
    const { error } = await adminAuthClient.from('party_admin_notes').insert({ party_id: HISTORY_PARTY_ID, notes: 'Note' });
    expect(error).toBeNull();

    const all = await entriesAs(adminAuthClient);
    expect(all.map(entry => Object.keys(entry.changes).sort())).toEqual([
      ['created'],
      ['attendees', 'calculated_amount_owed'],
      ['admin_notes']
    ]);
    expect(all.map(entry => entry.edited_by)).toEqual([MEMBER_ID, MEMBER_ID, ADMIN_ID]);
    expect((await entriesAs(memberClient)).map(entry => Object.keys(entry.changes)[0])).toEqual(['created', 'attendees']);
  });

  test("an admin registering someone is the creation entry's author", async () => {
    await saveOk(adminAuthClient, HISTORY_EVENT_ID, ONE_ADULT_WHOLE, { id: HISTORY_PARTY_ID, userId: MEMBER_ID });

    const all = await entriesAs(adminAuthClient);
    expect(all).toHaveLength(1);
    expect(all[0].edited_by).toBe(ADMIN_ID);
    expect(all[0].changes.created.new.attendees).toHaveLength(1);
    expect(await entriesAs(memberClient)).toEqual([]);
  });
});

describe('🛏️ event_places, venue_layout and set_place_override (#193)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000001931';
  // Another edition at the same venue: its people sleep in the same places.
  const SAME_VENUE_EVENT_ID = 'a0000000-a000-a000-a000-a00000001932';
  const EVENT_IDS = [EVENT_ID, SAME_VENUE_EVENT_ID];
  const person = (name) => ({ name, type: 'Adult', participation: 'Whole' });

  let memberClient;
  let adminAuthClient;
  let venueId; // a fresh venue per test: venues are never deleted
  let otherVenueId;
  let ids; // location and place ids by name

  const ok = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  const attendeeOf = async (partyId) => (await adminAuthClient.from('attendees').select('id').eq('party_id', partyId).single()).data.id;
  const eventPlaces = (client, eventId = EVENT_ID) => client.rpc('event_places', { p_event_id: eventId });
  const setOverride = (client, placeId, isExcluded, capacity, eventId = EVENT_ID) => client.rpc('set_place_override', {
    p_event_id: eventId, p_place_id: placeId, p_is_excluded: isExcluded, p_capacity: capacity
  });
  const overrideRows = async () => ok(adminAuthClient.from('event_place_overrides')
    .select('place_id, is_excluded, capacity').eq('event_id', EVENT_ID));

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  // Two locations with equal sort_order, the second one created first, so only created_at
  // decides; same for two of the places. "Grenier" has no places.
  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().in('event_id', EVENT_IDS);
    await ok(adminAuthClient.from('events').upsert([
      { id: EVENT_ID, theme: 'Event Places', status: 'ACTIVE', selling_price_whole_event: 100 },
      { id: SAME_VENUE_EVENT_ID, theme: 'Event Places Twin', status: 'ACTIVE', selling_price_whole_event: 100 }
    ]));
    venueId = (await ok(adminAuthClient.from('venues').insert({ name: 'La Grange' }).select('id').single())).id;
    otherVenueId = (await ok(adminAuthClient.from('venues').insert({ name: 'Ailleurs' }).select('id').single())).id;
    await ok(adminAuthClient.from('events').update({ venue_id: venueId }).in('id', EVENT_IDS));
    const locations = await ok(adminAuthClient.from('locations').insert([
      { venue_id: venueId, name: 'Chambre B', sort_order: 0, created_at: '2026-01-02T00:00:00Z' },
      { venue_id: venueId, name: 'Chambre A', sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
      { venue_id: venueId, name: 'Grenier', sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
      { venue_id: otherVenueId, name: 'Ailleurs 1', sort_order: 0, created_at: '2026-01-01T00:00:00Z' }
    ]).select('id, name'));
    ids = Object.fromEntries(locations.map(row => [row.name, row.id]));
    const places = await ok(adminAuthClient.from('places').insert([
      { location_id: ids['Chambre A'], label: 'Lit 2', type: 'bed', capacity: 2, sort_order: 0, created_at: '2026-01-02T00:00:00Z' },
      { location_id: ids['Chambre A'], label: 'Lit 1', type: 'bed', capacity: 2, sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
      { location_id: ids['Chambre A'], label: 'Sofa', type: 'sofa', capacity: 1, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
      { location_id: ids['Chambre B'], label: 'Matelas', type: 'floor', capacity: 3, sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
      { location_id: ids['Ailleurs 1'], label: 'Loin', type: 'bed', capacity: 1, sort_order: 0, created_at: '2026-01-01T00:00:00Z' }
    ]).select('id, label'));
    places.forEach(row => { ids[row.label] = row.id; });
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().in('event_id', EVENT_IDS);
    await adminAuthClient.from('events').update({ venue_id: null, status: 'DRAFT' }).in('id', EVENT_IDS);
  });

  test('venue_layout and event_places list in one order, ties broken on created_at', async () => {
    const layout = await ok(adminAuthClient.rpc('venue_layout', { p_venue_id: venueId }));
    expect(layout.map(row => [row.location_name, row.label])).toEqual([
      ['Chambre A', 'Lit 1'],
      ['Chambre A', 'Lit 2'],
      ['Chambre A', 'Sofa'],
      ['Chambre B', 'Matelas'],
      ['Grenier', null]
    ]);
    expect(layout.map(row => row.position)).toEqual([1, 2, 3, 4, 5]);

    const places = await ok(eventPlaces(adminAuthClient));
    expect(places.map(row => row.label)).toEqual(['Lit 1', 'Lit 2', 'Sofa', 'Matelas']);
    expect(places.map(row => row.position)).toEqual([1, 2, 3, 4]);
  });

  test("event_places merges this event's overrides and lists only its own occupants", async () => {
    const party = await saveOk(adminAuthClient, EVENT_ID, [person('Ann')]);
    const twin = await saveOk(adminAuthClient, SAME_VENUE_EVENT_ID, [person('Zoe')]);
    await ok(adminAuthClient.from('place_assignments').insert([
      { place_id: ids['Lit 1'], attendee_id: await attendeeOf(party.id) },
      { place_id: ids['Lit 1'], attendee_id: await attendeeOf(twin.id) }
    ]));
    await ok(adminAuthClient.from('event_place_overrides').insert([
      { event_id: EVENT_ID, place_id: ids['Lit 2'], is_excluded: false, capacity: 4 },
      { event_id: EVENT_ID, place_id: ids.Sofa, is_excluded: true, capacity: null },
      { event_id: SAME_VENUE_EVENT_ID, place_id: ids.Matelas, is_excluded: true, capacity: null }
    ]));

    const byLabel = Object.fromEntries((await ok(eventPlaces(adminAuthClient))).map(row => [row.label, row]));
    expect(byLabel['Lit 1']).toMatchObject({ venue_capacity: 2, capacity: 2, is_excluded: false, occupants: ['Ann'], location_name: 'Chambre A' });
    expect(byLabel['Lit 2']).toMatchObject({ venue_capacity: 2, capacity: 4, is_excluded: false, occupants: [] });
    expect(byLabel.Sofa).toMatchObject({ is_excluded: true });
    expect(byLabel.Matelas).toMatchObject({ is_excluded: false, capacity: 3 });
  });

  test('a member reads no event places and sets no override; anon runs none of the three', async () => {
    // #217: event places are for the edition's team (Comité and above); overrides stay admin-only.
    const memberRead = await eventPlaces(memberClient);
    expect(memberRead.error?.message).toBe('committee_only');
    const memberWrite = await setOverride(memberClient, ids['Lit 1'], true, null);
    expect(memberWrite.error?.message).toBe('admin_only');
    expect(await overrideRows()).toEqual([]);

    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    for (const [fn, args] of [
      ['venue_layout', { p_venue_id: venueId }],
      ['event_places', { p_event_id: EVENT_ID }],
      ['set_place_override', { p_event_id: EVENT_ID, p_place_id: ids['Lit 1'], p_is_excluded: true, p_capacity: null }]
    ]) {
      expect((await anonClient.rpc(fn, args)).error).not.toBeNull();
    }
  });

  test("set_place_override writes the whole state, keeps no row that changes nothing, returns the place", async () => {
    // The place's own capacity is no override.
    expect(await ok(setOverride(adminAuthClient, ids['Lit 1'], false, 2))).toHaveLength(1);
    expect(await overrideRows()).toEqual([]);

    const [resized] = await ok(setOverride(adminAuthClient, ids['Lit 1'], false, 3));
    expect(await overrideRows()).toEqual([{ place_id: ids['Lit 1'], is_excluded: false, capacity: 3 }]);
    const [listed] = (await ok(eventPlaces(adminAuthClient))).filter(row => row.place_id === ids['Lit 1']);
    expect(resized).toEqual(listed);

    // Same state twice: same row.
    await ok(setOverride(adminAuthClient, ids['Lit 1'], true, 3));
    await ok(setOverride(adminAuthClient, ids['Lit 1'], true, 3));
    expect(await overrideRows()).toEqual([{ place_id: ids['Lit 1'], is_excluded: true, capacity: 3 }]);

    const [back] = await ok(setOverride(adminAuthClient, ids['Lit 1'], false, null));
    expect(await overrideRows()).toEqual([]);
    expect(back).toMatchObject({ capacity: 2, is_excluded: false });
  });

  test("set_place_override refuses an occupied place's exclusion and another venue's place", async () => {
    const party = await saveOk(adminAuthClient, EVENT_ID, [person('Ann')]);
    await ok(adminAuthClient.from('place_assignments').insert({ place_id: ids['Lit 1'], attendee_id: await attendeeOf(party.id) }));

    expect((await setOverride(adminAuthClient, ids['Lit 1'], true, null)).error?.message).toBe('place_exclusion_occupied');
    expect((await setOverride(adminAuthClient, ids.Loin, true, null)).error?.message).toBe('place_override_wrong_venue');
    expect(await overrideRows()).toEqual([]);
  });

  test('deleting a place someone holds, or its location, raises place_in_use (#198)', async () => {
    const party = await saveOk(adminAuthClient, EVENT_ID, [person('Ann')]);
    await ok(adminAuthClient.from('place_assignments').insert({ place_id: ids['Lit 1'], attendee_id: await attendeeOf(party.id) }));

    const placeDelete = await adminAuthClient.from('places').delete().eq('id', ids['Lit 1']);
    expect(placeDelete.error?.message).toBe('place_in_use');
    const locationDelete = await adminAuthClient.from('locations').delete().eq('id', ids['Chambre A']);
    expect(locationDelete.error?.message).toBe('place_in_use');
    // A free place still goes.
    expect((await adminAuthClient.from('places').delete().eq('id', ids.Matelas)).error).toBeNull();
  });

  test('activating a second event raises event_already_active (#198)', async () => {
    try {
      await ok(adminAuthClient.from('events').update({ is_active: false }).eq('is_active', true));
      await ok(adminAuthClient.from('events').update({ is_active: true }).eq('id', EVENT_ID));
      const second = await adminAuthClient.from('events').update({ is_active: true }).eq('id', SAME_VENUE_EVENT_ID);
      expect(second.error?.message).toBe('event_already_active');
      // Re-saving the active one is not a second.
      expect((await adminAuthClient.from('events').update({ is_active: true }).eq('id', EVENT_ID)).error).toBeNull();
    } finally {
      await adminAuthClient.from('events').update({ is_active: false }).in('id', EVENT_IDS);
    }
  });

  test("an archived event's settings can't change, even by a write that would change nothing", async () => {
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', EVENT_ID));
    // Archiving moved the event onto a frozen copy of the venue; it reads the same.
    const places = await ok(eventPlaces(adminAuthClient));
    expect(places.map(row => row.label)).toEqual(['Lit 1', 'Lit 2', 'Sofa', 'Matelas']);

    for (const [isExcluded, capacity] of [[true, null], [false, null]]) {
      const { error } = await setOverride(adminAuthClient, places[0].place_id, isExcluded, capacity);
      expect(error?.message).toBe('event_layout_frozen');
    }
  });
});

describe('🪜 edition roles: member < Comité < Organisateur < admin (#217, ADR 0023)', () => {
  jest.setTimeout(60000);

  const EVENT_A = 'a0000000-a000-a000-a000-a00000002171';
  const EVENT_B = 'a0000000-a000-a000-a000-a00000002172';
  const EVENT_IDS = [EVENT_A, EVENT_B];
  const MEMBER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
  const COMMITTEE_ID = '00000000-0000-0000-0000-000000000003';
  const ORGANISER_ID = '00000000-0000-0000-0000-000000000004';
  // `otherCommittee` is Comité of edition B only: a role on one edition gives nothing on another.
  const ROLES = ['member', 'committee', 'organiser', 'admin', 'otherCommittee'];
  const only = (...allowed) => Object.fromEntries(ROLES.map(role => [role, allowed.includes(role)]));
  const TEAM_A = only('committee', 'organiser', 'admin');
  const ORGANISERS_A = only('organiser', 'admin');
  const ADMIN = only('admin');
  const NOBODY = only();

  const ok = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  const person = (name, extra = {}) => ({ name, type: 'Adult', participation: 'Whole', ...extra });

  const clients = {};
  const throwaway = {};
  let admin;
  let venueId;
  let placeId;
  let partyA;
  let partyB;
  let attendeeA;
  let attendeeB;
  let venueB;
  let placeB; // at B's venue, which A doesn't use

  const createUser = async (label) => {
    const email = `rls-217-${label}-${Date.now()}@test.local`;
    const { data, error } = await adminClient.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
    if (error) throw error;
    return { id: data.user.id, email };
  };

  beforeAll(async () => {
    admin = await signIn('admin@test.local');
    clients.admin = admin;
    clients.member = await signIn('member@test.local');
    clients.committee = await signIn('committee@test.local');
    clients.organiser = await signIn('organiser@test.local');
    for (const label of ['registrantA', 'registrantB', 'otherCommittee']) throwaway[label] = await createUser(label);
    clients.otherCommittee = await signIn(throwaway.otherCommittee.email);

    await ok(admin.from('events').upsert([
      { id: EVENT_A, theme: 'Roles A', status: 'ACTIVE', is_active: false, selling_price_whole_event: 100, ratio_main_whole: 0.5375 },
      { id: EVENT_B, theme: 'Roles B', status: 'ACTIVE', is_active: false, selling_price_whole_event: 100, ratio_main_whole: 0.5375 }
    ]));
    venueId = (await ok(admin.from('venues').insert({ name: 'Roles venue' }).select('id').single())).id;
    // Each edition at its own venue.
    venueB = (await ok(admin.from('venues').insert({ name: 'Roles venue B' }).select('id').single())).id;
    await ok(admin.from('events').update({ venue_id: venueId }).eq('id', EVENT_A));
    await ok(admin.from('events').update({ venue_id: venueB }).eq('id', EVENT_B));
    const location = await ok(admin.from('locations').insert({ venue_id: venueId, name: 'Dortoir' }).select('id').single());
    placeId = (await ok(admin.from('places').insert({ location_id: location.id, label: 'Lit', type: 'bed', capacity: 2 }).select('id').single())).id;

    partyA = (await saveOk(admin, EVENT_A, [person('Ann')], { userId: throwaway.registrantA.id })).id;
    partyB = (await saveOk(admin, EVENT_B, [person('Bea')], { userId: throwaway.registrantB.id })).id;
    attendeeA = (await ok(admin.from('attendees').select('id').eq('party_id', partyA).single())).id;
    attendeeB = (await ok(admin.from('attendees').select('id').eq('party_id', partyB).single())).id;
    const locationB = await ok(admin.from('locations').insert({ venue_id: venueB, name: 'Ailleurs' }).select('id').single());
    placeB = (await ok(admin.from('places').insert({ location_id: locationB.id, label: 'Loin', type: 'bed', capacity: 2 }).select('id').single())).id;
    // Each venue's assignments gallery (#177), and an email about each party (#93).
    for (const venue of [venueId, venueB]) {
      await ok(admin.rpc('add_gallery_image', { p_path: `rls-217/${venue}.png`, p_venue_id: venue, p_kind: 'assignments' }));
    }
    await ok(adminClient.from('email_log').upsert([partyA, partyB].map(party_id => ({ party_id, template: 'payment', status: 'failed' })),
      { onConflict: 'party_id,template' }));
    await ok(admin.from('event_budgets').upsert(EVENT_IDS.map(event_id => ({ event_id, lines: [{ category: 'Food', amount: 100 }] }))));
    // The organisers' notes on each party (#227).
    await ok(admin.from('party_admin_notes').upsert([partyA, partyB].map(party_id => ({ party_id, notes: 'Seeded' }))));

    for (const [eventId, userId, role] of [
      [EVENT_A, COMMITTEE_ID, 'committee'],
      [EVENT_A, ORGANISER_ID, 'organiser'],
      [EVENT_B, throwaway.otherCommittee.id, 'committee']
    ]) {
      await ok(admin.rpc('set_edition_role', { p_event_id: eventId, p_user_id: userId, p_role: role }));
    }
  });

  afterAll(async () => {
    await admin.from('edition_roles').delete().in('event_id', EVENT_IDS);
    await admin.from('user_parties').delete().in('event_id', EVENT_IDS);
    await admin.from('event_budgets').delete().in('event_id', EVENT_IDS);
    await admin.from('galleries').delete().in('venue_id', [venueId, venueB]);
    await admin.from('events').update({ venue_id: null, status: 'DRAFT' }).in('id', EVENT_IDS);
    for (const user of Object.values(throwaway)) await adminClient.auth.admin.deleteUser(user.id);
  });

  test('edition_role() names each rung, per edition', async () => {
    const roleOn = async (client, eventId) => ok(client.rpc('edition_role', { p_event_id: eventId }));
    const onA = {};
    const onB = {};
    for (const role of ROLES) {
      onA[role] = await roleOn(clients[role], EVENT_A);
      onB[role] = await roleOn(clients[role], EVENT_B);
    }
    expect(onA).toEqual({ member: null, committee: 'committee', organiser: 'organiser', admin: 'admin', otherCommittee: null });
    expect(onB).toEqual({ member: null, committee: null, organiser: null, admin: 'admin', otherCommittee: 'committee' });
    expect((await createClient(SUPABASE_URL, ANON_KEY).rpc('edition_role', { p_event_id: EVENT_A })).error).not.toBeNull();
  });

  // Each row: what is read, the query, and who sees it.
  const READS = [
    ["edition A's party", c => c.from('user_parties').select('id').eq('id', partyA), TEAM_A],
    ['its attendees', c => c.from('attendees').select('id').eq('party_id', partyA), TEAM_A],
    ["its registrant's profile", c => c.from('profiles').select('id').eq('id', throwaway.registrantA.id), TEAM_A],
    ['its change history', c => c.from('registration_edits').select('id').eq('registration_id', partyA), TEAM_A],
    ['its places (event_places)', c => c.rpc('event_places', { p_event_id: EVENT_A }), TEAM_A],
    ['its budget', c => c.from('event_budgets').select('event_id').eq('event_id', EVENT_A), ORGANISERS_A],
    ['its role log', c => c.from('edition_role_log').select('id').eq('event_id', EVENT_A), ADMIN],
    ["edition B's party", c => c.from('user_parties').select('id').eq('id', partyB), only('admin', 'otherCommittee')],
    ["edition B's registrant's profile", c => c.from('profiles').select('id').eq('id', throwaway.registrantB.id), only('admin', 'otherCommittee')],
    ["edition B's budget", c => c.from('event_budgets').select('event_id').eq('event_id', EVENT_B), ADMIN],
    ["its party's notes (#227)", c => c.from('party_admin_notes').select('party_id').eq('party_id', partyA), TEAM_A],
    ["its party's notes, embedded", c => c.from('user_parties').select('id, note:party_admin_notes!inner(notes)').eq('id', partyA), TEAM_A],
    ["edition B's party's notes", c => c.from('party_admin_notes').select('party_id').eq('party_id', partyB), only('admin', 'otherCommittee')],
    ["A's venue assignments gallery", c => c.from('galleries').select('id').eq('venue_id', venueId).eq('kind', 'assignments'), TEAM_A],
    ['its images', c => c.from('gallery_images').select('id, gallery:galleries!inner(venue_id, kind)')
      .eq('gallery.venue_id', venueId).eq('gallery.kind', 'assignments'), TEAM_A],
    ["B's venue assignments gallery", c => c.from('galleries').select('id').eq('venue_id', venueB).eq('kind', 'assignments'), only('admin', 'otherCommittee')],
    ["A's email log", c => c.from('email_log').select('id').eq('party_id', partyA), ORGANISERS_A],
    ["B's email log", c => c.from('email_log').select('id').eq('party_id', partyB), ADMIN],
    ["someone's role on B (their own for otherCommittee)", c => c.from('edition_roles').select('user_id').eq('event_id', EVENT_B), only('admin', 'otherCommittee')]
  ];

  test.each(READS)('reads %s', async (_label, query, expected) => {
    const seen = {};
    for (const role of ROLES) {
      const { data, error } = await query(clients[role]);
      seen[role] = !error && (data?.length ?? 0) > 0;
    }
    expect(seen).toEqual(expected);
  });

  // The party, with its notes (#227: in party_admin_notes) as admin_notes.
  const partyRow = async (id = partyA) => {
    const { note, ...row } = await ok(admin.from('user_parties').select('*, note:party_admin_notes(notes)').eq('id', id).single());
    return { ...row, admin_notes: note?.notes ?? null };
  };
  const resetParty = async (id = partyA) => {
    await ok(admin.from('user_parties').update({ payment_status: 'unpaid', music_requests: null }).eq('id', id));
    await ok(admin.from('party_admin_notes').upsert({ party_id: id, notes: 'Seeded' }));
  };
  const attendeeName = async () => (await ok(admin.from('attendees').select('name').eq('id', attendeeA).single())).name;

  // Each row: the write, whether it landed (read as the admin), how to undo it, and who may.
  const WRITES = [
    ['payment status through set_payment_status()',
      c => c.rpc('set_payment_status', { p_party_id: partyA, p_payment_status: 'paid' }),
      async () => (await partyRow()).payment_status === 'paid', () => resetParty(), ORGANISERS_A],
    ['payment status by a direct update',
      c => c.from('user_parties').update({ payment_status: 'paid' }).eq('id', partyA),
      async () => (await partyRow()).payment_status === 'paid', () => resetParty(), ADMIN],
    ['notes by a direct update of party_admin_notes (#227)',
      c => c.from('party_admin_notes').update({ notes: 'direct' }).eq('party_id', partyA),
      async () => (await partyRow()).admin_notes === 'direct', () => resetParty(), ORGANISERS_A],
    ['notes by a direct insert into party_admin_notes',
      async c => { await admin.from('party_admin_notes').delete().eq('party_id', partyA); return c.from('party_admin_notes').insert({ party_id: partyA, notes: 'direct' }); },
      async () => (await partyRow()).admin_notes === 'direct', () => resetParty(), ORGANISERS_A],
    ['notes by a direct delete from party_admin_notes',
      async c => { await resetParty(); return c.from('party_admin_notes').delete().eq('party_id', partyA); },
      async () => (await partyRow()).admin_notes === null, () => resetParty(), ORGANISERS_A],
    ["edition B's notes by a direct update",
      c => c.from('party_admin_notes').update({ notes: 'direct' }).eq('party_id', partyB),
      async () => (await partyRow(partyB)).admin_notes === 'direct', () => resetParty(partyB), ADMIN],
    ['any other party column by a direct update',
      c => c.from('user_parties').update({ music_requests: 'direct' }).eq('id', partyA),
      async () => (await partyRow()).music_requests === 'direct', () => resetParty(), ADMIN],
    ['notes through save_logistics()',
      c => c.rpc('save_logistics', { p_changes: [{ party_id: partyA, admin_notes: 'logistics' }] }),
      async () => (await partyRow()).admin_notes === 'logistics', () => resetParty(), ORGANISERS_A],
    ['a place through save_logistics()',
      c => c.rpc('save_logistics', { p_changes: [{ party_id: partyA, places: { [attendeeA]: placeId } }] }),
      async () => (await ok(admin.from('place_assignments').select('attendee_id').eq('attendee_id', attendeeA))).length > 0,
      () => ok(admin.from('place_assignments').delete().eq('attendee_id', attendeeA)), ORGANISERS_A],
    ['a place by a direct insert',
      c => c.from('place_assignments').insert({ attendee_id: attendeeA, place_id: placeId }),
      async () => (await ok(admin.from('place_assignments').select('attendee_id').eq('attendee_id', attendeeA))).length > 0,
      () => ok(admin.from('place_assignments').delete().eq('attendee_id', attendeeA)), ADMIN],
    ["edition B's notes through save_logistics()",
      c => c.rpc('save_logistics', { p_changes: [{ party_id: partyB, admin_notes: 'logistics' }] }),
      async () => (await partyRow(partyB)).admin_notes === 'logistics', () => resetParty(partyB), ADMIN],
    ["edition B's payment status through set_payment_status()",
      c => c.rpc('set_payment_status', { p_party_id: partyB, p_payment_status: 'paid' }),
      async () => (await partyRow(partyB)).payment_status === 'paid', () => resetParty(partyB), ADMIN],
    ['the budget',
      c => c.from('event_budgets').upsert({ event_id: EVENT_A, lines: [{ category: 'Food', amount: 999 }] }),
      async () => Number((await ok(admin.from('event_budgets').select('total_cost').eq('event_id', EVENT_A).single())).total_cost) === 999,
      () => ok(admin.from('event_budgets').update({ lines: [{ category: 'Food', amount: 100 }] }).eq('event_id', EVENT_A)), ORGANISERS_A],
    ["edition B's budget",
      c => c.from('event_budgets').upsert({ event_id: EVENT_B, lines: [{ category: 'Food', amount: 999 }] }),
      async () => Number((await ok(admin.from('event_budgets').select('total_cost').eq('event_id', EVENT_B).single())).total_cost) === 999,
      () => ok(admin.from('event_budgets').update({ lines: [{ category: 'Food', amount: 100 }] }).eq('event_id', EVENT_B)), ADMIN],
    ['the pricing through apply_event_pricing()',
      c => c.rpc('apply_event_pricing', { p_event_id: EVENT_A, p_selling_price_whole_event: 321, p_ratio_main_whole: 0.6 }),
      async () => Number((await ok(admin.from('events').select('selling_price_whole_event').eq('id', EVENT_A).single())).selling_price_whole_event) === 321,
      () => ok(admin.from('events').update({ selling_price_whole_event: 100, ratio_main_whole: 0.5375 }).eq('id', EVENT_A)), ORGANISERS_A],
    ['the pricing by a direct update of the event',
      c => c.from('events').update({ selling_price_whole_event: 321 }).eq('id', EVENT_A),
      async () => Number((await ok(admin.from('events').select('selling_price_whole_event').eq('id', EVENT_A).single())).selling_price_whole_event) === 321,
      () => ok(admin.from('events').update({ selling_price_whole_event: 100 }).eq('id', EVENT_A)), ADMIN],
    ["an image in A's venue assignments gallery",
      c => c.rpc('add_gallery_image', { p_path: 'rls-217/extra.png', p_venue_id: venueId, p_kind: 'assignments' }),
      async () => (await ok(admin.from('gallery_images').select('id').eq('path', 'rls-217/extra.png'))).length > 0,
      () => ok(admin.from('gallery_images').delete().eq('path', 'rls-217/extra.png')), ADMIN],
    ['the event',
      c => c.from('events').update({ theme: 'Renamed' }).eq('id', EVENT_A),
      async () => (await ok(admin.from('events').select('theme').eq('id', EVENT_A).single())).theme === 'Renamed',
      () => ok(admin.from('events').update({ theme: 'Roles A' }).eq('id', EVENT_A)), ADMIN],
    ['the venue',
      c => c.from('venues').update({ name: 'Renamed' }).eq('id', venueId),
      async () => (await ok(admin.from('venues').select('name').eq('id', venueId).single())).name === 'Renamed',
      () => ok(admin.from('venues').update({ name: 'Roles venue' }).eq('id', venueId)), ADMIN],
    ["someone else's registration through save_registration()",
      c => save(c, EVENT_A, [person('Hacked', { id: attendeeA })], { userId: throwaway.registrantA.id }),
      async () => (await attendeeName()) === 'Hacked',
      () => saveOk(admin, EVENT_A, [person('Ann', { id: attendeeA })], { userId: throwaway.registrantA.id }), ADMIN],
    ['an attendee by a direct update',
      c => c.from('attendees').update({ name: 'Direct' }).eq('id', attendeeA),
      async () => (await attendeeName()) === 'Direct', async () => {}, NOBODY],
    ['a role through set_edition_role()',
      c => c.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: MEMBER_ID, p_role: 'organiser' }),
      async () => (await ok(admin.from('edition_roles').select('role').eq('event_id', EVENT_A).eq('user_id', MEMBER_ID))).length > 0,
      () => ok(admin.from('edition_roles').delete().eq('event_id', EVENT_A).eq('user_id', MEMBER_ID)), ADMIN],
    ['a role by a direct insert',
      c => c.from('edition_roles').insert({ event_id: EVENT_A, user_id: MEMBER_ID, role: 'organiser' }),
      async () => (await ok(admin.from('edition_roles').select('role').eq('event_id', EVENT_A).eq('user_id', MEMBER_ID))).length > 0,
      () => ok(admin.from('edition_roles').delete().eq('event_id', EVENT_A).eq('user_id', MEMBER_ID)), ADMIN],
    ["one's own role, upwards",
      c => c.from('edition_roles').update({ role: 'organiser' }).eq('event_id', EVENT_A).eq('user_id', COMMITTEE_ID),
      async () => (await ok(admin.from('edition_roles').select('role').eq('event_id', EVENT_A).eq('user_id', COMMITTEE_ID).single())).role === 'organiser',
      () => ok(admin.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: COMMITTEE_ID, p_role: 'committee' })), ADMIN]
  ];

  test.each(WRITES)('writes %s', async (_label, attempt, landed, undo, expected) => {
    const wrote = {};
    for (const role of ROLES) {
      await attempt(clients[role]);
      wrote[role] = await landed();
      if (wrote[role]) await undo();
    }
    expect(wrote).toEqual(expected);
  });

  test('the role functions refuse with their codes', async () => {
    const savePayment = (client, partyId) => client.rpc('set_payment_status', { p_party_id: partyId, p_payment_status: 'paid' });
    expect((await savePayment(clients.committee, partyA)).error?.message).toBe('organiser_only');
    expect((await savePayment(clients.organiser, partyB)).error?.message).toBe('organiser_only');
    expect((await clients.organiser.rpc('set_payment_status', { p_party_id: partyA, p_payment_status: 'refunded' })).error?.message).toBe('payment_status_invalid');
    expect((await clients.member.rpc('save_logistics', { p_changes: [] })).error?.message).toBe('organiser_only');
    expect((await clients.committee.rpc('save_logistics', { p_changes: [] })).error?.message).toBe('organiser_only');
    // An organiser of A gets B's party back as not saved, with its code.
    const [failed] = await ok(clients.organiser.rpc('save_logistics', { p_changes: [{ party_id: partyB, admin_notes: 'x' }] }));
    expect(failed).toMatchObject({ party_id: partyB, message: 'organiser_only' });
    expect((await clients.committee.rpc('apply_event_pricing', { p_event_id: EVENT_A, p_selling_price_whole_event: 1, p_ratio_main_whole: 0.5 })).error?.message).toBe('organiser_only');
    expect((await clients.otherCommittee.rpc('event_places', { p_event_id: EVENT_A })).error?.message).toBe('committee_only');
    expect((await clients.organiser.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: MEMBER_ID, p_role: 'committee' })).error?.message).toBe('admin_only');
    expect((await admin.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: MEMBER_ID, p_role: 'boss' })).error?.message).toBe('edition_role_invalid');
    expect((await admin.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: ADMIN_ID, p_role: 'committee' })).error?.message).toBe('edition_role_target_admin');
  });

  // save_logistics() is SECURITY DEFINER: past the role check on the party's event, only these
  // checks keep its places payload inside that party and that edition's venue. Same for an admin.
  test.each(['organiser', 'admin'])("save_logistics' places payload stays in its party and its edition's venue (%s)", async (role) => {
    const client = clients[role];
    const assignmentOf = async (attendeeId) =>
      (await ok(admin.from('place_assignments').select('place_id').eq('attendee_id', attendeeId))).map(row => row.place_id);
    const saveOn = async (partyId, places) => ok(client.rpc('save_logistics', { p_changes: [{ party_id: partyId, places }] }));
    try {
      await ok(admin.from('place_assignments').insert({ attendee_id: attendeeB, place_id: placeB }));

      // B's attendee through A's party: refused, and B keeps its place.
      expect(await saveOn(partyA, { [attendeeB]: null })).toEqual([expect.objectContaining({ party_id: partyA, message: 'logistics_attendee_not_in_party' })]);
      expect(await saveOn(partyA, { [attendeeB]: placeId })).toEqual([expect.objectContaining({ message: 'logistics_attendee_not_in_party' })]);
      expect(await assignmentOf(attendeeB)).toEqual([placeB]);

      // A place of another venue (B's): refused.
      expect(await saveOn(partyA, { [attendeeA]: placeB })).toEqual([expect.objectContaining({ message: 'place_assignment_wrong_event' })]);
      expect(await assignmentOf(attendeeA)).toEqual([]);

      // A cancelled party gets no place, for an admin as for an organiser.
      await ok(admin.from('user_parties').update({ status: 'cancelled' }).eq('id', partyA));
      expect(await saveOn(partyA, { [attendeeA]: placeId })).toEqual([expect.objectContaining({ message: 'place_assignment_party_inactive' })]);
      expect(await assignmentOf(attendeeA)).toEqual([]);
    } finally {
      await ok(admin.from('place_assignments').delete().in('attendee_id', [attendeeA, attendeeB]));
      await ok(admin.from('user_parties').update({ status: 'registered' }).eq('id', partyA));
    }
  });

  test('an organiser saves a payment and a place; both show in the change history with their author', async () => {
    try {
      await ok(clients.organiser.rpc('set_payment_status', { p_party_id: partyA, p_payment_status: 'paid' }));
      expect(await ok(clients.organiser.rpc('save_logistics', {
        p_changes: [{ party_id: partyA, admin_notes: 'Note', places: { [attendeeA]: placeId } }]
      }))).toEqual([]);
      const edits = await ok(clients.organiser.from('registration_edits').select('edited_by, changes')
        .eq('registration_id', partyA).order('edited_at', { ascending: false }).limit(2));
      expect(edits.map(edit => edit.edited_by)).toEqual([ORGANISER_ID, ORGANISER_ID]);
      // The place goes in the notes' entry (#188).
      expect(edits.map(edit => Object.keys(edit.changes)).flat().sort()).toEqual(['admin_notes', 'payment_status', 'places']);
      // The author's name is readable to the edition's team.
      expect(await ok(clients.committee.from('profiles').select('id').eq('id', ORGANISER_ID))).toHaveLength(1);
    } finally {
      await ok(admin.from('place_assignments').delete().eq('attendee_id', attendeeA));
      await resetParty();
    }
  });

  test('every grant, change and removal is logged with its author', async () => {
    const before = (await ok(admin.from('edition_role_log').select('id').eq('event_id', EVENT_B).eq('user_id', MEMBER_ID))).length;
    for (const role of ['committee', 'committee', 'organiser', null]) {
      await ok(admin.rpc('set_edition_role', { p_event_id: EVENT_B, p_user_id: MEMBER_ID, p_role: role }));
    }
    const log = await ok(admin.from('edition_role_log').select('actor_id, old_role, new_role')
      .eq('event_id', EVENT_B).eq('user_id', MEMBER_ID).order('id'));
    // Granting the role someone already has changes nothing, and logs nothing.
    expect(log.slice(before)).toEqual([
      { actor_id: ADMIN_ID, old_role: null, new_role: 'committee' },
      { actor_id: ADMIN_ID, old_role: 'committee', new_role: 'organiser' },
      { actor_id: ADMIN_ID, old_role: 'organiser', new_role: null }
    ]);
  });

  test('becoming an admin, or deleting the account, removes the edition roles', async () => {
    const promoted = await createUser('promoted');
    const leaving = await createUser('leaving');
    try {
      for (const user of [promoted, leaving]) {
        await ok(admin.rpc('set_edition_role', { p_event_id: EVENT_A, p_user_id: user.id, p_role: 'organiser' }));
      }
      await ok(admin.rpc('admin_set_is_admin', { target_user_id: promoted.id, new_is_admin: true }));
      const leavingClient = await signIn(leaving.email);
      await ok(leavingClient.rpc('delete_my_account'));

      const rows = await ok(admin.from('edition_roles').select('user_id').in('user_id', [promoted.id, leaving.id]));
      expect(rows).toEqual([]);
      const removals = await ok(admin.from('edition_role_log').select('user_id, new_role')
        .in('user_id', [promoted.id, leaving.id]).is('new_role', null));
      expect(removals).toHaveLength(2);
      // A deleted account has no role left to use either.
      expect(await ok(leavingClient.rpc('edition_role', { p_event_id: EVENT_A }))).toBeNull();
    } finally {
      for (const user of [promoted, leaving]) await adminClient.auth.admin.deleteUser(user.id);
    }
  });
});

// #188: save_logistics() and a venue change log place assignments in registration_edits, as
// changes.places = { old, new } with the labels of the time; the admin authors them.
describe('📜 place assignment history (#188)', () => {
  jest.setTimeout(30000);

  const EVENT_ID = 'a0000000-a000-a000-a000-a00000001881';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
  const person = (name) => ({ name, type: 'Adult', participation: 'Whole' });

  let memberClient;
  let adminAuthClient;
  let venueId; // a fresh venue per test: venues are never deleted
  let places; // "<location> · <place>" → id
  let memberParty;
  let adminParty;
  let who; // attendee name → id

  const ok = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  const saveLogistics = (changes) => adminAuthClient.rpc('save_logistics', { p_changes: changes });
  const savedAll = async (changes) => expect(await saveLogistics(changes)).toMatchObject({ data: [], error: null });
  // The party's history rows that log places, oldest first.
  const placeRows = async (partyId, client = adminAuthClient) => (await ok(client.from('registration_edits')
    .select('edited_by, edited_at, changes').eq('registration_id', partyId).order('edited_at')))
    .filter(row => row.changes && 'places' in row.changes);
  const entry = (name, label) => ({
    attendee_id: who[name], attendee_name: name, place_id: label ? places[label] : null, label: label ?? null
  });

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
    // Un-archive (allowed by SQL) so the event can go on today's venue.
    await ok(adminAuthClient.from('events').upsert({
      id: EVENT_ID, theme: 'Place History', status: 'ACTIVE', event_start_date: startsIn(60), selling_price_whole_event: 100
    }));
    venueId = (await ok(adminAuthClient.from('venues').insert({ name: 'La Ferme' }).select('id').single())).id;
    await ok(adminAuthClient.from('events').update({ venue_id: venueId }).eq('id', EVENT_ID));
    const locations = await ok(adminAuthClient.from('locations').insert([
      { venue_id: venueId, name: 'Grange' }, { venue_id: venueId, name: 'Maison' }
    ]).select('id, name'));
    const locationId = Object.fromEntries(locations.map(row => [row.name, row.id]));
    const rows = await ok(adminAuthClient.from('places').insert([
      { location_id: locationId.Grange, label: 'Lit 3', type: 'bed', capacity: 2 },
      { location_id: locationId.Grange, label: 'Lit 4', type: 'bed', capacity: 1 },
      { location_id: locationId.Maison, label: 'Sofa', type: 'sofa', capacity: 1 }
    ]).select('id, label, location:locations(name)'));
    places = Object.fromEntries(rows.map(row => [`${row.location.name} · ${row.label}`, row.id]));
    memberParty = await saveOk(memberClient, EVENT_ID, [person('Ann'), person('Bob')]);
    adminParty = await saveOk(adminAuthClient, EVENT_ID, [person('Zed')]);
    const attendees = await ok(adminAuthClient.from('attendees').select('id, name').in('party_id', [memberParty.id, adminParty.id]));
    who = Object.fromEntries(attendees.map(row => [row.name, row.id]));
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('event_id', EVENT_ID);
    await adminAuthClient.from('events').update({ venue_id: null, status: 'DRAFT' }).eq('id', EVENT_ID);
  });

  test('an assign, a move and an unassign each log the attendees whose place changed, with labels', async () => {
    await savedAll([{ party_id: memberParty.id, places: { [who.Ann]: places['Grange · Lit 3'], [who.Bob]: places['Grange · Lit 3'] } }]);
    // Bob is sent again, unchanged: only Ann is logged.
    await savedAll([{ party_id: memberParty.id, places: { [who.Ann]: places['Maison · Sofa'], [who.Bob]: places['Grange · Lit 3'] } }]);
    await savedAll([{ party_id: memberParty.id, places: { [who.Ann]: null } }]);
    // Nothing changes: nothing is logged.
    await savedAll([{ party_id: memberParty.id, places: { [who.Bob]: places['Grange · Lit 3'] } }]);

    const rows = await placeRows(memberParty.id);
    expect(rows.map(row => row.changes)).toEqual([
      { places: { old: [entry('Ann', null), entry('Bob', null)], new: [entry('Ann', 'Grange · Lit 3'), entry('Bob', 'Grange · Lit 3')] } },
      { places: { old: [entry('Ann', 'Grange · Lit 3')], new: [entry('Ann', 'Maison · Sofa')] } },
      { places: { old: [entry('Ann', 'Maison · Sofa')], new: [entry('Ann', null)] } }
    ]);
    expect(rows.every(row => row.edited_by === ADMIN_ID)).toBe(true);

    // The label is the one of the time: a later rename doesn't rewrite the history.
    await ok(adminAuthClient.from('places').update({ label: 'Grand lit' }).eq('id', places['Grange · Lit 3']));
    expect((await placeRows(memberParty.id))[0].changes.places.new[1].label).toBe('Grange · Lit 3');
  });

  test('a batch logs only the parties it saved', async () => {
    await ok(adminAuthClient.rpc('set_place_override', {
      p_event_id: EVENT_ID, p_place_id: places['Grange · Lit 4'], p_is_excluded: true, p_capacity: null
    }));
    const { data: failed, error } = await saveLogistics([
      { party_id: memberParty.id, places: { [who.Ann]: places['Grange · Lit 3'] } },
      { party_id: adminParty.id, admin_notes: 'Refusé', places: { [who.Zed]: places['Grange · Lit 4'] } }
    ]);
    expect(error).toBeNull();
    expect(failed).toMatchObject([{ party_id: adminParty.id, message: 'place_assignment_place_excluded' }]);

    expect((await placeRows(memberParty.id)).map(row => row.changes))
      .toEqual([{ places: { old: [entry('Ann', null)], new: [entry('Ann', 'Grange · Lit 3')] } }]);
    const adminRows = await ok(adminAuthClient.from('registration_edits').select('changes').eq('registration_id', adminParty.id));
    expect(adminRows.map(row => Object.keys(row.changes))).toEqual([['created']]);
  });

  test('notes, message and places of one save are one row', async () => {
    await savedAll([{
      party_id: memberParty.id, admin_notes: 'Allergies', message_to_participants: 'Bienvenue',
      places: { [who.Bob]: places['Maison · Sofa'] }
    }]);
    // A text sent unchanged: the places still get their row, alone.
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Allergies', places: { [who.Bob]: null } }]);
    // Notes and places without a message: still one row (#227: the notes aren't on user_parties).
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Végé', places: { [who.Ann]: places['Grange · Lit 4'] } }]);

    const rows = await ok(adminAuthClient.from('registration_edits').select('changes, edited_by')
      .eq('registration_id', memberParty.id).order('edited_at'));
    expect(rows.slice(1)).toEqual([
      {
        edited_by: ADMIN_ID,
        changes: {
          admin_notes: { old: null, new: 'Allergies' },
          message_to_participants: { old: null, new: 'Bienvenue' },
          places: { old: [entry('Bob', null)], new: [entry('Bob', 'Maison · Sofa')] }
        }
      },
      { edited_by: ADMIN_ID, changes: { places: { old: [entry('Bob', 'Maison · Sofa')], new: [entry('Bob', null)] } } },
      {
        edited_by: ADMIN_ID,
        changes: {
          admin_notes: { old: 'Allergies', new: 'Végé' },
          places: { old: [entry('Ann', null)], new: [entry('Ann', 'Grange · Lit 4')] }
        }
      }
    ]);
  });

  // #227: the notes' history, with the notes in party_admin_notes.
  const noteRows = async (partyId) => (await ok(adminAuthClient.from('registration_edits')
    .select('changes').eq('registration_id', partyId).order('edited_at')))
    .map(row => row.changes).filter(changes => !('created' in changes));
  const notesOf = async (partyId) => (await ok(adminAuthClient.from('party_admin_notes')
    .select('notes').eq('party_id', partyId).maybeSingle()))?.notes ?? null;

  test('notes alone are one row; unchanged notes, or empty ones over none, are no row (#227)', async () => {
    await savedAll([{ party_id: memberParty.id, admin_notes: '' }]);
    expect(await noteRows(memberParty.id)).toEqual([]);
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Allergies' }]);
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Allergies' }]);
    // The empty notes were stored, as before: they're the old value.
    expect(await noteRows(memberParty.id)).toEqual([{ admin_notes: { old: '', new: 'Allergies' } }]);
  });

  test('a refused party rolls back its notes and their history; the next party\'s entry is its own (#227)', async () => {
    await ok(adminAuthClient.rpc('set_place_override', {
      p_event_id: EVENT_ID, p_place_id: places['Grange · Lit 4'], p_is_excluded: true, p_capacity: null
    }));
    const { data: failed, error } = await saveLogistics([
      { party_id: adminParty.id, admin_notes: 'Refusé', places: { [who.Zed]: places['Grange · Lit 4'] } },
      { party_id: memberParty.id, admin_notes: 'Accepté' }
    ]);
    expect(error).toBeNull();
    expect(failed).toMatchObject([{ party_id: adminParty.id, message: 'place_assignment_place_excluded' }]);
    expect(await notesOf(adminParty.id)).toBeNull();
    expect(await noteRows(adminParty.id)).toEqual([]);
    expect(await noteRows(memberParty.id)).toEqual([{ admin_notes: { old: null, new: 'Accepté' } }]);
  });

  test('a member reads no notes through the embed, for their own party or another\'s (#227)', async () => {
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Sienne' }, { party_id: adminParty.id, admin_notes: 'Autre' }]);
    const rows = await ok(memberClient.from('user_parties').select('id, party_admin_notes(*)').eq('event_id', EVENT_ID));
    expect(rows).toEqual([{ id: memberParty.id, party_admin_notes: null }]);
    const other = await ok(memberClient.from('user_parties').select('id, party_admin_notes(*)').eq('id', adminParty.id));
    expect(other).toEqual([]);
    expect(await ok(memberClient.from('party_admin_notes').select('*'))).toEqual([]);
  });

  test('a member\'s own save logs no notes, and they can\'t set the logistics setting (#227)', async () => {
    await savedAll([{ party_id: memberParty.id, admin_notes: 'Privé' }]);
    const attendees = await ok(adminAuthClient.from('attendees').select('id, name').eq('party_id', memberParty.id).order('position'));
    const { error: setError } = await memberClient.rpc('set_config', {
      setting_name: 'bedaine.logistics_changes', new_value: JSON.stringify({ party_id: memberParty.id, changes: { admin_notes: { old: null, new: 'hax' } } }), is_local: true
    });
    expect(setError).not.toBeNull();
    await saveOk(memberClient, EVENT_ID, [...attendees.map(a => ({ ...person(a.name), id: a.id })), person('Cat')]);
    const rows = await noteRows(memberParty.id);
    expect(rows.filter(changes => 'admin_notes' in changes)).toEqual([{ admin_notes: { old: null, new: 'Privé' } }]);
    expect(rows.at(-1)).toHaveProperty('attendees');
    expect(await notesOf(memberParty.id)).toBe('Privé');
  });

  test('a venue change logs one row per party it clears, with the reason', async () => {
    await savedAll([
      { party_id: memberParty.id, places: { [who.Ann]: places['Grange · Lit 3'], [who.Bob]: places['Maison · Sofa'] } },
      { party_id: adminParty.id, places: { [who.Zed]: places['Grange · Lit 3'] } }
    ]);
    const otherVenue = (await ok(adminAuthClient.from('venues').insert({ name: 'Ailleurs' }).select('id').single())).id;
    await ok(adminAuthClient.from('events').update({ venue_id: otherVenue }).eq('id', EVENT_ID));

    const [, memberCleared] = await placeRows(memberParty.id);
    expect(memberCleared).toMatchObject({ edited_by: ADMIN_ID });
    expect(memberCleared.changes).toEqual({ places: {
      old: [entry('Ann', 'Grange · Lit 3'), entry('Bob', 'Maison · Sofa')],
      new: [entry('Ann', null), entry('Bob', null)],
      reason: 'venue_changed'
    } });
    const adminRows = await placeRows(adminParty.id);
    expect(adminRows).toHaveLength(2);
    expect(adminRows[1].changes.places).toEqual({ old: [entry('Zed', 'Grange · Lit 3')], new: [entry('Zed', null)], reason: 'venue_changed' });
  });

  test('archiving, a cancellation and a removed attendee log no place change', async () => {
    await savedAll([{ party_id: memberParty.id, places: { [who.Ann]: places['Grange · Lit 3'], [who.Bob]: places['Grange · Lit 3'] } }]);
    await savedAll([{ party_id: adminParty.id, places: { [who.Zed]: places['Maison · Sofa'] } }]);

    await saveOk(memberClient, EVENT_ID, [{ ...person('Ann'), id: who.Ann }]); // Bob leaves
    await ok(adminAuthClient.from('user_parties').update({ status: 'cancelled' }).eq('id', adminParty.id));
    await ok(adminAuthClient.from('events').update({ status: 'ARCHIVED' }).eq('id', EVENT_ID));

    expect(await placeRows(memberParty.id)).toHaveLength(1);
    expect(await placeRows(adminParty.id)).toHaveLength(1);
    // Ann still has her place, on the archived copy.
    expect((await ok(adminAuthClient.from('attendee_places').select('bed_label').eq('attendee_id', who.Ann)))
      .map(row => row.bed_label)).toEqual(['Grange · Lit 3']);
  });

  test("the member doesn't read the admin's place rows", async () => {
    await savedAll([{ party_id: memberParty.id, places: { [who.Ann]: places['Grange · Lit 3'] } }]);
    expect(await placeRows(memberParty.id)).toHaveLength(1);
    expect(await placeRows(memberParty.id, memberClient)).toEqual([]);
    // The member still reads the rows they authored.
    expect((await ok(memberClient.from('registration_edits').select('changes').eq('registration_id', memberParty.id)))
      .map(row => Object.keys(row.changes))).toEqual([['created']]);
  });
});

describe('🛏️ a bed reason only goes with « Lit » (#228)', () => {
  jest.setTimeout(30000);

  const REASON_EVENT_ID = 'a0000000-a000-a000-a000-a00000000228';
  const REASON_PARTY_ID = 'a0000000-a000-a000-a000-a00000000229';

  let memberClient;
  let adminAuthClient;

  const attendeesOf = async () => {
    const { data, error } = await adminAuthClient
      .from('attendees')
      .select('sleeping_preference, bed_reason, bed_reason_other')
      .eq('party_id', REASON_PARTY_ID)
      .order('position');
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    memberClient = await signIn('member@test.local');
    adminAuthClient = await signIn('admin@test.local');
    const { error } = await adminAuthClient.from('events').upsert({
      id: REASON_EVENT_ID, theme: 'Bed Reason Test', status: 'ACTIVE', event_start_date: startsIn(60), selling_price_whole_event: 100
    });
    if (error) throw error;
  });

  beforeEach(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', REASON_PARTY_ID);
  });

  afterAll(async () => {
    await adminAuthClient.from('user_parties').delete().eq('id', REASON_PARTY_ID);
  });

  test('save_registration stores no reason for a camping attendee, silently, and keeps it for a bed', async () => {
    await saveOk(memberClient, REASON_EVENT_ID, [
      { type: 'Adult', participation: 'Whole', sleeping_preference: 'camping', bed_reason: 'health', bed_reason_other: 'Dos' },
      { type: 'Adult', participation: 'Whole', sleeping_preference: 'bed', bed_reason: 'health', bed_reason_other: 'Dos' }
    ], { id: REASON_PARTY_ID });
    expect(await attendeesOf()).toEqual([
      { sleeping_preference: 'camping', bed_reason: '', bed_reason_other: '' },
      { sleeping_preference: 'bed', bed_reason: 'health', bed_reason_other: 'Dos' }
    ]);

    // Switching a saved attendee away from a bed clears it on update too.
    const { data } = await adminAuthClient.from('attendees').select('id, position').eq('party_id', REASON_PARTY_ID).order('position');
    await saveOk(memberClient, REASON_EVENT_ID, [
      { id: data[0].id, type: 'Adult', participation: 'Whole', sleeping_preference: 'sofa', bed_reason: 'comfort' },
      { id: data[1].id, type: 'Adult', participation: 'Whole', sleeping_preference: 'sofa', bed_reason: 'comfort' }
    ]);
    expect((await attendeesOf()).map(a => [a.bed_reason, a.bed_reason_other])).toEqual([['', ''], ['', '']]);
  });
});
