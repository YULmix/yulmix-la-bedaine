-- supabase/schema.sql
-- Comprehensive PostgreSQL schema for La Bédaine event management

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    last_edited_at TIMESTAMPTZ DEFAULT NOW(),
    edit_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, event_id)
);

COMMENT ON TABLE public.user_parties IS 'Event registrations with attendee tracking and payment status';
COMMENT ON COLUMN public.user_parties.attendees IS 'Array of objects: [{"name": "...", "tier": "adult_whole" | "adult_main" | "teen_whole" | "teen_main" | "kids", "is_new_member": boolean}]';
COMMENT ON COLUMN public.user_parties.counts IS 'Auto-computed from attendees on insert/update';
COMMENT ON COLUMN public.user_parties.admin_notes IS 'Private notes reserved for organizers only';
COMMENT ON COLUMN public.user_parties.last_edited_at IS 'Timestamp of last edit to registration';
COMMENT ON COLUMN public.user_parties.edit_count IS 'Number of times registration has been edited';

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

COMMENT ON TABLE public.app_feedback IS 'User feedback and bug reports with resolution tracking';

-- ============================================
-- 5. REGISTRATION_EDITS TABLE
-- Audit trail for registration changes
-- ============================================
CREATE TABLE IF NOT EXISTS public.registration_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES public.user_parties(id) ON DELETE CASCADE,
    edited_at TIMESTAMPTZ DEFAULT NOW(),
    edited_by UUID REFERENCES auth.users(id),
    changes JSONB
);

COMMENT ON TABLE public.registration_edits IS 'Audit trail for registration edits';

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
    tier_name TEXT;
BEGIN
    IF NEW.attendees IS NOT NULL AND jsonb_typeof(NEW.attendees) = 'array' THEN
        FOR attendee IN SELECT * FROM jsonb_array_elements(NEW.attendees)
        LOOP
            tier_name := attendee->>'tier';
            IF tier_name IS NOT NULL THEN
                counts := jsonb_set(
                    counts,
                    ARRAY[tier_name],
                    to_jsonb(COALESCE((counts->>tier_name)::int, 0) + 1)
                );
            END IF;
        END LOOP;
    END IF;

    NEW.counts := counts;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Prevent self-promotion to admin
CREATE OR REPLACE FUNCTION public.prevent_self_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.id = auth.uid() AND OLD.is_admin IS DISTINCT FROM NEW.is_admin) THEN
        IF EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND is_admin = TRUE
        ) THEN
            RAISE EXCEPTION 'Les administrateurs ne peuvent pas modifier leur propre statut d''administrateur.';
        ELSE
            RAISE EXCEPTION 'Les utilisateurs ne peuvent pas s''attribuer eux-mêmes des privilèges d''administrateur.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment edit count on registration update
CREATE OR REPLACE FUNCTION public.increment_edit_count()
RETURNS TRIGGER AS $$
BEGIN
    NEW.edit_count = OLD.edit_count + 1;
    NEW.last_edited_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Log registration edits to audit table
CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS TRIGGER AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
BEGIN
    IF OLD.attendees IS DISTINCT FROM NEW.attendees THEN
        changes_json = jsonb_set(changes_json, '{attendees}', jsonb_build_object('old', OLD.attendees, 'new', NEW.attendees));
    END IF;
    IF OLD.counts IS DISTINCT FROM NEW.counts THEN
        changes_json = jsonb_set(changes_json, '{counts}', jsonb_build_object('old', OLD.counts, 'new', NEW.counts));
    END IF;
    IF OLD.logistics IS DISTINCT FROM NEW.logistics THEN
        changes_json = jsonb_set(changes_json, '{logistics}', jsonb_build_object('old', OLD.logistics, 'new', NEW.logistics));
    END IF;
    IF OLD.transport IS DISTINCT FROM NEW.transport THEN
        changes_json = jsonb_set(changes_json, '{transport}', jsonb_build_object('old', OLD.transport, 'new', NEW.transport));
    END IF;
    IF OLD.music_requests IS DISTINCT FROM NEW.music_requests THEN
        changes_json = jsonb_set(changes_json, '{music_requests}', jsonb_build_object('old', OLD.music_requests, 'new', NEW.music_requests));
    END IF;
    IF OLD.message_to_organizers IS DISTINCT FROM NEW.message_to_organizers THEN
        changes_json = jsonb_set(changes_json, '{message_to_organizers}', jsonb_build_object('old', OLD.message_to_organizers, 'new', NEW.message_to_organizers));
    END IF;
    IF OLD.confirmation_message IS DISTINCT FROM NEW.confirmation_message THEN
        changes_json = jsonb_set(changes_json, '{confirmation_message}', jsonb_build_object('old', OLD.confirmation_message, 'new', NEW.confirmation_message));
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        changes_json = jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF OLD.calculated_amount_owed IS DISTINCT FROM NEW.calculated_amount_owed THEN
        changes_json = jsonb_set(changes_json, '{calculated_amount_owed}', jsonb_build_object('old', OLD.calculated_amount_owed, 'new', NEW.calculated_amount_owed));
    END IF;
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
        changes_json = jsonb_set(changes_json, '{payment_status}', jsonb_build_object('old', OLD.payment_status, 'new', NEW.payment_status));
    END IF;
    IF OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted THEN
        changes_json = jsonb_set(changes_json, '{is_waitlisted}', jsonb_build_object('old', OLD.is_waitlisted, 'new', NEW.is_waitlisted));
    END IF;
    IF OLD.admin_notes IS DISTINCT FROM NEW.admin_notes THEN
        changes_json = jsonb_set(changes_json, '{admin_notes}', jsonb_build_object('old', OLD.admin_notes, 'new', NEW.admin_notes));
    END IF;

    IF changes_json != '{}'::JSONB THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, NEW.user_id, changes_json);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGERS
-- ============================================

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE TRIGGER prevent_event_delete
BEFORE DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.prevent_event_deletion();

CREATE TRIGGER update_counts
BEFORE INSERT OR UPDATE OF attendees ON public.user_parties
FOR EACH ROW EXECUTE FUNCTION public.update_attendee_counts();

CREATE TRIGGER trg_prevent_self_privilege_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_privilege_escalation();

CREATE TRIGGER trg_increment_edit_count
BEFORE UPDATE ON public.user_parties
FOR EACH ROW EXECUTE FUNCTION public.increment_edit_count();

CREATE TRIGGER trg_log_registration_edit
AFTER UPDATE ON public.user_parties
FOR EACH ROW EXECUTE FUNCTION public.log_registration_edit();

-- ============================================
-- INDEXES AND CONSTRAINTS
-- ============================================

CREATE UNIQUE INDEX only_one_active_event 
ON public.events (is_active) 
WHERE is_active = TRUE;

COMMENT ON INDEX only_one_active_event IS 'Ensures no two events can ever be active at the same time';

CREATE INDEX idx_profiles_email ON public.profiles(email);
CREATE INDEX idx_profiles_is_admin ON public.profiles(is_admin);

CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_events_is_active ON public.events(is_active);
CREATE INDEX idx_events_reg_start_date ON public.events(reg_start_date);

CREATE INDEX idx_user_parties_user_id ON public.user_parties(user_id);
CREATE INDEX idx_user_parties_event_id ON public.user_parties(event_id);
CREATE INDEX idx_user_parties_payment_status ON public.user_parties(payment_status);
CREATE INDEX idx_user_parties_is_waitlisted ON public.user_parties(is_waitlisted);

CREATE INDEX idx_app_feedback_user_id ON public.app_feedback(user_id);
CREATE INDEX idx_app_feedback_is_resolved ON public.app_feedback(is_resolved);
CREATE INDEX idx_app_feedback_created_at ON public.app_feedback(created_at);

-- ============================================
-- VIEWS
-- ============================================

CREATE OR REPLACE VIEW public.user_event_history AS
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

COMMENT ON VIEW public.user_event_history IS 'Admin view for drilling down into user participation history';

CREATE OR REPLACE VIEW public.registration_summary_view AS
SELECT 
    id,
    event_id,
    status,
    payment_status,
    calculated_amount_owed,
    is_waitlisted,
    logistics,
    transport,
    music_requests,
    message_to_organizers,
    last_edited_at,
    edit_count,
    attendees
FROM public.user_parties
WHERE status IN ('Enregistré', 'En attente');

COMMENT ON VIEW public.registration_summary_view IS 'Simplified view for registration summary display';

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_edits ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY "Profiles: User can read own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles: User can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id OR public.is_admin())
WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles: Admins can insert profiles"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles: User can insert own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- EVENTS POLICIES
CREATE POLICY "Events: Public read active/archived"
ON public.events FOR SELECT
USING (status IN ('ACTIVE', 'ARCHIVED') OR public.is_admin());

CREATE POLICY "Events: Admin full access"
ON public.events FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- USER_PARTIES POLICIES
CREATE POLICY "User Parties: User can read own registrations"
ON public.user_parties FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "User Parties: User can create own registrations"
ON public.user_parties FOR INSERT
WITH CHECK (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "User Parties: User can update own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can update own registrations"
ON public.user_parties FOR UPDATE
USING ((auth.uid() = user_id AND status IN ('Enregistré', 'En attente')) OR public.is_admin())
WITH CHECK ((auth.uid() = user_id AND status IN ('Enregistré', 'En attente')) OR public.is_admin());

CREATE POLICY "User Parties: User can delete own registrations"
ON public.user_parties FOR DELETE
USING (auth.uid() = user_id OR public.is_admin());

-- APP_FEEDBACK POLICIES
CREATE POLICY "App Feedback: Users can insert own feedback"
ON public.app_feedback FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App Feedback: Users can read own feedback"
ON public.app_feedback FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "App Feedback: Users can update own feedback"
ON public.app_feedback FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "App Feedback: Admins can delete feedback"
ON public.app_feedback FOR DELETE
USING (public.is_admin());

-- REGISTRATION_EDITS POLICIES
CREATE POLICY "Registration Edits: Users can see their own edit history"
ON public.registration_edits FOR SELECT
USING (edited_by = auth.uid() OR public.is_admin());

CREATE POLICY "Registration Edits: System can insert edit records"
ON public.registration_edits FOR INSERT
WITH CHECK (edited_by = auth.uid() OR public.is_admin());

-- ============================================
-- GRANTS AND PERMISSIONS
-- ============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.events TO anon;
GRANT SELECT ON public.user_event_history TO authenticated;
GRANT SELECT ON public.registration_summary_view TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- ============================================
-- SECURITY: PREVENT SELF-PROMOTION AND ENFORCE CAPACITY
-- ============================================

-- Revoke direct UPDATE on is_admin column to force use of admin_set_is_admin function
REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;

-- Function to safely set admin status (caller must be admin, cannot self-promote)
CREATE OR REPLACE FUNCTION public.admin_set_is_admin(
    target_user_id UUID,
    new_is_admin BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
    target_email TEXT;
BEGIN
    -- Ensure caller is admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only administrators can change admin status';
    END IF;

    -- Prevent self-promotion/demotion
    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot change your own admin status';
    END IF;

    -- Fetch target email to protect root admin
    SELECT email INTO target_email
    FROM public.profiles
    WHERE id = target_user_id;

    -- Block demotion of root admin
    IF target_email = 'yulmixalabedaine@gmail.com' AND new_is_admin = FALSE THEN
        RAISE EXCEPTION 'Le compte administrateur racine ne peut pas être rétrogradé.';
    END IF;

    -- Update the profile
    UPDATE public.profiles
    SET is_admin = new_is_admin
    WHERE id = target_user_id;

    -- Ensure at least one admin remains (hardcoded root admin excluded)
    -- Root admin yulmixalabedaine@gmail.com is already protected by is_admin() function
END;

GRANT EXECUTE ON FUNCTION public.admin_set_is_admin(UUID, BOOLEAN) TO authenticated;

-- ============================================
-- ROOT ADMIN PROTECTION & REINSTATEMENT
-- ============================================

-- Immediately reinstate root admin if column was ever set to FALSE
-- (Run this once manually in Supabase SQL Editor if root admin appears non‑admin in UI)
-- UPDATE public.profiles SET is_admin = TRUE WHERE email = 'yulmixalabedaine@gmail.com';

-- Prevent root admin from ever being demoted via any UPDATE
CREATE OR REPLACE FUNCTION public.protect_root_admin()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.email = 'yulmixalabedaine@gmail.com' AND NEW.is_admin = FALSE THEN
        RAISE EXCEPTION 'Le compte administrateur racine ne peut pas être rétrogradé.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_root_admin ON public.profiles;
CREATE TRIGGER trg_protect_root_admin
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_root_admin();

-- Function to enforce capacity and waitlist rules on user_parties inserts/updates
CREATE OR REPLACE FUNCTION public.enforce_capacity_and_waitlist()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_id UUID;
    v_max_attendees INT;
    v_current_registered INT;
    v_is_waitlisted BOOLEAN;
BEGIN
    -- Determine event ID
    v_event_id := NEW.event_id;
    
    -- Get max attendees for the event
    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = v_event_id;
    
    -- If max_attendees is NULL or 0, no capacity restriction
    IF v_max_attendees IS NULL OR v_max_attendees <= 0 THEN
        NEW.is_waitlisted := FALSE;
        RETURN NEW;
    END IF;
    
    -- Use advisory lock to serialize concurrent inserts for the same event
    -- This prevents race conditions where two parties check capacity simultaneously
    PERFORM pg_advisory_xact_lock(hashtext(v_event_id::text));
    
    -- Count total attendees from non-waitlisted, registered parties for this event
    -- Exclude the current party (if updating) and already waitlisted parties
    SELECT COALESCE(SUM(jsonb_array_length(up.attendees)), 0) INTO v_current_registered
    FROM public.user_parties up
    WHERE up.event_id = v_event_id
      AND up.is_waitlisted = FALSE
      AND up.status IN ('Enregistré', 'En attente')
      AND up.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);
    
    -- Add the attendees from the new/updated party
    v_current_registered := v_current_registered + jsonb_array_length(NEW.attendees);
    
    -- Determine waitlist status
    v_is_waitlisted := v_current_registered > v_max_attendees;
    
    -- Override client-provided is_waitlisted with server-calculated value
    NEW.is_waitlisted := v_is_waitlisted;
    
    RETURN NEW;
END;
$$;

-- Create trigger to enforce capacity and waitlist before insert/update
DROP TRIGGER IF EXISTS trg_enforce_capacity_and_waitlist ON public.user_parties;
CREATE TRIGGER trg_enforce_capacity_and_waitlist
    BEFORE INSERT OR UPDATE OF attendees, status ON public.user_parties
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_capacity_and_waitlist();

-- ============================================
-- ADDITIONAL GRANTS FOR NEW FUNCTIONS
-- ============================================
GRANT EXECUTE ON FUNCTION public.enforce_capacity_and_waitlist() TO authenticated;