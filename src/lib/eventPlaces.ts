import { useCallback, useSyncExternalStore } from 'react';
import fr from '../locales/fr.json';
import { supabase } from './supabase';
import { dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Event places (#193): every place of an event's venue as the event sees it — its capacity for
// the event, whether it is excluded, who of the event sleeps there — read from event_places()
// (the database merges and orders them) and kept in one cache per event that every screen shares.
// Aperçu, Logistique and the event editor's Couchage section read the same entry, so an exclusion
// or a capacity set in Couchage shows everywhere at once, without a refetch.
//
// Writes from here (editPlace, then savePlace) patch the cache. Anything else that changes an
// event's places (save_logistics, a party change, archiving, a venue change, the Sites editor)
// calls invalidateEventPlaces(). An entry is refetched when a screen subscribes to it while
// nobody was, or when it is invalidated while someone is; never because a tab changed.

type EventPlaceRow = Database['public']['Functions']['event_places']['Returns'][number];

export interface EventPlace {
  id: string;
  label: string;
  type: string;
  locationId: string;
  locationName: string;
  venueCapacity: number;
  capacity: number;
  isExcluded: boolean;
  occupants: string[];
  position: number;
}

export interface EventPlacesSnapshot {
  places: EventPlace[];
  available: EventPlace[];
  loading: boolean;
  error: string | null;
}

/** A place's setting shown before the database confirms it. */
export type PlaceEdit = Partial<Pick<EventPlace, 'isExcluded' | 'capacity'>>;

interface Entry {
  rows: EventPlace[] | null;
  edits: Map<string, PlaceEdit>;
  versions: Map<string, number>;
  error: string | null;
  listeners: Set<() => void>;
  snapshot: EventPlacesSnapshot | null;
  request: number;
}

const placeOf = (row: EventPlaceRow): EventPlace => ({
  id: row.place_id,
  label: row.label,
  type: row.type,
  locationId: row.location_id,
  locationName: row.location_name,
  venueCapacity: row.venue_capacity,
  capacity: row.capacity,
  isExcluded: row.is_excluded,
  occupants: row.occupants || [],
  position: row.position
});

const EMPTY: EventPlacesSnapshot = Object.freeze({ places: [], available: [], loading: false, error: null });

/**
 * The cache, on a Supabase client (the app's, or a test's stand-in). Plain JS so it is tested
 * without React; useEventPlaces() is the way screens use it.
 */
export const createEventPlacesStore = (client: SupabaseClient<Database>) => {
  // eventId → { rows, edits, versions, error, listeners, snapshot, request }
  // `edits` are the settings shown but not yet confirmed by the database, by place: they lie over
  // whatever is loaded, so a reload doesn't undo what the admin just did. `versions` count each
  // place's edits, so a write's answer only lands if no newer edit came after it.
  const entries = new Map<string, Entry>();

  const entryOf = (eventId: string): Entry => {
    if (!entries.has(eventId)) {
      entries.set(eventId, {
        rows: null, edits: new Map(), versions: new Map(), error: null,
        listeners: new Set(), snapshot: null, request: 0
      });
    }
    return entries.get(eventId)!;
  };

  // A new snapshot object only when something changed, so screens re-render only then. `loading`
  // is "nothing to show yet": a reload keeps showing what was there.
  const build = (entry: Entry): void => {
    const places = (entry.rows || []).map(place => {
      const edit = entry.edits.get(place.id);
      return edit ? { ...place, ...edit } : place;
    });
    entry.snapshot = {
      places,
      available: places.filter(place => !place.isExcluded),
      loading: entry.rows === null && entry.error === null,
      error: entry.error
    };
  };

  const publish = (entry: Entry): void => {
    build(entry);
    entry.listeners.forEach(listener => listener());
  };

  const load = async (eventId: string): Promise<void> => {
    const entry = entryOf(eventId);
    const request = ++entry.request;
    const { data, error } = await client.rpc('event_places', { p_event_id: eventId });
    // A newer load started meanwhile: its answer is the one to keep.
    if (request !== entry.request) return;
    if (error) {
      console.error('Error loading event places:', error);
      entry.error = dbErrorMessage(error, fr.eventPlacesLoadError);
    } else {
      entry.error = null;
      entry.rows = (data ?? []).map(placeOf);
    }
    publish(entry);
  };

  const subscribe = (eventId: string, listener: () => void): (() => void) => {
    const entry = entryOf(eventId);
    if (entry.listeners.size === 0) load(eventId);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  };

  /** The same object until something changes. */
  const getSnapshot = (eventId: string | null | undefined): EventPlacesSnapshot => {
    if (!eventId) return EMPTY;
    const entry = entryOf(eventId);
    if (!entry.snapshot) build(entry);
    return entry.snapshot!;
  };

  /**
   * Shows a place's new setting at once, everywhere; savePlace() writes it. `change` is
   * `{ isExcluded }` and/or `{ capacity }`.
   */
  const editPlace = (eventId: string, placeId: string, change: PlaceEdit): void => {
    const entry = entryOf(eventId);
    entry.edits.set(placeId, { ...entry.edits.get(placeId), ...change });
    entry.versions.set(placeId, (entry.versions.get(placeId) || 0) + 1);
    publish(entry);
  };

  /**
   * Writes the place's setting as shown now (set_place_override takes the whole state, so the
   * latest edit wins whatever was sent before). On success the database's row replaces the edit,
   * unless a newer edit came meanwhile; on failure the event's places reload, dropping the edits.
   * Returns the database error, for the caller to word.
   */
  const savePlace = async (eventId: string, placeId: string): Promise<{ error: ErrorLike | null }> => {
    const entry = entryOf(eventId);
    const place = getSnapshot(eventId).places.find(candidate => candidate.id === placeId);
    if (!place) return { error: null };
    const version = entry.versions.get(placeId);
    const { data, error } = await client.rpc('set_place_override', {
      p_event_id: eventId,
      p_place_id: placeId,
      p_is_excluded: place.isExcluded,
      p_capacity: place.capacity
    });
    if (error) {
      entry.edits.clear();
      await load(eventId);
      return { error };
    }
    if (entry.versions.get(placeId) === version) {
      entry.edits.delete(placeId);
      const [row] = data;
      if (row && entry.rows) entry.rows = entry.rows.map(candidate => (candidate.id === placeId ? placeOf(row) : candidate));
      publish(entry);
    }
    return { error: null };
  };

  /**
   * The event's places changed elsewhere: dropped edits, and a reload if a screen shows them (the
   * next one to show them reloads anyway). Without an event, every event's.
   */
  const invalidate = (eventId?: string | null): void => {
    const ids = eventId ? [eventId] : [...entries.keys()];
    ids.filter(id => entries.has(id)).forEach(id => {
      const entry = entries.get(id)!;
      entry.edits.clear();
      if (entry.listeners.size) load(id);
    });
  };

  return { subscribe, getSnapshot, editPlace, savePlace, invalidate };
};

export type EventPlacesStore = ReturnType<typeof createEventPlacesStore>;

const store = createEventPlacesStore(supabase);

/** See createEventPlacesStore's invalidate. */
export const invalidateEventPlaces = (eventId?: string | null): void => store.invalidate(eventId);

/**
 * An event's places, from the shared cache (#193). `places` are all of them in display order,
 * excluded ones included (Couchage); `available` are the ones the event uses, at its capacities
 * (Aperçu, Logistique). Without an event: nothing, not loading.
 */
export const useEventPlaces = (eventId: string | null | undefined, eventPlacesStore: EventPlacesStore = store) => {
  const subscribe = useCallback(
    (listener: () => void) => (eventId ? eventPlacesStore.subscribe(eventId, listener) : () => {}),
    [eventId, eventPlacesStore]
  );
  const snapshot = useSyncExternalStore(subscribe, () => eventPlacesStore.getSnapshot(eventId));
  const editPlace = useCallback((placeId: string, change: PlaceEdit) => eventPlacesStore.editPlace(eventId!, placeId, change), [eventId, eventPlacesStore]);
  const savePlace = useCallback((placeId: string) => eventPlacesStore.savePlace(eventId!, placeId), [eventId, eventPlacesStore]);
  return { ...snapshot, editPlace, savePlace };
};
