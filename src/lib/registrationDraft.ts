// The member registration form's state, and its unsaved copy in sessionStorage (#144), so a
// reload of the tab doesn't lose what was typed. Pure, apart from the sessionStorage helpers at
// the bottom (registrationDraft.test.js).
import { dietaryNeedsOf } from './registrationOptions';
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

/** What the form reads of a saved registration: a party with its attendees (parties.js). */
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

/** What is kept in sessionStorage: the form, and the saved registration it was taken over. */
export interface RegistrationDraft {
  form: RegistrationFormState;
  saved: RegistrationFormState | null;
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
export const formStateOf = (registration: SavedRegistration | null | undefined, travelRange: TravelRange = {}): RegistrationFormState => {
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
    // the form's sync would overwrite everyone's choices with the first attendee's.
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

/**
 * The `transport` to save from the form. Seats and where the lift leaves from (#181: the postal
 * code's start, for matching, and a note for people) only go with an offer or a need.
 */
export const transportOf = (form: RegistrationFormState) => {
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

export const sameFormState = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What the draft was taken over: the saved registration as the form showed it, or null for a new
// one. The table has no updated_at, so this is how a draft notices the registration was saved
// since (from another tab, or by an admin).
const savedFingerprint = (registration: SavedRegistration | null | undefined): RegistrationFormState | null => (registration?.attendees ? formStateOf(registration) : null);

/** The draft to keep in storage: the form's state, and the saved registration it was taken over. */
export const makeDraft = (form: RegistrationFormState, registration: SavedRegistration | null | undefined): RegistrationDraft => ({ form, saved: savedFingerprint(registration) });

/**
 * The stored draft's form state if it still applies to `registration`, else null: a draft taken
 * over a registration that has changed since, or over no registration when there now is one (or
 * the reverse), is dropped in favour of what's saved.
 */
export const draftFormFor = (draft: unknown, registration: SavedRegistration | null | undefined): RegistrationFormState | null => {
  // Whatever storage held: only a draft shaped like one is used.
  const stored = draft as Partial<RegistrationDraft> | null;
  if (!stored || typeof stored !== 'object' || !stored.form || !Array.isArray(stored.form.attendees) || !stored.form.attendees.length) return null;
  return sameFormState(stored.saved, savedFingerprint(registration)) ? stored.form : null;
};

// Per member and event, in sessionStorage: this tab only, gone when it closes. Storage can be
// missing or refuse writes (private mode): the form then just isn't restored.
export const draftStorageKey = (userId: string, eventId: string): string => `bedaine.registrationDraft.${userId}.${eventId}`;

export const loadStoredDraft = (key: string): unknown => {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

export const storeDraft = (key: string, draft: RegistrationDraft | null): void => {
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Not restored on a reload, then.
  }
};
