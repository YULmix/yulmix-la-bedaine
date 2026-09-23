/**
 * Pricing Engine Test Suite
 * Run with: npm run test:pricing (or `npm test` — this file runs under the default suite)
 * Covers the edge cases from the requirements: zero points, a single adult, fractional
 * new-member discounts, fractional costs, and grandfathering of paid parties.
 */

import { simulateEventPricing } from './pricingEngine.js';

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
