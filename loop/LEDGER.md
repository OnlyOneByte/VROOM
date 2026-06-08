# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | — |
| deep-review | 5 | 3 |
| guard | 6 | 2 |
| bug | 3 | 3 |
| infra | 6 | 1 |

Current cycle: **3**

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
- **C3 (deep-review → bug)** — Fanned out 2 parallel Explore agents (Sheets restore path +
  vehicle Overview/ExpensesTable). The Sheets agent surfaced a REAL data-safety bug
  (quality-bar #1): the Sheets backup writes each table through a HAND-MAINTAINED column
  list (`getXHeaders()`), and `expenses.clientId` (the offline-sync idempotency key) was
  missing — so it was silently dropped on every Google Sheets backup→restore round-trip
  and restored as null, while the schema-derived CSV path preserved it. Verified firsthand
  + computed the full drift across all 15 tables (clientId was the ONLY one). Bugs jump the
  queue → fixed this cycle: (1) centralized the 15 header arrays into one exported
  `SHEET_HEADERS` map (single source of truth; deleted the 15 dead getters), added
  `clientId`; (2) committed `sheets-header-coverage.test.ts` — a schema-vs-headers superset
  guard (cycle-208/209 pattern) that bites today and pins the whole drift class. Verified:
  tsc 0 errors · Biome (musl) clean · 846 pass/0 fail (incl. the real Sheets round-trip
  test, now carrying clientId) · build bundled. The UI agent's findings are filed as
  backlog items (none data-safety; logged below). marks this cycle infra-light, product-real.
  Next cycle: `feature` (budget 4) and `infra` (CLAUDE.md stale refs) are the most starved.
  Prefer the cheap `infra` (CLAUDE.md still says "Biome can't run" + points at gitignored
  STATUS.md/LOOP.md — wrong for a fresh clone), or pick up a UI deep-review finding as a `bug`.
