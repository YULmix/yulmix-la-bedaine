import fr from '../locales/fr.json';
import { createAdminPartiesStore } from './adminParties';
import { invalidateEventPlaces } from './eventPlaces';

// jest hoists these above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./eventPlaces', () => ({ invalidateEventPlaces: jest.fn() }));

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';

const party = (id, extra = {}) => ({
  id, event_id: EVENT, status: 'registered', payment_status: 'unpaid', attendees: [],
  profiles: { id: `u-${id}`, full_name: id, deleted_at: null }, ...extra
});

// A Supabase client: each user_parties read answers from `rows[eventId]` (or `loadError`), an
// update answers `writeError`; channel() records the realtime subscriptions, and `fire(eventId)`
// plays a change on that event's channel. `holdNext` makes the next read wait for `release()`.
const fakeClient = (rows = {}) => {
  const client = { rows, reads: [], updates: [], channels: [], removed: [], loadError: null, writeError: null };
  client.from = jest.fn(() => {
    const state = { filters: [], update: null };
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') {
          const result = state.update
            ? (client.updates.push({ values: state.update, filters: state.filters }), { data: null, error: client.writeError })
            : (() => {
              const eventId = state.filters.find(([column]) => column === 'event_id')?.[1];
              client.reads.push(eventId);
              return client.loadError ? { data: null, error: client.loadError } : { data: (client.rows[eventId] || []).map(row => ({ ...row })), error: null };
            })();
          const answer = client.holdNext
            ? new Promise(release => { client.holdNext = false; client.release = () => release(result); })
            : Promise.resolve(result);
          return (resolve, reject) => answer.then(resolve, reject);
        }
        return (...args) => {
          if (prop === 'eq') state.filters.push(args);
          if (prop === 'update') state.update = args[0];
          return builder;
        };
      }
    });
    return builder;
  });
  client.channel = jest.fn((name) => {
    const channel = { name, handlers: [] };
    channel.on = jest.fn((type, filter, handler) => { channel.handlers.push({ filter, handler }); return channel; });
    channel.subscribe = jest.fn(() => channel);
    client.channels.push(channel);
    return channel;
  });
  client.removeChannel = jest.fn(channel => { client.removed.push(channel); });
  client.fire = (eventId) => client.channels
    .filter(channel => !client.removed.includes(channel))
    .flatMap(channel => channel.handlers)
    .filter(({ filter }) => filter.filter === `event_id=eq.${eventId}`)
    .forEach(({ handler }) => handler({}));
  return client;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const watch = (store, eventId = EVENT) => {
  const seen = { count: 0 };
  seen.stop = store.subscribe(eventId, () => { seen.count += 1; });
  return seen;
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  invalidateEventPlaces.mockClear();
});
afterEach(() => console.error.mockRestore());

describe('admin parties store (#195)', () => {
  test('loads an event\'s parties once for its first screen; activeParties leaves out cancelled ones', async () => {
    const client = fakeClient({ [EVENT]: [party('a'), party('b', { status: 'cancelled' })] });
    const store = createAdminPartiesStore(client);
    expect(store.getSnapshot(EVENT)).toMatchObject({ parties: [], loading: true, error: null });

    watch(store);
    watch(store);
    await settle();

    expect(client.reads).toEqual([EVENT]);
    const snapshot = store.getSnapshot(EVENT);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(snapshot.parties.map(p => p.id)).toEqual(['a', 'b']);
    expect(snapshot.activeParties.map(p => p.id)).toEqual(['a']);
    expect(store.getSnapshot(EVENT)).toBe(snapshot);
  });

  test('without an event: nothing, not loading, and no query', () => {
    const client = fakeClient();
    const store = createAdminPartiesStore(client);
    expect(store.getSnapshot(null)).toEqual({ parties: [], activeParties: [], loading: false, error: null });
    expect(client.from).not.toHaveBeenCalled();
  });

  test('a failed load keeps the French message, not an empty list that looks loaded', async () => {
    const client = fakeClient();
    client.loadError = { message: 'boom' };
    const store = createAdminPartiesStore(client);
    watch(store);
    await settle();
    expect(store.getSnapshot(EVENT)).toMatchObject({ parties: [], loading: false, error: fr.loadErrorHint });
  });

  test('a failed reload keeps the parties already shown, with the error', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    watch(store);
    await settle();
    client.loadError = { message: 'boom' };
    await store.refresh(EVENT);
    expect(store.getSnapshot(EVENT)).toMatchObject({ loading: false, error: fr.loadErrorHint });
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['a']);
  });

  test('the realtime channel is open only while someone watches; a change reloads', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    const first = watch(store);
    const second = watch(store);
    await settle();
    expect(client.channels).toHaveLength(1);
    expect(client.channels[0].handlers[0].filter).toMatchObject({ table: 'user_parties', filter: `event_id=eq.${EVENT}` });

    client.rows[EVENT] = [party('a'), party('b')];
    client.fire(EVENT);
    await settle();
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['a', 'b']);

    first.stop();
    expect(client.removed).toHaveLength(0);
    second.stop();
    expect(client.removed).toEqual([client.channels[0]]);
  });

  test('switching sections (unsubscribe, resubscribe) shows the cached parties while it reloads', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    watch(store).stop();
    await settle();
    client.rows[EVENT] = [party('a'), party('b')];

    watch(store);
    expect(store.getSnapshot(EVENT)).toMatchObject({ loading: false });
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['a']);
    await settle();
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['a', 'b']);
    expect(client.channels).toHaveLength(2);
  });

  test('events are cached apart', async () => {
    const client = fakeClient({ [EVENT]: [party('a')], [OTHER_EVENT]: [party('z', { event_id: OTHER_EVENT })] });
    const store = createAdminPartiesStore(client);
    watch(store, EVENT);
    watch(store, OTHER_EVENT);
    await settle();
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['a']);
    expect(store.getSnapshot(OTHER_EVENT).parties.map(p => p.id)).toEqual(['z']);
  });

  test('refresh reloads a watched event, and leaves an unwatched one to its next screen', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    await store.refresh(EVENT);
    expect(client.reads).toEqual([]);
    watch(store);
    await settle();
    await store.refresh(EVENT);
    expect(client.reads).toEqual([EVENT, EVENT]);
  });

  test('only the newest load\'s answer lands', async () => {
    const client = fakeClient({ [EVENT]: [party('old')] });
    client.holdNext = true;
    const store = createAdminPartiesStore(client);
    watch(store);
    client.rows[EVENT] = [party('new')];
    await store.refresh(EVENT);
    client.release();
    await settle();
    expect(store.getSnapshot(EVENT).parties.map(p => p.id)).toEqual(['new']);
  });

  test('reloading parties leaves the event places alone (Aperçu and Logistique read occupancy from the parties)', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    watch(store);
    await settle();
    await store.refresh(EVENT);
    client.fire(EVENT);
    await settle();
    expect(invalidateEventPlaces).not.toHaveBeenCalled();
  });

  test('updatePaymentStatus writes it, then reloads the party\'s event', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    watch(store);
    await settle();
    client.rows[EVENT] = [party('a', { payment_status: 'paid' })];

    await store.updatePaymentStatus(party('a'), 'paid');

    expect(client.updates).toEqual([{ values: { payment_status: 'paid' }, filters: [['id', 'a']] }]);
    expect(store.getSnapshot(EVENT).parties[0].payment_status).toBe('paid');
  });

  test('updatePaymentStatus throws the French message and doesn\'t reload', async () => {
    const client = fakeClient({ [EVENT]: [party('a')] });
    const store = createAdminPartiesStore(client);
    watch(store);
    await settle();
    client.writeError = { message: 'denied' };
    await expect(store.updatePaymentStatus(party('a'), 'paid')).rejects.toThrow(fr.updateError);
    expect(client.reads).toEqual([EVENT]);
  });
});
