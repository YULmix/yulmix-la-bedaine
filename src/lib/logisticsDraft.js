// The Logistique tab's unsaved edits (#150), held by AdminView until the one Save:
// `{ [partyId]: { places?: { [attendeeId]: placeId | null }, adminNotes?: string } }`.
// A place of null unassigns; an absent key means "as saved". A party with nothing pending has no
// entry, so the draft's keys are exactly the parties marked unsaved. Pure (logisticsDraft.test.js).

const without = (object, key) => Object.fromEntries(Object.entries(object || {}).filter(([k]) => k !== key));

const withParty = (changes, partyId, partyChanges) => {
  const next = { ...changes };
  if (Object.keys(partyChanges.places || {}).length || partyChanges.adminNotes !== undefined) next[partyId] = partyChanges;
  else delete next[partyId];
  return next;
};

/** Sets one attendee's pending place; the place they already hold drops the change. */
export const setPlaceChange = (changes, party, attendeeId, placeId) => {
  const attendee = (party.attendees || []).find(a => a.id === attendeeId);
  const places = { ...changes[party.id]?.places };
  if (placeId === (attendee?.place?.place_id ?? null)) delete places[attendeeId];
  else places[attendeeId] = placeId;
  const rest = without(changes[party.id], 'places');
  return withParty(changes, party.id, Object.keys(places).length ? { ...rest, places } : rest);
};

/** Sets a party's pending admin notes; the saved text drops the change. */
export const setNotesChange = (changes, party, adminNotes) => {
  const rest = without(changes[party.id], 'adminNotes');
  return withParty(changes, party.id, adminNotes === (party.admin_notes || '') ? rest : { ...rest, adminNotes });
};

/** How many edits are pending: one per attendee whose place changed, one per party's notes. */
export const countChanges = (changes) => Object.values(changes)
  .reduce((sum, party) => sum + Object.keys(party.places || {}).length + (party.adminNotes !== undefined ? 1 : 0), 0);

/** The save_logistics() argument: one entry per party with pending edits. */
export const logisticsPayload = (changes) => Object.entries(changes).map(([partyId, party]) => ({
  party_id: partyId,
  places: party.places || {},
  ...(party.adminNotes !== undefined && { admin_notes: party.adminNotes })
}));

/**
 * The draft left after a save of `sent` (the draft as it was sent) that failed for `failedIds`:
 * saved parties are cleared, failed ones kept. A party edited again while the save was running
 * keeps its newer draft either way.
 */
export const draftAfterSave = (current, sent, failedIds) => {
  const failed = new Set(failedIds);
  return Object.fromEntries(Object.entries(current)
    .filter(([partyId, party]) => failed.has(partyId) || party !== sent[partyId]));
};
