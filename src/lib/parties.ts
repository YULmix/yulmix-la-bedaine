import type { SupabaseClient } from '@supabase/supabase-js';
import fr from '../locales/fr.json';
import type { Database, Json } from './database.types';
import { appError, dbErrorMessage } from './dbErrors';
import type { ErrorLike } from './dbErrors';
import { REGISTRATION_STATUS } from './registrationOptions';
import type { PaymentStatus } from './registrationOptions';

// The party module (#197): the only code that reads or writes a registration (a user_parties row)
// and its attendees, which live in their own table (ADR 0018). Screens receive a party with an
// `attendees` array in display order, each attendee with its `place` (from attendee_places, or
// null, #114). The organisers' private notes live in party_admin_notes, which only admins read
// (#227): an admin's list carries them as `admin_notes`; a member's read never asks for them.
//
// Errors: every function logs the raw error once (PostgREST errors are hard to diagnose from a
// screenshot) and throws an appError whose message is already French: the code's text for our
// own SQL errors (ADR 0021), else the function's fallback. Callers show `error.message` as is, or
// pass the error to dbErrorMessage(), which keeps it.

type Client = SupabaseClient<Database>;
type PartyRow = Database['public']['Tables']['user_parties']['Row'];
type AttendeeRow = Database['public']['Tables']['attendees']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface AttendeePlace {
  place_id: string;
  bed_label: string | null;
  place_label: string | null;
  location_id: string | null;
  location_name: string | null;
}
export type Attendee = AttendeeRow & { place: AttendeePlace | null };
export type Party = PartyRow & { attendees: Attendee[] };
/** A party as the admin lists it, with its member's profile and the organisers' notes. */
export type AdminParty = Party & {
  profiles: Pick<ProfileRow, 'id' | 'email' | 'full_name' | 'is_admin' | 'created_at' | 'deleted_at'>;
  admin_notes: string | null;
};

// Named columns, not *: a private column added to user_parties later isn't sent to members by
// default (#227). Typed against the table, so a renamed or dropped column fails the type check.
const PARTY_COLUMNS = [
  'id', 'user_id', 'event_id', 'status', 'is_waitlisted', 'payment_status', 'calculated_amount_owed',
  'locked_selling_price_whole_event', 'locked_ratio_main_whole', 'logistics', 'transport', 'music_requests',
  'message_to_organizers', 'message_to_participants', 'confirmation_message', 'created_at', 'last_edited_at',
  'edit_count'
] as const satisfies ReadonlyArray<keyof PartyRow>;
const PARTY_WITH_ATTENDEES = `${PARTY_COLUMNS.join(', ')}, attendees(*, place:attendee_places(place_id, bed_label, place_label, location_id, location_name))`;
const ADMIN_PARTY = `${PARTY_WITH_ATTENDEES}, profiles!inner(id, email, full_name, is_admin, created_at, deleted_at), admin_note:party_admin_notes(notes)`;

const failure = (context: string, error: unknown, fallback: string): Error => {
  const { message, code, details, hint } = (error ?? {}) as ErrorLike & { code?: string; hint?: string };
  console.error(`${context}:`, message, code, details, hint, error);
  return Object.assign(appError(dbErrorMessage(error as ErrorLike, fallback)), { cause: error });
};

/** One party with its attendees, or null. */
export const fetchParty = async (client: Client, partyId: string): Promise<Party | null> => {
  const { data, error } = await client.from('user_parties').select(PARTY_WITH_ATTENDEES).eq('id', partyId)
    .order('position', { referencedTable: 'attendees' })
    .maybeSingle();
  if (error) throw failure('Error fetching party', error, fr.loadErrorHint);
  return data as unknown as Party | null;
};

/** A member's party for an event, or null if they haven't registered. */
export const fetchMyParty = async (client: Client, userId: string, eventId: string): Promise<Party | null> => {
  const { data, error } = await client.from('user_parties').select(PARTY_WITH_ATTENDEES)
    .eq('user_id', userId).eq('event_id', eventId)
    .order('position', { referencedTable: 'attendees' })
    .maybeSingle();
  if (error) throw failure('Error fetching my party', error, fr.loadErrorHint);
  return data as unknown as Party | null;
};

/**
 * An event's parties as the admin lists them, oldest first, with their member's profile. A deleted
 * account's registrations for events to come were cancelled with it (#36): it's no longer a member
 * of this edition, so those are left out. Its other registrations stay, as history.
 */
export const listEventParties = async (client: Client, eventId: string): Promise<AdminParty[]> => {
  const { data, error } = await client.from('user_parties').select(ADMIN_PARTY)
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
    .order('position', { referencedTable: 'attendees' });
  if (error) throw failure('Error fetching parties', error, fr.loadErrorHint);
  type Row = Omit<AdminParty, 'admin_notes'> & { admin_note: { notes: string | null } | null };
  return ((data ?? []) as unknown as Row[])
    .filter(party => !(party.profiles?.deleted_at && party.status === REGISTRATION_STATUS.CANCELLED))
    .map(({ admin_note, ...party }) => ({ ...party, admin_notes: admin_note?.notes ?? null }));
};

/** What the preview's test-account picker shows about each party of an event. */
export type PartySummary = Pick<PartyRow, 'id' | 'user_id' | 'status' | 'is_waitlisted' | 'payment_status'> & { hasPlace: boolean };

export const listPartySummaries = async (client: Client, eventId: string): Promise<PartySummary[]> => {
  const { data, error } = await client.from('user_parties')
    .select('id, user_id, status, is_waitlisted, payment_status, attendees(place:attendee_places(place_id))')
    .eq('event_id', eventId);
  if (error) throw failure('Error fetching party summaries', error, fr.loadErrorHint);
  type Row = Omit<PartySummary, 'hasPlace'> & { attendees: Array<{ place: unknown }> | null };
  return ((data ?? []) as unknown as Row[]).map(({ attendees, ...party }) => ({
    ...party,
    hasPlace: (attendees ?? []).some(attendee => attendee.place)
  }));
};

export interface SaveRegistrationArgs {
  eventId: string;
  /** DB-shaped attendees, in display order. */
  attendees: Array<Record<string, unknown>>;
  /** Party-wide fields (logistics, transport, music_requests, message_to_organizers). */
  party?: Record<string, unknown>;
  /** Whose registration, for an admin saving someone else's. */
  userId?: string;
}

/**
 * Saves a registration and its attendees in one transaction (save_registration()), then returns
 * the party with its attendees. An attendee with the `id` of an existing one updates it; one
 * without is added; existing ones left out are removed: their row is kept, marked `deleted_at`
 * (#237), and no read returns it again (the database hides it).
 */
export const saveRegistration = async (client: Client, { eventId, attendees, party = {}, userId }: SaveRegistrationArgs): Promise<Party | null> => {
  const { data, error } = await client.rpc('save_registration', {
    p_event_id: eventId,
    p_attendees: attendees as Json,
    p_party: party as Json,
    ...(userId ? { p_user_id: userId } : {})
  });
  if (error) throw failure('save_registration error', error, fr.saveError);
  return fetchParty(client, data.id);
};

/**
 * Cancels a registration (#35): a soft status change. The row stays, the database promotes the
 * waitlist, and after the close date it refuses. Returns the cancelled party.
 */
export const cancelParty = async (client: Client, partyId: string): Promise<Party> => {
  const { data, error } = await client.from('user_parties')
    .update({ status: REGISTRATION_STATUS.CANCELLED })
    .eq('id', partyId)
    .select(PARTY_WITH_ATTENDEES)
    .order('position', { referencedTable: 'attendees' })
    .single();
  if (error) throw failure('Error cancelling registration', error, fr.cancelRegistrationError);
  return data as unknown as Party;
};

/** Sets a party's payment status (admins only, as the database enforces). */
export const setPaymentStatus = async (client: Client, partyId: string, status: PaymentStatus): Promise<void> => {
  const { error } = await client.from('user_parties').update({ payment_status: status }).eq('id', partyId);
  if (error) throw failure('Error updating payment status', error, fr.updateError);
};
