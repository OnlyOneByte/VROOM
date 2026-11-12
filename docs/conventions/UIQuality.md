# UI Quality — "human-ready, not junk"

CI runs type-check, lint, the unit suite, a build, and the Chromium e2e project. All of that proves a page
**compiles** — none of it proves quality. A page can be green and still be ugly, unusable
on a phone, inaccessible, or missing the states a real user hits. This doc is the bar every
UI feature must clear before it's "done". Treat the checklist as blocking, the same way you
treat a failing test.

`DesignSystem.md` owns the component inventory, tokens, and spacing scale — compose from the
kit. This doc owns the behavior and the review bar.

## The Four-States rule (most common source of "junk")

Every view that loads or mutates data MUST handle all four states — not just the happy one:

1. **Loading** — a `Skeleton` or spinner while data is in flight. Never a blank flash or a
   layout that jumps when data arrives.
2. **Empty** — a real `EmptyState` (`#lib/components/common/empty-state.svelte`) with an
   icon, a one-line explanation, and a primary action — NOT a bare "No data". (See
   `/reminders` for the reference pattern.)
3. **Error** — a visible, recoverable message, never a silent `catch {}` that leaves the
   user staring at a spinner. `handleErrorWithNotification` is the shared path: it toasts
   via `appStore.addNotification` and logs to console only under `import.meta.env.DEV`.
4. **Populated** — the happy path.

If a PR adds a data view and you can't point to all four, it's not done.

## Mobile-first (this is a PWA)

VROOM installs to phones. Mobile is the primary form factor, not an afterthought.
- Design and verify at **390–414px wide first**, then desktop. `npm run test:e2e:mobile`
  runs the Pixel 5 + iPhone 12 projects.
- No horizontal overflow / clipped content at 390px. Tables either scroll-x deliberately
  or collapse to cards.
- Tap targets ≥ 40px. Inputs and primary buttons are full-width or comfortably thumbable.
- Respect safe areas (`app.css` defines `.safe-top` and `.safe-bottom`).

## Accessibility

`e2e/pwa.spec.ts` (`A11Y_ROUTES`) runs `@axe-core/playwright` over eleven routes, and
`e2e/expenses-a11y.spec.ts` covers the expense table's interactive states, at the
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tags. It is a ratchet, not a gate: each route carries a
list of rule ids it already violates (all currently empty) and fails only on an id not on its list.
A new violation class on those routes is caught. Everything else is yours to verify by hand:
- Every interactive control has an accessible name (visible `<label for>`, `aria-label`,
  or text content). Icon-only buttons MUST have `aria-label` (see profile's
  `aria-label="Edit display name"`).
- Form fields: associated `<Label for>`, error text wired via `aria-describedby` +
  `aria-invalid` (use `FormFieldError`).
- **Never nest interactive elements.** A row or card that is itself `role="button"` +
  `onclick` while containing Edit/Delete buttons is a `nested-interactive` violation. Make
  the container non-interactive and a real link the navigation target — the pattern
  `VehicleCarousel` uses.
- Keyboard: every action reachable and operable by keyboard; visible focus ring (don't
  remove outlines). Enter submits, Escape cancels in inline editors.
- Color is never the only signal (pair color with icon/text). Use theme tokens, not
  hand-picked greys — they're the only values checked for AA contrast.

## Consistency (reuse, don't reinvent)

New screens must look like the app, not like a new app. Past the `DesignSystem.md`
inventory, two "don't reinvent" rules live here:
- **Currency / dates** — `utils/formatters` (`formatCurrency`, `formatDate`), never inline
  `toFixed` / `toLocaleString`.
- **Routes / links** — `#lib/routes` + `resolve()`, never a hardcoded path string.

## Interaction quality

- **Optimistic where safe, honest where not.** Disable the submit button + show a spinner
  while a mutation is in flight (`isSubmitting`); never let a user double-submit.
- **Confirm destructive actions** with `common/ConfirmDialog.svelte`, never a bare click.
- **No layout shift** when async content or badges appear — reserve space.
- **Feedback on every action** — success toast or visible state change. A click that does
  nothing visible reads as broken.

## Definition of human-ready (pre-merge checklist)

A UI feature is done when ALL are true:
- [ ] Four states handled (loading / empty / error / populated).
- [ ] Looks correct at 390px AND desktop — no overflow.
- [ ] Icon-only controls have `aria-label`; forms have labels + wired errors; no nested
      interactive elements.
- [ ] Reuses the kit + theme tokens + formatters (no hardcoded colors, paths, or number
      formatting).
- [ ] Destructive actions confirmed; in-flight mutations disable + spinner.
- [ ] `npm run test:e2e` green locally (CI runs only the Chromium project); a new user journey
      gets a spec in `frontend/e2e/`.
