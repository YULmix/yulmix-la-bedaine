import {
  computeAdminStats,
  computePlaceStats,
  contactNameOf,
  dietaryBreakdown,
  partyComments,
  placeDemandByType,
  tierOf,
  transportRows,
  volunteersByChoice
} from './adminStats';

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

describe('computePlaceStats with unsaved Logistique changes (#166)', () => {
  const places = [
    { id: 'bedA', label: 'Lit A', type: 'bed', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
    { id: 'floor', label: 'Matelas', type: 'floor', capacity: 2, locationId: 'l1', locationName: 'Chambre 2' }
  ];
  const parties = [
    { id: 'a', attendees: [{ id: 'a1', place: { place_id: 'bedA' } }, { id: 'a2', place: null }] },
    { id: 'b', attendees: [{ id: 'b1', place: null }] }
  ];
  const totals = stats => ({
    placed: stats.locations.reduce((sum, l) => sum + l.assigned, 0),
    unassigned: stats.unassigned,
    overbooked: stats.overbooked.map(place => place.id)
  });

  test('a pending move counts where it goes, and a pending unassignment counts as to place', () => {
    expect(totals(computePlaceStats(parties, places))).toEqual({ placed: 1, unassigned: 2, overbooked: [] });
    expect(totals(computePlaceStats(parties, places, { b: { places: { b1: 'bedA' } } })))
      .toEqual({ placed: 2, unassigned: 1, overbooked: ['bedA'] });
    expect(totals(computePlaceStats(parties, places, { a: { places: { a1: null } } })))
      .toEqual({ placed: 0, unassigned: 3, overbooked: [] });
  });
});

describe('placeDemandByType (#166)', () => {
  // The event's places after its overrides (flattenPlaces()): an excluded place is simply absent.
  const places = [
    { id: 'bedA', type: 'bed', capacity: 1 },
    { id: 'bedB', type: 'bed', capacity: 2 },
    { id: 'tent', type: 'camping', capacity: 4 }
  ];
  const wants = sleeping_preference => ({ sleeping_preference });
  const parties = [
    { id: 'a', attendees: [wants('bed'), wants('bed'), wants('floor')] },
    { id: 'b', attendees: [wants(''), wants('bed')] },
    { id: 'w', is_waitlisted: true, attendees: [wants('bed')] },
    { id: 'c', status: 'cancelled', attendees: [wants('sofa')] }
  ];

  test('requests of active, non-waitlisted attendees against the capacity of each type, in option order', () => {
    expect(placeDemandByType(parties, places).types).toEqual([
      { type: 'camping', requested: 0, capacity: 4 },
      { type: 'floor', requested: 1, capacity: 0 },
      { type: 'bed', requested: 3, capacity: 3 }
    ]);
  });

  test('a type with neither requests nor places is left out; an excluded place no longer counts', () => {
    const withoutTent = places.filter(place => place.id !== 'tent');
    expect(placeDemandByType(parties, withoutTent).types.map(row => row.type)).toEqual(['floor', 'bed']);
  });

  test('a blank preference counts as « Sans préférence », so the rows add up to the people', () => {
    const { types, noPreference } = placeDemandByType(parties, places);
    expect(noPreference).toBe(1);
    expect(types.reduce((sum, row) => sum + row.requested, 0) + noPreference).toBe(5);
  });
});

describe('the Logistique views of the form\'s answers (#179)', () => {
  const profile = (full_name, email) => ({ profiles: { full_name, email } });
  const formParties = [
    {
      id: 'a',
      ...profile('Alice Martin', 'alice@test.local'),
      attendees: [
        { id: 'a1', name: 'Alice', dietary_needs: ['vegan', 'gluten_free'] },
        { id: 'a2', name: 'Léo', dietary_needs: ['other'], dietary_other: '  Arachides  ' },
        { id: 'a3', name: 'Tom', dietary_needs: ['none'] }
      ],
      logistics: { volunteering: ['cook_meal', 'other'], volunteering_other: 'Jongler' },
      transport: { type: 'need', seats: 2, arrival: '2026-07-10T18:00', departure: '' },
      music_requests: 'Daft Punk\nJustice',
      message_to_organizers: '   '
    },
    {
      id: 'b',
      ...profile('', 'bob@test.local'),
      attendees: [{ id: 'b1', name: 'Bob', dietary_needs: 'vegan' }, { id: 'b2', name: 'Bébé', dietary_needs: [] }],
      logistics: { volunteering: ['cook_meal'] },
      transport: { type: 'offer', seats: 3, arrival: '2026-07-10T17:00', departure: '2026-07-12T15:00', departure_fsa: 'H2G', departure_place: ' Montréal (Rosemont) ' },
      music_requests: '',
      message_to_organizers: 'Merci!'
    },
    { id: 'c', ...profile('Carla', 'c@test.local'), attendees: [{ id: 'c1', name: 'Carla' }], transport: { type: 'None' } },
    { id: 'd', ...profile('Dan', 'd@test.local'), attendees: [], transport: { type: '' }, logistics: null },
    // A need saved before needs had a count: a seat per attendee.
    { id: 'e', ...profile('Eve', 'e@test.local'), attendees: [{ id: 'e1', name: 'Eve' }, { id: 'e2', name: 'Ève fils' }], transport: { type: 'need', seats: 0 } },
    {
      id: 'w',
      is_waitlisted: true,
      ...profile('Wanda', 'w@test.local'),
      attendees: [{ id: 'w1', name: 'Wanda', dietary_needs: ['vegan'] }],
      logistics: { volunteering: ['parking'] },
      transport: { type: 'offer', seats: 2 },
      music_requests: 'Waitlisted song'
    },
    {
      id: 'x',
      status: 'cancelled',
      ...profile('Xavier', 'x@test.local'),
      attendees: [{ id: 'x1', name: 'Xavier', dietary_needs: ['dairy_free'] }],
      logistics: { volunteering: ['pharmacy'] },
      transport: { type: 'need' },
      message_to_organizers: 'Cancelled message'
    }
  ];

  test('the contact is the member\'s name, else their email', () => {
    expect(contactNameOf(formParties[0])).toBe('Alice Martin');
    expect(contactNameOf(formParties[1])).toBe('bob@test.local');
    expect(contactNameOf({})).toBe('');
  });

  test('dietaryBreakdown: real needs only, in option order, a multi-need attendee under each, « Autre » with its text', () => {
    expect(dietaryBreakdown(formParties)).toEqual([
      { need: 'vegan', attendees: [{ id: 'a1', name: 'Alice', other: '' }, { id: 'b1', name: 'Bob', other: '' }] },
      { need: 'gluten_free', attendees: [{ id: 'a1', name: 'Alice', other: '' }] },
      { need: 'other', attendees: [{ id: 'a2', name: 'Léo', other: 'Arachides' }] }
    ]);
  });

  test('dietaryBreakdown is empty when nobody has a need', () => {
    expect(dietaryBreakdown([formParties[2], formParties[3]])).toEqual([]);
    expect(dietaryBreakdown([])).toEqual([]);
  });

  test('volunteersByChoice lists every choice in order, gaps included, and the party\'s « Autre » text', () => {
    const rows = volunteersByChoice(formParties);
    expect(rows.map(row => row.choice)).toEqual([
      'food_purchase', 'cook_meal', 'dj_afternoon', 'dj_evening', 'setup_friday', 'cleanup_sunday',
      'neighbor_management', 'parking', 'art_initiative', 'pharmacy', 'other'
    ]);
    const byChoice = Object.fromEntries(rows.map(row => [row.choice, row.parties]));
    expect(byChoice.cook_meal).toEqual([
      { id: 'a', contact: 'Alice Martin', other: '' },
      { id: 'b', contact: 'bob@test.local', other: '' }
    ]);
    expect(byChoice.other).toEqual([{ id: 'a', contact: 'Alice Martin', other: 'Jongler' }]);
    // Waitlisted (parking) and cancelled (pharmacy) parties aren't counted.
    expect(byChoice.parking).toEqual([]);
    expect(byChoice.pharmacy).toEqual([]);
    expect(byChoice.food_purchase).toEqual([]);
  });

  test('transportRows: offers, then needs, with the seats offered or needed; no lift (\'None\', \'\') isn\'t listed', () => {
    expect(transportRows(formParties)).toEqual([
      { id: 'b', contact: 'bob@test.local', kind: 'offer', seats: 3, arrival: '2026-07-10T17:00', departure: '2026-07-12T15:00', departureFsa: 'H2G', departurePlace: 'Montréal (Rosemont)' },
      { id: 'a', contact: 'Alice Martin', kind: 'need', seats: 2, arrival: '2026-07-10T18:00', departure: '', departureFsa: '', departurePlace: '' },
      { id: 'e', contact: 'Eve', kind: 'need', seats: 2, arrival: '', departure: '', departureFsa: '', departurePlace: '' }
    ]);
    expect(transportRows([formParties[2], formParties[3]])).toEqual([]);
  });

  test('partyComments keeps non-blank texts, line breaks included, of confirmed parties', () => {
    expect(partyComments(formParties)).toEqual({
      music: [{ id: 'a', contact: 'Alice Martin', text: 'Daft Punk\nJustice' }],
      messages: [{ id: 'b', contact: 'bob@test.local', text: 'Merci!' }]
    });
    expect(partyComments([formParties[2]])).toEqual({ music: [], messages: [] });
  });
});
