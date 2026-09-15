# RLS Policy Testing Framework

## Overview
Automated testing suite for Row Level Security (RLS) policies in the La Bédaine application. Validates that security policies work as expected for profiles, events, user parties, and app feedback tables.

## Prerequisites

1. **Local Supabase Instance**
   ```powershell
   supabase start
   ```

2. **Apply Database Schema**
   ```powershell
   supabase db push
   ```

3. **Environment Configuration**
   - Copy `.env.test.example` to `.env.test`
   - Update with your local Supabase credentials:
     ```env
     VITE_SUPABASE_URL=http://localhost:54321
     VITE_SUPABASE_ANON_KEY=your-anon-key
     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
     ```

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

Test data is seeded automatically using the `seed_test_data()` PostgreSQL function (added to `schema.sql`). This function:

1. Clears existing test data (identified by specific UUIDs)
2. Creates:
   - Regular user (`user@test.com`)
   - Admin user (`admin@test.com`)
   - DRAFT, ACTIVE, and ARCHIVED events
   - User and admin registrations
   - Sample feedback entries

## Adding New Tests

1. Create test file in `src/__tests__/`
2. Use the existing test UUIDs to avoid conflicts
3. Follow the pattern:
   ```javascript
   test('POLICY: Description', async () => {
     const client = createAuthenticatedClient(TEST_UUIDS.USER_ID);
     // Test assertions
   });
   ```

## Troubleshooting

### "SUPABASE_SERVICE_ROLE_KEY is required"
- Get service role key from Supabase dashboard: Settings > API
- Add to `.env.test`

### "seed_test_data function not found"
- Ensure `supabase db push` has been run
- Function is defined at the end of `schema.sql`

### Connection Errors
- Verify Supabase is running: `supabase status`
- Check `.env.test` URLs match local instance

## Continuous Integration

Add to CI pipeline:
```yaml
steps:
  - supabase start
  - supabase db push
  - npm run test:rls
```

## Security Notes

- Test data uses hardcoded UUIDs to avoid production data conflicts
- Service role key bypasses RLS - keep secure
- Tests run against local instance by default
- No production data is modified or deleted