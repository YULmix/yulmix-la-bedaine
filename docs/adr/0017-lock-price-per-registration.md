# A registration keeps the price it was made at

Until September 2026, changing an event's base price (`selling_price_whole_event`) or main-event
ratio (`ratio_main_whole`) repriced every unpaid registration of the event (#32, #109), and only
paid ones kept their amount (#31). Organisers didn't want that: someone who registered and was
shown an amount should keep that deal, paid or not. **Each registration now locks the base price
and ratio in force when it is made, and every later recalculation of its amount uses them.** A
price change only affects registrations made afterwards
([issue #117](https://github.com/YULmix/yulmix-la-bedaine/issues/117)).

**Status: accepted.** Reverses the "reprice unpaid registrations" behaviour of #32 and #109 and
updates [ADR 0007](./0007-selling-price-not-cost-drives-member-pricing.md), which had called that
repricing a core feature.

## How

- `user_parties.locked_selling_price_whole_event` and `locked_ratio_main_whole`, set by the
  `enforce_calculated_amount_owed` trigger. A client's value is always ignored, an admin's too: a
  deliberate "reprice this registration at today's price" is a possible follow-up, not a column
  anyone can write.
- The lock covers edits made later: a member adding someone to their party pays the locked price for
  them too. It survives a waitlist promotion.
- Paid grandfathering (#31) stays: a paid party's amount doesn't change even if it is edited.
- Existing registrations were locked at the event's values when this shipped. Unpaid amounts
  already reflected them, since they had just been repriced, so no amount changed.

## Two cases that don't lock at creation

- **No price yet.** A price defaults to 0, and the intent phase exists precisely to collect
  registrations before organisers set the price. Locking those at 0 would make them free forever.
  A registration made while the event has no price stays unlocked and is locked at the first price
  the event gets. The organiser chose this over "never lock during the intent phase" (depends on
  dates, more logic) and "lock at 0" (forces the price to be set before intents open).
- **Re-registering after a cancellation.** It reuses the same row (UNIQUE `user_id, event_id`), but
  cancelling ended the deal, so it locks the event's current price again. Chosen by the organiser.

## Consequences

- The amount stored on the row is the only truth; the admin views display it and never re-run the
  pricing engine at the event's current price. The registration form estimates an existing
  registration at its locked values (`partyPricingOf` in `src/lib/pricingEngine.js`).
- Two registrations for the same event can owe different amounts for the same people. That is the
  point, but admins comparing parties should expect it.
- A price increase late in the cycle brings in less than the simulator's "projected revenue", which
  prices everyone at the tried values. The simulator is a planning tool, not a forecast of what
  existing registrations will pay.
