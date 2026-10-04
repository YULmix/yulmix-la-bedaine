// Generates the fake demo data for the Preview database (and, opt-in, the local one) as SQL.
// Knobs live in supabase/preview-seed.json; the same config + seed always yields the same data.
// Dates are emitted relative to current_date, so the data never goes stale.
//
// Runs during `supabase db reset` after the migrations and supabase/seed.sql (which creates
// member@test.local ...0001, admin@test.local ...0002, committee@test.local ...0003 and
// organiser@test.local ...0004). Registrations go through
// save_registration(), so calculated_amount_owed and is_waitlisted come from the database, profiles
// from handle_new_user(). The last statement installs the Preview-only "new accounts are admins"
// trigger, after the seeded users exist so they stay regular members.
//
// Option values come from ./options.js, which mirrors src/lib/registrationOptions.ts (Node can't
// import that file as-is: it imports JSON); options.test.js fails if they drift apart.

import { Faker, base, en, fr, fr_CA } from '@faker-js/faker';
import { OPTION_VALUES } from './options.js';

export const TEST_MEMBER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_MEMBER_NAME = 'Test Member';
// Bedrooms each event has, with a double bed in each (#113).
const ROOMS = 8;

const THEMES = [
  'La Bédaine Tropicale', 'La Bédaine des Couleurs', 'La Bédaine Disco', 'La Bédaine Western',
  'La Bédaine Cosmique', 'La Bédaine Pyjama', 'La Bédaine Années 80', 'La Bédaine Forestière'
];
// Each with roughly where it is (its centre): the venue's coordinates, for carpool detours (#180).
const TOWN_COORDINATES = {
  'Saint-Donat': [46.3197, -74.2214],
  'Lac-Supérieur': [46.2010, -74.4690],
  'Mont-Tremblant': [46.1185, -74.5962],
  'Val-David': [46.0300, -74.2080],
  'Sainte-Adèle': [45.9500, -74.1333],
  'Saint-Côme': [46.2667, -73.7833],
  'Lac-des-Plages': [46.0000, -74.9333]
};
const TOWNS = Object.keys(TOWN_COORDINATES);
const DESCRIPTIONS = [
  'Trois jours de musique, de baignade et de bouffe partagée au bord du lac. Les enfants sont les bienvenus !',
  'Randonnée dans les couleurs, sauna et soirée électro au coin du feu.',
  'Une fin de semaine de danse, de jeux et de repas collectifs dans un grand chalet.'
];
const INSTRUCTIONS = [
  'Arrivée à partir de 16 h le vendredi. Apportez vos draps et une lampe frontale.\nStationnement limité : pensez au covoiturage !',
  'Apportez votre sac de couchage, votre maillot et votre bonne humeur. Départ le dimanche à 14 h.'
];
const SLEEPING_OTHER = ['Van aménagé dans le stationnement', 'Tente-roulotte', 'Chez des amis au village', 'Motel à 5 minutes'];
const BED_REASON_OTHER = ['Enceinte', 'Accompagne une personne à mobilité réduite', 'Opération récente au genou', 'Dort mal par terre'];
const DIETARY_OTHER = ['Allergie aux arachides (EpiPen)', 'Halal', 'Sans lactose', 'Allergie aux fruits de mer', 'Cétogène'];
const VOLUNTEERING_OTHER = ['Atelier de maquillage pour les enfants', 'Cours de yoga le samedi matin', 'Photographe officiel'];
const MUSIC = ['Daft Punk', 'Charlotte Cardin', 'Robyn', 'Kaytranada', 'Men I Trust', 'Beach House', 'Les Cowboys Fringants', 'Set techno samedi soir ?', 'Musique gnawa ?'];
const MESSAGES = [
  'Première Bédaine pour nous, on a hâte !',
  'On arrive seulement le samedi matin.',
  'Est-ce qu\'on peut brancher un véhicule électrique sur place ?',
  'Merci pour l\'organisation, c\'est toujours magique.',
  'On aimerait dormir près des autres familles.'
];
const ADMIN_NOTES = [
  'Payé par virement Interac.',
  'Allergie signalée à l\'équipe bouffe.',
  'Vérifier la place de stationnement pour le van.',
  'Lit réservé au pavillon.',
  'Relancer pour le paiement la semaine prochaine.'
];
const FEEDBACK = [
  'Sur mobile, le bouton « Ajouter un participant » est caché derrière le clavier.',
  'Le montant affiché ne changeait pas quand je cochais « nouveau membre ».',
  'Ce serait pratique de pouvoir télécharger la liste des participants de ma chambre.',
  'La page met du temps à charger sur mon vieux téléphone.'
];
// Budget lines (event_budgets, admin-only, #109): category, description, share of the total cost.
const COST_CATEGORIES = [
  ['Chalet', 'Location du chalet', 0.55],
  ['Food', 'Épicerie et repas', 0.25],
  ['Music', 'Sono et DJ', 0.1],
  ['Tech', 'Éclairage et rallonges', 0.05],
  ['Accessories', 'Décorations', 0.05]
];

const ACTIVE_EVENT_START_DAYS = 56; // about 8 weeks out
const ACTIVE_REG_OPENED_DAYS_AGO = 14;
const REG_CLOSE_WEEKS = 2; // so the close date is ~6 weeks away and nothing is locked

// ---------------------------------------------------------------------------------------------
// Config

export const DEFAULT_CONFIG = {
  seed: 20260927,
  members: 40,
  activeEvent: { registrations: 25, maxAttendees: 70, sellingPrice: 260, paidShare: 0.5 },
  pastEvents: { count: 2, registrationsEach: 15, sellingPrice: 220 },
  parties: { minSize: 1, maxSize: 4, newMemberShare: 0.15, teenShare: 0.2, kidShare: 0.2 },
  emails: { failed: 2, pending: 1, promotedShare: 0.1 }
};

// What Resend answers for a refused address, as the Edge Function stores it (`${status} ${body}`).
const RESEND_ERROR = '422 {"statusCode":422,"message":"Invalid `to` field. The email address needs to follow the `email@example.com` format.","name":"validation_error"}';

export function validateConfig(config) {
  const errors = [];
  const { members, activeEvent, pastEvents, parties } = config;
  const isInt = (value, min) => Number.isInteger(value) && value >= min;
  const isShare = (value) => typeof value === 'number' && value >= 0 && value <= 1;
  if (!isInt(config.seed, 0)) errors.push('seed must be a non-negative integer');
  if (!isInt(members, 0)) errors.push('members must be a non-negative integer');
  if (!isInt(activeEvent?.registrations, 0)) errors.push('activeEvent.registrations must be a non-negative integer');
  // +1: Test Member registers too
  if (activeEvent?.registrations > members + 1) errors.push('activeEvent.registrations can be at most members + 1');
  if (!isInt(activeEvent?.maxAttendees, 0)) errors.push('activeEvent.maxAttendees must be a non-negative integer (0 = no limit)');
  if (!(activeEvent?.sellingPrice > 0)) errors.push('activeEvent.sellingPrice must be > 0');
  if (!isShare(activeEvent?.paidShare)) errors.push('activeEvent.paidShare must be between 0 and 1');
  if (!isInt(pastEvents?.count, 0)) errors.push('pastEvents.count must be a non-negative integer');
  if (!isInt(pastEvents?.registrationsEach, 0)) errors.push('pastEvents.registrationsEach must be a non-negative integer');
  if (pastEvents?.registrationsEach > members + 1) errors.push('pastEvents.registrationsEach can be at most members + 1');
  if (!(pastEvents?.sellingPrice > 0)) errors.push('pastEvents.sellingPrice must be > 0');
  if (!isInt(parties?.minSize, 1) || !isInt(parties?.maxSize, parties?.minSize ?? 1)) {
    errors.push('parties.minSize must be >= 1 and parties.maxSize >= parties.minSize');
  }
  for (const key of ['newMemberShare', 'teenShare', 'kidShare']) {
    if (!isShare(parties?.[key])) errors.push(`parties.${key} must be between 0 and 1`);
  }
  if (parties?.teenShare + parties?.kidShare > 1) errors.push('parties.teenShare + parties.kidShare must be <= 1');
  const { emails } = config;
  if (!isInt(emails?.failed, 0)) errors.push('emails.failed must be a non-negative integer');
  if (!isInt(emails?.pending, 0)) errors.push('emails.pending must be a non-negative integer');
  // Test Member never gets a problem email, so it can't take one of these.
  if (emails?.failed + emails?.pending > Math.max((activeEvent?.registrations ?? 0) - 1, 0)) {
    errors.push('emails.failed + emails.pending can be at most activeEvent.registrations - 1');
  }
  if (!isShare(emails?.promotedShare)) errors.push('emails.promotedShare must be between 0 and 1');
  if (errors.length) throw new Error(`Invalid preview seed config:\n  - ${errors.join('\n  - ')}`);
  return config;
}

// ---------------------------------------------------------------------------------------------
// SQL helpers

const lit = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const jsonb = (value) => `${lit(JSON.stringify(value))}::jsonb`;
const dateExpr = (daysFromToday) => `(current_date + ${daysFromToday})`;
// An event's start or registration opening (timestamptz since #149): that day, at that time, in
// Toronto, the zone event dates are read in.
const eventAtExpr = (daysFromToday, time = '00:00') => `((current_date + ${daysFromToday}) + time '${time}') AT TIME ZONE 'America/Toronto'`;

// ---------------------------------------------------------------------------------------------
// Generation

function makeFaker(seed) {
  const faker = new Faker({ locale: [fr_CA, fr, en, base] });
  faker.seed(seed);
  return faker;
}

function emailFor(first, last, taken) {
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
  const stem = `${slug(first)}.${slug(last)}`;
  let email = `${stem}@test.local`;
  for (let n = 2; taken.has(email); n++) email = `${stem}${n}@test.local`;
  taken.add(email);
  return email;
}

function generateMembers(faker, count) {
  const taken = new Set(['member@test.local', 'admin@test.local', 'committee@test.local', 'organiser@test.local']);
  return Array.from({ length: count }, () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      id: faker.string.uuid(),
      email: emailFor(firstName, lastName, taken),
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      joinedDaysAgo: faker.number.int({ min: 10, max: 900 })
    };
  });
}

function generateAttendee(faker, { name, type, partiesConfig, paid }) {
  const isKid = type === 'Kid';
  const sleeping = faker.helpers.weightedArrayElement([
    { value: 'camping', weight: 3 }, { value: 'floor', weight: 2 }, { value: 'bed', weight: 3 },
    { value: 'sofa', weight: 1 }, { value: 'outside_other', weight: 1 }
  ]);
  const bedReason = sleeping === 'bed' ? faker.helpers.arrayElement(OPTION_VALUES.bedReason) : '';
  // Several needs per attendee (#153): sometimes a second one, never with « none ».
  const firstNeed = faker.helpers.weightedArrayElement([
    { value: 'none', weight: 12 }, { value: 'vegetarian', weight: 3 }, { value: 'vegan', weight: 2 },
    { value: 'gluten_free', weight: 1 }, { value: 'dairy_free', weight: 1 }, { value: 'other', weight: 2 }
  ]);
  const secondNeed = firstNeed !== 'none' && faker.datatype.boolean({ probability: 0.25 })
    ? faker.helpers.arrayElement(['gluten_free', 'dairy_free'].filter(value => value !== firstNeed))
    : null;
  const dietary = secondNeed ? [firstNeed, secondNeed] : [firstNeed];
  return {
    name,
    type,
    participation: isKid ? 'After-Party' : faker.helpers.weightedArrayElement([{ value: 'Whole', weight: 7 }, { value: 'Main', weight: 3 }]),
    is_new_member: !isKid && faker.datatype.boolean({ probability: partiesConfig.newMemberShare }),
    sleeping_preference: sleeping,
    sleeping_preference_other: sleeping === 'outside_other' ? faker.helpers.arrayElement(SLEEPING_OTHER) : '',
    dietary_needs: dietary,
    dietary_other: dietary.includes('other') ? faker.helpers.arrayElement(DIETARY_OTHER) : '',
    bed_reason: bedReason,
    bed_reason_other: bedReason === 'other' ? faker.helpers.arrayElement(BED_REASON_OTHER) : '',
    // Not an attendee field: the room an admin puts them in, as a place assignment below (#114).
    room: sleeping === 'bed' && paid && faker.datatype.boolean({ probability: 0.6 })
      ? `Chambre ${faker.number.int({ min: 1, max: ROOMS })}`
      : ''
  };
}

function generateParty(faker, { member, partiesConfig, paid }) {
  const size = faker.number.int({ min: partiesConfig.minSize, max: partiesConfig.maxSize });
  const attendees = [generateAttendee(faker, { name: member.fullName, type: 'Adult', partiesConfig, paid })];
  for (let i = 1; i < size; i++) {
    const roll = faker.number.float({ min: 0, max: 1 });
    const type = roll < partiesConfig.kidShare ? 'Kid' : roll < partiesConfig.kidShare + partiesConfig.teenShare ? 'Teenager' : 'Adult';
    const lastName = type === 'Adult' && faker.datatype.boolean({ probability: 0.4 }) ? faker.person.lastName() : member.lastName;
    attendees.push(generateAttendee(faker, { name: `${faker.person.firstName()} ${lastName}`, type, partiesConfig, paid }));
  }
  const volunteering = faker.helpers.arrayElements(OPTION_VALUES.volunteering, { min: 0, max: 2 });
  return {
    attendees,
    logistics: {
      volunteering,
      volunteering_other: volunteering.includes('other') ? faker.helpers.arrayElement(VOLUNTEERING_OTHER) : ''
    },
    transportType: faker.helpers.weightedArrayElement([{ value: '', weight: 5 }, { value: 'offer', weight: 2 }, { value: 'need', weight: 2 }]),
    seats: faker.number.int({ min: 1, max: 4 }),
    music: faker.datatype.boolean({ probability: 0.5 }) ? faker.helpers.arrayElements(MUSIC, { min: 1, max: 2 }).join(', ') : '',
    message: faker.datatype.boolean({ probability: 0.3 }) ? faker.helpers.arrayElement(MESSAGES) : '',
    adminNotes: faker.datatype.boolean({ probability: 0.2 }) ? faker.helpers.arrayElement(ADMIN_NOTES) : null,
    paymentStatus: paid ? 'paid' : 'unpaid',
    departure: generateDeparture(faker)
  };
}

// Where a lift leaves from (#181). Like real data, not everyone gives it: some registered before
// the field existed, so a fifth have no postal code, and half leave no note.
function generateDeparture(faker) {
  const [fsa, note] = faker.helpers.weightedArrayElement(OPTION_VALUES.departures.map(([code, text, weight]) => ({ value: [code, text], weight })));
  return {
    fsa: faker.datatype.boolean({ probability: 0.8 }) ? fsa : '',
    note: faker.datatype.boolean({ probability: 0.5 }) ? note : ''
  };
}

function generateEvent(faker, { id, theme, active, startDays, sellingPrice, maxAttendees }) {
  const totalCost = Math.round(sellingPrice * faker.number.int({ min: 30, max: 40 }) / 100) * 100;
  return {
    id,
    theme,
    active,
    description: faker.helpers.arrayElement(DESCRIPTIONS),
    venue: `${faker.number.int({ min: 100, max: 3999 })} chemin du Lac, ${faker.helpers.arrayElement(TOWNS)}, QC`,
    startDays,
    regStartDays: active ? -ACTIVE_REG_OPENED_DAYS_AGO : startDays - 60,
    sellingPrice,
    budgetLines: COST_CATEGORIES.map(([category, description, share]) => ({ category, description, amount: Math.round(totalCost * share) })),
    maxAttendees,
    instructions: active ? faker.helpers.arrayElement(INSTRUCTIONS) : 'Événement terminé.'
  };
}

// Picks `count` registrants from Test Member + the generated members; Test Member always first
// so there's a known account with a registration.
function pickRegistrants(faker, members, count, testMember) {
  if (count === 0) return [];
  return [testMember, ...faker.helpers.shuffle(members).slice(0, count - 1)];
}

export function generatePreviewSeed(config = DEFAULT_CONFIG, seedOverride) {
  validateConfig(config);
  const seed = seedOverride ?? config.seed;
  const faker = makeFaker(seed);
  const testMember = { id: TEST_MEMBER_ID, fullName: TEST_MEMBER_NAME, lastName: 'Member' };

  const members = generateMembers(faker, config.members);

  const usedThemes = faker.helpers.shuffle(THEMES);
  const activeEvent = generateEvent(faker, {
    id: faker.string.uuid(),
    theme: usedThemes[0],
    active: true,
    startDays: ACTIVE_EVENT_START_DAYS,
    sellingPrice: config.activeEvent.sellingPrice,
    maxAttendees: config.activeEvent.maxAttendees
  });
  const pastEvents = Array.from({ length: config.pastEvents.count }, (_, i) => generateEvent(faker, {
    id: faker.string.uuid(),
    theme: `${usedThemes[(i + 1) % usedThemes.length]} ${new Date().getFullYear() - 1 - i}`,
    active: false,
    startDays: -330 - i * 365,
    sellingPrice: config.pastEvents.sellingPrice,
    maxAttendees: 0
  }));
  // Venues are shared (#145): this edition is back at last year's.
  if (pastEvents.length) activeEvent.venue = pastEvents[0].venue;

  const registrations = [];
  for (const registrant of pickRegistrants(faker, members, config.activeEvent.registrations, testMember)) {
    const paid = faker.datatype.boolean({ probability: config.activeEvent.paidShare });
    registrations.push({ event: activeEvent, userId: registrant.id, daysAgo: faker.number.int({ min: 0, max: ACTIVE_REG_OPENED_DAYS_AGO }),
      ...generateParty(faker, { member: registrant, partiesConfig: config.parties, paid }) });
  }
  for (const event of pastEvents) {
    for (const registrant of pickRegistrants(faker, members, config.pastEvents.registrationsEach, testMember)) {
      registrations.push({ event, userId: registrant.id, daysAgo: -(event.regStartDays + faker.number.int({ min: 1, max: 30 })),
        ...generateParty(faker, { member: registrant, partiesConfig: config.parties, paid: true }) });
    }
  }

  // Email history (email_log, #93). Which templates each party got is decided in SQL from its
  // final state (the triggers decide who is waitlisted); here we only pick who was promoted off
  // the waitlist and whose email went wrong. Never Test Member: its summary is the happy path.
  const activeRegs = registrations.filter((r) => r.event === activeEvent);
  const problemRegs = faker.helpers.shuffle(activeRegs.filter((r) => r.userId !== TEST_MEMBER_ID))
    .slice(0, config.emails.failed + config.emails.pending);
  problemRegs.forEach((r, i) => { r.emailProblem = i < config.emails.failed ? 'failed' : 'pending'; });
  for (const r of activeRegs) r.promoted = faker.datatype.boolean({ probability: config.emails.promotedShare });
  const emailAccounts = problemRegs.map((r) => ({ status: r.emailProblem, email: members.find((m) => m.id === r.userId)?.email }));

  const feedbackAuthors = faker.helpers.arrayElements([testMember, ...members], { min: 1, max: 3 });
  const feedback = feedbackAuthors.map((author, i) => ({
    userId: author.id,
    content: FEEDBACK[i % FEEDBACK.length],
    resolved: i === 1,
    daysAgo: faker.number.int({ min: 1, max: 20 })
  }));

  return renderSql({ seed, config, members, activeEvent, pastEvents, registrations, feedback, emailAccounts });
}

// ---------------------------------------------------------------------------------------------
// Rendering

function renderSql({ seed, config, members, activeEvent, pastEvents, registrations, feedback, emailAccounts }) {
  const out = [];
  out.push(`-- GENERATED by scripts/preview-seed/generate.mjs (seed ${seed}) from supabase/preview-seed.json.
-- Fake demo data, never for production. Do not edit: change the config and regenerate.
-- Config: ${JSON.stringify(config)}
`);

  if (members.length) {
    out.push(`-- ${members.length} fake members, password "password123" (profiles come from handle_new_user())
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
  crypt('password123', gen_salt('bf')), now(), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
  now() - make_interval(days => u.age), now() - make_interval(days => u.age), '', '', '', ''
FROM (VALUES
${members.map((m) => `  (${lit(m.id)}, ${lit(m.email)}, ${lit(m.fullName)}, ${m.joinedDaysAgo})`).join(',\n')}
) AS u(id, email, full_name, age);

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
FROM auth.users u
WHERE u.id IN (${members.map((m) => `${lit(m.id)}`).join(', ')});
`);
  }

  // Past events first: only_one_active_event allows any number of inactive ones.
  const events = [...pastEvents, activeEvent];
  // One venue per address, named after its town; archived unless the active event is there.
  const venues = [...new Set(events.map((e) => e.venue))].map((address) => ({
    address,
    name: `Chalet ${address.split(', ')[1]}`,
    coordinates: TOWN_COORDINATES[address.split(', ')[1]],
    archived: address !== activeEvent.venue
  }));
  const venueAddresses = venues.map((v) => lit(v.address)).join(', ');
  out.push(`-- Venues (#145)
INSERT INTO public.venues (name, address, lat, lng, archived_at) VALUES
${venues.map((v) => `  (${lit(v.name)}, ${lit(v.address)}, ${v.coordinates.join(', ')}, ${v.archived ? 'now()' : 'NULL'})`).join(',\n')};
`);
  out.push(`-- Events: ${pastEvents.length} archived + 1 active (registration open, event in ${ACTIVE_EVENT_START_DAYS} days)
INSERT INTO public.events (
  id, theme, description, venue_id, duration_days, points_of_contact,
  z_intent_months, x_reg_close_weeks, reg_start_date, event_start_date,
  status, is_active, is_reg_open, selling_price_whole_event, max_attendees,
  external_links, instructions, created_at
) VALUES
${events.map((e) => `  (${lit(e.id)}, ${lit(e.theme)}, ${lit(e.description)}, (SELECT id FROM public.venues WHERE address = ${lit(e.venue)}), 3,
   'Inscriptions (Simon), Bénévolat (Dave), Nourriture (Melina), Stationnement (Khaled), Premiers soins (Mach)',
   2, ${REG_CLOSE_WEEKS}, ${eventAtExpr(e.regStartDays, '12:00')}, ${eventAtExpr(e.startDays, '18:00')},
   ${lit(e.active ? 'ACTIVE' : 'ARCHIVED')}, ${e.active}, ${e.active}, ${e.sellingPrice}, ${e.maxAttendees},
   ${jsonb([{ label: 'Liste d\'achats', url: 'https://example.com/bedaine/liste-achats' }])}, ${lit(e.instructions)},
   now() + make_interval(days => ${e.regStartDays - 16}))`).join(',\n')};

-- Budgets (total_cost is computed by the event_budgets trigger)
INSERT INTO public.event_budgets (event_id, lines) VALUES
${events.map((e) => `  (${lit(e.id)}, ${jsonb(e.budgetLines)})`).join(',\n')};
`);

  if (registrations.length) {
    // Through save_registration(), the app's own write path, one row at a time in registration
    // order: the capacity trigger waitlists whoever arrives once the event is full.
    out.push(`-- ${registrations.length} registrations (amounts and waitlisting computed by the database)`);
    const sorted = [...registrations].sort((a, b) => b.daysAgo - a.daysAgo);
    // Since #246 attendees can only be written through save_registration() on behalf of the
    // signed-in user, so each call runs with that user's JWT claims (auth.uid()) set.
    for (const r of sorted) {
      out.push(`SELECT set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: r.userId, role: 'authenticated' }))}, false);`);
      const transport = r.transportType === ''
        ? `'{"type": "", "seats": 0, "arrival": "", "departure": ""}'::jsonb`
        // Seats offered, or needed (#179: the whole party); where from (#181), when given.
        : `jsonb_build_object('type', ${lit(r.transportType)}, 'seats', ${r.transportType === 'offer' ? r.seats : r.attendees.length},
      'arrival', to_char(${dateExpr(r.event.startDays)} + time '17:30', 'YYYY-MM-DD"T"HH24:MI'),
      'departure', to_char(${dateExpr(r.event.startDays + 2)} + time '14:00', 'YYYY-MM-DD"T"HH24:MI'))
      || ${jsonb({
    ...(r.departure.fsa ? { departure_fsa: r.departure.fsa } : {}),
    ...(r.departure.note ? { departure_place: r.departure.note } : {})
  })}`;
      out.push(`SELECT FROM public.save_registration(${lit(r.event.id)}, ${jsonb(r.attendees)},
  jsonb_build_object('logistics', ${jsonb(r.logistics)}, 'transport', ${transport},
    'music_requests', ${lit(r.music)}, 'message_to_organizers', ${lit(r.message)}),
  ${lit(r.userId)});`);
    }
    out.push(`SELECT set_config('request.jwt.claims', '', false);`);

    // What happened after registering: the date it was made, the admin marking it paid, notes
    // (in their own admin-only table, #227). Set without triggers, so none of it counts as an
    // edit, logs history or changes the amount owed.
    out.push(`
CREATE TEMP TABLE seed_after_registering (user_id uuid, event_id uuid, days_ago int, payment_status text, admin_notes text);
INSERT INTO seed_after_registering VALUES
${sorted.map((r) => `  (${lit(r.userId)}::uuid, ${lit(r.event.id)}::uuid, ${r.daysAgo}, ${lit(r.paymentStatus)}, ${lit(r.adminNotes)})`).join(',\n')};
ALTER TABLE public.user_parties DISABLE TRIGGER USER;
UPDATE public.user_parties p
SET created_at = now() - make_interval(days => v.days_ago),
    last_edited_at = now() - make_interval(days => v.days_ago),
    payment_status = v.payment_status
FROM seed_after_registering v
WHERE p.user_id = v.user_id AND p.event_id = v.event_id;
ALTER TABLE public.user_parties ENABLE TRIGGER USER;
ALTER TABLE public.party_admin_notes DISABLE TRIGGER USER;
INSERT INTO public.party_admin_notes (party_id, notes)
SELECT p.id, v.admin_notes
FROM seed_after_registering v
JOIN public.user_parties p ON p.user_id = v.user_id AND p.event_id = v.event_id
WHERE COALESCE(v.admin_notes, '') <> '';
ALTER TABLE public.party_admin_notes ENABLE TRIGGER USER;
DROP TABLE seed_after_registering;`);

    // Sleeping places (#113): every venue has ROOMS rooms with a double bed, and a yard for tents.
    // Admins put some paid attendees who asked for a bed in a room (#114).
    out.push(`
INSERT INTO public.locations (venue_id, name, sort_order)
SELECT v.id, r.name, r.sort_order
FROM public.venues v
CROSS JOIN (
  SELECT 'Chambre ' || n, n FROM generate_series(1, ${ROOMS}) AS n
  UNION ALL SELECT 'Cour', ${ROOMS + 1}
) AS r(name, sort_order)
WHERE v.address IN (${venueAddresses});

INSERT INTO public.places (location_id, label, type, capacity)
SELECT l.id,
       CASE WHEN l.name = 'Cour' THEN 'Tentes' ELSE 'Lit double' END,
       CASE WHEN l.name = 'Cour' THEN 'camping' ELSE 'bed' END,
       CASE WHEN l.name = 'Cour' THEN 12 ELSE 2 END
FROM public.locations l
JOIN public.venues v ON v.id = l.venue_id
WHERE v.address IN (${venueAddresses});`);

    const rooms = sorted.flatMap((r) => r.attendees
      .map((a, i) => ({ r, position: i + 1, room: a.room }))
      .filter(({ room }) => room));
    if (rooms.length) {
      out.push(`
INSERT INTO public.place_assignments (place_id, attendee_id)
SELECT pl.id, a.id
FROM (VALUES
${rooms.map(({ r, position, room }) => `  (${lit(r.userId)}::uuid, ${lit(r.event.id)}::uuid, ${position}, ${lit(room)})`).join(',\n')}
) AS v(user_id, event_id, position, room)
JOIN public.user_parties p ON p.user_id = v.user_id AND p.event_id = v.event_id
  AND p.status <> 'cancelled' AND NOT p.is_waitlisted
JOIN public.attendees a ON a.party_id = p.id AND a.position = v.position
JOIN public.events e ON e.id = v.event_id
JOIN public.locations l ON l.venue_id = e.venue_id AND l.name = v.room
JOIN public.places pl ON pl.location_id = l.id;`);
    }
    // Past editions keep the layout they had (#148): they were inserted archived, so nothing
    // froze them as archiving does.
    out.push(`
SELECT private.freeze_event_layout(id) FROM public.events WHERE status = 'ARCHIVED' ORDER BY created_at;`);
    out.push('');
  }

  if (registrations.length) {
    out.push(renderEmailLog(activeEvent, registrations, emailAccounts));
  }

  if (feedback.length) {
    out.push(`INSERT INTO public.app_feedback (user_id, content, is_resolved, created_at, resolved_at) VALUES
${feedback.map((f) => `  (${lit(f.userId)}, ${lit(f.content)}, ${f.resolved}, now() - make_interval(days => ${f.daysAgo}), ${f.resolved ? `now() - make_interval(days => ${Math.max(f.daysAgo - 1, 0)})` : 'NULL'})`).join(',\n')};
`);
  }

  // supabase/seed.sql's Comité and Organisateur test users get their role on the active event
  // (#217, ADR 0023), so each rung of the ladder can be tried in a preview.
  out.push(`INSERT INTO public.edition_roles (event_id, user_id, role)
SELECT e.id, r.user_id, r.role
FROM public.events e
CROSS JOIN (VALUES ('00000000-0000-0000-0000-000000000003'::uuid, 'committee'),
                   ('00000000-0000-0000-0000-000000000004'::uuid, 'organiser')) AS r(user_id, role)
WHERE e.is_active AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id)
ON CONFLICT (event_id, user_id) DO NOTHING;
`);

  out.push(`-- Preview only: every account created from now on (i.e. real Google sign-ins) is an admin.
-- Created last so the users seeded above stay regular members. Lives only in this database: a
-- reset drops it and this seed recreates it; no migration knows about it.
CREATE FUNCTION public.preview_new_accounts_are_admins() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.is_admin := true;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.preview_new_accounts_are_admins() IS
  'Preview/demo databases only, installed by scripts/preview-seed/generate.mjs. Never in production.';
CREATE TRIGGER preview_new_accounts_are_admins
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.preview_new_accounts_are_admins();
`);

  return out.join('\n');
}

// The email history each party would have after send-party-email's dueTemplates()
// (supabase/functions/send-party-email/emails.ts), from its final state:
//   - active event: waitlist while waitlisted; otherwise registration (or waitlist then promotion,
//     for the parties picked as promoted), then payment once paid and accommodation once a bed is
//     assigned. All sent, dated between the registration and now, except the picked problem
//     emails (failed: Resend refused it; pending: claimed, never finished), which hit the latest
//     email the party got.
//   - past events: backfilled, as the migration that created email_log recorded them.
// ON CONFLICT: where the local edge runtime is up (db:local:demo), it may have logged dry_run
// rows for these parties already; the demo history replaces them.
function renderEmailLog(activeEvent, registrations, emailAccounts) {
  const active = registrations.filter((r) => r.event === activeEvent);
  const flags = active.map((r) => `  (${lit(r.userId)}::uuid, ${r.promoted}, ${lit(r.emailProblem ?? null)})`).join(',\n');
  return `-- Email history (email_log). Problem emails, to see them as that member (password "password123"):
${emailAccounts.map((a) => `--   ${a.status}: ${a.email}`).join('\n') || '--   none'}
WITH flags (user_id, promoted, problem) AS (VALUES
${flags}
),
parties AS (
  SELECT p.id, p.created_at, pr.email, f.promoted, f.problem, p.is_waitlisted,
         p.payment_status = 'paid' AS paid,
         EXISTS (SELECT 1 FROM public.attendee_places ap WHERE ap.party_id = p.id) AS has_bed
  FROM public.user_parties p
  JOIN public.profiles pr ON pr.id = p.user_id
  JOIN flags f ON f.user_id = p.user_id
  WHERE p.event_id = ${lit(activeEvent.id)}
),
emails AS (
  SELECT p.*, t.template, t.step,
         p.created_at + (now() - p.created_at) * t.progress AS sent_at
  FROM parties p
  CROSS JOIN LATERAL (VALUES
    ('waitlist', 1, 0.0, p.is_waitlisted OR p.promoted),
    ('registration', 1, 0.0, NOT p.is_waitlisted AND NOT p.promoted),
    ('promotion', 2, 0.3, NOT p.is_waitlisted AND p.promoted),
    ('payment', 3, 0.6, NOT p.is_waitlisted AND p.paid),
    ('accommodation', 4, 0.8, NOT p.is_waitlisted AND p.has_bed)
  ) AS t(template, step, progress, applies)
  WHERE t.applies
),
ranked AS (
  SELECT e.*, e.step = max(e.step) OVER (PARTITION BY e.id) AS is_latest FROM emails e
)
INSERT INTO public.email_log (party_id, template, status, recipient, resend_id, error, created_at, updated_at)
SELECT id, template,
       CASE WHEN is_latest AND problem IS NOT NULL THEN problem ELSE 'sent' END,
       email,
       CASE WHEN is_latest AND problem IS NOT NULL THEN NULL ELSE gen_random_uuid()::text END,
       CASE WHEN is_latest AND problem = 'failed' THEN ${lit(RESEND_ERROR)} END,
       sent_at, sent_at
FROM ranked
ON CONFLICT (party_id, template) DO UPDATE
  SET status = EXCLUDED.status, recipient = EXCLUDED.recipient, resend_id = EXCLUDED.resend_id,
      error = EXCLUDED.error, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

INSERT INTO public.email_log (party_id, template, status, created_at, updated_at)
SELECT p.id, t.template, 'backfilled', p.created_at, p.created_at
FROM public.user_parties p
JOIN public.events e ON e.id = p.event_id AND NOT e.is_active
CROSS JOIN LATERAL (VALUES
  ('registration', NOT p.is_waitlisted),
  ('waitlist', p.is_waitlisted),
  ('payment', p.payment_status = 'paid'),
  ('accommodation', EXISTS (SELECT 1 FROM public.attendee_places ap WHERE ap.party_id = p.id))
) AS t(template, applies)
WHERE t.applies
ON CONFLICT (party_id, template) DO NOTHING;
`;
}
