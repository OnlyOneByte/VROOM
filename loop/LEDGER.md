# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | — |
| deep-review | 5 | — |
| guard | 6 | 2 |
| bug | 3 | — |
| infra | 6 | 1 |

Current cycle: **2**

## Cycle log
- **C1 (infra)** — Bootstrapped the `loop/` scaffold the loop format depends on:
  NORTH_STAR.md (vision + quality bar + guardrails), BACKLOG.md (5 categories with
  starvation budgets + seeded ranked queue), this LEDGER, and push.sh. No product code
  touched; verified the scaffold is self-consistent (categories in BACKLOG == LEDGER table).
  Next cycle: nothing is over budget yet, so take highest-leverage — the `infra` item
  "CLAUDE.md stale refs" (cheap, unblocks fresh-clone orientation) or the top `guard`
  (EUR visual guard). Prefer spreading: pick a non-infra category next.
- **C2 (guard)** — Pinned the cycle-201 mobile-wrap fix. Found the top `guard` item
  ("EUR/unit visual guard") was ALREADY built (insurance-currency-label +
  vehicle-form-unit-defaults e2e), so took guard #2 (category-grid no-wrap, c201). Key
  insight: an e2e spec is untracked-by-design (`*.meshclaw.e2e.ts`) so it doesn't survive
  a merge — quality-bar #5 needs a MERGE-SURVIVING guard. Followed the cycle-205/206
  source-scan pattern: committed `category-selector-labels.test.ts` (fast unit suite) that
  asserts all six CategorySelector labels are single-word (a multi-word label wraps in the
  2-col mobile grid). Also dropped a runtime e2e (untracked) that measures actual wrap.
  Verified: guard unit test green (2/2), frontend type-check 0 errors, build done, e2e
  passes against the real component. No product code touched.
  Next cycle: still nothing over budget. Spread again — candidates: `deep-review` (vehicle
  Overview/ExpensesTable eyes-on, or Sheets restore path) or `infra` (CLAUDE.md stale
  refs). Prefer a deep-review to exercise that starved category before its budget bites.
