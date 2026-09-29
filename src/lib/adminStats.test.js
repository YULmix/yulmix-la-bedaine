import { computeAdminStats, tierOf } from './adminStats';

const parties = [
  {
    id: 'a',
    payment_status: 'paid',
    attendees: [
      { type: 'Adult', participation: 'Whole', sleeping_preference: 'bed', place: { place_id: 'p1', bed_label: 'Ch. 1' }, dietary_needs: 'vegan' },
      { type: 'Kid', participation: 'After-Party', sleeping_preference: 'bed', dietary_needs: 'none' }
    ]
  },
  {
    id: 'b',
    payment_status: 'unpaid',
    is_waitlisted: true,
    attendees: [{ type: 'Teenager', participation: 'Main', is_new_member: true, sleeping_preference: 'camping' }]
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
  expect(stats.dietary).toEqual({ vegan: 1 });
  expect(stats.bedRequests).toBe(2);
  expect(stats.bedsAssigned).toBe(1);
  expect(stats.paidParties).toBe(1);
  expect(stats.waitlistedParties).toBe(1);
  expect(stats.totalDue).toBe(450);
  expect(stats.received).toBe(360);
  expect(stats.outstanding).toBe(90);
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
