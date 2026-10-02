import { useCallback, useSyncExternalStore } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { listEventParties, setPaymentStatus } from './parties';
import type { AdminParty } from './parties';
import { isActiveRegistration } from './registrationOptions';
import type { PaymentStatus } from './registrationOptions';

// Admin parties (#195): an event's parties as the admin lists them (the party module's
// listEventParties, #197), in one cache per event that every admin section shares: Résumé,
// Inscrits, Logistique, Budget and the exports read the same entry.
//
// An entry loads when a screen subscribes to it while nobody was, when someone changes a party
// of the event (the realtime channel on user_parties, open only while someone watches), and on
// refresh(); never because a section changed. Reloading parties doesn't touch the event places:
// Aperçu and Logistique take who sleeps where from the parties (it broke a Logistique save, #193).
//
// A failed load keeps the French message (ADR 0021) in `error`, and what was shown before.
// Actions throw the party module's error, whose message is already French.

type Client = SupabaseClient<Database>;

export interface AdminPartiesSnapshot {
  /** All the event's parties, cancelled ones included (Inscrits' « Annulées », god-mode editing). */
  parties: AdminParty[];
  /** The ones that count: cancelled parties owe nothing and count for nothing (#101). */
  activeParties: AdminParty[];
  /** Nothing to show yet: a reload keeps showing what was there. */
  loading: boolean;
  error: string | null;
}

interface Entry {
  rows: AdminParty[] | null;
  error: string | null;
  listeners: Set<() => void>;
  channel: RealtimeChannel | null;
  snapshot: AdminPartiesSnapshot | null;
  request: number;
}

const EMPTY: AdminPartiesSnapshot = Object.freeze({ parties: [], activeParties: [], loading: false, error: null }) as AdminPartiesSnapshot;

export const createAdminPartiesStore = (client: Client) => {
  const entries = new Map<string, Entry>();

  const entryOf = (eventId: string): Entry => {
    if (!entries.has(eventId)) {
      entries.set(eventId, { rows: null, error: null, listeners: new Set(), channel: null, snapshot: null, request: 0 });
    }
    return entries.get(eventId)!;
  };

  const build = (entry: Entry): void => {
    const parties = entry.rows || [];
    entry.snapshot = {
      parties,
      activeParties: parties.filter(isActiveRegistration),
      loading: entry.rows === null && entry.error === null,
      error: entry.error
    };
  };

  const load = async (eventId: string): Promise<void> => {
    const entry = entryOf(eventId);
    const request = ++entry.request;
    let rows: AdminParty[] | null = null;
    let error: string | null = null;
    try {
      rows = await listEventParties(client, eventId);
    } catch (err) {
      error = (err as Error).message;
    }
    // A newer load started meanwhile: its answer is the one to keep.
    if (request !== entry.request) return;
    entry.error = error;
    if (rows) entry.rows = rows;
    build(entry);
    entry.listeners.forEach(listener => listener());
  };

  const subscribe = (eventId: string, listener: () => void): (() => void) => {
    const entry = entryOf(eventId);
    if (entry.listeners.size === 0) {
      load(eventId);
      entry.channel = client.channel(`admin_parties_${eventId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_parties', filter: `event_id=eq.${eventId}` }, () => { load(eventId); })
        .subscribe();
    }
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && entry.channel) {
        client.removeChannel(entry.channel);
        entry.channel = null;
      }
    };
  };

  /** The same object until something changes. */
  const getSnapshot = (eventId: string | null | undefined): AdminPartiesSnapshot => {
    if (!eventId) return EMPTY;
    const entry = entryOf(eventId);
    if (!entry.snapshot) build(entry);
    return entry.snapshot!;
  };

  /**
   * The event's parties changed here (a save, a price, an admin flag): reloads them if a screen
   * shows them; the next one to show them reloads anyway.
   */
  const refresh = async (eventId: string | null | undefined): Promise<void> => {
    if (eventId && entries.get(eventId)?.listeners.size) await load(eventId);
  };

  /** Sets a party's payment status, then reloads its event's parties. */
  const updatePaymentStatus = async (party: Pick<AdminParty, 'id' | 'event_id'>, status: PaymentStatus): Promise<void> => {
    await setPaymentStatus(client, party.id, status);
    await refresh(party.event_id);
  };

  return { subscribe, getSnapshot, refresh, updatePaymentStatus };
};

export type AdminPartiesStore = ReturnType<typeof createAdminPartiesStore>;

const store = createAdminPartiesStore(supabase);

export const refreshAdminParties = store.refresh;
export const updatePaymentStatus = store.updatePaymentStatus;

/** An event's parties for the admin, from the shared cache. Without an event: nothing, not loading. */
export const useAdminParties = (eventId: string | null | undefined, adminPartiesStore: AdminPartiesStore = store): AdminPartiesSnapshot => {
  const subscribe = useCallback(
    (listener: () => void) => (eventId ? adminPartiesStore.subscribe(eventId, listener) : () => {}),
    [eventId, adminPartiesStore]
  );
  return useSyncExternalStore(subscribe, () => adminPartiesStore.getSnapshot(eventId));
};
