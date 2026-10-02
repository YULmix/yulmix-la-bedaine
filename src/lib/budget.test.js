import fr from '../locales/fr.json';
import { createBudgetStore } from './budget';

// jest hoists this above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const row = (eventId = EVENT, extra = {}) => ({ event_id: eventId, lines: [{ category: 'food', description: 'Bouffe', amount: 100 }], contingency_pct: 20, total_cost: 100, ...extra });

// A client whose event_budgets reads answer from `rows[eventId]` (or `loadError`), and whose
// upsert echoes what it got as the saved row (or answers `saveError`).
const fakeClient = (rows = {}) => {
  const client = { rows, reads: [], upserts: [], loadError: null, saveError: null };
  client.from = jest.fn(() => {
    const state = { eventId: null, upsert: null };
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') {
          let result;
          if (state.upsert) {
            client.upserts.push(state.upsert);
            result = client.saveError ? { data: null, error: client.saveError } : { data: { ...state.upsert, total_cost: 1 }, error: null };
          } else {
            client.reads.push(state.eventId);
            result = client.loadError ? { data: null, error: client.loadError } : { data: client.rows[state.eventId] ?? null, error: null };
          }
          return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args) => {
          if (prop === 'eq') state.eventId = args[1];
          if (prop === 'upsert') state.upsert = args[0];
          return builder;
        };
      }
    });
    return builder;
  });
  return client;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const watch = (store, eventId = EVENT) => store.subscribe(eventId, () => {});

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('budget store (#195)', () => {
  test('loads an event\'s budget for its first screen; none saved yet is null, not loading', async () => {
    const client = fakeClient({ [EVENT]: row() });
    const store = createBudgetStore(client);
    expect(store.getSnapshot(EVENT)).toMatchObject({ budget: null, loading: true });
    watch(store);
    watch(store);
    watch(store, OTHER_EVENT);
    await settle();
    expect(client.reads).toEqual([EVENT, OTHER_EVENT]);
    expect(store.getSnapshot(EVENT)).toMatchObject({ budget: row(), draft: null, loading: false, error: null, saving: false });
    expect(store.getSnapshot(OTHER_EVENT)).toMatchObject({ budget: null, loading: false });
  });

  test('without an event: nothing, not loading', () => {
    const store = createBudgetStore(fakeClient());
    expect(store.getSnapshot(null)).toEqual({ budget: null, draft: null, loading: false, error: null, saving: false });
  });

  test('a failed load keeps the French message', async () => {
    const client = fakeClient();
    client.loadError = { message: 'boom' };
    const store = createBudgetStore(client);
    watch(store);
    await settle();
    expect(store.getSnapshot(EVENT)).toMatchObject({ loading: false, error: fr.loadErrorHint });
  });

  test('a draft survives leaving the section and coming back, and belongs to its event', async () => {
    const client = fakeClient({ [EVENT]: row() });
    const store = createBudgetStore(client);
    const stop = watch(store);
    await settle();
    const draft = { lines: [], contingency: '10' };
    store.setDraft(EVENT, draft);
    stop();
    watch(store);
    await settle();
    expect(store.getSnapshot(EVENT).draft).toEqual(draft);
    expect(store.getSnapshot(OTHER_EVENT).draft).toBeNull();
  });

  test('save cleans the lines, clamps the contingency, then shows the saved row and drops the draft', async () => {
    const client = fakeClient({ [EVENT]: row() });
    const store = createBudgetStore(client);
    watch(store);
    await settle();
    store.setDraft(EVENT, { lines: [], contingency: '150' });
    const saving = store.save(EVENT, [{ category: 'food', description: '  Pain ', amount: '-5', extra: 'x' }], '150');
    expect(store.getSnapshot(EVENT).saving).toBe(true);
    await saving;
    expect(client.upserts).toEqual([{ event_id: EVENT, lines: [{ category: 'food', description: 'Pain', amount: 0 }], contingency_pct: 100 }]);
    expect(store.getSnapshot(EVENT)).toMatchObject({ draft: null, saving: false, budget: { event_id: EVENT, contingency_pct: 100 } });
  });

  test('a refused save throws the code\'s French message and keeps the draft', async () => {
    const client = fakeClient({ [EVENT]: row() });
    const store = createBudgetStore(client);
    watch(store);
    await settle();
    const draft = { lines: [], contingency: '20' };
    store.setDraft(EVENT, draft);
    client.saveError = { message: 'event_budget_lines_invalid' };
    await expect(store.save(EVENT, [], '20')).rejects.toThrow(fr.dbErrorEventBudgetInvalid);
    client.saveError = { message: 'boom' };
    await expect(store.save(EVENT, [], '20')).rejects.toThrow(fr.saveError);
    expect(store.getSnapshot(EVENT)).toMatchObject({ draft, saving: false, budget: row() });
  });
});
