import { useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import { splitEvents } from './activeEvent';
import { draftUpdate } from './eventDraft';
import { invalidateEventPlaces } from './eventPlaces';
import { EVENT_WITH_VENUE } from './venue';

// Events (#195): the event list and the active-event rule, in one store the app shell (the member
// pages) and the admin both read, so they can't disagree (#192). The admin's event writes live
// here too; each one reloads the list, so every screen shows the change without a reload.
//
// The list loads when the first screen subscribes, and again on refreshEvents(). A failed load is
// not "no events": the error is kept, the list stays empty, and nothing claims to be active.
// Actions throw an appError whose message is already French (ADR 0021), as the party module does.

type Client = SupabaseClient<Database>;
type EventRow = Database['public']['Tables']['events']['Row'];
export type AppEvent = EventRow & { venue: { id: string; name: string; address: string | null } | null };

export interface EventsSnapshot {
  events: AppEvent[];
  activeEvent: AppEvent | null;
  otherEvents: AppEvent[];
  /** True until the first load has answered (or failed). */
  loading: boolean;
  error: string | null;
}

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

const snapshotOf = (events: AppEvent[], loading: boolean, error: string | null): EventsSnapshot =>
  ({ events, ...splitEvents(events), loading, error }) as EventsSnapshot;

export const createEventsStore = (client: Client) => {
  let snapshot = snapshotOf([], true, null);
  let loaded = false;
  let request = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());

  /** Reloads the list; resolves with the new snapshot (a failure is in its `error`). */
  const refresh = async (): Promise<EventsSnapshot> => {
    const current = ++request;
    const { data, error } = await client.from('events').select(EVENT_WITH_VENUE).order('created_at', { ascending: false });
    if (current !== request) return snapshot;
    loaded = true;
    snapshot = error
      ? snapshotOf([], false, failure('Error loading events', error, fr.loadErrorHint).message)
      : snapshotOf((data ?? []) as unknown as AppEvent[], false, null);
    emit();
    return snapshot;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!loaded && listeners.size === 1 && request === 0) refresh();
    return () => { listeners.delete(listener); };
  };

  const update = async (eventId: string, values: Database['public']['Tables']['events']['Update'], context: string, fallback: string) => {
    const { error } = await client.from('events').update(values).eq('id', eventId);
    if (error) throw failure(context, error, fallback);
  };

  /**
   * Makes an event the active one. Only one can be: the database refuses a second, and so does
   * this, before asking, when the list already has another.
   */
  const activateEvent = async (event: AppEvent): Promise<void> => {
    const alreadyActive = snapshot.events.find(other => other.is_active);
    if (alreadyActive && alreadyActive.id !== event.id) throw appError(fr.eventAlreadyActiveError);
    const { error } = await client.from('events').update({ is_active: true, status: 'ACTIVE' }).eq('id', event.id);
    if (error && (error as { code?: string }).code === '23505') throw appError(fr.eventAlreadyActiveError);
    if (error) throw failure('Error activating event', error, fr.eventActivationError);
    await refresh();
  };

  /** Archives an event; the database moves it onto a frozen copy of its venue (ADR 0020). */
  const archiveEvent = async (event: AppEvent): Promise<void> => {
    await update(event.id, { is_active: false, status: 'ARCHIVED' }, 'Error archiving event', fr.eventArchivingError);
    // Same layout, other places: anything showing this event's places reloads them.
    invalidateEventPlaces(event.id);
    await refresh();
  };

  /** Saves the event editor's changes (only the fields that differ from the event). */
  const saveEventChanges = async (event: AppEvent, changes: Record<string, unknown>): Promise<void> => {
    await update(event.id, draftUpdate(event, changes), 'Error updating event', fr.updateError);
    await refresh();
  };

  /**
   * New base price and main-event ratio. Existing registrations keep the price they locked (#117);
   * only those made while the event had no price get it.
   */
  const applyPricing = async (eventId: string, pricing: Database['public']['Tables']['events']['Update']): Promise<void> => {
    await update(eventId, pricing, 'Error applying pricing', fr.updateError);
    await refresh();
  };

  return { subscribe, getSnapshot: () => snapshot, refresh, activateEvent, archiveEvent, saveEventChanges, applyPricing };
};

export type EventsStore = ReturnType<typeof createEventsStore>;

const store = createEventsStore(supabase);

export const refreshEvents = store.refresh;
export const activateEvent = store.activateEvent;
export const archiveEvent = store.archiveEvent;
export const saveEventChanges = store.saveEventChanges;
export const applyPricing = store.applyPricing;

/** The events, the active one and the others, for any screen. */
export const useEvents = (): EventsSnapshot => useSyncExternalStore(store.subscribe, store.getSnapshot);
