import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';

// Edition roles (#217, ADR 0023): a ladder of access, each rung including the one below.
//
//   member  <  committee (Comité)  <  organiser (Organisateur)  <  admin
//
// Comité and Organisateur are granted per edition by an admin, in « Équipe »; admin is per
// account (profiles.is_admin) and counts on every edition. The database enforces all of it
// (edition_role(), RLS, the role-checking functions): what this module decides is only what the
// admin screens show. Same error contract as the other modules: the raw error is logged once and
// the function throws one whose message is already French (ADR 0021).

type Client = SupabaseClient<Database>;

export const EDITION_ROLES = ['committee', 'organiser'] as const;
/** A role granted for one edition. */
export type EditionRole = (typeof EDITION_ROLES)[number];
/** A rung of the ladder above member: what may open the admin area. */
export type AccessRole = EditionRole | 'admin';
/** The caller's edition roles, by event id. */
export type EditionRoles = Record<string, EditionRole>;

const RANK: Record<AccessRole, number> = { committee: 1, organiser: 2, admin: 3 };

/** Whether `role` is at least `min` on the ladder. No role (a member) is below every rung. */
export const hasRole = (role: AccessRole | null | undefined, min: AccessRole): boolean =>
  !!role && RANK[role] !== undefined && RANK[role] >= RANK[min];

/**
 * What each action of the admin screens needs. An action the role doesn't allow isn't rendered
 * (not merely disabled); the database refuses it anyway.
 */
export const ACTION_ROLES = {
  /** Résumé's budget card (the budget itself is Organisateur and above). */
  budgetFigures: 'organiser',
  /** Résumé's email problems (email_log, #93). */
  emailProblems: 'organiser',
  /** The email log in an Inscription's dialog (email_log, ADR 0023). */
  emailLog: 'organiser',
  /** Inscrits' « Exporter ». */
  exportData: 'organiser',
  /**
   * A party's amounts and payment status, wherever they show (#290, ADR 0026): Inscrits' list, the
   * party and profile dialogs, Résumé's « Groupes payés ». Comité's parties come without them.
   */
  seeFinances: 'organiser',
  /** Inscrits' payment toggle. */
  markPayment: 'organiser',
  /** Logistique's places, notes and messages, and its Save. */
  saveLogistics: 'organiser',
  /** Opening someone's registration in the god-mode editor. */
  editRegistration: 'admin',
  /** Inscrits' admin checkbox. */
  adminFlag: 'admin'
} as const satisfies Record<string, AccessRole>;
export type AdminAction = keyof typeof ACTION_ROLES;

/** Whether a role may take an action on the admin screens. */
export const can = (role: AccessRole | null | undefined, action: AdminAction): boolean =>
  hasRole(role, ACTION_ROLES[action]);

/** The caller's role on an event: admin on every one, else their edition role there, else null. */
export const roleOn = (
  eventId: string | null | undefined,
  { isAdmin, roles }: { isAdmin: boolean; roles: EditionRoles }
): AccessRole | null => {
  if (isAdmin) return 'admin';
  return (eventId && roles[eventId]) || null;
};

/**
 * The editions whose history and exports a person may read: every one for an admin, else those
 * they are Organisateur of, past ones included (ADR 0023).
 */
export const organiserEditions = <T extends { id: string }>(
  events: readonly T[],
  { isAdmin, roles }: { isAdmin: boolean; roles: EditionRoles }
): T[] => events.filter(event => hasRole(roleOn(event.id, { isAdmin, roles }), 'organiser'));

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

/** The signed-in person's own edition roles, by event (the database shows them only their own). */
export const fetchMyEditionRoles = async (client: Client, userId: string): Promise<EditionRoles> => {
  const { data, error } = await client.from('edition_roles').select('event_id, role').eq('user_id', userId);
  if (error) throw failure('Error fetching edition roles', error, fr.loadErrorHint);
  return Object.fromEntries((data ?? []).map(row => [row.event_id, row.role as EditionRole]));
};
