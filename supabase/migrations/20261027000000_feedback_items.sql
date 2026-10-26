-- #354 (amends ADR 0029): a post-mortem « retour » is made of items, one text per category,
-- each signed or private, read live by account admins. The organiser's decisions (2026-10-26):
--
--   * A member has at most one signed and one private item per category (so at most 16 on an
--     event), signed by default. Each item is edited or deleted on its own until the close.
--   * Signed items are readable by account admins as soon as they are saved, with their author,
--     and with no time.
--   * Private items are released for good once 3 DIFFERENT authors have written one on the event
--     (any category, anyone, admins included: #345's own-answer exclusion is dropped). From then on
--     admins read them, even if authors delete theirs: texts only, in random (id) order, no author,
--     id or time. Before the release, nothing of them, not even a count.
--   * The release marker is a row of private.event_feedback_releases: no time, no client privilege,
--     no foreign key (a column of events would be readable by every client, xmin/xmax included).
--   * The levée at the close is unchanged in spirit: the private items are re-inserted with fresh
--     random ids, in random order, and their window rows and links are deleted. Signed items keep
--     their link. A never-released event's private items stay hidden for good.
--   * « Voir comme » hides everything (answer_hidden, no items) and can't save, as before.
--
-- Replaces the one-answer tables of 20261026043829_event_feedback.sql (event_feedback,
-- event_feedback_authors) with event_feedback_items and event_feedback_item_authors, converting
-- every stored answer as it is: each non-null category text becomes one item of the answer's kind
-- (named → signed, anonymous → private) with the answer's link (author, party, times) when it has
-- one. Production has never shown the post-mortem to members (feedback_member_visible off).
--
-- The tables keep ADR 0029's properties: RLS on, no policy, no client privilege (service_role
-- included), no foreign key to events, profiles or user_parties (a foreign key's FOR KEY SHARE
-- writes the saver's transaction id into a client-readable xmax), advisory locks only.
--
-- Redefined, each copied from its latest definition (named at the function) with only the
-- intended edits: private.enforce_event_feedback_rules, private.event_feedback_levee,
-- private.event_feedback_forget_party, private.event_feedback_forget_profile,
-- public.my_event_feedback, public.event_feedback_answers, public.event_feedback_counts.
-- public.submit_event_feedback changes signature: the old (uuid, jsonb, boolean) is dropped.
-- Unchanged and still used: the window helpers, the switch (#341), the close triggers on events,
-- private.event_feedback_lock_key, private.event_feedback_categories.

-- ---------------------------------------------------------------------------------------------
-- The new tables.

-- The items: an event, a category, a text and the kind; nothing about who or when.
CREATE TABLE public.event_feedback_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- No foreign key to events (ADR 0029: its FOR KEY SHARE would write events.xmax). The save
    -- checks the event exists; events are never deleted (prevent_event_delete).
    event_id uuid NOT NULL,
    category text NOT NULL,
    body text NOT NULL,
    is_private boolean NOT NULL DEFAULT false,
    -- The author link's composite foreign key ties a link to its item's event, category and kind.
    CONSTRAINT event_feedback_items_link_key UNIQUE (id, event_id, category, is_private),
    CONSTRAINT event_feedback_items_category_valid CHECK (
        category IN ('welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other')
    ),
    -- Never blank (a non-space character), reasonably short.
    CONSTRAINT event_feedback_items_body_valid CHECK (body ~ '\S' AND char_length(body) <= 5000)
);

CREATE INDEX event_feedback_items_event_id_idx ON public.event_feedback_items (event_id);

COMMENT ON TABLE public.event_feedback_items IS
    'Post-mortem items (« bilan », #354, ADR 0029): one text per category, signed or private. While the window is open each has its author link (event_feedback_item_authors); at the close the levée re-inserts the private ones with fresh ids, in random order, and deletes their window rows and links. No client privilege: only the SECURITY DEFINER functions read or write it.';
COMMENT ON COLUMN public.event_feedback_items.category IS
    'welcome « Accueil », party_music « Party + musique », safety « Sécurité », lodging « Hébergement », food « Nourriture », communications « Communications », schedule « Horaire », other « Autres ».';
COMMENT ON COLUMN public.event_feedback_items.is_private IS
    'Private (« privé »): readable by admins, without author, only once 3 different authors have written a private item on the event; loses its author link at the close. Signed otherwise. Fixed for the item: switching is a delete and a new item.';

-- Who wrote an item, from which registration, and when. Every item has one while the window is
-- open; after the close only the signed ones do. One per author, event, category and kind.
CREATE TABLE public.event_feedback_item_authors (
    item_id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    category text NOT NULL,
    is_private boolean NOT NULL,
    -- Null only once the profile is hard-deleted: the item stays. No foreign key (profiles.xmax);
    -- trg_event_feedback_forget_profile does the ON DELETE SET NULL.
    author_id uuid,
    -- The registration it was written from; null once that party is deleted. No foreign key
    -- (user_parties.xmax); trg_event_feedback_forget_party sets it null.
    party_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_feedback_item_authors_item_fkey FOREIGN KEY (item_id, event_id, category, is_private)
        REFERENCES public.event_feedback_items (id, event_id, category, is_private) ON DELETE CASCADE,
    CONSTRAINT event_feedback_one_item_per_kind UNIQUE (event_id, author_id, category, is_private)
);

-- The delete triggers' SET NULL looks rows up by party and by author; the release counts private
-- authors per event (the unique index above, led by event_id, serves it).
CREATE INDEX event_feedback_item_authors_party_id_idx ON public.event_feedback_item_authors (party_id);
CREATE INDEX event_feedback_item_authors_author_id_idx ON public.event_feedback_item_authors (author_id);

COMMENT ON TABLE public.event_feedback_item_authors IS
    'The author link of a post-mortem item (#354, ADR 0029): author, registration and times, never returned to an admin with a time. Erased for private items by the levée at the close; kept for signed ones. No client privilege.';
COMMENT ON COLUMN public.event_feedback_item_authors.author_id IS
    'Who wrote it, fixed at the first write: the item is theirs whoever owns the party later.';
COMMENT ON COLUMN public.event_feedback_item_authors.party_id IS
    'The registration it was written from, fixed at the first write; null once that party is deleted, the item kept.';

-- The release marker: an event's private items are readable by admins once its row exists. Set
-- once, by the save that makes the event's distinct private authors reach 3, and never removed.
-- No time on purpose (when the 3rd author arrived is not to be known); no foreign key (events.xmax).
CREATE TABLE private.event_feedback_releases (
    event_id uuid PRIMARY KEY
);

COMMENT ON TABLE private.event_feedback_releases IS
    'Post-mortem (#354, ADR 0029): the events whose private items are released to admins, for good (3 different private authors were reached). No time, no client privilege.';

-- RLS on, no policy: denied to every client role even if a grant came back by mistake.
ALTER TABLE public.event_feedback_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_feedback_item_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.event_feedback_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_feedback_items FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.event_feedback_item_authors FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.event_feedback_releases FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The conversion of the stored answers (before the tables' rules triggers exist: a closed event's
-- answers are converted too, which those triggers would refuse).

CREATE TEMPORARY TABLE event_feedback_conversion AS
SELECT gen_random_uuid() AS item_id,
       f.event_id,
       c.category,
       c.body,
       f.is_anonymous AS is_private,
       a.author_id,
       a.party_id,
       a.created_at,
       a.updated_at,
       a.feedback_id IS NOT NULL AS linked
FROM public.event_feedback f
CROSS JOIN LATERAL (VALUES
    ('welcome', f.welcome), ('party_music', f.party_music), ('safety', f.safety), ('lodging', f.lodging),
    ('food', f.food), ('communications', f.communications), ('schedule', f.schedule), ('other', f.other)
) AS c (category, body)
LEFT JOIN public.event_feedback_authors a ON a.feedback_id = f.id
WHERE c.body IS NOT NULL;

-- In random order: the heap position of a published private item says nothing of its answer.
INSERT INTO public.event_feedback_items (id, event_id, category, body, is_private)
SELECT item_id, event_id, category, body, is_private
FROM event_feedback_conversion
ORDER BY random();

INSERT INTO public.event_feedback_item_authors
    (item_id, event_id, category, is_private, author_id, party_id, created_at, updated_at)
SELECT item_id, event_id, category, is_private, author_id, party_id, created_at, updated_at
FROM event_feedback_conversion
WHERE linked;

-- Released: one stored answer was one author, so 3 anonymous answers were 3 different authors
-- (before the close by their links, after it by the old threshold, which counted answers).
INSERT INTO private.event_feedback_releases (event_id)
SELECT f.event_id
FROM public.event_feedback f
WHERE f.is_anonymous
GROUP BY f.event_id
HAVING count(*) >= 3;

-- squawk-ignore ban-drop-table
DROP TABLE event_feedback_conversion; -- this migration's own temporary table

-- ---------------------------------------------------------------------------------------------
-- The old answers go: their functions first (the ones whose signature names the old table or that
-- change signature), then the tables, with their triggers.

-- Squawk: dropping the tables is the point; their rows were converted above, and no client role
-- ever had a privilege on them (only the functions redefined here read them).
DROP FUNCTION public.submit_event_feedback(uuid, jsonb, boolean);
DROP FUNCTION private.event_feedback_answers_of(public.event_feedback);
-- squawk-ignore ban-drop-table
DROP TABLE public.event_feedback_authors;
-- squawk-ignore ban-drop-table
DROP TABLE public.event_feedback;

-- ---------------------------------------------------------------------------------------------
-- The tables' triggers.

-- « Voir comme » is read-only (ADR 0025): the same statement trigger as every other table.
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON public.event_feedback_items
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON public.event_feedback_item_authors
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON private.event_feedback_releases
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();

-- Copied from 20261026043829_event_feedback.sql, for the new tables: an item keeps its event,
-- category and kind (its text may change); a link keeps its item, event, category, kind, author
-- and party (author and party may only become null, through the delete triggers). Once the
-- event's post-mortem has closed nothing is added or edited.
CREATE OR REPLACE FUNCTION private.enforce_event_feedback_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'event_feedback_items' THEN
        IF TG_OP = 'UPDATE' AND (NEW.event_id IS DISTINCT FROM OLD.event_id
                                 OR NEW.category IS DISTINCT FROM OLD.category
                                 OR NEW.is_private IS DISTINCT FROM OLD.is_private) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.author_id IS NULL OR NEW.party_id IS NULL THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF NEW.item_id IS DISTINCT FROM OLD.item_id
           OR NEW.event_id IS DISTINCT FROM OLD.event_id
           OR NEW.category IS DISTINCT FROM OLD.category
           OR NEW.is_private IS DISTINCT FROM OLD.is_private
           OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL)
           OR (NEW.party_id IS DISTINCT FROM OLD.party_id AND NEW.party_id IS NOT NULL) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
        -- The delete triggers' SET NULL is the one change a link takes after the close.
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.feedback_closed_at IS NOT NULL) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_closed', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_event_feedback_rules
    BEFORE INSERT OR UPDATE ON public.event_feedback_items
    FOR EACH ROW EXECUTE FUNCTION private.enforce_event_feedback_rules();
CREATE TRIGGER trg_enforce_event_feedback_rules
    BEFORE INSERT OR UPDATE ON public.event_feedback_item_authors
    FOR EACH ROW EXECUTE FUNCTION private.enforce_event_feedback_rules();

-- ---------------------------------------------------------------------------------------------
-- The levée. Copied from 20261026043829_event_feedback.sql; the edits: the items table, and the
-- private items instead of the anonymous answers. Each private item is re-inserted as a new row
-- (a fresh random id, the event, category and text only), all of them in random order, and its
-- window row is deleted, which deletes its link (ON DELETE CASCADE). Signed items stay as they
-- are, with their link. The release marker is left as it is: released or not, for good.
-- Called only by the events trigger (close_event_feedback_on_event_update, unchanged), which holds
-- the event's lock exclusively and sets the close marker.
CREATE OR REPLACE FUNCTION private.event_feedback_levee(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
    WITH window_rows AS (
        DELETE FROM public.event_feedback_items i
        WHERE i.event_id = p_event_id AND i.is_private
        RETURNING i.category, i.body
    )
    INSERT INTO public.event_feedback_items (event_id, category, body, is_private)
    SELECT p_event_id, w.category, w.body, true
    FROM window_rows w
    ORDER BY random();
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- The delete triggers (copied from 20261026043829_event_feedback.sql; the edit: the link table).

CREATE OR REPLACE FUNCTION private.event_feedback_forget_party()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(private.event_feedback_lock_key(OLD.event_id));
    UPDATE public.event_feedback_item_authors a
    SET party_id = NULL,
        author_id = CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.author_id) THEN a.author_id END
    WHERE a.party_id = OLD.id;
    RETURN NULL;
END;
$$;

-- No lock here, unlike the party trigger: a save needs a party the caller owns, and deleting the
-- profile deletes its parties (ON DELETE CASCADE), each through trg_event_feedback_forget_party,
-- which waits for a save in flight and clears its author too. Keep it that way: if a save ever
-- stops requiring an owned party, this trigger needs the events' locks as well.
CREATE OR REPLACE FUNCTION private.event_feedback_forget_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.event_feedback_item_authors a SET author_id = NULL WHERE a.author_id = OLD.id;
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- The caller's own items on the event, as [{ category, private, text }] in display order (signed
-- first within a category). p_signed_only: the signed ones only (after the close).
CREATE FUNCTION private.event_feedback_my_items(p_event_id uuid, p_signed_only boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', i.category, 'private', i.is_private, 'text', i.body)
                              ORDER BY array_position(private.event_feedback_categories(), i.category), i.is_private), '[]'::jsonb)
    FROM public.event_feedback_item_authors a
    JOIN public.event_feedback_items i ON i.id = a.item_id
    WHERE a.event_id = p_event_id AND a.author_id = auth.uid()
      AND NOT (p_signed_only AND i.is_private);
$$;

-- Whether the event's private items are released to admins.
CREATE FUNCTION private.event_feedback_released(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM private.event_feedback_releases r WHERE r.event_id = p_event_id);
$$;

REVOKE ALL ON FUNCTION private.event_feedback_my_items(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_released(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- The member: save their items, read them back.

-- Sets the caller's whole set of items for the event while the window is open. p_items: an array
-- of { category, private, text } (private: boolean, false when missing or null; text: a string).
-- Surrounding whitespace is trimmed and a blank text is no item; at least one item is required.
-- A (category, private) pair appears once. An item kept from the previous set keeps its id (its
-- text is updated); a pair left out is deleted, its link with it. Returns { items } as
-- my_event_feedback() shows them. The doors, locks and order of checks are those of the
-- one-answer save of 20261026043829_event_feedback.sql (with #341's switch through
-- event_feedback_check_event), plus the release: when this save makes the event's distinct
-- private authors reach 3, the event is released for good.
CREATE FUNCTION public.submit_event_feedback(p_event_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_party record;
    v_element jsonb;
    v_key text;
    v_category text;
    v_private boolean;
    v_text text;
    v_items jsonb := '[]'::jsonb;
    v_seen text[] := '{}';
    v_item_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = '42501';
    END IF;
    -- « Voir comme » is read-only (ADR 0025): refused before any other check.
    IF COALESCE(auth.jwt() ? 'impersonated_by', false) THEN
        RAISE EXCEPTION USING MESSAGE = 'read_only_impersonation', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);

    -- Hold the event's lock (shared) while writing: the levée waits for this save to commit and
    -- publishes it, or this waits for the levée and reads the marker it set. Not a row lock: that
    -- would write this transaction's id into events.xmax, which any client reads. Nothing below
    -- writes or locks a row a client can read (the tables have no foreign key to one).
    PERFORM pg_advisory_xact_lock_shared(private.event_feedback_lock_key(p_event_id));
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);

    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);
    IF v_party.reason IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_not_eligible', ERRCODE = '42501',
            DETAIL = json_build_object('reason', v_party.reason)::text;
    END IF;

    IF v_window.state = 'closed' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_closed', ERRCODE = 'check_violation';
    ELSIF v_window.state <> 'open' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_not_open', ERRCODE = 'check_violation',
            DETAIL = json_build_object('opens_on', v_window.opens_on)::text;
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
    END IF;
    FOR v_element IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
        IF jsonb_typeof(v_element) <> 'object' THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_element) LOOP
            IF v_key NOT IN ('category', 'private', 'text') THEN
                RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation',
                    DETAIL = json_build_object('key', v_key)::text;
            END IF;
        END LOOP;
        IF jsonb_typeof(v_element -> 'category') IS DISTINCT FROM 'string'
           OR NOT (v_element ->> 'category') = ANY (private.event_feedback_categories()) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_element -> 'category')::text;
        END IF;
        v_category := v_element ->> 'category';
        IF COALESCE(jsonb_typeof(v_element -> 'private'), 'null') NOT IN ('boolean', 'null')
           OR jsonb_typeof(v_element -> 'text') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_category)::text;
        END IF;
        -- Signed unless said otherwise.
        v_private := COALESCE((v_element ->> 'private')::boolean, false);
        IF (v_category || ':' || v_private) = ANY (v_seen) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_duplicate', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_category, 'private', v_private)::text;
        END IF;
        v_seen := v_seen || (v_category || ':' || v_private);
        -- Surrounding whitespace (newlines included) goes; a blank text is no item.
        v_text := NULLIF(regexp_replace(v_element ->> 'text', '^\s+|\s+$', '', 'g'), '');
        IF char_length(v_text) > 5000 THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_too_long', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_category, 'private', v_private, 'max', 5000)::text;
        END IF;
        IF v_text IS NOT NULL THEN
            v_items := v_items || jsonb_build_array(jsonb_build_object('category', v_category, 'private', v_private, 'text', v_text));
        END IF;
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_empty', ERRCODE = 'check_violation';
    END IF;

    -- One save at a time per member and event (two first saves would both insert an item).
    PERFORM pg_advisory_xact_lock(hashtextextended('event_feedback:' || p_event_id || ':' || auth.uid(), 0));

    -- The pairs left out go (their links with them, ON DELETE CASCADE). The caller's own items are
    -- matched on the stored author, never on the party's current owner (ADR 0029).
    DELETE FROM public.event_feedback_items i
    USING public.event_feedback_item_authors a
    WHERE a.item_id = i.id AND a.event_id = p_event_id AND a.author_id = auth.uid()
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) n
                      WHERE n ->> 'category' = a.category AND (n ->> 'private')::boolean = a.is_private);

    FOR v_element IN SELECT e FROM jsonb_array_elements(v_items) e LOOP
        v_category := v_element ->> 'category';
        v_private := (v_element ->> 'private')::boolean;
        v_text := v_element ->> 'text';
        SELECT a.item_id INTO v_item_id
        FROM public.event_feedback_item_authors a
        WHERE a.event_id = p_event_id AND a.author_id = auth.uid() AND a.category = v_category AND a.is_private = v_private;
        IF v_item_id IS NULL THEN
            INSERT INTO public.event_feedback_items (event_id, category, body, is_private)
            VALUES (p_event_id, v_category, v_text, v_private)
            RETURNING id INTO v_item_id;
            INSERT INTO public.event_feedback_item_authors (item_id, event_id, category, is_private, author_id, party_id)
            VALUES (v_item_id, p_event_id, v_category, v_private, auth.uid(), v_party.party_id);
        ELSE
            -- An edit keeps the item's id; the link keeps its author and party.
            UPDATE public.event_feedback_items i SET body = v_text WHERE i.id = v_item_id AND i.body IS DISTINCT FROM v_text;
            IF FOUND THEN
                UPDATE public.event_feedback_item_authors a SET updated_at = now() WHERE a.item_id = v_item_id;
            END IF;
        END IF;
    END LOOP;

    -- The release: with a private item in this save, and the event not yet released, count the
    -- event's distinct private authors under an exclusive lock taken by such saves only, so two
    -- saves that bring the 2nd and the 3rd author can't both miss the other (the second one waits,
    -- and its next statement, a new snapshot, sees the first's committed items). Released for good.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) n WHERE (n ->> 'private')::boolean)
       AND NOT private.event_feedback_released(p_event_id) THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('event_feedback_release:' || p_event_id, 0));
        IF (SELECT count(DISTINCT a.author_id) FROM public.event_feedback_item_authors a
            WHERE a.event_id = p_event_id AND a.is_private) >= 3 THEN
            INSERT INTO private.event_feedback_releases (event_id) VALUES (p_event_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN jsonb_build_object('items', private.event_feedback_my_items(p_event_id, false));
END;
$$;

COMMENT ON FUNCTION public.submit_event_feedback(uuid, jsonb) IS
    'Sets the caller''s post-mortem items for the event (#354, ADR 0029): [{ category, private, text }], at most one signed and one private per category, while the window is open, by the owner of a registered or pending, non-waitlisted registration. A pair left out is deleted; a kept one keeps its id. Releases the private items when the event reaches 3 different private authors. Returns { items }. Codes: not_authenticated, read_only_impersonation, event_not_found (also a DRAFT event and the members'' switch off, for non-admins), event_feedback_not_eligible {reason}, event_feedback_not_open {opens_on}, event_feedback_closed, event_feedback_invalid {key | category}, event_feedback_duplicate {category, private}, event_feedback_too_long {category, private, max}, event_feedback_empty.';

-- Copied from 20261026220000_feedback_switch_closes_first.sql; the edit: `items` (the caller's own
-- items, private ones included, during the window; after the close their signed ones only, a
-- private item having no author any more) instead of `answer`. In a « Voir comme » session and
-- with the members' switch off, items is [] whatever the member wrote.
--   { eligible, reason, window, opens_on, closes_on, closes_at, closed_at, items, answer_hidden }
CREATE OR REPLACE FUNCTION public.my_event_feedback(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_party record;
    v_hidden boolean := COALESCE(auth.jwt() ? 'impersonated_by', false);
    v_items jsonb := '[]'::jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_exists(p_event_id);
    IF NOT v_hidden THEN
        PERFORM private.close_event_feedback_if_due(p_event_id);
    END IF;

    -- The switch (#341): off, a member learns nothing (not the dates, the close, their items).
    IF private.event_feedback_hidden_from_caller(p_event_id) THEN
        RETURN jsonb_build_object(
            'eligible', true, 'reason', NULL, 'window', 'not_yet', 'opens_on', NULL, 'closes_on', NULL,
            'closes_at', NULL, 'closed_at', NULL, 'items', '[]'::jsonb, 'answer_hidden', v_hidden);
    END IF;

    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);

    -- The caller's own items: the ones they wrote (author_id), not the ones written from a party
    -- they own now, which an admin can reassign to themselves (ADR 0029).
    IF NOT v_hidden AND public.is_account_active() THEN
        v_items := private.event_feedback_my_items(p_event_id, v_window.state = 'closed');
    END IF;

    RETURN jsonb_build_object(
        'eligible', v_party.reason IS NULL,
        'reason', v_party.reason,
        'window', v_window.state,
        'opens_on', v_window.opens_on,
        'closes_on', v_window.closes_on,
        'closes_at', v_window.closes_at,
        'closed_at', v_window.closed_at,
        'items', v_items,
        'answer_hidden', v_hidden);
END;
$$;

COMMENT ON FUNCTION public.my_event_feedback(uuid) IS
    'The caller''s post-mortem for the event (#315, #354): eligible and reason (not_registered, cancelled, waitlisted, account_deleted), window (not_yet, open, closed), opens_on, closes_on, closes_at, closed_at, and items [{ category, private, text }] (after the close, the signed ones only). Hidden (items [], answer_hidden true) in a « Voir comme » session.';

-- ---------------------------------------------------------------------------------------------
-- The admins.

-- Copied from 20261026043829_event_feedback.sql; the edits: live, before and after the close, and
-- the items. { closed, closes_on, closes_at, closed_at, released, signed, private }
--   signed:  [{ category, text, author: { id, party, name, email } | null }], in display order of
--            the categories, then by author name: no time and no order that follows one (author
--            null once the profile is hard-deleted; the stored author and party, never the
--            party's current owner);
--   private: [{ category, text }] in random (id) order once released, [] until then (the same
--            for 0, 1 or 2 private authors).
CREATE OR REPLACE FUNCTION public.event_feedback_answers(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_released boolean;
    v_signed jsonb;
    v_private jsonb := '[]'::jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    v_released := private.event_feedback_released(p_event_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'category', i.category,
               'text', i.body,
               'author', CASE WHEN a.author_id IS NOT NULL THEN jsonb_build_object(
                   'id', a.author_id,
                   'party', a.party_id,
                   'name', p.full_name,
                   'email', p.email) END)
               ORDER BY array_position(private.event_feedback_categories(), i.category),
                        lower(COALESCE(p.full_name, p.email, '')), a.author_id, i.id), '[]'::jsonb)
    INTO v_signed
    FROM public.event_feedback_items i
    JOIN public.event_feedback_item_authors a ON a.item_id = i.id
    LEFT JOIN public.profiles p ON p.id = a.author_id
    WHERE i.event_id = p_event_id AND NOT i.is_private;

    IF v_released THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('category', i.category, 'text', i.body) ORDER BY i.id), '[]'::jsonb)
        INTO v_private
        FROM public.event_feedback_items i
        WHERE i.event_id = p_event_id AND i.is_private;
    END IF;

    RETURN jsonb_build_object(
        'closed', v_window.closed_at IS NOT NULL, 'closes_on', v_window.closes_on, 'closes_at', v_window.closes_at,
        'closed_at', v_window.closed_at, 'released', v_released, 'signed', v_signed, 'private', v_private);
END;
$$;

COMMENT ON FUNCTION public.event_feedback_answers(uuid) IS
    'An event''s post-mortem items, for account admins only (admin_only otherwise; not Comité, Organisateur nor « Voir comme ») (#315, #354, ADR 0029), live: { closed, closes_on, closes_at, closed_at, released, signed [{ category, text, author }], private [{ category, text }] }. Signed items with their author and no time; private texts only, in random order, once 3 different private authors were reached (released).';

-- Copied from 20261026230000_feedback_counts.sql; the edits: per-category item counts, the
-- release instead of the threshold (the caller's own items no longer left out, #354).
--   { closed, closes_on, eligible, signed_members, released,
--     categories: [{ category, signed, private }], signed_total, private_total }
--   eligible:       the event's registrations that may answer (the rule of event_feedback_party);
--   signed_members: the members with at least one signed item;
--   signed:         the signed items of the category, exact from the first one;
--   private:        the private items of the category once released, null until then; so is
--                   private_total. No text, author, id, time or order.
CREATE OR REPLACE FUNCTION public.event_feedback_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_released boolean;
    v_categories jsonb;
    v_signed_total integer;
    v_private_total integer;
    v_signed_members integer;
    v_eligible integer;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    v_released := private.event_feedback_released(p_event_id);

    SELECT jsonb_agg(jsonb_build_object(
               'category', c.category,
               'signed', COALESCE(n.signed, 0),
               'private', CASE WHEN v_released THEN COALESCE(n.private, 0) END)
               ORDER BY c.position),
           sum(COALESCE(n.signed, 0)),
           CASE WHEN v_released THEN sum(COALESCE(n.private, 0)) END
    INTO v_categories, v_signed_total, v_private_total
    FROM unnest(private.event_feedback_categories()) WITH ORDINALITY AS c (category, position)
    LEFT JOIN (
        SELECT i.category, count(*) FILTER (WHERE NOT i.is_private) AS signed, count(*) FILTER (WHERE i.is_private) AS private
        FROM public.event_feedback_items i
        WHERE i.event_id = p_event_id
        GROUP BY i.category
    ) n ON n.category = c.category;

    SELECT count(DISTINCT a.author_id) INTO v_signed_members
    FROM public.event_feedback_item_authors a
    WHERE a.event_id = p_event_id AND NOT a.is_private;

    SELECT count(*) INTO v_eligible
    FROM public.user_parties up
    WHERE up.event_id = p_event_id AND up.status <> 'cancelled' AND NOT COALESCE(up.is_waitlisted, false);

    RETURN jsonb_build_object(
        'closed', v_window.closed_at IS NOT NULL,
        'closes_on', v_window.closes_on,
        'eligible', v_eligible,
        'signed_members', v_signed_members,
        'released', v_released,
        'categories', v_categories,
        'signed_total', v_signed_total,
        'private_total', v_private_total);
END;
$$;

COMMENT ON FUNCTION public.event_feedback_counts(uuid) IS
    'How many post-mortem items an event has, for account admins only (admin_only otherwise; not Comité, Organisateur nor « Voir comme ») (#345, #354, ADR 0029). { closed, closes_on, eligible, signed_members, released, categories [{ category, signed, private }], signed_total, private_total }: the private numbers null until the private items are released. No text, author, id, time or order.';

REVOKE ALL ON FUNCTION public.submit_event_feedback(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_feedback(uuid, jsonb) TO authenticated;
