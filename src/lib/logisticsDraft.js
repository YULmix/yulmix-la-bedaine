// The Logistique tab's unsaved edits (#150), held by the logistics store until the one Save:
// `{ [partyId]: { places?: { [attendeeId]: placeId | null }, adminNotes?: string, participantMessage?: string } }`.
// adminNotes are the organisers' private notes; participantMessage is shown to the member (#216).
// A place of null unassigns; an absent key means "as saved". A party with nothing pending has no
// entry, so the draft's keys are exactly the parties marked unsaved. Pure (logisticsDraft.test.js).

// The party's free texts: draft key → user_parties column (and save_logistics() key).
const TEXTS = [['adminNotes', 'admin_notes'], ['participantMessage', 'message_to_participants']];

const without = (object, key) => Object.fromEntries(Object.entries(object || {}).filter(([k]) => k !== key));

const withParty = (changes, partyId, partyChanges) => {
  const next = { ...changes };
  if (Object.keys(partyChanges.places || {}).length || TEXTS.some(([key]) => partyChanges[key] !== undefined)) next[partyId] = partyChanges;
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

const setTextChange = (key, column) => (changes, party, text) => {
  const rest = without(changes[party.id], key);
  return withParty(changes, party.id, text === (party[column] || '') ? rest : { ...rest, [key]: text });
};

/** Sets a party's pending admin notes; the saved text drops the change. */
export const setNotesChange = setTextChange('adminNotes', 'admin_notes');

/** Sets a party's pending message to its participants (#216); the saved text drops the change. */
export const setMessageChange = setTextChange('participantMessage', 'message_to_participants');

/** How many edits are pending: one per attendee whose place changed, one per party's text. */
export const countChanges = (changes) => Object.values(changes)
  .reduce((sum, party) => sum + Object.keys(party.places || {}).length
    + TEXTS.filter(([key]) => party[key] !== undefined).length, 0);

/** The save_logistics() argument: one entry per party with pending edits. */
export const logisticsPayload = (changes) => Object.entries(changes).map(([partyId, party]) => ({
  party_id: partyId,
  places: party.places || {},
  ...Object.fromEntries(TEXTS.filter(([key]) => party[key] !== undefined).map(([key, column]) => [column, party[key]]))
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
