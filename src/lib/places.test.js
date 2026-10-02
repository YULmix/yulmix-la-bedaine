import { venueLayoutOf, placeOccupancy, placeTypeBreakdown, venueTotals, placeOptions, searchPlaceOptions, sleepingByLocation } from './places';

const locations = [
  {
    id: 'l2', name: 'Salon', sort_order: 1,
    places: [{ id: 'sofa', label: 'Canapé', type: 'sofa', capacity: 2, sort_order: 0 }]
  },
  {
    id: 'l1', name: 'Chambre 2', sort_order: 0,
    places: [
      { id: 'bedB', label: 'Lit B', type: 'bed', capacity: 1, sort_order: 1 },
      { id: 'bedA', label: 'Lit A', type: 'bed', capacity: 1, sort_order: 0 }
    ]
  }
];

test('venueLayoutOf groups venue_layout rows into locations and their places, in the order given', () => {
  const row = (location, place, n) => ({
    location_id: location, location_name: `Lieu ${location}`, location_note: null, location_sort_order: n,
    place_id: place, label: place && `Place ${place}`, type: place && 'bed', capacity: place && 1, place_sort_order: place && n
  });
  const layout = venueLayoutOf([row('l1', 'p1', 0), row('l1', 'p2', 1), row('l2', 'p3', 0), row('l3', null, 2)]);
  expect(layout.map(location => [location.id, location.places.map(place => place.id)])).toEqual([
    ['l1', ['p1', 'p2']], ['l2', ['p3']], ['l3', []]
  ]);
  expect(layout[0]).toMatchObject({ name: 'Lieu l1', note: null, sort_order: 0 });
  expect(layout[0].places[1]).toEqual({ id: 'p2', label: 'Place p2', type: 'bed', capacity: 1, sort_order: 1 });
  expect(venueLayoutOf([])).toEqual([]);
});

test('venueTotals counts locations, places and capacity', () => {
  expect(venueTotals(locations)).toEqual({ locations: 2, places: 3, capacity: 4 });
  expect(venueTotals([])).toEqual({ locations: 0, places: 0, capacity: 0 });
  expect(venueTotals([{ places: [] }])).toEqual({ locations: 1, places: 0, capacity: 0 });
});

test('placeTypeBreakdown counts places and capacity per type, in option order, leaving out empty types', () => {
  // 3 beds (1, 1, 2) and a sofa for 2: the example in #164.
  const house = [...locations, { places: [{ type: 'bed', capacity: 2 }] }];
  expect(placeTypeBreakdown(house)).toEqual([
    { type: 'bed', places: 3, capacity: 4 },
    { type: 'sofa', places: 1, capacity: 2 }
  ]);
  const mixed = [
    { places: [{ type: 'outside_other', capacity: 1 }, { type: 'camping', capacity: 4 }] },
    { places: [{ type: 'floor', capacity: 3 }, { type: 'camping', capacity: 2 }] }
  ];
  expect(placeTypeBreakdown(mixed).map(row => row.type)).toEqual(['camping', 'floor', 'outside_other']);
  expect(placeTypeBreakdown([])).toEqual([]);
  expect(placeTypeBreakdown([{ places: [] }])).toEqual([]);
});

test('placeTypeBreakdown adds up to the venue totals', () => {
  const mixed = [
    ...locations,
    { places: [{ type: 'camping', capacity: 4 }, { type: 'floor', capacity: 3 }, { type: 'outside_other', capacity: 1 }] }
  ];
  const rows = placeTypeBreakdown(mixed);
  const totals = venueTotals(mixed);
  expect(rows.reduce((sum, row) => sum + row.places, 0)).toBe(totals.places);
  expect(rows.reduce((sum, row) => sum + row.capacity, 0)).toBe(totals.capacity);
});

// An event's places in display order, as the event places module gives them (eventPlaces.js).
const eventPlaces = [
  { id: 'bedA', label: 'Lit A', type: 'bed', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
  { id: 'bedB', label: 'Lit B', type: 'bed', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
  { id: 'sofa', label: 'Canapé', type: 'sofa', capacity: 2, locationId: 'l2', locationName: 'Salon' }
];

test('placeOccupancy counts saved places, overridden by unsaved changes', () => {
  const parties = [
    { id: 'p1', attendees: [{ id: 'a1', place: { place_id: 'bedA' } }, { id: 'a2', place: { place_id: 'sofa' } }] },
    { id: 'p2', attendees: [{ id: 'a3', place: null }, { id: 'a4', place: { place_id: 'sofa' } }] }
  ];
  // p1's second attendee moved off the sofa, p2's first one put on it.
  const changes = { p1: { places: { a2: null } }, p2: { places: { a3: 'sofa' } } };
  expect(placeOccupancy(parties, changes)).toEqual(new Map([['bedA', 1], ['sofa', 2]]));
});

test('placeOptions: open places matching the preference first, other open places, then full ones', () => {
  const occupancy = new Map([['bedA', 1]]);
  expect(placeOptions(eventPlaces, occupancy, { preference: 'sofa' }).map(o => [o.place.id, o.remaining, o.full]))
    .toEqual([['sofa', 2, false], ['bedB', 1, false], ['bedA', 0, true]]);
});

test("placeOptions: the attendee's own place doesn't count against them", () => {
  const occupancy = new Map([['bedA', 1]]);
  const [first] = placeOptions(eventPlaces, occupancy, { preference: 'bed', currentPlaceId: 'bedA' });
  expect([first.place.id, first.remaining, first.full]).toEqual(['bedA', 1, false]);
});

test('searchPlaceOptions matches location, place or type, ignoring case and accents', () => {
  const options = placeOptions(eventPlaces, new Map(), {});
  const ids = (query) => searchPlaceOptions(options, query).map(o => o.place.id);
  expect(ids('')).toEqual(['bedA', 'bedB', 'sofa']);
  expect(ids('canape')).toEqual(['sofa']);
  expect(ids('CHAMBRE 2 lit b')).toEqual(['bedB']);
  expect(ids('sofa')).toEqual(['sofa']); // the type's French label
  expect(ids('lit')).toEqual(['bedA', 'bedB']);
});

describe('sleepingByLocation', () => {
  const at = (locationId, locationName, placeLabel) => ({
    location_id: locationId, location_name: locationName, place_label: placeLabel
  });

  test('one entry per location, with who sleeps where, in the attendees\' order', () => {
    expect(sleepingByLocation([
      { name: 'Alice', place: at('l1', 'Grenier', 'Lit 1') },
      { name: 'Chloé', place: at('l2', 'Salon', 'Sofa') },
      { name: 'Bob', place: at('l1', 'Grenier', 'Lit 2') }
    ])).toEqual([
      { locationId: 'l1', name: 'Grenier', sleepers: [{ name: 'Alice', place: 'Lit 1' }, { name: 'Bob', place: 'Lit 2' }] },
      { locationId: 'l2', name: 'Salon', sleepers: [{ name: 'Chloé', place: 'Sofa' }] }
    ]);
  });

  test('attendees without a place are left out; a party with none gives nothing', () => {
    expect(sleepingByLocation([{ name: 'Alice', place: null }, { name: 'Bob', place: at('l1', 'Grenier', 'Lit 1') }]))
      .toEqual([{ locationId: 'l1', name: 'Grenier', sleepers: [{ name: 'Bob', place: 'Lit 1' }] }]);
    expect(sleepingByLocation([{ name: 'Alice', place: null }])).toEqual([]);
    expect(sleepingByLocation(undefined)).toEqual([]);
  });
});
