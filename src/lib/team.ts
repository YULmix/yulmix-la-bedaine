import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import type { AccessRole, EditionRole } from './editionRoles';

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
  kind: 'role';
  id: number;
  changedAt: string;
  oldRole: EditionRole | null;
  newRole: EditionRole | null;
  person: TeamPerson | null;
  actor: TeamPerson | null;
}

/** A grant or removal of the admin flag (admin_role_log, #256): it counts on every edition. */
export interface AdminLogEntry {
  kind: 'admin';
  id: number;
  changedAt: string;
  granted: boolean;
  person: TeamPerson | null;
  actor: TeamPerson | null;
}

/** One line of the merged log. */
export type TeamLogItem = TeamLogEntry | AdminLogEntry;

/** What someone has: nothing (null), a role on the edition, or admin. */
export type TeamLevel = AccessRole | null;

/** Past this many accounts, the picker stops listing them all and searches on the server. */
export const PEOPLE_LIST_CAP = 200;

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

/** The root admin is an admin whatever its flag says, and can't be demoted. */
export const isRootAdmin = (person: Partial<TeamPerson> | null | undefined): boolean => person?.email === ROOT_ADMIN_EMAIL;

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
    kind: 'role' as const, id: row.id, changedAt: row.changed_at, oldRole: row.old_role, newRole: row.new_role, person: row.person, actor: row.actor
  }));
};

/** Every admin (the root admin included), by name. */
export const listAdmins = async (client: Client): Promise<TeamPerson[]> => {
  const { data, error } = await client.from('profiles')
    .select('id, full_name, email')
    .or(`is_admin.eq.true,email.eq."${ROOT_ADMIN_EMAIL}"`)
    .is('deleted_at', null);
  if (error) throw failure('Error fetching admins', error, fr.loadErrorHint);
  return [...((data ?? []) as TeamPerson[])].sort(byName);
};

/** The admin grants and removals, newest first (the last 200). */
export const listAdminRoleLog = async (client: Client): Promise<AdminLogEntry[]> => {
  const { data, error } = await client.from('admin_role_log')
    .select('id, changed_at, granted, person:profiles!admin_role_log_user_id_fkey(id, full_name, email), actor:profiles!admin_role_log_actor_id_fkey(id, full_name, email)')
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw failure('Error fetching admin role log', error, fr.loadErrorHint);
  type Row = { id: number; changed_at: string; granted: boolean; person: TeamPerson | null; actor: TeamPerson | null };
  return ((data ?? []) as unknown as Row[]).map(row => ({
    kind: 'admin' as const, id: row.id, changedAt: row.changed_at, granted: row.granted, person: row.person, actor: row.actor
  }));
};

/**
 * The edition's role log and the admin log as one, newest first. On a tie (a promotion drops the
 * edition roles in the same transaction) the admin entry comes first, so read from the bottom the
 * roles go, then the person is named admin.
 */
export const mergeTeamLog = (roleLog: TeamLogEntry[], adminLog: AdminLogEntry[], limit = 200): TeamLogItem[] =>
  [...roleLog, ...adminLog]
    .sort((a, b) => {
      const byDate = Date.parse(b.changedAt) - Date.parse(a.changedAt);
      if (byDate) return byDate;
      if (a.kind !== b.kind) return a.kind === 'admin' ? -1 : 1;
      return b.id - a.id;
    })
    .slice(0, limit);

/** What a person has on the edition: admin, else their role there, else nothing. */
export const levelOf = (person: Pick<TeamCandidate, 'id' | 'isAdmin'>, team: TeamMember[]): TeamLevel =>
  person.isAdmin ? 'admin' : team.find(member => member.person.id === person.id)?.role ?? null;

const toCandidate = ({ is_admin: isAdmin, ...person }: TeamPerson & { is_admin: boolean | null }): TeamCandidate => ({
  ...person,
  isAdmin: !!isAdmin || person.email === ROOT_ADMIN_EMAIL
});

/**
 * The edition's registrants are the accounts with a party that isn't cancelled (waitlist
 * included): an inner join on user_parties, narrowed to the edition.
 */
const SELECT_PEOPLE = 'id, full_name, email, is_admin';
const SELECT_REGISTRANTS = `${SELECT_PEOPLE}, user_parties!inner(event_id, status)`;

/**
 * Every non-deleted account by name, to browse before typing: `registeredOnly` keeps those
 * registered on the edition. `capped` says there were more than `cap`: the list is then only the
 * first ones and the caller should search on the server instead.
 */
export const listPeople = async (
  client: Client,
  eventId: string,
  { registeredOnly = false, cap = PEOPLE_LIST_CAP }: { registeredOnly?: boolean; cap?: number } = {}
): Promise<{ people: TeamCandidate[]; capped: boolean }> => {
  let query = client.from('profiles').select(registeredOnly ? SELECT_REGISTRANTS : SELECT_PEOPLE);
  if (registeredOnly) query = query.eq('user_parties.event_id', eventId).neq('user_parties.status', 'cancelled');
  const { data, error } = await query
    .is('deleted_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(cap + 1);
  if (error) throw failure('Error listing people', error, fr.loadErrorHint);
  const rows = (data ?? []) as unknown as Array<TeamPerson & { is_admin: boolean | null }>;
  return { people: rows.slice(0, cap).map(toCandidate).sort(byName), capped: rows.length > cap };
};

/** Whether `person` matches what was typed, in name or email, ignoring case and accents. */
export const matchesPerson = (person: TeamPerson, query: string): boolean => {
  const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = fold(query.trim());
  return !term || fold(person.full_name ?? '').includes(term) || fold(person.email ?? '').includes(term);
};

// PostgREST's or= filter reads , ( ) " \ as syntax, and * % as wildcards: they become spaces. The
// value is quoted, for the spaces (and an email's dots).
const searchTerm = (query: string): string => query.replace(/[,()*%\\:"']/g, ' ').trim().replace(/\s+/g, ' ');

/**
 * Accounts whose name or email contains `query` (registered for the edition or not), deleted
 * ones left out, by name; at most `limit`. Nothing for an empty query.
 */
export const searchPeople = async (
  client: Client,
  query: string,
  limit = 8,
  { eventId, registeredOnly = false }: { eventId?: string; registeredOnly?: boolean } = {}
): Promise<TeamCandidate[]> => {
  const term = searchTerm(query);
  if (!term) return [];
  const narrowed = registeredOnly && !!eventId;
  let request = client.from('profiles').select(narrowed ? SELECT_REGISTRANTS : SELECT_PEOPLE);
  if (narrowed) request = request.eq('user_parties.event_id', eventId).neq('user_parties.status', 'cancelled');
  const { data, error } = await request
    .or(`full_name.ilike."*${term}*",email.ilike."*${term}*"`)
    .is('deleted_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw failure('Error searching people', error, fr.loadErrorHint);
  return ((data ?? []) as unknown as Array<TeamPerson & { is_admin: boolean | null }>).map(toCandidate);
};

/** Gives someone a role on an edition, changes it, or removes it (null). Logged by the database. */
export const setEditionRole = async (
  client: Client,
  { eventId, userId, role }: { eventId: string; userId: string; role: EditionRole | null }
): Promise<void> => {
  const { error } = await client.rpc('set_edition_role', { p_event_id: eventId, p_user_id: userId, p_role: role as string });
  if (error) throw failure('Error setting edition role', error, fr.updateError);
};
