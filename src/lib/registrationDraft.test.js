import { fromParty } from './registration';
import { draftFormFor, draftStorageKey, loadStoredDraft, makeDraft, sameFormState, storeDraft } from './registrationDraft';

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

describe('draftFormFor', () => {
  const edited = { ...fromParty(registration, travelRange), musicRequests: 'Funk' };

  test('restores a draft taken over the same saved registration', () => {
    expect(draftFormFor(makeDraft(edited, registration), registration)).toEqual(edited);
  });

  test('drops it when the registration was saved differently since', () => {
    const savedSince = { ...registration, music_requests: 'Rock' };
    expect(draftFormFor(makeDraft(edited, registration), savedSince)).toBeNull();
  });

  test('a new registration draft applies only while there is still no registration', () => {
    const draft = makeDraft({ ...fromParty(null, travelRange), musicRequests: 'Funk' }, null);
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
    const draft = makeDraft(fromParty(null, travelRange), null);
    storeDraft(key, draft);
    expect(loadStoredDraft(key)).toEqual(draft);
    storeDraft(key, null);
    expect(loadStoredDraft(key)).toBeNull();
  });

  test('blocked storage means no draft, never an error', () => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    expect(() => storeDraft(key, makeDraft(fromParty(null, travelRange), null))).not.toThrow();
    expect(loadStoredDraft(key)).toBeNull();
  });
});
