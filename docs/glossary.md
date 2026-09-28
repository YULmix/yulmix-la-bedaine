# Glossary — domain vocabulary

Terms specific to La Bédaine. Code, columns and identifiers use the **English** term;
UI text uses the **French** one. When two words exist for the same thing, the preferred one is
the heading and the rest are listed under _Avoid_.

## People and groups

**Party** (fr. *groupe*, *inscription*)
One person's registration, covering everyone they are signing up — themselves, partner, kids,
friends. Stored as one row in `user_parties` with an `attendees` JSONB array. A party is the unit
of payment: one amount owed, one payment status.
_Avoid_: booking, group booking, family.

**Attendee** (fr. *participant*)
One human inside a party. Has a name, a tier, a new-member flag, and their own sleeping and
dietary preferences. Not a database row — an object inside `user_parties.attendees`.
_Avoid_: guest, member (a member is a person in the friend group, not a row in a party).

**Tier** (fr. *type de participation*)
The billing category of an attendee, combining age band and how much of the weekend they attend:
`adult_whole`, `adult_main`, `teen_whole`, `teen_main`, `kids`. Drives points, and therefore price.
_Avoid_: category, class, level.

**New member** (fr. *nouveau membre*)
An attendee coming to La Bédaine for the first time. Deliberately charged less, to lower the
barrier for newcomers — see [the new-member rule](./04-pricing-and-business-rules.md#new-member-rule).
_Avoid_: newcomer, first-timer, guest.

**Admin** (fr. *administrateur*, UI label *Admin*)
An organiser with full read/write access to every event and registration. Flagged by
`profiles.is_admin`. Granted only through the `admin_set_is_admin` function, never by direct update.
_Avoid_: organiser (fine in prose, but the code says admin), moderator, owner.

**Root admin**
The hardcoded `yulmixalabedaine@gmail.com` account. Always an admin, cannot be demoted. Break-glass.

## The weekend

**Event** (fr. *événement*)
One edition of the weekend — a theme, a venue, dates, a budget, a price. Exactly one is active at
a time. Archived, never deleted.
_Avoid_: weekend, edition, party (party means a registration here).

**Whole event** (fr. *fin de semaine complète*)
Attending the full weekend. The pricing baseline: an adult attending the whole event pays exactly
`selling_price_whole_event`.
_Avoid_: full weekend, complete pass.

**Main event** (fr. *événement principal*)
Attending only the main night rather than the full weekend. Priced at 75% of the whole-event adult
price for an adult.
_Avoid_: Saturday only, day pass.

**After-party**
The participation level recorded for kids. Carries zero points, so kids are always free.

**Intent phase** (fr. *phase d'intention*)
The window before registration opens (`reg_start_date − z_intent_months`) where members declare
that they plan to come and who with, so organisers can size and price the weekend. Non-binding.
_Avoid_: pre-registration, RSVP, expression of interest.

## Money

**Base price** / **selling price** (fr. *prix de base*, *prix de vente*, column
`events.selling_price_whole_event`)
What an adult attending the whole weekend pays. With the main-event ratio, **the only input to
what members owe.** Set by an admin, deliberately not recomputed when people join or leave.
_Avoid_: ticket price, fee, member price.

**Price share**
An attendee's price as a fraction of the base price: adult whole 1, adult main
`ratio_main_whole`, teens half the adult share of their tier, a new member the main-event share of
their age, kids 0. Replaced the "points" (2.0 / 1.075 / 1.0 / 0.5375) in #109; the default ratio
gives the same prices.
_Avoid_: point, weight, unit.

**Main-event ratio** (column `events.ratio_main_whole`)
The main-event price as a share of the whole-weekend price, per event (default 53.75 %). Also what
a first Bédaine pays.

**Budget** (fr. *budget*, table `event_budgets`)
The organisers' categorized list of what the weekend costs, with its total and a contingency.
Admins only. A **simulation** tool: it never changes an amount owed.
_Avoid_: cost breakdown (the old column name), expenses.

**Contingency** (fr. *contingence*, column `event_budgets.contingency_pct`)
The safety margin added to the budget's total before computing the break-even price. 20 % by
default, set per event.

**Break-even price** (fr. *prix d'équilibre*)
The lowest base price, rounded **up** to the nearest $10, at which an expected headcount covers the
budget plus its contingency. Shown to admins so they can set the base price; never applied on its
own.
_Avoid_: base cost, cost price — and do not conflate it with the base price. One is a yardstick,
the other a decision.

**Amount owed** (fr. *montant dû*, column `user_parties.calculated_amount_owed`)
What a party owes, in CAD: the sum of its attendees' individual costs. Snapshotted onto the row
at save time, not computed on read.

**Grandfathering**
Once a party is paid, its `calculated_amount_owed` is preserved even if the event's selling price
changes afterwards. Nobody gets an invoice after they have already settled.

## Logistics

**Sleeping preference** (fr. *hébergement*) — one of `camping`, `floor`, `bed`, `sofa`.
Requesting a bed requires a reason (`health`, `children`, `comfort`) because beds are scarce.
_Avoid_: accommodation type, room.

**Assigned spot** (`logistics.sleeping.assigned`)
The sleeping place an organiser has actually allocated. Admin-write only; the member's `pref` is
a request, `assigned` is the answer.

**Volunteering** (fr. *bénévolat*)
A multi-select of jobs a party offers to take on (food purchase, cooking, DJ, setup, cleanup,
neighbours, parking, art initiative, pharmacy…). Stored party-wide, not per attendee.

**Waitlist** (fr. *liste d'attente*)
When registrations exceed `max_attendees`, the registration is still accepted but flagged
`is_waitlisted`. Signup is never blocked — a deliberate choice, see [ADR 0005](./adr/0005-waitlist-instead-of-blocking.md).

**Points of contact** (fr. *points de contact*)
Free-text list of which organiser owns which area, editable per event. Not modelled as
relationships to profiles.
