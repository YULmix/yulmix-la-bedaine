# ADR 0010: Refined Pricing Rules, Individual Logistics, and Event Lifecycle

## Status
Accepted

## Context
Clarifications were needed regarding new member and teenager pricing weight rules, granular accommodation allocations, and administrative state transitions.

## Decisions
1. **New Member & Teenager Pricing**
   - The previous 30% / 70% rule is not correct.
   - New members pay a flat weight rate of **0.5 points** regardless of attendance tier (Whole vs. Main Event).
   - Teenagers pay half of the applicable member rate (New Member Teenager = **0.25 points**).
   - Attendee pricing formula: `price_per_point = selling_price_whole_event / 2.0`.
   - `attendee_cost = attendee_points * price_per_point`.

2. **Per-Participant Logistics**
   - Bed assignments (`assigned_bed`, `sleeping_pref`, `bed_reason`) must be stored directly within each participant object inside the `attendees` JSONB array on `public.user_parties`, rather than on the top-level party object.

3. **Event Lifecycle & Admin Actions**
   - Archiving an event requires an explicit warning modal and confirmation.
   - Reactivating an event must respect the `only_one_active_event` partial index mutex by verifying no other active event exists or auto-archiving the predecessor.
   - Payment status edits ('Payé' / 'Impayé') require an explicit confirmation prompt.