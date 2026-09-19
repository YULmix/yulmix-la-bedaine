# ADR 0011: Operational Feedback Loop, Event Safety, and Communications

## Status
Accepted

## Context
Organizers need in-app feedback capture, safe lifecycle transitions that protect active event data, unambiguous administrative actions, and automated participant notifications.

## Decisions
1. **Feedback & Deployment Notification Cycle**
   - In-app feedback stores rich text and optional screenshot attachments via Supabase Storage (`feedback` bucket).
   - Resolving feedback marks `is_resolved = TRUE` and updates `resolved_at`.
   - User clients inspect `resolved_at` on load; if newer than the local client dismissal timestamp, a non-blocking refresh banner is displayed.

2. **Event Mutex & Administrative State Transitions**
   - The database partial index `only_one_active_event` enforces a single active event.
   - Deactivating/archiving an event requires an explicit warning prompt.
   - Reactivating an event validates that no other event is active, prompting the admin to archive the current event if one exists.
   - Payment status changes (`Payé` / `Impayé`) require explicit confirmation.

3. **External Integrations**
   - Physical venue locations must render deep links to Google Maps.
   - Event transactions (registration confirmed, payment verified) dispatch French email receipts via transactional webhooks or Edge Functions.