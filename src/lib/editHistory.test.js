import fr from '../locales/fr.json';
import { describeChanges, memberHistoryEdits } from './editHistory';
import { formatCurrency } from './format';

test('a transport change reads in French, with the departure place (#181)', () => {
  const [line] = describeChanges({
    transport: {
      old: { type: 'need', seats: 2 },
      new: { type: 'need', seats: 2, departure_fsa: 'H2S', departure_place: 'métro Jean-Talon' }
    }
  });
  expect(line).toEqual({
    label: fr.transport,
    from: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2`,
    to: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2, ${fr.transportDeparturePlaceShort}: H2S · métro Jean-Talon`
  });
});

test('a creation entry is one line with no old value: head count, status, amount (#173)', () => {
  expect(describeChanges({
    created: {
      old: null,
      new: { attendees: [{ name: 'A' }, { name: 'B' }], status: 'registered', is_waitlisted: false, calculated_amount_owed: 520 }
    }
  })).toEqual([{
    label: fr.historyFieldCreated,
    from: '',
    to: `${fr.countPersonOther.replace('{count}', 2)} · ${fr.statusRegistered} · ${formatCurrency(520)}`
  }]);
});

test('a waitlisted creation says so instead of the status (#173)', () => {
  const [line] = describeChanges({
    created: { old: null, new: { attendees: [{ name: 'A' }], status: 'registered', is_waitlisted: true, calculated_amount_owed: 0 } }
  });
  expect(line.to).toBe(`${fr.countPersonOne.replace('{count}', 1)} · ${fr.filterWaitlist} · ${formatCurrency(0)}`);
});

test('the message to participants has its own label, apart from the private notes (#216)', () => {
  expect(describeChanges({
    admin_notes: { old: null, new: 'Privé' },
    message_to_participants: { old: null, new: 'Bienvenue' }
  })).toEqual([
    { label: fr.historyFieldAdminNotes, from: fr.historyEmptyValue, to: 'Privé' },
    { label: fr.historyFieldMessageToParticipants, from: fr.historyEmptyValue, to: 'Bienvenue' }
  ]);
});

test("place changes are not described: the member's history never shows them (#188)", () => {
  const places = {
    old: [{ attendee_id: 'a1', attendee_name: 'Marie', place_id: 'p1', label: 'Grange · Lit 3' }],
    new: [{ attendee_id: 'a1', attendee_name: 'Marie', place_id: null, label: null }]
  };
  expect(describeChanges({ places })).toEqual([]);
  expect(describeChanges({ places, admin_notes: { old: null, new: 'Note' } }))
    .toEqual([{ label: fr.historyFieldAdminNotes, from: fr.historyEmptyValue, to: 'Note' }]);
});

test("the member's history leaves out the edits that only log places (#188)", () => {
  const places = { old: [{ attendee_id: 'a1', attendee_name: 'Marie', place_id: null, label: null }], new: [{ attendee_id: 'a1', attendee_name: 'Marie', place_id: 'p1', label: 'Grange · Lit 3' }] };
  const edits = [
    { id: 'places', changes: { places } },
    { id: 'venue', changes: { places: { ...places, reason: 'venue_changed' } } },
    { id: 'notes', changes: { places, admin_notes: { old: null, new: 'Note' } } },
    { id: 'status', changes: { status: { old: 'registered', new: 'cancelled' } } },
    { id: 'empty', changes: {} }
  ];
  expect(memberHistoryEdits(edits).map(edit => edit.id)).toEqual(['notes', 'status', 'empty']);
  expect(memberHistoryEdits(null)).toEqual([]);
});
