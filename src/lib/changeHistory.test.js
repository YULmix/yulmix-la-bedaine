import fr from '../locales/fr.json';
import { defaultHistoryEvent, describePlaceChanges, formatHistoryTimestamp, historyEntries, historyExportRows, personName } from './changeHistory';
import { formatCurrency } from './format';

const MEMBER = 'member-id';
const ADMIN = 'admin-id';
const profiles = new Map([
  [MEMBER, { id: MEMBER, full_name: 'Marie Membre', email: 'marie@test.local' }],
  [ADMIN, { id: ADMIN, full_name: '', email: 'admin@test.local' }]
]);
const people = (n) => (n === 1 ? fr.countPersonOne : fr.countPersonOther).replace('{count}', n);

// Newest first, as fetched: an edit adding an attendee, then the creation.
const edits = [
  {
    id: 'e2',
    edited_at: '2026-10-01T18:05:00Z',
    edited_by: ADMIN,
    registration: { user_id: MEMBER },
    changes: {
      attendees: { old: [{ name: 'A' }], new: [{ name: 'A' }, { name: 'B' }] },
      calculated_amount_owed: { old: 260, new: 520 }
    }
  },
  {
    id: 'e1',
    edited_at: '2026-10-01T04:30:00Z',
    edited_by: MEMBER,
    registration: { user_id: MEMBER },
    changes: { created: { old: null, new: { attendees: [{ name: 'A' }], status: 'registered', is_waitlisted: false, calculated_amount_owed: 260 } } }
  }
];

test('timestamps are Quebec local time, YYYY-MM-DD HH:mm', () => {
  expect(formatHistoryTimestamp('2026-10-01T18:05:00Z')).toBe('2026-10-01 14:05');
  // Quebec is UTC-4 in summer time, UTC-5 in winter: January's 04:30 UTC is the evening before.
  expect(formatHistoryTimestamp('2026-10-01T04:30:00Z')).toBe('2026-10-01 00:30');
  expect(formatHistoryTimestamp('2026-01-15T04:30:00Z')).toBe('2026-01-14 23:30');
  expect(formatHistoryTimestamp(null)).toBe('');
});

test('people are named by full name, else email, else a French fallback — never an id', () => {
  expect(personName(MEMBER, profiles)).toBe('Marie Membre');
  expect(personName(ADMIN, profiles)).toBe('admin@test.local');
  expect(personName('gone-id', profiles)).toBe(fr.historyUnknownPerson);
  expect(personName(null, profiles)).toBe(fr.historySystemAuthor);
});

test('the export has one row per changed field, in French, under the agreed headers', () => {
  const { headers, rows } = historyExportRows(historyEntries(edits, profiles));
  expect(headers).toEqual(['Horodatage', 'Auteur', 'Inscription', 'Champ', 'Ancienne valeur', 'Nouvelle valeur']);
  expect(rows).toEqual([
    ['2026-10-01 14:05', 'admin@test.local', 'Marie Membre', fr.historyFieldAttendees, people(1), people(2)],
    ['2026-10-01 14:05', 'admin@test.local', 'Marie Membre', fr.amountDue, formatCurrency(260), formatCurrency(520)],
    ['2026-10-01 00:30', 'Marie Membre', 'Marie Membre', fr.historyFieldCreated, '', `${people(1)} · ${fr.statusRegistered} · ${formatCurrency(260)}`]
  ]);
});

test('a status change exports its French label, not the stored value', () => {
  const [entry] = historyEntries([{ ...edits[0], changes: { status: { old: 'registered', new: 'cancelled' } } }], profiles);
  expect(historyExportRows([entry]).rows[0].slice(3)).toEqual([fr.status, fr.statusRegistered, fr.statusCancelled]);
});

test('the history opens on the active event, else the latest by registration start', () => {
  const old = { id: 'old', reg_start_date: '2024-05-01T04:00:00+00:00', is_active: false };
  const recent = { id: 'recent', reg_start_date: '2025-05-01T04:00:00+00:00', is_active: false };
  const active = { id: 'active', reg_start_date: '2023-05-01T04:00:00+00:00', is_active: true };
  expect(defaultHistoryEvent([old, recent, active]).id).toBe('active');
  expect(defaultHistoryEvent([old, recent]).id).toBe('recent');
  expect(defaultHistoryEvent([])).toBeNull();
});

describe('place changes (#188)', () => {
  const marie = { attendee_id: 'a1', attendee_name: 'Marie' };
  const luc = { attendee_id: 'a2', attendee_name: 'Luc' };
  const at = (who, label) => ({ ...who, place_id: label ? `id-${label}` : null, label });
  const placeEdit = (places, extra = {}) => ({
    id: 'e3', edited_at: '2026-10-02T16:00:00Z', edited_by: ADMIN, registration: { user_id: MEMBER },
    changes: { places, ...extra }
  });

  test('one line per attendee: « Place de Marie : », old label → new label, null as « non assigné »', () => {
    expect(describePlaceChanges({
      old: [at(marie, 'Grange · Lit 3'), at(luc, null)],
      new: [at(marie, 'Maison · Sofa'), at(luc, 'Grange · Lit 1')]
    })).toEqual([
      { label: 'Place de Marie :', field: 'Place de Marie', from: 'Grange · Lit 3', to: 'Maison · Sofa' },
      { label: 'Place de Luc :', field: 'Place de Luc', from: 'non assigné', to: 'Grange · Lit 1' }
    ]);
    expect(describePlaceChanges({ old: [at(marie, 'Grange · Lit 3')], new: [at(marie, null)] }))
      .toEqual([{ label: 'Place de Marie :', field: 'Place de Marie', from: 'Grange · Lit 3', to: fr.historyPlaceUnassigned }]);
  });

  test('a venue change says why the places were cleared', () => {
    expect(describePlaceChanges({ old: [at(marie, 'Grange · Lit 3')], new: [at(marie, null)], reason: 'venue_changed' }))
      .toEqual([{ label: 'Place de Marie :', field: 'Place de Marie', from: 'Grange · Lit 3', to: fr.historyPlaceVenueChanged }]);
  });

  test('nothing, or something malformed, is no line', () => {
    expect(describePlaceChanges(undefined)).toEqual([]);
    expect(describePlaceChanges({ old: null, new: [] })).toEqual([]);
  });

  test('the entry lists the other fields, then the places; the export has one row per attendee change', () => {
    const [entry] = historyEntries([placeEdit(
      { old: [at(marie, 'Grange · Lit 3'), at(luc, null)], new: [at(marie, 'Maison · Sofa'), at(luc, 'Grange · Lit 1')] },
      { admin_notes: { old: null, new: 'Allergies' } }
    )], profiles);
    expect(entry.lines.map(line => line.label)).toEqual([fr.historyFieldAdminNotes, 'Place de Marie :', 'Place de Luc :']);
    expect(historyExportRows([entry]).rows).toEqual([
      ['2026-10-02 12:00', 'admin@test.local', 'Marie Membre', fr.historyFieldAdminNotes, fr.historyEmptyValue, 'Allergies'],
      ['2026-10-02 12:00', 'admin@test.local', 'Marie Membre', 'Place de Marie', 'Grange · Lit 3', 'Maison · Sofa'],
      ['2026-10-02 12:00', 'admin@test.local', 'Marie Membre', 'Place de Luc', 'non assigné', 'Grange · Lit 1']
    ]);
  });
});
