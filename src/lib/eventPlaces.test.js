// The Supabase client reads import.meta.env, which Jest can't parse; the store gets a stand-in.
jest.mock('./supabase', () => ({ supabase: {} }));

import { createEventPlacesStore } from './eventPlaces';

const EVENT = 'event-1';

// event_places() rows, as the database returns them.
const row = (id, fields = {}) => ({
  place_id: id, label: `Lit ${id}`, type: 'bed', location_id: 'room-1', location_name: 'Chambre 1',
  venue_capacity: 2, capacity: 2, is_excluded: false, occupants: [], position: 1, ...fields
});

// A client whose rpc answers from `rows` (event_places) and echoes set_place_override as the
// database would. `hold` makes the next set_place_override wait until released.
const fakeClient = (rows) => {
  const client = { rows, held: [] };
  client.rpc = jest.fn(async (fn, args) => {
    if (fn === 'event_places') return { data: client.rows.map(r => ({ ...r })), error: client.loadError || null };
    if (fn === 'set_place_override') {
      if (client.writeError) return { data: null, error: client.writeError };
      const answer = () => {
        const current = client.rows.find(r => r.place_id === args.p_place_id);
        Object.assign(current, { is_excluded: args.p_is_excluded, capacity: args.p_capacity ?? current.venue_capacity });
        return { data: [{ ...current }], error: null };
      };
      if (client.hold) return new Promise(resolve => client.held.push(() => resolve(answer())));
      return answer();
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
  client.calls = (fn) => client.rpc.mock.calls.filter(([name]) => name === fn);
  return client;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// Subscribes like a screen would; returns the unsubscribe and how many times it was told.
const watch = (store, eventId = EVENT) => {
  const seen = { count: 0 };
  seen.stop = store.subscribe(eventId, () => { seen.count += 1; });
  return seen;
};

describe('event places store (#193)', () => {
  test('loads the event places once for its first screen, in camelCase; available leaves out excluded places', async () => {
    const client = fakeClient([row('a'), row('b', { is_excluded: true, position: 2 })]);
    const store = createEventPlacesStore(client);
    expect(store.getSnapshot(EVENT).loading).toBe(true);

    watch(store);
    watch(store);
    await settle();

    const { places, available, loading, error } = store.getSnapshot(EVENT);
    expect(client.calls('event_places')).toEqual([['event_places', { p_event_id: EVENT }]]);
    expect(loading).toBe(false);
    expect(error).toBeNull();
    expect(places.map(place => [place.id, place.isExcluded])).toEqual([['a', false], ['b', true]]);
    expect(places[0]).toMatchObject({ locationId: 'room-1', locationName: 'Chambre 1', venueCapacity: 2, capacity: 2, occupants: [] });
    expect(available.map(place => place.id)).toEqual(['a']);
  });

  test('the snapshot stays the same object until something changes', async () => {
    const store = createEventPlacesStore(fakeClient([row('a')]));
    watch(store);
    await settle();
    const before = store.getSnapshot(EVENT);
    expect(store.getSnapshot(EVENT)).toBe(before);
    store.editPlace(EVENT, 'a', { capacity: 3 });
    expect(store.getSnapshot(EVENT)).not.toBe(before);
  });

  test('an edit shows at once to every screen on the event, without asking the database', async () => {
    const client = fakeClient([row('a'), row('b')]);
    const store = createEventPlacesStore(client);
    const couchage = watch(store);
    const apercu = watch(store);
    await settle();
    const loads = client.rpc.mock.calls.length;

    store.editPlace(EVENT, 'a', { isExcluded: true });

    expect(client.rpc.mock.calls.length).toBe(loads);
    expect(apercu.count).toBeGreaterThan(0);
    expect(couchage.count).toBe(apercu.count);
    expect(store.getSnapshot(EVENT).available.map(place => place.id)).toEqual(['b']);
  });

  test('savePlace sends the whole setting as shown, and takes the database row back', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    watch(store);
    await settle();

    store.editPlace(EVENT, 'a', { capacity: 4 });
    store.editPlace(EVENT, 'a', { isExcluded: true });
    expect(await store.savePlace(EVENT, 'a')).toEqual({ error: null });

    expect(client.calls('set_place_override')).toEqual([['set_place_override', {
      p_event_id: EVENT, p_place_id: 'a', p_is_excluded: true, p_capacity: 4
    }]]);
    expect(store.getSnapshot(EVENT).places[0]).toMatchObject({ isExcluded: true, capacity: 4 });
  });

  test("an older write's answer doesn't undo a newer edit", async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    watch(store);
    await settle();

    client.hold = true;
    store.editPlace(EVENT, 'a', { isExcluded: true });
    const first = store.savePlace(EVENT, 'a');
    store.editPlace(EVENT, 'a', { isExcluded: false });
    client.held.shift()();
    await first;
    expect(store.getSnapshot(EVENT).places[0].isExcluded).toBe(false);

    const second = store.savePlace(EVENT, 'a');
    client.held.shift()();
    await second;
    expect(store.getSnapshot(EVENT).places[0].isExcluded).toBe(false);
    expect(client.rows[0].is_excluded).toBe(false);
  });

  test('a refused write returns the error and reloads, dropping the edits', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    watch(store);
    await settle();

    client.writeError = { message: 'place_exclusion_occupied' };
    store.editPlace(EVENT, 'a', { isExcluded: true });
    const { error } = await store.savePlace(EVENT, 'a');

    expect(error).toEqual({ message: 'place_exclusion_occupied' });
    expect(client.calls('event_places')).toHaveLength(2);
    expect(store.getSnapshot(EVENT).places[0].isExcluded).toBe(false);
  });

  test('a load failure is French text and keeps what was shown', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    const screen = watch(store);
    await settle();
    screen.stop();

    client.loadError = { message: 'boom' };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    watch(store);
    await settle();

    const { places, error, loading } = store.getSnapshot(EVENT);
    expect(error).toBe('Impossible de charger les places de l\'événement.');
    expect(loading).toBe(false);
    expect(places.map(place => place.id)).toEqual(['a']);
    console.error.mockRestore();
  });

  test('invalidating reloads once for screens showing the event, and not at all for the others', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    watch(store);
    watch(store);
    await settle();

    client.rows[0].occupants = ['Ann'];
    store.invalidate(EVENT);
    store.invalidate('another-event');
    await settle();

    expect(client.calls('event_places')).toHaveLength(2);
    expect(store.getSnapshot(EVENT).places[0].occupants).toEqual(['Ann']);
  });

  test('invalidating without an event reloads every watched one', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    watch(store, 'e1');
    watch(store, 'e2');
    await settle();

    store.invalidate();
    await settle();

    expect(client.calls('event_places').map(([, args]) => args.p_event_id)).toEqual(['e1', 'e2', 'e1', 'e2']);
  });

  test('a screen arriving while another shows the event costs nothing; one arriving after all left revalidates', async () => {
    const client = fakeClient([row('a')]);
    const store = createEventPlacesStore(client);
    const admin = watch(store);
    await settle();

    const tab = watch(store);
    tab.stop();
    expect(client.calls('event_places')).toHaveLength(1);

    admin.stop();
    client.rows[0].capacity = 5;
    watch(store);
    // The cached places show while the reload runs.
    expect(store.getSnapshot(EVENT)).toMatchObject({ loading: false, places: [expect.objectContaining({ capacity: 2 })] });
    await settle();
    expect(client.calls('event_places')).toHaveLength(2);
    expect(store.getSnapshot(EVENT).places[0].capacity).toBe(5);
  });

  test('without an event there is nothing, and nothing is asked', () => {
    const client = fakeClient([]);
    const store = createEventPlacesStore(client);
    expect(store.getSnapshot(null)).toEqual({ places: [], available: [], loading: false, error: null });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
