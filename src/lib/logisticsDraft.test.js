import { countChanges, draftAfterSave, logisticsPayload, setMessageChange, setNotesChange, setPlaceChange } from './logisticsDraft';

const p1 = { id: 'p1', admin_notes: 'VIP', message_to_participants: 'Lit du fond', attendees: [{ id: 'a1', place: { place_id: 'bedA' } }, { id: 'a2', place: null }] };
const p2 = { id: 'p2', admin_notes: null, attendees: [{ id: 'a3', place: null }] };

test('setPlaceChange records a move or an unassignment, and drops a return to the saved place', () => {
  let draft = setPlaceChange({}, p1, 'a1', null);
  draft = setPlaceChange(draft, p1, 'a2', 'sofa');
  expect(draft).toEqual({ p1: { places: { a1: null, a2: 'sofa' } } });
  draft = setPlaceChange(draft, p1, 'a1', 'bedA');
  draft = setPlaceChange(draft, p1, 'a2', null);
  expect(draft).toEqual({});
});

test('setNotesChange drops notes equal to the saved ones (null saved = empty)', () => {
  let draft = setNotesChange({}, p2, 'Arrive tard');
  expect(draft).toEqual({ p2: { adminNotes: 'Arrive tard' } });
  draft = setNotesChange(draft, p2, '');
  expect(draft).toEqual({});
  draft = setPlaceChange(setNotesChange({}, p1, 'VIP!'), p1, 'a2', 'sofa');
  expect(setNotesChange(draft, p1, 'VIP')).toEqual({ p1: { places: { a2: 'sofa' } } });
});

test('setMessageChange is its own change, next to the notes (#216)', () => {
  let draft = setMessageChange(setNotesChange({}, p2, 'Privé'), p2, 'Bienvenue');
  expect(draft).toEqual({ p2: { adminNotes: 'Privé', participantMessage: 'Bienvenue' } });
  expect(countChanges(draft)).toBe(2);
  draft = setNotesChange(draft, p2, '');
  expect(draft).toEqual({ p2: { participantMessage: 'Bienvenue' } });
  draft = setMessageChange(draft, p2, '');
  expect(draft).toEqual({});
  expect(setMessageChange({}, p1, 'Lit du fond')).toEqual({});
  expect(setMessageChange({}, p1, '')).toEqual({ p1: { participantMessage: '' } });
});

test('countChanges counts each attendee place and each party note', () => {
  const draft = { p1: { places: { a1: null, a2: 'sofa' }, adminNotes: '' }, p2: { places: { a3: 'bedA' } } };
  expect(countChanges(draft)).toBe(4);
  expect(countChanges({})).toBe(0);
});

test('logisticsPayload sends notes only when changed, and null to unassign', () => {
  expect(logisticsPayload({ p1: { places: { a1: null } }, p2: { adminNotes: '' } })).toEqual([
    { party_id: 'p1', places: { a1: null } },
    { party_id: 'p2', places: {}, admin_notes: '' }
  ]);
  expect(logisticsPayload({ p1: { participantMessage: 'Salut' }, p2: { adminNotes: 'x', participantMessage: '' } })).toEqual([
    { party_id: 'p1', places: {}, message_to_participants: 'Salut' },
    { party_id: 'p2', places: {}, admin_notes: 'x', message_to_participants: '' }
  ]);
});

test('draftAfterSave clears saved parties, keeps failed ones and ones edited during the save', () => {
  const sent = { p1: { places: { a1: null } }, p2: { adminNotes: 'x' }, p3: { adminNotes: 'y' } };
  const current = { ...sent, p3: { adminNotes: 'y2' }, p4: { adminNotes: 'new' } };
  expect(draftAfterSave(current, sent, ['p2'])).toEqual({ p2: { adminNotes: 'x' }, p3: { adminNotes: 'y2' }, p4: { adminNotes: 'new' } });
});
