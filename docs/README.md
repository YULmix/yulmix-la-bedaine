# La Bédaine — Documentation

This folder is the entry point for anyone (human or agent) working on the app.
It documents the system **as it actually is today**, not only as it was specified.

## Read in this order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [Product overview](./01-product-overview.md) | What is this app, who uses it, what replaces the spreadsheet |
| 2 | [Glossary](./glossary.md) | The bilingual domain vocabulary (tier, party, point, selling price…) |
| 3 | [Architecture](./02-architecture.md) | Runtime shape, boundaries, data flow, deployment |
| 4 | [Data model](./03-data-model.md) | Tables, JSONB payload shapes, triggers, views |
| 5 | [Pricing & business rules](./04-pricing-and-business-rules.md) | The money logic, with worked examples |
| 6 | [Frontend guide](./05-frontend-guide.md) | Component map, state, routing, i18n conventions |
| 7 | [Security & RLS](./06-security-and-rls.md) | Auth, roles, the RLS policy matrix, threat notes |
| 8 | [Development setup](./07-development-setup.md) | Getting it running, scripts, verified current state |
| 9 | [Contributing](./08-contributing.md) | Branching, reviews, conventions, how to work with agents |
| 10 | [State of the code](./09-state-of-the-code.md) | Ranked list of confirmed defects and technical debt |
| 11 | [Roadmap](./10-roadmap.md) | What to build next, in dependency order |
| 12 | [Live environment audit](./11-live-environment.md) | What Supabase and Vercel actually look like today, verified read-only, with open questions |
| 13 | [Decision records](./adr/) | Why the system is shaped the way it is |

## Source of record

- **[Bedaine App - Requirements.md](./Bedaine%20App%20-%20Requirements.md)** — the original
  prompt-by-prompt specification used to build the app. It is a historical record of *intent*,
  including decisions that were later reversed. Where intent and code disagree,
  [State of the code](./09-state-of-the-code.md) records the gap. **It is not where ongoing work is
  tracked** — see [Contributing → Tracking work](./08-contributing.md#tracking-work): current and
  future work belongs in GitHub Issues (or beads tasks).
- **The Excel/Google spreadsheet** — the legacy tool being replaced. See
  [Product overview](./01-product-overview.md#relationship-to-the-spreadsheet) for the migration status
  and what still needs to be extracted from it.

## Conventions for these docs

- Every factual claim about behaviour cites `path/to/file.ext:line` so it can be re-verified.
- Diagrams are Mermaid, never ASCII art.
- Claims that could **not** be verified (because they depend on the live Supabase project) are
  explicitly marked as *unverified* rather than asserted.
