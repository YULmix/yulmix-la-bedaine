# Edition roles: Comité and Organisateur below Admin, one ladder

Until October 2026 an account was either a member or an admin. Organisers asked for people who
help run an edition (the cooks, the drivers' coordinator, the treasurer) without full admin
power ([issue #217](https://github.com/YULmix/yulmix-la-bedaine/issues/217)). **Access is a
ladder of four roles, each including the one below: Member, Comité and Organisateur (granted per
edition), and Admin (per account). The database enforces it through one function,
`edition_role(event_id)`.**

**Status: accepted** (October 2026), decided in a design session on #217, and implemented by
#217: migration `20261004124226_edition_roles.sql` (PR #250), the section registry's `minRole`
(`src/lib/adminSections.ts`), `src/lib/editionRoles.ts`, and « Équipe »
(`src/components/admin/sections/TeamSection.jsx`). **Amended by
[ADR 0026](./0026-comite-does-not-see-finances.md)** (#290): Comité no longer sees a party's
amounts nor payment status; it reads its edition's parties through `edition_parties()`, not
`user_parties`.

```mermaid
flowchart LR
  M["Member<br/>own profile, own registration,<br/>carpool board"] --> C["Comité (per edition)<br/>reads that edition's admin area,<br/>except Budget"]
  C --> O["Organisateur (per edition)<br/>+ Budget, Historique, exports<br/>+ places, notes, payments, budget, pricing"]
  O --> A["Admin (account)<br/>+ Événements, Sites, Retours, Équipe,<br/>editing anyone's registration"]
```

## Decisions

- **Four roles, a ladder, no permission grid.** Each role includes everything below it. A grid
  of permissions (coordination, assignment, finances, events, venues) with none/read/write levels,
  granted per account and per edition, was designed and rejected: it multiplies the combinations
  to test, for a team of a few people. Two tiers (member, Comité, admin) were rejected too:
  delegating bed assignment or payments would mean handing over full admin, including events,
  sites and granting admin.
- **Comité** (per edition), read-only. Sees that edition's admin area: Résumé (without the
  budget cards), Inscrits (the list, read-only), and every Logistique view, places included. It
  sees registrations in full, payments and private notes included: helpers are trusted
  organisers, and hiding columns would need a database function per view. No Budget section and
  no writes. *Amended by [ADR 0026](./0026-comite-does-not-see-finances.md): no amounts nor payment
  status, through a database function; private notes stay.*
- **Organisateur** (per edition). Everything Comité has, plus Budget, Inscrits' Historique and
  the exports, plus the edition's operations: assigning places and writing the party notes and
  messages (`save_logistics`), marking payments, saving the budget, applying pricing.
- **Admin** (per account, `profiles.is_admin`, unchanged, root admin included). Everything, on
  every edition, plus Événements (create, edit, activate, archive, the editor's Couchage), Sites,
  Retours, the new « Équipe » section, the admin flag, and **editing anyone's registration**
  (god-mode). Editing a registration is not an organiser task.
- **Per edition, and only upwards.** Comité and Organisateur are granted for one event: next
  year's edition starts with nobody. A grant on a past edition still lets that person read it
  where a screen can pick an edition (Historique, exports). An admin's role is admin everywhere;
  an admin can't also hold an edition role.
- **What counts on screen.** The admin sections show the active event, so they use the role on
  the active event. The « Admin » nav entry shows to admins and to anyone with a role on the
  active event. Sections and views are filtered by role in the section registry (ADR 0022). An
  admin URL the role doesn't allow redirects to the first section it does (replacing the history
  entry); with no role, the existing « accès restreint » notice shows.
- **Only admins grant roles**, in a new admin-only section, « Équipe »: the people with a role on
  each edition, add someone by name or email (registered for the edition or not), change or
  remove their role. Every grant, change and removal is logged (who, to whom, which role and
  edition, when) and shown there. Granting and removing admin is logged too (#256, in
  `admin_role_log`: who, to whom, granted or removed, when), and « Équipe » shows it merged by
  date into every edition's log. The admin flag is granted and removed there too (with a
  confirmation, never from the Inscrits list): « Équipe » lists the admins first, its picker offers
  Comité, Organisateur and Admin to any account (the edition's registrants by default), and the
  database still refuses one's own flag and the root admin's.
- **The database is the authority** (ADR 0001):
  - one table of edition roles (`event_id`, `user_id`, `role` ∈ `committee` | `organiser`, unique
    per event and user), writable only by admins, with a log table filled by a trigger;
  - `edition_role(event_id)` (`SECURITY DEFINER`, stable) returns `admin`, `organiser`,
    `committee` or null for the current user; everything else checks it;
  - reading an event's registrations (`user_parties`, `attendees`, the registrants' profiles, the
    change history) is allowed to Comité and above on that event, through RLS on rows;
  - organiser writes go through functions that check the role: payment status gets its own
    function (the row-update policy would let anyone allowed to update a row change every
    column), `save_logistics`, the budget table, pricing. `save_registration` for someone else
    stays admin-only;
  - one table-driven RLS test asserts, for each role, each table and function as allowed or
    denied, and the seed adds a Comité and an Organisateur test user next to the member and the
    admin.

## Consequences

- Adding a rung later (say, a treasurer below Organisateur) is a migration and one row of the RLS
  test table per object, not a redesign. Splitting a rung by topic is the grid we rejected; it
  needs a new ADR.
- Comité sees payments and private notes. If that ever becomes a problem, the fix is restricted
  functions per view, not hiding columns in React. *For payments it did:
  [ADR 0026](./0026-comite-does-not-see-finances.md) (#290).*
- « Organisateur » is now a role name: the glossary's "avoid *organiser*" note for admins no
  longer holds. In code, `organiser` means the edition role; prose about the people running the
  weekend says *organisers* only where the role doesn't matter.
