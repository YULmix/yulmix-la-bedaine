import fr from '../locales/fr.json';
import { describeChanges } from './editHistory.js';
import { eventClock } from './eventTime.js';

// The admin « Historique des changements » (#173): an event's registration_edits, newest first,
// as a list and as a CSV / Google Sheets export with one row per changed field. The list and the
// exports use the same French text (describeChanges), so they always agree.

const pad = n => String(n).padStart(2, '0');

/** '2026-10-01 14:05', Quebec time (the event zone); '' when unset. */
export const formatHistoryTimestamp = (value) => {
  const c = eventClock(value);
  return c ? `${c.year}-${pad(c.month)}-${pad(c.day)} ${pad(c.hour)}:${pad(c.minute)}` : '';
};

/**
 * A person as the history names them: full name, else email. A null id is no one (a change made
 * by the system); an id with no profile left is an unknown account. Never the raw id.
 */
export const personName = (id, profilesById) => {
  if (!id) return fr.historySystemAuthor;
  const profile = profilesById.get(id);
  return profile?.full_name?.trim() || profile?.email || fr.historyUnknownPerson;
};

/**
 * Raw registration_edits rows (with registration.user_id) as list entries:
 * { id, at, author, registrant, lines }.
 */
export const historyEntries = (edits, profilesById) => edits.map(edit => ({
  id: edit.id,
  at: formatHistoryTimestamp(edit.edited_at),
  author: personName(edit.edited_by, profilesById),
  registrant: personName(edit.registration?.user_id, profilesById),
  lines: describeChanges(edit.changes)
}));

/**
 * The export: one row per changed field, in the entries' order.
 * @returns {{ headers: string[], rows: string[][] }}
 */
export const historyExportRows = (entries) => ({
  headers: [
    fr.historyExportTimestamp,
    fr.historyExportAuthor,
    fr.historyExportRegistration,
    fr.historyExportField,
    fr.historyExportOldValue,
    fr.historyExportNewValue
  ],
  rows: entries.flatMap(entry => entry.lines.map(line => [
    entry.at, entry.author, entry.registrant, line.label, line.from, line.to
  ]))
});

/** The event the history opens on: the active one, else the latest by registration start. */
export const defaultHistoryEvent = (events) => events.find(event => event.is_active)
  || [...events].sort((a, b) => String(b.reg_start_date || '').localeCompare(String(a.reg_start_date || '')))[0]
  || null;
