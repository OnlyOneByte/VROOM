---
inclusion: fileMatch
fileMatchPattern: "frontend/src/routes/**/*.svelte,frontend/src/lib/components/**/*.svelte"
---

# UI Quality — "human-ready, not junk"

The automated gates (`regress.sh`) prove a page **renders without crashing**. That is a
FLOOR, not quality. A page can pass smoke and still be ugly, unusable on a phone,
inaccessible, or missing the states a real user hits. This doc is the bar every UI feature
must clear before it's "done". Treat the checklist as blocking, the same way you treat a
failing test.

## The Four-States rule (most common source of "junk")

Every view that loads or mutates data MUST handle all four states — not just the happy one:

1. **Loading** — a `Skeleton` (`$lib/components/ui/skeleton`) or spinner while data is in
   flight. Never a blank flash or layout that jumps when data arrives.
2. **Empty** — a real `EmptyState` (`$lib/components/common/empty-state.svelte`) with an
   icon, a one-line explanation, and a primary action — NOT a bare "No data". (See the
   `/reminders` empty state for the reference pattern.)
3. **Error** — a visible, recoverable message (toast via `appStore` and/or inline), never a
   silent `catch {}` that leaves the user staring at a spinner. Log to console only in DEV.
4. **Populated** — the happy path.

If a PR adds a data view and you can't point to all four, it's not done.

## Mobile-first (this is a PWA)

VROOM installs to phones. Mobile is the primary form factor, not an afterthought.
- Design and verify at **390–414px wide first**, then desktop. The harness screenshots
  every route at BOTH mobile (Pixel-5) and desktop — look at the mobile shot.
- No horizontal overflow / clipped content at 390px. Tables either scroll-x deliberately
  or collapse to cards.
- Tap targets ≥ 40px. Inputs and primary buttons are full-width or comfortably thumbable.
- Respect safe areas (the layout already uses `safe-top`/`safe-bottom`).

## Accessibility (the axe gate + ratchet)

`route-smoke` runs `@axe-core/playwright`. **Ratchet model**: routes marked `a11yClean`
in the ROUTES list are ENFORCED (a regression that adds a serious/critical violation fails
the suite); routes with known pre-existing debt are scanned + WARNED (`[a11y] …`) but don't
block. As you clear a route's debt, add its `a11yClean: true` flag to lock it in. When all
routes are flagged, drop the flag and make the gate unconditionally strict (the env override
`A11Y=strict` enforces everywhere; `A11Y=0` skips).

**Current ratchet state** (update as you go):
- Enforced clean: `/dashboard`, `/analytics`, `/reminders`, `/trips`.
- Known debt (warn-only): `/vehicles/new`, `/expenses`, `/expenses/new`, `/insurance/new`,
  `/profile`, `/settings` — two causes: (1) **low-opacity/placeholder contrast** (`#afafb4`
  ≈ `text-muted-foreground/40` + input placeholders on white < 4.5:1), (2) **ExpensesTable
  row nesting** (`role="button"` rows containing Edit/Delete buttons → `nested-interactive`).
  Fix pattern for (2): drop `role=button`/`onclick` from the row, make a cell a real link
  (stretched-link), keep action buttons `relative z-10` — same fix used on VehicleCarousel.

That gate catches the mechanical issues; you still own the rest:
- Every interactive control has an accessible name (visible `<label for>`, `aria-label`,
  or text content). Icon-only buttons MUST have `aria-label` (see profile's
  `aria-label="Edit display name"`).
- Form fields: associated `<Label for>`, error text wired via `aria-describedby` +
  `aria-invalid` (use the existing `FormFieldError` pattern).
- Keyboard: every action reachable and operable by keyboard; visible focus ring (don't
  remove outlines). Enter submits, Escape cancels in inline editors.
- Color is never the only signal (pair color with icon/text). Text meets WCAG AA contrast
  — use theme tokens, not hand-picked greys.

## Consistency (reuse, don't reinvent)

New screens must look like the app, not like a new app. REUSE these — do not hand-roll
equivalents:
| Need | Use |
|---|---|
| Page title + actions | `common/page-header.svelte` (`PageHeader`) |
| Empty state | `common/empty-state.svelte` (`EmptyState`) |
| Loading | `ui/skeleton` (`Skeleton`) |
| Buttons | `ui/button` (`Button`) — never a raw styled `<button>` for primary actions |
| Inputs / selects / dialogs | the `ui/*` primitives (shadcn-svelte) |
| Currency / dates | `utils/formatters` (`formatCurrency`, `formatDate`) — never `toFixed`/`toLocaleString` inline |
| Routes/links | `$lib/routes` + `resolve()` — never hardcoded path strings |
- Colors: theme tokens only (`text-muted-foreground`, `bg-card`, `text-destructive`, …).
  No hardcoded hex / `bg-gray-*` / `text-white` — they break dark mode and custom themes.
- Spacing: match neighbors (`space-y-6` page sections, `gap-2/3` inline). Don't invent.

## Interaction quality

- **Optimistic where safe, honest where not.** Disable the submit button + show a spinner
  while a mutation is in flight (`isSubmitting`); never let a user double-submit.
- **Confirm destructive actions** (delete) with an `AlertDialog`, never a bare click.
- **No layout shift** when async content or badges appear — reserve space.
- **Feedback on every action** — success toast or visible state change. A click that does
  nothing visible reads as broken.

## Definition of human-ready (pre-merge checklist)

A UI feature is done when ALL are true:
- [ ] Four states handled (loading / empty / error / populated).
- [ ] Looks correct at 390px (mobile shot reviewed) AND desktop — no overflow.
- [ ] `regress.sh` green, including the **axe a11y gate** (no serious/critical).
- [ ] Icon-only controls have `aria-label`; forms have labels + wired errors.
- [ ] Reuses PageHeader/EmptyState/Skeleton/Button + theme tokens + formatters (no
      hardcoded colors, paths, or number formatting).
- [ ] Destructive actions confirmed; in-flight mutations disable + spinner.
- [ ] A new route is added to `e2e/route-smoke.meshclaw.e2e.ts` (smoke + a11y + shots).
- [ ] The **UI critic pass** (see below) returned no blocking findings.

## The UI critic pass (subjective layer axe can't cover)

Before calling a UI feature done, run a design-critic review: hand the route's **mobile +
desktop screenshots** and the component source to a reviewer (subagent or self) and ask it
to score against THIS doc — specifically hunting for: missing states, mobile overflow,
inconsistent spacing/colors, unlabeled controls, and "looks AI-generated" tells (generic
copy, no empty-state guidance, walls of unstyled text). Treat blocking findings like test
failures: fix, re-shoot, re-review.
