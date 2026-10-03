import fr from '../locales/fr.json';
import { createLogisticsStore } from './logistics';
import { refreshAdminParties } from './adminParties';
import { invalidateEventPlaces } from './eventPlaces';

// jest hoists these above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./adminParties', () => ({ refreshAdminParties: jest.fn(async () => {}) }));
jest.mock('./eventPlaces', () => ({ invalidateEventPlaces: jest.fn() }));

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const p1 = { id: 'p1', event_id: EVENT, admin_notes: null, attendees: [{ id: 'a1', place: null }, { id: 'a2', place: null }] };
const p2 = { id: 'p2', event_id: EVENT, admin_notes: 'VIP', attendees: [{ id: 'a3', place: null }] };

// A client whose save_logistics answers the queued results in order.
const fakeClient = (...results) => ({
  rpc: jest.fn(async () => results.shift() ?? { data: [], error: null })
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  refreshAdminParties.mockClear();
  invalidateEventPlaces.mockClear();
});
afterEach(() => console.error.mockRestore());

describe('logistics store (#195)', () => {
  test('edits are kept per event and counted; the shell sees the total across events', () => {
    const store = createLogisticsStore(fakeClient());
    store.setPlaceChange(EVENT, p1, 'a1', 'bedA');
    store.setNotesChange(EVENT, p2, 'Arrive tard');
    store.setPlaceChange(OTHER_EVENT, { id: 'q1', attendees: [{ id: 'b1', place: null }] }, 'b1', 'bedZ');

    expect(store.getSnapshot(EVENT)).toMatchObject({
      changes: { p1: { places: { a1: 'bedA' } }, p2: { adminNotes: 'Arrive tard' } },
      errors: {},
      unsavedCount: 2,
      saving: false
    });
    expect(store.getSnapshot(OTHER_EVENT).unsavedCount).toBe(1);
    expect(store.getUnsavedTotal()).toBe(3);
    expect(store.getSnapshot(EVENT)).toBe(store.getSnapshot(EVENT));
  });

  test('without an event: nothing to save', () => {
    const store = createLogisticsStore(fakeClient());
    expect(store.getSnapshot(null)).toEqual({ changes: {}, errors: {}, unsavedCount: 0, saving: false });
  });

  test('the draft survives a screen leaving and coming back (it lives in the store)', () => {
    const store = createLogisticsStore(fakeClient());
    const stop = store.subscribe(() => {});
    store.setNotesChange(EVENT, p1, 'Note');
    stop();
    store.subscribe(() => {});
    expect(store.getSnapshot(EVENT).changes).toEqual({ p1: { adminNotes: 'Note' } });
  });

  test('discard drops the event\'s draft and messages, not another event\'s', () => {
    const store = createLogisticsStore(fakeClient());
    store.setNotesChange(EVENT, p1, 'Note');
    store.setNotesChange(OTHER_EVENT, { id: 'q1', admin_notes: null }, 'Autre');
    store.discard(EVENT);
    expect(store.getSnapshot(EVENT).unsavedCount).toBe(0);
    expect(store.getSnapshot(OTHER_EVENT).unsavedCount).toBe(1);
  });

  test('save sends the draft once, reloads the parties, and clears what was saved', async () => {
    const client = fakeClient({ data: [], error: null });
    const store = createLogisticsStore(client);
    store.setPlaceChange(EVENT, p1, 'a1', 'bedA');
    store.setNotesChange(EVENT, p2, '');
    store.setMessageChange(EVENT, p2, 'Bienvenue');

    const saving = store.save(EVENT);
    expect(store.getSnapshot(EVENT).saving).toBe(true);
    await expect(saving).resolves.toEqual({ failedPartyIds: [] });

    expect(client.rpc).toHaveBeenCalledWith('save_logistics', { p_changes: [
      { party_id: 'p1', places: { a1: 'bedA' } },
      { party_id: 'p2', places: {}, admin_notes: '', message_to_participants: 'Bienvenue' }
    ] });
    expect(refreshAdminParties).toHaveBeenCalledWith(EVENT);
    // Aperçu and Logistique take occupancy from the parties; the places don't need reloading.
    expect(invalidateEventPlaces).not.toHaveBeenCalled();
    expect(store.getSnapshot(EVENT)).toMatchObject({ changes: {}, errors: {}, unsavedCount: 0, saving: false });
  });

  test('a partly refused save keeps the refused parties\' drafts with their French message, and clears the others', async () => {
    const client = fakeClient({ data: [{ party_id: 'p2', message: 'logistics_party_not_found' }], error: null });
    const store = createLogisticsStore(client);
    store.setPlaceChange(EVENT, p1, 'a1', 'bedA');
    store.setNotesChange(EVENT, p2, 'Arrive tard');
    store.setMessageChange(EVENT, p2, 'Votre lit est au sous-sol');

    await expect(store.save(EVENT)).resolves.toEqual({ failedPartyIds: ['p2'] });

    expect(store.getSnapshot(EVENT)).toMatchObject({
      changes: { p2: { adminNotes: 'Arrive tard', participantMessage: 'Votre lit est au sous-sol' } },
      errors: { p2: fr.dbErrorLogisticsPartyNotFound },
      unsavedCount: 2
    });
  });

  test('an edit made while saving is kept', async () => {
    let answer;
    const client = { rpc: jest.fn(() => new Promise(resolve => { answer = resolve; })) };
    const store = createLogisticsStore(client);
    store.setNotesChange(EVENT, p1, 'Avant');
    const saving = store.save(EVENT);
    store.setNotesChange(EVENT, p1, 'Pendant');
    answer({ data: [], error: null });
    await saving;
    expect(store.getSnapshot(EVENT).changes).toEqual({ p1: { adminNotes: 'Pendant' } });
  });

  test('a failed call throws the French message and keeps the whole draft', async () => {
    const store = createLogisticsStore(fakeClient({ data: null, error: { message: 'logistics_changes_invalid' } }));
    store.setNotesChange(EVENT, p1, 'Note');
    await expect(store.save(EVENT)).rejects.toThrow(fr.dbErrorLogisticsChangesInvalid);
    expect(store.getSnapshot(EVENT)).toMatchObject({ changes: { p1: { adminNotes: 'Note' } }, saving: false });
    expect(refreshAdminParties).not.toHaveBeenCalled();
  });

  test('nothing to save: no call', async () => {
    const client = fakeClient();
    const store = createLogisticsStore(client);
    await expect(store.save(EVENT)).resolves.toEqual({ failedPartyIds: [] });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
