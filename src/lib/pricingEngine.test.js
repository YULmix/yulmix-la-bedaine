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

  test('new members get the main-event point downgrade plus a 30% reduction', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 500.
    // Adult Whole → 1.5 pts (main-event equivalent): 1.5 × 500 × 0.7 = 525.
    // Teen Whole → 0.5 pts (main-event equivalent): 0.5 × 500 × 0.7 = 175.
    // Total = 525 + 175 = 700.
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

    expect(result.calculated_amount_owed).toBeCloseTo(700, 2);
  });

  test('fractional selling prices produce fractional costs', () => {
    // Price per point = sellingPriceWholeEvent / 2 = 0.5, cost = 1.5 × 0.5 = 0.75.
    const parties = [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [{ type: 'Adult', participation: 'Main', isNewMember: false }]
      }
    ];

    const result = simulateEventPricing(parties, 1);

    expect(result.calculated_amount_owed).toBeCloseTo(0.75, 2);
  });

  test('a paid party keeps its historical amount even as other parties are priced normally', () => {
    // Party 1 is paid, so it keeps its historical $750 regardless of the current selling price.
    // Party 2 is unpaid: Adult Main = 1.5 pts, price per point = sellingPriceWholeEvent / 2 = 500,
    // cost = 1.5 × 500 = 750.
    // Total = 750 (grandfathered) + 750 (calculated) = 1500.
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

    expect(result.calculated_amount_owed).toBeCloseTo(1500, 2);
  });
});
