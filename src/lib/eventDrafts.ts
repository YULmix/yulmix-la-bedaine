import { useCallback, useSyncExternalStore } from 'react';
import { createEvent, saveEventChanges } from './events';
import { NEW_EVENT_ID } from './adminRoutes';
import type { AppEvent } from './events';
import { dirtyFields, filledFields, loadStoredDraft, storeDraft } from './eventDraft';

// The event editor's unsaved edits (#195), per event: the changes as typed, whether they were
// restored from sessionStorage (a reload, a closed tab…), and whether a save is running. Mirrored
// to sessionStorage on every edit, so they survive a reload too; held here, not in a screen, so
// they survive switching sections. The event being created (#111) has no id yet: its draft is the
// one kept under NEW_EVENT_ID, apart from every event's. The rules (what's dirty, what's valid, what's sent) are
// eventDraft.js's.

type Changes = Record<string, unknown>;

export interface EventDraftSnapshot {
  changes: Changes;
  /** The changes came from sessionStorage, not from this visit. */
  restored: boolean;
  saving: boolean;
}

interface Entry {
  changes: Changes;
  restored: boolean;
  saving: boolean;
  snapshot: EventDraftSnapshot | null;
}

interface Options {
  save: (event: AppEvent, changes: Changes) => Promise<void>;
  create: (changes: Changes) => Promise<string>;
  load: (eventId: string) => Changes | null;
  persist: (eventId: string, changes: Changes) => void;
}

const EMPTY: EventDraftSnapshot = Object.freeze({ changes: {}, restored: false, saving: false });

export const createEventDraftStore = ({ save, create, load, persist }: Options) => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();

  const entryOf = (eventId: string): Entry => {
    if (!entries.has(eventId)) {
      const stored = load(eventId);
      entries.set(eventId, { changes: stored || {}, restored: !!stored, saving: false, snapshot: null });
    }
    return entries.get(eventId)!;
  };

  const publish = (entry: Entry): void => {
    entry.snapshot = null;
    listeners.forEach(listener => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  const getSnapshot = (eventId: string | null | undefined): EventDraftSnapshot => {
    if (!eventId) return EMPTY;
    const entry = entryOf(eventId);
    if (!entry.snapshot) entry.snapshot = { changes: entry.changes, restored: entry.restored, saving: entry.saving };
    return entry.snapshot;
  };

  const setField = (eventId: string, field: string, value: unknown): void => {
    const entry = entryOf(eventId);
    entry.changes = { ...entry.changes, [field]: value };
    persist(eventId, entry.changes);
    publish(entry);
  };

  const discard = (eventId: string): void => {
    const entry = entryOf(eventId);
    entry.changes = {};
    entry.restored = false;
    persist(eventId, {});
    publish(entry);
  };

  /** Saves the event's draft (only the fields that differ), then empties it; a refusal keeps it. */
  const saveDraft = async (event: AppEvent): Promise<void> => {
    const entry = entryOf(event.id);
    entry.saving = true;
    publish(entry);
    try {
      await save(event, entry.changes);
      entry.changes = {};
      entry.restored = false;
      persist(event.id, {});
    } finally {
      entry.saving = false;
      publish(entry);
    }
  };

  /** Creates the event from its draft (kept under NEW_EVENT_ID), then empties it; a refusal keeps it. Resolves with the new id. */
  const createFromDraft = async (): Promise<string> => {
    const entry = entryOf(NEW_EVENT_ID);
    entry.saving = true;
    publish(entry);
    try {
      const id = await create(entry.changes);
      entry.changes = {};
      entry.restored = false;
      persist(NEW_EVENT_ID, {});
      return id;
    } finally {
      entry.saving = false;
      publish(entry);
    }
  };

  /**
   * The events, among `events`, whose draft differs from what is saved, and NEW_EVENT_ID while the
   * event being created has something typed (an empty new form isn't unsaved).
   */
  const unsavedEventIds = (events: AppEvent[]): string[] => {
    const ids = events
      .filter(event => entries.has(event.id) && dirtyFields(event, entries.get(event.id)!.changes).length > 0)
      .map(event => event.id);
    const added = entries.get(NEW_EVENT_ID);
    return added && filledFields(added.changes).length > 0 ? [...ids, NEW_EVENT_ID] : ids;
  };

  return { subscribe, getSnapshot, setField, discard, save: saveDraft, create: createFromDraft, unsavedEventIds };
};

export type EventDraftStore = ReturnType<typeof createEventDraftStore>;

const store = createEventDraftStore({ save: saveEventChanges, create: createEvent, load: loadStoredDraft, persist: storeDraft });

export const setEventDraftField = store.setField;
export const discardEventDraft = store.discard;
export const saveEventDraft = store.save;
export const createEventFromDraft = store.create;

/** An event's unsaved editor changes. */
export const useEventDraft = (eventId: string | null | undefined): EventDraftSnapshot =>
  useSyncExternalStore(store.subscribe, useCallback(() => store.getSnapshot(eventId), [eventId]));

/** The events, among `events`, with unsaved editor changes (the same array until they change). */
export const useUnsavedEventIds = (events: AppEvent[]): string[] => {
  const getKey = useCallback(() => store.unsavedEventIds(events).join(','), [events]);
  const key = useSyncExternalStore(store.subscribe, getKey);
  return key ? key.split(',') : [];
};
