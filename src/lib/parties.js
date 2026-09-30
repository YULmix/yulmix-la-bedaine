// Reading and saving a registration (user_parties row) with its attendees, which live in their
// own table (ADR 0018). Screens receive a party with an `attendees` array in display order, as
// they did when the attendees were a JSON column.

/**
 * Columns for a party with its attendees embedded; add more embeds after it if needed. Each
 * attendee has `place`: `{ place_id, bed_label, place_label, location_id, location_name,
 * location_photo_path }` from the attendee_places view, or null (#114, #124).
 */
export const PARTY_WITH_ATTENDEES = '*, attendees(*, place:attendee_places(place_id, bed_label, place_label, location_id, location_name, location_photo_path))';

/** Orders the embedded attendees by position. Apply to any query selecting PARTY_WITH_ATTENDEES. */
export const orderAttendees = (query) => query.order('position', { referencedTable: 'attendees' });

/** One party with its attendees, or null. */
export const fetchParty = async (supabase, partyId) => {
  const { data, error } = await orderAttendees(
    supabase.from('user_parties').select(PARTY_WITH_ATTENDEES).eq('id', partyId)
  ).maybeSingle();
  if (error) throw error;
  return data;
};

/**
 * Saves a registration and its attendees in one transaction (save_registration()), then returns
 * the party with its attendees. An attendee with the `id` of an existing one updates it; one
 * without is added; existing ones left out are removed.
 *
 * @param {object} args
 * @param {string} args.eventId
 * @param {Array<object>} args.attendees DB-shaped attendees, in display order
 * @param {object} [args.party] party-wide fields (logistics, transport, music_requests, message_to_organizers)
 * @param {string} [args.userId] whose registration, for an admin saving someone else's
 */
export const saveRegistration = async (supabase, { eventId, attendees, party = {}, userId }) => {
  const { data, error } = await supabase.rpc('save_registration', {
    p_event_id: eventId,
    p_attendees: attendees,
    p_party: party,
    ...(userId ? { p_user_id: userId } : {})
  });
  if (error) throw error;
  return fetchParty(supabase, data.id);
};
