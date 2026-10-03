import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { EditionRole } from './editionRoles';

// « Équipe » (#217, ADR 0023): who has a role on an edition, the people an admin can give one to,
// granting, changing and removing roles, and their log. Admins only, as the database enforces
// (RLS on edition_roles and edition_role_log, set_edition_role()). Same error contract as the
// other modules: the raw error is logged once, and what is thrown is already French (ADR 0021).

type Client = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/** Who someone is, as « Équipe » shows them. */
export type TeamPerson = Pick<ProfileRow, 'id' | 'full_name' | 'email'>;

export interface TeamMember {
  role: EditionRole;
  person: TeamPerson;
}

/** A person found to give a role to. An admin can't get one (they have every role already). */
export type TeamCandidate = TeamPerson & { isAdmin: boolean };

export interface TeamLogEntry {
  id: number;
  changedAt: string;
  oldRole: EditionRole | null;
  newRole: EditionRole | null;
  person: TeamPerson | null;
  actor: TeamPerson | null;
}

// The root admin (handle_new_user()) is an admin whatever its flag says.
const ROOT_ADMIN_EMAIL = 'yulmixalabedaine@gmail.com';

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

/** How a person is named: full name, else email. */
export const personLabel = (person: Partial<TeamPerson> | null | undefined): string =>
  person?.full_name?.trim() || person?.email || fr.historyUnknownPerson;

const byName = (a: TeamPerson, b: TeamPerson) => personLabel(a).localeCompare(personLabel(b), 'fr');

/** An edition's team: everyone with a role on it, by name. */
export const listEditionTeam = async (client: Client, eventId: string): Promise<TeamMember[]> => {
  const { data, error } = await client.from('edition_roles')
    .select('role, person:profiles(id, full_name, email)')
    .eq('event_id', eventId);
  if (error) throw failure('Error fetching edition team', error, fr.loadErrorHint);
  return ((data ?? []) as unknown as TeamMember[])
    .filter(member => member.person)
    .sort((a, b) => byName(a.person, b.person));
};

/** The edition's role changes, newest first (the last 200). */
export const listEditionRoleLog = async (client: Client, eventId: string): Promise<TeamLogEntry[]> => {
  const { data, error } = await client.from('edition_role_log')
    .select('id, changed_at, old_role, new_role, person:profiles!edition_role_log_user_id_fkey(id, full_name, email), actor:profiles!edition_role_log_actor_id_fkey(id, full_name, email)')
    .eq('event_id', eventId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw failure('Error fetching edition role log', error, fr.loadErrorHint);
  type Row = { id: number; changed_at: string; old_role: EditionRole | null; new_role: EditionRole | null; person: TeamPerson | null; actor: TeamPerson | null };
  return ((data ?? []) as unknown as Row[]).map(row => ({
    id: row.id, changedAt: row.changed_at, oldRole: row.old_role, newRole: row.new_role, person: row.person, actor: row.actor
  }));
};

// PostgREST's or= filter reads , ( ) " \ as syntax, and * % as wildcards: they become spaces. The
// value is quoted, for the spaces (and an email's dots).
const searchTerm = (query: string): string => query.replace(/[,()*%\\:"']/g, ' ').trim().replace(/\s+/g, ' ');

/**
 * Accounts whose name or email contains `query` (registered for the edition or not), deleted
 * ones left out, by name; at most `limit`. Nothing for an empty query.
 */
export const searchPeople = async (client: Client, query: string, limit = 8): Promise<TeamCandidate[]> => {
  const term = searchTerm(query);
  if (!term) return [];
  const { data, error } = await client.from('profiles')
    .select('id, full_name, email, is_admin')
    .or(`full_name.ilike."*${term}*",email.ilike."*${term}*"`)
    .is('deleted_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw failure('Error searching people', error, fr.loadErrorHint);
  return (data ?? []).map(({ is_admin: isAdmin, ...person }) => ({
    ...person,
    isAdmin: !!isAdmin || person.email === ROOT_ADMIN_EMAIL
  }));
};

/** Gives someone a role on an edition, changes it, or removes it (null). Logged by the database. */
export const setEditionRole = async (
  client: Client,
  { eventId, userId, role }: { eventId: string; userId: string; role: EditionRole | null }
): Promise<void> => {
  const { error } = await client.rpc('set_edition_role', { p_event_id: eventId, p_user_id: userId, p_role: role as string });
  if (error) throw failure('Error setting edition role', error, fr.updateError);
};
