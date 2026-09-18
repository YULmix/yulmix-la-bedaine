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

**Point**
The weighting unit that spreads cost across attendees by how much of the weekend they consume:
adult-whole 2.0, adult-main 1.5, teen-whole 1.0, teen-main 0.5, kids 0.0. Everything financial is
"price per point × points".
_Avoid_: unit, weight, share, credit.

**Selling price** (fr. *prix de vente*, column `events.selling_price_whole_event`)
The price an admin decides an adult attending the whole event pays. **The only input to what
members owe.** Set by human judgement, deliberately not recomputed when people join or leave.
_Avoid_: ticket price, fee, member price.

**Price per point**
`selling_price_whole_event / 2.0`. The rate every tier is charged at.

**Base cost** / **estimated cost per participant** (fr. *coût de revient estimé*, columns
`events.total_cost`, `events.estimated_individual_cost_whole_event`)
The organisers' internal break-even estimate: what the weekend actually costs, plus a 20%
contingency, divided across points, rounded **up** to the nearest $10. Never shown to members;
it exists so organisers can see whether the selling price covers reality.
_Avoid_: cost price, break-even price, real price — and above all do not conflate it with the
selling price. They are unrelated numbers that happen to be in the same currency.

**Contingency**
The flat ×1.20 safety margin applied to `total_cost` before computing the base cost.

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
