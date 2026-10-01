import { draftFormFor, draftStorageKey, formStateOf, loadStoredDraft, makeDraft, sameFormState, storeDraft } from './registrationDraft.js';

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

describe('formStateOf', () => {
  test('a new registration: one empty attendee, the event days as arrival and departure', () => {
    const form = formStateOf(null, travelRange);
    expect(form.attendees).toHaveLength(1);
    expect(form.attendees[0]).toMatchObject({ id: 'attendee-1', name: '', type: 'Adult', dietaryNeeds: [] });
    expect(form).toMatchObject({ sameForEveryone: true, transportArrival: travelRange.defaultArrival, transportDeparture: travelRange.defaultDeparture });
  });

  test('a saved registration: its attendees and answers, saved times kept, missing ones defaulted', () => {
    const form = formStateOf(registration, travelRange);
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
    const need = seats => formStateOf({ ...registration, transport: { type: 'need', seats } }, travelRange).transportSeats;
    expect(need(1)).toBe(1);
    expect(need(0)).toBe(2);
    expect(need(undefined)).toBe(2);
    expect(formStateOf({ ...registration, transport: { type: '', seats: 0 } }, travelRange).transportSeats).toBe(0);
  });

  test('"same for everyone" only when the saved choices are identical', () => {
    const differing = { ...registration, attendees: [registration.attendees[0], { ...registration.attendees[1], dietary_needs: ['none'] }] };
    expect(formStateOf(differing, travelRange).sameForEveryone).toBe(false);
  });
});

describe('draftFormFor', () => {
  const edited = { ...formStateOf(registration, travelRange), musicRequests: 'Funk' };

  test('restores a draft taken over the same saved registration', () => {
    expect(draftFormFor(makeDraft(edited, registration), registration)).toEqual(edited);
  });

  test('drops it when the registration was saved differently since', () => {
    const savedSince = { ...registration, music_requests: 'Rock' };
    expect(draftFormFor(makeDraft(edited, registration), savedSince)).toBeNull();
  });

  test('a new registration draft applies only while there is still no registration', () => {
    const draft = makeDraft({ ...formStateOf(null, travelRange), musicRequests: 'Funk' }, null);
    expect(draftFormFor(draft, null)?.musicRequests).toBe('Funk');
    expect(draftFormFor(draft, registration)).toBeNull();
  });

  test('ignores anything that is not a draft', () => {
    expect(draftFormFor(null, null)).toBeNull();
    expect(draftFormFor('oops', null)).toBeNull();
    expect(draftFormFor({ form: { attendees: [] }, saved: null }, null)).toBeNull();
  });

  test('survives the JSON round trip through storage', () => {
    const stored = JSON.parse(JSON.stringify(makeDraft(edited, registration)));
    expect(sameFormState(draftFormFor(stored, registration), edited)).toBe(true);
  });
});

describe('storage', () => {
  const key = draftStorageKey('user-1', 'event-1');
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  afterEach(() => {
    Object.defineProperty(window, 'sessionStorage', original);
    window.sessionStorage.clear();
  });

  test('keyed by member and event', () => {
    expect(key).not.toBe(draftStorageKey('user-2', 'event-1'));
    expect(key).not.toBe(draftStorageKey('user-1', 'event-2'));
  });

  test('stores, loads and removes a draft', () => {
    const draft = makeDraft(formStateOf(null, travelRange), null);
    storeDraft(key, draft);
    expect(loadStoredDraft(key)).toEqual(draft);
    storeDraft(key, null);
    expect(loadStoredDraft(key)).toBeNull();
  });

  test('blocked storage means no draft, never an error', () => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    expect(() => storeDraft(key, makeDraft(formStateOf(null, travelRange), null))).not.toThrow();
    expect(loadStoredDraft(key)).toBeNull();
  });
});
