import {
  ACCOMMODATION_OPTIONS,
  DIETARY_OPTIONS,
  PAYMENT_STATUS,
  VOLUNTEERING_OPTIONS,
  dietaryNeedsOf,
  isActiveRegistration,
  transportKindOf
} from './registrationOptions';
import { placeOccupancy } from './places';

// Aggregates for the admin overview, derived from each party's attendees (ADR 0018: nothing about
// attendees is stored on the party).

const TIERS = ['adult_whole', 'adult_main', 'teen_whole', 'teen_main', 'kids'];

export const tierOf = (attendee) => {
  if (attendee.type === 'Kid') return 'kids';
  const age = attendee.type === 'Teenager' ? 'teen' : 'adult';
  return `${age}_${attendee.participation === 'Main' ? 'main' : 'whole'}`;
};

/** Headcount per tier: { adult_whole, adult_main, teen_whole, teen_main, kids }. */
export const tierCountsOf = (attendees = []) => attendees.reduce(
  (counts, attendee) => ({ ...counts, [tierOf(attendee)]: counts[tierOf(attendee)] + 1 }),
  Object.fromEntries(TIERS.map(tier => [tier, 0]))
);

// What a party owes is what the database computed (#117): an unpaid party is priced at the price
// it locked when it registered, a paid one keeps what it paid. Never re-run the pricing engine at
// the event's current price here.
export const amountOwedOf = (party) => Number(party.calculated_amount_owed) || 0;

/**
 * @param {Array} parties user_parties rows (with attendees). Cancelled ones are skipped: there
 *   are no refunds, so a cancelled party owes nothing and counts for nothing (#101).
 * @param {(party) => number} amountOf the party's amount owed
 */
export const computeAdminStats = (allParties, amountOf = amountOwedOf) => {
  const parties = allParties.filter(isActiveRegistration);
  const tiers = Object.fromEntries(TIERS.map(tier => [tier, 0]));
  const accommodation = {};
  const dietary = {};
  let people = 0;
  let newMembers = 0;
  let bedRequests = 0;
  let bedsAssigned = 0;
  let paidParties = 0;
  let waitlistedParties = 0;
  let totalDue = 0;
  let received = 0;

  parties.forEach(party => {
    const amount = amountOf(party);
    totalDue += amount;
    if (party.payment_status === PAYMENT_STATUS.PAID) {
      paidParties += 1;
      received += amount;
    }
    if (party.is_waitlisted) waitlistedParties += 1;
    (party.attendees || []).forEach(attendee => {
      people += 1;
      tiers[tierOf(attendee)] += 1;
      if (attendee.is_new_member) newMembers += 1;
      if (attendee.sleeping_preference) accommodation[attendee.sleeping_preference] = (accommodation[attendee.sleeping_preference] || 0) + 1;
      if (attendee.sleeping_preference === 'bed') bedRequests += 1;
      if (attendee.place) bedsAssigned += 1;
      // Several needs per attendee (#153): each counts once, so totals can exceed the head count.
      dietaryNeedsOf(attendee.dietary_needs).filter(need => need !== 'none')
        .forEach(need => { dietary[need] = (dietary[need] || 0) + 1; });
    });
  });

  return {
    people,
    parties: parties.length,
    tiers,
    newMembers,
    accommodation,
    dietary,
    bedRequests,
    bedsAssigned,
    paidParties,
    waitlistedParties,
    totalDue,
    received,
    outstanding: totalDue - received
  };
};

// The parties confirmed to come: not cancelled, not waitlisted. They're the people who hold, or
// are to be given, a sleeping place (the database releases a waitlisted party's), and the ones
// the Logistique views of the form's answers list (#179).
const confirmedParties = allParties => allParties.filter(party => isActiveRegistration(party) && !party.is_waitlisted);

/**
 * Sleeping-place figures for an event with locations: the overview (#115), and the Logistique
 * header (#166), which counts its unsaved changes too. Cancelled and waitlisted parties hold no
 * places, and aren't counted as unassigned either.
 * @param {Array} allParties user_parties rows (with attendees and their `place`)
 * @param {Array} places the event's places it uses, from the event places module (`available`)
 * @param {object} [changes] unsaved Logistique place changes (logisticsDraft.js), over the saved places
 * @returns {{ locations: Array, unassigned: number, overbooked: Array }} each location with its
 *   capacity and assigned, and its places with their `assigned` count.
 */
export const computePlaceStats = (allParties, places, changes = {}) => {
  const parties = confirmedParties(allParties);
  const occupancy = placeOccupancy(parties, changes);
  const locations = [];
  places.forEach(place => {
    const assigned = occupancy.get(place.id) || 0;
    // Event places come in display order, a location's places together.
    let location = locations.at(-1);
    if (location?.id !== place.locationId) {
      location = { id: place.locationId, name: place.locationName, capacity: 0, assigned: 0, places: [] };
      locations.push(location);
    }
    location.places.push({ ...place, assigned });
    location.capacity += place.capacity;
    location.assigned += assigned;
  });
  const placeOf = (party, attendee) => {
    const pending = changes[party.id]?.places?.[attendee.id];
    return pending !== undefined ? pending : attendee.place?.place_id;
  };
  const unassigned = parties.reduce((count, party) => count + (party.attendees || []).filter(attendee => !placeOf(party, attendee)).length, 0);
  const overbooked = locations.flatMap(location => location.places).filter(place => place.assigned > place.capacity);
  return { locations, unassigned, overbooked };
};

/**
 * What people asked for against what the event's places hold, by place type (#166), in
 * ACCOMMODATION_OPTIONS order: `{ type, requested, capacity }` for each type with requests or
 * places. `requested` counts the same people as computePlaceStats' (active, not waitlisted), by
 * their sleeping_preference, which takes the same values as a place's type. Those with no known
 * preference are `noPreference`, so the rows add up to everyone to place. Unsaved changes don't
 * move either side, so this takes none.
 * @param {Array} allParties user_parties rows (with attendees)
 * @param {Array} places the event's places it uses, from the event places module (`available`: overrides applied)
 * @returns {{ types: Array<{type: string, requested: number, capacity: number}>, noPreference: number }}
 */
export const placeDemandByType = (allParties, places) => {
  const attendees = confirmedParties(allParties).flatMap(party => party.attendees || []);
  const types = ACCOMMODATION_OPTIONS
    .map(({ value: type }) => ({
      type,
      requested: attendees.filter(attendee => attendee.sleeping_preference === type).length,
      capacity: places.filter(place => place.type === type).reduce((sum, place) => sum + place.capacity, 0)
    }))
    .filter(row => row.requested > 0 || row.capacity > 0);
  const known = new Set(ACCOMMODATION_OPTIONS.map(option => option.value));
  return { types, noPreference: attendees.filter(attendee => !known.has(attendee.sleeping_preference)).length };
};

// The Logistique tab's views of what parties answered in the form (#179): food, volunteering,
// transport, comments. Each takes every party of the event (with attendees and `profiles`) and
// keeps the confirmed ones, in the order given.

/** Who to talk to about a party: the registering member's name, else their email. */
export const contactNameOf = (party) => party.profiles?.full_name || party.profiles?.email || '';

/**
 * Who has which dietary need, in DIETARY_OPTIONS order, for the needs someone has (« Aucune
 * restriction » isn't one). An attendee with several needs is under each. The kitchen cooks for
 * people, so there's no party here.
 * @returns {Array<{need: string, attendees: Array<{id, name: string, other: string}>}>}
 *   `other` is what they wrote for « Autre », on the 'other' need only.
 */
export const dietaryBreakdown = (allParties) => {
  const attendees = confirmedParties(allParties).flatMap(party => party.attendees || []);
  return DIETARY_OPTIONS
    .filter(({ value }) => value !== 'none')
    .map(({ value: need }) => ({
      need,
      attendees: attendees
        .filter(attendee => dietaryNeedsOf(attendee.dietary_needs).includes(need))
        .map(attendee => ({
          id: attendee.id,
          name: attendee.name || '',
          other: need === 'other' ? (attendee.dietary_other || '').trim() : ''
        }))
    }))
    .filter(row => row.attendees.length > 0);
};

/**
 * Every volunteering choice, in VOLUNTEERING_OPTIONS order, with the parties that picked it (none
 * for a gap). Volunteering is per party.
 * @returns {Array<{choice: string, parties: Array<{id, contact: string, other: string}>}>} `other`
 *   is the party's own text, on the 'other' choice only.
 */
export const volunteersByChoice = (allParties) => {
  const parties = confirmedParties(allParties);
  return VOLUNTEERING_OPTIONS.map(({ value: choice }) => ({
    choice,
    parties: parties
      .filter(party => (party.logistics?.volunteering || []).includes(choice))
      .map(party => ({
        id: party.id,
        contact: contactNameOf(party),
        other: choice === 'other' ? (party.logistics?.volunteering_other || '').trim() : ''
      }))
  }));
};

/**
 * One row per party that offers or needs a lift (the others aren't listed): its kind, the seats
 * it offers or needs, arrival, departure, and where it leaves from (#181: postal code start and
 * note) as saved ('' when unset).
 * Offers first, then needs.
 * A need saved without a count (before #179 asked for one) needs a seat per attendee.
 */
export const transportRows = (allParties) => ['offer', 'need'].flatMap(kind =>
  confirmedParties(allParties)
    .filter(party => transportKindOf(party.transport) === kind)
    .map(party => ({
      id: party.id,
      contact: contactNameOf(party),
      kind,
      seats: Number(party.transport.seats) || (kind === 'need' ? (party.attendees || []).length : 0),
      arrival: party.transport?.arrival || '',
      departure: party.transport?.departure || '',
      departureFsa: party.transport?.departure_fsa || '',
      departurePlace: (party.transport?.departure_place || '').trim()
    })));

/**
 * The music requests and messages to the organisers that aren't blank, each with its party's
 * contact name, the text trimmed but its line breaks kept.
 * @returns {{ music: Array<{id, contact: string, text: string}>, messages: Array<{id, contact: string, text: string}> }}
 */
export const partyComments = (allParties) => {
  const parties = confirmedParties(allParties);
  const texts = field => parties
    .map(party => ({ id: party.id, contact: contactNameOf(party), text: (party[field] || '').trim() }))
    .filter(item => item.text);
  return { music: texts('music_requests'), messages: texts('message_to_organizers') };
};
