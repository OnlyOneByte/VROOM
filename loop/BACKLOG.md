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
2. **Import from other trackers** — CSV import from Fuelly/Fuelio/Drivvo/etc. (VROOM-native
   CSV round-trip already ships; this is mapping foreign schemas). Needs per-source column
   mapping design.
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
2. **Month-trend dates parsed midnight-UTC** — `vehicles/[id]/+page.svelte:~95`
   `new Date(item.period + '-01')` shifts the Expense-Trend x-axis label back a month for
   negative-offset users. Fix: use `parseMonthToDate(item.period)` (already used everywhere else).
   (medium, one-line)
3. **Vehicle-detail Expenses tab: page-local search/category filter over a 20-row server slice**
   while header reads "All Expenses ({totalCount})" — matches on other pages invisible; the
   in-table category Select is uncontrolled here (no `onCategoryChange`). Wire server-side
   filtering (as `/expenses` does) or hide the controls when paginated. (medium)
4. **Interpolated Tailwind `h-[{…}]` may no-op** — `ExpensesTable.svelte` ScrollArea
   `class="h-[{scrollHeight}]"` + `ExpenseTrendChart.svelte` `h-[{CHART_HEIGHT}px]` aren't literal
   class strings, so Tailwind v4 may not generate them (ScrollArea loses its 600px scroll cap).
   Use inline `style="height: …"` like ChartCard. (low, overflow — verify in-browser first)
5. **ExpensesTable combined-row re-sort lacks an id tiebreaker** — same-date/amount rows can
   reorder vs the server's id-tiebroken order. Cosmetic flicker. (low)

### infra
1. **CLAUDE.md stale refs** — it points at `STATUS.md` / `.meshclaw-autopilot/LOOP.md`, now
   gitignored/removed; and says "Biome can't run" (the musl binary works). Reconcile so a
   fresh clone orients correctly.
2. **`loop/` scaffold + push.sh** — *DONE cycle 1.*
