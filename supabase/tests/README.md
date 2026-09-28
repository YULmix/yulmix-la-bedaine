# RLS Policy Testing Framework

## Overview
Automated testing suite for Row Level Security (RLS) policies in the La Bédaine application. Validates that security policies work as expected for profiles, events, user parties, and app feedback tables.

## Prerequisites

1. **Local Supabase Instance**
   ```powershell
   supabase start
   ```

2. **Apply Database Schema**
   `supabase start` applies every file in `supabase/migrations/` to the local database. To rebuild
   it from scratch later:
   ```powershell
   supabase db reset
   ```

3. **Environment Configuration**
   None: `jest.rls.config.js` reads the URL and keys from `supabase status`. A gitignored
   `.env.test` (copied from `.env.test.example`) is only the fallback when that command fails.

## Running Tests

### All RLS Tests
```powershell
npm run test:rls
```

### Specific Test File
```powershell
npm test -- src/__tests__/rlsPolicies.test.js
```

### Individual Test (by name)
```powershell
npm test -- -t "EVENTS: Public can read ACTIVE and ARCHIVED events"
```

## Test Coverage

| Policy Area | Test File | Key Validations |
|-------------|-----------|----------------|
| **Profiles** | `rlsPolicies.test.js` | User reads own profile<br>User cannot read others<br>Admin reads all |
| **Events** | `rlsPolicies.test.js` | Public reads ACTIVE/ARCHIVED<br>User cannot see DRAFT<br>Admin sees DRAFT |
| **User Parties** | `userPartiesPolicies.test.js` | User manages own registration<br>User cannot modify others<br>Admin full access |
| **App Feedback** | `feedbackPolicies.test.js` | User submits feedback<br>User reads own feedback<br>Admin triage access |

## Test Data

Each `describe` block creates the rows it needs in `beforeAll`/`beforeEach` and deletes them
afterwards. It signs in as the seeded `member@test.local` / `admin@test.local` users
(`supabase db reset` creates them) and seeds as the admin: `service_role` can only read `events`.
Check the `error` supabase-js returns when seeding; it doesn't throw.

## Adding New Tests

1. Add a `describe` block to `src/__tests__/rlsPolicies.test.js`, with its own fixed UUIDs for the
   rows it creates, so blocks don't collide.
2. Act as a real role with `signIn('member@test.local')` / `signIn('admin@test.local')`, or an
   anon client for signed-out access:
   ```javascript
   test('POLICY: Description', async () => {
     const member = await signIn('member@test.local');
     const { data, error } = await member.from('events').select('id');
     // Test assertions
   });
   ```

## Troubleshooting

### "SUPABASE_SERVICE_ROLE_KEY is required"
- The local Supabase isn't running: `supabase start`.

### PGRST301 "None of the keys was able to decode the JWT"
- The keys don't match the running instance. `npm run test:rls` takes them from `supabase status`;
  this only happens if that fails and a stale `.env.test` is used instead.

### Connection Errors
- Verify Supabase is running: `supabase status`

## Continuous Integration

Add to CI pipeline:
```yaml
steps:
  - supabase start   # applies supabase/migrations/
  - npm run test:rls
```

## Security Notes

- Test data uses hardcoded UUIDs to avoid production data conflicts
- Service role key bypasses RLS - keep secure
- Tests run against local instance by default
- No production data is modified or deleted