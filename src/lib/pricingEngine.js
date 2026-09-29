/**
 * Pricing engine for La Bédaine.
 *
 * Every price is a share of the base price, the adult whole-weekend price
 * (events.selling_price_whole_event). The main-event share is set per event (#109); teens always
 * pay half the adult price:
 *   - adult whole  = 1
 *   - adult main   = ratio_main_whole
 *   - teen whole   = TEEN_SHARE
 *   - teen main    = TEEN_SHARE × ratio_main_whole
 *   - newbie       = the main-event share of their age, whatever tier they picked
 *   - kid          = 0 (free)
 * Each attendee pays their share × the base price, rounded up to the dollar, and a party owes the
 * sum of those rounded prices (#120).
 * Paid parties keep the amount they paid (grandfathering).
 * A registration is priced at the base price and ratio locked when it was made (#117), not the
 * event's current ones: see partyPricingOf.
 *
 * The database computes the authoritative amount (private.party_amount_owed); this module is the
 * live estimate shown in the UI and the admin simulator. The two must agree.
 */

// The main-event share before it became a per-event setting: 1.075 / 2.0 points.
export const DEFAULT_PRICE_RATIOS = Object.freeze({ mainWhole: 0.5375 });

// Teens pay half the adult price of the same tier. Fixed, also in private.party_amount_owed.
export const TEEN_SHARE = 0.5;

const toRatio = (value, fallback) => {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : fallback;
};

/** An event row's ratios (numeric columns come back from PostgREST as strings or numbers). */
export const priceRatiosOf = (event) => ({
  mainWhole: toRatio(event?.ratio_main_whole, DEFAULT_PRICE_RATIOS.mainWhole)
});

/**
 * The base price and ratios a registration is priced at (#117): the ones the database locked on
 * it when it was made, or the event's current ones for a new registration, one re-registering
 * after a cancellation, or one made before the event had a price. Mirrors
 * enforce_calculated_amount_owed.
 * @param {object|null} party - A user_parties row, or null for a new registration
 * @param {object} event - The events row
 * @returns {{ basePrice: number, ratios: { mainWhole: number } }}
 */
export const partyPricingOf = (party, event) => {
  const locked = party && party.status !== 'cancelled' && Number(party.locked_selling_price_whole_event) > 0;
  if (locked) {
    return {
      basePrice: Number(party.locked_selling_price_whole_event),
      ratios: { mainWhole: toRatio(party.locked_ratio_main_whole, DEFAULT_PRICE_RATIOS.mainWhole) }
    };
  }
  return { basePrice: Number(event?.selling_price_whole_event) || 0, ratios: priceRatiosOf(event) };
};

/**
 * An attendee's price as a share of the base price.
 * @param {{ type: string, participation?: string, isNewMember?: boolean, is_new_member?: boolean }} attendee
 * @param {{ mainWhole: number }} ratios
 */
export const getPriceShare = (attendee, ratios = DEFAULT_PRICE_RATIOS) => {
  const { type } = attendee;
  if (type !== 'Adult' && type !== 'Teenager') return 0;
  const isNewMember = attendee.isNewMember ?? attendee.is_new_member ?? false;
  const tierShare = !isNewMember && attendee.participation === 'Whole' ? 1 : ratios.mainWhole;
  return type === 'Teenager' ? tierShare * TEEN_SHARE : tierShare;
};

/** Sum of the attendees' price shares: how many base prices they pay between them. */
export const totalPriceShares = (attendees, ratios = DEFAULT_PRICE_RATIOS) =>
  attendees.reduce((sum, attendee) => sum + getPriceShare(attendee, ratios), 0);

// Rounds away float noise (0.1 + 0.2) before rounding up, so an exact amount isn't bumped a dollar.
const ceilDollars = (amount) => Math.ceil(Number(amount.toFixed(6)));

/**
 * What one attendee pays, rounded up to the dollar. The one place an attendee's price is rounded:
 * a party owes the sum of these (#120), and every per-attendee price in the UI is this value.
 */
export const attendeePrice = (attendee, basePrice, ratios = DEFAULT_PRICE_RATIOS) => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  return ceilDollars(getPriceShare(attendee, ratios) * basePrice);
};

/**
 * Round amount UP to the nearest multiple of 10 CAD
 * @param {number} amount - Amount in CAD
 * @returns {number} Rounded amount
 */
export const roundUpToNearestTen = (amount) => Math.ceil(Number(amount.toFixed(6)) / 10) * 10;

/**
 * The lowest base price, rounded up to $10, at which the expected attendees cover the budget plus
 * its contingency. 0 when there is no budget or nobody who pays.
 * @param {number} totalCost - Sum of the budget lines, in CAD
 * @param {number} contingencyPct - e.g. 20 for +20 %
 * @param {number} shares - totalPriceShares() of the expected attendees
 */
export const calculateBreakEvenPrice = (totalCost, contingencyPct, shares) => {
  if (!Number.isFinite(totalCost) || totalCost <= 0 || !(shares > 0)) return 0;
  const withContingency = totalCost * (1 + (Number(contingencyPct) || 0) / 100);
  return roundUpToNearestTen(withContingency / shares);
};

/**
 * What each party owes, and the total.
 * @param {Array} attendeeParties - [{ id, attendees, is_paid?, historical_owed? }]
 * @param {number} sellingPriceWholeEvent - The base price, in CAD
 * @param {{ mainWhole: number }} ratios
 * @returns {{ totalShares: number, calculated_amount_owed: number, parties: Array }}
 */
export const simulateEventPricing = (attendeeParties, sellingPriceWholeEvent, ratios = DEFAULT_PRICE_RATIOS) => {
  const basePrice = Number.isFinite(sellingPriceWholeEvent) && sellingPriceWholeEvent > 0 ? sellingPriceWholeEvent : 0;
  let totalShares = 0;
  let calculated_amount_owed = 0;

  const parties = attendeeParties.map(party => {
    totalShares += totalPriceShares(party.attendees, ratios);
    // Grandfathering: a paid party keeps the amount it paid.
    const partyTotal = party.is_paid
      ? (party.historical_owed || 0)
      : party.attendees.reduce((sum, attendee) => sum + attendeePrice(attendee, basePrice, ratios), 0);
    calculated_amount_owed += partyTotal;
    return { ...party, party_total: partyTotal };
  });

  return { totalShares, calculated_amount_owed, parties };
};
