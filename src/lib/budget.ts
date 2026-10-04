import { useCallback, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';

// Budget (#195): an event's admin-only budget (its event_budgets row, null until first saved) and
// the Budget section's unsaved edits, one entry per event. Résumé and Budget read the same entry.
// The draft lives here, not in a screen, so it survives switching sections; it isn't kept across
// a reload. An entry loads when a screen subscribes to it while nobody was.
//
// A failed load keeps the French message (ADR 0021) in `error`. save() throws an appError whose
// message is already French and keeps the draft.

type Client = SupabaseClient<Database>;
export type BudgetRow = Database['public']['Tables']['event_budgets']['Row'];

export interface BudgetLine {
  category: string;
  description?: string | null;
  amount: number | string;
  /** Who paid it (#236): an attendee id; absent or null = nobody. */
  paid_by_attendee_id?: string | null;
}

/** The Budget editor's unsaved lines and contingency (as typed). */
export interface BudgetDraft {
  lines: BudgetLine[];
  contingency: string;
}

export interface BudgetSnapshot {
  budget: BudgetRow | null;
  draft: BudgetDraft | null;
  /** Nothing to show yet. */
  loading: boolean;
  error: string | null;
  saving: boolean;
}

interface Entry {
  budget: BudgetRow | null;
  loaded: boolean;
  draft: BudgetDraft | null;
  error: string | null;
  saving: boolean;
  listeners: Set<() => void>;
  snapshot: BudgetSnapshot | null;
  request: number;
}

const EMPTY: BudgetSnapshot = Object.freeze({ budget: null, draft: null, loading: false, error: null, saving: false });

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

export const createBudgetStore = (client: Client) => {
  const entries = new Map<string, Entry>();

  const entryOf = (eventId: string): Entry => {
    if (!entries.has(eventId)) {
      entries.set(eventId, { budget: null, loaded: false, draft: null, error: null, saving: false, listeners: new Set(), snapshot: null, request: 0 });
    }
    return entries.get(eventId)!;
  };

  const publish = (entry: Entry): void => {
    entry.snapshot = null;
    entry.listeners.forEach(listener => listener());
  };

  const load = async (eventId: string): Promise<void> => {
    const entry = entryOf(eventId);
    const request = ++entry.request;
    const { data, error } = await client.from('event_budgets').select('*').eq('event_id', eventId).maybeSingle();
    if (request !== entry.request) return;
    if (error) {
      entry.error = failure('Error loading budget', error, fr.loadErrorHint).message;
    } else {
      entry.error = null;
      entry.budget = data;
      entry.loaded = true;
    }
    publish(entry);
  };

  const subscribe = (eventId: string, listener: () => void): (() => void) => {
    const entry = entryOf(eventId);
    if (entry.listeners.size === 0) load(eventId);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  };

  const getSnapshot = (eventId: string | null | undefined): BudgetSnapshot => {
    if (!eventId) return EMPTY;
    const entry = entryOf(eventId);
    if (!entry.snapshot) {
      entry.snapshot = {
        budget: entry.budget,
        draft: entry.draft,
        loading: !entry.loaded && entry.error === null,
        error: entry.error,
        saving: entry.saving
      };
    }
    return entry.snapshot;
  };

  /** The editor's unsaved edits for the event; null drops them. */
  const setDraft = (eventId: string, draft: BudgetDraft | null): void => {
    const entry = entryOf(eventId);
    entry.draft = draft;
    publish(entry);
  };

  /**
   * Saves the lines and contingency (the database checks them and computes the total), then
   * shows the saved row and drops the draft.
   */
  const save = async (eventId: string, lines: BudgetLine[], contingency: string | number): Promise<void> => {
    const entry = entryOf(eventId);
    entry.saving = true;
    publish(entry);
    try {
      const { data, error } = await client.from('event_budgets')
        .upsert({
          event_id: eventId,
          lines: lines.map(line => ({
            category: line.category,
            description: (line.description || '').trim(),
            amount: Math.max(Number(line.amount) || 0, 0),
            ...(line.paid_by_attendee_id ? { paid_by_attendee_id: line.paid_by_attendee_id } : {})
          })),
          contingency_pct: Math.min(Math.max(Number(contingency) || 0, 0), 100)
        })
        .select()
        .single();
      if (error) throw failure('Error saving budget', error, fr.saveError);
      entry.budget = data;
      entry.loaded = true;
      entry.draft = null;
    } finally {
      entry.saving = false;
      publish(entry);
    }
  };

  /** Reloads the event's budget if a screen shows it. */
  const refresh = async (eventId: string | null | undefined): Promise<void> => {
    if (eventId && entries.get(eventId)?.listeners.size) await load(eventId);
  };

  return { subscribe, getSnapshot, setDraft, save, refresh };
};

export type BudgetStore = ReturnType<typeof createBudgetStore>;

const store = createBudgetStore(supabase);

/**
 * The payers' names by attendee id, removed attendees included (the admin-only attendee_by_id
 * resolves them, RLS hides them from plain reads). Ids it can't resolve are left out.
 */
export const fetchPayers = async (client: Client, ids: string[]): Promise<Map<string, { name: string; removed: boolean }>> => {
  const payers = new Map<string, { name: string; removed: boolean }>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    const { data, error } = await client.rpc('attendee_by_id', { p_attendee_id: id });
    if (error) {
      console.error('Error resolving a payer:', error);
      return;
    }
    const attendee = data?.[0];
    if (attendee) payers.set(id, { name: attendee.name, removed: attendee.deleted_at !== null });
  }));
  return payers;
};

export const setBudgetDraft = store.setDraft;
export const saveBudget = store.save;
export const refreshBudget = store.refresh;
export const resolvePayers = (ids: string[]) => fetchPayers(supabase, ids);

/** An event's budget and the editor's draft, from the shared store. Without an event: nothing. */
export const useBudget = (eventId: string | null | undefined, budgetStore: BudgetStore = store): BudgetSnapshot => {
  const subscribe = useCallback(
    (listener: () => void) => (eventId ? budgetStore.subscribe(eventId, listener) : () => {}),
    [eventId, budgetStore]
  );
  return useSyncExternalStore(subscribe, () => budgetStore.getSnapshot(eventId));
};
