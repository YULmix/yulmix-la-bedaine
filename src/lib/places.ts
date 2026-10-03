import { ACCOMMODATION_OPTIONS, getOptionLabel, isActiveRegistration } from './registrationOptions';
import type { Database } from './database.types';

// Sleeping places (#112, #145): a venue's totals, and the Logistique tab's place picker (#114). Pure,
// so the counting and picking rules are tested on their own (places.test.js). An event's places
// themselves, as it sees them, come from the event places module (eventPlaces.ts, #193).

type GeneratedLayoutRow = Database['public']['Functions']['venue_layout']['Returns'][number];
// Columns a left join can leave null, which the generator can't see: a location without places
// has no place, and a location's note is optional.
type NullableColumn = 'place_id' | 'label' | 'type' | 'capacity' | 'place_sort_order' | 'location_note';
/** A venue_layout() row. */
export type VenueLayoutRow = Omit<GeneratedLayoutRow, NullableColumn>
  & { [K in NullableColumn]: GeneratedLayoutRow[K] | null };

export interface LayoutPlace {
  id: string;
  label: string;
  type: string;
  capacity: number;
  sort_order: number;
}

export interface LayoutLocation {
  id: string;
  name: string;
  note: string | null;
  sort_order: number;
  places: LayoutPlace[];
}

/** A place as the picker and the stats read it: an event places row (eventPlaces.ts) or alike. */
export interface PickablePlace {
  id: string;
  label: string;
  type: string;
  capacity: number;
  locationId: string;
  locationName: string;
}

/** An attendee as placeOccupancy reads it: their saved place, from the attendee_places embed. */
interface SeatedAttendee {
  id: string;
  name?: string;
  place?: { place_id?: string | null; location_id?: string | null; location_name?: string | null; place_label?: string | null } | null;
}

/** Unsaved Logistique place changes: party → attendee → place id, or null to unassign (logisticsDraft.js). */
export type PlaceChanges = Record<string, { places?: Record<string, string | null> } | undefined>;

export interface PlaceOption<P extends PickablePlace = PickablePlace> {
  place: P;
  remaining: number;
  full: boolean;
  matches: boolean;
}

/**
 * A venue's layout (#193) from venue_layout() rows, which come in display order: its locations,
 * each with its places, in that order. A location without places is a row without a place.
 */
export const venueLayoutOf = (rows: VenueLayoutRow[] | null | undefined): LayoutLocation[] => {
  const locations = new Map<string, LayoutLocation>();
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
      locations.get(row.location_id)!.places.push({
        id: row.place_id, label: row.label!, type: row.type!, capacity: row.capacity!, sort_order: row.place_sort_order!
      });
    }
  });
  return [...locations.values()];
};

/** A venue's size: its locations, places and total sleeping capacity (`locations` embed `places`). */
export const venueTotals = (locations: Array<{ places?: Array<{ capacity: number }> | null }> | null | undefined) => {
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
export const placeTypeBreakdown = (locations: Array<{ places?: Array<{ type: string; capacity: number }> | null }> | null | undefined) => {
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
export const placeOccupancy = (
  parties: Array<{ id: string; attendees?: SeatedAttendee[] | null }> | null | undefined,
  changes: PlaceChanges = {}
): Map<string, number> => {
  const occupancy = new Map<string, number>();
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
export const placeOptions = <P extends PickablePlace>(
  places: P[],
  occupancy: Map<string, number>,
  { preference, currentPlaceId }: { preference?: string | null; currentPlaceId?: string | null } = {}
): PlaceOption<P>[] => {
  const options = places.map(place => {
    const taken = (occupancy.get(place.id) || 0) - (place.id === currentPlaceId ? 1 : 0);
    const remaining = place.capacity - taken;
    return { place, remaining, full: remaining <= 0, matches: !!preference && place.type === preference };
  });
  const rank = (option: PlaceOption<P>) => (option.full ? 2 : option.matches ? 0 : 1);
  // Array.prototype.sort is stable: within a rank, display order is kept.
  return options.sort((a, b) => rank(a) - rank(b));
};

const normalise = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (text: string): string[] => normalise(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Options whose location, place or type has a word starting with each word of the query. */
export const searchPlaceOptions = <O extends PlaceOption>(options: O[], query: string | null | undefined): O[] => {
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
 */
export const sleepingByLocation = (
  attendees: SeatedAttendee[] | null | undefined
): Array<{ locationId: string; name: string; sleepers: Array<{ name: string; place: string }> }> => {
  const byLocation = new Map<string, { locationId: string; name: string; sleepers: Array<{ name: string; place: string }> }>();
  (attendees || []).forEach(({ name = '', place }) => {
    if (!place) return;
    const locationId = place.location_id ?? '';
    if (!byLocation.has(locationId)) {
      byLocation.set(locationId, {
        locationId,
        name: place.location_name ?? '',
        sleepers: []
      });
    }
    byLocation.get(locationId)!.sleepers.push({ name, place: place.place_label ?? '' });
  });
  return [...byLocation.values()];
};

// Who gets a bed first (#216): parties where someone asked for a bed for health reasons, then
// for young children (and nobody for health), then everyone else. Bed reasons are per attendee
// (bed_reason); a cancelled party's don't count. Waitlisted parties follow the same rule.
const BED_PRIORITY_REASONS = ['health', 'children'];

const bedPriorityOf = (party: { status?: string | null; attendees?: Array<{ bed_reason?: string | null }> | null }): number => {
  if (!isActiveRegistration(party)) return BED_PRIORITY_REASONS.length;
  const reasons = new Set((party.attendees || []).map(attendee => attendee.bed_reason));
  const rank = BED_PRIORITY_REASONS.findIndex(reason => reasons.has(reason));
  return rank === -1 ? BED_PRIORITY_REASONS.length : rank;
};

/** The parties in bed priority order (health, children, the rest), keeping their order within each. */
export const byBedPriority = <P extends { status?: string | null; attendees?: Array<{ bed_reason?: string | null }> | null }>(
  parties: P[] | null | undefined
): P[] => (parties || [])
  .map((party, index) => ({ party, index, rank: bedPriorityOf(party) }))
  .sort((a, b) => a.rank - b.rank || a.index - b.index)
  .map(({ party }) => party);
