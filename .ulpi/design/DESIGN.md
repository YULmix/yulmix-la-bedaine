---
project: La Bédaine (YULmix)
register: product
aesthetic_direction: industrial / signage, night-club edition (event wristband + gig poster under blacklight)
color_strategy: restrained
design_system: bespoke (Tailwind v4 @theme tokens + native HTML primitives: <dialog>, <details>, role=tablist)
design_variance: 5
motion_intensity: 4
visual_density: 5   # member screens; admin screens run at 7
theme: dark only (locked; no light mode)
---

# La Bédaine design language (LOCKED)

> Every screen must read as the same product if placed side by side.

Re-read this file before designing or building any screen. A value that is not in this file is a
defect. If a feature genuinely needs something new, change this file first, on purpose, then use it.

## Design Read

A private pass for a party the group has thrown for twenty years: blacklit, hand-made and a little
rowdy on the surface, but the money and the logistics feel rock-solid. The bet: the registration
*is* your ticket, so the most important screen should look and feel like one.

## Why this direction (and not the default)

The brief is "event registration + admin for ~90 friends". The generic answer is a white SaaS form
with a blue→purple gradient banner, which is exactly what the app had. The real brand is elsewhere:

- `public/banniere_bedaine.jpg`: a hand-painted mural glowing under UV light (hot pink, cyan,
  yellow on ultraviolet).
- `public/Bedaine_Disco.png`: the disco ball in the dark cottage.
- `src/assets/YULmix_App.png`: the YULmix mark is a **barcode over a monospace wordmark**.

Industrial/signage fits because a party weekend runs on signage: wristbands, door lists, ticket
stubs, room labels. Counterfactual check: this look (UV-black, one fluorescent pink, condensed
poster type, mono data, a wristband) would be wrong for a bank, a SaaS dashboard or a wellness app.
It only makes sense for this brief.

## Signature: Le Bracelet (the wristband pass)

The member's registration is rendered as an event wristband / ticket stub:

- A horizontal pass with a **perforated tear line** (two half-circle notches cut out of the edges +
  a dashed rule) separating the "stub" (amount due, payment stamp) from the body (event, group,
  headcount).
- A **barcode strip** generated deterministically from the registration id, echoing the YULmix
  barcode logo. Decorative (`aria-hidden`), rendered with CSS gradients, not an image.
- A **status stamp** (`PAYÉ` / `À PAYER` / `LISTE D'ATTENTE` / `INTENTION`) in condensed caps,
  rotated -6°, outlined in its semantic color.
- The only place the pink `neon` glow (`--shadow-glow`) is allowed.

Boldness is spent here and in the event poster header. Everything else is quiet.

## Color (locked)

Dark only. Neutrals are tinted toward the UV hue (282°). Exactly one accent: `neon` (fluorescent
pink from the mural). 60 / 30 / 10: `night`+`surface` / `ink`+`muted` text / `neon`.

| token | OKLCH | hex | use |
|---|---|---|---|
| `night` | oklch(0.15 0.03 282) | #090917 | page background; inset wells (inputs) |
| `surface` | oklch(0.195 0.034 282) | #121324 | cards, panels, top bar |
| `raised` | oklch(0.24 0.038 282) | #1c1d31 | hover, selected rows, dialogs, menus |
| `line` | oklch(0.33 0.04 282) | #32334a | dividers, card outlines (decorative only) |
| `edge` | oklch(0.5 0.04 282) | #5f617a | form control borders, unselected chip borders (3:1 UI) |
| `ink` | oklch(0.965 0.012 282) | #f2f3fc | primary text, headings |
| `muted` | oklch(0.78 0.03 282) | #b4b5cb | secondary text, labels |
| `faint` | oklch(0.66 0.035 282) | #8e90a8 | captions, placeholders, meta |
| `neon` (accent) | oklch(0.76 0.17 352) | #ff7fbc | primary buttons, selected chips, focus ring, active tab, links |
| `neon-ink` | = `night` | #090917 | text on `neon` |
| `ok` | oklch(0.82 0.14 160) | #65e0a5 | paid, confirmed bed, success |
| `warn` | oklch(0.86 0.14 85) | #fbc959 | unpaid, waitlist, intent phase, unsaved |
| `bad` | oklch(0.72 0.17 25) | #fd736d | errors, destructive actions |
| `info` | oklch(0.82 0.1 225) | #77d2f5 | neutral notices, draft events |

Semantic colors appear as text/outline on a 12–16% tint of themselves
(`color-mix(in oklab, var(--color-ok) 14%, transparent)`), never as large solid fills (except
destructive confirm buttons, `bad` solid with `night` text).

Contrast (WCAG 2.x), measured:

| pair | ratio | | pair | ratio |
|---|---|---|---|---|
| ink / night | 17.8 | | neon / night | 8.5 |
| ink / surface | 16.6 | | neon / surface | 7.9 |
| ink / raised | 14.9 | | neon-ink / neon | 8.5 |
| muted / surface | 9.1 | | ok / surface | 11.1 |
| muted / raised | 8.2 | | warn / surface | 11.9 |
| faint / surface | 5.9 | | bad / surface | 6.9 |
| faint / raised | 5.3 | | info / surface | 10.8 |
| edge / night (input border) | 3.3 | | edge / surface | 3.0 |

Banned: gradients as UI decoration (the old blue→purple banner is gone), gradient text, pure
`#000`/`#fff`, any second accent. The only gradients allowed are the photo scrims on the poster
header (`night` at 0→92% over the mural) and the barcode.

## Type (locked)

| role | family | use | notes |
|---|---|---|---|
| display | **Archivo Variable**, `wdth` 125, `wght` 800, uppercase | poster header, page titles, stamps, big step titles | tracking -0.01em; `text-wrap: balance` |
| body | **Archivo Variable**, `wdth` 100, `wght` 400/600 | all reading text, labels, buttons | measure ≤ 70ch |
| data | **JetBrains Mono Variable**, `wght` 500 | money, counts, dates in the pass, barcode captions, bed labels | `font-variant-numeric: tabular-nums` |

One family in two widths (contrast axis: expanded display vs. normal body) plus a mono for data,
which is the YULmix wordmark's voice. Self-hosted with `@fontsource-variable/*` (no Google Fonts
`<link>`).

Scale (6 steps, no others): `xs 12` (mono captions) · `sm 14` (meta, labels) · `base 16` (body,
inputs: never below 16px on mobile, prevents iOS zoom) · `lg 20` (card titles) · `display-md 28/32`
(section + page titles) · `display-lg clamp(2.5rem, 7vw, 4.5rem)` (poster header only).

Weights: 400, 600, 800 only.

## Scales (locked)

- **Spacing**: 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80. Page gutter 16px mobile, 24px
  from `md`. Max content width 72rem (member), 80rem (admin).
- **Radius**: `control 12px` (buttons, inputs, chips that are not pills) · `card 20px` (cards,
  dialogs, pass) · `pill 9999px` (status tags, filter chips, tab pills). No other radii.
- **Borders**: 1px `line` for cards; 1px `edge` for controls; 2px `neon` for selected chips and the
  focus ring (`outline: 2px solid neon; outline-offset: 2px`).
- **Elevation**: flat by default. `--shadow-pop: 0 16px 48px -12px oklch(0.05 0.03 282 / 0.7)` for
  dialogs/menus only. `--shadow-glow: 0 0 0 1px neon/40%, 0 12px 48px -16px neon/45%` for the
  pass only.
- **Z layers**: sticky 30 · bottom bars 40 · dialog (native top layer) · toast 70.
- **Breakpoints**: sm 640 · md 768 · lg 1024. Mobile-first, baseline 375px.
- **Touch**: every interactive target ≥ 44×44px.
- **Motion**: `fast 150ms` (hover, press) · `base 250ms` (tabs, chips, disclosure) · `emphasis
  450ms` (pass stamp, dialog enter). One curve: `cubic-bezier(0.16, 1, 0.3, 1)`. No bounce. Press
  feedback: `scale(0.98)`. All motion off under `prefers-reduced-motion: reduce`.

Motivated motion only:
1. Page-load: poster header + pass fade/rise, 60ms stagger (hierarchy).
2. Pass stamp lands (scale 1.4→1, rotate -14°→-6°) when the status changes or after a save
   (feedback: the peak moment).
3. Dialog/bottom-sheet enter (state transition).
4. Step change in the registration flow slides 12px (orientation).

## Components vocabulary (one of each, reused everywhere)

`Button` (primary neon / secondary outline / ghost / danger), `Field` (label above, hint, error
below), `Chip` (single + multi select, replaces `<select>` for ≤ 6 options), `Stepper` (− n +),
`Toggle` (switch), `Tag` (status pill), `Card`, `Dialog` (native `<dialog>`, bottom sheet under
`sm`), `Tabs`, `Toast`, `EmptyState`, `Skeleton`, `PosterHeader`, `Pass`, `PhaseTrack`.

Icons: **lucide-react** only (already a dependency), `strokeWidth 1.75`, 20px default, 16px inline.
No hand-drawn SVG paths anywhere.

## Voice

- French (fr-CA), **vouvoiement** kept (existing voice), warm and direct, short sentences.
- Action vocabulary is fixed through the flow: *S'inscrire* → *Inscription enregistrée*;
  *Modifier* → *Enregistrer les modifications*; *Supprimer l'inscription* → *Inscription supprimée*;
  *Marquer payé* → *Payé*.
- No em-dashes in visible copy. No buzzwords. Numbers are always real data or absent.
- Every raw DB value goes through `src/lib/registrationOptions.js`; every string lives in
  `src/locales/fr.json`.
