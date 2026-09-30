// Unsaved edits to an event's descriptive fields (the admin event editor). Pure, apart from the
// sessionStorage helpers at the bottom, so the dirty and validation rules are tested on their own
// (eventDraft.test.js).
import { fromEventLocal, toEventLocal, toInstant } from './eventTime.js';

// Integer fields, kept as typed while editing (so "90" can be cleared and retyped) and checked on
// save. `min` is the smallest value the app makes sense with.
export const NUMBER_FIELDS = {
  duration_days: { min: 1 },
  max_attendees: { min: 1 },
  z_intent_months: { min: 0 },
  x_reg_close_weeks: { min: 0 }
};

// Instants (#149). The draft holds what the datetime-local input shows, 'YYYY-MM-DDTHH:mm' in the
// event time zone; the event holds the database's ISO timestamp.
export const DATE_FIELDS = ['event_start_date', 'reg_start_date'];

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const instantOf = (value) => {
  if (!value) return null;
  const date = LOCAL_DATETIME.test(value) ? fromEventLocal(value) : toInstant(value);
  return date ? date.toISOString() : null;
};

/** What a date field's datetime-local input shows: the draft's text as typed, or the saved instant in the event zone. */
export const dateInputValue = value => (LOCAL_DATETIME.test(value ?? '') ? value : toEventLocal(value));

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isBlank = text => !String(text ?? '').trim();
// Fully empty link rows are dropped on save, not refused.
const keptLinks = links => (links || [])
  .filter(row => !isBlank(row.label) || !isBlank(row.url))
  .map(row => ({ label: String(row.label ?? '').trim(), url: String(row.url ?? '').trim() }));

const normalise = (field, value) => {
  if (field in NUMBER_FIELDS) return value === '' || value == null ? null : Number(value);
  if (DATE_FIELDS.includes(field)) return instantOf(value);
  if (field === 'external_links') return keptLinks(value);
  return value;
};

const isHttpUrl = (text) => {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
};

/**
 * The draft's fields whose value differs from the saved event, in draft order. A field the event
 * no longer has (a stored draft from before a column was dropped, e.g. venue_address in #145) is
 * ignored rather than sent.
 */
export const dirtyFields = (event, changes) => Object.keys(changes || {})
  .filter(field => !event || Object.hasOwn(event, field))
  .filter(field => !same(normalise(field, changes[field]), normalise(field, event?.[field])));

/**
 * Why the draft can't be saved, by field: numbers `'integer' | 'min'`, the title `'required'`,
 * the registration start `'order'` (it must come strictly before the event start, when both are
 * set), and links `{ [row index]: 'incomplete' | 'url' }`. Only what the draft touches is checked,
 * so a saved event that already breaks a rule can still be edited elsewhere.
 */
export const validateDraft = (event, changes = {}) => {
  const errors = {};
  const value = field => (field in changes ? changes[field] : event?.[field]);
  Object.entries(NUMBER_FIELDS).forEach(([field, { min }]) => {
    if (!(field in changes)) return;
    const text = String(changes[field] ?? '').trim();
    if (!/^\d+$/.test(text)) errors[field] = 'integer';
    else if (Number(text) < min) errors[field] = 'min';
  });
  if ('theme' in changes && isBlank(changes.theme)) errors.theme = 'required';
  if (DATE_FIELDS.some(field => field in changes)) {
    const regStart = instantOf(value('reg_start_date'));
    const eventStart = instantOf(value('event_start_date'));
    // ISO instants in UTC (toISOString) compare as strings.
    if (regStart && eventStart && regStart >= eventStart) errors.reg_start_date = 'order';
  }
  if ('external_links' in changes) {
    const linkErrors = {};
    (changes.external_links || []).forEach((row, index) => {
      if (isBlank(row.label) && isBlank(row.url)) return;
      if (isBlank(row.label) || isBlank(row.url)) linkErrors[index] = 'incomplete';
      else if (!isHttpUrl(String(row.url).trim())) linkErrors[index] = 'url';
    });
    if (Object.keys(linkErrors).length) errors.external_links = linkErrors;
  }
  return errors;
};

/** The `events` update for the draft's dirty fields: numbers converted, dates as ISO instants (null when empty), links trimmed and empty rows dropped. */
export const draftUpdate = (event, changes) => Object.fromEntries(dirtyFields(event, changes)
  .map(field => [field, normalise(field, changes[field])]));

// A copy of the draft in sessionStorage, so a reload (or anything else that unmounts the admin
// page) doesn't lose it. Storage can be missing or refuse writes: the draft then only lives in
// memory, which is what it did before.
const storageKey = eventId => `bedaine.eventDraft.${eventId}`;

export const loadStoredDraft = (eventId) => {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey(eventId)) || 'null');
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
};

export const storeDraft = (eventId, changes) => {
  try {
    if (changes && Object.keys(changes).length) {
      window.sessionStorage.setItem(storageKey(eventId), JSON.stringify(changes));
    } else {
      window.sessionStorage.removeItem(storageKey(eventId));
    }
  } catch {
    // Memory only.
  }
};
