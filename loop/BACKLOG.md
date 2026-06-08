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
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, extract shared helpers, tighten layer boundaries, kill dead code, simplify, cut complexity. NOT new behavior (that's `feature`), NOT defect fixes (that's `bug`). |
| **infra** | 6 | Loop tooling, harness, CI, docs that keep the machine running. |

`bug` has the tightest budget on purpose: a known defect should never sit. `arch` at 5
keeps structural improvement firing regularly — it compounds in value, and the per-cycle
size cap (rule 1) keeps each increment small enough that frequent picks stay safe.

### `arch` rules (READ before any arch increment — refactors are the highest-risk work here)
1. **One coherent refactor per cycle, small.** A single rename / extract / merge / delete
   with a clear before→after. Never a sweeping multi-file rewrite. If it can't be ONE
   reviewable commit, it's too big — split it, or escalate per rule 6.
2. **Behavior-preserving, full stop.** No observable change to API, UI, or stored data. If
   you *want* to change behavior, it's a `bug` or `feature`, not `arch`.
3. **Test-anchored both ways (green → green).** The touched code must already have tests
   that pass BEFORE and pass UNCHANGED AFTER. If coverage is missing, the increment is to
   ADD the characterization test FIRST (that cycle counts as `arch`/`guard`), THEN refactor
   next cycle against the safety net.
4. **Verify the full gate** every time: tsc 0 · musl biome clean · `bun test` green ·
   `bun run build`. For any UI-touching refactor also run `regress.sh` + an eyes-on
   screenshot and diff before/after — a refactor must not move a pixel.
5. **No churn-for-churn.** Never reformat / re-order / rename for taste alone. Every arch
   item must name a concrete payoff: removes duplication, deletes dead code, unblocks a
   queued feature, drops a complexity score under the Biome max, or collapses N sources of
   truth into one.
6. **Big restructures need sign-off.** A cross-cutting change (new layer, dependency-flow
   inversion, schema/money-type migration, framework/lib swap) is a DIRECTION call: write a
   short `.kiro/specs/<refactor>/design.md`, `send_message` Angelo, and move on — never
   self-authorize a structural change of that size.
7. **Audits use fan-out.** To FIND arch work, spawn 2–3 parallel Explore agents (e.g.
   backend layer-boundary + duplication; frontend component/store duplication; dead-code +
   cyclomatic-complexity hotspots). Triage their findings into the `arch` queue below.
   Finding ≠ doing: file them, then execute only the single top item this cycle.

---

## Ranked queue (top = next)

### feature
1. **Maintenance-schedule reminders** — spec APPROVED (Angelo signed off D1–D6, cycle 12). **BUILD
   GO**, backend-first per `.kiro/specs/maintenance-schedule/tasks.md` T1→T9 (migration → current-
   odometer helper → whichever-comes-first due logic → routes/validation + mark-serviced → Sheets-
   header coverage → frontend → e2e). Highest user value; reuses the reminders + odometer engines.
2. **Import from other trackers** — spec APPROVED (Angelo signed off D1–D5, cycle 12). **BUILD GO**,
   backend-first per `.kiro/specs/import-trackers/tasks.md` T1→T6. Server-side mapping pre-pass →
   VROOM-native CSV → the UNCHANGED hardened import pipeline (inherits cycle-8 idempotency/atomicity
   + formula/tenant safety). Backward-compatible route extension.
3. **Recurring expenses** beyond reminders — first-class recurring (insurance premium, loan
   payment, parking pass) with frequency + dashboard surfacing.

> NOTE (cycle 12): both feature builds are large, MULTI-TASK efforts — one tasks.md task per loop
> cycle, not one-and-done. They no longer gate the loop; pull T1 of the higher-value
> maintenance-schedule next time `feature` is the balance pick. Also new: standing TODO Misc goal —
> raise test coverage to 90% (frontend ~59% / backend ~74% today); fold into bug/guard/arch cycles.

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
5. **CSV import: no UTF-8 BOM strip** — `import-csv.ts:~245` `parse()` lacks `bom:true`; an
   Excel/Sheets-edited export (BOM-prefixed) fails EVERY row with a misleading "Invalid date".
   Add `bom: true`. (correctness, med — clean one-liner)
6. **CSV import: date-only cells midnight-UTC** (`import-csv.ts:~120` `new Date(raw)`) + **currency
   column silently ignored** on import — same class as C6; foreign/edited files commonly use
   date-only and other currencies. (correctness, med)
7. **Analytics month bucketing uses local-tz `getMonth()`** (`analytics-charts.ts toMonthKey:~131`
   + heatmap/TCO/day-of-week/seasonal) — backend twin of the C6 class; benign if server runs UTC,
   real on a negative-offset host. Verify deploy TZ first, then bucket on UTC. (correctness, low-med)
- ~~**buildMonthlyConsumption shows OLDEST 12 months**~~ — *DONE C11: slice(0,12)→slice(-12) in
  buildMonthlyConsumption + the latent buildConvertedEfficiencyTrend copy; pinned by 2 unit tests.*
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

### arch
*(NEW category. Three concrete items seeded below from a quick grounding scan — verify each
against current source before acting, then knock out the top one. Once these are done (or to
go broader), run the AUDIT fan-out per rule 7 to repopulate. Obey the `arch` rules above —
behavior-preserving, test-anchored, ONE small reviewable refactor per cycle.)*

1. **Dedup ownership-validation: one source of truth.** `validateEntityOwnership` in
   `backend/src/api/photos/helpers.ts` carries a PRIVATE `validateExpenseOwnership` copy and
   re-inlines vehicle / insurance-policy / insurance-claim ownership checks that already exist
   as exported helpers in `backend/src/utils/validation.ts` (`validateVehicleOwnership`,
   `validateExpenseOwnership`, `validateInsuranceOwnership`). Two ownership-check
   implementations that can DRIFT is a security-adjacent smell (one could be fixed and the
   other not). Refactor: route the photos `entityType` switch through the shared validators
   (keep the direct-`photos.user_id` `validatePhotoOwnership` as-is — it's a genuinely
   different check on an existing-photo row). Behavior-preserving: same `NotFoundError`
   per branch. **Test-anchor first**: the cross-tenant IDOR HTTP suite already exercises
   photo-upload ownership — confirm it covers all four entityTypes; add the missing
   characterization cases BEFORE refactoring if not. (highest value: dedup + safety)
2. **Converge route error handling on the central error middleware.** `sync` (7 try/catch),
   `auth` (7), and `settings` (5) route handlers hand-roll try/catch→error-response blocks,
   while `expenses` and `providers` (1 each) lean on the shared Hono error middleware
   (`backend/src/middleware/`) + typed errors (`NotFoundError`/`ValidationError`/…). The
   hand-rolled blocks are boilerplate that can diverge from the canonical error envelope.
   Refactor ONE route file per cycle (start with `sync`): drop the try/catch, throw the typed
   error, let the middleware shape the response. Behavior-preserving: assert identical status
   + body via the route's HTTP test (add coverage first if a handler is untested). (consistency)
3. **Extract the frontend page load-state pattern.** ~14 `+page.svelte` files repeat the same
   `isLoading` / `loadError` / `try → fetch → catch → toast + set error` triad (dashboard,
   expenses, reminders, insurance, analytics, vehicles/[id], settings, profile, …) — the exact
   class the `bug` queue keeps re-finding per page (load-failure-masquerades-as-empty-state).
   Extract a shared helper/runes pattern (e.g. a `createLoadState<T>()` or a small
   `<LoadBoundary>` snippet wrapping loading/error/retry) and migrate ONE page per cycle onto
   it. Behavior-preserving per page; prove with that route's smoke + an eyes-on screenshot
   (no pixel moves). Bonus: structurally prevents the masquerade bug class. (dedup + bug-class
   prevention; do AFTER bug #1 fixes vehicle-detail so the helper reflects the correct shape)

Seed audit angles for the rule-7 fan-out (once the above are done, or to go broader):
- **Backend layering** — route handlers doing repository/business logic inline; missing or
  leaky service layer; raw Drizzle queries outside repositories; cross-domain imports.
- **Duplication** — copy-pasted logic that should be one shared helper (the recurring win
  here: `buildExpenseConditions`, `validMilesBetween`, `parseMonthToDate`, `SHEET_HEADERS`
  were all "N copies → one source of truth" — find the next one).
- **Frontend** — near-duplicate components/stores; bespoke widgets that should compose from
  the kit; repeated fetch/error/loading boilerplate that wants a shared pattern.
- **Dead code & complexity** — unreferenced exports/files, `noExcessiveCognitiveComplexity`
  hotspots near the Biome ceiling, deeply-nested conditionals worth flattening.

### infra
*(queue empty — repopulate as loop tooling / docs needs surface.)*
- ~~**CLAUDE.md stale refs**~~ — *DONE C5: corrected Biome (musl works), branch convention
  (claude-loop-dev), STATUS.md→loop/ pointers, refreshed state/gaps. All claims verified.*
- ~~**`loop/` scaffold + push.sh**~~ — *DONE cycle 1.*
