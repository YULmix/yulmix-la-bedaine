/**
 * Pricing Engine Test Suite
 * Run with: node src/lib/pricingEngine.test.js
 * Tests 4 edge cases as specified in requirements
 */

import { simulateEventPricing } from './pricingEngine.js';

/**
 * Format amount as CAD currency
 */
const toCAD = (amount) => `${amount.toFixed(2)} $ CAD`;

/**
 * Test runner function
 */
const runTests = () => {
  console.log('🧪 Pricing Engine Test - Edge Cases\n');
  console.log('='.repeat(50));
  
  let passed = 0;
  const testCases = [];
  
  // Edge Case 1: Zero points scenario
  testCases.push({
    description: 'Zero points (all kids/after-party)',
    parties: [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Kid', participation: 'After-Party', isNewMember: false },
          { type: 'Kid', participation: 'Main', isNewMember: false }
        ]
      }
    ],
    totalCost: 1000,
    expectedTotal: 0,
    reason: 'Kids have 0.0 points, so total points = 0, base price per point = 0'
  });
  
  // Edge Case 2: Single adult calculation
  testCases.push({
    description: 'Single adult whole event',
    parties: [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Whole', isNewMember: false }
        ]
      }
    ],
    totalCost: 1000,
    expectedTotal: 1200,
    reason: 'Adult Whole = 2.0 pts, contingency = 1200, price per point = 600, cost = 2.0 × 600 = 1200'
  });
  
  // Edge Case 3: Fractional new members
  testCases.push({
    description: 'Mixed new member discounts',
    parties: [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Whole', isNewMember: true },  // 1.5 pts after adjustment
          { type: 'Teenager', participation: 'Whole', isNewMember: true } // 0.5 pts after adjustment
        ]
      }
    ],
    totalCost: 1000,
    expectedTotal: 560,
    reason: 'Base points: 2.0 + 1.0 = 3.0, contingency = 1200, price per point = 400, ' +
            'Adult: 1.5 × 400 × 0.7 = 420, Teen: 0.5 × 400 × 0.7 = 140, Total = 560'
  });
  
  // Edge Case 4: Nearest-ten rounding boundary
  testCases.push({
    description: 'Rounding up to nearest $10',
    parties: [
      {
        id: 'party-1',
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Main', isNewMember: false } // 1.5 pts
        ]
      }
    ],
    totalCost: 1,
    expectedTotal: 15,
    reason: 'Contingency = 1.2, raw price per point = 1.2 / 1.5 = 0.8, ' +
            'rounded up to $10, cost = 1.5 × 10 = 15'
  });
  
// Edge Case 5: Grandfathering for paid parties
  testCases.push({
    description: 'Paid party preserves historical amount',
    parties: [
      {
        id: 'party-1',
        is_paid: true,
        historical_owed: 750,
        attendees: [
          { type: 'Adult', participation: 'Whole', isNewMember: false }
        ]
      },
      {
        id: 'party-2', 
        is_paid: false,
        attendees: [
          { type: 'Adult', participation: 'Main', isNewMember: false } // 1.5 pts
        ]
      }
    ],
    totalCost: 1000,
    expectedTotal: 1275, // Party1: 750 (grandfathered), Party2: 525 (see calculation below)
    reason: 'Party1 is paid, so uses historical $750. Party2: total points = 2.0 + 1.5 = 3.5, ' +
            'contingency = 1200, raw price per point = 1200/3.5 ≈ 342.86 → rounded up to $350, ' +
            'cost = 1.5 × 350 = 525, Total = 750 + 525 = 1275'
  });
  // Run all test cases
  testCases.forEach((test, index) => {
    console.log(`\n📋 Test Case ${index + 1}: ${test.description}`);
    console.log(`   ${test.reason}`);
    
    const result = simulateEventPricing(test.parties, test.totalCost);
    const formattedResult = toCAD(result.calculated_amount_owed);
    const formattedExpected = toCAD(test.expectedTotal);
    
    // Allow small floating point differences
    const match = Math.abs(result.calculated_amount_owed - test.expectedTotal) < 0.01;
    
    console.log(`   Expected Total: ${formattedExpected}`);
    console.log(`   Calculated Total: ${formattedResult}`);
    
    if (match) {
      console.log(`   ✅ PASS`);
      passed++;
    } else {
      console.log(`   ❌ FAIL`);
      console.log(`   Debug Info:`);
      console.log(`     - Total Points: ${result.totalPoints}`);
      console.log(`     - Base Price per Point: ${toCAD(result.basePricePerPoint)}`);
      console.log(`     - Raw Price per Point: ${toCAD(result.rawPricePerPoint)}`);
      console.log(`     - Contingency Cost: ${toCAD(result.contingencyCost)}`);
    }
  });
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Summary: ${passed}/${testCases.length} tests passed`);
  
  if (passed === testCases.length) {
    console.log('🎉 All tests passed! Pricing engine is working correctly.');
    return 0;
  } else {
    console.log(`⚠️  ${testCases.length - passed} test(s) failed`);
    return 1;
  }
};

// Run tests
try {
  const exitCode = runTests();
  process.exit(exitCode);
} catch (error) {
  console.error('💥 Error running tests:', error);
  process.exit(1);
}