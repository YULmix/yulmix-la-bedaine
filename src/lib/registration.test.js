import fr from '../locales/fr.json';
import {
  DEPARTURE_PLACE_MAX_LENGTH,
  departureFsaInvalid,
  fromParty,
  issuesUpToStep,
  newAttendee,
  registrationReducer,
  toSavePayload,
  transportOf,
  validate
} from './registration';

const travelRange = { defaultArrival: '2026-07-10T12:00', defaultDeparture: '2026-07-12T12:00' };

const registration = {
  attendees: [
    { id: 'a1', name: 'Alex', type: 'Adult', participation: 'Whole', sleeping_preference: 'tent', dietary_needs: ['vegan'] },
    { id: 'a2', name: 'Sam', type: 'Kid', participation: 'After-Party', sleeping_preference: 'tent', dietary_needs: ['vegan'] }
  ],
  transport: { type: 'offer', seats: 2, arrival: '2026-07-10T09:30:00', departure: null },
  logistics: { volunteering: ['setup'], volunteering_other: '' },
  music_requests: 'Disco',
  message_to_organizers: ''
};

describe('fromParty', () => {
  test('a new registration: one empty attendee, the event days as arrival and departure', () => {
    const form = fromParty(null, travelRange);
    expect(form.attendees).toHaveLength(1);
    expect(form.attendees[0]).toMatchObject({ id: 'attendee-1', name: '', type: 'Adult', dietaryNeeds: [] });
    expect(form).toMatchObject({ sameForEveryone: true, transportArrival: travelRange.defaultArrival, transportDeparture: travelRange.defaultDeparture });
  });

  test('a saved registration: its attendees and answers, saved times kept, missing ones defaulted', () => {
    const form = fromParty(registration, travelRange);
    expect(form.attendees.map(a => [a.id, a.name, a.isSaved])).toEqual([['a1', 'Alex', true], ['a2', 'Sam', true]]);
    expect(form).toMatchObject({
      sameForEveryone: true,
      transportType: 'offer',
      transportSeats: 2,
      transportArrival: '2026-07-10T09:30',
      transportDeparture: travelRange.defaultDeparture,
      volunteeringSelections: ['setup'],
      musicRequests: 'Disco'
    });
  });

  test('a need keeps its seat count; one saved without a count needs a seat per attendee (#179)', () => {
    const need = seats => fromParty({ ...registration, transport: { type: 'need', seats } }, travelRange).transportSeats;
    expect(need(1)).toBe(1);
    expect(need(0)).toBe(2);
    expect(need(undefined)).toBe(2);
    expect(fromParty({ ...registration, transport: { type: '', seats: 0 } }, travelRange).transportSeats).toBe(0);
  });

  test('the departure place round-trips through the form (#181)', () => {
    const saved = { ...registration, transport: { ...registration.transport, departure_fsa: 'H2G', departure_place: 'Montréal (Rosemont)' } };
    const form = fromParty(saved, travelRange);
    expect(form).toMatchObject({ transportDepartureFsa: 'H2G', transportDeparturePlace: 'Montréal (Rosemont)' });
    expect(transportOf(form)).toMatchObject({ departure_fsa: 'H2G', departure_place: 'Montréal (Rosemont)' });
    // Saved before #181: neither.
    expect(fromParty(registration, travelRange)).toMatchObject({ transportDepartureFsa: '', transportDeparturePlace: '' });
    expect(fromParty(null, travelRange)).toMatchObject({ transportDepartureFsa: '', transportDeparturePlace: '' });
  });

  test('"same for everyone" only when the saved choices are identical', () => {
    const differing = { ...registration, attendees: [registration.attendees[0], { ...registration.attendees[1], dietary_needs: ['none'] }] };
    expect(fromParty(differing, travelRange).sameForEveryone).toBe(false);
  });
});

describe('transportOf', () => {
  const form = { transportType: 'need', transportSeats: 3, transportArrival: '2026-07-10T12:00', transportDeparture: '', transportDepartureFsa: '', transportDeparturePlace: '  Québec  ' };

  test('an offer or a need keeps its seats and its trimmed departure place (#181)', () => {
    expect(transportOf(form)).toEqual({ type: 'need', seats: 3, arrival: '2026-07-10T12:00', departure: '', departure_place: 'Québec' });
    expect(transportOf({ ...form, transportType: 'offer' }).departure_place).toBe('Québec');
  });

  test('no lift: no seats, no departure place', () => {
    expect(transportOf({ ...form, transportType: '' })).toEqual({ type: '', seats: 0, arrival: '2026-07-10T12:00', departure: '' });
  });

  test('the postal code start is normalised from what was typed; blank or malformed is left out (#181)', () => {
    expect(transportOf({ ...form, transportDepartureFsa: 'g1r 2b5' }).departure_fsa).toBe('G1R');
    expect(transportOf({ ...form, transportDepartureFsa: '' })).not.toHaveProperty('departure_fsa');
    expect(transportOf({ ...form, transportDepartureFsa: 'W1A' })).not.toHaveProperty('departure_fsa');
    expect(transportOf({ ...form, transportType: '', transportDepartureFsa: 'H2G' })).not.toHaveProperty('departure_fsa');
  });

  test('departureFsaInvalid: only a malformed code with a lift; blank is fine', () => {
    expect(departureFsaInvalid({ ...form, transportDepartureFsa: 'W1A' })).toBe(true);
    expect(departureFsaInvalid({ ...form, transportDepartureFsa: 'h2g1a1' })).toBe(false);
    expect(departureFsaInvalid({ ...form, transportDepartureFsa: ' ' })).toBe(false);
    expect(departureFsaInvalid({ ...form, transportType: '', transportDepartureFsa: 'W1A' })).toBe(false);
  });

  test('a blank departure place is left out; a long one is cut', () => {
    expect(transportOf({ ...form, transportDeparturePlace: '   ' })).not.toHaveProperty('departure_place');
    expect(transportOf({ ...form, transportDeparturePlace: 'x'.repeat(150) }).departure_place).toHaveLength(DEPARTURE_PLACE_MAX_LENGTH);
  });
});

// A saved party as parties.ts reads it: attendee rows (with their assigned bed and row columns
// the form doesn't edit) and the party's own columns.
const attendeeRow = (id, fields) => ({
  id,
  party_id: 'party-1',
  position: 0,
  created_at: '2026-06-01T10:00:00+00:00',
  name: `Person ${id}`,
  type: 'Adult',
  participation: 'Whole',
  is_new_member: false,
  sleeping_preference: '',
  sleeping_preference_other: '',
  dietary_needs: [],
  bed_reason: '',
  bed_reason_other: '',
  dietary_other: '',
  place: null,
  ...fields
});

const savedParty = (transport, overrides = {}) => ({
  id: 'party-1',
  user_id: 'user-1',
  event_id: 'event-1',
  status: 'registered',
  payment_status: 'Non payé',
  admin_notes: 'Paid half in cash',
  locked_selling_price_whole_event: 200,
  attendees: [
    attendeeRow('a1', {
      name: 'Alex', sleeping_preference: 'bed', bed_reason: 'health', dietary_needs: ['vegetarian', 'gluten_free', 'other'], dietary_other: 'Pas de noix',
      place: { place_id: 'p1', bed_label: 'Lit 1', place_label: 'Chambre bleue', location_id: 'l1', location_name: 'Chalet' }
    }),
    attendeeRow('a2', { name: 'Sam', type: 'Teenager', participation: 'Main', sleeping_preference: 'bed', bed_reason: 'other', bed_reason_other: 'Dos fragile', dietary_needs: ['none'] }),
    attendeeRow('a3', { name: 'Kim', type: 'Kid', participation: 'After-Party', sleeping_preference: 'camping', dietary_needs: ['dairy_free'] }),
    attendeeRow('a4', { name: 'Noa', sleeping_preference: 'floor', is_new_member: true, dietary_needs: ['vegan'] }),
    attendeeRow('a5', { name: 'Lou', sleeping_preference: 'sofa' }),
    attendeeRow('a6', { name: 'Max', sleeping_preference: 'outside_other', sleeping_preference_other: 'Mon van' })
  ],
  transport,
  logistics: { volunteering: ['cook_meal', 'other'], volunteering_other: 'Photos' },
  music_requests: 'Disco, funk',
  message_to_organizers: 'On arrive tard vendredi.',
  ...overrides
});

// What save_registration takes, read straight off the saved party.
const SAVED_ATTENDEE_FIELDS = ['id', 'name', 'type', 'participation', 'is_new_member', 'sleeping_preference', 'sleeping_preference_other', 'dietary_needs', 'bed_reason', 'bed_reason_other', 'dietary_other'];
const savePayloadOf = party => ({
  attendees: party.attendees.map(row => Object.fromEntries(SAVED_ATTENDEE_FIELDS.map(field => [field, row[field]]))),
  party: {
    logistics: party.logistics,
    transport: party.transport,
    music_requests: party.music_requests,
    message_to_organizers: party.message_to_organizers
  }
});

describe('toSavePayload(fromParty(party)): the round trip (#194)', () => {
  const transports = [
    ['an offer, with where it leaves from', { type: 'offer', seats: 3, arrival: '2026-07-10T09:30', departure: '2026-07-12T16:00', departure_fsa: 'H2G', departure_place: 'Montréal (Rosemont)' }],
    ['a need, with where it leaves from', { type: 'need', seats: 2, arrival: '2026-07-10T18:00', departure: '2026-07-12T11:00', departure_fsa: 'G1R', departure_place: 'Québec' }],
    ['no lift', { type: '', seats: 0, arrival: '2026-07-11T10:00', departure: '2026-07-12T20:00' }]
  ];

  test.each(transports)('preserves every field save_registration accepts: %s', (_name, transport) => {
    const party = savedParty(transport);
    expect(toSavePayload(fromParty(party, travelRange))).toEqual(savePayloadOf(party));
  });

  test('the assigned bed, and the row columns the form does not edit, are never sent', () => {
    const payload = toSavePayload(fromParty(savedParty(transports[0][1]), travelRange));
    payload.attendees.forEach(attendee => {
      expect(Object.keys(attendee).sort()).toEqual([...SAVED_ATTENDEE_FIELDS].sort());
    });
    expect(JSON.stringify(payload)).not.toMatch(/place_id|bed_label|Chambre bleue|position|party_id/);
    expect(Object.keys(payload.party).sort()).toEqual(['logistics', 'message_to_organizers', 'music_requests', 'transport']);
  });

  test('attendees keep their saved ids and their order; a new one goes without an id', () => {
    const form = registrationReducer(fromParty(savedParty(transports[2][1]), travelRange), { type: 'attendeeAdded', id: 'attendee-new' });
    const named = registrationReducer(form, { type: 'attendeeChanged', id: 'attendee-new', changes: { name: 'Zoé', isNewMember: true } });
    const { attendees } = toSavePayload(named);
    expect(attendees.map(attendee => attendee.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', undefined]);
    expect(attendees[6]).not.toHaveProperty('id');
    expect(attendees[6]).toMatchObject({ name: 'Zoé', is_new_member: true });
  });
});

describe('toSavePayload', () => {
  const form = fromParty(null, travelRange);

  test('names are trimmed', () => {
    const payload = toSavePayload({ ...form, attendees: [{ ...form.attendees[0], name: '  Alex  ' }] });
    expect(payload.attendees[0].name).toBe('Alex');
  });

  test('the « Autre » diet text is trimmed, and blank unless « Autre » is chosen', () => {
    const withDiet = (dietaryNeeds, dietaryOther) => toSavePayload({ ...form, attendees: [{ ...form.attendees[0], dietaryNeeds, dietaryOther }] }).attendees[0].dietary_other;
    expect(withDiet(['other'], '  Sans noix ')).toBe('Sans noix');
    expect(withDiet(['vegan'], 'Sans noix')).toBe('');
  });

  test('the party holds volunteering, transport, music requests and the message to organisers', () => {
    const payload = toSavePayload({
      ...form,
      transportType: 'need',
      transportSeats: 1,
      transportDepartureFsa: 'h2g 1a1',
      volunteeringSelections: ['parking'],
      volunteeringOtherDetail: '',
      musicRequests: 'Jazz',
      messageToOrganizers: 'Merci'
    });
    expect(payload.party).toEqual({
      logistics: { volunteering: ['parking'], volunteering_other: '' },
      transport: { type: 'need', seats: 1, arrival: travelRange.defaultArrival, departure: travelRange.defaultDeparture, departure_fsa: 'H2G' },
      music_requests: 'Jazz',
      message_to_organizers: 'Merci'
    });
  });
});

describe('registrationReducer', () => {
  const two = () => {
    const form = fromParty(null, travelRange);
    return registrationReducer(form, { type: 'attendeeAdded', id: 'b' });
  };

  test('a field change for one attendee', () => {
    const form = registrationReducer(two(), { type: 'attendeeChanged', id: 'b', changes: { name: 'Sam', isNewMember: true } });
    expect(form.attendees[1]).toMatchObject({ name: 'Sam', isNewMember: true });
    expect(form.attendees[0]).toMatchObject({ name: '', isNewMember: false });
  });

  test('a party-level field change', () => {
    const form = registrationReducer(two(), { type: 'changed', changes: { musicRequests: 'Funk', transportSeats: 4 } });
    expect(form).toMatchObject({ musicRequests: 'Funk', transportSeats: 4 });
  });

  test('a stay change for the whole group goes to everyone', () => {
    const form = registrationReducer(two(), { type: 'groupStayChanged', changes: { sleepingPreference: 'bed', bedReason: 'comfort' } });
    expect(form.attendees.map(a => [a.sleepingPreference, a.bedReason])).toEqual([['bed', 'comfort'], ['bed', 'comfort']]);
  });

  describe('dietary needs (#153)', () => {
    test('« Aucune restriction » goes alone, and anything else drops it', () => {
      let form = registrationReducer(two(), { type: 'groupStayChanged', changes: { dietaryNeeds: ['vegan'] } });
      form = registrationReducer(form, { type: 'groupStayChanged', changes: { dietaryNeeds: ['vegan', 'none'] } });
      expect(form.attendees[0].dietaryNeeds).toEqual(['none']);
      form = registrationReducer(form, { type: 'groupStayChanged', changes: { dietaryNeeds: ['none', 'gluten_free'] } });
      expect(form.attendees[0].dietaryNeeds).toEqual(['gluten_free']);
    });

    test('unticking « Autre » drops its text, for one attendee or the group', () => {
      const separate = registrationReducer(two(), { type: 'changed', changes: { sameForEveryone: false } });
      let form = registrationReducer(separate, { type: 'attendeeChanged', id: 'b', changes: { dietaryNeeds: ['other'], dietaryOther: 'Noix' } });
      expect(form.attendees[1]).toMatchObject({ dietaryNeeds: ['other'], dietaryOther: 'Noix' });
      form = registrationReducer(form, { type: 'attendeeChanged', id: 'b', changes: { dietaryNeeds: ['vegan'] } });
      expect(form.attendees[1]).toMatchObject({ dietaryNeeds: ['vegan'], dietaryOther: '' });

      let group = registrationReducer(two(), { type: 'groupStayChanged', changes: { dietaryNeeds: ['other'], dietaryOther: 'Noix' } });
      group = registrationReducer(group, { type: 'groupStayChanged', changes: { dietaryNeeds: [] } });
      expect(group.attendees.map(a => a.dietaryOther)).toEqual(['', '']);
    });
  });

  describe('« same for everyone »', () => {
    test('everyone gets the first attendee\'s sleeping and food choices, a new attendee too', () => {
      let form = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { sleepingPreference: 'camping', dietaryNeeds: ['vegan'] } });
      form = registrationReducer(form, { type: 'attendeeAdded', id: 'b' });
      expect(form.attendees[1]).toMatchObject({ id: 'b', name: '', sleepingPreference: 'camping', dietaryNeeds: ['vegan'] });
    });

    test('turning it on copies the first attendee\'s choices; names and ages stay', () => {
      let form = registrationReducer(two(), { type: 'changed', changes: { sameForEveryone: false } });
      form = registrationReducer(form, { type: 'attendeeChanged', id: 'attendee-1', changes: { name: 'Alex', sleepingPreference: 'bed', bedReason: 'other', bedReasonOther: 'Dos' } });
      form = registrationReducer(form, { type: 'attendeeChanged', id: 'b', changes: { name: 'Kim', type: 'Kid', sleepingPreference: 'sofa' } });
      expect(form.attendees[1].sleepingPreference).toBe('sofa');
      form = registrationReducer(form, { type: 'changed', changes: { sameForEveryone: true } });
      expect(form.attendees[1]).toMatchObject({ name: 'Kim', type: 'Kid', sleepingPreference: 'bed', bedReason: 'other', bedReasonOther: 'Dos' });
    });

    test('off, each attendee keeps their own choices', () => {
      let form = registrationReducer(two(), { type: 'changed', changes: { sameForEveryone: false } });
      form = registrationReducer(form, { type: 'attendeeChanged', id: 'b', changes: { sleepingPreference: 'floor' } });
      expect(form.attendees.map(a => a.sleepingPreference)).toEqual(['', 'floor']);
    });

    test('a form already in step is returned as is', () => {
      const form = two();
      expect(registrationReducer(form, { type: 'attendeeRemoved', id: 'missing' })).toBe(form);
    });
  });

  describe('an age change', () => {
    const ageOf = (form, type) => registrationReducer(form, { type: 'attendeeChanged', id: 'attendee-1', changes: { type } }).attendees[0];

    test('a Kid comes to the after-party', () => {
      expect(ageOf(fromParty(null, travelRange), 'Kid')).toMatchObject({ type: 'Kid', participation: 'After-Party' });
    });

    test('leaving Kid goes back to the whole event', () => {
      const kid = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { type: 'Kid' } });
      expect(ageOf(kid, 'Teenager')).toMatchObject({ type: 'Teenager', participation: 'Whole' });
    });

    test('re-picking Kid for a Kid on the whole event moves them to the after-party', () => {
      const kid = fromParty({ attendees: [{ id: 'a1', name: 'Sam', type: 'Kid', participation: 'Whole' }] });
      const repicked = registrationReducer(kid, { type: 'attendeeChanged', id: 'a1', changes: { type: 'Kid' } });
      expect(repicked.attendees[0]).toMatchObject({ type: 'Kid', participation: 'After-Party' });
    });

    test('re-picking the same age otherwise changes nothing', () => {
      const main = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { participation: 'Main' } });
      expect(ageOf(main, 'Adult')).toMatchObject({ type: 'Adult', participation: 'Main' });
    });

    test('between Adult and Teenager the tier stays', () => {
      const main = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { participation: 'Main' } });
      expect(ageOf(main, 'Teenager')).toMatchObject({ type: 'Teenager', participation: 'Main' });
    });
  });

  describe('a transport type change', () => {
    const base = () => registrationReducer(two(), { type: 'changed', changes: { transportType: 'offer', transportSeats: 3, transportDepartureFsa: 'H2G', transportDeparturePlace: 'Rosemont' } });

    test('fields given with the new type win over its resets', () => {
      expect(base()).toMatchObject({ transportType: 'offer', transportSeats: 3, transportDepartureFsa: 'H2G' });
    });

    test('an offer starts at 0 seats, a need at the party\'s size (#179)', () => {
      const need = registrationReducer(base(), { type: 'changed', changes: { transportType: 'need' } });
      expect(need.transportSeats).toBe(2);
      expect(registrationReducer(need, { type: 'changed', changes: { transportType: 'offer' } }).transportSeats).toBe(0);
    });

    test('a lift keeps where it leaves from; no lift clears it (#181)', () => {
      const need = registrationReducer(base(), { type: 'changed', changes: { transportType: 'need' } });
      expect(need).toMatchObject({ transportDepartureFsa: 'H2G', transportDeparturePlace: 'Rosemont' });
      const none = registrationReducer(base(), { type: 'changed', changes: { transportType: '' } });
      expect(none).toMatchObject({ transportType: '', transportSeats: 0, transportDepartureFsa: '', transportDeparturePlace: '' });
    });

    test('choosing the same type again changes nothing', () => {
      expect(registrationReducer(base(), { type: 'changed', changes: { transportType: 'offer' } }).transportSeats).toBe(3);
    });
  });

  describe('adding and removing attendees', () => {
    test('an added attendee is empty, with the given id', () => {
      const form = registrationReducer(fromParty(null, travelRange), { type: 'attendeeAdded', id: 'b' });
      expect(form.attendees[1]).toEqual(newAttendee('b'));
    });

    test('removing one keeps the others in order', () => {
      const three = registrationReducer(two(), { type: 'attendeeAdded', id: 'c' });
      expect(registrationReducer(three, { type: 'attendeeRemoved', id: 'b' }).attendees.map(a => a.id)).toEqual(['attendee-1', 'c']);
    });

    test('never the last one', () => {
      const one = fromParty(null, travelRange);
      expect(registrationReducer(one, { type: 'attendeeRemoved', id: 'attendee-1' })).toBe(one);
    });
  });

  describe('the name prefill (#133)', () => {
    test('fills an empty first attendee, trimmed', () => {
      expect(registrationReducer(fromParty(null, travelRange), { type: 'namePrefilled', name: ' Alex Tremblay ' }).attendees[0].name).toBe('Alex Tremblay');
    });

    test('never over a name already there, and not when blank', () => {
      const typed = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { name: 'Sam' } });
      expect(registrationReducer(typed, { type: 'namePrefilled', name: 'Alex' })).toBe(typed);
      const empty = fromParty(null, travelRange);
      expect(registrationReducer(empty, { type: 'namePrefilled', name: '  ' })).toBe(empty);
    });
  });

  describe('the default arrival and departure (#123)', () => {
    const later = { defaultArrival: '2026-08-01T12:00', defaultDeparture: '2026-08-03T12:00' };

    test('fill a new registration\'s empty fields', () => {
      const form = registrationReducer(fromParty(null), { type: 'travelDefaultsApplied', travelRange: later });
      expect(form).toMatchObject({ transportArrival: later.defaultArrival, transportDeparture: later.defaultDeparture });
    });

    test('never over what was picked', () => {
      const picked = registrationReducer(fromParty(null), { type: 'changed', changes: { transportArrival: '2026-08-02T09:00' } });
      expect(registrationReducer(picked, { type: 'travelDefaultsApplied', travelRange: later })).toMatchObject({ transportArrival: '2026-08-02T09:00', transportDeparture: later.defaultDeparture });
      const full = fromParty(null, travelRange);
      expect(registrationReducer(full, { type: 'travelDefaultsApplied', travelRange: later })).toBe(full);
    });

    test('not into a saved registration', () => {
      const saved = registrationReducer(fromParty(registration), { type: 'changed', changes: { transportDeparture: '' } });
      expect(registrationReducer(saved, { type: 'travelDefaultsApplied', travelRange: later })).toBe(saved);
    });
  });

  test('a different registration replaces the whole form', () => {
    const edited = registrationReducer(two(), { type: 'changed', changes: { musicRequests: 'Funk' } });
    const incoming = fromParty(registration, travelRange);
    expect(registrationReducer(edited, { type: 'replaced', form: incoming })).toEqual(incoming);
  });
});

describe('validate', () => {
  const valid = () => {
    let form = registrationReducer(fromParty(null, travelRange), { type: 'attendeeChanged', id: 'attendee-1', changes: { name: 'Alex' } });
    form = registrationReducer(form, { type: 'attendeeAdded', id: 'b' });
    return registrationReducer(form, { type: 'attendeeChanged', id: 'b', changes: { name: 'Sam' } });
  };

  test('a complete form has no issues', () => {
    expect(validate(valid())).toEqual([]);
  });

  test('a name is required, step 1 (index 0), whitespace counts as blank', () => {
    const form = registrationReducer(valid(), { type: 'attendeeChanged', id: 'b', changes: { name: '   ' } });
    expect(validate(form)).toEqual([{ step: 0, field: 'name', attendeeId: 'b', message: fr.nameRequiredError }]);
  });

  test('« Autre » diet needs its text, step 2 (index 1)', () => {
    const separate = registrationReducer(valid(), { type: 'changed', changes: { sameForEveryone: false } });
    const form = registrationReducer(separate, { type: 'attendeeChanged', id: 'attendee-1', changes: { dietaryNeeds: ['other'], dietaryOther: ' ' } });
    expect(validate(form)).toEqual([{ step: 1, field: 'dietaryOther', attendeeId: 'attendee-1', message: fr.dietaryOtherRequired }]);
    expect(validate(registrationReducer(form, { type: 'attendeeChanged', id: 'attendee-1', changes: { dietaryOther: 'Noix' } }))).toEqual([]);
  });

  test('the departure postal code is optional, but not malformed, step 3 (index 2) (#181)', () => {
    const need = registrationReducer(valid(), { type: 'changed', changes: { transportType: 'need' } });
    expect(validate(need)).toEqual([]);
    const malformed = registrationReducer(need, { type: 'changed', changes: { transportDepartureFsa: 'W1A' } });
    expect(validate(malformed)).toEqual([{ step: 2, field: 'transportDepartureFsa', message: fr.transportDepartureFsaInvalid }]);
  });

  test('every issue, in the form\'s order: by step, then by attendee', () => {
    let form = registrationReducer(fromParty(null, travelRange), { type: 'attendeeAdded', id: 'b' });
    form = registrationReducer(form, { type: 'changed', changes: { transportType: 'offer' } });
    form = registrationReducer(form, { type: 'changed', changes: { transportDepartureFsa: 'W1A' } });
    form = registrationReducer(form, { type: 'groupStayChanged', changes: { dietaryNeeds: ['other'] } });
    expect(validate(form).map(issue => [issue.step, issue.field, issue.attendeeId])).toEqual([
      [0, 'name', 'attendee-1'],
      [0, 'name', 'b'],
      [1, 'dietaryOther', 'attendee-1'],
      [1, 'dietaryOther', 'b'],
      [2, 'transportDepartureFsa', undefined]
    ]);
  });

  test('moving on from a step checks the steps up to it; submitting checks them all', () => {
    let form = registrationReducer(valid(), { type: 'changed', changes: { transportType: 'offer' } });
    form = registrationReducer(form, { type: 'changed', changes: { transportDepartureFsa: 'W1A' } });
    form = registrationReducer(form, { type: 'groupStayChanged', changes: { dietaryNeeds: ['other'] } });
    const issues = validate(form);
    expect(issuesUpToStep(issues, 0)).toEqual([]);
    expect(issuesUpToStep(issues, 1).map(issue => issue.field)).toEqual(['dietaryOther', 'dietaryOther']);
    expect(issuesUpToStep(issues, 2)).toHaveLength(3);
    expect(issues[0].step).toBe(1);
  });

  test('departureFsaInvalid agrees with validate', () => {
    const form = { ...fromParty(null, travelRange), transportType: 'offer', transportDepartureFsa: 'W1A' };
    expect(departureFsaInvalid(form)).toBe(true);
    expect(validate({ ...form, attendees: [{ ...form.attendees[0], name: 'Alex' }] })).toHaveLength(1);
  });
});
