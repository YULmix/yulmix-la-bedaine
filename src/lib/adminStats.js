import { PAYMENT_STATUS, isActiveRegistration } from './registrationOptions.js';

// Aggregates for the admin overview, derived from each party's attendees array rather than
// user_parties.counts, which the counts trigger leaves at zero (see docs/03-data-model.md, #41).

const TIERS = ['adult_whole', 'adult_main', 'teen_whole', 'teen_main', 'kids'];

export const tierOf = (attendee) => {
  if (attendee.type === 'Kid') return 'kids';
  const age = attendee.type === 'Teenager' ? 'teen' : 'adult';
  return `${age}_${attendee.participation === 'Main' ? 'main' : 'whole'}`;
};

/**
 * @param {Array} parties user_parties rows (with attendees). Cancelled ones are skipped: there
 *   are no refunds, so a cancelled party owes nothing and counts for nothing (#101).
 * @param {(party) => number} amountOf the party's amount owed (rounded, grandfathered)
 */
export const computeAdminStats = (allParties, amountOf) => {
  const parties = allParties.filter(isActiveRegistration);
  const tiers = Object.fromEntries(TIERS.map(tier => [tier, 0]));
  const accommodation = {};
  const dietary = {};
  let people = 0;
  let newMembers = 0;
  let bedRequests = 0;
  let bedsAssigned = 0;
  let paidParties = 0;
  let waitlistedParties = 0;
  let totalDue = 0;
  let received = 0;

  parties.forEach(party => {
    const amount = amountOf(party);
    totalDue += amount;
    if (party.payment_status === PAYMENT_STATUS.PAID) {
      paidParties += 1;
      received += amount;
    }
    if (party.is_waitlisted) waitlistedParties += 1;
    (party.attendees || []).forEach(attendee => {
      people += 1;
      tiers[tierOf(attendee)] += 1;
      if (attendee.is_new_member) newMembers += 1;
      if (attendee.sleeping_preference) accommodation[attendee.sleeping_preference] = (accommodation[attendee.sleeping_preference] || 0) + 1;
      if (attendee.sleeping_preference === 'bed') bedRequests += 1;
      if (attendee.assigned_bed) bedsAssigned += 1;
      if (attendee.dietary_needs && attendee.dietary_needs !== 'none') dietary[attendee.dietary_needs] = (dietary[attendee.dietary_needs] || 0) + 1;
    });
  });

  return {
    people,
    parties: parties.length,
    tiers,
    newMembers,
    accommodation,
    dietary,
    bedRequests,
    bedsAssigned,
    paidParties,
    waitlistedParties,
    totalDue,
    received,
    outstanding: totalDue - received
  };
};
