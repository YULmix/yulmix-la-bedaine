/**
 * Pricing Engine Test Suite
 * Run with: npm run test:pricing (or `npm test` — this file runs under the default suite)
 * Covers the edge cases from the requirements: zero points, a single adult, fractional
 * new-member discounts, fractional costs, and grandfathering of paid parties.
 */

import {
  DEFAULT_PRICE_RATIOS,
  attendeePrice,
  calculateBreakEvenPrice,
  partyPricingOf,
  priceRatiosOf,
  roundUpToNearestTen,
  simulateEventPricing,
  totalPriceShares
} from './pricingEngine.js';

describe('pricingEngine — simulateEventPricing', () => {
  test('zero points (all kids/after-party) owe nothing', () => {
    // Kids have 0.0 points, so their cost is always 0 regardless of the selling price.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Kid', participation: 'After-Party', isNewMember: false },
          { type: 'Kid', participation: 'Main', isNewMember: false }
        ]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(0, 2);
  });

  test('single adult attending the whole event pays exactly the selling price', () => {
    // Adult Whole = 2.0 pts, price per point = sellingPriceWholeEvent / 2 = 500,
    // cost = 2.0 × 500 = 1000.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [{ type: 'Adult', participation: 'Whole', isNewMember: false }]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(1000, 2);
  });

  test('newbies pay fixed flat point rates (1.075 adult, 0.5375 teen) regardless of tier', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 500.
    // Adult Newbie (Whole Event): 1.075 pts × 500 = 537.50 → rounded up to 538.
    // Teen Newbie (Whole Event): 0.5375 pts × 500 = 268.75 → rounded up to 269.
    // Total = 538 + 269 = 807.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Whole', isNewMember: true },
          { type: 'Teenager', participation: 'Whole', isNewMember: true }
        ]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(807, 2);
  });

  test('fractional selling prices produce fractional costs', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 0.5, cost = 1.075 × 0.5 = 0.5375 → rounded up to 1.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [{ type: 'Adult', participation: 'Main', isNewMember: false }]
      }
    ];

    const result = simulateEventPricing(parties, 1);

    expect(result.calculated_amount_owed).toBeCloseTo(1, 2);
  });

  test('a paid party keeps its historical amount even as other parties are priced normally', () => {
    // Party 1 is paid, so it keeps its historical $750 regardless of the current selling price.
    // Party 2 is unpaid: Adult Main = 1.075 pts, price per point = sellingPriceWholeEvent / 2 = 500,
    // cost = 1.075 × 500 = 537.50 → rounded up to 538.
    // Total = 750 (grandfathered) + 538 (calculated) = 1288.
    const parties = [
      {
        id: 'party-1',
        is_paid: true,
        historical_owed: 750,
        attendees: [{ type: 'Adult', participation: 'Whole', isNewMember: false }]
      },
      {
        id: 'party-2',
        is_paid: false,
        attendees: [{ type: 'Adult', participation: 'Main', isNewMember: false }]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(1288, 2);
  });

  test('teenager attending main event pays 0.5375 pts (updated point system)', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 500.
    // Teen Main = 0.5375 pts, cost = 0.5375 × 500 = 268.75 → rounded up to 269.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [{ type: 'Teenager', participation: 'Main', isNewMember: false }]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(269, 2);
  });

test('newbies attending Main Event pay the same as regular Main Event members', () => {
    // Adult Newbie Main = 1.075 pts (same as Adult Regular Main = 1.075 pts).
    // Teen Newbie Main = 0.5375 pts (same as Teen Regular Main = 0.5375 pts).
    // Price per point = sellingPriceWholeEvent / 2 = 500.
    // Adult: 1.075 × 500 = 537.50 → rounded up to 538.
    // Teen: 0.5375 × 500 = 268.75 → rounded up to 269.
    // Total = 538 + 269 = 807.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Main', isNewMember: true },
          { type: 'Teenager', participation: 'Main', isNewMember: true }
        ]
      }
    ];

    const result = simulateEventPricing(parties, 1000);

    expect(result.calculated_amount_owed).toBeCloseTo(807, 2);
  });
  

  test('mixed party with $160 selling price matches documented scenarios', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 80 (selling price = 160).
    // Regular Adult Whole: 2.0 × 80 = 160.00.
    // Newbie Adult Whole: 1.075 × 80 = 86.00.
    // Regular Teen Main: 0.5375 × 80 = 43.00.
    // Kid: 0.0 × 80 = 0.00.
    // Total = 160 + 86 + 43 + 0 = 289.00.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Whole', isNewMember: false },
          { type: 'Adult', participation: 'Whole', isNewMember: true },
          { type: 'Teenager', participation: 'Main', isNewMember: false },
          { type: 'Kid', participation: 'Whole', isNewMember: false }
        ]
      }
    ];

    const result = simulateEventPricing(parties, 160);

    expect(result.calculated_amount_owed).toBeCloseTo(289, 2);
});
});

describe('pricingEngine — per-event main-event ratio (#109)', () => {
  const ratios = { mainWhole: 0.6 };
  const one = (attendee) => simulateEventPricing([{ id: 'p', attendees: [attendee] }], 200, ratios).calculated_amount_owed;

  test('each tier is a share of the base price; teens pay half the adult price', () => {
    expect(one({ type: 'Adult', participation: 'Whole' })).toBe(200);
    expect(one({ type: 'Adult', participation: 'Main' })).toBe(120); // 0.6 × 200
    expect(one({ type: 'Teenager', participation: 'Whole' })).toBe(100); // 0.5 × 200
    expect(one({ type: 'Teenager', participation: 'Main' })).toBe(60); // 0.5 × 0.6 × 200
    expect(one({ type: 'Kid', participation: 'After-Party' })).toBe(0);
  });

  test('a newbie pays the main-event price of their age, whatever tier they picked', () => {
    for (const participation of ['Whole', 'Main']) {
      expect(one({ type: 'Adult', participation, isNewMember: true })).toBe(120);
      expect(one({ type: 'Teenager', participation, isNewMember: true })).toBe(60);
      expect(one({ type: 'Kid', participation, isNewMember: true })).toBe(0);
    }
  });

  test('reads is_new_member as stored in user_parties.attendees', () => {
    expect(one({ type: 'Adult', participation: 'Whole', is_new_member: true })).toBe(120);
  });

  test('matches calculate_party_amount_owed for a mixed party (same case checked in SQL)', () => {
    const attendees = [
      { type: 'Adult', participation: 'Main' },
      { type: 'Teenager', participation: 'Whole' },
      { type: 'Teenager', participation: 'Main' },
      { type: 'Teenager', participation: 'Whole', is_new_member: true }
    ];
    // 120 + 100 + 60 + 60
    expect(simulateEventPricing([{ id: 'p', attendees }], 200, ratios).calculated_amount_owed).toBe(340);
  });

  test('an exact amount is not rounded up by float noise', () => {
    // 0.5375 × 160 is 86 exactly, but not in binary floating point.
    expect(simulateEventPricing([{ id: 'p', attendees: [{ type: 'Adult', participation: 'Main' }] }], 160).calculated_amount_owed).toBe(86);
  });

  test('priceRatiosOf reads numeric strings and falls back to the defaults', () => {
    expect(priceRatiosOf({ ratio_main_whole: '0.6000' })).toEqual(ratios);
    expect(priceRatiosOf({})).toEqual(DEFAULT_PRICE_RATIOS);
    expect(priceRatiosOf({ ratio_main_whole: 0 })).toEqual(DEFAULT_PRICE_RATIOS);
    expect(priceRatiosOf({ ratio_main_whole: 1.5 })).toEqual(DEFAULT_PRICE_RATIOS);
  });
});

describe('pricingEngine — each attendee rounded up to the dollar (#120)', () => {
  const owed = (attendees, basePrice, ratios) =>
    simulateEventPricing([{ id: 'p', attendees }], basePrice, ratios).calculated_amount_owed;

  test('an attendee\'s price is their share × the base price, rounded up', () => {
    expect(attendeePrice({ type: 'Adult', participation: 'Main' }, 85)).toBe(46); // 45.6875
    expect(attendeePrice({ type: 'Teenager', participation: 'Main' }, 200)).toBe(54); // 53.75
    expect(attendeePrice({ type: 'Kid', participation: 'Whole' }, 200)).toBe(0);
  });

  test('a party owes the sum of its rounded lines, not the rounded sum', () => {
    const adultMain = { type: 'Adult', participation: 'Main' };
    // 108 + 108, where rounding the total would give ceil(215) = 215.
    expect(owed([adultMain, adultMain], 200)).toBe(216);
  });

  test('matches calculate_party_amount_owed for a mixed party whose lines round up (same case checked in SQL)', () => {
    const ratios = { mainWhole: 0.6 };
    const attendees = [
      { type: 'Adult', participation: 'Whole' },
      { type: 'Adult', participation: 'Main' },
      { type: 'Teenager', participation: 'Main' },
      { type: 'Teenager', participation: 'Whole', is_new_member: true },
      { type: 'Kid', participation: 'Whole' }
    ];
    const lines = attendees.map((attendee) => attendeePrice(attendee, 205, ratios));
    expect(lines).toEqual([205, 123, 62, 62, 0]); // teens: 0.3 × 205 = 61.50 → 62
    expect(owed(attendees, 205, ratios)).toBe(452); // the rounded sum would be 451
  });
});

describe('pricingEngine — price locked per registration (#117)', () => {
  const event = { selling_price_whole_event: '250.00', ratio_main_whole: '0.6000' };
  const party = { status: 'registered', locked_selling_price_whole_event: '200.00', locked_ratio_main_whole: '0.5375' };
  const owed = ({ basePrice, ratios }, attendees) =>
    simulateEventPricing([{ id: 'p', attendees }], basePrice, ratios).calculated_amount_owed;

  test('an existing registration keeps its locked price and ratio after the event changes', () => {
    expect(partyPricingOf(party, event)).toEqual({ basePrice: 200, ratios: { mainWhole: 0.5375 } });
    // Adding someone after the price went up to 250 / 60 %: 200 + 0.5375 × 200 = 307.50 → 308.
    expect(owed(partyPricingOf(party, event), [
      { type: 'Adult', participation: 'Whole' },
      { type: 'Adult', participation: 'Main' }
    ])).toBe(308);
  });

  test('a new registration is priced at the event\'s current values', () => {
    expect(partyPricingOf(null, event)).toEqual({ basePrice: 250, ratios: { mainWhole: 0.6 } });
    expect(owed(partyPricingOf(null, event), [{ type: 'Adult', participation: 'Main' }])).toBe(150);
  });

  test('re-registering after a cancellation, or a registration made before any price, uses the current values', () => {
    const current = { basePrice: 250, ratios: { mainWhole: 0.6 } };
    expect(partyPricingOf({ ...party, status: 'cancelled' }, event)).toEqual(current);
    expect(partyPricingOf({ status: 'registered', locked_selling_price_whole_event: null, locked_ratio_main_whole: null }, event)).toEqual(current);
  });
});

describe('pricingEngine — break-even price (#109)', () => {
  test('budget plus contingency over the shares, rounded up to $10', () => {
    // 10 adults whole + 4 adult main at 0.5375 = 12.15 shares. 7000 × 1.2 / 12.15 = 691.36 → 700.
    const attendees = [
      ...Array(10).fill({ type: 'Adult', participation: 'Whole' }),
      ...Array(4).fill({ type: 'Adult', participation: 'Main' })
    ];
    expect(calculateBreakEvenPrice(7000, 20, totalPriceShares(attendees))).toBe(700);
  });

  test('an exact multiple of $10 stays put', () => {
    expect(calculateBreakEvenPrice(1000, 0, 10)).toBe(100);
    expect(roundUpToNearestTen(70.01)).toBe(80);
  });

  test('no budget or nobody paying gives 0', () => {
    expect(calculateBreakEvenPrice(0, 20, 10)).toBe(0);
    expect(calculateBreakEvenPrice(1000, 20, 0)).toBe(0);
  });
});
