import { flattenPlaces, overrideWrite, placeOccupancy, venueTotals, placeOptions, searchPlaceOptions } from './places';

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

test('flattenPlaces lists places by location order, then place order', () => {
  expect(flattenPlaces(locations).map(p => [p.id, p.locationId, p.locationName])).toEqual([
    ['bedA', 'l1', 'Chambre 2'], ['bedB', 'l1', 'Chambre 2'], ['sofa', 'l2', 'Salon']
  ]);
});

test('flattenPlaces leaves out the places the event excludes and uses its capacities', () => {
  const overrides = [
    { place_id: 'bedB', is_excluded: true, capacity: null },
    { place_id: 'sofa', is_excluded: false, capacity: 4 }
  ];
  expect(flattenPlaces(locations, overrides).map(p => [p.id, p.capacity])).toEqual([['bedA', 1], ['sofa', 4]]);
});

test('venueTotals counts locations, places and capacity', () => {
  expect(venueTotals(locations)).toEqual({ locations: 2, places: 3, capacity: 4 });
  expect(venueTotals([])).toEqual({ locations: 0, places: 0, capacity: 0 });
  expect(venueTotals([{ places: [] }])).toEqual({ locations: 1, places: 0, capacity: 0 });
});

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
  const places = flattenPlaces(locations);
  const occupancy = new Map([['bedA', 1]]);
  expect(placeOptions(places, occupancy, { preference: 'sofa' }).map(o => [o.place.id, o.remaining, o.full]))
    .toEqual([['sofa', 2, false], ['bedB', 1, false], ['bedA', 0, true]]);
});

test("placeOptions: the attendee's own place doesn't count against them", () => {
  const places = flattenPlaces(locations);
  const occupancy = new Map([['bedA', 1]]);
  const [first] = placeOptions(places, occupancy, { preference: 'bed', currentPlaceId: 'bedA' });
  expect([first.place.id, first.remaining, first.full]).toEqual(['bedA', 1, false]);
});

test('searchPlaceOptions matches location, place or type, ignoring case and accents', () => {
  const options = placeOptions(flattenPlaces(locations), new Map(), {});
  const ids = (query) => searchPlaceOptions(options, query).map(o => o.place.id);
  expect(ids('')).toEqual(['bedA', 'bedB', 'sofa']);
  expect(ids('canape')).toEqual(['sofa']);
  expect(ids('CHAMBRE 2 lit b')).toEqual(['bedB']);
  expect(ids('sofa')).toEqual(['sofa']); // the type's French label
  expect(ids('lit')).toEqual(['bedA', 'bedB']);
});

describe('overrideWrite', () => {
  const bed = { id: 'bed', capacity: 2 };

  test('excluding a place with no override inserts one', () => {
    expect(overrideWrite(bed, null, { is_excluded: true })).toEqual({ op: 'upsert', row: { is_excluded: true, capacity: null } });
  });

  test('a capacity for this event is stored, and back to the venue\'s it goes away', () => {
    expect(overrideWrite(bed, null, { capacity: 3 })).toEqual({ op: 'upsert', row: { is_excluded: false, capacity: 3 } });
    expect(overrideWrite(bed, { is_excluded: false, capacity: 3 }, { capacity: 2 })).toEqual({ op: 'delete' });
    expect(overrideWrite(bed, null, { capacity: 2 })).toEqual({ op: 'none' });
  });

  test('including a place again keeps its capacity for this event', () => {
    expect(overrideWrite(bed, { is_excluded: true, capacity: 3 }, { is_excluded: false }))
      .toEqual({ op: 'upsert', row: { is_excluded: false, capacity: 3 } });
    expect(overrideWrite(bed, { is_excluded: true, capacity: null }, { is_excluded: false })).toEqual({ op: 'delete' });
  });
});
