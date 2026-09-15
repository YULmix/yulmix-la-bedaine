-- supabase/tests/seed_test_data.sql
-- Test data for RLS policy validation

-- Clear existing test data (preserve production data)
DELETE FROM user_parties WHERE user_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
DELETE FROM app_feedback WHERE user_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
DELETE FROM events WHERE id IN (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555'
);
DELETE FROM profiles WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

-- Insert test profiles
INSERT INTO profiles (id, email, full_name, is_admin, created_at) VALUES 
('11111111-1111-1111-1111-111111111111', 'user@test.com', 'Test User', false, NOW()),
('22222222-2222-2222-2222-222222222222', 'admin@test.com', 'Test Admin', true, NOW());

-- Insert test events
INSERT INTO events (id, theme, status, created_at) VALUES
('33333333-3333-3333-3333-333333333333', 'Draft Event', 'DRAFT', NOW()),
('44444444-4444-4444-4444-444444444444', 'Active Event', 'ACTIVE', NOW()),
('55555555-5555-5555-5555-555555555555', 'Archived Event', 'ARCHIVED', NOW());

-- Insert test registrations
INSERT INTO user_parties (id, user_id, event_id, status, created_at) VALUES
('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'Enregistré', NOW()),
('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'Enregistré', NOW());

-- Insert test feedback
INSERT INTO app_feedback (id, user_id, feedback_type, message, is_resolved, created_at) VALUES
('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'BUG', 'Test bug report', false, NOW()),
('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'FEATURE', 'Test feature request', false, NOW());