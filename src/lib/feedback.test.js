import fr from '../locales/fr.json';
import { createFeedbackStore } from './feedback';

// jest hoists this above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));

// A client whose queries record each builder call and resolve to the next queued result.
const mockClient = (...results) => {
  const queries = [];
  const query = (table) => {
    const calls = [];
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') {
          const result = results.shift() ?? { data: [], error: null };
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
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const item = (id, isResolved = false) => ({ id, is_resolved: isResolved, message: id, profiles: null });

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('feedback store (#195)', () => {
  test('loads once for its first screen, newest first, and counts the unresolved', async () => {
    const { client, queries } = mockClient({ data: [item('a'), item('b', true), item('c')], error: null });
    const store = createFeedbackStore(client);
    expect(store.getSnapshot()).toMatchObject({ loading: true, items: [] });
    store.subscribe(() => {});
    store.subscribe(() => {});
    await settle();
    expect(queries).toHaveLength(1);
    expect(calledWith(queries[0], 'order')).toEqual([['created_at', { ascending: false }]]);
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, unresolvedCount: 2 });
  });

  test('a failed load keeps the French message', async () => {
    const { client } = mockClient({ data: null, error: { message: 'boom' } });
    const store = createFeedbackStore(client);
    store.subscribe(() => {});
    await settle();
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: fr.loadErrorHint, items: [] });
  });

  test('resolving one writes it, then reloads', async () => {
    const { client, queries } = mockClient(
      { data: [item('a')], error: null },
      { data: null, error: null },
      { data: [item('a', true)], error: null }
    );
    const store = createFeedbackStore(client);
    store.subscribe(() => {});
    await settle();
    await store.resolve('a');
    expect(calledWith(queries[1], 'update')[0][0]).toMatchObject({ is_resolved: true });
    expect(calledWith(queries[1], 'eq')).toEqual([['id', 'a']]);
    expect(store.getSnapshot().unresolvedCount).toBe(0);
  });

  test('a refused resolve throws the French message and doesn\'t reload', async () => {
    const { client, queries } = mockClient({ data: [item('a')], error: null }, { data: null, error: { message: 'boom' } });
    const store = createFeedbackStore(client);
    store.subscribe(() => {});
    await settle();
    await expect(store.resolve('a')).rejects.toThrow(fr.error);
    expect(queries).toHaveLength(2);
  });
});
