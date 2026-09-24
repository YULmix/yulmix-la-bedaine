-- Fix update_attendee_counts(): it read attendee->>'tier', a key the app never writes
-- (attendees are stored as {type, participation}), so `counts` was always all-zero.
-- Run this script in the Supabase SQL Editor to deploy the corrected function.
-- See docs/09-state-of-the-code.md, P1 item 1.

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
            tier_name := CASE
                WHEN attendee->>'type' = 'Adult' AND attendee->>'participation' = 'Whole' THEN 'adult_whole'
                WHEN attendee->>'type' = 'Adult' THEN 'adult_main'
                WHEN attendee->>'type' = 'Teenager' AND attendee->>'participation' = 'Whole' THEN 'teen_whole'
                WHEN attendee->>'type' = 'Teenager' THEN 'teen_main'
                WHEN attendee->>'type' = 'Kid' THEN 'kids'
                ELSE NULL
            END;
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

-- One-time backfill: recompute counts for every existing registration so past
-- rows aren't stuck at zero until their next edit. UPDATE ... SET attendees = attendees
-- re-fires the BEFORE UPDATE trigger without changing any data.
UPDATE public.user_parties SET attendees = attendees WHERE attendees IS NOT NULL;
