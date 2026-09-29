-- Bédaine 2026 sleeps at the Usine Stanstead: its 10 bedrooms become the event's locations, each
-- with its beds and floor space as places. Data only, no schema change.
--
-- Rooms, areas and beds are from https://www.usinestanstead.ca/#chambres (2026-09-29): 26 beds,
-- 4 simples, 20 queens, 2 kings. A simple is one spot, a queen or king two, so 48 bed spots.
--
-- Floor space is one "Plancher" place per room, its capacity estimated from the area: the room's
-- area (which includes its en suite bathroom) minus the beds' footprint (queen 33, king 42,
-- simple 20 pi²), one spot per full 100 pi² left. That keeps room for bags and a way to the
-- bathroom, and gives 38 floor spots, 86 in all for an event capped at 90. Capacity is advisory
-- (organisers may overbook), so these are starting numbers to adjust in the event dialog.
--
--   Room               pi²   beds            free  floor
--   1 Elna             490   2 queens + 1 s   404    4
--   2 Singer           345   1 queen + 1 s    292    2
--   3 Juki             300   1 queen + 1 s    247    2
--   4 Bernina          400   3 queens         301    3
--   5 New Williams     585   1 king + 1 q     510    5
--   6 Baby Lock        435   2 queens         369    3
--   7 White Rotary     585   1 king + 2 q     477    4
--   8 Brother          485   2 queens + 1 s   399    3
--   9 Janome           750   2 queens         684    6
--   Chambre 10         775   4 queens         643    6
--
-- Locations are named "<number> <name>" rather than the site's "Chambre 1 · Elna", which is long
-- next to a place label in the "<location> · <place>" label; Chambre 10 has no name on the site.
--
-- The placeholder location organisers created while trying the editor ("Usine Stanstead" holding
-- a single "Place 1") is removed, but only while it is still exactly that and nobody holds it.
--
-- The event is named by id. On any other database (local, CI, preview) it doesn't exist and this
-- does nothing. If the event already has a room location, someone entered rooms by hand
-- and this stops rather than adding a second set.

DO $$
DECLARE
    c_event constant uuid := '1f7127f9-ac51-481a-91f8-b887f2e1ae6e';
    v_room record;
    v_location uuid;
    v_place_sort integer;
    i integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = c_event) THEN
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.event_locations
               WHERE event_id = c_event AND (name ~ '^[1-9] ' OR name ~* '^chambre')) THEN
        RAISE EXCEPTION 'usine_stanstead_rooms: the event already has room locations';
    END IF;

    DELETE FROM public.event_locations l
    WHERE l.event_id = c_event
      AND l.name = 'Usine Stanstead'
      AND (SELECT count(*) FROM public.event_places p WHERE p.location_id = l.id) = 1
      AND EXISTS (SELECT 1 FROM public.event_places p
                  WHERE p.location_id = l.id AND p.label = 'Place 1')
      AND NOT EXISTS (SELECT 1 FROM public.event_places p
                      JOIN public.place_assignments pa ON pa.place_id = p.id
                      WHERE p.location_id = l.id);

    FOR v_room IN
        SELECT * FROM (VALUES
            (1,  '1 Elna',          490, 0, 2, 1, 4),
            (2,  '2 Singer',        345, 0, 1, 1, 2),
            (3,  '3 Juki',          300, 0, 1, 1, 2),
            (4,  '4 Bernina',       400, 0, 3, 0, 3),
            (5,  '5 New Williams',  585, 1, 1, 0, 5),
            (6,  '6 Baby Lock',     435, 0, 2, 0, 3),
            (7,  '7 White Rotary',  585, 1, 2, 0, 4),
            (8,  '8 Brother',       485, 0, 2, 1, 3),
            (9,  '9 Janome',        750, 0, 2, 0, 6),
            (10, 'Chambre 10',      775, 0, 4, 0, 6)
        ) AS r (sort_order, name, area, kings, queens, simples, floor_spots)
        ORDER BY sort_order
    LOOP
        INSERT INTO public.event_locations (event_id, name, note, sort_order)
        VALUES (c_event, v_room.name, v_room.area || ' pi²', v_room.sort_order)
        RETURNING id INTO v_location;

        v_place_sort := 0;
        FOR i IN 1..v_room.kings LOOP
            v_place_sort := v_place_sort + 1;
            INSERT INTO public.event_places (location_id, label, type, capacity, sort_order)
            VALUES (v_location,
                    CASE WHEN v_room.kings > 1 THEN 'King ' || i ELSE 'King' END,
                    'bed', 2, v_place_sort);
        END LOOP;
        FOR i IN 1..v_room.queens LOOP
            v_place_sort := v_place_sort + 1;
            INSERT INTO public.event_places (location_id, label, type, capacity, sort_order)
            VALUES (v_location,
                    CASE WHEN v_room.queens > 1 THEN 'Queen ' || i ELSE 'Queen' END,
                    'bed', 2, v_place_sort);
        END LOOP;
        FOR i IN 1..v_room.simples LOOP
            v_place_sort := v_place_sort + 1;
            INSERT INTO public.event_places (location_id, label, type, capacity, sort_order)
            VALUES (v_location,
                    CASE WHEN v_room.simples > 1 THEN 'Lit simple ' || i ELSE 'Lit simple' END,
                    'bed', 1, v_place_sort);
        END LOOP;
        v_place_sort := v_place_sort + 1;
        INSERT INTO public.event_places (location_id, label, type, capacity, sort_order)
        VALUES (v_location, 'Plancher', 'floor', v_room.floor_spots, v_place_sort);
    END LOOP;
END;
$$;
