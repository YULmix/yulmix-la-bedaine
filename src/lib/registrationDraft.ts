// The registration form's unsaved copy in sessionStorage (#144), so a reload of the tab doesn't
// lose what was typed. The form's state itself is registration.ts's. Pure, apart from the
// sessionStorage helpers at the bottom (registrationDraft.test.js).
import { fromParty, type RegistrationFormState, type SavedRegistration } from './registration';

// The form's model moved to registration.ts (#194). Re-exported, under its old names, for the form
// until it's rewired onto the module (#194, PR 2); then these go.
export {
  DEPARTURE_PLACE_MAX_LENGTH,
  LOGISTICS_FIELDS,
  departureFsaInvalid,
  fromParty as formStateOf,
  newAttendee,
  sameChoice,
  transportOf
} from './registration';
export type { FormAttendee, RegistrationFormState, SavedRegistration, TravelRange } from './registration';

/** What is kept in sessionStorage: the form, and the saved registration it was taken over. */
export interface RegistrationDraft {
  form: RegistrationFormState;
  saved: RegistrationFormState | null;
}

export const sameFormState = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What the draft was taken over: the saved registration as the form showed it, or null for a new
// one. The table has no updated_at, so this is how a draft notices the registration was saved
// since (from another tab, or by an admin).
const savedFingerprint = (registration: SavedRegistration | null | undefined): RegistrationFormState | null => (registration?.attendees ? fromParty(registration) : null);

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
