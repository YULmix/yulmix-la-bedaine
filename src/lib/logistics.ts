import { useCallback, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database, Json } from './database.types';
import { supabase } from './supabase';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import { refreshAdminParties } from './adminParties';
import { countChanges, draftAfterSave, logisticsPayload, setNotesChange as withNotes, setPlaceChange as withPlace } from './logisticsDraft';

// Logistique (#150, #195): the unsaved places and notes of each event's parties (the shape is
// logisticsDraft.js's), why the last save refused a party, and whether a save is running. Held
// here, not in a screen, so the draft survives switching sections; it isn't kept across a reload.
// The admin shell asks getUnsavedTotal() for its leave warnings and its unsaved marker.
//
// save() sends the event's draft in one save_logistics() call; each party is saved entirely or
// not at all. Refused parties keep their draft and get a French message (ADR 0021); the others
// are cleared. The parties reload afterwards, the event places don't: Aperçu and Logistique take
// who sleeps where from the parties.

type Client = SupabaseClient<Database>;
type Draft = Record<string, { places?: Record<string, string | null>; adminNotes?: string }>;
type DraftParty = { id: string; admin_notes?: string | null; attendees?: Array<{ id: string; place?: { place_id: string } | null }> };

export interface LogisticsSnapshot {
  changes: Draft;
  /** { [partyId]: French message } for the parties the last save refused. */
  errors: Record<string, string>;
  unsavedCount: number;
  saving: boolean;
}

interface Entry {
  changes: Draft;
  errors: Record<string, string>;
  saving: boolean;
  snapshot: LogisticsSnapshot | null;
}

const EMPTY: LogisticsSnapshot = Object.freeze({ changes: {}, errors: {}, unsavedCount: 0, saving: false });

export const createLogisticsStore = (client: Client) => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();

  const entryOf = (eventId: string): Entry => {
    if (!entries.has(eventId)) entries.set(eventId, { changes: {}, errors: {}, saving: false, snapshot: null });
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

  const getSnapshot = (eventId: string | null | undefined): LogisticsSnapshot => {
    if (!eventId || !entries.has(eventId)) return EMPTY;
    const entry = entries.get(eventId)!;
    if (!entry.snapshot) {
      entry.snapshot = { changes: entry.changes, errors: entry.errors, unsavedCount: countChanges(entry.changes), saving: entry.saving };
    }
    return entry.snapshot;
  };

  /** Pending edits across every event: what the admin would lose by leaving. */
  const getUnsavedTotal = (): number => [...entries.values()].reduce((sum, entry) => sum + countChanges(entry.changes), 0);

  /** placeId: a place id, or null to unassign. */
  const setPlaceChange = (eventId: string, party: DraftParty, attendeeId: string, placeId: string | null): void => {
    const entry = entryOf(eventId);
    entry.changes = withPlace(entry.changes, party, attendeeId, placeId);
    publish(entry);
  };

  const setNotesChange = (eventId: string, party: DraftParty, notes: string): void => {
    const entry = entryOf(eventId);
    entry.changes = withNotes(entry.changes, party, notes);
    publish(entry);
  };

  const discard = (eventId: string): void => {
    const entry = entryOf(eventId);
    entry.changes = {};
    entry.errors = {};
    publish(entry);
  };

  /**
   * Saves the event's draft. Resolves with the parties the database refused (their draft and
   * message stay); throws an appError (French) if the call itself failed, keeping the draft.
   */
  const save = async (eventId: string): Promise<{ failedPartyIds: string[] }> => {
    const entry = entryOf(eventId);
    const sent = entry.changes;
    if (!Object.keys(sent).length) return { failedPartyIds: [] };
    entry.saving = true;
    publish(entry);
    try {
      const { data, error } = await client.rpc('save_logistics', { p_changes: logisticsPayload(sent) as Json });
      if (error) {
        const { message, code, details, hint } = error as ErrorLike & { code?: string; hint?: string };
        console.error('Error saving logistics:', message, code, details, hint, error);
        throw Object.assign(appError(dbErrorMessage(error, fr.saveError)), { cause: error });
      }
      const failures = (data ?? []) as Array<{ party_id: string; message?: string; details?: string | null }>;
      await refreshAdminParties(eventId);
      const failedPartyIds = failures.map(failure => failure.party_id);
      entry.changes = draftAfterSave(entry.changes, sent, failedPartyIds);
      entry.errors = Object.fromEntries(failures.map(failure => [failure.party_id, dbErrorMessage(failure, fr.saveError)]));
      return { failedPartyIds };
    } finally {
      entry.saving = false;
      publish(entry);
    }
  };

  return { subscribe, getSnapshot, getUnsavedTotal, setPlaceChange, setNotesChange, discard, save };
};

export type LogisticsStore = ReturnType<typeof createLogisticsStore>;

const store = createLogisticsStore(supabase);

export const setLogisticsPlace = store.setPlaceChange;
export const setLogisticsNotes = store.setNotesChange;
export const discardLogistics = store.discard;
export const saveLogistics = store.save;

/** An event's Logistique draft, from the shared store. */
export const useLogistics = (eventId: string | null | undefined, logisticsStore: LogisticsStore = store): LogisticsSnapshot =>
  useSyncExternalStore(logisticsStore.subscribe, useCallback(() => logisticsStore.getSnapshot(eventId), [eventId, logisticsStore]));

/** How many Logistique edits are unsaved, across events: for the admin shell's leave warnings. */
export const useUnsavedLogistics = (logisticsStore: LogisticsStore = store): number =>
  useSyncExternalStore(logisticsStore.subscribe, logisticsStore.getUnsavedTotal);
