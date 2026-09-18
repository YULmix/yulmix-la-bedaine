# The admin-set selling price, not the cost estimate, determines what members pay

What a party owes is derived strictly from `events.selling_price_whole_event` — a number an organiser
sets by judgement — via `price_per_point = selling_price / 2.0`. The internal estimate
(`total_cost × 1.20`, divided across points, rounded up to the nearest $10) is a break-even yardstick
shown only to admins, and never feeds the member-facing calculation. The two were originally
conflated; the requirements were revised specifically to separate them.

## Consequences

- **Prices are stable.** If the amount owed were derived from cost ÷ attendees, every new
  registration would silently change what everyone else owes, and members would be quoted one number
  and invoiced another.
- Organisers carry the judgement call, with both numbers side by side in the admin dashboard, and can
  deliberately under-price a year (absorbing the difference) or over-price to build a float.
- The internal cost estimate rounds **up** to the nearest $10 — asymmetric on purpose: over-collecting
  slightly beats chasing a shortfall.
- The workflow this implies — collect intentions, look at the cost estimate, then set the price about
  a month out — means the price normally changes *after* people have registered. Repricing existing
  registrations is therefore a core feature, not an edge case, and it does not exist yet.
