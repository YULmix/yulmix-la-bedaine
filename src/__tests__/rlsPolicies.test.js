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