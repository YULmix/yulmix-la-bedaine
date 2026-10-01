// The member registration form's state, and its unsaved copy in sessionStorage (#144), so a
// reload of the tab doesn't lose what was typed. Pure, apart from the sessionStorage helpers at
// the bottom (registrationDraft.test.js).
import { dietaryNeedsOf } from './registrationOptions.js';

// Per-attendee choices that "mêmes choix pour tout le monde" copies to everyone.
export const LOGISTICS_FIELDS = ['sleepingPreference', 'sleepingPreferenceOther', 'dietaryNeeds', 'bedReason', 'bedReasonOther', 'dietaryOther'];
// dietaryNeeds is an array, so compare by value.
export const sameChoice = (a, b) => (Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

export const newAttendee = (id) => ({
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

const toLocalDateTime = (value) => (value && value.includes('T') ? value.slice(0, 16) : value || '');

/**
 * The form's state for a saved registration, or for a new one when `registration` is null.
 * Arrival and departure fall back to the event's first and last day (#123) when none was saved.
 */
export const formStateOf = (registration, travelRange = {}) => {
  if (!registration?.attendees) {
    return {
      attendees: [newAttendee('attendee-1')],
      sameForEveryone: true,
      transportType: '',
      transportSeats: 0,
      transportArrival: travelRange.defaultArrival || '',
      transportDeparture: travelRange.defaultDeparture || '',
      volunteeringSelections: [],
      volunteeringOtherDetail: '',
      musicRequests: '',
      messageToOrganizers: ''
    };
  }
  const attendees = registration.attendees.map(attendee => ({
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
    volunteeringSelections: registration.logistics?.volunteering || [],
    volunteeringOtherDetail: registration.logistics?.volunteering_other || '',
    musicRequests: registration.music_requests || '',
    messageToOrganizers: registration.message_to_organizers || ''
  };
};

export const sameFormState = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What the draft was taken over: the saved registration as the form showed it, or null for a new
// one. The table has no updated_at, so this is how a draft notices the registration was saved
// since (from another tab, or by an admin).
const savedFingerprint = registration => (registration?.attendees ? formStateOf(registration) : null);

/** The draft to keep in storage: the form's state, and the saved registration it was taken over. */
export const makeDraft = (form, registration) => ({ form, saved: savedFingerprint(registration) });

/**
 * The stored draft's form state if it still applies to `registration`, else null: a draft taken
 * over a registration that has changed since, or over no registration when there now is one (or
 * the reverse), is dropped in favour of what's saved.
 */
export const draftFormFor = (draft, registration) => {
  if (!draft || typeof draft !== 'object' || !draft.form || !Array.isArray(draft.form.attendees) || !draft.form.attendees.length) return null;
  return sameFormState(draft.saved, savedFingerprint(registration)) ? draft.form : null;
};

// Per member and event, in sessionStorage: this tab only, gone when it closes. Storage can be
// missing or refuse writes (private mode): the form then just isn't restored.
export const draftStorageKey = (userId, eventId) => `bedaine.registrationDraft.${userId}.${eventId}`;

export const loadStoredDraft = (key) => {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

export const storeDraft = (key, draft) => {
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Not restored on a reload, then.
  }
};
