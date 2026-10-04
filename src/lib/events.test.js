import fr from '../locales/fr.json';
import { createEventsStore } from './events';
import { invalidateEventPlaces } from './eventPlaces';

// jest hoists these above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./eventPlaces', () => ({ invalidateEventPlaces: jest.fn() }));

// A Supabase client whose queries record each builder call and resolve to the next queued result;
// once the queue is empty, every query resolves to `fallback`.
const mockClient = (results, fallback = { data: [], error: null }) => {
  const queries = [];
  const query = (table) => {
    const calls = [];
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') {
          const result = results.length ? results.shift() : fallback;
          return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args) => { calls.push([prop, ...args]); return builder; };
      }
    });
    queries.push({ table, calls });
    return builder;
  };
  return { client: { from: jest.fn(query) }, queries };
};
const calledWith = (query, method) => query.calls.filter(([name]) => name === method).map(([, ...args]) => args);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const event = (id, extra = {}) => ({ id, theme: id, is_active: false, status: 'DRAFT', venue: null, ...extra });
const ACTIVE = event('active', { is_active: true, status: 'ACTIVE' });
const OTHER = event('other');

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  invalidateEventPlaces.mockClear();
});
afterEach(() => console.error.mockRestore());

describe('loading', () => {
  test('loads when the first screen subscribes, not before, and only once', async () => {
    const { client } = mockClient([{ data: [OTHER, ACTIVE], error: null }]);
    const store = createEventsStore(client);
    expect(store.getSnapshot()).toMatchObject({ loading: true, events: [], activeEvent: null });
    expect(client.from).not.toHaveBeenCalled();

    const listener = jest.fn();
    store.subscribe(listener);
    store.subscribe(jest.fn());
    await flush();
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ events: [OTHER, ACTIVE], activeEvent: ACTIVE, otherEvents: [OTHER], loading: false, error: null });
  });

  test('newest first, with the venue', async () => {
    const { client, queries } = mockClient([]);
    await createEventsStore(client).refresh();
    expect(queries[0].table).toBe('events');
    expect(calledWith(queries[0], 'select')[0][0]).toMatch(/venue:venues\(/);
    expect(calledWith(queries[0], 'order')).toEqual([['created_at', { ascending: false }]]);
  });

  test('a failed load is not "no events": nothing is active, the error is in French', async () => {
    const { client } = mockClient([{ data: null, error: { message: 'boom', code: '500' } }]);
    const snapshot = await createEventsStore(client).refresh();
    expect(snapshot).toEqual({ events: [], activeEvent: null, otherEvents: [], loading: false, error: fr.loadErrorHint });
    expect(console.error).toHaveBeenCalled();
  });

  test('a slower, older load never overwrites a newer one', async () => {
    let releaseFirst;
    const first = new Promise(resolve => { releaseFirst = () => resolve({ data: [OTHER], error: null }); });
    const { client } = mockClient([first, { data: [ACTIVE], error: null }]);
    const store = createEventsStore(client);
    const older = store.refresh();
    await store.refresh();
    releaseFirst();
    await older;
    expect(store.getSnapshot().events).toEqual([ACTIVE]);
  });
});

describe('writes reload the list, for every screen', () => {
  test('activateEvent marks it active, then reloads', async () => {
    const { client, queries } = mockClient([{ data: [OTHER], error: null }, { data: null, error: null }, { data: [{ ...OTHER, is_active: true }], error: null }]);
    const store = createEventsStore(client);
    await store.refresh();
    await store.activateEvent(OTHER);
    expect(calledWith(queries[1], 'update')).toEqual([[{ is_active: true, status: 'ACTIVE' }]]);
    expect(calledWith(queries[1], 'eq')).toEqual([['id', 'other']]);
    expect(store.getSnapshot().activeEvent.id).toBe('other');
  });

  test('activateEvent refuses a second active event before asking the database', async () => {
    const { client } = mockClient([{ data: [ACTIVE, OTHER], error: null }]);
    const store = createEventsStore(client);
    await store.refresh();
    await expect(store.activateEvent(OTHER)).rejects.toThrow(fr.eventAlreadyActiveError);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  test('activateEvent: the database\'s coded refusal says the same', async () => {
    const { client } = mockClient([{ data: [OTHER], error: null }, { data: null, error: { message: 'event_already_active', code: '23505' } }]);
    const store = createEventsStore(client);
    await store.refresh();
    await expect(store.activateEvent(OTHER)).rejects.toThrow(fr.eventAlreadyActiveError);
  });

  test('archiveEvent archives, reloads the event\'s places and the list', async () => {
    const { client, queries } = mockClient([{ data: null, error: null }]);
    const store = createEventsStore(client);
    await store.archiveEvent(ACTIVE);
    expect(calledWith(queries[0], 'update')).toEqual([[{ is_active: false, status: 'ARCHIVED' }]]);
    expect(invalidateEventPlaces).toHaveBeenCalledWith('active');
    expect(queries[1].table).toBe('events');
  });

  test('saveEventChanges sends only the fields that changed', async () => {
    const { client, queries } = mockClient([{ data: null, error: null }]);
    await createEventsStore(client).saveEventChanges(event('e', { theme: 'Old', description: 'Same' }), { theme: 'New', description: 'Same' });
    expect(calledWith(queries[0], 'update')).toEqual([[{ theme: 'New' }]]);
    expect(queries).toHaveLength(2);
  });

  test('createEvent inserts an inactive, registration-closed draft whatever the changes say, then reloads', async () => {
    const { client, queries } = mockClient([{ data: { id: 'new-id' }, error: null }]);
    const id = await createEventsStore(client).createEvent({
      theme: '  Soirée  ', event_start_date: '2027-03-05T20:00', max_attendees: '40', description: '', is_active: true, is_reg_open: true, status: 'ACTIVE'
    });
    expect(id).toBe('new-id');
    const [[values]] = calledWith(queries[0], 'insert');
    expect(values).toMatchObject({ theme: 'Soirée', max_attendees: 40, status: 'DRAFT', is_active: false, is_reg_open: false });
    expect(values.event_start_date).toMatch(/^2027-03-0[56]T/);
    // Untouched and emptied fields are left to the schema's defaults.
    expect(values).not.toHaveProperty('description');
    expect(queries).toHaveLength(2);
  });

  test('createEvent: a refusal throws the French message and reloads nothing', async () => {
    const { client, queries } = mockClient([{ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }]);
    await expect(createEventsStore(client).createEvent({ theme: 'x' })).rejects.toThrow(/^(?!.*row-level)/);
    expect(queries).toHaveLength(1);
  });

  test('applyPricing writes the pricing, then reloads', async () => {
    const { client, queries } = mockClient([{ data: null, error: null }]);
    await createEventsStore(client).applyPricing('e', { selling_price_whole_event: 300 });
    expect(calledWith(queries[0], 'update')).toEqual([[{ selling_price_whole_event: 300 }]]);
    expect(queries).toHaveLength(2);
  });

  test.each([
    ['activateEvent', store => store.activateEvent(OTHER), fr.eventActivationError],
    ['archiveEvent', store => store.archiveEvent(OTHER), fr.eventArchivingError],
    ['saveEventChanges', store => store.saveEventChanges(OTHER, { theme: 'x' }), fr.updateError],
    ['applyPricing', store => store.applyPricing('other', {}), fr.updateError]
  ])('%s: a failure throws its French message and reloads nothing', async (_name, call, message) => {
    const { client } = mockClient([{ data: null, error: { message: 'permission denied', code: '42501' } }]);
    const store = createEventsStore(client);
    await expect(call(store)).rejects.toThrow(message);
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
