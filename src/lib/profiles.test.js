import fr from '../locales/fr.json';
import { currentUserId, fetchEventHistory, setIsAdmin } from './profiles';

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
  const auth = { getSession: jest.fn(async () => next()) };
  return { client: { from: jest.fn(query), rpc, auth }, queries };
};
const calledWith = (query, method) => query.calls.filter(([name]) => name === method).map(([, ...args]) => args);

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

test('currentUserId reads the auth session; signed out is null', async () => {
  const { client } = mockClient({ data: { session: { user: { id: 'me' } } } }, { data: { session: null } });
  await expect(currentUserId(client)).resolves.toBe('me');
  await expect(currentUserId(client)).resolves.toBeNull();
});

test('fetchEventHistory reads the member\'s history, newest first', async () => {
  const { client, queries } = mockClient({ data: [{ event_theme: 'A' }], error: null });
  await expect(fetchEventHistory(client, 'u1')).resolves.toEqual([{ event_theme: 'A' }]);
  expect(queries[0].table).toBe('user_event_history');
  expect(calledWith(queries[0], 'eq')).toEqual([['user_id', 'u1']]);
  expect(calledWith(queries[0], 'order')).toEqual([['registration_date', { ascending: false }]]);
});

test('fetchEventHistory throws the French message', async () => {
  const { client } = mockClient({ data: null, error: { message: 'boom' } });
  await expect(fetchEventHistory(client, 'u1')).rejects.toThrow(fr.historyFetchError);
});

describe('setIsAdmin', () => {
  test('calls admin_set_is_admin', async () => {
    const { client } = mockClient({ data: null, error: null });
    await setIsAdmin(client, { profileId: 'u2', isAdmin: true, currentUser: 'me' });
    expect(client.rpc).toHaveBeenCalledWith('admin_set_is_admin', { target_user_id: 'u2', new_is_admin: true });
  });

  test('refuses one\'s own flag without asking', async () => {
    const { client } = mockClient();
    await expect(setIsAdmin(client, { profileId: 'me', isAdmin: false, currentUser: 'me' })).rejects.toThrow(fr.selfAdminToggleError);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test('maps the database\'s refusal and anything else', async () => {
    const { client } = mockClient(
      { data: null, error: { message: 'root_admin_cannot_be_demoted' } },
      { data: null, error: { message: 'boom' } }
    );
    const args = { profileId: 'u2', isAdmin: false, currentUser: 'me' };
    await expect(setIsAdmin(client, args)).rejects.toThrow(fr.dbErrorRootAdminCannotBeDemoted);
    await expect(setIsAdmin(client, args)).rejects.toThrow(fr.updateError);
  });
});
