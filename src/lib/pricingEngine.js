/**
 * Pricing Engine for Bedaine Event Cost Calculation
 * 
 * Business Rules:
 * 1. Points per attendee (Regular Members):
 *    - Adult (Whole Event): 2.0 pts
 *    - Adult (Main Event): 1.075 pts  
 *    - Teenager (Whole Event): 1.0 pt
 *    - Teenager (Main Event): 0.5375 pts
 *    - Kids / After-Party: 0.0 pts
 * 
 * 2. Price per point baseline:
 *    - Unit price per point = events.selling_price_whole_event / 2.0
 *    - Adult Whole (2.0 pts) pays exactly selling_price_whole_event
 * 
 * 3. Newbie Fixed Point Weights (Tier Ignored):
 *    - Adult Newbie (any tier): 1.075 pts (same as Adult Main Event)
 *    - Teen Newbie (any tier): 0.5375 pts (same as Teen Main Event)
 *    - Kid Newbie: 0.0 pts (free, same as regular kids)
 *    - Note: Newbies always pay Main Event rate regardless of attendance tier
 * 
 * 4. Grandfathering: Paid parties preserve historical calculated_amount_owed
 */

/**
 * Calculate base points by age type and participation level
 * @param {string} type - 'Adult', 'Teenager', 'Kid'
 * @param {string} participation - 'Whole', 'Main', 'After-Party'
 * @returns {number} Points value
 */
export const calculateBasePoints = (type, participation) => {
  if (type === 'Adult') {
    return participation === 'Whole' ? 2.0 : 1.075;
  }
  if (type === 'Teenager') {
    return participation === 'Whole' ? 1.0 : 0.5375;
  }
  return 0.0;
};

/**
 * Round amount UP to the nearest multiple of 10 CAD
 * @param {number} amount - Amount in CAD
 * @returns {number} Rounded amount
 */
export const roundUpToNearestTen = (amount) => {
  return Math.ceil(amount / 10) * 10;
};

/**
 * Calculate price per point with contingency (for internal cost estimation)
 * @param {number} totalCost - Total event cost in CAD
 * @param {number} totalPoints - Sum of all attendee points
 * @returns {number} Base price per point (rounded up to nearest $10)
 */
export const calculatePricePerPointFromTotalCost = (totalCost, totalPoints) => {
  if (!Number.isFinite(totalCost) || totalCost <= 0) return 0;
  if (totalPoints === 0) return 0;
  
  const contingencyCost = totalCost * 1.2;
  const rawPricePerPoint = contingencyCost / totalPoints;
  return roundUpToNearestTen(rawPricePerPoint);
};

/**
 * Calculate price per point from selling price baseline
 * @param {number} sellingPriceWholeEvent - Selling price for adult whole event in CAD
 * @returns {number} Price per point (sellingPriceWholeEvent / 2.0)
 */
export const calculatePricePerPointFromSellingPrice = (sellingPriceWholeEvent) => {
  if (!Number.isFinite(sellingPriceWholeEvent) || sellingPriceWholeEvent <= 0) return 0;
  return sellingPriceWholeEvent / 2.0;
};

/**
 * Get final points for an attendee (with new member adjustment)
 * @param {Object} attendee - Attendee object
 * @param {string} attendee.type - 'Adult', 'Teenager', 'Kid'
 * @param {string} attendee.participation - 'Whole', 'Main', 'After-Party'
 * @param {boolean} attendee.isNewMember - Whether attendee is a new member
 * @returns {number} Adjusted points
 */
export const getFinalPoints = (attendee) => {
  // Newbies pay fixed flat rates regardless of tier (always Main Event rate)
  if (attendee.isNewMember) {
    if (attendee.type === 'Adult') {
      return 1.075; // Fixed newbie rate (same as Adult Main Event)
    }
    if (attendee.type === 'Teenager') {
      return 0.5375; // Fixed newbie rate (same as Teen Main Event)
    }
    // Kids remain 0.0
    return 0.0;
  }
  
  // Regular members use standard point weights
  return calculateBasePoints(attendee.type, attendee.participation);
};

/**
 * Calculate total points across all attendees (ignoring new member status)
 * @param {Array} attendeeParties - Array of party objects
 * @returns {number} Total base points
 */
export const calculateTotalPoints = (attendeeParties) => {
  return attendeeParties.reduce((sum, party) => {
    return sum + party.attendees.reduce((partySum, attendee) => {
      return partySum + calculateBasePoints(attendee.type, attendee.participation);
    }, 0);
  }, 0);
};

/**
 * Simulate event pricing calculation based on selling price
 * @param {Array} attendeeParties - Array of party objects
 * @param {number} sellingPriceWholeEvent - Selling price for adult whole event in CAD
 * @param {number|null} priceOverride - Optional override for base price per point
 * @returns {Object} Pricing simulation results
 */
export const simulateEventPricing = (attendeeParties, sellingPriceWholeEvent, priceOverride = null) => {
  // Sum all base points (ignoring isNewMember status)
  const totalPoints = calculateTotalPoints(attendeeParties);
  
  // Calculate or use override for base price per point
  const basePricePerPoint = priceOverride !== null 
    ? priceOverride 
    : calculatePricePerPointFromSellingPrice(sellingPriceWholeEvent);
  
  // Calculate total owed amount
  let calculated_amount_owed = 0;
  
  // Process each party
  const processedParties = attendeeParties.map(party => {
    let partyTotal = 0;
    let processedAttendees = [];
    
    // Grandfathering: preserve historical amount for paid parties
    if (party.is_paid) {
      partyTotal = party.historical_owed || 0;
    } else {
      // Calculate cost for each attendee in the party
      processedAttendees = party.attendees.map(attendee => {
        const points = getFinalPoints(attendee);
        const cost = points * basePricePerPoint;
        // No additional discount - newbie point weights already reflect the discount
        
        return {
          ...attendee,
          basePoints: calculateBasePoints(attendee.type, attendee.participation),
          finalPoints: points,
          calculated_cost: cost
        };
      });
      
      // Sum costs for all attendees in this party
      partyTotal = processedAttendees.reduce((sum, attendee) => sum + attendee.calculated_cost, 0);
      // Round up to nearest dollar
      partyTotal = Math.ceil(partyTotal);
    }
    
    // Add party total to overall total
    calculated_amount_owed += partyTotal;
    
    // Return party object with calculated data
    return {
      ...party,
      attendees: processedAttendees.length > 0 ? processedAttendees : party.attendees,
      party_total: partyTotal
    };
  });
  
  return {
    totalPoints,
    basePricePerPoint,
    calculated_amount_owed,
    parties: processedParties,
    sellingPriceWholeEvent,
    pricePerPoint: basePricePerPoint
  };
};

/**
 * Calculate estimated cost per participant (excluding kids)
 * @param {number} totalCost - Total event cost in CAD
 * @param {Array} parties - Array of user_parties objects with counts JSONB
 * @returns {number} Estimated cost per participant (excluding kids)
 */
export const calculateEstimatedCostPerParticipant = (totalCost, parties) => {
  if (!Array.isArray(parties) || parties.length === 0) return 0;
  
  let totalParticipants = 0;
  parties.forEach(party => {
    const counts = party.counts || {};
    totalParticipants += (counts.adult_whole || 0) + (counts.adult_main || 0) + (counts.teen_whole || 0) + (counts.teen_main || 0);
  });
  
  if (totalParticipants === 0) return 0;
  return totalCost / totalParticipants;
};
// Export all functions
export default {
  calculateBasePoints,
  roundUpToNearestTen,
  calculatePricePerPointFromTotalCost,
  calculatePricePerPointFromSellingPrice,
  getFinalPoints,
  calculateTotalPoints,
  simulateEventPricing,
  calculateEstimatedCostPerParticipant
};