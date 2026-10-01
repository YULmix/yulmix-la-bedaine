import { ACCOMMODATION_OPTIONS, getOptionLabel } from './registrationOptions.js';

// Sleeping places (#112, #145): a venue's totals, and the Logistique tab's place picker (#114). Pure,
// so the counting and picking rules are tested on their own (places.test.js). An event's places
// themselves, as it sees them, come from the event places module (eventPlaces.js, #193).

/**
 * A venue's layout (#193) from venue_layout() rows, which come in display order: its locations,
 * each with its places, in that order. A location without places is a row without a place.
 * @returns {Array<{ id, name, note, sort_order, places: Array<{ id, label, type, capacity, sort_order }> }>}
 */
export const venueLayoutOf = (rows) => {
  const locations = new Map();
  (rows || []).forEach(row => {
    if (!locations.has(row.location_id)) {
      locations.set(row.location_id, {
        id: row.location_id,
        name: row.location_name,
        note: row.location_note,
        sort_order: row.location_sort_order,
        places: []
      });
    }
    if (row.place_id) {
      locations.get(row.location_id).places.push({
        id: row.place_id, label: row.label, type: row.type, capacity: row.capacity, sort_order: row.place_sort_order
      });
    }
  });
  return [...locations.values()];
};

/** A venue's size: its locations, places and total sleeping capacity (`locations` embed `places`). */
export const venueTotals = (locations) => {
  const places = (locations || []).flatMap(location => location.places || []);
  return {
    locations: (locations || []).length,
    places: places.length,
    capacity: places.reduce((sum, place) => sum + place.capacity, 0)
  };
};

/**
 * A venue's places by type (#164), in ACCOMMODATION_OPTIONS order: `{ type, places, capacity }`
 * for each type it has at least one place of. The rows add up to venueTotals' places and capacity.
 */
export const placeTypeBreakdown = (locations) => {
  const places = (locations || []).flatMap(location => location.places || []);
  return ACCOMMODATION_OPTIONS
    .map(({ value: type }) => {
      const ofType = places.filter(place => place.type === type);
      return { type, places: ofType.length, capacity: ofType.reduce((sum, place) => sum + place.capacity, 0) };
    })
    .filter(row => row.places > 0);
};

/**
 * How many attendees each place holds, counting unsaved Logistique changes
 * (`changes[partyId].places[attendeeId]` = a place id, or null to unassign; see logisticsDraft.js)
 * over the saved places.
 */
export const placeOccupancy = (parties, changes = {}) => {
  const occupancy = new Map();
  (parties || []).forEach(party => (party.attendees || []).forEach(attendee => {
    const pending = changes[party.id]?.places?.[attendee.id];
    const placeId = pending !== undefined ? pending : attendee.place?.place_id;
    if (placeId) occupancy.set(placeId, (occupancy.get(placeId) || 0) + 1);
  }));
  return occupancy;
};

/**
 * The places an attendee can be given, in picking order: open places of the type they asked for,
 * then other open places, then full ones (still pickable: overbooking is allowed). The place the
 * attendee holds now doesn't count against them.
 */
export const placeOptions = (places, occupancy, { preference, currentPlaceId } = {}) => {
  const options = places.map(place => {
    const taken = (occupancy.get(place.id) || 0) - (place.id === currentPlaceId ? 1 : 0);
    const remaining = place.capacity - taken;
    return { place, remaining, full: remaining <= 0, matches: !!preference && place.type === preference };
  });
  const rank = option => (option.full ? 2 : option.matches ? 0 : 1);
  // Array.prototype.sort is stable: within a rank, display order is kept.
  return options.sort((a, b) => rank(a) - rank(b));
};

const normalise = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = text => normalise(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Options whose location, place or type has a word starting with each word of the query. */
export const searchPlaceOptions = (options, query) => {
  const wanted = words(query || '');
  if (!wanted.length) return options;
  return options.filter(({ place }) => {
    const haystack = words(`${place.locationName} ${place.label} ${getOptionLabel(ACCOMMODATION_OPTIONS, place.type, '')}`);
    return wanted.every(word => haystack.some(candidate => candidate.startsWith(word)));
  });
};

/**
 * Where a party sleeps (#124), one entry per location in the order its attendees come: the
 * location's name, and who sleeps there in which place (its gallery is read apart, #177). Attendees without a place are
 * left out; a party with none gives []. Each attendee's `place` is the attendee_places embed.
 * @returns {Array<{ locationId: string, name: string, sleepers: Array<{ name: string, place: string }> }>}
 */
export const sleepingByLocation = (attendees) => {
  const byLocation = new Map();
  (attendees || []).forEach(({ name, place }) => {
    if (!place) return;
    if (!byLocation.has(place.location_id)) {
      byLocation.set(place.location_id, {
        locationId: place.location_id,
        name: place.location_name,
        sleepers: []
      });
    }
    byLocation.get(place.location_id).sleepers.push({ name, place: place.place_label });
  });
  return [...byLocation.values()];
};
