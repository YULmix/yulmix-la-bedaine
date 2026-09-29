import { ACCOMMODATION_OPTIONS, getOptionLabel } from './registrationOptions.js';

// Sleeping places of an event (#112, #145), for the Logistique tab's place picker (#114). Pure, so the
// ordering and counting rules are tested on their own (places.test.js).

const bySortOrder = (a, b) => a.sort_order - b.sort_order;

/**
 * The venue's locations (with their `places` embedded) as one list of places, in display order,
 * as the event sees them (#145): without the places it excludes, at its capacity where it
 * overrides one (`overrides` are event_place_overrides rows).
 */
export const flattenPlaces = (locations, overrides = []) => {
  const overrideOf = new Map((overrides || []).map(row => [row.place_id, row]));
  return [...(locations || [])]
    .sort(bySortOrder)
    .flatMap(location => [...(location.places || [])].sort(bySortOrder)
      .filter(place => !overrideOf.get(place.id)?.is_excluded)
      .map(place => ({
        id: place.id,
        label: place.label,
        type: place.type,
        capacity: overrideOf.get(place.id)?.capacity ?? place.capacity,
        locationId: location.id,
        locationName: location.name
      })));
};

/**
 * The write for one event's setting of one place (#147), after `change` (`{ is_excluded }` or
 * `{ capacity }`) on its current event_place_overrides row (or null). A capacity equal to the
 * place's own is no override; a row that neither excludes nor resizes is deleted, since the
 * database doesn't keep one. Returns `{ op: 'upsert', row }`, `{ op: 'delete' }` or `{ op: 'none' }`.
 */
export const overrideWrite = (place, override, change) => {
  const next = { is_excluded: override?.is_excluded ?? false, capacity: override?.capacity ?? null, ...change };
  if (next.capacity === place.capacity) next.capacity = null;
  if (!next.is_excluded && next.capacity == null) return override ? { op: 'delete' } : { op: 'none' };
  return { op: 'upsert', row: { is_excluded: next.is_excluded, capacity: next.capacity } };
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
 * How many attendees each place holds, counting unsaved Logistique changes
 * (`changes[partyId].attendees[index]` = a place id, or null to unassign) over the saved places.
 */
export const placeOccupancy = (parties, changes = {}) => {
  const occupancy = new Map();
  (parties || []).forEach(party => (party.attendees || []).forEach((attendee, index) => {
    const pending = changes[party.id]?.attendees?.[index];
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
