-- supabase/schema.sql
-- Comprehensive PostgreSQL schema for La Bédaine event management

-- ============================================
-- EXTENSIONS
-- ============================================
-- 1. PROFILES TABLE
-- Syncs with auth.users, auto-sets admin status
-- ============================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'User profiles synchronized with Supabase auth.users table';
-- ============================================
-- 2. EVENTS TABLE
-- Core event management with strict constraints
-- ============================================
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme TEXT NOT NULL,
    description TEXT,
    venue_address TEXT,
    duration_days INT DEFAULT 2,
    points_of_contact TEXT DEFAULT 'Registration (Simon), Volunteering (Dave), Food/Special Activities (Melina / MC / Gary), Neighbors / Parking (Khaled), Pharma / First Aid / Bed Assignments (Mach)',
    z_intent_months INT DEFAULT 2,
    x_reg_close_weeks INT DEFAULT 1,
    reg_start_date DATE DEFAULT '2026-05-01',
    status TEXT CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')) DEFAULT 'DRAFT',
    is_active BOOLEAN DEFAULT FALSE,
    is_reg_open BOOLEAN DEFAULT FALSE,
    total_cost NUMERIC(10,2) DEFAULT 0.00,
    cost_breakdown JSONB DEFAULT '[]'::jsonb,
    expense_category TEXT CHECK (expense_category IN ('Chalet', 'Food', 'Music', 'Tech', 'Accessories')),
    selling_price_whole_event NUMERIC(10,2) DEFAULT 0.00,
    estimated_individual_cost_whole_event NUMERIC(10,2) DEFAULT 0.00,
    max_attendees INT DEFAULT 90,
    external_links JSONB DEFAULT '[]'::jsonb,
    instructions TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.events IS 'Event management with strict no-delete and single-active-event constraints';
COMMENT ON COLUMN public.events.points_of_contact IS 'Default contact points: Registration (Simon), Volunteering (Dave), Food/Special Activities (Melina / MC / Gary), Neighbors / Parking (Khaled), Pharma / First Aid / Bed Assignments (Mach)';
-- ============================================
-- 3. USER_PARTIES TABLE
-- Registration system with attendee tracking
-- ============================================
CREATE TABLE public.user_parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
    counts JSONB NOT NULL DEFAULT '{"adult_whole":0,"adult_main":0,"teen_whole":0,"teen_main":0,"kids":0}'::jsonb,
    logistics JSONB NOT NULL DEFAULT '{"sleeping":{"pref":"","reason":"","assigned":""},"food_requests":{"requests":"","notes":""},"volunteering":[]}'::jsonb,
    transport JSONB NOT NULL DEFAULT '{"type":"None","seats":0,"arrival":"","departure":""}'::jsonb,
    music_requests TEXT,
    message_to_organizers TEXT,
    confirmation_message TEXT,
    status TEXT DEFAULT 'Enregistré',
    calculated_amount_owed NUMERIC(10,2) DEFAULT 0.00,
    payment_status TEXT CHECK (payment_status IN ('Impayé', 'Payé')) DEFAULT 'Impayé',
    is_waitlisted BOOLEAN DEFAULT FALSE,
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, event_id)
);

COMMENT ON TABLE public.user_parties IS 'Event registrations with attendee tracking and payment status';
COMMENT ON COLUMN public.user_parties.attendees IS 'Array of objects: [{"name": "...", "tier": "adult_whole" | "adult_main" | "teen_whole" | "teen_main" | "kids", "is_new_member": boolean}]';
COMMENT ON COLUMN public.user_parties.counts IS 'Auto-computed from attendees on insert/update';
-- ============================================
-- 4. APP_FEEDBACK TABLE
-- User feedback tracking system
-- ============================================
CREATE TABLE public.app_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    screenshot_url TEXT,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, is_admin)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        (NEW.email = 'yulmixalabedaine@gmail.com')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Prevent event deletion (No Delete Method)
CREATE OR REPLACE FUNCTION public.prevent_event_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Les événements ne peuvent pas être supprimés. Utilisez l''archivage à la place.';
END;
$$ LANGUAGE plpgsql;

-- Attendee count calculation
CREATE OR REPLACE FUNCTION public.update_attendee_counts()
RETURNS TRIGGER AS $$
DECLARE
    counts JSONB := '{"adult_whole":0,"adult_main":0,"teen_whole":0,"teen_main":0,"kids":0}'::jsonb;
    attendee JSONB;
BEGIN
    FOR attendee IN SELECT * FROM jsonb_array_elements(NEW.attendees)
    LOOP
        counts = jsonb_set(
            counts, 
            ARRAY[attendee->>'tier'], 
            to_jsonb((COALESCE(counts->>attendee->>'tier', '0'))::int + 1)::text::jsonb
        );
    END LOOP;
    NEW.counts = counts;
    RETURN NEW; 
    END; 
    $$ LANGUAGE plpgsql;
-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-create profile on auth.user creation
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Prevent event deletion
CREATE TRIGGER prevent_event_delete
BEFORE DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.prevent_event_deletion();

-- Auto-calculate attendee counts
-- ============================================
-- INDEXES AND CONSTRAINTS
-- ============================================

-- Single active event constraint (Mutex)
CREATE UNIQUE INDEX only_one_active_event 
ON public.events (is_active) 
WHERE is_active = TRUE;

COMMENT ON INDEX only_one_active_event IS 'Ensures no two events can ever be active at the same time';

-- Performance indexes
CREATE INDEX idx_profiles_email ON public.profiles(email);
CREATE INDEX idx_profiles_is_admin ON public.profiles(is_admin);

CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_events_is_active ON public.events(is_active);
CREATE INDEX idx_events_reg_start_date ON public.events(reg_start_date);

CREATE INDEX idx_user_parties_user_id ON public.user_parties(user_id);
CREATE INDEX idx_user_parties_event_id ON public.user_parties(event_id);
-- ============================================
-- VIEWS
-- ============================================

-- User event history for admin dashboard
CREATE VIEW public.user_event_history AS
SELECT 
    p.id AS user_id,
    p.email,
    p.full_name,
    up.id AS party_id,
    e.id AS event_id,
    e.theme AS event_theme,
    e.reg_start_date,
    up.status AS registration_status,
    up.calculated_amount_owed,
    up.payment_status,
    up.created_at AS registration_date,
    up.attendees,
    up.counts,
    up.is_waitlisted
FROM public.profiles p
JOIN public.user_parties up ON p.id = up.user_id
JOIN public.events e ON up.event_id = e.id;
-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ADMIN HELPER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND (is_admin = TRUE OR email = 'yulmixalabedaine@gmail.com')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- RLS POLICIES
-- ============================================

-- PROFILES POLICIES
-- Users can view and edit their own record; admins have full read/write access.
CREATE POLICY "Profiles: User can read own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles: User can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id OR public.is_admin())
WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles: Admins can insert profiles"
ON public.profiles
FOR INSERT
WITH CHECK (public.is_admin());

-- EVENTS POLICIES
-- Authenticated and public users can read ACTIVE and ARCHIVED events;
-- DRAFT events visible exclusively to admins; only admins have insert/update permissions.
CREATE POLICY "Events: Public read active/archived"
ON public.events
FOR SELECT
USING (
    status IN ('ACTIVE', 'ARCHIVED')
    OR public.is_admin()
);

CREATE POLICY "Events: Admin full access"
ON public.events
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- USER_PARTIES POLICIES
-- Users can read, create, and modify their own registration; admins have unrestricted access.
CREATE POLICY "User Parties: User can read own registrations"
ON public.user_parties
FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "User Parties: User can create own registrations"
ON public.user_parties
FOR INSERT
WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "User Parties: User can update own registrations"
ON public.user_parties
FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "User Parties: User can delete own registrations"
ON public.user_parties
FOR DELETE
USING (auth.uid() = user_id OR public.is_admin());

-- APP_FEEDBACK POLICIES
-- Authenticated users can insert records and read their own submissions;
-- admins have full triage permissions.
CREATE POLICY "App Feedback: Users can insert own feedback"
ON public.app_feedback
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App Feedback: Users can read own feedback"
ON public.app_feedback
FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "App Feedback: Users can update own feedback"
ON public.app_feedback
FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "App Feedback: Admins can delete feedback"
ON public.app_feedback
FOR DELETE
USING (public.is_admin());

-- ============================================
-- GRANTS AND PERMISSIONS
-- ============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.events TO anon;
GRANT SELECT ON public.user_event_history TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMENT ON VIEW public.user_event_history IS 'Admin view for drilling down into user participation history';
CREATE INDEX idx_user_parties_payment_status ON public.user_parties(payment_status);
CREATE INDEX idx_user_parties_is_waitlisted ON public.user_parties(is_waitlisted);

CREATE INDEX idx_app_feedback_user_id ON public.app_feedback(user_id);
CREATE INDEX idx_app_feedback_is_resolved ON public.app_feedback(is_resolved);
CREATE INDEX idx_app_feedback_created_at ON public.app_feedback(created_at);
CREATE TRIGGER update_counts
BEFORE INSERT OR UPDATE OF attendees ON public.user_parties
FOR EACH ROW EXECUTE FUNCTION public.update_attendee_counts();
COMMENT ON TABLE public.app_feedback IS 'User feedback and bug reports with resolution tracking';
COMMENT ON COLUMN public.user_parties.admin_notes IS 'Private notes reserved for organizers only';
COMMENT ON COLUMN public.events.external_links IS 'Must support custom labels and links, including "Liste d''achats"';
COMMENT ON COLUMN public.profiles.is_admin IS 'Root admin is automatically set to TRUE for email: yulmixalabedaine@gmail.com';

-- ============================================
-- TEST DATA SEED FUNCTION (for RLS policy testing)
-- ============================================
CREATE OR REPLACE FUNCTION seed_test_data()
RETURNS void AS $$
BEGIN
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
