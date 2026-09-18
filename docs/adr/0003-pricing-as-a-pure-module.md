# Pricing lives in one pure, tested module

All money rules are in `src/lib/pricingEngine.js`: no React, no Supabase, no I/O, every function
taking values and returning values, with `simulateEventPricing` explicitly documented as mutating
nothing. It is the only module in the repo with its own tests. The rules — point weights, the
new-member downgrade plus 30% reduction, round-up-to-$10 on the internal cost — are subtle enough
that they have to be verifiable in isolation, and organisers need to run what-if scenarios without
touching stored data.

## Consequences

- Changing a pricing rule means changing one file and adding a test case. Grep confirms only two
  callers: `RegistrationForm` and `AdminView`.
- The purity is what makes the admin scenario simulator trivial — it is the same function the live
  form uses, called with synthetic parties.
- The module uses simulation-shaped field names (`is_paid`, `historical_owed`, `isNewMember`) rather
  than database column names, and nothing maps between them. That is the price of the isolation, and
  it is currently why grandfathering never fires in the real flow.
- When the authoritative calculation moves into a Postgres trigger, this module stays as the
  interactive estimate — but the two implementations must be tested against each other, or they will
  drift.
