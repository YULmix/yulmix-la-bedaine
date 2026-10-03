// The registration form's model (#194): its state, read from a saved party (fromParty), turned
// into what save_registration takes (toSavePayload), changed only through registrationReducer,
// which owns every rule between fields, and checked by validate. Pure: no React, no Supabase
// (registration.test.js). Adding a party-level field means the state below, fromParty,
// toSavePayload, validate if it has a rule, and its input; nothing else.
import fr from '../locales/fr.json';
import { dietaryNeedsOf, nextDietaryNeeds } from './registrationOptions';
import { isValidFsa, normalizeFsa } from './postalCode.js';

/** One person in the form. `id` is the attendees row's once saved, a temporary key before. */
export interface FormAttendee {
  id: string;
  name: string;
  type: string;
  participation: string;
  isNewMember: boolean;
  sleepingPreference: string;
  sleepingPreferenceOther: string;
  dietaryNeeds: string[];
  bedReason: string;
  bedReasonOther: string;
  dietaryOther: string;
  isSaved?: boolean;
}

/** The registration form's whole state: what a draft keeps, and what saving reads. */
export interface RegistrationFormState {
  attendees: FormAttendee[];
  sameForEveryone: boolean;
  transportType: string;
  transportSeats: number;
  transportArrival: string;
  transportDeparture: string;
  transportDepartureFsa: string;
  transportDeparturePlace: string;
  volunteeringSelections: string[];
  volunteeringOtherDetail: string;
  musicRequests: string;
  messageToOrganizers: string;
}

/** What the form reads of a saved registration: a party with its attendees (parties.ts). */
export interface SavedRegistration {
  attendees?: Array<{
    id: string;
    name?: string | null;
    type?: string | null;
    participation?: string | null;
    is_new_member?: boolean | null;
    sleeping_preference?: string | null;
    sleeping_preference_other?: string | null;
    dietary_needs?: string[] | string | null;
    bed_reason?: string | null;
    bed_reason_other?: string | null;
    dietary_other?: string | null;
  }> | null;
  transport?: {
    type?: string | null;
    seats?: number | null;
    arrival?: string | null;
    departure?: string | null;
    departure_fsa?: string | null;
    departure_place?: string | null;
  } | null;
  logistics?: { volunteering?: string[] | null; volunteering_other?: string | null } | null;
  music_requests?: string | null;
  message_to_organizers?: string | null;
}

/** The event's first and last day, as datetime-local values, for arrival and departure (#123). */
export interface TravelRange {
  defaultArrival?: string;
  defaultDeparture?: string;
}

// Per-attendee choices that "mêmes choix pour tout le monde" copies to everyone.
export const LOGISTICS_FIELDS = ['sleepingPreference', 'sleepingPreferenceOther', 'dietaryNeeds', 'bedReason', 'bedReasonOther', 'dietaryOther'] as const satisfies ReadonlyArray<keyof FormAttendee>;
// dietaryNeeds is an array, so compare by value.
export const sameChoice = (a: unknown, b: unknown): boolean => (Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

export const newAttendee = (id: string): FormAttendee => ({
  id,
  name: '',
  type: 'Adult',
  participation: 'Whole',
  isNewMember: false,
  sleepingPreference: '',
  sleepingPreferenceOther: '',
  dietaryNeeds: [],
  bedReason: '',
  bedReasonOther: '',
  dietaryOther: ''
});

const toLocalDateTime = (value: string | null | undefined): string => (value && value.includes('T') ? value.slice(0, 16) : value || '');

/**
 * The form's state for a saved registration, or for a new one when `registration` is null.
 * Arrival and departure fall back to the event's first and last day (#123) when none was saved.
 */
export const fromParty = (registration: SavedRegistration | null | undefined, travelRange: TravelRange = {}): RegistrationFormState => {
  if (!registration?.attendees) {
    return {
      attendees: [newAttendee('attendee-1')],
      sameForEveryone: true,
      transportType: '',
      transportSeats: 0,
      transportArrival: travelRange.defaultArrival || '',
      transportDeparture: travelRange.defaultDeparture || '',
      transportDepartureFsa: '',
      transportDeparturePlace: '',
      volunteeringSelections: [],
      volunteeringOtherDetail: '',
      musicRequests: '',
      messageToOrganizers: ''
    };
  }
  const attendees: FormAttendee[] = registration.attendees.map(attendee => ({
    // The row id: saving with it updates this attendee rather than replacing them.
    id: attendee.id,
    name: attendee.name || '',
    type: attendee.type || 'Adult',
    participation: attendee.participation || 'Whole',
    isNewMember: attendee.is_new_member || false,
    sleepingPreference: attendee.sleeping_preference || '',
    sleepingPreferenceOther: attendee.sleeping_preference_other || '',
    dietaryNeeds: dietaryNeedsOf(attendee.dietary_needs),
    bedReason: attendee.bed_reason || '',
    bedReasonOther: attendee.bed_reason_other || '',
    dietaryOther: attendee.dietary_other || '',
    isSaved: true
  }));
  const [first, ...rest] = attendees;
  return {
    attendees,
    // Only start in "same for everyone" mode if the saved choices really are identical; otherwise
    // the reducer's sync would overwrite everyone's choices with the first attendee's.
    sameForEveryone: rest.every(att => LOGISTICS_FIELDS.every(field => sameChoice(att[field], first[field]))),
    transportType: registration.transport?.type || '',
    // Seats offered, or needed (#179). A need saved before needs had a count is the whole party.
    transportSeats: registration.transport?.seats || (registration.transport?.type === 'need' ? attendees.length : 0),
    transportArrival: toLocalDateTime(registration.transport?.arrival) || travelRange.defaultArrival || '',
    transportDeparture: toLocalDateTime(registration.transport?.departure) || travelRange.defaultDeparture || '',
    transportDepartureFsa: registration.transport?.departure_fsa || '',
    transportDeparturePlace: registration.transport?.departure_place || '',
    volunteeringSelections: registration.logistics?.volunteering || [],
    volunteeringOtherDetail: registration.logistics?.volunteering_other || '',
    musicRequests: registration.music_requests || '',
    messageToOrganizers: registration.message_to_organizers || ''
  };
};

export const DEPARTURE_PLACE_MAX_LENGTH = 100;

const offersOrNeedsLift = (type: string): boolean => type === 'offer' || type === 'need';

/**
 * The form's departure postal code (#181) needs fixing before saving: given, with a lift, but not
 * the start of a Canadian postal code once normalised. Blank is fine (it's optional).
 */
export const departureFsaInvalid = (form: Pick<RegistrationFormState, 'transportType' | 'transportDepartureFsa'>): boolean => offersOrNeedsLift(form.transportType)
  && !!normalizeFsa(form.transportDepartureFsa)
  && !isValidFsa(normalizeFsa(form.transportDepartureFsa));

/** The `transport` saved with a registration. */
export type SaveTransport = {
  type: string;
  seats: number;
  arrival: string;
  departure: string;
  departure_fsa?: string;
  departure_place?: string;
};

/**
 * The `transport` to save from the form. Seats and where the lift leaves from (#181: the postal
 * code's start, for matching, and a note for people) only go with an offer or a need.
 */
export const transportOf = (form: Pick<RegistrationFormState, 'transportType' | 'transportSeats' | 'transportArrival' | 'transportDeparture' | 'transportDepartureFsa' | 'transportDeparturePlace'>): SaveTransport => {
  const lift = offersOrNeedsLift(form.transportType);
  const fsa = normalizeFsa(form.transportDepartureFsa);
  const place = (form.transportDeparturePlace || '').trim().slice(0, DEPARTURE_PLACE_MAX_LENGTH);
  return {
    type: form.transportType,
    seats: lift ? form.transportSeats : 0,
    arrival: form.transportArrival,
    departure: form.transportDeparture,
    ...(lift && isValidFsa(fsa) ? { departure_fsa: fsa } : {}),
    ...(lift && place ? { departure_place: place } : {})
  };
};

/** One attendee as save_registration takes it. `id` only for one already saved. */
export type SaveAttendee = {
  id?: string;
  name: string;
  type: string;
  participation: string;
  is_new_member: boolean;
  sleeping_preference: string;
  sleeping_preference_other: string;
  dietary_needs: string[];
  bed_reason: string;
  bed_reason_other: string;
  dietary_other: string;
};

/** The party-wide answers save_registration takes; everything about a person is on their attendee. */
export type SaveParty = {
  logistics: { volunteering: string[]; volunteering_other: string };
  transport: SaveTransport;
  music_requests: string;
  message_to_organizers: string;
};

/** The `attendees` and `party` of parties.ts's saveRegistration. */
export interface SavePayload {
  attendees: SaveAttendee[];
  party: SaveParty;
}

/**
 * What saving the form sends. A saved attendee keeps its id, so it's updated rather than replaced;
 * the bed an admin assigned stays on the attendee, since the form never sends one.
 */
export const toSavePayload = (form: RegistrationFormState): SavePayload => ({
  attendees: form.attendees.map(attendee => ({
    ...(attendee.isSaved ? { id: attendee.id } : {}),
    name: attendee.name.trim(),
    type: attendee.type,
    participation: attendee.participation,
    is_new_member: attendee.isNewMember,
    sleeping_preference: attendee.sleepingPreference,
    sleeping_preference_other: attendee.sleepingPreferenceOther,
    dietary_needs: attendee.dietaryNeeds,
    bed_reason: attendee.bedReason,
    bed_reason_other: attendee.bedReasonOther,
    dietary_other: attendee.dietaryNeeds.includes('other') ? attendee.dietaryOther.trim() : ''
  })),
  party: {
    logistics: {
      volunteering: form.volunteeringSelections,
      volunteering_other: form.volunteeringOtherDetail
    },
    transport: transportOf(form),
    music_requests: form.musicRequests,
    message_to_organizers: form.messageToOrganizers
  }
});

/** The party-level fields an input changes directly (attendees go through their own actions). */
export type PartyFields = Omit<RegistrationFormState, 'attendees'>;
/** The fields of one attendee an input changes (not its id, nor whether it's saved). */
export type AttendeeFields = Omit<FormAttendee, 'id' | 'isSaved'>;

export type RegistrationAction =
  /** A party-level field, or several. A new transport type resets what goes with it. */
  | { type: 'changed'; changes: Partial<PartyFields> }
  /** One attendee's fields. An age pick resets the tier that no longer applies. */
  | { type: 'attendeeChanged'; id: string; changes: Partial<AttendeeFields> }
  /** Sleeping and food choices for the whole group (« mêmes choix pour tout le monde »). */
  | { type: 'groupStayChanged'; changes: Partial<Pick<FormAttendee, typeof LOGISTICS_FIELDS[number]>> }
  /** A new, empty attendee, with this temporary id. */
  | { type: 'attendeeAdded'; id: string }
  | { type: 'attendeeRemoved'; id: string }
  /** The member's name, for the first attendee of a new registration (#133). */
  | { type: 'namePrefilled'; name: string }
  /** The event's first and last day as arrival and departure of a new registration (#123). */
  | { type: 'travelDefaultsApplied'; travelRange: TravelRange }
  /** A different registration came in (or a draft was restored): the form is replaced. */
  | { type: 'replaced'; form: RegistrationFormState };

const isNewRegistration = (form: RegistrationFormState): boolean => !form.attendees.some(attendee => attendee.isSaved);

// Dietary needs (#153) are given as the chips' new selection: « Aucune restriction » goes alone,
// and without « Autre » its text goes too.
const withDietaryRules = <C extends { dietaryNeeds?: string[]; dietaryOther?: string }>(changes: C, previous: string[]): C => {
  if (!changes.dietaryNeeds) return changes;
  const dietaryNeeds = nextDietaryNeeds(previous, changes.dietaryNeeds);
  return dietaryNeeds.includes('other') ? { ...changes, dietaryNeeds } : { ...changes, dietaryNeeds, dietaryOther: '' };
};

// A Kid comes to the after-party (that's their tier); leaving Kid goes back to the whole event.
const withAgeRule = (attendee: FormAttendee): FormAttendee => {
  if (attendee.type === 'Kid') return attendee.participation === 'After-Party' ? attendee : { ...attendee, participation: 'After-Party' };
  return attendee.participation === 'After-Party' ? { ...attendee, participation: 'Whole' } : attendee;
};

const changeAttendee = (attendee: FormAttendee, changes: Partial<AttendeeFields>): FormAttendee => {
  const changed = { ...attendee, ...withDietaryRules(changes, attendee.dietaryNeeds) };
  // On every age pick, the same one again included: a Kid saved on the whole event (possible
  // before the rule) re-picked as Kid goes to the after-party.
  return 'type' in changes ? withAgeRule(changed) : changed;
};

// Offering a lift counts the seats offered; needing one, the seats needed (#179), which starts
// at the party's size: most parties travel together. No lift, no departure place (#181). Fields
// given in the same change as the new type win over these resets.
const transportReset = (form: RegistrationFormState, type: string): Partial<PartyFields> => ({
  transportSeats: type === 'need' ? form.attendees.length : 0,
  ...(offersOrNeedsLift(type) ? {} : { transportDepartureFsa: '', transportDeparturePlace: '' })
});

const changeParty = (form: RegistrationFormState, changes: Partial<PartyFields>): RegistrationFormState => {
  const type = changes.transportType;
  const newType = type !== undefined && type !== form.transportType;
  return { ...form, ...(newType ? transportReset(form, type) : {}), ...changes };
};

// "Mêmes choix pour tout le monde": everyone has the first attendee's sleeping and food choices.
const syncSameForEveryone = (form: RegistrationFormState): RegistrationFormState => {
  if (!form.sameForEveryone || form.attendees.length < 2) return form;
  const [first] = form.attendees;
  if (form.attendees.every(att => LOGISTICS_FIELDS.every(field => sameChoice(att[field], first[field])))) return form;
  const choices = Object.fromEntries(LOGISTICS_FIELDS.map(field => [field, first[field]]));
  return { ...form, attendees: form.attendees.map(att => ({ ...att, ...choices })) };
};

const apply = (form: RegistrationFormState, action: RegistrationAction): RegistrationFormState => {
  switch (action.type) {
    case 'changed':
      return changeParty(form, action.changes);
    case 'attendeeChanged':
      return { ...form, attendees: form.attendees.map(attendee => (attendee.id === action.id ? changeAttendee(attendee, action.changes) : attendee)) };
    case 'groupStayChanged': {
      const changes = withDietaryRules(action.changes, form.attendees[0].dietaryNeeds);
      return { ...form, attendees: form.attendees.map(attendee => ({ ...attendee, ...changes })) };
    }
    case 'attendeeAdded':
      return { ...form, attendees: [...form.attendees, newAttendee(action.id)] };
    case 'attendeeRemoved':
      // Never the last one: a registration has at least one attendee.
      if (form.attendees.length < 2 || !form.attendees.some(attendee => attendee.id === action.id)) return form;
      return { ...form, attendees: form.attendees.filter(attendee => attendee.id !== action.id) };
    case 'namePrefilled': {
      // Only into an empty first attendee, so it never overwrites typing.
      const name = action.name.trim();
      const [first, ...rest] = form.attendees;
      if (!name || first.name) return form;
      return { ...form, attendees: [{ ...first, name }, ...rest] };
    }
    case 'travelDefaultsApplied': {
      // Most people stay the whole event. Only into empty fields, never over what was picked.
      const { defaultArrival = '', defaultDeparture = '' } = action.travelRange;
      if (!isNewRegistration(form) || ((form.transportArrival || !defaultArrival) && (form.transportDeparture || !defaultDeparture))) return form;
      return { ...form, transportArrival: form.transportArrival || defaultArrival, transportDeparture: form.transportDeparture || defaultDeparture };
    }
    case 'replaced':
      return action.form;
    default:
      return form;
  }
};

/**
 * The form after an action, with every rule between fields applied. Returns `form` itself when
 * nothing changed, so React skips the render.
 */
export const registrationReducer = (form: RegistrationFormState, action: RegistrationAction): RegistrationFormState =>
  syncSameForEveryone(apply(form, action));

/** The form's steps, in order: who comes, where they sleep and eat, transport and help, review. */
export const REGISTRATION_STEPS = { who: 0, stay: 1, help: 2, review: 3 } as const;

/** Something to fix before saving: on which step, which field (a form-state key), and why. */
export interface RegistrationIssue {
  step: number;
  field: 'name' | 'dietaryOther' | 'transportDepartureFsa';
  attendeeId?: string;
  message: string;
}

/**
 * Everything to fix before saving, in the form's order (by step, then attendee). A name is
 * required; « Autre » diet needs its text (the database refuses it blank); the departure postal
 * code is optional, but not malformed (the database refuses that too).
 */
export const validate = (form: RegistrationFormState): RegistrationIssue[] => [
  ...form.attendees
    .filter(attendee => !attendee.name.trim())
    .map(attendee => ({ step: REGISTRATION_STEPS.who, field: 'name' as const, attendeeId: attendee.id, message: fr.nameRequiredError })),
  ...form.attendees
    .filter(attendee => attendee.dietaryNeeds.includes('other') && !attendee.dietaryOther.trim())
    .map(attendee => ({ step: REGISTRATION_STEPS.stay, field: 'dietaryOther' as const, attendeeId: attendee.id, message: fr.dietaryOtherRequired })),
  ...(departureFsaInvalid(form)
    ? [{ step: REGISTRATION_STEPS.help, field: 'transportDepartureFsa' as const, message: fr.transportDepartureFsaInvalid }]
    : [])
];

/** The issues that stop moving on from `step`: those of the steps up to and including it. */
export const issuesUpToStep = (issues: RegistrationIssue[], step: number): RegistrationIssue[] =>
  issues.filter(issue => issue.step <= step);
