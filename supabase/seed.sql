-- Local dev/test users. Applied by `supabase db reset` against the local database (see
-- supabase/config.toml [db.seed]), and by `npm run db:preview:reset` against the Preview project
-- (scripts/preview-db.mjs). Never run against production.
--
-- Password for all: "password123"
--
--   member@test.local     — regular member (profiles.is_admin = false)
--   admin@test.local      — admin (profiles.is_admin = true, set explicitly below; this is a
--                            distinct test email, not the real production admin address that
--                            handle_new_user() special-cases)
--   committee@test.local  — a member who gets the Comité edition role (#217, ADR 0023)
--   organiser@test.local  — a member who gets the Organisateur edition role
--
-- Edition roles are per event, and this file creates no event: whoever creates the event grants
-- them (set_edition_role(), as an admin; the e2e specs do it in e2e/support/testData.js).

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'member@test.local',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Test Member"}',
    now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'admin@test.local',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Test Admin"}',
    now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'committee@test.local',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Test Comité"}',
    now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000004',
    'authenticated', 'authenticated',
    'organiser@test.local',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Test Organisateur"}',
    now(), now(),
    '', '', '', ''
  );

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) VALUES
  (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'email', 'member@test.local'),
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'email', 'admin@test.local'),
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000003', 'email', 'committee@test.local'),
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000004', 'email', 'organiser@test.local'),
    'email', now(), now(), now()
  );

-- handle_new_user() already created every profile row; flip the admin one.
UPDATE public.profiles SET is_admin = true WHERE id = '00000000-0000-0000-0000-000000000002';

-- Transactional emails (ADR 0016): point the trigger at the local edge runtime, as seen from the
-- database container. With no RESEND_API_KEY locally, send-party-email only logs what it would
-- send (dry_run rows in email_log). Preview also loads this file; the host doesn't exist there,
-- so the request fails quietly and nothing is sent, which is what Preview wants.
INSERT INTO private.settings ("key", "value")
VALUES ('email_function_url', 'http://api.supabase.internal:8000/functions/v1/send-party-email');
