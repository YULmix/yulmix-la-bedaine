import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';

// Members' profiles as the admin sees them (#195): who is signed in, a member's registrations
// across editions, and the admin flag. Same error contract as the party module: the raw error is
// logged once and the function throws one whose message is already French (ADR 0021).

type Client = SupabaseClient<Database>;
export type EventHistoryEntry = Database['public']['Views']['user_event_history']['Row'];

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

/** The signed-in user's id, from the auth session (no request), or null. */
export const currentUserId = async (client: Client): Promise<string | null> => {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
};

/** A member's registrations across editions (user_event_history), newest first. */
export const fetchEventHistory = async (client: Client, userId: string): Promise<EventHistoryEntry[]> => {
  const { data, error } = await client.from('user_event_history').select('*')
    .eq('user_id', userId)
    .order('registration_date', { ascending: false });
  if (error) throw failure('Error fetching user event history', error, fr.historyFetchError);
  return data ?? [];
};

/**
 * Makes a member an admin, or not. The database refuses one's own flag and the root admin's; this
 * refuses one's own before asking.
 */
export const setIsAdmin = async (client: Client, { profileId, isAdmin, currentUser }: { profileId: string; isAdmin: boolean; currentUser: string | null }): Promise<void> => {
  if (profileId === currentUser) throw appError(fr.selfAdminToggleError);
  const { error } = await client.rpc('admin_set_is_admin', { target_user_id: profileId, new_is_admin: isAdmin });
  if (error) throw failure('Error updating admin status', error, fr.updateError);
};
