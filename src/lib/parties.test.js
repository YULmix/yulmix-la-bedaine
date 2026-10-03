import fr from '../locales/fr.json';
import { cancelParty, fetchMyParty, fetchParty, listEventParties, listPartySummaries, saveRegistration, setPaymentStatus } from './parties';

// A Supabase client whose queries record each builder call and resolve to the next queued result.
const mockClient = (...results) => {
  const queries = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const query = (table) => {
    const calls = [];
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') {
          const result = next();
          return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args) => { calls.push([prop, ...args]); return builder; };
      }
    });
    queries.push({ table, calls });
    return builder;
  };
  const rpc = jest.fn(async () => next());
  return { client: { from: jest.fn(query), rpc }, queries };
};

const calledWith = (query, method) => query.calls.filter(([name]) => name === method).map(([, ...args]) => args);
const ORDER_ATTENDEES = ['position', { referencedTable: 'attendees' }];
const party = (id, extra = {}) => ({ id, status: 'registered', attendees: [], ...extra });

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('reads', () => {
  test('fetchParty selects the party with its attendees, ordered by position', async () => {
    const { client, queries } = mockClient({ data: party('p1'), error: null });
    await expect(fetchParty(client, 'p1')).resolves.toEqual(party('p1'));
    const [query] = queries;
    expect(query.table).toBe('user_parties');
    expect(calledWith(query, 'select')[0][0]).toMatch(/attendees\(\*, place:attendee_places/);
    expect(calledWith(query, 'eq')).toEqual([['id', 'p1']]);
    expect(calledWith(query, 'order')).toContainEqual(ORDER_ATTENDEES);
  });

  test('a member\'s party is read by named columns, never * nor the notes (#227)', async () => {
    const { client, queries } = mockClient({ data: null, error: null });
    await fetchMyParty(client, 'u1', 'e1');
    const columns = calledWith(queries[0], 'select')[0][0];
    expect(columns.split(', attendees(')[0]).not.toContain('*');
    expect(columns).toMatch(/^id, user_id, event_id, /);
    expect(columns).not.toMatch(/notes/);
  });

  test('fetchMyParty filters by member and event; none is null', async () => {
    const { client, queries } = mockClient({ data: null, error: null });
    await expect(fetchMyParty(client, 'u1', 'e1')).resolves.toBeNull();
    expect(calledWith(queries[0], 'eq')).toEqual([['user_id', 'u1'], ['event_id', 'e1']]);
    expect(calledWith(queries[0], 'order')).toContainEqual(ORDER_ATTENDEES);
  });

  test('listEventParties leaves out a deleted account\'s cancelled parties, keeps its others', async () => {
    const deleted = { deleted_at: '2026-09-01T00:00:00Z' };
    const rows = [
      party('kept', { profiles: { deleted_at: null } }),
      party('gone', { status: 'cancelled', profiles: deleted }),
      party('history', { status: 'registered', profiles: deleted }),
      party('cancelled-by-member', { status: 'cancelled', profiles: { deleted_at: null } })
    ];
    const { client, queries } = mockClient({ data: rows, error: null });
    const parties = await listEventParties(client, 'e1');
    expect(parties.map(p => p.id)).toEqual(['kept', 'history', 'cancelled-by-member']);
    expect(calledWith(queries[0], 'select')[0][0]).toMatch(/profiles!inner\(/);
    expect(calledWith(queries[0], 'order')).toEqual([['created_at', { ascending: true }], ORDER_ATTENDEES]);
  });

  test('listEventParties carries the organisers\' notes from party_admin_notes as admin_notes (#227)', async () => {
    const rows = [
      party('noted', { profiles: { deleted_at: null }, admin_note: { notes: 'VIP' } }),
      party('none', { profiles: { deleted_at: null }, admin_note: null })
    ];
    const { client, queries } = mockClient({ data: rows, error: null });
    const parties = await listEventParties(client, 'e1');
    expect(parties.map(p => [p.id, p.admin_notes, 'admin_note' in p])).toEqual([['noted', 'VIP', false], ['none', null, false]]);
    expect(calledWith(queries[0], 'select')[0][0]).toMatch(/admin_note:party_admin_notes\(notes\)/);
  });

  test('listPartySummaries says whether any attendee has a place', async () => {
    const rows = [
      { id: 'a', user_id: 'u1', status: 'registered', is_waitlisted: false, payment_status: 'paid', attendees: [{ place: null }, { place: { place_id: 'x' } }] },
      { id: 'b', user_id: 'u2', status: 'registered', is_waitlisted: true, payment_status: 'unpaid', attendees: [] }
    ];
    const { client } = mockClient({ data: rows, error: null });
    expect(await listPartySummaries(client, 'e1')).toEqual([
      { id: 'a', user_id: 'u1', status: 'registered', is_waitlisted: false, payment_status: 'paid', hasPlace: true },
      { id: 'b', user_id: 'u2', status: 'registered', is_waitlisted: true, payment_status: 'unpaid', hasPlace: false }
    ]);
  });
});

describe('writes', () => {
  test('saveRegistration calls save_registration, then returns the saved party with its attendees', async () => {
    const { client, queries } = mockClient({ data: { id: 'p1' }, error: null }, { data: party('p1'), error: null });
    const saved = await saveRegistration(client, { eventId: 'e1', attendees: [{ name: 'A' }], party: { music_requests: 'x' } });
    expect(client.rpc).toHaveBeenCalledWith('save_registration', { p_event_id: 'e1', p_attendees: [{ name: 'A' }], p_party: { music_requests: 'x' } });
    expect(calledWith(queries[0], 'eq')).toEqual([['id', 'p1']]);
    expect(saved).toEqual(party('p1'));
  });

  test('saveRegistration passes p_user_id only for an admin saving someone else\'s', async () => {
    const { client } = mockClient({ data: { id: 'p1' }, error: null }, { data: party('p1'), error: null });
    await saveRegistration(client, { eventId: 'e1', attendees: [], userId: 'u2' });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'u2', p_party: {} });
  });

  test('cancelParty sets the status and returns the party, attendees ordered', async () => {
    const { client, queries } = mockClient({ data: party('p1', { status: 'cancelled' }), error: null });
    await expect(cancelParty(client, 'p1')).resolves.toMatchObject({ status: 'cancelled' });
    expect(calledWith(queries[0], 'update')).toEqual([[{ status: 'cancelled' }]]);
    expect(calledWith(queries[0], 'eq')).toEqual([['id', 'p1']]);
    expect(calledWith(queries[0], 'order')).toContainEqual(ORDER_ATTENDEES);
  });

  test('setPaymentStatus goes through set_payment_status(), which changes only that (#217)', async () => {
    const { client, queries } = mockClient({ data: null, error: null });
    await setPaymentStatus(client, 'p1', 'paid');
    expect(client.rpc).toHaveBeenCalledWith('set_payment_status', { p_party_id: 'p1', p_payment_status: 'paid' });
    expect(queries).toEqual([]);
  });
});

describe('errors are thrown in French, raw ones logged', () => {
  const unknown = { message: 'permission denied for table user_parties', code: '42501', details: null, hint: null };

  test.each([
    ['fetchParty', (client) => fetchParty(client, 'p1'), fr.loadErrorHint],
    ['fetchMyParty', (client) => fetchMyParty(client, 'u1', 'e1'), fr.loadErrorHint],
    ['listEventParties', (client) => listEventParties(client, 'e1'), fr.loadErrorHint],
    ['listPartySummaries', (client) => listPartySummaries(client, 'e1'), fr.loadErrorHint],
    ['saveRegistration', (client) => saveRegistration(client, { eventId: 'e1', attendees: [] }), fr.saveError],
    ['cancelParty', (client) => cancelParty(client, 'p1'), fr.cancelRegistrationError],
    ['setPaymentStatus', (client) => setPaymentStatus(client, 'p1', 'paid'), fr.updateError]
  ])('%s: an unknown error becomes its fallback, never the raw message', async (_name, call, fallback) => {
    const { client } = mockClient({ data: null, error: unknown });
    const error = await call(client).catch(e => e);
    expect(error.message).toBe(fallback);
    expect(error.isAppMessage).toBe(true);
    expect(error.cause).toBe(unknown);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), unknown.message, unknown.code, null, null, unknown);
  });

  test('a code our SQL raises becomes its own French text', async () => {
    const { client } = mockClient({ data: null, error: { message: 'not_authenticated', code: 'P0001' } });
    await expect(saveRegistration(client, { eventId: 'e1', attendees: [] })).rejects.toThrow(fr.dbErrorNotAuthenticated);
  });
});
