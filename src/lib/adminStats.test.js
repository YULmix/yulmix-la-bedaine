import { computeAdminStats, computePlaceStats, tierOf } from './adminStats';

const parties = [
  {
    id: 'a',
    payment_status: 'paid',
    attendees: [
      { type: 'Adult', participation: 'Whole', sleeping_preference: 'bed', place: { place_id: 'p1', bed_label: 'Ch. 1' }, dietary_needs: ['vegan', 'gluten_free'] },
      { type: 'Kid', participation: 'After-Party', sleeping_preference: 'bed', dietary_needs: ['none'] }
    ]
  },
  {
    id: 'b',
    payment_status: 'unpaid',
    is_waitlisted: true,
    attendees: [{ type: 'Teenager', participation: 'Main', is_new_member: true, sleeping_preference: 'camping', dietary_needs: ['gluten_free'] }]
  }
];

test('tierOf maps type + participation to the tier keys', () => {
  expect(tierOf({ type: 'Adult', participation: 'Main' })).toBe('adult_main');
  expect(tierOf({ type: 'Teenager', participation: 'Whole' })).toBe('teen_whole');
  expect(tierOf({ type: 'Kid', participation: 'After-Party' })).toBe('kids');
});

test('computeAdminStats counts from attendees and splits money by payment status', () => {
  const stats = computeAdminStats(parties, party => (party.id === 'a' ? 360 : 90));
  expect(stats.people).toBe(3);
  expect(stats.parties).toBe(2);
  expect(stats.tiers).toEqual({ adult_whole: 1, adult_main: 0, teen_whole: 0, teen_main: 1, kids: 1 });
  expect(stats.newMembers).toBe(1);
  expect(stats.accommodation).toEqual({ bed: 2, camping: 1 });
  // Each need counts once per attendee; « Aucune restriction » isn't a need.
  expect(stats.dietary).toEqual({ vegan: 1, gluten_free: 2 });
  expect(stats.bedRequests).toBe(2);
  expect(stats.bedsAssigned).toBe(1);
  expect(stats.paidParties).toBe(1);
  expect(stats.waitlistedParties).toBe(1);
  expect(stats.totalDue).toBe(450);
  expect(stats.received).toBe(360);
  expect(stats.outstanding).toBe(90);
});

test('computeAdminStats reads a single dietary value from older data', () => {
  const legacy = [{ id: 'l', attendees: [{ type: 'Adult', participation: 'Whole', dietary_needs: 'vegan' }, { type: 'Adult', participation: 'Whole', dietary_needs: '' }] }];
  expect(computeAdminStats(legacy, () => 0).dietary).toEqual({ vegan: 1 });
});

test('computeAdminStats leaves cancelled parties out of every count and amount', () => {
  const cancelled = {
    id: 'c',
    status: 'cancelled',
    payment_status: 'paid',
    is_waitlisted: true,
    attendees: [{ type: 'Adult', participation: 'Whole', is_new_member: true, sleeping_preference: 'bed', place: { place_id: 'p2', bed_label: 'Ch. 2' }, dietary_needs: 'vegan' }]
  };
  const amountOf = party => ({ a: 360, b: 90, c: 500 }[party.id]);
  expect(computeAdminStats([...parties, cancelled], amountOf)).toEqual(computeAdminStats(parties, amountOf));
  expect(computeAdminStats([cancelled], amountOf)).toMatchObject({ people: 0, parties: 0, totalDue: 0, received: 0, paidParties: 0 });
});

describe('computePlaceStats', () => {
  const places = [
    { id: 'bedA', label: 'Lit A', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
    { id: 'bedB', label: 'Lit B', capacity: 2, locationId: 'l1', locationName: 'Chambre 2' },
    { id: 'sofa', label: 'Canapé', capacity: 1, locationId: 'l2', locationName: 'Salon' }
  ];
  const at = placeId => ({ type: 'Adult', participation: 'Whole', place: { place_id: placeId } });
  const unplaced = { type: 'Adult', participation: 'Whole', place: null };
  const placeParties = [
    { id: 'a', attendees: [at('bedA'), at('bedA'), unplaced] },
    { id: 'b', attendees: [at('sofa'), unplaced] },
    { id: 'w', is_waitlisted: true, attendees: [unplaced, unplaced] },
    { id: 'c', status: 'cancelled', attendees: [unplaced] }
  ];

  test('occupancy per location and per place', () => {
    const { locations } = computePlaceStats(placeParties, places);
    expect(locations.map(({ id, name, capacity, assigned }) => ({ id, name, capacity, assigned }))).toEqual([
      { id: 'l1', name: 'Chambre 2', capacity: 3, assigned: 2 },
      { id: 'l2', name: 'Salon', capacity: 1, assigned: 1 }
    ]);
    expect(locations[0].places.map(place => [place.id, place.assigned])).toEqual([['bedA', 2], ['bedB', 0]]);
  });

  test('unassigned counts attendees without a place, leaving out waitlisted and cancelled parties', () => {
    expect(computePlaceStats(placeParties, places).unassigned).toBe(2);
  });

  test('overbooked lists the places holding more people than their capacity', () => {
    expect(computePlaceStats(placeParties, places).overbooked).toEqual([
      expect.objectContaining({ id: 'bedA', locationName: 'Chambre 2', capacity: 1, assigned: 2 })
    ]);
  });

  test('an event without places has no locations and nothing overbooked', () => {
    expect(computePlaceStats(placeParties, [])).toMatchObject({ locations: [], overbooked: [] });
  });
});
