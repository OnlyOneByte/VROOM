# BACKLOG — VROOM autonomous loop

> Re-ranked every cycle. Pick the top unblocked item in the most-starved over-budget
> category (see LEDGER balance check); else the highest-leverage item overall.
> Keep this lean — prune done items, promote what the last cycle surfaced.

## Categories & starvation budgets
A category may go at most **N cycles** untouched before it MUST be picked next.

| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (often needs a spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits of already-shipped work. |
| **guard** | 6 | Merge-surviving regression prevention (committed tests, source-scans). |
| **bug** | 3 | A concrete defect found in review or reported. Always jump the queue when real. |
| **infra** | 6 | Loop tooling, harness, CI, docs that keep the machine running. |

`bug` has the tightest budget on purpose: a known defect should never sit.

---

## Ranked queue (top = next)

### feature
1. **Maintenance-schedule reminders** — spec DRAFTED C4 (`.kiro/specs/maintenance-schedule/`,
   requirements+design+tasks). **BLOCKED on Angelo's D1–D6 sign-off** (flagged via send_message
   C4). Once ratified, build is backend-first per tasks.md T1–T9. *(highest user value; reuses the
   reminders + odometer engines; adds a mileage trigger axis + canonical current-odometer helper.)*
2. **Import from other trackers** — spec DRAFTED C9 (`.kiro/specs/import-trackers/`). **BLOCKED on
   Angelo's D1–D5 sign-off** (flagged C9). Design: a server-side mapping pre-pass → VROOM-native CSV
   → the UNCHANGED hardened import pipeline (inherits cycle-8 idempotency/atomicity + formula/tenant
   safety). Backward-compatible route extension. Build per tasks.md T1–T6 once ratified.
3. **Recurring expenses** beyond reminders — first-class recurring (insurance premium, loan
   payment, parking pass) with frequency + dashboard surfacing.

### deep-review
1. **Eyes-on sweep: vehicle Overview tab + ExpensesTable populated states** (mobile +
   desktop) — code-reviewed C3 (findings below); still wants a real eyes-on screenshot pass.
2. **Analytics route eyes-on** (per-vehicle + cross-vehicle + year-end), states + a11y.
- ~~**Backend: Sheets restore path**~~ — *DONE C3: found + fixed the clientId column-drop
  data-loss bug; added the schema-vs-headers coverage guard. CSV path confirmed safe.*

### guard
*(queue empty — both seeded items shipped. Re-populate as reviews surface new bug classes.)*
- ~~**EUR/unit visual guard**~~ — *already built before the loop (insurance-currency-label +
  vehicle-form-unit-defaults e2e); confirmed cycle 2.*
- ~~**Category-grid no-wrap guard**~~ — *DONE cycle 2: committed source-scan
  `category-selector-labels.test.ts` (merge-surviving, single-word invariant) + runtime
  e2e `expense-category-nowrap.meshclaw.e2e.ts` (untracked).*

### bug
*(surfaced by the C3 vehicle-detail UI review — ranked by severity; all real, none data-safety)*
1. **Vehicle-detail load failure masquerades as empty state** — `loadSummary`/`fetchExpensesPage`
   in `vehicles/[id]/+page.svelte` only toast on failure, leaving `summary=null`/`expenses=[]`
   → renders "No expenses yet" instead of an error+retry. Same class fixed for dashboard/expenses;
   add a `*LoadError` flag + retry surface. (medium)
2. **Vehicle-detail Expenses tab: page-local search/category filter over a 20-row server slice**
   while header reads "All Expenses ({totalCount})" — matches on other pages invisible; the
   in-table category Select is uncontrolled here (no `onCategoryChange`). Wire server-side
   filtering (as `/expenses` does) or hide the controls when paginated. (medium)
3. **Interpolated Tailwind `h-[{…}]` may no-op** — `ExpensesTable.svelte` ScrollArea
   `class="h-[{scrollHeight}]"` + `ExpenseTrendChart.svelte` `h-[{CHART_HEIGHT}px]` aren't literal
   class strings, so Tailwind v4 may not generate them (ScrollArea loses its 600px scroll cap).
   Use inline `style="height: …"` like ChartCard. (low, overflow — verify in-browser first)
4. **ExpensesTable combined-row re-sort lacks an id tiebreaker** — same-date/amount rows can
   reorder vs the server's id-tiebroken order. Cosmetic flicker. (low)

*(surfaced by the C7 backend deep review — CSV import + analytics math; ranked by severity)*
5. **`buildMonthlyConsumption` shows OLDEST 12 months** — `analytics-charts.ts:~221` `.slice(0,12)`
   after ascending sort (every sibling uses `.slice(-N)`), so >12 months of data hides the recent
   period. Use `.slice(-12)`. (correctness, med — clean one-liner + test)
6. **CSV import: no UTF-8 BOM strip** — `import-csv.ts:~245` `parse()` lacks `bom:true`; an
   Excel/Sheets-edited export (BOM-prefixed) fails EVERY row with a misleading "Invalid date".
   Add `bom: true`. (correctness, med — clean one-liner)
7. **CSV import: date-only cells midnight-UTC** (`import-csv.ts:~120` `new Date(raw)`) + **currency
   column silently ignored** on import — same class as C6; foreign/edited files commonly use
   date-only and other currencies. (correctness, med)
8. **Analytics month bucketing uses local-tz `getMonth()`** (`analytics-charts.ts toMonthKey:~131`
   + heatmap/TCO/day-of-week/seasonal) — backend twin of the C6 class; benign if server runs UTC,
   real on a negative-offset host. Verify deploy TZ first, then bucket on UTC. (correctness, low-med)
- ~~**CSV import: missed-fillup corrupts MPG/cost charts**~~ — *DONE C10: shared validMilesBetween
  guard (skip missedFillup either-row + over-cap gap) in accumulateFuelRow + accumulateCostPerMile;
  pinned by 5 unit tests.*
- ~~**CSV import: no idempotency + non-atomic commit**~~ — *DONE C8: deterministic per-row
  clientId + createIdempotent-style dedup, all inserts in one db.transaction (importExpenses);
  pinned by 2 HTTP tests (re-import no-op, identical-rows-both-import).*
- ~~**Analytics totalDistance pooled across vehicles**~~ — *DONE C7: buildFuelStatsFromData now sums
  per-vehicle max-min; pinned by a two-vehicle regression test.*
- ~~**Month-trend dates parsed midnight-UTC**~~ — *DONE C6: routed vehicle-detail + dashboard
  through parseMonthToDate; pinned by a helper unit test + the no-utc-month-parse source-scan guard.*

### infra
*(queue empty — repopulate as loop tooling / docs needs surface.)*
- ~~**CLAUDE.md stale refs**~~ — *DONE C5: corrected Biome (musl works), branch convention
  (claude-loop-dev), STATUS.md→loop/ pointers, refreshed state/gaps. All claims verified.*
- ~~**`loop/` scaffold + push.sh**~~ — *DONE cycle 1.*
