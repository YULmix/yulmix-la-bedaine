import { createEventDraftStore } from './eventDrafts';

// jest hoists these above the imports.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./events', () => ({ saveEventChanges: jest.fn() }));

const EVENT = { id: 'event-1', theme: 'Disco', max_attendees: 40 };
const OTHER = { id: 'event-2', theme: 'Jungle', max_attendees: 60 };

// sessionStorage as a map; `saved` is what the save function receives.
const setup = ({ stored = {}, save = jest.fn(async () => {}) } = {}) => {
  const storage = new Map(Object.entries(stored));
  const store = createEventDraftStore({
    save,
    load: id => storage.get(id) ?? null,
    persist: (id, changes) => (Object.keys(changes).length ? storage.set(id, changes) : storage.delete(id))
  });
  return { store, storage, save };
};

describe('event draft store (#195)', () => {
  test('an event opens with the draft left in sessionStorage, marked restored', () => {
    const { store } = setup({ stored: { [EVENT.id]: { theme: 'Disco 2' } } });
    expect(store.getSnapshot(EVENT.id)).toMatchObject({ changes: { theme: 'Disco 2' }, restored: true, saving: false });
    expect(store.getSnapshot(OTHER.id)).toMatchObject({ changes: {}, restored: false });
    expect(store.getSnapshot(EVENT.id)).toBe(store.getSnapshot(EVENT.id));
  });

  test('edits are kept per event and mirrored to sessionStorage', () => {
    const { store, storage } = setup();
    store.setField(EVENT.id, 'theme', 'Disco 2');
    store.setField(OTHER.id, 'max_attendees', '80');
    expect(store.getSnapshot(EVENT.id).changes).toEqual({ theme: 'Disco 2' });
    expect(store.getSnapshot(OTHER.id).changes).toEqual({ max_attendees: '80' });
    expect(storage.get(EVENT.id)).toEqual({ theme: 'Disco 2' });
  });

  test('a draft survives a screen leaving and coming back (it lives in the store)', () => {
    const { store } = setup();
    const stop = store.subscribe(() => {});
    store.setField(EVENT.id, 'theme', 'Disco 2');
    stop();
    store.subscribe(() => {});
    expect(store.getSnapshot(EVENT.id).changes).toEqual({ theme: 'Disco 2' });
  });

  test('unsavedEventIds lists the events whose draft differs from what is saved', () => {
    const { store } = setup();
    store.setField(EVENT.id, 'theme', 'Disco 2');
    store.setField(OTHER.id, 'theme', 'Jungle');
    expect(store.unsavedEventIds([EVENT, OTHER])).toEqual([EVENT.id]);
  });

  test('discard empties the draft and sessionStorage', () => {
    const { store, storage } = setup({ stored: { [EVENT.id]: { theme: 'Disco 2' } } });
    store.discard(EVENT.id);
    expect(store.getSnapshot(EVENT.id)).toMatchObject({ changes: {}, restored: false });
    expect(storage.has(EVENT.id)).toBe(false);
  });

  test('save sends the draft, then empties it', async () => {
    const { store, save } = setup();
    store.setField(EVENT.id, 'theme', 'Disco 2');
    const saving = store.save(EVENT);
    expect(store.getSnapshot(EVENT.id).saving).toBe(true);
    await saving;
    expect(save).toHaveBeenCalledWith(EVENT, { theme: 'Disco 2' });
    expect(store.getSnapshot(EVENT.id)).toMatchObject({ changes: {}, saving: false });
  });

  test('a refused save throws and keeps the draft', async () => {
    const { store } = setup({ save: jest.fn(async () => { throw new Error('Refusé'); }) });
    store.setField(EVENT.id, 'theme', 'Disco 2');
    await expect(store.save(EVENT)).rejects.toThrow('Refusé');
    expect(store.getSnapshot(EVENT.id)).toMatchObject({ changes: { theme: 'Disco 2' }, saving: false });
  });
});
