-- Preview demo data — FAKE people, FAKE events, FAKE money.
--
-- Loaded ONLY into the Preview Supabase project, by the preview reset script, as part of
-- `supabase db reset` (after all migrations and after supabase/seed.sql, which creates
-- member@test.local and admin@test.local). It assumes an empty public schema and empty auth
-- tables. Never run it against production.
--
-- Its purpose is to give organisers a realistic-looking dataset to click through on a branch's
-- preview deployment: one ACTIVE event with registration open, one ARCHIVED past event, and a
-- handful of parties covering every tier, new members, sleeping/bed/dietary options, paid and
-- unpaid balances, admin notes and bed assignments.
--
-- Every account below is on @test.local and uses the password "password123".
--
--   ...0001  member@test.local        Test Member   (seed.sql)  active + archived event
--   ...0002  admin@test.local         Test Admin    (seed.sql)  admin, no registration
--   ...0003  julie@test.local         Julie Gagnon              active (paid) + archived
--   ...0004  marcandre@test.local     Marc-André Bouchard       active (unpaid)
--   ...0005  sophie@test.local        Sophie Tremblay           active (paid)
--   ...0006  karim@test.local         Karim Benali              active (unpaid, new members)
--   ...0007  emilie@test.local        Émilie Côté               active (unpaid)
--   ...0008  nicolas@test.local       Nicolas Pelletier         archived only
--
-- Dates are relative to now(): the active event starts 8 weeks from today with
-- x_reg_close_weeks = 2, so the registration close date (event_start_date - 2 weeks, see
-- enforce_registration_lock_after_close_date) is ~6 weeks away and members can still edit,
-- remove participants or unregister.
--
-- Derived columns are NOT written here: counts, calculated_amount_owed and is_waitlisted are
-- computed by the user_parties triggers, and profiles rows by handle_new_user(). Only INSERTs
-- are used on user_parties, so edit_count stays 0 and registration_edits stays empty.

-- ---------------------------------------------------------------------------------------------
-- Users (handle_new_user() creates the matching public.profiles rows)
-- ---------------------------------------------------------------------------------------------

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id::uuid,
  'authenticated', 'authenticated',
  u.email,
  crypt('password123', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('full_name', u.full_name),
  now() - u.age, now() - u.age,
  '', '', '', ''
FROM (VALUES
  ('00000000-0000-0000-0000-000000000003', 'julie@test.local',     'Julie Gagnon',        interval '400 days'),
  ('00000000-0000-0000-0000-000000000004', 'marcandre@test.local', 'Marc-André Bouchard', interval '200 days'),
  ('00000000-0000-0000-0000-000000000005', 'sophie@test.local',    'Sophie Tremblay',     interval '180 days'),
  ('00000000-0000-0000-0000-000000000006', 'karim@test.local',     'Karim Benali',        interval '20 days'),
  ('00000000-0000-0000-0000-000000000007', 'emilie@test.local',    'Émilie Côté',         interval '90 days'),
  ('00000000-0000-0000-0000-000000000008', 'nicolas@test.local',   'Nicolas Pelletier',   interval '420 days')
) AS u(id, email, full_name, age);

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
FROM auth.users u
WHERE u.id IN (
  '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000008'
);

-- ---------------------------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------------------------

-- Archived edition from last year (inserted first; only_one_active_event allows any number of
-- inactive events).
INSERT INTO public.events (
  id, theme, description, venue_address, duration_days, points_of_contact,
  z_intent_months, x_reg_close_weeks, reg_start_date, event_start_date,
  status, is_active, is_reg_open,
  total_cost, cost_breakdown, selling_price_whole_event, estimated_individual_cost_whole_event,
  max_attendees, external_links, instructions, created_at
) VALUES (
  '00000000-0000-0000-0000-00000000e001',
  'La Bédaine des Couleurs',
  E'L''édition automnale : randonnée dans les couleurs, sauna et soirée électro au coin du feu.\nMerci à toutes et à tous d''avoir fait de cette fin de semaine un succès !',
  '1234 chemin du Lac-Supérieur, Lac-Supérieur, QC',
  3,
  'Inscriptions (Simon), Bénévolat (Dave), Nourriture (Melina / MC / Gary), Voisins / Stationnement (Khaled), Pharmacie / Premiers soins / Lits (Mach)',
  2, 2,
  (current_date - interval '13 months')::date,
  (current_date - interval '11 months')::date,
  'ARCHIVED', false, false,
  7800.00,
  '[{"category": "Chalet", "amount": 4200}, {"category": "Food", "amount": 2100}, {"category": "Music", "amount": 900}, {"category": "Accessories", "amount": 600}]',
  220.00, 195.00,
  60,
  '[{"label": "Album photo", "url": "https://example.com/bedaine/photos-couleurs"}]',
  'Événement terminé.',
  now() - interval '14 months'
);

-- The current edition: ACTIVE, registration open since two weeks, event in eight weeks.
INSERT INTO public.events (
  id, theme, description, venue_address, duration_days, points_of_contact,
  z_intent_months, x_reg_close_weeks, reg_start_date, event_start_date,
  status, is_active, is_reg_open,
  total_cost, cost_breakdown, expense_category, selling_price_whole_event,
  estimated_individual_cost_whole_event, max_attendees, external_links, instructions, created_at
) VALUES (
  '00000000-0000-0000-0000-00000000e002',
  'La Bédaine Tropicale',
  E'Trois jours de musique, de baignade et de bouffe partagée au bord du lac.\nThème : chemises hawaïennes et cocktails sans alcool pour les ados. Les enfants sont les bienvenus !',
  '742 chemin du Tour-du-Lac, Saint-Donat, QC',
  3,
  'Inscriptions (Simon), Bénévolat (Dave), Nourriture (Melina / MC / Gary), Voisins / Stationnement (Khaled), Pharmacie / Premiers soins / Lits (Mach)',
  2, 2,
  (current_date - 14),
  (current_date + 56),
  'ACTIVE', true, true,
  9600.00,
  '[{"category": "Chalet", "amount": 5200}, {"category": "Food", "amount": 2400}, {"category": "Music", "amount": 1100}, {"category": "Tech", "amount": 450}, {"category": "Accessories", "amount": 450}]',
  'Chalet',
  260.00, 240.00,
  70,
  '[{"label": "Liste d''achats", "url": "https://example.com/bedaine/liste-achats"}, {"label": "Playlist collaborative", "url": "https://example.com/bedaine/playlist"}, {"label": "Plan du site", "url": "https://example.com/bedaine/plan"}]',
  E'Arrivée à partir de 16 h le vendredi. Apportez vos draps, une lampe frontale et votre plus belle chemise.\nStationnement limité : pensez au covoiturage !',
  now() - interval '30 days'
);

-- ---------------------------------------------------------------------------------------------
-- Registrations on the ACTIVE event (selling price 260 $ → 130 $ per point)
-- calculated_amount_owed / counts / is_waitlisted are filled in by the triggers.
-- ---------------------------------------------------------------------------------------------

INSERT INTO public.user_parties (
  user_id, event_id, attendees, logistics, transport,
  music_requests, message_to_organizers, status, payment_status, admin_notes, created_at, last_edited_at
)
SELECT
  p.user_id::uuid, e.id, p.attendees::jsonb, p.logistics::jsonb,
  CASE WHEN p.transport_type = '' THEN
    jsonb_build_object('type', '', 'seats', 0, 'arrival', '', 'departure', '')
  ELSE
    jsonb_build_object(
      'type', p.transport_type,
      'seats', p.seats,
      'arrival', to_char(e.event_start_date + time '17:30', 'YYYY-MM-DD"T"HH24:MI'),
      'departure', to_char(e.event_start_date + 2 + time '14:00', 'YYYY-MM-DD"T"HH24:MI'))
  END,
  p.music, p.message, 'registered', p.payment_status, p.admin_notes,
  now() - p.age, now() - p.age
FROM public.events e
CROSS JOIN (VALUES
  -- Test Member: returning adult (whole) + teen (whole) + kid → 260 + 130 + 0 = 390 $, unpaid.
  ('00000000-0000-0000-0000-000000000001',
   '[{"name": "Test Member", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "children", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""},
     {"name": "Léa Member", "type": "Teenager", "participation": "Whole", "is_new_member": false, "sleeping_preference": "floor", "sleeping_preference_other": "", "dietary_needs": "vegetarian", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""},
     {"name": "Hugo Member", "type": "Kid", "participation": "After-Party", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "children", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "none, vegetarian, none", "notes": ""}, "volunteering": ["cook_meal", "cleanup_sunday"], "volunteering_other": ""}',
   'need', 0,
   'Daft Punk, Charlotte Cardin', 'Hugo a 6 ans, on aimerait dormir près des autres familles.',
   'unpaid', NULL, interval '12 days'),

  -- Julie: returning adult (whole) + new-member adult (whole → main) → 260 + 139,75 = 399,75 → 400 $, PAID.
  ('00000000-0000-0000-0000-000000000003',
   '[{"name": "Julie Gagnon", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "gluten_free", "bed_reason": "health", "bed_reason_other": "", "dietary_other": "", "assigned_bed": "Chalet principal, chambre 2, lit double"},
     {"name": "Olivier Roy", "type": "Adult", "participation": "Whole", "is_new_member": true, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "health", "bed_reason_other": "", "dietary_other": "", "assigned_bed": "Chalet principal, chambre 2, lit double"}]',
   '{"food_requests": {"requests": "gluten_free, none", "notes": ""}, "volunteering": ["food_purchase", "pharmacy"], "volunteering_other": ""}',
   'offer', 3,
   'Robyn, Kaytranada', 'Olivier vient pour la première fois, on a hâte !',
   'paid', 'Payé par virement Interac. Julie a besoin d''un lit (mal de dos) — chambre 2 confirmée.', interval '13 days'),

  -- Marc-André: adult main event only → 139,75 → 140 $, unpaid.
  ('00000000-0000-0000-0000-000000000004',
   '[{"name": "Marc-André Bouchard", "type": "Adult", "participation": "Main", "is_new_member": false, "sleeping_preference": "camping", "sleeping_preference_other": "", "dietary_needs": "vegan", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "vegan", "notes": ""}, "volunteering": ["dj_evening", "setup_friday"], "volunteering_other": ""}',
   '', 0,
   'Set techno samedi soir ?', '',
   'unpaid', NULL, interval '9 days'),

  -- Sophie: 2 returning adults (whole) + teen (main) + kid → 260 + 260 + 69,875 + 0 = 589,875 → 590 $, PAID.
  ('00000000-0000-0000-0000-000000000005',
   '[{"name": "Sophie Tremblay", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "other", "bed_reason": "other", "bed_reason_other": "Enceinte de 7 mois", "dietary_other": "Allergie aux arachides (EpiPen)", "assigned_bed": "Pavillon, chambre 1, lit queen"},
     {"name": "Thomas Lavoie", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "other", "bed_reason_other": "Accompagne Sophie", "dietary_other": "", "assigned_bed": "Pavillon, chambre 1, lit queen"},
     {"name": "Emma Lavoie", "type": "Teenager", "participation": "Main", "is_new_member": false, "sleeping_preference": "sofa", "sleeping_preference_other": "", "dietary_needs": "gluten_free", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""},
     {"name": "Noah Lavoie", "type": "Kid", "participation": "After-Party", "is_new_member": false, "sleeping_preference": "floor", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "other, none, gluten_free, none", "notes": "Allergie aux arachides (EpiPen)"}, "volunteering": ["neighbor_management", "other"], "volunteering_other": "Atelier de maquillage pour les enfants"}',
   'offer', 1,
   '', 'Allergie sévère aux arachides : merci de l''indiquer aux cuisiniers.',
   'paid', 'Allergie arachides signalée à l''équipe bouffe. Lit queen du pavillon réservé.', interval '11 days'),

  -- Karim: new-member adult (whole → main) + new-member teen (whole → main) → 139,75 + 69,875 = 209,625 → 210 $, unpaid.
  ('00000000-0000-0000-0000-000000000006',
   '[{"name": "Karim Benali", "type": "Adult", "participation": "Whole", "is_new_member": true, "sleeping_preference": "outside_other", "sleeping_preference_other": "Van aménagé dans le stationnement", "dietary_needs": "other", "bed_reason": "", "bed_reason_other": "", "dietary_other": "Halal", "assigned_bed": ""},
     {"name": "Yasmine Benali", "type": "Teenager", "participation": "Whole", "is_new_member": true, "sleeping_preference": "outside_other", "sleeping_preference_other": "Van aménagé dans le stationnement", "dietary_needs": "other", "bed_reason": "", "bed_reason_other": "", "dietary_other": "Halal", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "other, other", "notes": "Halal, Halal"}, "volunteering": ["parking"], "volunteering_other": ""}',
   '', 0,
   'Musique gnawa ?', 'Première Bédaine pour nous deux ! Est-ce qu''on peut brancher le van ?',
   'unpaid', 'Vérifier avec Khaled pour la place du van.', interval '3 days'),

  -- Émilie: returning adult (whole) + returning adult (main) → 260 + 139,75 = 399,75 → 400 $, unpaid.
  ('00000000-0000-0000-0000-000000000007',
   '[{"name": "Émilie Côté", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "vegetarian", "bed_reason": "comfort", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""},
     {"name": "Gabriel Côté", "type": "Adult", "participation": "Main", "is_new_member": false, "sleeping_preference": "camping", "sleeping_preference_other": "", "dietary_needs": "vegetarian", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "vegetarian, vegetarian", "notes": ""}, "volunteering": ["art_initiative", "dj_afternoon"], "volunteering_other": ""}',
   'need', 0,
   'Beach House, Men I Trust', 'Gabriel arrive seulement le samedi matin.',
   'unpaid', NULL, interval '6 days')
) AS p(user_id, attendees, logistics, transport_type, seats, music, message, payment_status, admin_notes, age)
WHERE e.id = '00000000-0000-0000-0000-00000000e002';

-- ---------------------------------------------------------------------------------------------
-- Registrations on the ARCHIVED event (selling price 220 $ → 110 $ per point), all paid, so
-- user_event_history / profile history has past editions for Test Member and Julie.
-- ---------------------------------------------------------------------------------------------

INSERT INTO public.user_parties (
  user_id, event_id, attendees, logistics, transport,
  music_requests, message_to_organizers, status, payment_status, created_at, last_edited_at
)
SELECT
  p.user_id::uuid, e.id, p.attendees::jsonb, p.logistics::jsonb,
  '{"type": "", "seats": 0, "arrival": "", "departure": ""}'::jsonb,
  '', '', 'registered', 'paid',
  e.reg_start_date + p.days_after_open, e.reg_start_date + p.days_after_open
FROM public.events e
CROSS JOIN (VALUES
  -- Test Member: adult (whole) → 220 $.
  ('00000000-0000-0000-0000-000000000001',
   '[{"name": "Test Member", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "floor", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "none", "notes": ""}, "volunteering": ["cook_meal"], "volunteering_other": ""}',
   3),
  -- Julie: adult (whole) + new-member adult (main) → 220 + 118,25 = 338,25 → 339 $.
  ('00000000-0000-0000-0000-000000000003',
   '[{"name": "Julie Gagnon", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "bed", "sleeping_preference_other": "", "dietary_needs": "gluten_free", "bed_reason": "health", "bed_reason_other": "", "dietary_other": "", "assigned_bed": "Chambre 3"},
     {"name": "Marie-Ève Gagnon", "type": "Adult", "participation": "Main", "is_new_member": true, "sleeping_preference": "sofa", "sleeping_preference_other": "", "dietary_needs": "none", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "gluten_free, none", "notes": ""}, "volunteering": ["food_purchase"], "volunteering_other": ""}',
   5),
  -- Nicolas: adult (whole) → 220 $.
  ('00000000-0000-0000-0000-000000000008',
   '[{"name": "Nicolas Pelletier", "type": "Adult", "participation": "Whole", "is_new_member": false, "sleeping_preference": "camping", "sleeping_preference_other": "", "dietary_needs": "vegan", "bed_reason": "", "bed_reason_other": "", "dietary_other": "", "assigned_bed": ""}]',
   '{"food_requests": {"requests": "vegan", "notes": ""}, "volunteering": ["dj_evening"], "volunteering_other": ""}',
   8)
) AS p(user_id, attendees, logistics, days_after_open)
WHERE e.id = '00000000-0000-0000-0000-00000000e001';

-- ---------------------------------------------------------------------------------------------
-- App feedback: one open, one resolved
-- ---------------------------------------------------------------------------------------------

INSERT INTO public.app_feedback (user_id, content, is_resolved, created_at, resolved_at) VALUES
  ('00000000-0000-0000-0000-000000000006',
   'Sur mobile, le bouton « Ajouter un participant » est caché derrière le clavier.',
   false, now() - interval '2 days', NULL),
  ('00000000-0000-0000-0000-000000000003',
   'Le montant affiché ne changeait pas quand je cochais « nouveau membre ».',
   true, now() - interval '10 days', now() - interval '8 days');
