import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import { VOIR_COMME_PATH, functionHeaders, functionUrl } from './supabase';
import { accountLevel } from './registrationOptions';
import type { AccountLevel } from './registrationOptions';

// « Voir comme » (#267, ADR 0025) in the browser: opening the tab, starting and ending the
// session through the `impersonate` Edge Function (#266), and the log « Équipe » shows. The
// database and the function are the authority (admins only, non-admin targets, 30 minutes,
// read-only); nothing here enforces anything, it only asks and says what came back.

type Client = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT_ADMIN_EMAIL = 'yulmixalabedaine@gmail.com';
const SESSION_KEY = 'bedaine-voir-comme-session';

/** What the tab keeps about its session (sessionStorage): never a token, the client holds those. */
export interface VoirCommeSession {
  sessionId: string;
  /** When the session ends for good (the log row's expires_at): the banner counts down to it. */
  endsAt: string;
  targetId: string;
  targetName: string | null;
  /** The tab was left (closed, reloaded): the session was ended on the way out. */
  left?: boolean;
}

/** The `impersonate` start response (supabase/functions/impersonate/handler.ts). */
export interface StartedSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  session_id: string;
  ends_at: string;
  target: { id: string; full_name: string | null };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** How long an admin's access token must still be valid to start with it (seconds). */
const ADMIN_TOKEN_MARGIN_S = 60;

export type AdminToken = { status: 'ok'; accessToken: string } | { status: 'expired' } | { status: 'none' };

/**
 * The admin's access token from their stored session (supabase-js's JSON, read without a client):
 * 'expired' when it ends within a minute, since refreshing it here would rotate the admin's refresh
 * token behind their tabs' back; the admin's own tab renews it when it comes back to the front.
 */
export const adminTokenFrom = (stored: string | null, nowMs: number = Date.now()): AdminToken => {
  let session: { access_token?: unknown; expires_at?: unknown } | null = null;
  try {
    session = stored ? JSON.parse(stored) : null;
  } catch {
    session = null;
  }
  if (!session || typeof session.access_token !== 'string' || !session.access_token) return { status: 'none' };
  if (typeof session.expires_at !== 'number' || session.expires_at - ADMIN_TOKEN_MARGIN_S <= nowMs / 1000) return { status: 'expired' };
  return { status: 'ok', accessToken: session.access_token };
};

/** The tab's route for a target: its id only, never a token. */
export const voirCommeUrl = (targetId: string): string => `${VOIR_COMME_PATH}/${encodeURIComponent(targetId)}`;

/** The target id in a « Voir comme » URL, or null when it isn't one. */
export const targetIdFromPath = (pathname: string): string | null => {
  const match = new RegExp(`^${VOIR_COMME_PATH}/([^/]+)/?$`).exec(pathname);
  const id = match ? decodeURIComponent(match[1]) : null;
  return id && UUID.test(id) ? id : null;
};

/** Opens the « Voir comme » tab on a target. Called from a click, so no pop-up blocker objects. */
export const openVoirComme = (targetId: string): void => {
  window.open(voirCommeUrl(targetId), '_blank', 'noopener');
};

/**
 * Whether « Voir comme » is offered on an account: not an admin (the root admin included), not a
 * deleted account, not oneself. The function and the database refuse those anyway.
 */
export const canViewAs = (
  profile: { id?: string | null; is_admin?: boolean | null; email?: string | null; deleted_at?: string | null } | null | undefined,
  currentUserId?: string | null
): boolean => !!profile?.id
  && !profile.is_admin
  && profile.email !== ROOT_ADMIN_EMAIL
  && !profile.deleted_at
  && profile.id !== currentUserId;

const callFunction = async (fetchImpl: FetchLike, accessToken: string, body: Record<string, unknown>, init: RequestInit = {}) => {
  let response: Response;
  try {
    response = await fetchImpl(functionUrl('impersonate'), {
      method: 'POST',
      headers: functionHeaders(accessToken),
      body: JSON.stringify(body),
      ...init
    });
  } catch (error) {
    console.error('impersonate: network error', error);
    throw appError(fr.voirCommeNetworkError);
  }
  const payload = await response.json().catch(() => null) as (Record<string, unknown> | null);
  if (!response.ok) {
    // The function answers { error: '<code>' }; the platform's own refusals (an expired JWT) have
    // no code we know and get the generic message.
    const code = typeof payload?.error === 'string' ? payload.error : typeof payload?.code === 'string' ? payload.code : undefined;
    console.error('impersonate:', response.status, code);
    throw appError(dbErrorMessage({ message: code } as ErrorLike, fr.dbErrorImpersonationFailed));
  }
  return payload ?? {};
};

/** Starts a session on `targetId` with the admin's own access token. Throws a French appError. */
export const startVoirComme = async (adminToken: string, targetId: string, fetchImpl: FetchLike = fetch): Promise<StartedSession> => {
  const payload = await callFunction(fetchImpl, adminToken, { action: 'start', target_id: targetId });
  if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string'
    || typeof payload.session_id !== 'string' || typeof payload.ends_at !== 'string') {
    throw appError(fr.dbErrorImpersonationFailed);
  }
  return payload as unknown as StartedSession;
};

/**
 * Ends the session with its own access token (« Quitter »): the function sets ended_at and signs
 * that session out, only it. `keepalive` lets the request outlive the tab (closing it).
 */
export const endVoirComme = async (
  accessToken: string,
  sessionId: string,
  { keepalive = false, fetchImpl = fetch }: { keepalive?: boolean; fetchImpl?: FetchLike } = {}
): Promise<void> => {
  await callFunction(fetchImpl, accessToken, { action: 'end', session_id: sessionId }, keepalive ? { keepalive: true } : {});
};

// The tab's session, in sessionStorage: this tab only, gone when it closes.
export const readVoirCommeSession = (): VoirCommeSession | null => {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    return stored && typeof stored.sessionId === 'string' && typeof stored.endsAt === 'string' ? stored : null;
  } catch {
    return null;
  }
};

export const writeVoirCommeSession = (session: VoirCommeSession | null): void => {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable: the tab still works until it is reloaded.
  }
};

/** Milliseconds left before `endsAt` (0 once past). */
export const msLeft = (endsAt: string, now: number = Date.now()): number => Math.max(0, Date.parse(endsAt) - now);

/** The banner's time left: « 29 min », « moins d'une minute ». */
export const timeLeftLabel = (endsAt: string, now: number = Date.now()): string => {
  const minutes = Math.ceil(msLeft(endsAt, now) / 60000);
  return minutes <= 1 ? fr.voirCommeLessThanAMinute : fr.voirCommeMinutesLeft.replace('{minutes}', String(minutes));
};

// ---------------------------------------------------------------------------------------------
// The log, in « Équipe » (admins read impersonation_log; nobody writes it from the app).

export interface LogPerson {
  id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * How a session ended: still open, left with « Quitter » (or the tab closed), expired after its 30
 * minutes, or never opened (the start failed and the row was ended at once).
 */
export type VoirCommeLogState = 'active' | 'ended' | 'expired' | 'unopened';

export interface VoirCommeLogEntry {
  id: number;
  admin: LogPerson | null;
  target: LogPerson | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  state: VoirCommeLogState;
}

export const logState = (
  row: { session_id: string | null; ended_at: string | null; expires_at: string },
  now: number = Date.now()
): VoirCommeLogState => {
  if (!row.session_id) return 'unopened';
  if (row.ended_at && Date.parse(row.ended_at) < Date.parse(row.expires_at)) return 'ended';
  return Date.parse(row.expires_at) <= now ? 'expired' : 'active';
};

/** The « Voir comme » sessions, newest first (the last 200). Throws a French appError. */
export const listVoirCommeLog = async (client: Client, now: number = Date.now()): Promise<VoirCommeLogEntry[]> => {
  const { data, error } = await client.from('impersonation_log')
    .select('id, started_at, expires_at, ended_at, session_id, admin:profiles!impersonation_log_admin_id_fkey(id, full_name, email), target:profiles!impersonation_log_target_id_fkey(id, full_name, email)')
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) {
    console.error('Error fetching the Voir comme log:', error.message, error.code, error.details, error);
    throw Object.assign(appError(dbErrorMessage(error, fr.loadErrorHint)), { cause: error });
  }
  type Row = { id: number; started_at: string; expires_at: string; ended_at: string | null; session_id: string | null; admin: LogPerson | null; target: LogPerson | null };
  return ((data ?? []) as unknown as Row[]).map(row => ({
    id: row.id,
    admin: row.admin,
    target: row.target,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    state: logState(row, now)
  }));
};

// ---------------------------------------------------------------------------------------------
// The header's « Voir comme… » picker (#269's AccountPicker): every live account, with its level
// on the active edition. Admins can read every profile; admin rows are listed, not choosable.

export interface ViewableAccount {
  id: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  level: AccountLevel;
}

export const listViewableAccounts = async (client: Client): Promise<ViewableAccount[]> => {
  const [profilesRes, eventRes] = await Promise.all([
    client.from('profiles').select('id, email, full_name, is_admin').is('deleted_at', null).order('full_name'),
    client.from('events').select('id').eq('is_active', true).maybeSingle()
  ]);
  const failed = profilesRes.error || eventRes.error;
  if (failed) {
    console.error('Error loading accounts for Voir comme:', failed.message, failed);
    throw appError(dbErrorMessage(failed, fr.accountsLoadError));
  }
  const eventId = eventRes.data?.id;
  let roleOf = new Map<string, string>();
  if (eventId) {
    const { data, error } = await client.from('edition_roles').select('user_id, role').eq('event_id', eventId);
    if (error) {
      console.error('Error loading edition roles for Voir comme:', error.message, error);
      throw appError(dbErrorMessage(error, fr.accountsLoadError));
    }
    roleOf = new Map((data ?? []).map(row => [row.user_id, row.role]));
  }
  return (profilesRes.data ?? []).map(profile => {
    const isAdmin = !!profile.is_admin || profile.email === ROOT_ADMIN_EMAIL;
    return {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      is_admin: isAdmin,
      level: accountLevel({ is_admin: isAdmin }, roleOf.get(profile.id))
    };
  });
};
