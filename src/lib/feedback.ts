import { useCallback, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';

// Retours (#195): the members' feedback (app_feedback), newest first, with who sent it, and how
// many are unresolved (for the section's badge, #208/#209). Loaded when the first screen
// subscribes; resolving one writes, then reloads. Same error contract as the other stores: a
// failed load keeps the French message in `error`, an action throws an appError (ADR 0021).

type Client = SupabaseClient<Database>;
type FeedbackRow = Database['public']['Tables']['app_feedback']['Row'];
export type FeedbackItem = FeedbackRow & { profiles: { email: string | null; full_name: string | null } | null };

export interface FeedbackSnapshot {
  items: FeedbackItem[];
  unresolvedCount: number;
  loading: boolean;
  error: string | null;
}

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

const snapshotOf = (items: FeedbackItem[], loading: boolean, error: string | null): FeedbackSnapshot =>
  ({ items, unresolvedCount: items.filter(item => !item.is_resolved).length, loading, error });

export const createFeedbackStore = (client: Client) => {
  let snapshot = snapshotOf([], true, null);
  let loaded = false;
  let request = 0;
  const listeners = new Set<() => void>();

  const refresh = async (): Promise<void> => {
    const current = ++request;
    const { data, error } = await client.from('app_feedback').select('*, profiles(email, full_name)').order('created_at', { ascending: false });
    if (current !== request) return;
    loaded = true;
    snapshot = error
      ? snapshotOf(snapshot.items, false, failure('Error loading feedback', error, fr.loadErrorHint).message)
      : snapshotOf((data ?? []) as unknown as FeedbackItem[], false, null);
    listeners.forEach(listener => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (!loaded && request === 0) refresh();
    return () => { listeners.delete(listener); };
  };

  const resolve = async (id: string): Promise<void> => {
    const { error } = await client.from('app_feedback').update({ is_resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw failure('Error resolving feedback', error, fr.error);
    await refresh();
  };

  return { subscribe, getSnapshot: () => snapshot, refresh, resolve };
};

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;

const store = createFeedbackStore(supabase);

export const refreshFeedback = store.refresh;
export const resolveFeedback = store.resolve;

const NOTHING: FeedbackSnapshot = Object.freeze(snapshotOf([], false, null)) as FeedbackSnapshot;
const noSubscription = () => () => {};

/**
 * The feedback items and the unresolved count. With `enabled` false (someone who isn't an admin,
 * #217), nothing loads: no items, not loading.
 */
export const useFeedback = (enabled = true): FeedbackSnapshot => {
  const getSnapshot = useCallback(() => (enabled ? store.getSnapshot() : NOTHING), [enabled]);
  return useSyncExternalStore(enabled ? store.subscribe : noSubscription, getSnapshot);
};
