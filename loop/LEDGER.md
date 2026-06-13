# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.
>
> **COVERAGE TREND (loop-improvement #4): end every cycle-log entry with a `cov:` tag** —
> `cov: be <pct>% / fe <pct>%` (the last reading; carry the prior numbers forward + mark
> `~` if you didn't re-measure this cycle). Re-measure (`bun test --coverage` / vitest
> `--coverage`) at least on guard/arch/bug cycles that touch a module. The standing goal is
> 90% both sides. **MEASURED BASELINE (C81, the first real reading — the rule had silently
> lapsed C52–C80, no entry carried a cov: tag): be 77.8% line / 76.9% func · fe 63.7% line /
> 60.6% func / 56% branch** (both up from the long-stale ~74%/~59% estimates, confirming the
> test-adding cycles moved the needle — just unmeasured). **RE-MEASURED C107 (the cov: tags had
> carried forward stale `~81%/~64%` estimates since C81 through 25+ ratchet cycles — a true reading
> was overdue): be 81.10% line / 81.84% func (up ~+4 from C81 — the C82–C106 ratchet delivered) ·
> fe 61.41% line / 59.31% func / 52.24% branch (essentially FLAT vs C81's 63.7%, even slightly down
> — frontend product code [components/routes] OUTGREW its tests; FE is now decisively the bigger
> gap).** **RE-MEASURED AGAIN C124: be 81.78% line / 82.17% func (creeping up — C111/C116/C121/C122/C123
> backend tests); fe 62.03% line / 60.48% func / 52.47% branch (creeping up — the C118 memoize + C119
> capitalize FE ratchet; STILL the bigger gap).** **RE-MEASURED AGAIN C138 (the #5-sweep coverage re-measure): be 82.25% line /
> 81.81% func (line creeping up — C136 restore guard etc.; func ~flat as product code grew); fe 65.32% line / 61.76% func /
> 58.70% branch (UP +3.3 line / +6.2 branch from C124 — the C125 vehicle-form + C130 formatters + C134 reminder-api + C137
> error-handling FE ratchet arc DELIVERED; still the bigger gap but closing).** **RE-MEASURED AGAIN C152 (the #5-sweep
> coverage re-measure): be 82.02% line / 82.51% func (func up from C138's 81.81%; +25 BE tests C139–C151); fe 70.09% line /
> 66.77% func / 62.85% branch (UP +4.8 line / +4.2 branch from C138 — the C143 api-client + C149 expense-api service-layer
> ratchet BROKE 70% line for the first time; FE still the bigger gap but closing fast).** **RE-MEASURED AGAIN C164 (the #5-sweep
> re-measure): be 82.70% line / 82.51% func (line up from C152's 82.02 — the C154–C162 BE fixes); fe 70.18% line / 66.88% func /
> 62.85% branch (the C163 reminder-api ratchet — FE SERVICE LAYER now FULLY covered: api-client/expense-api/reminder-api/error-
> handling; remaining FE gap is the components/routes deficit, largely eyes-on).** **RE-MEASURED AGAIN C176 (the #5-sweep re-measure):
> be 82.74% line / 82.49% func (line creeping up from C164's 82.70 — the C167–C174 BE fixes); fe 73.89% line / 73.61% func / 66.08%
> branch (UP SHARPLY +3.7 line / +6.7 func / +3.2 branch from C164 — the C166 settings-store + C169 settings-api + C175 pwa.ts FE
> ratchets delivered; FE still the bigger gap but closing fast).** **RE-MEASURED AGAIN C186 (the #5-sweep re-measure): be 83.41% line /
> 83.74% func (up from C176's 82.74/82.49 — the C178/#25 + C180/#48 + C181/orchestrator + C184/#26c + C185/analytics-routes BE
> additions); fe 73.89% line / 73.61% func / 66.08% branch (FLAT vs C176 — every C178–C185 cycle was backend, so FE didn't move).** **RE-MEASURED AGAIN C196 (the #5-sweep re-measure): be 84.08% line / 84.44% func (up from C186's 83.41/83.74 — the C188 sync-routes + C190/#62 + C192/#63 + C195 activity-tracker additions); fe 73.89% line / 73.61% func / 66.08% branch (FLAT vs C186 — C188–C195 all backend). FRESH FE LOW SPOTS to steer the next FE guard cycle: a ~15% form-validation module (pure logic — cleanest pick), analytics-api.ts ~36% func, sync-manager.ts ~56% (timer/network-bound), auth.ts ~56%; settings.svelte.ts ~11% is the filed handleError arch pick.** **RE-MEASURED AGAIN C203 (the #5-sweep re-measure): be 84.06% line / 84.43% func (FLAT vs C196's 84.08/84.44 — C198/C201/C202 all FE, only C200 touched BE +3); fe 77.79% line / 75.57% func / 72.96% branch (UP SHARPLY +3.9 line / +2.0 func / +6.9 branch vs C196 — the C198 lease-metrics + C201 form-validation [+19] + C202 offline-storage [+2] FE ratchet delivered; the BE↔FE gap is narrowing to ~6pts). REMAINING FE LOW SPOTS (form-validation now DONE C201): analytics-api.ts ~36% func, sync-manager.ts ~56% (timer/network-bound), auth.ts ~56%; the C199-primed `calculatePayoffDateFromStart` is the next clean FE guard pick.** **RE-MEASURED AGAIN C213 (the #5-sweep re-measure): be 84.14% line / 84.49% func (up slightly from C203's 84.06/84.43 — the C206 #67 + C209 #68 + C210 #70 + C211 parseClampedInt BE additions); fe 79.22% line / 78.89% func / 73.52% branch (UP +1.4 line / +3.3 func vs C203 — the C207 payoff-date [+12] + C212 analytics-api [+19] FE guard ratchet; the FE SERVICE layer is now FULLY covered, analytics-api was the last gap [C212]). BE↔FE gap NEARLY CLOSED — 84 vs 79. REMAINING FE LOW SPOTS: auth.ts ~56% (next clean guard pick), sync-manager.ts ~56% (timer/network-bound — less clean); the rest is the components/routes deficit (largely eyes-on).** **RE-MEASURED AGAIN C224 (the #5-sweep re-measure): be 84.25% line / 84.60% func (up from C213's 84.14/84.49 — the C214 #71 + C218 #73 + C220 #74 + C221/C222 BE additions); fe 80.33% line / 79.87% func / 74.45% branch (CROSSED 80% line; UP +1.1 vs C213 — the C217 auth requireAuth [+4] + C223 sync-manager conflict-classification [+4] guard ratchet). BE↔FE gap ~4pts (84 vs 80). The FE pure/service modules are now essentially ALL covered (auth C217 + sync-manager's clean slice C223 were the last); the remaining FE gap is the components/routes deficit (eyes-on) + the network/timer-bound retry tails (C163 mock-trap, low-value) — so the next FE guard cycles are thin; prefer BE low spots or eyes-on-blocked-acknowledged.** **RE-MEASURED AGAIN C303 (the #5-sweep re-measure; last full re-measure C258, with C285 a CLAUDE.md-only spot-reading): be 86.07% line / 86.21% func (up from C285's 85.74/86.04 — the C283/C289/C291/C294/C300/C302 BE test arc: auth-config, plate-uniqueness, orchestrator skip-paths, ownership-404, restore prefs-collision + the symmetry guard); fe 81.76% line / 80.70% func / 75.70% branch (up from C285's 81.41/80.64/75.20 — the C295 lease-overage + C296 invariance + C297 0%-APR planner FE tests). BOTH sides now >80% line, BE↔FE gap ~4–5pts and stable. The 90%-line goal remains structurally gated: BE tail is DI/singleton-bound + OAuth network paths; FE gap is the eyes-on components/routes deficit (Playwright-blocked). The loop has driven what's reachable without an unblocked E2E.** **RE-MEASURED AGAIN C323 (the #5-sweep re-measure; last full C303): be 86.53% line / 86.21% func (line up from C303's 86.07 — the C304–C321 BE arc: fetchTermsAndCoverage cert, clampPagination dedup, the term-premium-replacement + both-axis-coexistence + vehicle-orphan + idempotency-nonJSON + missedFillup guards); fe 84.39% line / 83.97% func / 76.43% branch (UP SHARPLY +2.6 line / +3.3 func / +0.7 branch vs C303 — the C308 settings-error + C314 api-client-dedup + C319 settings-state-contract FE arc; settings.svelte.ts climbed from ~12%). BE↔FE gap now ~2pts (86.5 vs 84.4) — the tightest ever. The 90%-line goal stays structurally gated (BE tail DI/singleton + OAuth-network; FE gap the eyes-on components/routes deficit, Playwright-blocked) — the loop keeps closing the reachable remainder.** **RE-MEASURED AGAIN C351 (the #5-sweep re-measure; last full C323): be 86.25% line / 86.67% func (line ~flat/−0.3 vs C323's 86.53 as product code grew, func +0.5 — the C341/C350 analytics-invariant + C349 provider guards); fe 84.17% line / 83.9% func / 76.32% branch (~FLAT vs C323's 84.39/83.97/76.43 — the C336/C342 zero-coverage store sweep [themeStore+appStore] + C347 offline-dropout-class pin HELD the line as components grew). BE↔FE gap stable ~2pts (86.3 vs 84.2). The FE service+pure-util+STORE layers are now all covered; remaining FE gap is the eyes-on components/routes deficit + the network/timer mock-trap tails. 90%-line goal still structurally gated; the loop has driven the reachable remainder flat.** **RE-MEASURED AGAIN C368 (the #5-sweep re-measure; last full C351): be 86.68% line / 86.26% func (line
> +0.43 vs C351's 86.25 — the C353–C367 BE arc: groupOwnedBy/vehicleScope dedup-anchors, the #107 reminder + #108 seasonal fixes, the claim-survival + tie-tolerant
> guards — held/nudged the line up against growing product code); fe 84.45% line / 84.3% func / 76.43% branch (line +0.28 / func +0.4 vs C351's 84.17/83.9/76.32 —
> the C358 date-filter + C364 getVehicleDisplayName FE guards held the line as components grew). BE↔FE gap stable ~2pts (86.7 vs 84.5), both creeping up. The
> 90%-line goal stays structurally gated (BE tail DI/singleton + OAuth-network; FE gap the eyes-on components/routes deficit, Playwright-blocked) — the loop keeps
> the reachable remainder flat-to-up. Branch state: 178 commits ahead of origin/main, working tree clean (only by-design untracked *.meshclaw.e2e.ts + tooling),
> build floor GREEN both sides → PR-ready (escalated to Angelo C368).** **RE-MEASURED AGAIN C379 (the #5-sweep re-measure; last C368): be 86.79% line / 86.39%
> func (+0.11 line vs C368's 86.68 — the C369/C372/C376 BE additions); fe 84.39% line / 84.3% func / 76.53% branch (~FLAT vs C368's 84.45/84.3/76.43 — the
> C374/C377 FE guards held the line as components grew). BE↔FE gap stable ~2.4pts, both flat-to-up. 90%-line goal still structurally gated (BE DI/singleton +
> OAuth-network; FE eyes-on components/routes, Playwright-blocked). Branch: 189 commits ahead of origin/main, working tree clean (only by-design untracked
> *.meshclaw.e2e.ts + tooling), build floor GREEN both sides → PR-ready (standing escalation open since C368, not re-spammed — no new decision needed).** **RE-MEASURED AGAIN C389 (the #5-sweep re-measure; last C379): be 86.78% line / 86.39% func (~FLAT vs C379's 86.79/86.39 — C385/C387 added guards, C386 a
> behavior-preserving extract, no product code grew); fe 84.39% line / 84.3% func / 76.63% branch (line FLAT vs C379's 84.39, branch +0.1 — the C380 month-plural
> guard). BE↔FE gap stable ~2.4pts, both flat-to-up. 90%-line goal still structurally gated (BE DI/singleton + OAuth-network; FE eyes-on components/routes,
> Playwright-blocked). Branch: 199 commits ahead of origin/main, working tree clean (only by-design untracked *.meshclaw.e2e.ts + tooling), build floor GREEN
> both sides → PR-ready (standing escalation open since C368, not re-spammed).** **RE-MEASURED AGAIN C400 (the #5-sweep re-measure; last C389): be 86.92% line /
> 86.54% func (line +0.14 / func +0.15 vs C389's 86.78/86.39 — the C396 expense-source-ref guard + the #116/C399 reminder-endDate guard); fe 84.45% line / 84.4%
> func / 76.87% branch (line +0.06 / func +0.1 / branch +0.24 vs C389's 84.39/84.3/76.63 — the #115/C398 +12 lease-overage guards delivered). BE↔FE gap stable
> ~2.5pts, BOTH creeping up (the C396–C399 fix+guard arc held the line as product code grew). 90%-line goal still structurally gated (BE DI/singleton + OAuth-network;
> FE eyes-on components/routes, Playwright-blocked). Branch: 210 commits ahead of origin/main; working tree clean of TRACKED changes, but the #5 sweep CAUGHT an
> untracked-by-mistake item → .kiro/specs/offline-entries/ (requirements/design/tasks.md) was the ONLY feature spec not committed while ~29 siblings all track their 3
> .md docs + the offline-entries CODE foundation already shipped → committed it C400 so a fresh clone / the PR keeps the design rationale. Build floor GREEN both sides
> → PR-ready (standing escalation open since C368, not re-spammed).** When `guard`/`arch` is the pick and nothing's more urgent, STEER it to the lowest-covered,
> highest-risk module. **CURRENT concrete low spots (C107 reading):** backend — `rate-limit.ts`
> (60% line, the named-next ratchet target), `body-limit.ts` (35% line, the size-enforcement branch),
> `sync/restore.ts`/`sync/routes.ts` (~32–61%, HTTP-harness-tractable per the C91 s3-seam precedent),
> `analytics/routes.ts` (43% line — C99/C106 covered the ownership *validators*, but the GET handlers'
> full response assembly is still unexercised); frontend — the broad components/routes deficit (steer
> FE guard cycles here). OAuth providers (github/google/auth routes, 0–40%) are live-but-network-bound
> (the C85 hard-to-test class) — lower priority. Turns the 90% goal into a ratchet, not an aspiration.
> Never DROP coverage without naming why.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 170 |
| deep-review | 5 | 416 |
| guard | 6 | 414 |
| bug | 3 | 417 |
| arch | 5 | 415 |
| infra | 6 | 418 |

Current cycle: **418**

> `arch` (category added pre-C12) seeded at cycle 11; budget 5, so it first comes due
> ~cycle 16. Three concrete items are seeded in BACKLOG (no audit needed to start) — take
> the top one (dedup ownership-validation). Run the rule-7 audit fan-out once those clear.

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
- **C4 (feature → spec)** — `feature` was over budget (never touched, budget 4), so the rule
  forced a feature pick. Its first loop phase is SPEC (build gated on Angelo sign-off), so the
  increment is the spec, not code. Fanned out 2 Explore agents to scope the reuse surface:
  (1) reminders engine is 100% time-based; mileage was never scoped/deferred; `reminder_vehicles`
  junction + notification feed + ReminderForm/DueRemindersCard are reusable. (2) odometer is a
  bare integer in the vehicle's distance unit (convert-on-read, no canonical unit); NO
  "current odometer" helper exists (two competing notions: fuel-only `vehicle-stats.currentMileage`
  vs the date-ordered `getHistory` UNION). Drafted `.kiro/specs/maintenance-schedule/`
  {requirements,design,tasks}.md: extend reminders with a `triggerMode` + nullable mileage columns
  (additive), a new max-by-value `getCurrentOdometer` helper, whichever-comes-first OR-logic,
  mark-serviced re-arm, mileage-recheck-on-write, and R9 backup/Sheets-header coverage. Six open
  product decisions (D1–D6) flagged for sign-off; recommended option given for each; tasks.md is
  BLOCKED on T0. Flagged Angelo via send_message; did NOT block — moved on.
  Verify (spec-only): cross-checked D1–D6 referenced consistently across all three files +
  file:line groundings from the scoping pass. No build (no code).
  Next cycle: with feature freshly touched, `infra` (cyc 1, budget 6) and `guard` (cyc 2) are
  the next most-starved; or pick up a UI-review `bug` (the month-trend midnight-UTC date is a
  cheap one-liner). The maintenance build itself stays blocked until D1–D6 sign-off.
- **C5 (infra)** — Reconciled CLAUDE.md stale refs that actively mislead a fresh agent
  (most-starved category). Four fixes, each verified against reality: (1) the "Biome CLI can't
  run, fix by hand" claim → corrected to "use the musl binary" (`cli-linux-arm64-musl/biome`,
  confirmed v2.4.16 runs; the glibc one `bun run check` calls is dead) + a VERIFY note that
  `validate` fails only at `check`. (2) Branch convention `autopilot/<task>` → the long-lived
  `claude-loop-dev` branch; dropped the "inherited from .meshclaw-autopilot/LOOP.md" header
  (that file is gitignored now). (3) "read STATUS.md, kept current each cycle" → read the tracked
  `loop/{NORTH_STAR,BACKLOG,LEDGER}.md`; noted STATUS.md/BRANCH_REVIEW.md/.meshclaw-autopilot are
  gitignored and absent from a fresh clone. (4) Refreshed the highlights/gaps (insurance, CSV,
  Sheets-header guard, maintenance spec awaiting sign-off). Verified: musl biome runs; loop/ +
  the sheets guard are tracked; STATUS.md/BRANCH_REVIEW.md are NOT tracked. Docs-only, no build.
  Next cycle: `guard` (cyc 2, budget 6) is now most-starved, then `deep-review` (cyc 3). A
  cheap, high-value option is the month-trend midnight-UTC `bug` (one-line parseMonthToDate fix
  + a guard) — pairs a starved `bug`/`deep-review` finding with a regression guard.
- **C6 (bug + guard)** — Fixed the month-trend midnight-UTC date bug (C3 UI-review finding #2;
  `bug` was at-budget, `guard` most-starved — one increment advances both). `new Date(period +
  '-01')` parses as midnight UTC → x-axis month label shifts back one for negative-offset users.
  Routed through the sanctioned local-time `parseMonthToDate` on the vehicle-detail page.
  Added TWO committed (merge-surviving) guards: (1) a `parseMonthToDate` unit test in
  chart-formatters.test.ts (the helper had ZERO coverage despite every chart relying on it),
  pinning local-midnight + correct rendered month; (2) a source-scan guard `no-utc-month-parse`
  (cycle-205/206 pattern) that fails if any source reintroduces `new Date(<expr> + '-01')`.
  The guard immediately EARNED ITS KEEP: it caught a SECOND live instance I'd missed —
  dashboard/+page.svelte:87 `new Date(\`${t.period}-01\`)` — same bug, now fixed too. Tightened
  the regex to exclude full literal dates (`'2024-01-01'`) so it flags only the concat/interp
  antipattern. Verified: 6/6 new tests green, tsc 0 errors, build done, no remaining offenders.
  Next cycle: `deep-review` (cyc 3, budget 5) is now most-starved → take an eyes-on UI sweep
  (vehicle Overview/ExpensesTable, or analytics route) or a backend correctness audit. The
  remaining UI-review bugs (load-masquerade error state, page-local vehicle-detail filter,
  interpolated h-[…]) are still queued.
- **C7 (deep-review → bug + guard)** — Fanned out 2 Explore agents (CSV-import correctness +
  analytics aggregation math). Both surfaced real bugs. Fixed the HIGHEST-severity one:
  `buildFuelStatsFromData` (analytics/repository.ts) pooled odometer readings across ALL
  vehicles into one max-min, so a multi-vehicle user saw a garbage `totalDistance` on the
  dashboard summary (e.g. cars at 12k + 95k mi → ~83k "driven"). Wrong-but-plausible, on the
  most-viewed surface. Fixed by grouping per vehicle and summing per-car ranges (mirrors the
  existing computeConvertedTotalDistance). Pinned with a deterministic two-vehicle regression
  test in fuel-stats.property.test.ts (1000+500 → 1500, not pooled 80500). Single-vehicle path
  unchanged. Verified: 847 pass/0 fail (+1), tsc 0, Biome musl clean, build bundled.
  The reviews surfaced more REAL bugs now queued (see BACKLOG bug list): CSV-import has no
  idempotency (re-import duplicates rows), non-atomic partial commit, no BOM strip (Excel-edited
  files fail wholesale), date-only midnight-UTC, currency column ignored; analytics has
  missed-fillup MPG/cost-chart corruption, buildMonthlyConsumption slice(0,12) showing OLDEST
  months, and local-tz month bucketing. Several are data-safety — strong candidates next cycles.
  Next cycle (8): nothing over budget (deep-review & bug both fresh at 7, guard 6, infra 5,
  feature 4 → feature starved-for 4 = AT budget, breaches at cycle 9). Prefer the highest-value
  queued `bug` (CSV-import BOM strip is a clean low-risk one-liner; idempotency / missed-fillup
  MPG are higher-severity data-safety) — or take `feature` before it breaches if maintenance
  sign-off has landed.
- **C8 (bug — data-safety, 2 HIGH)** — Closed the two HIGH CSV-import data-safety bugs from C7's
  review, which live in the same commit path (one coherent increment). (1) NO idempotency:
  re-importing the same file used `create()` with no clientId → silently DUPLICATED every row.
  Now each ready row gets a deterministic, `csv:`-namespaced, content+occurrence-keyed clientId
  (two genuinely-identical rows both import; a re-imported file dedups perfectly). (2) Non-atomic
  commit: bare per-row insert loop → a mid-batch failure left a half-imported file. New
  `expenseRepository.importExpenses` wraps the idempotent inserts in ONE db.transaction
  (all-or-nothing) and returns {imported, duplicates}; route surfaces duplicates. Backed by the
  existing (userId, clientId) unique index. Pinned with 2 HTTP tests: re-import → imported:0/
  duplicates:3/row-count unchanged; two identical rows in one file → both import. Verified: 849
  pass/0 fail (+2), tsc 0, Biome musl clean, build bundled. Single/normal imports unchanged.
  Next cycle (9): feature breaches budget (starved-for 5 > 4) → MUST pick feature. But the
  maintenance build is blocked on D1–D6 sign-off; if unsigned, the eligible feature work is
  drafting the #2 "import from other trackers" spec (Fuelly/Fuelio mapping) or recurring-expenses
  — OR, if Angelo signed off, start maintenance T1. Check sign-off first; else draft + flag.
- **C9 (feature → spec)** — `feature` was over budget (starved-for 5 > 4) → forced pick. Checked
  remote: NO maintenance sign-off landed (no commits since C8), so that build stays blocked. Per
  spec-first, drafted the #2 feature spec instead: `.kiro/specs/import-trackers/` (import from
  Fuelly/Fuelio/Drivvo). Key design: it's a server-side header+value MAPPING pre-pass that emits a
  VROOM-native-shape CSV, then reuses the UNCHANGED buildImportPlan → importExpenses — so it
  inherits ALL the safety I just hardened (cycle-8 idempotency/atomicity, formula-neutralize,
  cross-tenant vehicle resolution, caps, per-row errors) rather than re-implementing them. Route
  extension is backward-compatible (native path unchanged when no `mapping` sent). 5 open decisions
  (D1–D5: units, category vocab, date formats, no-vehicle-column, preset set) flagged; recommended
  option each; tasks.md T0 blocks build. Verify (spec-only): D1–D5 consistent across all 3 files,
  groundings (EXPORT_COLUMNS, parseRow, importExpenses, unit-conversions) verified against source.
  Flagged Angelo (now TWO specs awaiting sign-off: maintenance D1–D6 + import-trackers D1–D5).
  Next cycle (10): feature touched (9) → most-starved becomes `guard` (cyc 6, breaches at 12) then
  `deep-review` (cyc 7). Both build queues are sign-off-blocked; plenty of queued `bug`s (missed-
  fillup MPG, slice(0,12), BOM strip) and guard/review work remain. Prefer a queued bug or a guard.
- **C10 (bug + guard)** — Fixed the missed-fill-up MPG/cost corruption (queued bug #5 from C7's
  analytics review). Two month-aggregating builders had drifted from the canonical
  computeEfficiencyPoint contract: `accumulateFuelRow` (monthly MPG) and `accumulateCostPerMile`
  (cost/distance) folded a missed/partial fill-up pair into the month — counting one tank's volume
  against two tanks' miles (inflated MPG) / spiking cost-per-distance — with no missedFillup skip
  and no MAX-miles cap. Extracted a shared `validMilesBetween(current, prev)` helper (skips
  missedFillup either-row + non-positive + over-cap gaps) and routed both through it; also keeps
  cognitive-complexity under the Biome max. Needed `missedFillup` added to GeneralExpenseRow + the
  queryAllExpenses select (column already exists, notNull default false). Pinned with 5 unit tests
  on the exported builders (missed pair → null/excluded; over-cap → excluded; clean pair → sane).
  Verified: 854 pass/0 fail (+5), tsc 0, Biome musl clean, build bundled. Valid-data paths
  unchanged (full analytics property suite green).
  Next cycle (11): `guard` is most-starved (cyc 6, breaches at 12) → prefer a guard, or the next
  queued `bug` (slice(0,12) oldest-months — clean one-liner + test; or the BOM strip). Both
  feature builds remain sign-off-blocked (maintenance D1–D6, import-trackers D1–D5).
- **C11 (bug + guard)** — Fixed buildMonthlyConsumption showing the OLDEST 12 months
  (`.slice(0,12)` after an ascending sort → hides the current period once a user has >12 months
  of fill-ups). Changed to `.slice(-12)` (most recent), matching every sibling monthly builder.
  Also fixed the latent copy in repository.ts buildConvertedEfficiencyTrend (benign today —
  year-end caps to ≤12 buckets — but same class). Pinned with 2 unit tests (14 months → latest
  12, oldest dropped; ≤12 → all, ascending). Verified: 856 pass/0 fail (+2), tsc 0, Biome musl
  clean, build bundled.
  Next cycle (12): `guard` breaches budget (last cyc 6, starved-for 6 = budget) → MUST pick a
  `guard`. The guard queue is empty, so populate it from a real bug class: candidates — a
  committed source-scan that no analytics monthly builder uses `.slice(0, N)` (would have caught
  C11), or extend `no-utc-month-parse` to the backend `toMonthKey`/import paths (bug #8 class).
  Otherwise the remaining queued `bug`s (BOM strip, date-only/currency, tz bucketing) are fair game.
- **C12 (infra)** — Balance forced it: `infra` was the only OVER-budget category (last cyc 5,
  starved-for 7 > budget 6), so the rule required it over starting a feature build. (Between C11
  and now: Angelo rebased the branch onto origin/main + signed off BOTH feature specs; I recorded
  that out-of-band — lesson saved authorizing claude-loop-dev force-push, both specs flipped to
  APPROVED/BUILD GO, 90% coverage goal added to TODO Misc, arch category added to the loop.)
  This cycle's infra increment: reconciled the one now-stale CLAUDE.md line — "drafted-but-unbuilt
  maintenance-schedule (awaiting sign-off)" → both specs APPROVED/ready-to-build + the standing 90%
  coverage goal. Same fresh-clone-orientation class as C5. Docs-only; verified the claims match
  reality (both requirements.md say APPROVED, coverage goal in TODO.md). No build.
  Next cycle (13): nothing over budget (infra now 12). Most-starved: `deep-review` (cyc 7,
  starved-for 6 > budget 5 → OVER next cycle) and `guard` (cyc 6, starved-for 7 > 6 → OVER).
  Both breach at 13 → MUST pick the more-starved: `guard` (starved-for 7). Populate the guard
  queue (e.g. the no-slice(0,N) source-scan) OR, since features are now BUILD GO and `feature`
  is also climbing (starved-for 4 at cyc 13), weigh pulling maintenance T1. Guard is forced first.
- **C13 (guard)** — `guard` was the most-starved over-budget category (last cyc 6, starved-for 7 >
  budget 6; deep-review also breached at 6 but guard was more starved). Populated the empty guard
  queue with a merge-surviving source-scan for the C11 bug class: `no-oldest-month-slice.test.ts`
  fails if any analytics month series chains a `localeCompare` month-sort into `.slice(0, N)` (keeps
  the OLDEST months / hides the current period). Anchored on `localeCompare` so it does NOT flag the
  one legit `.slice(0, 50)` (maintenance timeline, sorted NUMERICALLY by daysRemaining) — proven by
  the guard passing against source that contains both that legit slice and the fixed `.slice(-12)`
  chains. Verified: tsc 0, Biome musl clean, 858 pass/0 fail (+2), build bundled. No product code.
  Next cycle (14): `deep-review` is most-starved (cyc 7, starved-for 7 > budget 5 — OVER) → MUST
  pick it. Take an eyes-on UI sweep (vehicle Overview/ExpensesTable still un-eyes-on'd) or a backend
  correctness audit (fan out per the arch rule-7 style). `feature` (starved-for 5) breaches right
  after — maintenance-schedule T1 (the DB migration) is next once deep-review clears.
- **C14 (deep-review → bug)** — `deep-review` was most-starved over-budget (cyc 7, starved-for 7 >
  budget 5). Fanned out 2 Explore agents: (a) financing/insurance analytics correctness; (b) eyes-on
  vehicle Overview/ExpensesTable WITH real screenshots (cluster was up). The financing agent found a
  HIGH bug — `accumulateMonthlyPremiums` stepped a raw term-start Date with setMonth(+1), so a term
  starting day 29–31 OVERSHOOTS short months (Jan 31 → Mar 2/3) and SILENTLY SKIPS February's bucket
  in the insurance monthlyPremiumTrend (the C6/C11 setMonth-rollover class, ~3/12 of start dates).
  Fixed by extracting a pure `monthKeysInRange(start,end)` helper (day-1-anchored, rollover-safe) in
  analytics-charts.ts and routing accumulateMonthlyPremiums through it. Pinned with 5 unit tests
  (incl. Jan-31→Apr-30 keeps Feb; day-31 6-month term keeps all). Verified: tsc 0, Biome musl clean,
  863 pass/0 fail (+5, full analytics suite green = behavior-preserving), build bundled.
  The reviews surfaced more REAL findings now queued as `bug`s: financing — insurance shows $0 when
  only totalCost (not monthlyCost) is set; interestPaidYtd is mislabeled (1-month estimate);
  loan-breakdown holds balance flat (no amortization). UI eyes-on (CONFIRMED via screenshots) —
  mobile fuel-stat numbers wrap mid-value ($97/.80) in the 3-col dual-metric StatCardGrid; the
  ExpensesTable ScrollArea `h-[{scrollHeight}]` is a DEAD interpolated-Tailwind class (no CSS rule →
  no 600px cap, latent unbounded-growth — confirms C3's interpolated-h-[] item as real).
  Next cycle (15): `feature` is most-starved over-budget (cyc 9, starved-for 6 > budget 4) → MUST
  pick it → maintenance-schedule **T1** (the additive DB migration), the first real build increment
  of the signed-off feature. Follow tasks.md; DatabaseMigrations.md; db:init path (drizzle-kit push
  fails under bun).
- **C15 (feature → maintenance T1)** — `feature` was over budget (cyc 9, starved-for 6 > 4); both
  feature builds signed off → started maintenance-schedule build at T1. Added the 4 mileage columns
  to `reminders` (triggerMode default 'time', intervalMileage, lastServiceOdometer, nextDueOdometer)
  + dueOdometer to reminderNotifications. **Key call: DESCOPED T1 to ADDITIVE-ONLY.** The spec's
  original T1 also relaxed nextDueDate/dueDate to nullable + widened the dedup index — but that
  forces a SQLite TABLE REBUILD, and the rebuild's `DROP TABLE reminders` cascade-drops child
  reminder_notifications rows (proven: my migration-0003 survival test caught the notification row
  vanishing). Rather than ship a data-dropping migration, I split: T1 = 5× `ALTER TABLE ADD COLUMN`
  (zero data risk, generated `0003_many_jean_grey.sql`); the NOT-NULL relax moved to T3 (where the
  trigger logic actually needs a null date, and the rebuild can be written + verified carefully).
  Updated the SHEET_HEADERS (R9 / the cycle-3 guard fired on the new columns — fixed immediately,
  that's T5-partial). migration-0003.test.ts pins columns + existing-row survival + defaults.
  Verified: tsc 0, Biome musl clean, 867 pass/0 fail (+4), build bundled, full migration suite green.
  Lesson worth keeping: a single drizzle migration that BOTH adds columns AND changes a constraint
  on a parent table is dangerous (multi-rebuild → child cascade); keep migrations additive-only,
  do constraint changes in their own carefully-verified migration.
  Next cycle (16): nothing over budget (feature now 15). Most-starved: `arch` (cyc 11, starved-for
  5 = budget 5 → breaches at 17) and `deep-review`/`bug` (both starved-for 2). Prefer continuing the
  maintenance build (**T2**: getCurrentOdometer helper) since it's mid-feature and high-value, OR
  take an `arch` audit-fanout to seed that queue before it bites. Lean T2 (continue the feature).
- **C16 (feature → maintenance T2)** — nothing over budget; continued the mid-feature, high-value
  maintenance build (arch was AT budget, not over). Shipped `OdometerRepository.getCurrentOdometer`
  (design D2) = `MAX(odometer)` across a UNION of `expenses.mileage` + `odometer_entries.odometer`,
  BY VALUE not date, null when no reading, vehicle-scoped — reusing the existing `getHistory` UNION
  shape. This is the canonical "current odometer" the T3 mileage trigger needs; it reconciles the
  fuel-only `vehicle-stats.currentMileage` (which ignores manual entries + non-fuel mileage).
  Pinned by `get-current-odometer.test.ts` (8 cases). **Key call: DEFERRED the
  `vehicle-stats.currentMileage` reconcile to T3.** That field is computed inside a PERIOD-FILTERED,
  fuel-only stats route — swapping it to the all-sources/all-time MAX is a VISIBLE semantics change
  (under a 7d filter, "current mileage" would jump to the all-time odometer), not a
  behavior-preserving reconcile. Better decided deliberately in T3 next to the mileage-due consumer
  than smuggled into a helper-add cycle. Verified: tsc 0, Biome musl clean, 875 pass/0 fail (+8),
  build bundled.
  Next cycle (17): `arch` is now OVER budget (cyc 11, starved-for 6 > budget 5) → MUST pick `arch`.
  Take BACKLOG arch #1 (dedup ownership-validation: route the photos entityType switch through the
  shared validators in utils/validation.ts) — test-anchor the cross-tenant IDOR suite covers all
  four entityTypes FIRST, then refactor. Obey the arch rules (one small behavior-preserving refactor,
  green→green). Or run the rule-7 audit fan-out if arch #1 no longer grounds against source.
- **C17 (arch — safety net for arch #1)** — `arch` breached budget (cyc 11, starved-for 6 > 5) →
  forced pick: BACKLOG arch #1 (dedup ownership-validation — `photos/helpers.ts`
  `validateEntityOwnership` carries a private `validateExpenseOwnership` + inlines vehicle/policy
  checks that duplicate the exported validators in `utils/validation.ts`). Per **arch rule 3**
  (test-anchor BEFORE refactoring; if coverage is missing, ADD the characterization test first and
  that cycle counts as arch/guard), I checked existing coverage: only the `insurance_claim` case had
  an HTTP test of the ownership gate (`claim-photos-http.test.ts`); `vehicle`/`expense`/
  `insurance_policy`/`odometer_entry` were UNtested through `validateEntityOwnership`. So this cycle
  is the SAFETY NET, not the refactor: added `photos/__tests__/entity-ownership-gate.test.ts` — 14
  HTTP cases pinning the gate's observable contract for EVERY entity type (own→200, foreign-user→404
  no existence-leak, missing→404) + unknown-type→400 + anon→401. Drove it through `listPhotosForEntity`
  (a GET exercises the exact gate an upload would, no storage provider needed). The refactor (route
  the switch through the shared validators) lands NEXT cycle against this net as a pure
  behavior-preserving change — keeps each commit cleanly reviewable. Verified: tsc 0, Biome musl
  clean, 889 pass/0 fail (+14), build bundled. No product code touched.
  Next cycle (18): nothing over budget (arch now 17). Most-starved: `guard` (cyc 13, starved-for 5 →
  breaches at 19) and `deep-review` (cyc 14, starved-for 4). Highest-leverage: EXECUTE arch #1's
  refactor now that the net is in — route the photos `entityType` switch through
  `validateVehicleOwnership`/`validateExpenseOwnership`/`validateInsuranceOwnership` (keep claim +
  odometer inline; keep `validatePhotoOwnership` as-is), all 14 gate tests must stay green. That's an
  `arch` pick again but it's the natural completion; alternatively take the starved `guard`/`deep-review`.
  Lean: complete arch #1 (the net exists, the value is in finishing it) UNLESS balance forces guard.
- **C18 (arch — executed arch #1)** — nothing over budget (infra AT 6, breaches at 19); took the
  highest-leverage item: COMPLETING arch #1 now that C17's safety net is in. Refactored
  `photos/helpers.ts` `validateEntityOwnership` to route the `vehicle`/`expense`/`insurance_policy`
  cases through the shared exported validators (`validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership` in `utils/validation.ts`) instead of three private/inlined copies.
  Deleted the duplicate private `validateExpenseOwnership` + the inlined vehicle.findByUserIdAndId and
  policy.userId checks; dropped the now-unused `expenses`/`vehicleRepository`/`insurancePolicyRepository`
  imports. Kept `insurance_claim` inline (transitive claim→policy ownership has no shared validator) and
  `odometer_entry` inline (no shared validator) and `validatePhotoOwnership` as-is (genuinely different
  check on an existing photo row). Collapsed 3 ownership impls → 1 source of truth, killing the
  drift risk (security-adjacent). Behavior-preserving: same NotFoundError per branch, proven by the
  C17 gate suite — **all 14 cases + claim's 3 stay green, full suite 889 pass/0 fail UNCHANGED**.
  Verified: tsc 0, Biome musl clean, build bundled.
  Next cycle (19): `infra` breaches budget (cyc 12, starved-for 7 > 6) → MUST pick `infra`. The infra
  queue is empty — repopulate from a real need: candidates are a CLAUDE.md/loop-doc refresh (state has
  moved: maintenance T1/T2 shipped, arch category active, 18 cycles in) or a loop-tooling improvement.
  `guard` (cyc 13, starved-for 6 = budget, breaches at 19 too) is the close runner-up but infra is more
  starved. Take infra; if the infra need is trivial, also knock the starved guard next.
- **C19 (infra)** — `infra` breached budget (cyc 12, starved-for 7 > 6) → forced pick; queue empty,
  so took the standing infra need: fresh-clone orientation accuracy. CLAUDE.md's "Current state &
  gaps" still listed both feature specs as merely "Approved & ready to build" — stale now that the
  maintenance-schedule build is mid-flight (T1 additive-migration C15, T2 getCurrentOdometer C16
  both shipped). A fresh agent would mis-orient on what's done vs pending. Rewrote that bullet to
  split the two specs by real status: maintenance-schedule **mid-build** (T1+T2 done, T3 next =
  trigger logic + the deferred nullable rebuild), import-trackers **approved, not started** (T1+).
  Same fresh-clone-orientation class as C5/C12. Verified the new claims against
  `maintenance-schedule/tasks.md` (T1 [x], T2 [~], T3 [ ]) and `import-trackers/tasks.md` (T0 [x],
  T1 [ ]). Docs-only; no build (no code touched). CLAUDE.md correctly defers category/budget detail
  to loop/BACKLOG.md (the live snapshot) — nothing stale there.
  Next cycle (20): `guard` breaches budget (cyc 13, starved-for 7 > 6) → MUST pick `guard`. Queue is
  empty → populate from a real bug class. Strong candidate: a source-scan guard for the C18 dedup —
  fail if `photos/helpers.ts` reintroduces a private/inlined ownership check instead of the shared
  validators (locks in the single-source-of-truth). Or pin another recurring class. `deep-review`
  (cyc 14, starved-for 6 > 5) also breaches — runner-up if guard is satisfied cheaply.
- **C20 (guard)** — `guard` breached budget (cyc 13, starved-for 7 > 6) → forced pick; queue empty,
  so populated it with a merge-surviving source-scan locking in the C18 ownership dedup:
  `photos/__tests__/ownership-uses-shared-validators.test.ts`. Asserts `photos/helpers.ts` (1) calls
  all three shared validators (`validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership`), (2) does NOT locally re-declare any of them (a `function`/`const`
  with that name = a private copy that can drift; import-only doesn't match), and (3) does NOT
  re-import `vehicleRepository`/`insurancePolicyRepository` (their return marks a re-inlined
  vehicle/policy ownership check — the exact pre-C18 antipattern). Leaves the genuinely-inline
  `insurance_claim`/`odometer_entry` cases + `validatePhotoOwnership` untouched (no shared validator
  exists for those). This makes the security-adjacent single-source-of-truth invariant
  MERGE-SURVIVING (an e2e/manual review wouldn't catch a silent re-duplication; a committed scan
  does). Verified: tsc 0, Biome musl clean, 893 pass/0 fail (+4), build bundled. No product code.
  Next cycle (21): `deep-review` breaches budget (cyc 14, starved-for 7 > 5) → MUST pick it. Take an
  eyes-on UI sweep (vehicle Overview/ExpensesTable still wants a real screenshot pass; or analytics
  route) or a backend correctness audit — fan out 2-3 Explore agents per the rule-7 style. `feature`
  (cyc 16, starved-for 5 > 4) breaches right after → maintenance-schedule T3 is next once deep-review
  clears. Queued bugs (#8 insurance $0, #9 interestPaidYtd, #10 flat loan balance, #11 mobile wrap,
  #3 dead ScrollArea cap, CSV BOM/date/currency) remain fair game if a review surfaces nothing worse.
- **C21 (deep-review — reminders + expenses backend audit, fan-out)** — `deep-review` breached budget
  (cyc 14, starved-for 7 > 5) → forced pick. Fanned out 2 Explore agents: (a) reminders trigger
  engine, (b) expenses/split/import math. KEY OUTCOME: VERIFIED every "HIGH/CRITICAL" finding against
  source before acting — and the top 4 were FALSE POSITIVES (this is why deep reviews verify):
  • Reminders `setDate(1)` in monthly/yearly/custom recurrence (agent: "CRITICAL, breaks end-of-month")
    — NOT a bug. `anchorDay`/`dayTarget` is captured (trigger-service.ts:71) BEFORE mutation;
    `setDate(1)` is the deliberate guard against JS month-overflow (Jan 31 +1mo → Mar 3), and
    `clampToAnchorDay` runs AFTER to restore the day clamped to the month's last day. The agent's
    "fix" (remove setDate(1)) would INTRODUCE the rollover bug. Correct as-is.
  • Expenses "split siblings double-counted in SUM" (agent: "HIGH, 2x inflated totals") — NOT a bug.
    Each sibling row stores its own per-vehicle SHARE (split-service.ts:92-110 `expenseAmount:
    allocation.amount`), so SUM(expenseAmount) over siblings = group total once (repository.ts:425
    sums expenseAmount, not groupTotal). Agent assumed both siblings carry the full amount; they don't.
  • Percentage-split "negative final allocation" — unreachable: floor() makes runningTotal ≤ true
    partial, so the last share (total−runningTotal) is always ≥ true share > 0; clamp is dead code.
  Two findings are GENUINELY REAL but minor, filed as bugs (below): (1) `fastForwardPastNow`
  (trigger-service.ts:216) ignores `endDate` — a reminder past maxCatchUp with an uncrossed endDate
  gets fast-forwarded past now without deactivating → "active" but dormant (low-med edge); (2)
  `advanceCustom` switch has no `default` → invalid intervalUnit silently no-ops (low; Zod blocks it
  at the route, defense-in-depth only). Deliberately did NOT fix #1 this cycle: it lives in the exact
  trigger code maintenance-schedule T3 rewrites (mileage axis + nullable-date rebuild) — fixing now
  then again in T3 is churn; folded it into T3's scope instead. No code touched; verification-only
  cycle (LEDGER/BACKLOG only).
  Next cycle (22): `feature` breaches budget (cyc 16, starved-for 6 > 4) → MUST pick feature →
  maintenance-schedule **T3** (whichever-comes-first trigger logic + the deferred nextDueDate/dueDate
  nullable rebuild + the T2 vehicle-stats reconcile). FOLD IN the C21 endDate-in-fastForward fix while
  rewriting that code (it's the same function). High-value, mid-feature; both feature specs signed off.
- **C22 (feature — maintenance-schedule T3, part 1: the high-risk nullable rebuild)** — `feature`
  breached budget (cyc 16, starved-for 6 > 4) → forced pick → maintenance-schedule T3. T3 is large
  (migration + trigger logic + routes + reconcile), so this cycle ships the BLOCKING GATE: the
  deferred nullable migration that everything else builds on. Angelo authorized "high risk migrations
  are fine" — so the NOT NULL relax deferred since T1 is now done properly (not deferred again), but
  SAFELY (authorized ≠ reckless). Changes: schema.ts relaxes `reminders.next_due_date` +
  `reminder_notifications.due_date` to nullable (mileage-only reminders/notifications carry no date);
  added a PARTIAL unique index `rn_reminder_odo_idx (reminderId, dueOdometer) WHERE dueOdometer IS NOT
  NULL` for the mileage dedup axis. KEY DESIGN CORRECTION vs the spec: the spec said "widen the dedup
  index to (reminderId, dueDate, dueOdometer)" — that's WRONG. SQLite treats NULLs as DISTINCT in a
  UNIQUE index, so a 3-col index with NULL dueOdometer would silently STOP deduping time-only
  reminders. Kept `(reminderId, dueDate)` for the time axis + a separate PARTIAL index for mileage;
  each axis dedups its own rows, neither breaks the other (pinned by a test that proves both).
  THE C15 FOOTGUN, CONFIRMED LIVE: the nullable relax forces a SQLite table rebuild; drizzle's
  generated 0004 does `DROP TABLE reminders` while `reminder_vehicles` + `reminder_notifications`
  still hold rows. Both children CASCADE on delete, and the generated `PRAGMA foreign_keys=OFF` is a
  NO-OP inside the migrator's transaction (connection.ts:84 wraps migrate() in a txn) — so the DROP
  would silently wipe every child row. HAND-AUTHORED 0004 instead (the documented C15 exception to
  "never edit generated SQL"; the schema is right, only drizzle's rebuild ORDER is unsafe for our FK
  topology): stash both children in FK-free `_hold_` tables → empty live children so the cascade hits
  0 rows → rebuild reminders → rebuild reminder_notifications → refill children from holding (reminder
  ids preserved → FKs resolve) → drop holding. PROOF GATE: `migration-0004.test.ts` (5 tests) applies
  0004 with foreign_keys ON inside the same BEGIN/COMMIT production uses, and asserts the reminder +
  junction row + notification ALL survive row-for-row (the exact loss the naive rebuild causes), plus
  the partial-index dedup behavior and NULL-date persistence. tsc surfaced 6 null-narrowing errors in
  trigger-service (nextDue now Date|null) → guarded: a null next_due_date means "no time axis", return
  early (findOverdue's `<= now` already excludes NULL rows via SQL 3-valued logic; this is the type
  guard + defense-in-depth). Verified: tsc 0 · musl-biome clean · 898 pass/0 fail (+5 migration
  tests, up from 893) · build bundled. No behavior change for existing time reminders (mileage-only
  reminders aren't CREATABLE yet — that's the trigger/routes work).
  Next cycle (23): `feature` still leads (just touched cyc 22, but T3 is mid-build and the loop
  continues the same feature) → T3 part 2: trigger-service whichever-comes-first due logic (OR-in
  mileage via getCurrentOdometer/nextDueOdometer + app-level dueOdometer dedup), FOLD IN the C21
  endDate-in-fastForward bug #12 (same function being rewritten), unit tests for all due/not-due
  permutations. Then T3 part 3 (routes: mark-serviced re-arm + Zod refinements + recheck-on-write +
  the deferred vehicle-stats reconcile). Watch `bug` (cyc 14, starved-for 8 >> 3) — it's the most
  starved; a queued bug (#8 insurance $0, #11 mobile wrap) can jump in if trigger work stalls.
- **C23 (bug — insurance $0 for totalCost-only terms, #8)** — BALANCE OVERRIDE: `bug` was
  starved-for 9 (cyc 23 − last-touched 14) vs budget 3 — the only over-budget category, exactly the
  watch item C22 flagged. Rule 2 is mandatory, so T3 part 2 waits one cycle and I took the
  highest-leverage standalone bug. (Bug #12 is explicitly "fold into T3" — doing it standalone now
  then again in T3 is churn, so it stays deferred.) THE BUG (#8, data, med-high): `buildInsuranceDetails`
  (`analytics/repository.ts:893`) computed `const monthlyPremium = latestTerm.monthlyCost ?? 0`. A
  term entered as a lump sum (totalCost set, monthlyCost null — e.g. "6-month policy = $1,200") then
  contributes **$0** to every premium total, per-vehicle detail, carrier total, and the monthly trend.
  totalCost was SELECTed (:1637) but never consumed. FIX: extracted an exported pure helper
  `effectiveMonthlyPremium(term)` to analytics-charts.ts — monthlyCost wins when set (incl. an
  explicit 0); else amortize totalCost across the term span via `monthKeysInRange(start,end).length`
  (the C14 day-1-anchored helper, so a day-29–31 start doesn't skip a month); 0 when neither cost nor
  a resolvable span exists. Wired into :893 as the single choke point — `buildInsuranceVehicleEntries`
  already takes `monthlyPremium` as a param and `accumulateMonthlyPremiums` reuses it, so the one-line
  swap propagates to per-vehicle/carrier/trend/totals with no other edits. Pinned by
  `effective-monthly-premium.test.ts` (7 cases: precedence, monthlyCost=0 honoured, totalCost
  amortization, day-31 no-skip, single-month, neither-set, null-span div-by-zero guard). Verified:
  tsc 0 · musl-biome clean · 905 pass/0 fail (+7, up from 898) · build bundled. No existing test
  pinned the old `?? 0` behavior (analytics+insurance suites green unchanged).
  Next cycle (24): back to `feature` (starved-for 2, but T3 is mid-build) → maintenance-schedule
  **T3 part 2**: trigger-service whichever-comes-first (OR-in mileage via getCurrentOdometer ≥
  nextDueOdometer; emit a mileage notification with null dueDate + dueOdometer, app-level dedup on
  the C22 partial index), FOLD IN bug #12 (endDate-in-fastForward, same function). Unit tests for all
  due/not-due permutations. `bug` is now freshly serviced (cyc 23); `arch` is next-most-starved
  (cyc 18, starved-for 6 > 5) and will breach soon — its top item (converge `sync` route error
  handling on the central middleware) is a candidate if T3 part 2 stalls.
- **C24 (arch — converge sync error handling, part 1: make the middleware SyncError-aware)** —
  `arch` breached budget (cyc 18, starved-for 6 > 5) → forced pick. T3 part 2 waits one more cycle.
  Took arch #1 (converge `sync` route error handling on the central middleware) — but FIRST verified
  the BACKLOG item's premise against source (the C21 lesson), and it was WRONG in a load-bearing way:
  the item said "drop the try/catch, throw the typed error, let the middleware shape it." But
  `SyncError extends Error` (NOT `AppError`), and the central `errorHandler` had no SyncError branch —
  so a thrown SyncError would fall through to the generic 500 path, turning today's
  `SyncError(VALIDATION_ERROR)`→400 into a 500. Blindly doing the "refactor" would have been a
  behavior change (violates arch rule 2). Also: arch rule 3 — the central handler had ZERO test
  coverage, so a refactor against it had no safety net. SO this cycle is the load-bearing PREREQUISITE,
  split per rule 1 (one small reviewable increment): (1) extracted `syncErrorResponse(error)` in
  errors.ts as the single source of truth for SyncError→{body,status} shaping; (2) routed the existing
  `handleSyncError` through it (identical output, preserved); (3) added a SyncError branch to the
  central `errorHandler` using the SAME helper, so a SyncError now yields a byte-identical envelope
  whether caught locally or by the middleware; (4) committed `error-handler.test.ts` (7 tests, the
  handler had NONE before) pinning every existing branch (AppError subclasses, ZodError, HTTPException,
  unknown→500) AND proving `handleSyncError(err)` === `errorHandler(err)` for all 7 SyncErrorCodes.
  BEHAVIOR-PRESERVING: no SyncError reaches the middleware today (all 27 throw sites are caught in
  local try/catch), so the new branch is DORMANT — it only activates next cycle when the per-route
  try/catch is removed, and the equivalence test proves that removal is safe. Verified: tsc 0 ·
  musl-biome clean · 912 pass/0 fail (+7, up from 905) · build bundled. No product behavior changed.
  Next cycle (25): `feature` is most-starved (cyc 22, starved-for 3 < 4 — not yet over budget, but T3
  is mid-build so the loop continues it) → maintenance-schedule **T3 part 2** (trigger whichever-comes-
  first mileage logic + fold bug #12). ARCH FOLLOW-UP (part 2, when arch next fires ~cyc 29): now that
  the middleware is SyncError-aware + pinned, drop the hand-rolled try/catch from sync/routes.ts (7
  handlers) and let errors propagate to errorHandler — prove behavior-identical via the sync route
  HTTP tests + the new equivalence net. Then repeat for `auth` (7) and `settings` (5).
- **C25 (feature — maintenance-schedule T3 part 2: whichever-comes-first mileage trigger + bug #12)** —
  Nothing over budget (feature starved-for 3 < 4), but T3 is mid-build so the loop continues the
  feature. Built the MILEAGE AXIS of the reminder trigger — the half that makes "whichever comes
  first" real. DESIGN (grounded in the T3 spec + the C22 nullable schema): the time axis (`findOverdue`,
  `nextDueDate <= now`) can't see mileage-only reminders (null date) or a `both` reminder that's
  mileage-due-but-not-time-due, so added a SEPARATE pass. Repository: `findMileageTracking(userId)`
  returns active `triggerMode != 'time'` reminders with a non-null `nextDueOdometer` (due-ness needs
  the live odometer, not decidable in SQL); `mileageNotificationExists` + `createMileageNotification`
  (null dueDate, dueOdometer set) for the app-level dedup, with the C22 partial unique index as the DB
  backstop (UNIQUE-violation caught → no-op). trigger-service: new `processMileageReminder` — fetches
  `getCurrentOdometer` (max across expenses.mileage + odometer_entries, the C16 helper), fires ONE
  notification when `current >= nextDueOdometer`. KEY SEMANTICS: NO auto-re-arm on the mileage axis
  (re-arm is the explicit mark-serviced path, D3/T4) — a mileage reminder stays due until serviced, so
  re-triggering is idempotent (proven). A `both` reminder can fire on BOTH axes (distinct events,
  distinct dedup keys); the passes run independently. D4 single-vehicle enforced at runtime (a !=1
  vehicle mileage reminder is SKIPPED with a reason, not errored). SCOPE: mileage EXPENSE
  auto-creation deferred — it needs ratified auto-re-arm semantics (not in D1–D6); this axis emits the
  notification signal. The whole engine is dormant until T4 wires validation (no mileage reminder is
  API-creatable yet), so it's safe to land fully built + tested. ALSO FOLDED IN bug #12 (C21 audit):
  `fastForwardPastNow` ignored `endDate` — a bounded reminder lapsed past maxCatchUp (12) got
  fast-forwarded past now and left "active" but permanently dormant. Added the same
  `if (endDate && nextDue > endDate) { deactivate; return }` guard the main loop has. Pinned by
  `trigger-mileage.test.ts` (5: due/not-due/idempotent-re-trigger/no-vehicle-skip/max-across-sources,
  all through the real route→service→DB stack) + `trigger-fastforward-enddate.test.ts` (1: a lapsed
  bounded weekly reminder past the cap is deactivated, not left active — fails against pre-fix code).
  Verified: tsc 0 · musl-biome clean · 918 pass/0 fail (+6, up from 912) · build bundled.
  Next cycle (26): `feature` just touched (cyc 25) but T3 still mid-build → **T3 part 3/T4**: routes +
  validation — `POST /:id/mark-serviced` re-arm (D3: mileage → lastServiceOdometer = current, recompute
  nextDueOdometer; time → advance nextDueDate), Zod refinements (D4 single-vehicle + intervalMileage
  required when mileage), and `recheckMileageReminders` on odometer/mileaged-expense write (D5). Then
  the deferred T2 vehicle-stats.currentMileage reconcile. `guard` (cyc 20, starved-for 5 < 6) and
  `deep-review` (cyc 21, starved-for 4 < 5) approach budget — candidates if T4 needs a breather.
- **C26 (infra — refresh stale orientation docs)** — BALANCE OVERRIDE: `infra` breached budget
  (cyc 19, starved-for 7 > 6), the only over-budget category, so it outranks continuing T3 part 3
  this cycle. The infra queue was empty → scoped a real "keep the machine running" item: the
  orientation docs a fresh agent reads first had drifted out of sync with C22–C25, which actively
  misleads every future cycle. Fixed: (1) CLAUDE.md "Current state & gaps" said maintenance-schedule
  was "T1+T2 shipped; next is T3" — rewrote to reflect T1/T2/T3-part-1 (nullable rebuild migration
  0004 + partial index)/T3-part-2 (mileage trigger pass) all shipped, engine dormant until T4 wires
  routes+validation; spelled out the T4 surface (mark-serviced D3, refinements D4, recheck D5,
  vehicle-stats reconcile). (2) Softened the coverage line — the frontend ~59%/backend ~74% badges
  are a last-measured TODO.md baseline, not a current reading (the backend suite has grown to ~918
  tests), so labeled them a floor + pointed to the source rather than asserting a stale specific.
  (3) APIConventions.md steering "Error Handling" said "for sync ops use handleSyncError()" — updated
  to reflect C24: the global handler is now SyncError-aware via the shared `syncErrorResponse()`, so
  throwing a SyncError needs no local catch; noted the existing sync catch blocks + the queued arch #1
  convergence. DECISION: did NOT run a fresh coverage pass (expensive, off-point for a doc-refresh
  cycle) — flagged the figure as a baseline instead, honest over precise. Doc-only (no code touched);
  verified the working tree carries only CLAUDE.md + APIConventions.md. No build gate needed.
  Next cycle (27): back to `feature` (T3 still mid-build) → **T3 part 3/T4** (mark-serviced re-arm +
  Zod refinements + recheck-on-write + vehicle-stats reconcile). `guard` (cyc 20, starved-for 7 > 6
  at cyc 27) will ALSO be over budget next cycle — if both feature-continuation and guard contend,
  guard wins the balance rule; a merge-surviving guard candidate: a source-scan that the mileage
  trigger's no-auto-re-arm invariant (one notification per milestone) stays intact.
- **C27 (guard — maintenance-fields backup round-trip lock)** — BALANCE OVERRIDE: three categories
  were over budget at cyc 27 (deep-review 6>5, guard 7>6, bug 4>3); the rule picks the MOST starved
  over-budget one → `guard` (starved-for 7). Exactly the heads-up C26 left. Guard queue was empty, so
  picked the highest-leverage merge-surviving lock for the just-shipped C22/C25 work: a TRUE
  backup→restore round-trip for the maintenance-schedule reminder fields (this is also T5's explicit
  "Remaining" item — data-safety quality bar #1). RATIONALE: C22 added reminders.{triggerMode,
  intervalMileage, lastServiceOdometer, nextDueOdometer} + reminderNotifications.dueOdometer and made
  next_due_date/due_date nullable. The CSV backup is schema-derived so they SHOULD ride along — but
  the `coerceRow` boundary (integer + nullable columns, and a NULL date that must NOT coerce to 0/"")
  is exactly the C3 clientId silent-drop class, and nothing proved a mileage reminder survives
  export→import. Committed `maintenance-fields-roundtrip.test.ts` (3 tests through the REAL exportAsZip
  → restoreFromBackup stack, mileage reminders seeded via sqlite since T4 validation isn't wired):
  (1) mileage-only reminder + mileage notification survive with all 4 mileage cols + NULL date/odo
  intact; (2) a `both` reminder preserves both axes (real date AND mileage cols); (3) a plain time
  reminder restores with mileage cols NULL (not coerced to 0) + its real date. The NULL-not-zero
  assertions are the load-bearing ones — that's where coerce would silently mangle. Verified: tsc 0 ·
  musl-biome clean · 921 pass/0 fail (+3, up from 918) · build bundled. No product code touched.
  Next cycle (28): `deep-review` is now most-starved over budget (cyc 21, starved-for 7 > 5) → it wins
  the balance rule, NOT feature. Take the top deep-review item (eyes-on vehicle Overview + ExpensesTable
  populated states, mobile+desktop) or the analytics route sweep — fan out 2-3 Explore agents per
  rule 7. `bug` (cyc 23, starved-for 5 > 3) is also over budget and would be next after deep-review.
  T3 part 3/T4 (mark-serviced + validation) resumes once the starved review/bug categories are fed.
- **C28 (deep-review — backend correctness audit of the dormant mileage engine + insurance math)** —
  BALANCE OVERRIDE: deep-review most-starved over budget (cyc 21, starved-for 7 > 5). Verification-only
  cycle (like C21 — no product code; findings triaged into the bug queue). Fanned out 2 parallel
  Explore agents: (a) the C22/C25 mileage trigger engine, (b) insurance/financing analytics + the C23
  fix. APPLIED THE C21 LESSON — verified every agent finding against source before filing. RESULTS:
  • Agent A flagged 1 real + escalated a known one. The mileage engine is AUDIT-CLEAN on the scary
    axes — `both` fires once per axis (distinct dedup keys, no double-count), the mileage dedup is
    genuinely idempotent (app-check + partial-index backstop + UNIQUE-violation→null), getCurrentOdometer
    NULL/zero/cross-vehicle handling correct, findMileageTracking candidate set correct, the bug-#12
    endDate fix correct. The ONE real finding: backlog bug #13 (`advanceCustom` no-default) — VERIFIED
    + SEVERITY RAISED: it's not just a re-fire-until-maxCatchUp no-op, it's an INFINITE LOOP — an invalid
    intervalUnit leaves nextDue unchanged and `fastForwardPastNow`'s `while (nextDue <= now)` has no
    iteration cap → hang. Still defense-in-depth (Zod blocks the API create+update paths), reachable
    only via DB corruption/validation bypass. Updated #13 in the backlog with the corrected failure mode.
  • Agent B: C23 `effectiveMonthlyPremium` CORRECT (null/0/empty-span edges all handled, no NaN/Infinity);
    accumulateMonthlyPremiums is consistent with the headline total (same value source). CONFIRMED bugs
    #9 (interestPaidYtd mislabeled, :763-764/:1592) + #10 (buildLoanBreakdown flat balance, :829-849)
    still real + unfixed; refreshed their stale line refs. NEW finding filed as #14: buildInsuranceDetails
    counts an EXPIRED latest term as current premium (active policy, lapsed term → stale premium in the
    total) — flagged as a SEMANTICS call (active-but-expired may legitimately still owe), needs a product
    decision + a characterization test (buildInsuranceDetails has zero coverage) before any change.
  Net: engine certified clean where it matters, 1 severity correction (#13), 1 new finding (#14), 2
  confirmations (#9/#10). No code touched; LEDGER + BACKLOG only.
  Next cycle (29): `bug` is now most-starved over budget (cyc 23, starved-for 6 > 3) → it wins. Top
  real, decided, standalone bug: #13 (advanceCustom default + a fastForward iteration cap — small,
  closes the hang) or #10 (buildLoanBreakdown balance decrement — clear correctness fix, characterization
  test first). #14 needs an Angelo decision first (don't auto-fix a semantics call). T3 part 3/T4 resumes
  after the bug category is fed (it'll keep breaching until then).
- **C29 (bug — #13: invalid intervalUnit no longer hangs the trigger)** — `bug` most-starved over
  budget (cyc 23, starved-for 6 > 3) → forced pick. Took #13, the hang the C28 audit re-classified
  (not just a no-op). TWO-PART defense-in-depth fix in trigger-service.ts: (1) `advanceCustom` now
  throws `ValidationError` on an unknown intervalUnit instead of silently leaving the date unchanged
  (the root cause — a no-op date makes the `while (nextDue <= now)` loops spin); (2) a NON-PROGRESS
  BACKSTOP in `fastForwardPastNow` — if `computeNextDueDate` returns a date that didn't strictly
  advance, throw rather than loop forever (guards the invariant directly, catches any future
  non-advancing path, not just this one). Both throws land inside `processReminder`'s per-reminder
  try/catch in `processOverdueReminders`, so a corrupt reminder becomes a `skipped` entry
  (reason 'error'), NOT an endpoint crash/hang — well-formed reminders in the same batch still
  process. Still defense-in-depth (Zod `intervalUnitSchema` blocks the create+update API paths;
  reachable only via DB corruption/bypass), but the failure mode is now a clean skip. Pinned by
  `trigger-bad-interval-unit.test.ts` (2: corrupt reminder reported in `skipped` not hanging — the
  test COMPLETING is itself the anti-hang proof; + a corrupt reminder doesn't block a healthy one in
  the same batch). Test-harness note: a vehicle-less reminder skips with reason 'no_vehicles' BEFORE
  the date math, so the repro must link a vehicle to actually exercise the advance path. Verified:
  tsc 0 · musl-biome clean · 923 pass/0 fail (+2, up from 921) · build bundled.
  Next cycle (30): nothing over budget after this (feature starved-for 5 > 4 at cyc 30 — feature is
  the one breaching) → back to `feature`, T3 part 3/T4 (mark-serviced re-arm D3 + Zod refinements D4 +
  recheck-on-write D5 + vehicle-stats reconcile). Remaining decided bugs (#9 interestPaidYtd rename,
  #10 loan-breakdown balance, #11 mobile fuel-stat wrap) stay queued; #14 still needs the Angelo
  semantics decision (asked at end of C28 — buttons shown, no answer yet; don't auto-fix).
- **C30 (arch — #1 part 2 prerequisite: characterize sync-route error behavior)** — BALANCE: the C29
  forecast said "feature breaches next", but the table is the source of truth and BOTH breached at
  cyc 30 — feature starved-for 5 > 4 AND arch starved-for 6 > 5. The rule picks the MOST starved →
  `arch` (6) wins over feature (5); T3 part 3/T4 waits one more cycle. (Lesson: compute every category
  from the table each cycle, don't trust last cycle's single-category forecast.) Took arch #1 part 2
  (drop sync/routes.ts try/catch). APPLIED C24/C28 DISCIPLINE — verified the BACKLOG's "clean drop"
  premise against source FIRST, and it's wrong the same way C24's was: handleSyncError + the central
  errorHandler are byte-identical for a SyncError (proven C24), but for a NON-SyncError thrown inside a
  handler they DIVERGE — handleSyncError's tail wraps any non-SyncError as 500 OPERATION_FAILED, while
  errorHandler maps a ZodError → 400 ValidationError and an AppError by statusCode. So a blind drop
  CHANGES status codes (500→400 for bad input) — not behavior-preserving, violates arch rule 2. AND
  (rule 3) the sync routes had ZERO real HTTP-stack error coverage (existing "tests" are pure-logic
  replicas). So this cycle is the test-only PREREQUISITE (mirrors C24→C25): committed
  `sync-route-errors.test.ts` (4 tests through the real app.request stack) pinning today's status+body
  at representative sites — SyncError paths (POST /sync invalid syncTypes → 400; unknown type → 400;
  restore/from-provider missing Idempotency-Key → 400 via the middleware, already central) + the
  health positive control. The non-SyncError DIVERGENCE is documented analytically in the file (the
  app.request harness always JSON-stringifies the body + lacks a header arg, so an in-handler ZodError
  can't be provoked through it) with the exact 500→400 change the part-2 drop will make. Now the drop
  is provable: when the try/catch comes out, the SyncError assertions stay green and the divergent ones
  get updated to 400 in the same commit — a deliberate, reviewed step. Verified: tsc 0 · musl-biome
  clean · 927 pass/0 fail (+4, up from 923) · build bundled. Test-only; no product code touched.
  Next cycle (31): `feature` is now most-starved over budget (cyc 25, starved-for 6 > 4) → it wins →
  maintenance-schedule **T3 part 3/T4** (mark-serviced re-arm + Zod refinements + recheck-on-write +
  vehicle-stats reconcile) — finally resumes. The arch drop (part 2 proper) is queued for the next
  arch pick (~cyc 35), now safe against this net. #14 still awaits the Angelo semantics decision.
- **C31 (feature — maintenance-schedule T4 part 1: mileage reminders are now API-creatable)** —
  `feature` most-starved over budget (cyc 25, starved-for 6 > 4) → forced pick; T4 finally resumes.
  Scoped to the FOUNDATIONAL slice that turns the dormant C25 engine LIVE: validation (D4) + the
  create/update wiring for the mileage axis. (mark-serviced D3 re-arm + recheck-on-write D5 are
  separate cycles.) Changes: (1) validation.ts — added `triggerMode`/`intervalMileage`/
  `lastServiceOdometer` to reminderBaseSchema + `refineMileageTrigger` (D4: mileage/both requires a
  positive intervalMileage + exactly one vehicle; lastServiceOdometer optional, route-defaulted).
  (2) routes.ts — `resolveMileageFields` helper: defaults lastServiceOdometer to the vehicle's
  current odometer when omitted, derives `nextDueOdometer = lastServiceOdometer + intervalMileage`
  (server-side, never client input); pure-mileage create persists `nextDueDate: null`, both/time keep
  startDate; update recomputes the cache + flips nextDueDate when the mileage axis is touched. (3)
  repository.ts — createWithVehicles no longer hard-overrides `nextDueDate = startDate` (the caller
  now supplies the correct value, null for pure mileage). (4) config.ts — maxIntervalMileage cap.
  TWO SUBTLE FOOTGUNS CAUGHT BY THE TESTS (the value of writing them): (a) `refineMileageTrigger`
  initially REQUIRED lastServiceOdometer, which wrongly rejected the documented default-on-create —
  relaxed to route-defaulted. (b) `triggerMode: .default('time')` SURVIVES `.partial()` on the update
  schema → it silently flipped an existing mileage reminder back to 'time' on any field update that
  omitted triggerMode (cleared nextDueOdometer). Fixed to `.optional()` (DB column default handles
  create-time absence; merge keeps existing on update). Pinned by `create-mileage-reminder.test.ts`
  (7: derived nextDueOdometer, default-to-current-odometer, both keeps date, time has null mileage
  cols, rejects no-interval, rejects multi-vehicle, update recomputes). Verified: tsc 0 · musl-biome
  clean · 934 pass/0 fail (+7, up from 927) · build bundled.
  Next cycle (32): nothing over budget after this (deep-review starved-for 4, bug 3=budget, others
  under). Highest-leverage = continue T4: **mark-serviced re-arm** (D3 — `POST /:id/mark-serviced`:
  mileage → lastServiceOdometer = current odometer, recompute nextDueOdometer; time/both → advance
  nextDueDate) — this is what lets a fired mileage reminder re-arm (today it stays due, by design,
  until this exists). Then recheck-on-write (D5) + the vehicle-stats reconcile. #14 still needs the
  Angelo semantics decision (queued, not auto-fixed).
- **C32 (feature — maintenance-schedule T4 part 2: mark-serviced re-arm, D3)** — nothing over budget
  (feature just touched cyc 31, but T4 mid-build → continue). Built `POST /:id/mark-serviced`, the
  re-arm that closes the mileage loop: a fired mileage reminder has NO auto-re-arm (C25 design), so it
  stays due until this endpoint moves the milestone. Repository: `markServiced(id, userId, fields)` —
  an ownership-scoped optimistic update applying the caller-computed axis fields + stamping
  lastTriggeredAt, returns the row (404 if id/user miss). Route owns the math (keeps the repo free of
  a trigger-service import cycle): mileage/both → lastServiceOdometer := getCurrentOdometer (fallback
  to the stored anchor if no reading), nextDueOdometer := that + intervalMileage; time/both → advance
  nextDueDate one period via the reused `computeNextDueDate`. Rate-limited like /trigger; route placed
  as `/:id/mark-serviced` (static suffix segment, no collision with GET/PUT /:id). Pinned by
  `mark-serviced.test.ts` (5: mileage re-anchor + recompute, the end-to-end fire→service→not-due-again
  loop, time advances date, both moves both axes, cross-tenant/missing id → 404). Verified: tsc 0 ·
  musl-biome clean · 939 pass/0 fail (+5, up from 934) · build bundled.
  Next cycle (33): nothing over budget (deep-review starved-for 5 = budget at cyc 33, others under) →
  continue T4: **part 3 — `recheckMileageReminders` on odometer / mileaged-expense write (D5)** — fire
  a mileage reminder the moment a new reading crosses its milestone (instead of only on the next
  /trigger), idempotent via the existing dedup. Then T3-part-3 (vehicle-stats reconcile) + T5
  remaining + frontend T6–T9. NOTE: deep-review hits budget at cyc 33 — if it's picked, the live
  mileage create+trigger+re-arm surface is now worth an eyes-on/HTTP review. #14 still awaits Angelo.
- **C33 (infra — `validate:local` + `check:musl` scripts; CLAUDE.md refresh)** — BALANCE: the C32
  forecast said "nothing over budget," but `infra` had breached (last-touched 26, budget 6 →
  starved-for 7 > 6) AND `bug` was over (4 > 3); infra is most-starved → it wins. (Recurring lesson:
  I keep under-forecasting the slow-budget categories — compute ALL six from the table each cycle.)
  Infra queue empty → scoped a real loop-tooling item: every cycle manually runs 4 commands because
  `bun run validate`'s `check` step invokes the dead glibc biome (GLIBC_2.29). Added package scripts
  `check:musl` / `check:musl:fix` (the working musl binary over src/) + `validate:local` = type-check
  && check:musl && test && build — the documented 4-step workaround as ONE command. DISCOVERY (the
  payoff): running check:musl over the WHOLE tree surfaced a formatter reflow in my own C31 file
  (create-mileage-reminder.test.ts — a long object literal) that the per-file C31 biome check missed
  but CI's glibc biome would flag — auto-fixed (one tracked file, purely mechanical line-wrap; the 10
  pre-existing noNonNullAssertion WARNINGS in other test files are unsafe-fix + non-blocking, left
  alone — no scope creep into unrelated committed files). Refreshed CLAUDE.md VERIFY step + the Biome
  hard-rule to point at validate:local/check:musl and to note "run check:musl over the whole tree
  before committing — a per-file check can miss a reflow CI flags." Verified: `bun run validate:local`
  EXIT 0 end-to-end (tsc 0 · musl-biome clean · 940 pass/0 fail · build bundled) — the new command IS
  the cycle's verification.
  Next cycle (34): `bug` is now most-starved over budget (cyc 29, starved-for 5 > 3) → it wins.
  Decided standalone bugs: #10 (buildLoanBreakdown flat balance — characterization test first, then
  decrement) or #9 (interestPaidYtd rename) or #11 (mobile fuel-stat wrap — UI). #14 still needs the
  Angelo semantics decision. T4 part 3 (recheck-on-write D5) resumes once bug is fed.
- **C34 (guard → found+fixed a real data-loss bug; feeds guard AND bug)** — BALANCE: 3 categories over
  budget (deep-review 6>5, guard 7>6, bug 5>3); most-starved = `guard` (7) → it wins (my C33 note
  guessed bug; the table rules — guard's raw starved-for was higher). Scoped the highest-leverage
  merge-surviving guard: generalize the C31 footgun (a Zod `.default()` SURVIVES `.partial()`, so an
  update schema can inject the default on an omitted field). Surveyed the codebase's `.partial()`
  schemas + `.default()` base fields → the at-risk instance is `updateExpenseSchema =
  createExpenseSchemaBase.omit(...).partial()` whose base `tags` is `.optional().default([])`. Wrote
  the guard FAILING-FIRST through the real route→repo→DB stack (create a tagged expense → PUT only the
  amount → assert tags survive) — and it CONFIRMED A REAL BUG: editing any other field of a tagged
  expense wiped its tags (the `.default([])` survived `.partial()`, injected `tags: []`, written
  through by repository.update). Silent data loss on the most common edit path (quality-bar #1). FIX:
  `updateExpenseSchema` re-declares `tags` as a plain `.optional()` (no default) via `.extend()`, so an
  omitted tags stays undefined → dropped → stored value preserved; explicit array still replaces.
  `update-preserves-tags.test.ts` (2) now green; the failing-first run is the proof it bites. Verified
  via the new `bun run validate:local`: EXIT 0 (tsc 0 · musl-biome clean — caught + auto-fixed a
  formatter reflow on the edit too · 942 pass/0 fail, +2 · build bundled). AUDIT NOTE for a future
  cycle: the reminders `expenseTags` field + any other `.optional().default(x)` in a `.partial()`'d
  schema may share the class — a broader source-scan guard (assert no `.partial()` update schema
  carries a surviving `.default()`) would lock the whole class merge-surviving; filed as a guard idea.
  Next cycle (35): nothing over budget (arch starved-for 5 = budget at cyc 35; bug just fed). Highest-
  leverage = continue T4 part 3 (recheck-on-write D5), OR take the most-starved-at-budget arch (the
  sync try/catch DROP, now safe behind the C30 net). #14 still awaits Angelo.
- **C35 (deep-review — audit the live mileage API + the .partial()/.default() class)** — BALANCE:
  `deep-review` only over-budget category (cyc 28, starved-for 7 > 5) → forced. (My C34 note guessed
  T4/arch; the table ruled — deep-review's 7 beat arch's at-budget 5.) Verification-only (no product
  code; like C21/C28). Fanned out 2 Explore agents, VERIFIED every finding against source per the
  C21/C28 lesson — which corrected one agent's reasoning. RESULTS:
  • Agent A (mileage API C31/C32): CERTIFIED CLEAN on all 5 scrutinized areas. Spot-verified the
    load-bearing one — a mileage reminder created with no odometer reading anchors at 0 → milestone =
    interval, but `processMileageReminder` returns early on `currentOdometer === null`, so NO
    false-immediate-fire (fires only once a real reading ≥ milestone appears). triggerMode switches
    keep a consistent row (resolveMileageFields clears/sets per mode + flips nextDueDate); mark-serviced
    axis guards correct; refineMileageTrigger enforces single-vehicle + intervalMileage on both create
    AND the merged-revalidate update (no bypass); undefined triggerMode → startDate (not null). Good.
  • Agent B (.partial()+.default() class): flagged reminders `actionMode` as a "REAL data-loss risk,
    route-defended" — BOTH HALVES WRONG on verification (the C21 lesson in action). It is NOT
    route-defended (the route writes {...reminderFields} from the parsed partialUpdate, which WOULD
    carry an injected actionMode), but it's HARMLESS regardless: `actionMode: z.literal('automatic')`
    has exactly ONE legal value, so injecting/writing 'automatic' clobbers nothing (the C34 class only
    bites a USER-SETTABLE field). NO remaining real instances: expense tags fixed (C34); reminders
    expenseTags is `.nullish()` (no default); vehicles/settings/odometer safe because drizzle-zod does
    NOT extract DB column defaults into Zod + their routes merge explicitly. USEFUL STRUCTURAL FACT
    (verified): createInsertSchema does NOT surface `.notNull().default(x)` DB columns as Zod
    `.default()` — so DB defaults are not part of this class; only hand-written Zod `.default()` is.
  Net: live mileage surface certified, class audit closed (0 new real bugs), 1 agent misread debunked.
  The C34 class-level source-scan guard is still the right lock (now scoped: flag a hand-written Zod
  `.default()` on a user-settable field in a `.partial()` update schema; literal-single-value defaults
  like actionMode are exempt). No code touched; LEDGER/BACKLOG only.
  Next cycle (36): `arch` is over budget (cyc 30, starved-for 6 > 5 at cyc 36) → it wins → the sync
  try/catch DROP (arch #1 part 2b), now safe behind the C30 characterization net. `feature` (cyc 32,
  starved-for 4 = budget) is next after. #14 still awaits the Angelo semantics decision.
- **C36 (arch — #1 part 2b: drop the sync try/catch, converge on the central handler)** — `arch`
  forced (cyc 30, starved-for 6 > 5). Executed the drop the C24→C30 sequence set up: removed the
  hand-rolled `try/catch → handleSyncError` from all 7 `sync/routes.ts` handlers + the now-unused
  handleSyncError import, so errors propagate to the central errorHandler (SyncError-aware since C24).
  BEHAVIOR: SyncError paths byte-identical (C24-proven) → the C30 characterization assertions stayed
  GREEN unchanged, proving no regression on the common case; non-SyncError paths IMPROVED as designed
  (a ZodError/AppError thrown in a handler now returns its proper status — 400/401/etc — instead of
  the old blanket 500 OPERATION_FAILED from handleSyncError's tail). This was an authorized, reviewed
  behavior change (the arch-rule-2 exception flagged + net-built across C24/C30), not a silent one.
  Updated `sync-route-errors.test.ts`: refreshed the header + divergence note to the post-drop
  contract, and replaced the now-stale "part-2 WILL change this" analytic note with a LIVE assertion
  (unauthenticated POST /sync → 401 AuthenticationError via the central handler — confirms it's the
  single error path + an AppError keeps its statusCode, not flattened to 500). Verified via
  `validate:local`: EXIT 0 (tsc 0 · musl-biome clean — auto-reflowed the de-indented handlers · 943
  pass/0 fail · build bundled); the full 161-test sync suite green. `sync` is the first of the three
  hand-rolled route files converged.
  Next cycle (37): nothing over budget (feature cyc 32 starved-for 5 > 4 at cyc 37 — feature breaches)
  → `feature` wins → maintenance-schedule T4 part 3 (recheck-on-write D5: fire a mileage reminder the
  moment an odometer/mileaged-expense write crosses its milestone, idempotent via the existing dedup).
  Arch #1 has 2 route files LEFT (auth: 7 try/catch, settings: 5) — each its own characterize-then-drop
  pair when arch next fires (~cyc 41). #14 still awaits the Angelo semantics decision.
- **C37 (feature — maintenance-schedule T4 part 3: recheck-on-write, D5)** — `feature` forced (cyc 32,
  starved-for 5 > 4). Final functional piece of T4: a mileage reminder now fires the MOMENT a new
  reading crosses its milestone, not only on the next /trigger. Added trigger-service
  `recheckMileageReminders(userId, vehicleId)` — fetches the user's mileage-tracking reminders,
  filters to those linked to the written vehicle, runs the existing `processMileageReminder` on each
  (reuse → idempotent via the C22 dedup key, so the login /trigger pass can't double-fire it).
  Wired into TWO write paths: odometer-create route (always) + expense-create route (only when
  `mileage != null`, since getCurrentOdometer reads expenses.mileage). Best-effort — recheck collects
  skips, never throws, so a reminder hiccup can't fail the underlying write (which is already
  persisted). No circular import (trigger-service imports odometer/repository, not routes; the routes
  import trigger-service — one direction). Pinned by `recheck-on-write.test.ts` (5: odometer-write
  fires immediately w/o /trigger, below-milestone silent, mileaged-expense fires, idempotent vs a
  later /trigger, non-mileaged write silent). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome
  clean · 947 pass/0 fail, +4 · build bundled). T4 IS FUNCTIONALLY COMPLETE — mileage reminders:
  creatable (C31) · re-arm via mark-serviced (C32) · fire on /trigger (C25) · fire on write (C37).
  Next cycle (38): nothing over budget (bug cyc 34 starved-for 4 > 3 at cyc 38 — bug breaches) → `bug`
  wins. Decided standalone: #10 (buildLoanBreakdown flat balance — characterization test first) or #9
  (interestPaidYtd rename) or #11 (mobile fuel-stat wrap — UI). REMAINING maintenance-schedule:
  T3-part-3 (vehicle-stats reconcile), T5 remaining (backup round-trip already done C27), frontend
  T6–T9 (the whole UI — types/service/ReminderForm mileage branch/page+card/e2e). #14 awaits Angelo.
- **C38 (bug — #10: buildLoanBreakdown flat balance)** — `bug` forced (cyc 34, starved-for 4 > 3).
  Fixed #10 (confirmed real + unfixed by the C28 audit): buildLoanBreakdown read each loan's balance
  into a Map then NEVER decremented it across the 12-month loop → every month reported identical
  interest/principal (interest never declined, principal never rose, a loan paying off mid-window
  over-projected). The method does DB I/O (computeBalance), so to make the math test-anchored
  (bug-rule: characterize first) I EXTRACTED the pure amortization into `buildAmortizationSchedule`
  (analytics-charts.ts, alongside monthKeysInRange/effectiveMonthlyPremium): takes caller-resolved
  {balance,apr,paymentAmount}[] + month-key labels, walks each balance down by its principal each
  month, clamps principal to the remaining balance + skips paid-off loans (no negative interest /
  phantom principal). buildLoanBreakdown now resolves balances via Promise.all + builds the 12 month
  keys, then delegates. Pinned by `amortization-schedule.test.ts` (5: interest-declines/principal-
  rises = the defining bug assertion, mid-window payoff clamp, multi-loan sum, no-input-mutation,
  empty-loans). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 952 pass/0 fail, +5 ·
  build bundled). HARNESS GOTCHA (noted): running `bun test src/api/analytics src/utils` together
  3-failed with "ALTER TABLE … ADD due_odometer" errno-1 (duplicate column) — a cross-suite migration
  double-apply when two suites migrate the shared DB in one process; isolation + the full `bun test`
  are both green. The canonical gate is full `bun test` / validate:local, NOT a narrowed multi-dir run.
  Next cycle (39): nothing over budget (deep-review cyc 35 starved-for 4; arch cyc 36 starved-for 3;
  all under). Highest-leverage = the maintenance-schedule FRONTEND (T6: types + service client for the
  mileage fields + mark-serviced) — kicks off the UI arc that makes the now-complete backend usable;
  it's a feature pick (feature starved-for 2, not yet breaching, but highest-leverage). Remaining bugs
  #9 (interestPaidYtd rename) + #11 (mobile fuel-stat wrap) stay queued. #14 awaits Angelo.
- **C39 (feature — maintenance-schedule frontend T6: types + service client)** — nothing over budget;
  highest-leverage = kick off the UI arc that makes the now-complete backend usable. T6 is the
  non-visual foundation (the layer T7+ build on). Frontend `types/reminder.ts`: added `TriggerMode`,
  the mileage fields (triggerMode/intervalMileage/lastServiceOdometer/nextDueOdometer) to `Reminder`,
  made `nextDueDate` nullable; on `ReminderNotification` made `dueDate` nullable + added `dueOdometer`.
  `services/reminder-api.ts`: added `markServiced(id)` → POST /:id/mark-serviced. The nullable-date
  type change correctly surfaced 8 consumer sites assuming non-null (svelte-check) — all TIME-axis:
  fixed by treating a null date as "not time-due" (dashboard due-soon widget filters out pure-mileage
  via a type-narrowing predicate; /reminders isDue returns false for null; the two render sites show
  the odometer milestone instead of a date). Verified: frontend tsc 0 errors (7 pre-existing warnings
  unchanged) · build OK. NO screenshot this cycle — the render branches only manifest for a mileage
  reminder, which isn't UI-creatable until T7 (ReminderForm), so there's nothing new to show yet; the
  tsc+build floor is right for this non-visual layer. No backend touched.
  Next cycle (40): nothing over budget (deep-review cyc 35 starved-for 5 = budget at cyc 40; others
  under). Continue the feature arc → **T7: ReminderForm mileage branch** — the trigger-mode control
  (Time | Mileage | Both), intervalMileage input w/ the vehicle's distance-unit label, current-odometer
  hint + editable lastServiceOdometer, single-vehicle constraint when mileage. THIS is the visual
  cycle — compose from the kit, eyes-on screenshot required (ui-autoloop). T8 (page/card mileage due
  rendering + Mark serviced button) + T9 (e2e) follow. #9/#11 bugs queued; #14 awaits Angelo.
- **C40 (infra — frontend `validate:local`)** — BALANCE OVERRIDE: `infra` breached (cyc 33,
  starved-for 7 > 6), the only over-budget category (deep-review + guard sat exactly AT budget, not
  over) → infra wins, T7 waits one cycle. Symmetry gap with the C33 backend work: the frontend had
  `validate` (lint + format:check + type-check + test, the CI-shaped gate) but NO single command for
  the CLAUDE.md local VERIFY gate (type-check + build), so every frontend cycle ran those by hand and
  the build step was easy to skip. Added `validate:local` = type-check && build && test (fail-fast
  order) mirroring the backend. Verified the test step green FIRST (345 pass) before wiring, then ran
  the new command end-to-end: EXIT 0 (tsc 0 · build ✓ · 345 pass). Refreshed CLAUDE.md's VERIFY step
  to point Frontend at `npm run validate:local`. Well-timed: the T7–T9 frontend arc is the next 3
  feature cycles, each now a one-command gate. No product code; package.json + CLAUDE.md only.
  Next cycle (41): nothing over budget (deep-review cyc 35 starved-for 6 > 5 at cyc 41 — deep-review
  breaches) → `deep-review` wins, NOT the T7 feature. Likely target: an eyes-on/HTTP review of a
  shipped surface (the live mileage API + the just-landed frontend null-date handling), or fan out per
  rule 7. T7 (ReminderForm mileage branch) resumes once deep-review is fed. #9/#11 queued; #14 Angelo.
- **C41 (guard — class-level net for the .partial()+.default() data-loss class)** — BALANCE: both
  guard (cyc 34, starved-for 7) AND deep-review (cyc 35, 6) over budget; most-starved = `guard` (7) →
  it wins (my C40 note guessed deep-review; guard's raw starved-for was higher — keep computing from
  the table). Built the class-level net filed across C34/C35: the data-loss class (a Zod `.default()`
  survives `.partial()`, injecting + clobbering on an omitted-field update) bit twice (C31, C34) and
  per-instance guards cover those — this catches the NEXT one. APPROACH DECISION: a text/regex
  source-scan is unreliable here (schemas span files, `.partial()` is chained), so I used a RUNTIME
  net instead — `partial-update-no-default-injection.test.ts` imports each exported update schema,
  parses an empty `{}`, and asserts it injects no key beyond an EXEMPT allowlist. This tests the real
  invariant ("an empty update overwrites nothing") directly against the actual Zod objects, surviving
  any refactor. Verified-against-source scoping baked in: `actionMode` (z.literal single-value default,
  C35-proven harmless) is the one allowlisted key; schemas with `.refine(keys>0)` (claim/term) early-
  return on the legit empty-parse failure. Covers updateReminder/Term/Policy/Claim; the route-local
  updateExpense (C34-fixed) + odometer schemas aren't exported (a future cycle could export them to
  widen coverage). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 957 pass/0 fail,
  +4 · build bundled). No product code.
  Next cycle (42): `deep-review` is now most-starved over budget (cyc 35, starved-for 7 > 5 at cyc 42)
  → it wins. Eyes-on/HTTP review of a shipped surface — the live mileage API + the C39 frontend
  null-date handling are the freshest unreviewed; fan out per rule 7, verify findings vs source. T7
  (ReminderForm mileage branch) resumes after. #9/#11 bugs queued; #14 awaits Angelo.
- **C42 (deep-review — mark-serviced/recheck backend + C39 frontend null-handling; fixed 1 real bug)**
  — `deep-review` forced (cyc 35, starved-for 7 > 5). Fanned out 2 Explore agents, VERIFIED every
  finding vs source (C21/C28/C35 lesson). RESULTS:
  • Agent A (C39 frontend null-date handling): CLEAN — every nextDueDate/dueDate/dueOdometer/mileage
    read site is guarded (page null-checks, dashboard type-narrowing predicate, DueRemindersCard gets
    pre-filtered non-null props, ReminderForm null-coalesces expenseTags). 0 remaining. Good.
  • Agent B (mark-serviced C32 + recheck C37): 1 REAL bug + 3 filed. FIXED THIS CYCLE (own-code bug,
    small + the comment was actively false): recheckMileageReminders' `findMileageTracking` fetch was
    OUTSIDE the per-reminder try/catch — it throws DatabaseError, and recheck runs AFTER the
    odometer/expense write persists, so a DB hiccup would propagate + 500 a SUCCESSFUL write, breaking
    the "never throws" contract the call sites rely on (they don't wrap it). Wrapped the fetch →
    swallows to a skip + returns. Pinned by `recheck-query-failure.test.ts` (spyOn mockRejectedValue →
    resolves with reason 'recheck_query_failed', doesn't throw). The other 3 verified findings filed,
    NOT auto-fixed (judgment, not bugs): (1) markServiced is ownership-scoped, NOT value-CAS'd — the
    C32 "optimistic-locked" comment OVERCLAIMS, but two concurrent user mark-serviced calls compute
    the same result from the same row (no corruption), so it's a doc-accuracy fix; (2) mark-serviced
    advances nextDueDate ONE period even from an overdue date (could "bounce" through the past) —
    matches the trigger's own model + assumes a trigger ran first; a semantics decision; (3)
    recheck-on-write is CREATE-only (not expense/odometer UPDATE) — a documented scope choice (D5 says
    "create"). Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean · 958 pass/0 fail, +1 · build).
  Next cycle (43): nothing over budget (arch cyc 36 starved-for 7 > 5 at cyc 43 — arch breaches) →
  `arch` wins → arch #1 part 2c (drop the `auth`/`settings` try/catch, characterize-then-drop per the
  C30/C36 pattern). T7 (ReminderForm) is the next feature pick after. Filed bugs below; #14 Angelo.
- **C43 (arch — #1 part 2c-characterize: pin settings-route error behavior)** — `arch` forced (cyc 36,
  starved-for 7 > 5; bug also over at 5 but lower). Took the settings route (5 try/catch, smaller than
  auth's 7). GROUNDING (vs source, before acting): settings is a DIFFERENT pattern from sync — it
  doesn't use handleSyncError; it hand-rolls try/catch that rethrow as AppError with TRANSFORMED
  messages (GET / masks ANY error as 'Failed to fetch settings' 500; PUT / maps ZodError →
  AppError('Invalid settings data', 400)). The central errorHandler already shapes AppError, so most is
  boilerplate — but the GET catch MASKS typed errors (a NotFoundError would surface as a generic 500)
  and the PUT message is a transform, so dropping CHANGES responses (improvement, but a behavior
  change). Per the C30/C36 pattern + arch rule 2/3 (settings had NO real HTTP-stack error coverage):
  this cycle is CHARACTERIZE-FIRST. Committed `settings-route-errors.test.ts` (4: GET positive control,
  PUT out-of-range syncInactivityMinutes → today's 'Invalid settings data' 400, PUT path-traversal
  backupConfig → 400, PUT valid partial → 200) pinning today's behavior, with an inline note on the
  exact code/message the drop will change. ALSO verified (C35 fact) updateSettingsSchema is a
  `.partial()` of a createInsertSchema with no hand-written default → NOT a C41-class data-loss risk.
  Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 961 pass/0 fail, +3 · build). Test-only.
  Next cycle (44): nothing over budget (bug cyc 38 starved-for 6 > 3 at cyc 44 — bug breaches) → `bug`
  wins. Decided standalone: #9 (interestPaidYtd rename) or #11 (mobile fuel-stat wrap, UI+screenshot).
  arch #1 remaining: settings-DROP (now safe behind this net) + auth (characterize-then-drop). T7
  (ReminderForm) still the next feature pick. #14/#16 await Angelo semantics calls.
- **C44 (bug — #9: interestPaidYtd is mislabeled)** — `bug` forced (cyc 38, starved-for 6 > 3). Took #9
  (clean backend+label rename, no screenshot dependency, vs #11's UI work). THE BUG: the financing
  analytics field `interestPaidYtd` (summary) + per-vehicle `interestPaid` are ONE month's interest on
  the CURRENT balance (`balance * apr/100/12`) — neither year-to-date NOR actually paid; a forward
  estimate mislabeled as historical fact. Took the backlog's "smallest honest fix" = rename, not a
  true-YTD recompute (that needs payment-history summing — out of scope, would be a feature). Renamed
  end-to-end across the boundary: backend `FinancingData` type (2 fields) + 4 impl sites (compute,
  per-vehicle return, 'own' branch, empty-state, aggregation) → `monthlyInterestEstimate`; frontend
  `FinancingResponse` type + the 2 UI labels ('Interest Paid YTD' → 'Est. Monthly Interest' subtitle
  'on current loan balances'; per-vehicle 'Interest Paid' → 'Est. Monthly Interest'). Grep confirmed
  zero remaining code/test refs to the old names (only the explaining comments). UI-touching but a
  pure label/field rename (no layout change) → build + label text are the proof, no screenshot needed.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome · 961 pass · build) + frontend
  validate:local EXIT 0 (tsc 0 · build · 345 pass).
  Next cycle (45): nothing over budget (feature cyc 39 starved-for 6 > 4 at cyc 45 — feature breaches)
  → `feature` wins → maintenance-schedule **T7 (ReminderForm mileage branch)** — THE visual cycle,
  eyes-on screenshot required (ui-autoloop). Remaining: bug #11 (mobile fuel-stat wrap); arch
  settings-DROP + auth; #14/#16 await Angelo.
- **C45 (feature — maintenance-schedule T7: ReminderForm mileage branch)** — `feature` forced (cyc 39,
  starved-for 6 > 4). Built the mileage UI in ReminderForm.svelte: a "Trigger when" Select (On a time
  schedule | At a mileage interval | Time or mileage whichever first) driving hasTimeAxis/hasMileageAxis
  $derived; the mileage axis reveals a Service-interval input (suffixed with the selected vehicle's
  distance-unit label via getDistanceUnitLabel) + a Last-serviced-at input (placeholder 'current',
  hint "leave blank to use latest reading" — matches the C31 backend default), and HIDES the time
  fields (frequency/dates); the time axis keeps the existing fields unchanged. Validation: D4
  single-vehicle when mileage, positive intervalMileage required, time fields only validated when the
  time axis is active. Payload sends triggerMode + intervalMileage (null when pure time) + omits
  lastServiceOdometer when blank (backend defaults it). Edit-path seeds all three from the reminder;
  composed entirely from the existing kit (Select/Input/Label/FormFieldError) — no new components/CSS.
  VERIFIED: frontend tsc 0 · build ✓ · 345 unit tests · prettier clean. ⚠️ EYES-ON NOT CAPTURED — the
  Playwright/browser harness is sandbox-denied in this autonomous context (the run auto-refused). Wrote
  an untracked e2e (`reminder-mileage.meshclaw.e2e.ts`) that screenshots the mileage form + asserts the
  reveal/hide + 'both' behavior when regress.sh runs; flagged the pending eyes-on to Angelo via
  send_message (honest-over-precise: visual risk is low — kit-composed, adjacent-field-identical — but
  not confirmed). NOT claiming T7 fully done until eyes-on; tasks.md marks it [~] visual-pending.
  Next cycle (46): nothing over budget (deep-review cyc 42 starved-for 4; arch 3; all under). Highest-
  leverage = continue the feature arc → **T8** (/reminders page + DueRemindersCard: OR-in mileage due,
  render the milestone + gap with unit label, wire the "Mark serviced" button to reminderApi.markServiced;
  four states + a11y) — also visual. Then T9 (e2e). bug #11 + arch settings-DROP/auth queued. #14/#16 Angelo.
- **C46 (feature — maintenance-schedule T8: Mark-serviced button on /reminders)** — nothing over budget;
  continued the feature arc. T8's display half (mileage milestone render + null-date guards on the
  /reminders cards + notification dueOdometer render) already landed in C39 with the nullable-type
  fixes; the dashboard DueRemindersCard is time-axis-only BY DESIGN (mileage due surfaces via
  notifications, not the date-window widget) so it needs no change. So T8's remaining NEW piece = the
  re-arm action: added `markServiced(item)` handler (per-reminder `servicingId` spinner, success toast
  'reminder re-armed', reload) + `isMileageTracking()` helper, and a "Serviced" Button (Check icon /
  RefreshCw spinner) on each ACTIVE mileage/both card, before Pause/Edit/Delete — wired to
  reminderApi.markServiced (C39 client). Composed from the kit. Verified: frontend tsc 0 · build ·
  345 tests · prettier clean. ⚠️ EYES-ON STILL PENDING (same Playwright sandbox-deny as C45) — extended
  the untracked reminder-mileage e2e to assert the Serviced button shows + click re-arms + screenshot.
  Both T7+T8 visuals will be confirmed in one pass when Angelo runs regress.sh / glances at /reminders
  (flagged C45). T8 marked [~] until then.
  Next cycle (47): `arch` is most-starved (cyc 43, starved-for 4 < 5 — not over yet; deep-review cyc 42
  starved-for 5 = budget at cyc 47). Nothing strictly over budget at 47 → highest-leverage = T9 (the
  maintenance-schedule e2e — promote the untracked reminder-mileage spec's coverage into the committed
  suite shape, closing the feature) OR continue toward closing the UI. bug #11 + arch settings-DROP/auth
  remain queued; #14/#16 await Angelo. Watch: deep-review + arch both breach ~cyc 47-48.
- **C47 (infra — refresh CLAUDE.md maintenance-schedule status)** — BALANCE: `infra` breached (cyc 40,
  starved-for 7 > 6), the only over-budget category (deep-review/guard/bug all sat exactly AT budget)
  → infra wins. The orientation doc a fresh agent reads first was stale since C26: it described
  maintenance-schedule as "backend nearly done, trigger engine DORMANT until T4, frontend T6–T9
  follows" — but C31–C46 shipped all of T4/T5 (backend complete: mileage reminders API-creatable,
  fire on trigger + on write, mark-serviced re-arm) AND frontend T6/T7/T8. A fresh agent would think
  the feature's biggest chunk was unbuilt. Rewrote the block to reality: backend COMPLETE, frontend
  T6–T8 shipped (T7/T8 eyes-on-pending), remaining = T9 e2e + the deferred vehicle-stats reconcile.
  Also bumped the stale ~918 test-count floor to ~962 backend / ~345 frontend. Doc-only (no code);
  verified the tree carries only CLAUDE.md. No build gate needed.
  Next cycle (48): `deep-review` is most-starved over budget (cyc 42, starved-for 6 > 5 at cyc 48;
  arch cyc 43 starved-for 5 = budget) → `deep-review` wins. Freshest unreviewed surface = the C45/C46
  frontend mileage UI (ReminderForm branch + /reminders Serviced button) — an eyes-on/logic review
  (fan out, verify vs source) that ALSO partially discharges the pending T7/T8 eyes-on. Then arch
  (settings-DROP). bug #11 queued; #14/#16 await Angelo.
- **C48 (guard — lock the frontend null-nextDueDate invariant)** — BALANCE: guard (cyc 41, starved-for
  7) AND deep-review (cyc 42, 6) both over budget; most-starved = `guard` → it wins (my C47 note guessed
  deep-review; guard's raw 7 > 6 — the table rules, keep computing all six). The C39 audit confirmed all
  null-nextDueDate consumer sites are guarded, but there was NO committed test locking it — a future edit
  re-introducing `new Date(reminder.nextDueDate)` on a pure-mileage reminder (null date → 1970 epoch →
  wrongly "due", or a crash) would pass review. LOCKED IT, merge-surviving, via the extraction pattern
  (not a fragile regex source-scan): created `reminder-helpers.ts` with exported null-safe
  `isReminderTimeDue(reminder, now?)` + `isMileageTracking(reminder)`, routed the /reminders page's
  inline `isDue` + the C46 page-local `isMileageTracking` through them (behavior-preserving — page
  renders identically), and pinned with `reminder-helpers.test.ts` (5, incl. THE load-bearing assertion:
  a null-nextDueDate reminder is never time-due). `now` is injectable for deterministic tests. Verified:
  frontend validate:local EXIT 0 (tsc 0 · build · 350 tests, +5 · prettier clean).
  Next cycle (49): `deep-review` is most-starved over budget (cyc 42, starved-for 7 > 5 at cyc 49) → it
  wins → eyes-on/logic review of the C45/C46 frontend mileage UI (also partially discharges the pending
  T7/T8 eyes-on). Then arch settings-DROP (cyc 43, breaches ~50). bug #11 queued; #14/#16 await Angelo.
- **C49 (deep-review → found+fixed 1 real display bug; the C45/C46 mileage UI)** — `deep-review` most-
  starved over budget (cyc 42, starved-for 7 > 5; arch 6 + bug 5 also over, deep-review won by raw
  starved-for). Reviewed the freshest unreviewed surface — the C45 ReminderForm mileage branch + C46
  /reminders Serviced button + C48 reminder-helpers — reading each in full AND verifying the form's
  payload against the backend `reminderBaseSchema`/route (the C21/C28/C35/C42 verify-before-acting
  lesson). RESULT: form payload valid (pure-mileage still sends a required frequency/startDate, which
  the route converts to nextDueDate: null), null-handling on the page all guarded (C39/C48). ONE REAL
  bug found by cross-referencing form→backend→card: a pure-mileage reminder still carries frequency
  ='monthly' (backend requires it, form sends its default), and the /reminders card rendered that
  frequency UNCONDITIONALLY (`<Badge>{frequencyLabel(item)}</Badge>`) → a misleading "Monthly" badge on
  an oil-change-every-5,000-mi reminder whose time axis is INERT (engine is odometer-driven, nextDueDate
  null). Low-med, decided (no product question — just wrong), label-only fix. FIXED via the C48
  extraction pattern: added exported, tested `frequencyLabel(reminder): string | null` (+ `hasTimeAxis`)
  to reminder-helpers.ts — returns null when no time axis; routed the page's inline frequencyLabel
  through it and gated the Badge on non-null. Behavior-preserving for time/both (badge still renders);
  the inert-schedule badge is suppressed for pure-mileage. CAUGHT MYSELF mid-edit adding an "Every 5,000
  mi" interval badge with a HARDCODED 'mi' unit (the C204 hardcoded-unit class — wrong for km users) and
  removed it (the milestone already shows correctly on the card's odometer line). Pinned by 5 new helper
  tests (hasTimeAxis time|both, frequencyLabel Monthly/custom/both, + the load-bearing null-for-pure-
  mileage assertion). Verified: frontend validate:local EXIT 0 (tsc 0 · build · 355 tests, +5 · prettier
  clean). Also partially discharges the pending T7/T8 eyes-on — the form/card LOGIC is now reviewed +
  pinned, though a literal screenshot is still Playwright-sandbox-blocked.
  Next cycle (50): `arch` is most-starved over budget (cyc 43, starved-for 7 > 5 at cyc 50; bug cyc 44
  starved-for 6 > 3 also over — arch wins by raw starved-for) → arch settings-DROP (the C43
  characterize-then-drop pair: drop the 5 settings try/catch, let the SyncError-aware central handler
  shape responses; the C43 net makes it safe + the GET-masks-500 / PUT-message changes are the reviewed
  delta). Then `bug` (#11 mobile fuel-stat wrap, or #16/#14 if Angelo has answered). T9 e2e + vehicle-
  stats reconcile remain the last maintenance-schedule pieces.
- **C50 (arch — #1 part 2c-drop: converge settings error handling on the central handler)** — `arch`
  most-starved over budget (cyc 43, starved-for 7 > 5; bug also over at 6, arch won by raw starved-for).
  Executed the drop the C43 characterization set up. VERIFIED the exact delta vs source first (the
  C24/C30/C36 pattern): read settings/routes.ts + the C43 test + the central errorHandler before
  touching anything. Dropped the hand-rolled try/catch from all 4 settings handlers (GET /, PUT /,
  POST /backup, POST /restore) + removed the now-unused `AppError`/`logger` imports (kept `ValidationError`
  — still used by the storage/backup validators at :49/:61/:67/:94). BEHAVIOR DELTA, all reviewed +
  intended (arch rule 2 authorized exception, net-built C43): (1) PUT ZodError → was
  AppError('Invalid settings data', 400), now the central handler's ValidationError('Invalid request
  data', 400) — STATUS UNCHANGED (400), only the transformed message standardizes; (2) GET / no longer
  MASKS a typed error as a blanket 500 — a NotFoundError/ValidationError now reaches its real status
  (improvement); (3) POST /backup likewise; (4) POST /restore's catch was dead (its try body only
  returns, can't throw) → pure boilerplate removal. The storage/backup ValidationErrors (AppError
  subclass) flow through the handler by their 400 statusCode unchanged. Updated the ONE C43 assertion
  the drop changes (PUT message → 'Invalid request data'); the SyncError-style positive controls + the
  path-traversal 400 stayed GREEN unchanged, proving the common paths are preserved. Dropped a
  speculative `code === 'VALIDATION_ERROR'` assertion after verifying AppError carries no `code` field
  (the envelope code is derived in formatErrorResponse) — didn't over-assert an unverified shape.
  Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean, auto-reflowed the de-indented handlers ·
  961 pass/0 fail · build bundled). `sync` (C36) + `settings` (C50) now converged; `auth` (7 try/catch)
  is the LAST hand-rolled route file — its own characterize-then-drop pair for a future arch cycle.
  Next cycle (51): `bug` is most-starved over budget (cyc 44, starved-for 7 > 3 at cyc 51; feature cyc
  46 starved-for 5 > 4 also over — bug wins by raw starved-for) → take a decided standalone bug. #11
  (mobile fuel-stat wrap, UI + screenshot — but Playwright is sandbox-blocked here, so a logic/source
  fix + the markup is the floor) is the main decided one; #14/#16 still await Angelo's semantics calls.
  Then `feature` → maintenance-schedule T9 e2e + the deferred vehicle-stats reconcile (the last pieces).
- **C51 (bug — #5: CSV import strips a leading UTF-8 BOM)** — `bug` most-starved over budget (cyc 44,
  starved-for 7 > 3 at cyc 51; feature also over at 5, bug won by raw starved-for). FIRST completed the
  squash-merge rebase that interrupted last cycle: `origin/main` got #107 (squash of C1–C48) + 2
  dependabot bumps, but it did NOT absorb C49/C50 source. Confirmed the divergence was only 11 files in
  TWO DISJOINT sets — 4 dependabot files (main ahead) vs 7 of my files (branch ahead, C49+C50 + loop
  docs), zero overlap — via `diff --stat` + `--diff-filter=AD` (no add/delete). Reset onto new main,
  overlaid the 7 branch-ahead files from the backup ref (one path per checkout), verified BOTH gates
  green against main's newer deps, committed `eb1c059`, force-pushed-with-lease (pinned to the observed
  remote SHA) — branch now 0/0 with remote. Then popped the C51 stash (import-csv.ts identical old-tip
  vs new-main, clean apply) and finished the fix: added `bom: true` to the csv-parse options in
  buildImportPlan. WHY: the export's first column is `date`; a BOM-prefixed re-save (Excel/Sheets/Numbers)
  keys it as "﻿date" → record.date undefined → EVERY row fails a misleading "Invalid date". Anchored
  with a real-stack HTTP regression in import-csv.test.ts (BOM-prefixed CSV imports cleanly; pre-fix it
  would be imported:0/errorCount:1). Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean · 962
  pass/0 fail, +1 · build bundled). Next cycle (52): recompute all 6 from this table — `deep-review` (cyc
  49, starved-for 3) and `feature` (cyc 46, starved-for 6 > 4, OVER) lead; feature wins → maintenance T9
  e2e + the deferred vehicle-stats reconcile. #11 (mobile fuel-stat wrap) + #14/#16 (Angelo) still queued.
- **C52 (feature — maintenance-schedule T3 part 3: the deferred vehicle-stats reconcile)** — added the
  canonical all-time `currentOdometer` to GET /vehicles/:id/stats via the D2 `getCurrentOdometer(id)`
  helper (all-sources MAX: expenses ∪ manual odometer entries, period-INDEPENDENT). ADDITIVE — existing
  `currentMileage` (period-filtered + fuel-only) is untouched, so zero behavior change to current
  consumers. Frontend `VehicleStats` type gained the optional field + doc-comments distinguishing the two.
  Anchored by a NEW real-stack HTTP test (vehicle-stats-current-odometer.test.ts, 4 cases) pinning the two
  properties that separate it from currentMileage: period-independence (a 7d window that zeroes
  currentMileage leaves currentOdometer intact) + cross-source MAX (a manual 18000 entry that the fuel-only
  stat ignores). Backend property test had ZERO currentMileage assertions, so nothing pre-pinned this.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 966 pass/0 fail, +4 · build bundled);
  frontend validate:local EXIT 0 (tsc 0 · build · 355 tests). NOTE → Angelo (sent): two follow-ons surfaced
  here — (1) lease/loan miles-used CONSUME the period-scoped `currentMileage`, so a non-'all' stats period
  silently understates overage; switching those consumers to `currentOdometer` is the real fix (a bug, but
  user-visible $ change). (2) Whether the "Current Mileage" stat CARD should stay period-scoped or show the
  true odometer is a display-semantics direction call. Both deferred — not blocking. Next cycle (53):
  recompute all 6 — `deep-review` (cyc 49, starved-for 4) and `infra` (cyc 47, starved-for 6 = budget) lead;
  deep-review likely wins. T9 (e2e + eyes-on) remains Playwright-sandbox-blocked here.
- **C53 (infra — refresh stale CLAUDE.md orientation post-C52)** — recomputed all 6: nothing strictly
  OVER budget; `infra` was most-starved AT budget (6 = 6, breaches next cycle), so took the recurring
  highest-leverage infra item (the orientation-doc refresh, last done C47). VERIFIED the drift before
  acting: CLAUDE.md "Current state" listed the vehicle-stats reconcile (T3-part-3) as REMAINING, but C52
  shipped it — a fresh agent would re-do completed work. Rewrote that line to "T3-part-3 DONE (additive
  currentOdometer); remaining T9 only", noted the two Angelo-flagged follow-ons (lease/loan consumer bug +
  card display call), and bumped the stale test floors (~962→966 be / ~345→355 fe). Doc-only — working
  tree carried only CLAUDE.md, no build gate needed. Next cycle (54): `deep-review` most-starved
  (cyc 49, starved-for 5 = budget) → likely an eyes-on/logic review (T9 e2e still Playwright-blocked).
- **C54 (deep-review — CONFIRM + trace the C52-suspected lease/loan miles-used bug)** — the two top
  deep-review queue items are eyes-on screenshot passes (Playwright-sandbox-blocked), so took the
  actionable highest-leverage target: rigorously verify the bug I flagged to Angelo in C52. TRACED end
  to end against source: `FinanceTab.svelte` passes `vehicleStatsData?.currentMileage` to both
  `PaymentMetricsGrid` (loan mileageUsed, ~L151) and `LeaseMetricsCard` (→ `calculateLeaseMetrics`, ~L173);
  `vehicleStatsData` is fetched with the user-controlled `selectedStatsPeriod` (default 'all', so the
  default is correct) via the Overview PeriodSelector → `$effect` refetch (L173-185); `currentMileage` is
  period-filtered + fuel-only. CONFIRMED: choosing 7d/30d on Overview silently understates lease overage /
  loan miles-used (and ignores manual odometer entries). `calculateLeaseMetrics` itself is correct +
  well-tested (lease-metrics.test.ts) — the defect is purely the call-site source. Fix = swap to the C52
  all-time `currentOdometer`, but it's a USER-VISIBLE $ change already flagged to Angelo → did NOT execute
  (loop rule 7). Increment: behavior-preserving inline NOTE breadcrumbs at BOTH FinanceTab call sites + a
  first-class, traced, ready-to-execute bug entry in BACKLOG (promoted from a buried C52 feature-note line).
  Comment-only; frontend validate:local EXIT 0 (tsc 0 · build · 355 tests · prettier clean). Next cycle
  (55): recompute all 6 — `guard` most-starved (cyc 48, starved-for 7 > 6, OVER) → it wins.
- **C55 (guard — FE↔BE contract-drift lock on the /stats response shape)** — implements loop-improvement
  proposal #2 (the contract-drift guard Angelo flagged top-2) for the freshest surface. The /stats response
  is hand-assembled in routes.ts (`c.json({ period, ...stats, currentOdometer })`) with ZERO type binding to
  the frontend `VehicleStats` contract it must satisfy: backend `calculateVehicleStats` returns only 11
  fields, the route adds `period` + `currentOdometer` separately (C52 added the latter to BOTH sides
  independently — exactly the drift class). A refactor returning the calculator output directly, or
  dropping/renaming a field, would silently diverge and the UI reads `undefined`. Added 3 HTTP cases to
  vehicle-stats-current-odometer.test.ts asserting `Object.keys(data).sort()` EXACTLY equals
  EXPECTED_STATS_FIELDS (the 13-field frontend contract, mirrored as the pin) — bidirectional: a dropped
  key AND an unmirrored added key both fail; proven shape-stable across empty/populated and all 5 periods.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 969 pass/0 fail, +3 · build bundled).
  Next cycle (56): recompute all 6 — `bug` most-starved over budget (cyc 51, starved-for 5 > 3) → it wins;
  but the top bug (lease/loan miles-used) is PENDING ANGELO, so pick the next decided bug (#1 vehicle-detail
  load-failure-masquerades-as-empty, or #3 ExpensesTable dead h-[] class).
- **C56 (arch — #1 part 2d: VERIFIED auth already-converged → arch #1 CLOSED)** — BALANCE NOTE: recomputed
  all 6; arch (cyc 50, starved-for 6) outranked bug (cyc 51, starved-for 5) by raw starved-for — the C55
  forecast said "bug" but slow-budget arch breached higher (the standing mis-forecast lesson; always
  recompute). Took arch #1 part 2d (the last route file, `auth`). GROUNDING CORRECTION: the BACKLOG's "7
  hand-rolled try/catch, characterize-then-drop" premise was WRONG. Read every block in auth/routes.ts: the
  error-surfacing handlers (`/me`, `/refresh`, `PATCH /me`, `/providers/connect`) ALREADY throw HTTPException
  directly with NO try/catch, and the central errorHandler shapes HTTPException (error-handler.ts:43) → already
  on the canonical envelope. The 5 try/catch that exist are business-logic recovery/redirect that MUST stay
  (UNIQUE-constraint recovery L164/L206, OAuth token-exchange → specific redirect outcomes L368/L837, JSON
  guard L472) — dropping any is a behavior change. So NO drop; auth is converged. Increment = correct the
  BACKLOG premise + CLOSE arch #1 + a merge-surviving convergence guard: +4 PATCH /me cases in me-http.test.ts
  pinning the 400 paths surface through the central handler in the canonical envelope (code 'HTTPException').
  The positive control caught a real shape assumption (data.user.displayName, not data.displayName) — fixed
  before commit. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 973 pass/0 fail, +4 ·
  build bundled). arch #1 DONE (sync C36 + settings C50 dropped; auth verified). Next cycle (57): recompute —
  `bug` most-starved over budget (cyc 51, starved-for 6 > 3) → wins; top bug PENDING ANGELO, take next decided
  (#1 load-failure-masquerade or #3 ExpensesTable dead h-[] class).
- **C57 (bug #1 — vehicle-detail load failure masquerades as empty state)** — top bug (lease/loan miles-used)
  is PENDING ANGELO, so took the next decided one. VERIFIED against source: `loadSummary` (Overview) and
  `fetchExpensesPage` (Expenses tab) in vehicles/[id]/+page.svelte only toast on failure, leaving
  `summary=null` / `expenses=[]` → the Overview renders "No expenses yet" and the Expenses tab renders the
  empty table, so a returning user whose fetch failed thinks their data vanished (NORTH_STAR four-states:
  error ≠ empty). Fix mirrors the proven dashboard/analytics idiom: added `summaryLoadError` +
  `expensesLoadError` flags (set in each catch, cleared at the top of each load), and error+retry branches
  that take PRECEDENCE over the empty states (`{#if error && !isLoading} … {:else if !hasData}`). Retry
  re-invokes the same loader; period-change/delete paths already call the loaders (which clear the flag), so
  recovery is clean. Verified: frontend validate:local EXIT 0 (tsc 0 · build · 355 tests · prettier clean).
  CAVEAT (same as T7/T8): UI-state change, eyes-on screenshot Playwright-sandbox-blocked here — but the
  error-over-empty precedence is a pure tsc-checked conditional mirroring a shipped pattern. Next cycle (58):
  recompute all 6 — `feature` most-starved over budget (cyc 52, starved-for 6 > 4) → wins; only T9 (e2e +
  eyes-on, Playwright-blocked) remains on maintenance-schedule, so likely import-trackers T1 (the other
  approved spec) OR flag T9's blocker. arch #1 is closed; #2 (frontend load-state extraction) now has C57 as
  a second concrete instance motivating it.
- **C58 (feature — import-trackers T1: the translation pre-pass)** — maintenance-schedule has only T9 left
  (Playwright-blocked), so opened the OTHER approved spec (import-trackers, backend-first per its tasks.md).
  T1 = `import-mapping.ts`: pure `ColumnMapping` type + `applyMapping(foreignCsv, mapping, target)` →
  VROOM-NATIVE CSV that the EXISTING `buildImportPlan` consumes UNCHANGED, so all downstream safety (per-row
  validation, formula denormalize, cross-tenant vehicle resolution, idempotent re-import, atomic commit) is
  inherited free. Implements rename + unit-convert INTO the target vehicle's units (D1, reuses
  unit-conversions.ts) + decimal-comma + category map (unmapped→misc + a VISIBLE `unmappedCategories` note,
  D2) + local-time date normalization across iso/mdy/dmy/epoch (D3, the cycle-6/11 discipline — never
  `new Date('YYYY-MM-DD')`) + no-vehicle-column → targetVehicle (D4). Pure (no DB/Hono), fully additive — the
  native import path is untouched and stays the default when no mapping is sent. 14 unit tests incl. the
  load-bearing applyMapping→buildImportPlan round-trip (a Fuelio-shaped metric file maps+converts into a
  plan that imports clean) + the timezone-independent local-day invariant. tsc caught an optional-chain
  arithmetic null (exp?.date.getMonth()+1) — narrowed with a guard, no non-null assertion (repo lints it).
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 987 pass/0 fail, +14 · build bundled).
  Next (59): recompute all 6 — `deep-review` most-starved (cyc 54, starved-for 5 = budget) likely wins;
  T2 (presets + detectSource) is the next import-trackers increment when feature comes due again.
- **C59 (infra — land the pre-authorized NORTH_STAR loop-improvement #3 straggler)** — BALANCE: nothing
  strictly OVER; `infra` most-starved AT budget (cyc 53, starved-for 6 = 6, breaches next), and a verified
  uncommitted doc edit was already sitting in the tree, so landing it IS the cleanest infra increment (a
  dangling pre-authorized edit risks being lost or bundled into unrelated work). Angelo ratified loop-improvements
  #2–#5 on 2026-06-09; the #3 rollout was split — its BACKLOG "FEATURE DoD" pair committed C57, but the
  NORTH_STAR quality-bar half was cut by a 503. This adds the FE→BE→DB→render E2E feature-DoD sentence to
  NORTH_STAR §3 (a green build is the FLOOR; a new capability isn't done until one round-trip E2E exercises
  the FE↔BE seam where integrated bugs hide — harness-blocked → "code-complete, eyes-on pending", not done),
  making the vision file consistent with the already-committed BACKLOG/LEDGER halves. NOT a self-authored
  vision change — it's the approved edit, verified against the #3 wording before landing. Also confirmed (the
  cheap half of the #5 cadence): zero stray untracked `*.test.ts` outside the by-design `*.meshclaw.e2e.ts`
  set, so no coverage is silently dropping on merge. Doc-only, no build gate. ALL FIVE loop-improvements now
  landed (#1 Playwright-unblock still needs live shell; #2 contract-guard shipped C55; #3 here; #4 coverage-
  trend note; #5 branch-hygiene cadence). Next (60): recompute — `deep-review` most-starved (cyc 54, starved-
  for 6 > budget 5, now OVER) → wins; a correctness/eyes-on review of a shipped surface (C58 import-mapping is
  freshly landed but self-authored — higher independent value to review the vehicle Overview/ExpensesTable).
- **C60 (deep-review — adversarial audit of C58 import-mapping.ts)** — both queued deep-reviews (#1 vehicle
  Overview, #2 analytics) are eyes-on/Playwright-blocked, so took the highest-leverage EXECUTABLE review: a
  backend correctness audit of the freshest un-reviewed surface — C58's self-authored `import-mapping.ts`
  (real edge-case logic in unit-convert/decimal/date parsing, zero independent review). VERDICT: CORRECT for
  its documented contract — no defect. Pinned two verified-but-uncovered branches with characterization
  guards (NORTH_STAR #5): (a) an ISO value with an explicit tz (Z or ±hh:mm) is honored as an absolute
  instant — the ONE date branch that must NOT use local-time construction; (b) the non-finite-mapped-value
  contract — mapVolume/mapMileage pass garbage through verbatim so it surfaces as a normal buildImportPlan
  per-row error, never a whole-file crash. Running the focused test FIRST confirmed both assumptions held
  (verify-against-source). +3 tests (987→990). Surfaced two latent T3-WIRING risks (not C58 defects, noted
  in BACKLOG): applyMapping's `target` defaults to {} (T3 must pass the vehicle's units or values store
  unconverted-but-relabeled), and normalizeDecimal treats a lone comma as decimal (a manual US-thousands
  mapping would corrupt — fine once presets cover it). Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 990 pass/0 fail · build bundled). Next (61): recompute — `guard` most-starved (cyc 55,
  starved-for 6 = budget 6, AT) likely; bug AT (cyc 57, 4>3 OVER) jumps if a real defect is queued.
- **C61 (bug #6a — CSV-import date-only midnight-UTC day-shift)** — `bug` OVER (cyc 57, starved-for 4 > 3,
  tightest budget). Top bug (lease/loan) PENDING ANGELO, so took the next decided one. VERIFIED against
  source: `parseDate` (import-csv.ts) did `new Date(raw)` — a bare `YYYY-MM-DD` (hand-edited or foreign file,
  not our own export which writes full ISO) parses as UTC midnight → the calendar day rolls BACK for any user
  west of UTC (the cycle-6/11 class, native-import twin of the C58 normalizeForeignDate fix). Fix: detect
  date-only via `^\d{4}-\d{2}-\d{2}$` and build from parts in LOCAL time; full-ISO + any other parseable
  string keep their absolute-instant semantics via `new Date`. +2 HTTP tests (date-only keeps local day in
  any CI zone via the timezone-independent local-getter invariant; full-ISO instant un-regressed). The
  bundled "#6b currency column silently ignored" half was INVESTIGATED + DISMISSED (not a bug): currencyUnit
  is a USER-SETTINGS field (schema.ts:303), not per-expense — amounts store as bare numbers in the user's
  single currency, so the export's `currency` column is informational and ignoring it on re-import is correct.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 992 pass/0 fail, +2 · build bundled).
  Next (62): recompute — `guard` most-starved (cyc 55, starved-for 7 > 6, now OVER) → wins; the queued guard
  is generalizing the FE↔BE contract-drift lock (loop-improvement #2) to another hand-assembled response.
- **C62 (guard — extend the FE↔BE contract-drift lock to GET /vehicles list)** — `guard` most-starved
  (cyc 55, starved-for 7 > 6, OVER). Continued loop-improvement #2 (C55 locked /stats). PICKED the highest-
  leverage drift surface: the /vehicles list route hand-assembles each financed vehicle (routes.ts:140-153),
  spreading the repository financing row and INJECTING two computed fields the repository never stores —
  `computedBalance` (financingRepository.computeBalances) + `eligibleForPayoff`. The frontend `VehicleFinancing`
  contract (vehicle.ts:65-66) declares both, and the FE reads `computedBalance` for payoff-date math, the
  payment planner, lease metrics, and the financing-form payoff display — yet NOTHING pinned the route still
  emits them (a refactor returning findByUserId raw would silently drop both → every consumer falls back to
  `?? 0` → payoff logic breaks with no failing test). New vehicles-list-financing-contract.test.ts (3 cases):
  computed keys present + typed + base fields survive the spread; a fresh 20k loan is NOT eligible-for-payoff
  (anchors the computed SEMANTICS, not just key presence); a no-financing vehicle omits the object. A wrong
  seed path (mounted at /api/v1/financing/vehicles/:id/financing, not /api/v1/vehicles/:id/financing) failed
  the test LOUDLY first — proof it exercises the real enrichment branch, not a vacuous pass. Verified: backend
  validate:local EXIT 0 (tsc 0 · musl-biome clean · 995 pass/0 fail, +3 · build bundled). Next (63): recompute
  — `arch` most-starved (cyc 56, starved-for 7 > 5, OVER) → wins; arch #1 closed, so it's arch #2 (frontend
  load-state extraction, now with C57 + the C3 vehicle-detail pattern as concrete instances) or an audit fan-out.
- **C63 (arch #2 step 1 — extract the frontend load-state scaffold)** — `arch` most-starved (cyc 56,
  starved-for 7 > 5, OVER). arch #1 CLOSED, so arch #2 (the ~14-page `isLoading`/`loadError`/try-catch-toast
  triad — the exact class the bug queue keeps re-finding as load-failure-masquerades-as-empty). The full
  per-page MIGRATION is UI-touching → eyes-on-blocked here, so per arch rule 3 (build the safety-net/scaffold
  FIRST, migrate next cycle against it) this cycle extracted ONLY the primitive: `createLoadState<T>()` in
  `load-state.svelte.ts` — `data`/`isLoading`/`error`/`isError` getters + `run(loader)` reproducing the
  try/catch/finally verbatim (onError side-effect, `e instanceof Error ? .message : fallback`, prior-data-kept-
  on-failure, isLoading reset in finally) + `set`/`clearError`. No page touched → behavior-preserving by
  construction (new unused module), no eyes-on needed. 10 unit tests pin the contract a later migration will
  rely on. NOTABLE: this established `.svelte.ts` rune modules ARE unit-testable here (zero prior
  `.svelte.test.ts` existed — confirmed runes compile under the `sveltekit()` vitest plugin with synchronous
  `$state` access, no `$effect`), which de-risks every future arch #2 migration step. Ran the focused test
  FIRST to prove the unproven rune-in-test path before relying on it. Verified: frontend validate:local
  EXIT 0 (tsc 0 · build · 365 tests, +10 · prettier clean). Next (64): recompute — `feature` most-starved
  (cyc 58, starved-for 6 > 4, OVER) → wins; import-trackers T2 (presets + detectSource, pure + unit-tested).
- **C64 (feature — import-trackers T2: tracker presets + detectSource)** — `feature` most-starved (cyc 58,
  starved-for 6 > 4, OVER). Built `import-mapping-presets.ts`: a static `MappingPreset` table for
  Fuelly/Fuelio/Drivvo (D5-ratified set) — each a ready ColumnMapping (columns + dateFormat + units +
  categoryMap) + a header SIGNATURE — plus `detectSource(headers)` (auto-pick the preset) and
  `presetToMapping(preset, targetVehicle)` (→ a valid T1 ColumnMapping). Detection is NORMALIZED (lower-case +
  strip non-alphanumerics) + SUBSTRING-based on a DISTINCTIVE signature subset (Fuelly odometer+fillamount,
  Fuelio odo+litres, Drivvo totalprice+typeoffuel) so real header decoration (`Odo (km)`, BOM, spacing) doesn't
  defeat it and the three don't cross-detect; unknown files → null (safe → manual mapping). GROUNDING CALL:
  D5 ratified the SET but the requirements don't pin exact header strings, and the design defers real-export
  validation to T6 — so rather than fabricate exact signatures (a wrong one = silent never-match), I built the
  MECHANISM with drift-tolerant matching + flagged real-export validation as a T6 prerequisite (mis-detect is
  the safe failure). Caught + fixed my own first-draft bug pre-test: exact-token matching would've made Fuelio
  (`Data`/`Odo (km)`) never match — switched to substring. 10 unit tests incl. the self-consistency check
  (every preset detects its OWN seeded columns), no-cross-detect, drift tolerance, and a presetToMapping→
  applyMapping round-trip. Pure module, fully additive. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1006 pass/0 fail, +10 · build bundled). Next (65): recompute — `infra` most-starved
  (cyc 59, starved-for 6 = budget 6, AT) likely; deep-review (cyc 60, 5=5 AT) close behind.
- **C65 (bug #3 — ExpensesTable dead interpolated `h-[{scrollHeight}]` class)** — recompute: `bug` was the
  only STRICTLY-over category (cyc 61, starved-for 4 > 3) — infra+deep-review only sat AT budget — so bug won
  by the tightest-over rule (NOT infra as the C64 forecast guessed; the standing mis-forecast lesson). Top bug
  (lease/loan) PENDING ANGELO → took #3 (decided, fully verifiable). VERIFIED against source: ExpensesTable
  line 657 `<ScrollArea class="h-[{scrollHeight}] w-full">` — Tailwind only emits arbitrary-value utilities it
  sees as STATIC literals at build time, so a runtime-interpolated `h-[{scrollHeight}]` generates NO rule →
  the 600px cap + internal scroll never engaged → a many-row vehicle grew unbounded (CONFIRMED C14 via DOM
  probe). Fix: inline `style="height: {scrollHeight}"` (ScrollArea spreads style to the DOM; the ChartCard
  idiom). MERGE-SURVIVING GUARD (quality-bar #5): `no-interpolated-arbitrary-class.test.ts` source-scans every
  `.svelte` for `<util>-[…{…]` (static `h-[600px]` never matches; comment-strip so the explanatory comment
  quoting the dead pattern doesn't self-trip). VERIFIED THE C14 "harmless charts" CLAIM against source: the
  two `h-[{CHART_HEIGHT}px]` ARE the same dead class but masked (each passes `height={CHART_HEIGHT}` to its
  ChartCard wrapper, which sets the real height) → excluded with a documented anchor, not edited (avoids a
  blocked eyes-on chart change). frontend validate:local EXIT 0 (tsc 0 · build · 367 tests, +2 · prettier
  clean). CAVEAT: eyes-on Playwright-blocked; fix is tsc/build-verified + the proven idiom. Next (66): recompute
  — `infra` (cyc 59, 7 > 6, OVER) + `deep-review` (cyc 60, 6 > 5, OVER) both over; infra most-starved → wins.
- **C66 (infra — #5 branch-hygiene sweep: BRANCH_REVIEW.md refresh)** — `infra` most-starved (cyc 59, 7 > 6,
  OVER); the standing #5 cadence (every ~10 cycles, 60+ commits deep toward one human PR) had NEVER run as a
  full sweep (C59 did only the cheap untracked-test half). Three parts: (1) stray untracked unit tests OUTSIDE
  the by-design `*.meshclaw.e2e.ts` set — ZERO (clean); (2) green baseline — regress.sh Playwright-blocked, so
  backend+frontend validate:local stand in (1006 BE + 367 FE, all green this arc); (3) BRANCH_REVIEW.md
  refresh — it was BADLY stale: described the OLD `feat/offline-entries` branch at 154 commits, but that work
  was squash-merged into origin/main and claude-loop-dev was rebased onto the squash (eb1c059), so the live
  branch is only 16 commits (C51–C65, 28 files +2339/−202) cleanly off origin/main. Rewrote the digest from
  REAL `git log origin/main..HEAD` (not memory): correct branch/scope/base, themed by feature(import T1+T2,
  stats reconcile)/bug(BOM, load-masquerade, date-only, dead-class)/guard(×3)/arch(#1 closed, #2 scaffold)/
  deep-review, with the eyes-on-pending UI fixes + the two Angelo-pending decisions called out for the
  reviewer. BRANCH_REVIEW.md is gitignored → not in the commit (only the loop docs are). Verified: doc-only,
  no build gate; git facts confirmed via rev-list/diff/log. Next (67): recompute — `deep-review` most-starved
  (cyc 60, starved-for 7 > 5, OVER) → wins; an executable backend audit or (if unblocked) an eyes-on sweep.
- **C67 (deep-review — audit the unpinned analytics-charts.ts builders)** — `deep-review` most-starved (cyc
  60, 7 > 5, OVER). Both queued eyes-on sweeps are Playwright-blocked, so took the highest-leverage EXECUTABLE
  review: the analytics pure-math layer (the richest historical defect vein — C7/C11/C14/C23). Found 6
  date/bucketing builders with ZERO test references (buildDayOfWeekPatterns, buildSeasonalEfficiency,
  buildMonthlyCostHeatmap, computeRegularityScore, computeMileageScore, computePreviousYearComparison).
  FAN-OUT: 2 parallel Explore agents on distinct subsets + I read the date-sensitive ones directly. VERDICT:
  CORRECT — no real defect. Both agents flagged `accumulateIntervalBuckets`'s in-place `vehicleRows.sort()`
  as a HIGH "cross-chart side-effect" bug; per the standing C21/C60 rule (verify agent findings against
  source — most "HIGH" ones are false positives) I checked the blast radius MYSELF: the sorted array is a
  FRESHLY-GROUPED LOCAL array inside buildFillupIntervals (byVehicle map of new arrays), NOT the caller's
  fuelRows — and the route's only other consumer of that same fuelRows (buildDayOfWeekPatterns) buckets by
  getDay(), order-independent. So NO observable bug → downgraded. Still applied a defensive `[...vehicleRows]`
  copy (behavior-identical hygiene, keeps the helper pure against a future caller) + locked all 6 with
  characterization tests (analytics-charts-unpinned.test.ts, 15 cases: empty/single-elem no-NaN, divide-by-
  zero guards, the newest-24-months slice direction = NOT the C11 oldest-bug, the no-mutation invariant).
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1021 pass/0 fail, +15 · build bundled).
  Next (68): recompute — `guard` most-starved (cyc 62, starved-for 6 = budget 6, AT) likely; arch (cyc 63,
  5=5 AT) + feature (cyc 64, 4=4 AT) also AT — recompute all 6 at cycle start (slow-budget mis-forecast risk).
- **C68 (guard — lock the single-financing GET enriched contract)** — BALANCE: four categories sat exactly
  AT budget (feature 4=4, bug 3=3, guard 6=6, arch 5=5), none STRICTLY over. Tie-break: the top decided bug
  (#2 vehicle-detail page-local filter) is UI-touching → eyes-on-blocked, and the lease/loan bug is PENDING
  ANGELO, so the highest-leverage FULLY-VERIFIABLE pick was `guard` (also most-starved at 6). Continued
  loop-improvement #2: the single-financing GET (`/financing/vehicles/:id/financing`) runs `enrichWithBalance`
  (routes.ts:82), injecting the SAME `computedBalance` + `eligibleForPayoff` as the C62 /vehicles list — but
  on a SEPARATE surface (the one FinanceTab fetches directly), with no guard. A refactor returning the raw row
  would drop both → FE payoff math falls back to `?? 0` silently. New financing-get-contract.test.ts (3 cases:
  computed keys present + typed + base fields survive the spread; fresh 20k loan NOT eligible-for-payoff =
  the computed SEMANTICS; no-financing → data:null). Used the correct `/api/v1/financing/vehicles/...` mount
  path (the C62 doubled-path lesson). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean ·
  1024 pass/0 fail, +3 · build bundled). Next (69): recompute — `arch` (cyc 63, starved-for 6 > 5, now OVER)
  + `feature` (cyc 64, 5 > 4, OVER) both over; arch most-starved → arch #2 step 2 (migrate a page onto
  createLoadState — UI-touching/eyes-on) OR an audit-fan-out arch item if a non-UI one surfaces.
- **C69 (arch — dedup the stats-period → start-date switch)** — `arch` most-starved (cyc 63, 6 > 5, OVER).
  arch #2 step 2 (page migration onto createLoadState) is UI-touching → eyes-on-blocked, so per rule 7 I
  fanned out 2 Explore agents for a NON-UI backend target. Picked DEDUP over the agents' other find: the
  identical period→Date day-offset switch was copy-pasted in vehicles/routes.ts (stats filter) +
  expenses/repository.ts (query filter). Extracted `getPeriodStartDate(period, now?)` + `StatsPeriod` to
  utils/calculations.ts ('all'→null, bounded→now−N days); wired both sites; expenses keeps its `?? new
  Date(0)` defensive fallback (behavior-identical — unreachable for the fixed enum). VERIFIED the agents'
  "subtle default divergence" worry against source (C21/C60 rule): the `new Date(0)` vs `null` defaults sit
  in never-reached branches (behind `period!=='all'` / the 'all' case), so the extraction is safe. +5 unit
  tests for the helper; both call sites' EXISTING property tests stayed green = the green→green
  behavior-preserving proof (arch rule 3). REJECTED the 2nd agent finding (delete dead handleSyncError): it's
  the byte-identical ORACLE the C24 equivalence test asserts against — deleting it is churn-for-churn (arch
  rule 5: name a payoff), not a win. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean ·
  1029 pass/0 fail, +5 · build bundled). Next (70): recompute — `feature` (cyc 64, starved-for 6 > 4, OVER)
  + `bug` (cyc 65, 5 > 3, OVER) both over; bug has the tighter budget → likely bug, but its top items are
  PENDING ANGELO (lease/loan) / UI-eyes-on (#2 filter) — may need feature (import-trackers T3) instead.
- **C70 (feature — import-trackers T3: the backward-compatible route extension)** — BALANCE: `bug` + `feature`
  both OVER; bug is tighter (3) BUT its queue is fully blocked (lease/loan PENDING ANGELO; #2 filter is
  UI-eyes-on; #4 cosmetic) — no executable decided bug, so took the next-most-starved ACTIONABLE category,
  `feature` (the don't-force-a-blocked-pick rule). Extended `POST /import` with an optional `mapping` (new
  Zod `columnMappingSchema` in import-mapping.ts): when present → resolve the target vehicle's units from its
  unitPreferences → `applyMapping` → the EXISTING buildImportPlan/dryRun/importExpenses flow UNCHANGED (no new
  write path; idempotency/atomicity/tenant-safety all inherited). Added `unmappedCategories` to the response
  + a new `POST /import/detect` (header names → preset|null) for the client. BACKWARD-COMPAT: no mapping →
  native path byte-identical. C60 WIRING RISK HANDLED: units convert toward the resolved targetVehicle (a
  `resolveTargetUnits` helper matching nickname / "year make model"); no match → {} → conversion skipped
  (never a guessed unit). PROVE-IT-BITES PAID OFF: running the focused test FIRST caught a real schema bug —
  `z.record(z.enum(NativeField), …)` is EXHAUSTIVE in Zod v4 (rejected a partial `columns` object, 400'd
  every mapped import) → rewrote `columns` as explicit per-field optionals. 9 HTTP tests (preview/commit,
  metric→imperial conversion, idempotent re-import, unmapped-category surface, malformed-row per-row,
  unparseable→400, detect preset/null, native backward-compat). Verified: backend validate:local EXIT 0
  (tsc 0 · musl-biome clean · 1038 pass/0 fail, +9 · build bundled). NOTE: backend of import-trackers
  (T1–T3) is now COMPLETE, but the feature is NOT done until the T6 FE→BE→DB round-trip e2e runs (feature-DoD
  rule); T4–T6 are frontend/eyes-on, Playwright-blocked here. Next (71): recompute — `bug` (cyc 65, 6 > 3,
  OVER, tightest) + `deep-review` (cyc 67, 4 = budget... under) — bug most-starved but STILL blocked; if no
  executable bug, `infra` (cyc 66, 5 > ... ) / `guard` are the actionable fallbacks. Recompute all 6 live.
- **C71 (bug #15 — correct the false "optimistic-locked" mark-serviced claim)** — `bug` the ONLY over-budget
  category (cyc 65, starved-for 6 > 3) so I MUST pick it; re-examined the whole queue for an executable item
  rather than fall back. Findings: #2/#4/#11 are UI-eyes-on-blocked; #7 (analytics local-tz getMonth) is NOT
  a clean fix — VERIFIED toMonthKey AND monthKeysInRange are BOTH local-time + match the frontend's C6
  local-time intent, so "bucket on UTC" would INTRODUCE a divergence (a direction call, not a bug); #14/#16/
  #17 are PENDING DECISION. The one decided, fully-verifiable, no-eyes-on item was #15 (doc-accuracy). Took
  the lighter option (correct the claim, not add a CAS guard — no data risk: concurrent mark-serviced calls
  compute the SAME re-armed values from the same row, so CAS would only collapse a redundant write). VERIFIED
  the false claim's LOCATION against source: repository.ts markServiced comment was ALREADY accurate
  ("ownership-scoped"), the route had NO claim — the overclaim lived ONLY in design.md:83. Rewrote it to the
  real ownership-scoped single-statement update + why no CAS is needed. Doc-only, no build gate. NOTE: the
  bug queue is now structurally stuck — every remaining bug is either eyes-on-blocked, PENDING ANGELO, or a
  semantics decision; `bug` will keep coming up most-starved-but-unactionable until Angelo unblocks lease/loan
  or #14/#16. FLAGGED again this cycle. Next (72): recompute — `deep-review` (cyc 67, 5 = 5 AT) + `infra`
  (cyc 66, 6 = 6 AT) likely lead; both actionable (executable backend audit / loop-doc upkeep).
- **C72 (infra — refresh stale CLAUDE.md orientation post-C58–C71)** — BALANCE: nothing strictly OVER;
  `infra` + `deep-review` both AT budget, `infra` most-starved (breaches next). Took the recurring
  highest-leverage infra item (orientation-doc refresh, last C53/C66) since it was genuinely stale and a
  fresh agent reads CLAUDE.md first. VERIFIED the drift against source before editing: (1) import-trackers
  was listed "approved, NOT STARTED (T1+)" but T1 (C58) + T2 (C64) + T3 (C70) shipped — backend COMPLETE;
  rewrote to backend-done / T4–T6-frontend-eyes-on-remaining, mirroring the maintenance-schedule entry's
  honest DoD framing. (2) test floors cited "~966 be / ~355 fe" — now 1038/367 (+72/+12 across C52–C71);
  bumped. Doc-only, no build gate (working tree carried only CLAUDE.md). Next (73): recompute — `deep-review`
  (cyc 67, starved-for 6 > 5, now OVER) → wins; an executable backend correctness audit of a fresh surface
  (the C70 route extension is freshly-landed + self-authored — higher independent value than re-reviewing it,
  so likely the insurance/financing analytics math or another unpinned repository path).
- **C73 (deep-review — audit the unpinned insurance analytics path)** — `deep-review` most-starved (cyc 67,
  6 > 5, OVER). Both queued eyes-on sweeps Playwright-blocked → took the highest-leverage EXECUTABLE review:
  getInsurance/buildInsuranceDetails (analytics/repository.ts), which had ZERO test coverage AND carries the
  open #14 question. Read against source: cost-shape handling CORRECT (bug #8 effectiveMonthlyPremium — both
  explicit monthlyCost and amortized totalCost paths non-zero), latest-term-by-endDate + inactive-policy
  exclusion correct. CONFIRMED #14: the latest term is picked by endDate descending with NO endDate >= now
  check, so an active policy whose latest term LAPSED still adds its stale premium — a SEMANTICS call (pending
  Angelo), NOT a unilateral fix (rule 7). Increment = pin the CURRENT behavior with insurance-details.test.ts
  (6 cases through public getInsurance over a real in-memory DB: monthly + amortized cost shapes, latest-term
  wins, inactive excluded, the #14 expired-term-counted case flagged as the one to flip, empty-state) — so a
  future #14 decision is a safe change against a net. Also SPOTTED (noted, not fixed): coveredVehicleIds spans
  ALL terms' junctions, not just the latest term's. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1044 pass/0 fail, +6 · build bundled). Next (74): recompute — `guard` most-starved (cyc
  68, starved-for 6 = budget 6, AT) likely; arch (cyc 69, 5=5 AT) close. Recompute all 6 live.
- **C74 (guard — lock the /analytics/insurance response contract)** — BALANCE: four categories AT budget
  (guard 6=6, arch 5=5, feature 4=4, bug 3=3), none strictly over; `guard` most-starved (breaches first) AND
  fully actionable (vs bug, still blocked). Continued loop-improvement #2, riding C73's fresh knowledge of
  getInsurance: GET /analytics/insurance hand-assembles a nested `summary` + 3 derived arrays
  (vehicleDetails/monthlyPremiumTrend/costByCarrier) with NO type binding to the frontend `InsuranceResponse`
  (types/analytics.ts:180) — a dropped/renamed key silently breaks the analytics insurance tab. Extended C73's
  insurance-details.test.ts with a drift-guard describe (+2 cases): exact top-level + nested summary keys vs
  the frontend contract (empty AND populated), plus the vehicleDetails (7-key) / costByCarrier (3-key) /
  monthlyPremiumTrend (2-key) array-item shapes. Verified the vehicleDetails keys against
  buildInsuranceVehicleEntries source before asserting (matched exactly). Verified: backend validate:local
  EXIT 0 (tsc 0 · musl-biome clean · 1046 pass/0 fail, +2 · build bundled). Next (75): recompute — `arch`
  most-starved (cyc 69, starved-for 6 > 5, OVER) → wins; arch #2 step 2 (page migration onto createLoadState,
  UI-eyes-on) OR a rule-7 fan-out for a non-UI backend dedup/dead-code target (the C69 pattern).
- **C75 (arch — dedup the query-if-nonempty guard in google-sheets-service)** — `arch` most-starved (cyc 69,
  6 > 5, OVER). arch #2 step 2 is UI-eyes-on-blocked, so per rule 7 fanned out 2 Explore agents (layering +
  complexity — DIFFERENT angles than C69's dup+dead-code, to avoid re-surfacing). Picked the COMPLEXITY find:
  `updateSpreadsheetWithUserData` repeated `ids.length > 0 ? await db.select()…where(inArray(col,ids)) : []`
  4× (insurance terms/term-vehicles/claims/reminder-vehicles). Extracted a typed `queryIfNonEmpty<T>(ids,
  () => query)` private helper (closure form — simpler than the agent's db-passing signature). VERIFIED the
  pattern uniformity against source first (grep'd all `length > 0` — confirmed the financing/odometer
  innerJoins are a different shape, correctly left alone; the only non-inArray hits are unrelated). Behavior-
  identical (skips the pointless `inArray(col, [])` round-trip exactly as before). REJECTED the layering find
  (extract ONE raw db.delete from providers/routes.ts) — the agent itself noted 5 OTHER raw queries stay
  inline there, so extracting one makes the file MORE inconsistent (arch rule 5: no churn-for-churn). PROOF:
  green→green — the google-sheets-service round-trip test passed before+after (in the FULL suite; the
  single-suite run hit the known C38 cross-suite migration flake, NOT my change — canonical gate is full
  validate:local). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1046 pass/0 fail,
  unchanged count · build bundled). Next (76): recompute — `feature` (cyc 70, starved-for 6 > 4, OVER) +
  `bug` (cyc 71, 5 > 3, OVER) both over; feature's T4 is frontend-eyes-on, bug is Angelo-blocked — so likely
  fall back to the most-starved ACTIONABLE (infra cyc 72 / deep-review cyc 73). Recompute all 6 live.
- **C76 (infra — #5 branch-hygiene sweep, BRANCH_REVIEW.md refresh)** — BALANCE: `feature` (cyc 70, 6 > 4)
  + `bug` (cyc 71, 5 > 3) both OVER, but BOTH BLOCKED: re-checked the feature queue against source —
  maintenance T9 (eyes-on) + import-trackers T4 (frontend eyes-on) both Playwright-blocked, recurring-expenses
  (#3) has no spec (drafting one is a flag-Angelo action, and 2 specs are already mid-flight blocked, so a 3rd
  adds queue depth w/o throughput); bug queue Angelo-blocked. So fell back to the most-starved ACTIONABLE:
  `infra` — and the #5 branch-hygiene sweep was explicitly due ("Next sweep due ~C76" per the BACKLOG note,
  last C66, branch now 26 commits). Sweep: (1) stray untracked unit tests outside *.meshclaw.e2e.ts — ZERO;
  (2) green baseline — full validate:local (1046 BE + 367 FE, green; regress.sh Playwright-blocked); (3)
  BRANCH_REVIEW.md (gitignored) refresh — header 16→26 commits / +3589/−287, appended §16 covering C66–C75
  (import-trackers T2/T3, the 2 contract guards, 2 arch dedups, 2 characterization deep-reviews, 2 doc
  refreshes), and corrected the stale "T1+T2 inert until T3" merge note to "backend T1–T3 complete, inert
  until a client sends a mapping". Doc-only (BRANCH_REVIEW gitignored → commit carries only loop docs). NOTE:
  feature + bug remain blocked — the loop has run on guard/deep-review/arch/infra for ~10 cycles; the
  lease/loan unblock (flagged C71, no reply) is still the highest-leverage rebalance. Next (77): recompute —
  `feature` (cyc 70, starved-for 7 > 4) + `bug` (cyc 71, 6 > 3) deepening; if still blocked, deep-review
  (cyc 73, 4 < 5 under... ) / guard / arch are the actionable picks. Recompute all 6 live.
- **C77 (deep-review — trace the unpinned financing-analytics path; file the unblock)** — BALANCE: feature
  (7) + bug (6) deeply OVER but BOTH still blocked (re-verified: a feature-side T6 "extend date guard to
  import-mapping" slice turned out REDUNDANT — C58+C60 already pin normalizeForeignDate, and on this UTC CI
  host any added local-time value-assertion is VACUOUS since UTC-midnight == local-midnight; I WROTE then
  REVERTED that test rather than commit churn). Fell back to the most-starved ACTIONABLE, deep-review.
  TRACED the financing-analytics path: getFinancing → buildFinancingDetails → buildSingleFinancingDetail is
  effectively UNPINNED — its only test (cross-vehicle Property 23) is `test.skip`'d because getFinancing
  dynamically imports the financingRepository SINGLETON whose computeBalance binds to getDb() (real conn),
  not the in-memory test drizzle, so the C73 insurance harness can't reach it; and summary-route.test.ts
  MOCKS getSummary (doesn't exercise real compute). The math has bug surface (monthlyInterestEstimate, the
  C44 field; monthsRemaining clamp; unfinanced→own). Unblocking needs an ARCH DI (inject the repo / optional-
  db param) — bigger than one safe cycle + sign-off — so I FILED it as a traced, ranked deep-review backlog
  item (the C54 pattern) rather than force an awkward singleton-bound test or churn. Doc-only (BACKLOG + loop
  docs; the reverted test left the tree clean). NOTE: 3rd consecutive cycle where feature+bug are blocked and
  the loop runs on the backend-verifiable categories — the lease/loan unblock + an eyes-on/Playwright unblock
  + a branch review (26 green commits) are now the highest-leverage moves, all Angelo's. Next (78): recompute
  — `guard` (cyc 74, starved-for 4) / `arch` (cyc 75, 3) the likely actionable picks; feature/bug still gated.
- **C78 (guard — lock the /analytics/year-end response contract)** — BALANCE: bug (7) + feature (8) deeply
  OVER but still blocked (re-checked: reminders list is a CLEAN repo pass-through, not a drift surface; no
  new executable feature/bug). Took the most-starved ACTIONABLE, `guard`. Continued loop-improvement #2:
  getYearEnd hand-assembles an 11-field object literal (repository.ts:1889) with NO type binding to the
  frontend YearEndResponse (types/analytics.ts:237); the existing Property-24/25 tests pin the MATH but NOT
  the key shape. Added a drift-guard describe to year-end.property.test.ts (+2): exact top-level key set vs
  the frontend contract + the null-not-absent invariant for biggestExpense/previousYearComparison (the FE
  reads them unconditionally). Verified the key set against the YearEndResponse interface before asserting.
  WHILE HERE confirmed + documented that /reminders + /expenses-page are CLEAN repository pass-throughs (no
  route-injected fields → not drift surfaces), narrowing the guard queue to just /analytics per-vehicle.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1048 pass/0 fail, +2 · build bundled).
  Next (79): recompute — `arch` (cyc 75, starved-for 4) likely most-starved actionable; feature (cyc 70, 9) +
  bug (cyc 71, 8) still gated on Angelo. The contract-drift queue is nearly exhausted (1 surface left).
- **C79 (arch — scope arch #2 step 2; record the createLoadState misfit; ESCALATE)** — BALANCE: feature (9)
  + bug (8) extreme-OVER but blocked (5th cycle); most-starved ACTIONABLE = arch (cyc 75, 4). Rather than
  manufacture a 5th marginal guard/dedup (churn — the contract-drift vein is down to 1 surface, the C69/C75
  audit finds are spent, guard was just touched C78), I scoped arch #2 step 2 (the page migration onto the
  C63 createLoadState scaffold) PROPERLY for the first time and found WHY no page has migrated: the scaffold
  wraps ONE `data: T`, but real pages don't fit — vehicle-detail has 2 load pairs entangled with pagination
  + a shared isLoadingStats; dashboard sets ~6 separate $state vars from one fetch. A faithful migration
  would reshape working code for marginal dedup (churn, arch rule 5). RECORDED this as a step-2-blocking
  finding in BACKLOG with two direction-call paths (reshape createLoadState to a data-less {isLoading,error,
  run} pair, or don't retrofit) — a genuine behavior-preserving STRUCTURAL finding that stops a future cycle
  blindly attempting the misfit migration. Doc-only. ESCALATED to Angelo: 5 straight cycles with feature+bug
  blocked, guard/arch veins thinning — the loop has hit honest diminishing returns and the high-leverage
  moves (lease/loan approval, eyes-on/Playwright unblock, branch review, the arch-DI + scaffold-reshape
  direction calls) are all Angelo's. Next (80): if still no input, infra (cyc 76, 4) / deep-review (cyc 77,
  3) are the actionable picks — but flagging that further cycles are low-yield until something unblocks.
- **C80 (guard — lock the LAST contract-drift surface; CLOSE loop-improvement #2)** — feature (10) + bug (9)
  extreme-OVER but blocked (6th cycle). Per the C79 commitment (take a cycle only for a genuinely-clean,
  non-churn increment), found ONE: the final hand-assembled response, getVehicleHealth — a COMPLETING
  increment, not a marginal add. It hand-assembles a 6-field literal (repository.ts:1713) with no type
  binding to the frontend VehicleHealthResponse (types/analytics.ts:199); per-vehicle.property.test.ts pins
  the SCORE MATH (the 0.4/0.35/0.25 weighted formula) but NOT the key shape (the C78 year-end situation).
  Added a drift-guard describe (+2): exact top-level keys vs the frontend contract + a no-data finite-number
  invariant (no NaN escape). Verified vs the VehicleHealthResponse interface + confirmed getVehicleHealth
  queries via this.db (no financing-singleton trap, unlike C77). This CLOSES loop-improvement #2: every
  hand-assembled surface (/stats, /vehicles list, single-financing, /analytics/insurance, year-end,
  vehicle-health) is now key-shape locked; the non-targets (/reminders, /expenses page) verified as clean
  repo pass-throughs. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1050 pass/0 fail,
  +2 · build bundled). Next (81): with #2 closed AND feature/bug/arch-#2 all blocked, the only actionable
  categories are infra (cyc 76, 5) / deep-review (cyc 77, 4) — and both are thin (sweep done C76, financing
  deep-review arch-DI-blocked). Genuinely at diminishing returns; will hold for a clean increment or re-flag.
- **C81 (infra — measure the real coverage baseline; revive lapsed loop-improvement #4)** — feature (11) +
  bug (10) blocked (7th cycle); most-starved ACTIONABLE = infra. Instead of asserting "infra is thin," I
  VERIFIED a real gap against source: loop-improvement #4 ("end every cycle-log entry with a cov: tag,
  re-measure on guard/arch/bug cycles") had SILENTLY LAPSED — NO entry C52–C80 carried a cov: tag, so the
  "90% ratchet" was tracking nothing and the cited ~74%/~59% baseline was long stale. Ran a real pass both
  sides: backend `bun test --coverage` = 77.8% line / 76.9% func; frontend `vitest --coverage` = 63.7% line
  / 60.6% func / 56% branch — BOTH up from the stale estimates (the test-adding cycles DID move the needle,
  just unmeasured). Recorded the measured baseline in the coverage-trend note + named concrete low spots to
  steer future guard/arch picks (frontend overall; backend timeout.ts 0%, pending-credentials.ts 76%), and
  re-anchored the rule with this entry's cov: tag. Doc-only (the measurement IS the work; suites unchanged at
  1050 BE / 367 FE, all green). HONEST NOTE: this is a real infra fix (a lapsed loop mechanism revived), but
  it doesn't change the broader picture — feature/bug remain Angelo-gated; the high-leverage moves are still
  the lease/loan approval + eyes-on/Playwright unblock + branch review. Next (82): deep-review (cyc 77, 5 =
  budget, most-starved actionable) — but if no clean target, will HOLD rather than churn. cov: be 77.8% / fe 63.7%
- **C82 (deep-review — characterize `withTimeout`, the 0%-coverage timeout utility)** — feature (12) + bug
  (11) blocked (8th cycle); most-starved ACTIONABLE = deep-review (cyc 77, AT budget). The C81 coverage
  baseline turned "deep-review is thin" into a GROUNDED pick: `utils/timeout.ts` was at 0% yet is LIVE in the
  sync backup path (backup-orchestrator, sync/routes) — a hung Drive/Sheets call must fail as a typed
  SyncError, not hang forever. Read it + pinned the 3 race outcomes via timeout.test.ts (+5): the promise
  value wins when it resolves first; a timeout throws SyncError(NETWORK_ERROR) with the "<op> timed out after
  <ms>ms" message; the promise's OWN rejection wins when it rejects first (a real upstream error is NOT
  masked as a timeout) + the 5 OPERATION_TIMEOUTS budgets. Small real timeouts (10ms vs 200ms), no
  fake-timer dep, deterministic. Caught + fixed my own import-path bug pre-gate (../errors → ../../errors
  from the deeper __tests__ dir). timeout.ts 0%→covered — the first concrete ratchet-move on a C81 low spot.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1055 pass/0 fail, +5 · build bundled).
  NOTE: this is real (a live-but-untested utility now pinned), and the C81 baseline gives genuine runway on
  the named low spots (frontend modules, pending-credentials.ts) — so the loop has non-churn coverage work
  for a few cycles. But feature/bug stay Angelo-gated; the high-leverage moves remain the lease/loan approval
  + eyes-on unblock + branch review. Next (83): recompute — arch (cyc 79, starved-for 4) likely; or a guard
  steered to a frontend low-cov module. cov: be ~78% / fe 63.7%
- **C83 (guard — coverage-ratchet the pending-credentials OAuth store, a C81 low spot)** — feature (13) +
  bug (12) blocked (9th cycle); nothing actionable strictly OVER, so highest-LEVERAGE: continued the C82
  coverage-ratchet on a C81-named low spot — `utils/pending-credentials.ts` (76%), the in-memory OAuth
  refresh-token staging store. SECURITY-relevant: a credential must not outlive its 10-min TTL, must consume
  exactly once, and the store mustn't grow unbounded. The existing auth property test covers only the happy
  store→consume→consume-again-null path; I pinned the UNCOVERED branches via pending-credentials.test.ts (+7):
  TTL expiry (getPendingEmail fresh→email / expired→null; consumePending expired→null AND purges),
  cleanupExpired-on-store, and (userId,nonce) consume scoping. Made expiry DETERMINISTIC by back-dating an
  entry's createdAt via the test-only exposed Map (no timers, no Date mock — there's no setSystemTime idiom
  in the repo). RATCHET MOVED: 76%→100% func / 92% line (only the 1000-entry max-size eviction L53-56 left,
  not worth the seed cost — documented). Filed a NEW STANDING GUARD ANGLE in BACKLOG (coverage-ratchet the
  named low spots: logger.ts 75% next, then frontend) so the loop has grounded non-churn guard work. Verified:
  backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1062 pass/0 fail, +7 · build bundled). Next (84):
  arch (cyc 79, starved-for 5 = budget, most-starved actionable) — arch #2 scaffold-misfit-blocked, so likely
  another coverage-ratchet guard (logger.ts) or a fresh audit fan-out. feature/bug still gated. cov: be ~79% / fe 63.7%
- **C84 (guard — coverage-ratchet expenses/validation.ts, the split money-math refinements)** — feature (14)
  + bug (13) blocked (10th cycle). Most-starved ACTIONABLE was arch (cyc 79, AT budget) — but I did NOT force
  it: arch #2 (page migration) is scaffold-misfit-blocked, and the createLoadState RESHAPE is a DIRECTION
  CALL I already flagged (C79) + escalated — acting on it unilaterally would violate arch rule 6 + my own
  recorded decision. So took the next actionable, guard, via the C83 standing angle. REJECTED the named-next
  `logger.ts` (its only gaps are emoji-prefix wrappers + a level-gated singleton fixed at import — coverage
  theater + awkward) in favor of a HIGHER-VALUE low spot from the C81 list: `expenses/validation.ts` at 50%
  func — the split-expense Zod refinements, which guard real money-math. Pinned the uncovered branches via
  split-validation-schema.test.ts (+10): percentage-sum-must-be-100, absolute-allocations-must-sum-to-total,
  source-fields-both-or-neither, + the update-path skips the absolute check when totalAmount is omitted. Pure
  schema (safeParse), no harness. RATCHET MOVED: 50%/73% → 100%/100%. Updated the standing angle to prioritize
  high-risk pure logic over passthroughs + named the next real targets (reminders/validation 64%, sql-helpers
  33%, idempotency 43%). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1072 pass/0 fail,
  +10 · build bundled). Next (85): recompute — arch (cyc 79, starved-for 6 > 5, now OVER) most-starved but
  still misfit/direction-blocked; deep-review (cyc 82, 3) or another high-value coverage guard the actionable
  fallback. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C85 (guard — coverage-ratchet financing/hooks.ts, the deactivation data-integrity hook)** — feature (15)
  + bug (14) blocked (11th cycle). arch most-starved + now OVER (cyc 79, 6 > 5) — but VERIFIED again it has no
  self-authorizable increment: page-migration misfit-blocked, reshape is the pending C79 direction call, AND I
  checked whether the 0%-coverage files were DEAD code (a legit arch removal) — they're all LIVE
  (financing/hooks ← routes.ts, auth/providers/* ← auth routes + a registry test), just harness-hard, so no
  dead-code win. Took the next actionable (guard) via the C83 angle. Picked `financing/hooks.ts` (0% func) —
  the onFinancingDeactivated DATA-INTEGRITY hook: on payoff (PUT /:id/payoff) or delete, it must SEVER the
  source link (clear sourceType/sourceId) on the financing's auto-generated expenses while KEEPING the rows.
  Pinned end-to-end through both real routes via financing-deactivate-hook.test.ts (+4): payoff severs +
  row survives; delete severs; no-linked-expenses payoff is a clean no-op (200); an unrelated expense is
  untouched. Used the C68 HTTP-harness pattern so the singleton-bound clearSource hits the test DB. RATCHET:
  0%→100% func / 69% line (the remaining gap is the best-effort catch block — not cleanly inducible via HTTP,
  and the never-throws contract is implicitly proven by the green happy/no-op paths; documented). Verified:
  backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1076 pass/0 fail, +4 · build bundled). Next (86):
  the #5 branch-hygiene sweep is due (~C86, last C76, branch now 34 commits) — a clean infra pick; else the
  next coverage target (reminders/validation 64%). arch stays direction-blocked; feature/bug gated. cov: be ~80% / fe 63.7%
- **C86 (infra — #5 branch-hygiene sweep, BRANCH_REVIEW.md refresh)** — feature (16) + bug (15) blocked (12th
  cycle); arch most-starved + OVER (cyc 79, 7 > 5) but still direction-blocked (page-migration misfit, reshape
  pending C79). The #5 sweep was due (~C86, last C76) and is a clean actionable infra pick. Sweep: (1) stray
  untracked unit tests outside *.meshclaw.e2e.ts — ZERO; (2) green baseline — 1076 BE + 367 FE (regress.sh
  Playwright-blocked); (3) BRANCH_REVIEW.md (gitignored) refresh — header 26→36 commits / +4355/−287, appended
  §17 (C76–C85: the contract-drift CLOSURE [year-end C78 + getVehicleHealth C80 → loop-improvement #2 done],
  the C81 coverage-baseline revival, the C82–C85 coverage-ratchet arc [timeout/pending-creds/split-validation/
  financing-hook], + the C77/C79 direction-call findings), and noted the C76–C85 arc is overwhelmingly
  test/guard hardening with ZERO product-behavior change → near-zero merge risk. Doc-only (BRANCH_REVIEW
  gitignored → commit carries only loop docs). Next sweep ~C96. Next (87): recompute — arch (cyc 79, starved-
  for 8) most-starved but direction-blocked; deep-review (cyc 82, 5 = budget) or another high-value coverage
  guard (reminders/validation 64%) the actionable pick. feature/bug Angelo-gated (12 cycles). cov: be ~80% / fe 63.7%
- **C87 (deep-review — pin the reminders/validation cross-field refinements)** — feature (17) + bug (16)
  blocked (13th cycle); arch most-starved + OVER (cyc 79, 8 > 5) but direction-blocked. Took the next
  actionable, deep-review (cyc 82, AT budget), via the C81-grounded coverage angle: `reminders/validation.ts`
  at 64% func — its uncovered branches are the 6 cross-field REFINEMENT failure paths (the correctness guards
  that reject a malformed reminder), the C29/C31 defect class. The existing update-validation test covers only
  the isActive toggle, so zero overlap. Pinned each refinement's accept+reject + exact message via
  reminder-refinements.test.ts (+11): custom-frequency (intervalValue/Unit required), expense-type
  (category/amount required), mileage-trigger D4 (intervalMileage required + exactly-one-vehicle; 'time'
  unconstrained), date-range (endDate>startDate), split-config (vehicleId-match + %-sum=100 + absolute-sum=
  expenseAmount). Pure Zod safeParse, no harness. RATCHET: 64% → 100%/100%. Verified: backend validate:local
  EXIT 0 (tsc 0 · musl-biome clean · 1087 pass/0 fail, +11 · build bundled). NEXT coverage low spots:
  sql-helpers (33%), idempotency (43%), rate-limit (75%/60%), then frontend. Next (88): recompute — guard
  (cyc 85, 3) / arch (still blocked) / another coverage guard. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C88 (feature → spec — recurring-expenses, drafted + flagged)** — BALANCE: three categories over budget at
  cyc 88 — feature (cyc 70, starved-for 18 >> 4), bug (cyc 71, 17 >> 3), arch (cyc 79, 9 > 5); MOST starved =
  `feature` (18) → it wins (this is also the 14th cycle feature/bug have been Angelo-gated, and the
  coverage-ratchet escape hatch is no longer balance-legal — guard/deep-review are both UNDER budget now). Both
  feature BUILDS are eyes-on/Playwright-blocked (maintenance T9, import-trackers T4–T6), so the actionable
  feature increment is the C4/C9 spec-draft move on a NORTH_STAR horizon item: backlog feature #3,
  **recurring expenses**. KEY OUTCOME — the C21/C28/C35 verify-before-acting lesson paid off hard: fanned out
  2 Explore agents and they CONFLICTED on the crux (does the reminder engine already auto-create expenses?).
  Rather than trust either, I READ trigger-service.ts directly — and it OVERTURNED my own stale mental model:
  `processReminder:407` branches on `type==='expense'` → `processExpensePeriod:176` → `createExpenseFromReminder
  :108`, which INSERTS real expense rows (single :125-143 or multi-vehicle split via expenseSplitService
  :148-163) stamped sourceType:'reminder', on the reminder's frequency, in the same txn that advances
  nextDueDate. **The recurring-expense engine ALREADY EXISTS.** So Agent B's "new recurring_expenses table +
  scheduler" would REINVENT it (NORTH_STAR #4 violation) — rejected. A 3rd focused agent + a source grep
  confirmed the THREE real, verified gaps: (1) materialization is manual-button-ONLY (reminders/+page.svelte
  :97-114, no cron/on-open) → a self-host PWA silently under-counts TCO if the user forgets to click; (2)
  ReminderForm omits expenseSplitConfig (:52-53) → no multi-vehicle recurring cost; (3) no traceability from an
  auto-created expense back to its source. Also grounded the R4 cascade on real primitives: expenses/repository
  has deleteBySource (:483) + clearSource (:530), and sourceType:'reminder' is a live create-route enum
  (routes.ts:80) — clearSource is the keep-history verb. Drafted `.kiro/specs/recurring-expenses/`
  {requirements,design,tasks}.md: extend the existing engine (NOT a new table/scheduler), 4 decisions (D1
  materialization cadence without a cron / D2 keep-past-history on delete / D3 reuse the split widget / D4 v1
  order), recommended option each, T0 blocks build. CRUCIALLY the spec's T1–T3 are backend/non-eyes-on
  (traceability response + contract guard, split characterization, cascade-safe delete) — so this feature is
  one the loop can ADVANCE while Playwright is blocked, directly addressing why feature starved (both in-flight
  features are stuck at eyes-on tails). Flagged Angelo via send_message (now THREE specs in flight:
  maintenance T9-only, import-trackers T4–T6, recurring-expenses D1–D4). Verify (spec-only, the C4/C9 pattern):
  D1–D4 referenced consistently across all 3 files, R1–R7↔T0–T8 mapped, every file:line grounding verified
  against source I read this cycle. No build (no code). Next (89): bug is now most-starved over budget (cyc 71,
  starved-for 18 >> 3) but its top items are ALL Angelo-gated (lease/loan $ change, #14 #16 semantics calls) —
  so the actionable pick is arch (cyc 79, 10, still direction-blocked → verify) or the next coverage guard
  (sql-helpers 33%). feature/bug remain gated. cov: be ~80% / fe 63.7%
- **C89 (bug — #4: ExpensesTable sort lacks a stable id tiebreaker)** — BALANCE: bug most-starved over budget
  (cyc 71, starved-for 18 >> 3); arch also over (cyc 79, 10 > 5) but still direction-blocked. APPLIED the
  verify-against-source discipline to my OWN backlog annotation ("bug queue all gated") rather than reflexively
  pivoting — and it was stale: most of the bug queue IS gated (lease/loan $ change, #14/#16 semantics calls,
  #2/#11 eyes-on), but #4 (combined-row re-sort lacks an id tiebreaker) is UNBLOCKED, pure-logic, unit-testable.
  Read ExpensesTable.svelte + confirmed: both sort sites (the flat sortedExpenses :194, and the combined
  tableRows re-sort :268) compared only by date/amount and returned 0 on a tie → equal-key rows fell back to
  JS engine ordering / the standalone-then-group array-build order (grouping itself reorders same-key rows vs.
  the server). The server orders by `dir(sortColumn), dir(id)` (expenses/repository.ts:287 — id tiebreak
  inherits the sort DIRECTION). FIX: extracted a pure `compareExpenseRows(a,b,by,dir)` + `SortableRow` to
  expense-helpers.ts that folds the id tiebreak into the raw comparison BEFORE the asc/desc flip (so a desc
  sort breaks ties id-desc, matching the server — a naive post-flip localeCompare would always break ascending
  and diverge). Wired both sites through it; group rows use their representative date/totalAmount + the first
  child's id as the stable key. MERGE-SURVIVING GUARD (NORTH_STAR #5): compare-expense-rows.test.ts (+8) pins
  primary sort, the load-bearing tiebreak DIRECTION (date/amount × asc/desc), and input-order-independence
  (two orderings of tied rows → same output = the exact #4 invariant). Verified: frontend validate:local EXIT 0
  (tsc 0 · build ✓ · 375 pass/0 fail, +8). CAVEAT (UI-touching, NORTH_STAR #3): the fix's correctness is sort
  DETERMINISM, which a screenshot fundamentally can't show (equal-key rows render identically; only their
  relative order stabilizes) — the unit test is the right + sufficient gate here, like the C39 non-visual layer.
  No backend touched. Next (90): bug freshly fed (89); arch still most-starved over budget (cyc 79, 11 > 5) but
  direction-blocked (page-migration misfit, reshape pending the C79 call) → verify then take the next coverage
  guard (sql-helpers 33% / idempotency 43%). feature/bug remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C90 (arch — dedup the `instanceof Error ? .message : fallback` idiom into extractErrorMessage)** — BALANCE:
  `arch` the only over-budget category (cyc 79, starved-for 11 > 5) → forced. KEY REFRAME: I'd been punting arch
  to coverage-guards citing "direction-blocked," but that block is SPECIFIC to arch #2 (the C79 createLoadState
  page-migration misfit — a real pending direction call). arch #1 CLOSED at C56, so per arch rule 7 the proper
  move is the AUDIT FAN-OUT to repopulate, not punt. Fanned out 2 Explore agents (backend dedup/layering +
  frontend pure-logic dedup). Backend surfaced a real 3× provider-response-formatter dup (providers/routes.ts
  :159/:309/:374) but it's UNTESTED → that's a 2-cycle safety-net-first play (C17/C24 pattern), filed not taken.
  Frontend surfaced the better one-cycle item: the `<err> instanceof Error ? <err>.message : <literal>` idiom
  hand-repeated across catch blocks. APPLIED the C21/C28/C35 verify-against-source rule and it MATTERED: the
  agent listed 5 sites, but error-handling.ts:106 is `fallbackMessage || (instanceof Error ? .message : '...')`
  — the fallback takes PRECEDENCE there (opposite ordering), so folding it in would INVERT semantics (arch
  rule 2 violation) → EXCLUDED it. Verified the other 4 read identically against source (load-state.svelte.ts
  :91, auth.svelte.ts :98 + :116, sync-manager.ts:224 — error-message-wins ordering). Extracted
  `extractErrorMessage(error, fallback)` to error-handling.ts (with a doc note on why handleApiError does NOT
  use it), routed all 4 through it. Anchored by extract-error-message.test.ts (+4): Error-message-wins, subclass
  unwrap, non-Error fallback (string/obj/undefined/null/number), and the load-bearing empty-Error-message
  returns '' (branch on TYPE not truthiness). Complete one-cycle behavior-preserving dedup — no dangling
  follow-up, no .svelte markup (pure .ts/.svelte.ts → no eyes-on needed). Verified: frontend validate:local
  EXIT 0 (tsc 0 · build ✓ · 379 pass/0 fail, +4). FILED for next arch: the provider-formatter dedup needs its
  HTTP characterization net first (providers routes are <50% covered — also a C81 low spot, so it double-counts
  as a coverage guard). Next (91): nothing over budget after this (guard cyc 85 starved-for 6 = budget at 91;
  deep-review cyc 87, 4). Highest-leverage = the providers-routes HTTP net (sets up the C91+ formatter dedup AND
  ratchets a named low spot), or another coverage guard (sql-helpers 33%). feature/bug remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C91 (guard — providers-routes HTTP characterization net, the safety-net half of the C90 dedup)** — BALANCE:
  nothing over budget; `guard` AT budget (cyc 85, starved-for 6 = budget, breaches at 92) and it's ALSO the
  highest-leverage pick — the C90-filed providers-routes net feeds guard one cycle early AND sets up next arch's
  formatter dedup AND ratchets a C81 low spot (providers routes 0% HTTP coverage). Triple-win. Wrote
  providers-routes-http.test.ts (+13) through the real stack via the createTestApp harness: pins the OBSERVABLE
  CONTRACT the upcoming dedup must preserve — the exact 8-key response shape of all 3 hand-assembled formatters
  (GET list / POST create / PUT update) + the load-bearing SECURITY invariant that `credentials` is never
  echoed back — plus auth (401 anon), ownership (404 another-user, no existence leak), domain-guard (400 auth),
  zValidator (400 bad type), and DELETE 204+disappears. REAL DEBUGGING (not papered over): first run 8-failed —
  root-caused to CONFIG being a process-cached env SNAPSHOT built at the first config import, so a `fake`-provider
  create (gated on CONFIG.allowFakeStorageProvider) 400s in the full 148-file suite no matter when my file sets
  ALLOW_FAKE_STORAGE (an earlier file already froze it false). FIX: create an `s3` provider instead — the POST
  handler treats any non-google-drive type identically (encrypt→insert, no network; registry instantiation only
  on /:id/test, not called here), and s3 needs NO env gate → the net is independent of cross-file import order
  (green in isolation AND in suite). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean [autofixed
  an import reflow] · 1100 pass/0 fail, +13 · build bundled). The C92 formatter extraction now lands green→green
  against this net. Next (92): nothing over budget (deep-review cyc 87 starved-for 5 = budget at 92; arch cyc 90,
  2). Highest-leverage = EXECUTE the formatter dedup (arch, now safe behind this net — extract formatProvider
  response, +the :583/:599 photoRef count helper + the :466 raw delete fold in naturally), OR the starved
  deep-review. feature/bug remain Angelo-gated. cov: be ~80% (providers routes now covered) / fe 63.7%
- **C92 (arch — EXECUTE the providers dedup, green→green behind the C91 net)** — BALANCE: nothing over budget
  (four categories AT budget, breach at 93); highest-leverage = the deliberately-staged second half of the
  C91 setup (the C18/C36 net-then-refactor pattern). Two genuine "N copies → one helper" dedups in
  providers/routes.ts: (1) the 8-field provider response object hand-assembled IDENTICALLY at 3 sites
  (GET list, POST create, PUT update) → extracted `formatProviderResponse(row: UserProvider)` (credentials
  deliberately omitted — the security invariant the C91 net pins); (2) the synced-vs-failed photoRef count
  queries in /sync-status, byte-identical except the status filter → `countPhotoRefsByStatus(db, id, status,
  entityTypes)`. ~50 lines of dup → 2 named helpers. SCOPE CALL (C75 reasoning): did NOT extract the lone raw
  `db.delete(userProviders)` :466 into a repo — the WHOLE file uses raw db.* inline (no providersRepository
  exists), so extracting one op makes the file MORE inconsistent (arch rule 5 churn); the formatter+count are
  the coherent in-file set. tsc CAUGHT a real type bug (the gate earning its keep): `photoRefs.status` is a
  literal union `'active'|'pending'|'failed'`, so my first `status: string` param was too wide for eq() —
  tightened the signature to the union (the call sites pass narrowing literals). green→green PROOF: the C91
  net's 13 provider assertions (response key-shape, credentials-never-echoed, sync-status counts) stayed GREEN
  UNCHANGED through the refactor = behavior-preserving. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1100 pass/0 fail, unchanged · build bundled). Next (93): deep-review most-starved over
  budget (cyc 87, starved-for 6 > 5) → it wins. Eyes-on/backend audit of a shipped surface (fan out per rule 7,
  verify findings vs source); the C88 recurring-expenses spec premise or the C89/C90/C91 arc are fresh
  unreviewed. feature/bug remain Angelo-gated (the 3 specs + lease/loan). cov: be ~80% / fe 63.7%
- **C93 (infra — CLAUDE.md orientation refresh: correct 2 actively-misleading drifts)** — BALANCE: five
  categories AT-or-over budget; my C92 note guessed deep-review, but the TABLE ruled — `infra` had the highest
  raw starved-for (cyc 86, 7 > 6) so it WINS over deep-review (6) (the recurring "compute all six, don't trust
  last cycle's single-category forecast" lesson, again). Chose the orientation-refresh infra item over the #5
  sweep (not due till ~C96) on EVIDENCE of real drift, not speculation — read CLAUDE.md and found 2 claims that
  actively mislead a fresh agent (the C5/C47/C72 class): (1) the coverage line cited a stale "~74%/~59%, ~1038/
  ~367 tests" floor → corrected to the real C81 MEASURED baseline (be 77.8% / fe 63.7% line) + noted
  loop-improvement #4's per-cycle cov: tag + ~1100/~379 suite size; (2) the "Open gaps" line claimed "full
  in-process backend HTTP harness needs a DB-injection refactor (the new Database(...) singleton binds at
  import)" — FLATLY WRONG now: C91 proved createTestApp() exists + works (1100 tests run through it, the
  providers net added last cycle). Rewrote it to DOCUMENT the harness (createTestApp/ctx.authed, real Lucia
  session, the CONFIG-snapshot import-order caveat from C91) and NARROW the real remaining DI gap to the
  specific one — analytics computeBalance binds the real-DB singleton (the C77 Property-23 skip). VERIFIED both
  new claims against source (read http-client.ts in full C91; cross-checked the computeBalance gap against
  BACKLOG deep-review #3 — consistent). Left the maintenance/import-trackers status lines unchanged (accurate
  since the C72 refresh). Docs-only; no code, no build gate (the C5/C12/C47/C53/C72 pattern). Next (94):
  deep-review most-starved over budget (cyc 87, starved-for 7 > 5) → it wins (deferred from C93 by the infra
  breach). Fan out per rule 7, verify vs source; the C88–C92 arc is fresh-unreviewed. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C94 (deep-review — certify the reminder→expense time-axis materialization engine; + record Angelo's D1–D4 sign-off)** —
  BALANCE: deep-review most-starved over budget (cyc 87, starved-for 7 > 5) → forced (deferred from C93 by the infra breach).
  Verification-only (no product code, like C21/C28/C35; findings → the bug/decision queues). Audited the reminder→expense
  AUTO-MATERIALIZATION path the C88 recurring-expenses spec depends on (`createExpenseFromReminder`/`processExpensePeriod`/the
  catch-up loop) — the TIME axis (split allocation, catch-up idempotency, endDate boundary) had never had a dedicated
  adversarial read (the mileage axis got C28/C35). Fanned out 2 Explore agents; VERIFIED every finding vs source (C21/C28/C35).
  • Agent A: AUDIT-CLEAN — CAS/dedup idempotency (no double-materialize on re-trigger), catch-up cap, per-vehicle split shares
    sum to the total ONCE (each sibling stores its own share — the C21 finding re-confirmed), endDate boundary, and
    `sourceType:'reminder'` stamping all CORRECT + well-grounded. The engine the just-approved spec EXTENDS is certified.
  • Agent B raised 2 "BUG"s + 1 "miscategorization" — verified each against source:
    – Issue #1/#5 (the two CONTRADICTED each other — a tell): `buildTCOMonthlyTrend` (analytics-charts.ts:953-961) is a
      4-bucket chart (financing/insurance/fuel/maintenance, NO "other"), so a `category='financial'` expense is omitted from
      THIS trend chart. NOT a bug + NOT reminder-specific: the financing/insurance branches require
      `sourceType==='financing'/'insurance_term'`, so a MANUALLY-entered financial expense (sourceType null) is omitted
      identically, and fuel/maintenance reminder-expenses DO show. NOT lost from TCO totals (`categorizeTCOExpenses` routes it
      to otherCosts). Filed as a #14-class NEEDS-DECISION item (chart scope), not fixed unilaterally.
    – Issue #2 (fuel fillup-count inflation): `currentYearFillups = fuelRows.length` counts split fuel SIBLING rows as N
      fillups, not 1. VERIFIED REAL + REACHABLE — `createSplitExpenseSchema` has `category: z.string().min(1)` (NO fuel
      restriction, confirmed this cycle), so a fuel expense IS splittable across vehicles. But NARROW/LOW-SEV: only the
      CROSS-FLEET fuel view (`queryFuelExpenses` with no vehicleId) over-counts; the per-vehicle path (`getFuelStats(…,
      vehicleId)`) sees 1 sibling = 1 (correct); and only COUNT-derived metrics (fillup count → $/fillup, gal/fillup
      averages) skew — the gallon/cost SUMS are right (shares sum correctly). Requires a user to split ONE fillup across
      cars (semantically unusual). Filed as a real low-sev bug (#18; fix: count distinct parent expense ids, not rows).
  Net: engine CERTIFIED clean where it matters, 1 low-sev bug filed (#18), 1 needs-decision filed (#19) — Agent A's verdict
  de-risks the just-approved spec. ALSO THIS CYCLE: Angelo SIGNED OFF recurring-expenses **D1–D4** (all recommended options) →
  flipped requirements.md to APPROVED + ticked tasks.md T0; T1–T3 are backend/non-eyes-on so the feature is finally
  ADVANCEABLE (the unlock that ends the long feature/bug Angelo-gate on this spec). No code; spec + loop docs only, no build
  gate (the C21/C28/C35 + C4/C9 pattern). Next (95): `feature` most-starved over budget (cyc 88, starved-for 7 > 4) → it wins
  AND for the first time has an UNBLOCKED backend task — recurring-expenses **T1** (surface sourceType/sourceId on the expense
  read path + the FE↔BE contract-drift guard + a reminder-materialized `sourceType` test). `bug` (cyc 89, 6 > 3) is
  next-most-starved (the new #18 is a queued candidate). cov: be ~80% / fe 63.7%
- **C96 (feature — recurring-expenses T1: lock the expense-source traceability contract on the READ path)** —
  BALANCE: `feature` most-starved over budget (cyc 88, starved-for 8 > 4) → forced; and for the first time the build is
  ACTIONABLE (T0 signed off C94). Grounded T1 first (the C56 "verify the premise before building" discipline — read-only,
  no commit): the C88 spec assumed T1 needs to "surface sourceType/sourceId if missing on the read path." VERIFIED against
  source it's a NO-OP — already surfaced: (a) all expense reads (`findByIdAndUserId`/`findPaginated`/`findAll`) use bare
  `.select()` → every column incl. sourceType/sourceId; (b) `buildPaginatedResponse(data,…)` passes rows through VERBATIM (no
  mapper/strip); (c) the frontend `Expense` type already declares `sourceType?`/`sourceId?` (expense.ts:57-58). AND a
  contract-drift guard is NOT warranted (C80 lesson — GET /expenses is a CONFIRMED clean repository pass-through, not a
  hand-assembled response; the guard pattern only applies to route-injected fields). So T1 reduced to ONE genuine, distinct
  deliverable: `trigger-expense.test.ts` already pins source_type at the DB-ROW level (reads straight off sqlite, line 65) —
  but that stays green even if a future response-mapper STRIPPED the field, silently breaking the T6 "Recurring" badge + T3
  cascade UI that key off the RESPONSE. Wrote `expense-source-traceability.test.ts` (+3) pinning the OBSERVABLE API contract
  (the C91-class positive-surfacing test): GET /expenses list echoes sourceType='reminder'/sourceId for a reminder-
  materialized expense; GET /:id echoes the source link; a manual expense reports null (value reflects reality, not a
  hardcoded literal). Mirrors the proven trigger-expense harness (createTestApp → real route→trigger→insert→GET-serialize→
  sqlite). THE GATE EARNED ITS KEEP TWICE: first run the manual-expense create 400'd (I used the response field `amount`;
  the create API wants `expenseAmount`), then 400'd again ("fuel expenses require fuel amount + mileage" — a category
  cross-field rule) → switched to `category:'misc'` (a plain manual expense, no fuel refinement). Verified: backend
  validate:local EXIT 0 — 1103 pass / 0 fail (+3) · build bundled. T1 DONE; T2 (split-materialization characterization) +
  T3 (cascade-safe delete via clearSource) are the next backend, both non-eyes-on. NOTE: the C94 + C96 commits are PENDING —
  git-commit was declined across C94/C95/C96 (3 cycles, 2 command forms), so the doc + spec + test edits are on-disk
  UNCOMMITTED on claude-loop-dev; flagged to Angelo. Next (97): `bug` most-starved over budget (cyc 89, starved-for 8 > 3)
  → its top UNBLOCKED item is the new #18 (cross-fleet fuel fillup count — pure-logic, count distinct parent ids), the
  lease/loan + #14/#16/#19 remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C97 (bug — #18: cross-fleet fuel fillup COUNT inflated by split fuel siblings)** — BALANCE: `bug` most-starved over
  budget (cyc 89, starved-for 8 > 3) → forced; #18 (filed C94) is its only UNBLOCKED item (lease/loan + #14/#16/#19 stay
  Angelo-gated). VERIFY-AGAINST-SOURCE refined the fix (C21/C28/C35, applied to my own C94 finding): read
  `ExpenseSplitService.createSiblings` (split-service.ts:92-108) — a split fuel sibling sets only `expenseAmount`; `volume`/
  `mileage`/`fuelType` are absent → SQL-default NULL. So C94's "sums are correct" CONFIRMED (null volume contributes 0 to
  `sumGallons` + distance skips null mileage) and the bug is PURELY the count. That also revealed the CLEANER fix than
  dedup-on-groupId (groupId isn't even SELECTed by queryFuelExpenses): a "fillup" is a fuel PURCHASE with a volume, so count
  only volume-bearing rows — the SAME `volume != null && > 0` predicate `fillupDetails.volumes` already uses. Fixed BOTH
  count paths for year-over-year consistency: (1) `buildFuelStatsFromData` — extracted `isFillup(r)` and applied it to
  currentYear/currentMonth/prevMonth fillup counts (repository.ts:~1238); (2) `queryFuelAggregates` (the prev-year count) —
  `COUNT(*)` → `COUNT(CASE WHEN volume > 0 THEN 1 END)` to match the in-memory predicate. The volume SUM kept explicit
  (unaffected — null contributes nothing). NARROW + behavior-preserving for non-split data: a real single-vehicle fillup
  always has a volume → still counts; per-vehicle path unchanged. MERGE-SURVIVING GUARD (NORTH_STAR #5): appended a
  deterministic regression to fuel-stats.property.test.ts (mirrors the cycle-211 distance fixture) — 2 real fillups + a
  fuel expense split across 2 cars (volume-null siblings) → cross-fleet `fillups.currentYear === 2` (pre-fix 4) +
  `volume.currentYear === 19` (sum unchanged, the "sums were always right" proof). Verified: backend validate:local EXIT 0
  — 1104 pass / 0 fail (+1) · build bundled. #18 CLOSED. NOTE: commits still PENDING (git-commit declined C94–C96, treated
  as a standing session block; flagged to Angelo via Slack this cycle) — C94/C96/C97 edits are on-disk UNCOMMITTED on
  claude-loop-dev. Next (98): nothing over budget (guard cyc 91 starved-for 6 = budget at 98; arch cyc 92, 6 > 5 → arch
  breaches) → `arch` most-starved (fan-out per rule 7), or continue feature recurring-expenses T2 (split-materialization
  characterization, backend/non-eyes-on). cov: be ~80% / fe 63.7%
- **C98 (guard — characterize sql-helpers.ts, the 33%-covered dialect SQL fragments)** — BALANCE: `guard` most-starved
  over budget (cyc 91, starved-for 7 > 6); my C97 note guessed arch but the TABLE ruled — guard (7) > arch (6) (the
  recurring "compute all six" lesson). Took the C83 coverage-ratchet standing angle's top named low spot:
  `db/sql-helpers.ts` (33% func) — 3 tiny dialect-aware date helpers (extractMonth/formatYearMonth/toDateTimeString) that
  are the ONLY SQLite-specific raw SQL in the codebase, NEVER directly tested (only incidentally via analytics queries),
  and whose doc comments record TWO real past bugs from one root cause: omitting `'unixepoch'` makes SQLite read the
  seconds-epoch column as a Julian day → garbage months (extractMonth) + collapsed GROUP BY buckets → blank charts + $0
  monthly average (formatYearMonth). Wrote `sql-helpers.test.ts` (+5) executing each fragment via a real Drizzle select
  over a seeded expense (the analytics createTestDb harness — full schema, seedExpense stores date as seconds): extractMonth
  March→3 + Jan/Dec boundaries; formatYearMonth →'2024-03' + the load-bearing distinct-months-stay-distinct (the exact
  monthly-trend regression); toDateTimeString →'2024-03-15 00:00:00'. Pins the `unixepoch` invariant merge-surviving (a
  regression dropping it changes these outputs). Pure characterization, no product code. THE GATE EARNED ITS KEEP: first
  run failed on musl-biome formatting only (import reorder + a chained select reflow) — ran check:musl:fix (the documented
  CLAUDE.md autofix path), re-ran green. Verified: backend validate:local EXIT 0 — 1109 pass / 0 fail (+5) · build bundled.
  sql-helpers.ts 33%→covered. Next (99): nothing over budget (arch cyc 92 starved-for 7 > 5 at 99 → arch breaches) →
  `arch` most-starved (fan-out per rule 7), OR continue feature recurring-expenses T2 (split-materialization characterization,
  backend/non-eyes-on, the highest-leverage feature-advancing pick). cov: be ~80% / fe 63.7%
- **C99 (arch — converge analytics routes on the shared `validateVehicleOwnership`)** — BALANCE: `arch` most-starved over
  budget (cyc 92, starved-for 7 > 5). arch #2 (createLoadState reshape) is direction-blocked pending the C79 call, so per
  arch RULE 7 ran the AUDIT FAN-OUT (2 Explore agents: backend dedup/layering + frontend pure-logic) to find a fresh
  actionable item — the C90 pattern. Backend surfaced the clear winner: the inline `const vehicle = await
  vehicleRepository.findByUserIdAndId(user.id, vehicleId); if (!vehicle) throw new NotFoundError('Vehicle')` pattern
  hand-repeated at 13 sites across 4 route files, while a shared exported `validateVehicleOwnership(vehicleId, userId)`
  (utils/validation.ts:83) ALREADY EXISTS + is used by odometer/insurance/photos. (Frontend candidate — MS_PER_DAY magic-
  number consolidation — REJECTED as churn-for-churn, arch rule 5: a readability nicety, no real payoff.) VERIFIED vs
  source (C21/C28/C90): the inline pattern is byte-identical to the helper (same findByUserIdAndId arg order, same
  NotFoundError('Vehicle')); routes discard the returned vehicle (they re-query via the repository), so dropping the local
  binding is behavior-identical. SCOPE CALL (arch rule 1 — one small reviewable commit, NOT sweeping; the C36/C50 one-file-
  per-cycle convergence pattern): scoped to `analytics/routes.ts` ONLY — the densest cluster (6 of the 13 sites, all
  test-covered); filed the other 3 files as the next arch increments. Converted all 6 (3 mandatory: vehicle-health/-tco/
  -expenses; 3 optional: fuel-stats/-advanced/-efficiency, keeping their `if (vehicleId)` guards), swapped imports
  (NotFoundError + vehicleRepository now unused in the file → removed; tsc confirmed). green→green PROOF: the analytics
  route + property suites stayed GREEN UNCHANGED (1109 pass, same as C98) = behavior-preserving. Verified: backend
  validate:local EXIT 0 (tsc 0 · musl-biome clean · 1109 pass / 0 fail · build bundled). Next (100): `infra` most-starved
  (cyc 93 starved-for 7 > 6 → breaches) — the #5 branch-hygiene sweep is due (last C86, branch now ~46 commits) or a
  CLAUDE.md refresh; deep-review (cyc 94, 6 > 5) also breaches. cov: be ~80% / fe 63.7%
- **C100 (infra — #5 branch-hygiene sweep, the milestone cycle)** — BALANCE: `infra` most-starved over budget (cyc 93,
  starved-for 7 > 6), edging deep-review (6); the #5 sweep was due (last C86, ~14 cycles, branch now 46 commits) — a clean
  milestone-appropriate infra pick. All three sweep parts: (1) STRAY UNTRACKED TESTS — zero outside the by-design
  `*.meshclaw.e2e.ts` set (the other untracked entries are gitignored dirs: .meshclaw-tools/, test-results/, __screenshots__/,
  mise.local.toml); nothing would silently drop coverage on merge. (2) GREEN BASELINE — backend validate:local EXIT 0 at C99
  (1109 BE pass), unchanged since (no code this cycle); regress.sh Playwright still sandbox-blocked (the standing limit, as
  C76/C86). (3) BRANCH_REVIEW.md REFRESH — header 36→46 commits, status block 1076→1109 BE / 367→379 FE, appended §18 (C86–C99:
  recurring-expenses spec drafted+signed-off+T1 started, bugs #4/#18, the C90/C92/C99 arch dedups, the C87/C91/C98 coverage
  ratchet, the C93 doc refresh) + refreshed the Suggested-merge footer (noted recurring-expenses as the 2nd mid-build feature,
  near-zero merge risk: only 2 small verified bug fixes are user-visible). BRANCH_REVIEW.md is gitignored (the refresh IS the
  deliverable). Doc-only — no code, no build gate (the C86/C76/C66 sweep pattern). Next (101): `deep-review` most-starved over
  budget (cyc 94, starved-for 7 > 5) → it wins; fan out per rule 7, verify vs source (the C99 arch dedup + the recurring-
  expenses T1 surface are fresh-unreviewed), OR continue feature recurring-expenses T2. Next #5 sweep due ~C110. cov: be ~80% / fe 63.7%
- **C101 (deep-review — certify financing math + split/cascade primitives; pin the T3-critical source-survives-edit gap)** —
  BALANCE: `deep-review` most-starved over budget (cyc 94, starved-for 7 > 5) → forced. Verification cycle (C21/C28/C35
  pattern). Fanned out 2 Explore agents on FRESH backend-correctness surfaces that de-risk pending work: (A) financing/loan
  balance + amortization math (money-touching, feeds the pending lease/loan fix); (B) expense split edit/delete + the
  clearSource/deleteBySource cascade primitives (recurring-expenses T3 builds on these). VERIFIED every finding vs source —
  the discipline earned its keep (both "CRITICAL/MAJOR" flags were FALSE HIGHs):
  • Agent A: AUDIT-CLEAN. computeBalance is correctly payment-history-based (max(0, original − Σpayments), well-tested via
    financing-balance.property); buildAmortizationSchedule decrements properly (bug #10 fixed C38); div-by-zero guarded;
    future-startDate + apr-null + payoff-clamp all safe. One COSMETIC finding (monthsElapsed ignores day-of-month →
    monthsRemaining is a ±1-month display approximation, no $-derived value uses it) — NOT filed (no displayed-$ impact).
  • Agent B: split/cascade primitives CERTIFIED. clearSource NULLs source + KEEPS rows; deleteBySource removes rows + photos
    in a txn; BOTH correctly userId-scoped (no cross-tenant) — verified vs source (repository.ts:483-553). Its "#1 absolute-
    split unvalidated" + "#2 percentage rounding fairness" were FALSE HIGHs (Zod validates sum==total at the API layer per
    validation.ts:64-72; the penny-to-last-vehicle is standard money-split, sum exact). The ONE genuine, actionable finding
    (#3): updateSplitExpense correctly preserves sourceType/sourceId across an edit (copies from firstOld, repository.ts:739-
    740) but NOTHING pinned it — and recurring-expenses T3 (cascade-delete keys on sourceId) depends on a reminder-linked
    split STAYING linked across an edit. Closed it (the C73 audit-then-pin pattern): added a deterministic test to
    expense-repository.property.test.ts — create an even split with sourceType:'reminder', edit it (2→3 vehicles, total
    150→180), assert all new siblings + the DB rows still carry sourceType:'reminder' + the same sourceId. Net: both surfaces
    certified clean, 2 false HIGHs debunked, 1 real T3-de-risking gap closed. Verified: backend validate:local EXIT 0 — 1110
    pass / 0 fail (+1) · build bundled. Next (102): `feature` most-starved over budget (cyc 96, starved-for 6 > 4) →
    recurring-expenses **T2** (split-materialization characterization, backend/non-eyes-on) — now doubly de-risked (this cycle
    certified the split primitives). `bug` (cyc 97, 5 > 3) next. cov: be ~80% / fe 63.7%
- **C102 (feature — recurring-expenses T2: split-materialization characterization)** — BALANCE: `feature` most-starved over
  budget (cyc 96, starved-for 6 > 4) → forced; the actionable backend/non-eyes-on task is recurring-expenses T2 (now doubly
  de-risked: C101 certified the split primitives). Grounded the gap first: `expenseSplitConfig` is referenced in
  validation/trigger-service but NO trigger test FIRES a split expense reminder and checks the materialized rows — C96's
  trigger-expense.test.ts covered only the SINGLE-expense path; reminder-refinements.test.ts is schema-only. Verified the
  path vs source: a time-axis expense reminder CAN carry multiple vehicles (the D4 single-vehicle rule fires only for
  mileage/both, validation.ts:114) + an expenseSplitConfig (even/percentage/absolute, same discriminated union as manual
  splits); on trigger, createExpenseFromReminder:147-163 → computeAllocations → createSiblings → N rows each its share,
  shared groupId, sourceType:'reminder'. Extended trigger-expense.test.ts (+2) with a split-materialization describe block:
  (1) even split $100 across 2 vehicles → 2 siblings of $50 summing to 100, both source-linked, distinct vehicles, group_total
  100, split_method 'even' — grouped by groupId so the overdue catch-up months each assert independently; (2) percentage
  75/25 of $200 → v1=$150, v2=$50, summing to 200, source-linked. Pins the path recurring-expenses T4 (multi-vehicle split
  in the form) materializes through. Verified: backend validate:local EXIT 0 — 1112 pass / 0 fail (+2) · build bundled.
  T2 DONE; tasks.md ticked. Next (103): `bug` most-starved over budget (cyc 97, starved-for 6 > 3) → its top UNBLOCKED item
  (the queue is otherwise Angelo-gated: lease/loan + #14/#16/#19) — re-verify the queue against source per the C89 lesson;
  if genuinely all-gated, the actionable pick is recurring-expenses T3 (cascade-safe delete, backend, the C101-certified
  clearSource path) or a guard. cov: be ~80% / fe 63.7%
- **C103 (bug — expense-form date validation rejects TODAY for positive-UTC-offset users)** — BALANCE: `bug` most-starved
  over budget (cyc 97, starved-for 6 > 3). The known queue is genuinely Angelo-gated (lease/loan $, #14/#16/#19 semantics,
  #2/#11 eyes-on, #17 by-design), so per the C90 refinement I FANNED OUT (2 Explore agents) to find a fresh UNBLOCKED bug
  rather than force a gated one. VERIFIED both findings vs source (C21/C28/C67 — one was a false HIGH):
  • Agent A "getSummary passes a Date to gte() → seconds-vs-ms mismatch, breaks summary every request" = FALSE POSITIVE.
    expenses.date is `integer({ mode: 'timestamp' })` (schema.ts:213) — Drizzle AUTO-converts Date↔seconds at the driver, so
    `gte(expenses.date, dateObj)` is the CORRECT intended usage (the heavily-tested buildExpenseConditions list path does the
    same). The agent's "line 346 does /1000" is a different raw-SQL path. Dismissed, not filed.
  • Agent B (REAL, unblocked, the C6/C61 class): expense-form-validation.ts:36-38 did `new Date(value) > new Date()` for the
    future-date guard. `new Date('YYYY-MM-DD')` parses as UTC midnight, so for a user at a POSITIVE UTC offset today's picked
    date lands on tomorrow-morning-local and the Date-instant compare wrongly rejects TODAY as "in the future." FIX: compare
    CALENDAR-DAY strings — the picker value is already local 'YYYY-MM-DD'; today's local day via the getFullYear/getMonth/
    getDate parts idiom this same file already uses for mileage ordering (:96/:109); string compare is timezone-safe +
    host-independent (sidesteps the C77 UTC-host vacuity trap — the bug was a time-of-day mismatch, eliminated by date-only
    compare). MERGE-SURVIVING GUARD: new expense-form-validation-date.test.ts (+6) — today accepted (the regression),
    past accepted, tomorrow/far-future rejected, empty required; derives "today" from local parts exactly as the validator,
    so it holds on any host. CAVEAT (NORTH_STAR #3): UI-touching but pure .ts logic, no markup; correctness is the TZ-safe
    compare which a screenshot can't show (TZ-dependent) — the unit test is the right gate (the C89/C61 non-visual class).
    Verified: frontend validate:local EXIT 0 — 385 pass / 0 fail (+6) · tsc 0 · build OK. THE GATE EARNED ITS KEEP: caught my
    bun:test import (frontend is vitest) + a strict-null destructure; both fixed. Next (104): nothing over budget (guard cyc 98
    starved-for 6 = budget at 104; arch cyc 99, 5 = budget). Highest-leverage = recurring-expenses T3 (cascade-safe delete,
    backend, the C101-certified clearSource path) — continues the advanceable feature. cov: be ~80% / fe ~64%
- **C104 (feature — recurring-expenses T3: cascade-safe delete, keep history + sever link)** — BALANCE: nothing over budget
  (guard + arch AT budget, breach next); highest-leverage = recurring-expenses T3, the advanceable backend feature on the
  C101-certified clearSource path. Grounded the gap: the reminder DELETE /:id (routes.ts:263) had NO source-cascade wiring,
  so deleting a recurring-expense reminder ORPHANED its materialized expense rows (sourceId → a now-deleted reminder). Per
  D2 (ratified C94: keep past history, sever the link — NORTH_STAR #1 no silent loss), wired
  `expenseRepository.clearSource('reminder', id, user.id)` into the DELETE handler between the ownership check and the
  reminder delete (best-effort try/catch — a clearSource hiccup must not block the delete the user asked for; the rows just
  keep a harmless dangling sourceId). Mirrors the C85 onFinancingDeactivated idiom. No circular import (reminders/routes →
  expenses/repository is one-directional). MERGE-SURVIVING net: delete-reminder-cascade.test.ts (+2) through the real
  route→trigger→delete stack — (1) create expense reminder → trigger (materialize) → DELETE → assert the reminder is gone
  BUT the expense rows REMAIN (same count, $125.50) with sourceType/sourceId NULLED + nothing still linked; (2) a
  notification reminder delete is a clean no-op (materializes nothing). THE GATE EARNED ITS KEEP: first run failed on the
  2nd test — I assumed a 'maintenance' reminder type, but the enum is 'expense'|'notification' (ZodError 400); switched to
  'notification'. (Also a biome reflow autofixed.) Verified: backend validate:local EXIT 0 — 1114 pass / 0 fail (+2) ·
  build bundled. T3 DONE; tasks.md ticked. recurring-expenses BACKEND (T1–T3) now COMPLETE — T4–T8 are the eyes-on frontend
  tail (Playwright-blocked here), so the feature is at the same "backend-done, eyes-on-pending" state as maintenance/
  import-trackers. Next (105): `guard` most-starved over budget (cyc 98, starved-for 7 > 6) → the C83 coverage-ratchet's
  next low spot (middleware/idempotency.ts 43% or rate-limit.ts 60%). cov: be ~80% / fe ~64%
- **C105 (guard — characterize middleware/idempotency.ts 43% → covered)** — BALANCE: `guard` most-starved over budget
  (cyc 98, starved-for 7 > 6), beat `arch` (6) — the "compute all six from the table" rule again. PICK: the C83
  coverage-ratchet's top named low spot, middleware/idempotency.ts at 43% — the double-charge / duplicate-record guard
  (money-relevant), whose caching/replay/TTL core was NEVER directly tested (only the required-key 400 path, incidentally,
  via sync-route-errors.test.ts at the route level). High-risk pure logic, untested — the C82 class. SHIPPED:
  idempotency.test.ts (+7) through a minimal-Hono app (the error-handler.test.ts harness convention) with a per-app
  counter that reveals whether the handler ACTUALLY ran — a replayed cache hit must NOT increment it. Pins every branch:
  (1) method gating — GET bypasses entirely (a key on a safe method is ignored); (2) key gating — missing key throws 400
  VALIDATION_ERROR when required (handler never runs), passes through when optional; (3) cache-hit replay — a duplicate
  POST returns the byte-identical cached body WITHOUT re-running the handler; (4) user-scoping — two users sharing one key
  do NOT collide (the `${userId}:${key}` store key); (5) only-cache-2xx — a 500 is NOT cached, so a transient failure
  gets re-run not replayed forever (the load-bearing invariant); (6) TTL expiry — via setSystemTime, an entry past the 24h
  TTL is evicted on read so the handler runs again. THE GATE EARNED ITS KEEP: first run failed on a tsc error — my
  `Parameters<Parameters<Hono['post']>[1]>[0]` type gymnastics for the handler param don't resolve against Hono's
  overloaded post; fixed by typing it as Hono's `Context` directly (mirroring error-handler.test.ts inline handlers).
  (Also a biome reflow autofixed.) Verified: backend validate:local EXIT 0 — 1121 pass / 0 fail (+7) · build bundled.
  Next (106): `arch` most-starved over budget (cyc 99, starved-for 7 > 5) → the C99 follow-on (converge expenses/financing/
  vehicles route ownership checks on validateVehicleOwnership), or rule-7 fan-out. cov: be ~81% / fe ~64%
- **C106 (arch — converge expenses/routes.ts ownership checks on validateVehicleOwnership, the C99 follow-on)** —
  BALANCE: `arch` the only over-budget category (cyc 99, starved-for 7 > 5). PICK: the C99 follow-on — C99 converged
  analytics/routes.ts (6 of 13 inline `findByUserIdAndId + NotFoundError('Vehicle')` sites) and filed the remaining 3
  route files (expenses/financing/vehicles) as the next arch increments. VERIFY-AGAINST-SOURCE (the C69/C99 diff-before-
  extract discipline) screened all three: financing/routes.ts is a TRAP — its two sites throw `HTTPException(404,
  {message:'Vehicle not found'})`, NOT `NotFoundError('Vehicle')`, so converging it would CHANGE the error envelope
  (code 'HTTPException' → 'NotFoundError') — NOT behavior-preserving, EXCLUDED (the exact C69 "not byte-identical" win).
  Scoped to expenses/routes.ts (arch rule 1, one file/cycle): 4 sites, all byte-identical to the validator
  (findByUserIdAndId(user.id, X) + if(!vehicle) throw NotFoundError('Vehicle'), vehicle DISCARDED) — 2 mandatory
  (create:538 via expenseData.vehicleId, list:593) + 2 optional (summary:301, export:356, kept inside their
  `if (vehicleId)` guards). All collapse to `await validateVehicleOwnership(X, user.id)`. Dropped the now-unused
  `NotFoundError` import (kept `ValidationError`, still used at :547/:550); `vehicleRepository` STAYS imported (still used
  at :373/:442/:462 for findByUserId + type annotations) — tsc confirmed both. GREEN→GREEN PROOF: expenses route +
  property suites stayed green UNCHANGED — 1121 pass, same as C105 = behavior-preserving. Verified: backend
  validate:local EXIT 0, build bundled. REMAINING: vehicles/routes.ts (mixed shapes — some bare throws at :208/:251
  without an adjacent find; needs per-site verification) filed as the next arch increment; financing EXCLUDED by design.
  Next (107): nothing forced (deep-review/bug/infra breach next) → highest-leverage. cov: be ~81% / fe ~64%
- **C107 (infra — real coverage RE-MEASUREMENT + ratchet re-anchor, loop-improvement #4)** — BALANCE: `infra` most-starved
  over budget (cyc 100, starved-for 7), beating deep-review (6) + bug (4). The #5 sweep isn't due (~C110), and the
  highest-leverage infra increment was a TRUE coverage reading: the `cov:` tags had carried forward stale `~81%/~64%`
  ESTIMATES since the C81 baseline, through 25+ test-adding ratchet cycles (C82–C106) — measurement hygiene overdue, and it
  re-aims the ratchet's "next lowest module" pick. Ran `bun test --coverage` (backend) + `vitest --run --coverage`
  (frontend). RESULT: **be 81.10% line / 81.84% func** (up ~+4 from C81's 77.8/76.9 — the ratchet demonstrably delivered);
  **fe 61.41% line / 59.31% func / 52.24% branch** (essentially FLAT vs C81's 63.7%, even slightly DOWN — the frontend
  product code [components/routes] outgrew its tests; FE is now decisively the bigger gap, confirming the C81 steer). Faithful
  per loop-improvement #4 — NOT dropping coverage silently: the FE flat/slightly-down number is named, not hidden. CURRENT
  low spots captured for the ratchet (refreshed the COVERAGE TREND header): be — rate-limit.ts (60% line, the named next
  target), body-limit.ts (35% line size-enforcement branch), sync/restore+routes (~32–61%, C91-s3-seam-tractable),
  analytics/routes.ts (43% — C99/C106 covered the ownership validators, NOT the GET handlers' response assembly); fe — the
  broad components/routes deficit. OAuth providers (0–40%) are live-but-network-bound (the C85 hard-to-test class), lower
  priority. Doc-only (measurement + header re-anchor, no code change → no build gate, the C100 sweep pattern); coverage
  artifacts are gitignored. Next (108): `deep-review` most-starved over budget (cyc 101, starved-for 7 > 5) → fan-out per
  rule 7. cov: be 81.1% / fe 61.4% (MEASURED C107)
- **C108 (deep-review — adversarial audit of the backup-RESTORE + mileage-RECHECK paths; rule-7 fan-out)** — BALANCE:
  `deep-review` most-starved over budget (cyc 101, starved-for 7 > 5), beat bug (5). Verification-only cycle (no product
  code; findings → queues). Per rule 7, fanned out 2 Explore agents on FRESH high-risk backend-correctness surfaces the
  C107 reading flagged — sync/restore (writes user data, security-critical, 61% line) + the D5 mileage-recheck/odometer
  path. EVERY finding verified against source (the C21/C28/C35/C67 discipline — neither agent found a HIGH; ~half of agent
  flags would be false). CERTIFIED CLEAN (positive evidence): (a) restore cross-tenant WRITE — every user_id table is
  force-stamped to the importer via stampUserId (restore.ts:293-298), schema cross-checked table-by-table; the C145 gap
  stays closed. (b) restore ATOMICITY — wipe+insert wrapped in one db.transaction (restore.ts:123-128), FK-ordered deletes,
  rollback on mid-restore failure. (c) restore idempotency — idempotency({required:true}) mw + id-preserving inserts.
  (d) ALL 5 mileage classes — double-fire (dual dedup on (reminderId,nextDueOdometer): app-guard mileageNotificationExists
  + DB partial-unique backstop), boundary (currentOdometer >= nextDueOdometer, `<` guard fires on equality), cross-vehicle
  bleed (vehicleIds.includes(vehicleId) filter + per-vehicle MAX odometer scoped WHERE vehicle_id=), stale-odometer (recheck
  runs AFTER the expense insert, reads the just-written row), best-effort (can't throw — C42 fetch wrap + per-reminder
  try/catch; null≠NaN). FILED (verified real, all MED, none HIGH): #20 detectConflicts (restore.ts:235) is NOT userId-scoped
  + returns the full existing row as localData → cross-tenant READ leak in merge mode (low exploitability: cuid2 ids
  unguessable, but a real tenant-isolation gap; correct fix spans 6 heterogeneous tables — 4 userId-direct + financing/
  photoRefs FK-owned — so it's a bug-cycle fix, not a one-liner); #21 replace-mode + an empty-but-valid backup = silent
  TOTAL WIPE (no min-payload sanity guard; also a small product decision); #22 zip-bomb guard (backup.ts:469) trusts the
  attacker-declared header.size (spoofable; the 50MB compressed bodyLimit is the real backstop on the upload path, but the
  provider download path lacks it — hardening); + mileage Findings A/B (no IMMEDIATE recheck on expense/odometer PUT-update
  — delayed-fire, eventually caught by the periodic /trigger pass, so nothing is permanently lost). No code change (rule-7
  verification cycle); all findings → BACKLOG bug queue for a future bug cycle. Next (109): nothing forced (feature/bug
  breach next) → highest-leverage; #20 (the verified tenant-scope leak) is the strongest bug-queue pick. cov: be 81.1% /
  fe 61.4% (carry C107)
- **C109 (bug #20 — fix the detectConflicts cross-tenant READ leak in merge-mode restore)** — BALANCE: `bug` most-starved
  over budget (cyc 103, starved-for 6 > 3), beat feature (5). Picked the C108-surfaced + verified #20 (the strongest
  grounded item — the rest of the bug queue is Angelo-gated or eyes-on). RE-VERIFIED the schema ownership columns myself
  against source (the C67 discipline, not trusting the agent's table): vehicles/expenses/insurancePolicies/photos own via a
  userId column; vehicleFinancing (vehicleId FK) + photoRefs (photoId FK) own indirectly. THE LEAK: detectConflicts
  (restore.ts) probed `SELECT * ... WHERE id IN (backup ids)` with NO ownership filter, then returned the full existing row
  as `localData` in the merge `conflicts` response — a colliding id surfaced another tenant's row (VIN/amounts). FIX:
  threaded `userId` into detectConflicts + a per-table `scope` predicate — eq(table.userId, userId) for the 4 userId-direct
  tables; inArray(fk, ownedParentIds) for financing/photoRefs (owned vehicle/photo ids fetched once up front), folded into
  `where(and(inArray(table.id, ids), scope))`. Same class as the C145 write-stamp; low exploitability (cuid2 ids
  unguessable) but a real tenant-isolation gap, now closed at the query. MERGE-SURVIVING net: restore-conflict-tenant-scope
  .test.ts (+2, mirrors the restore-userid-stamp harness) — (1) a backup vehicle id tampered to COLLIDE with a seeded
  victim's id reports NO leak (the victim's 'Ferrari' never appears in conflicts; the row is untouched in the DB — and the
  post-fix merge correctly hits the PK constraint on insert rather than overwriting, so the test tolerates that secure
  throw); (2) a genuine SELF-collision still reports a conflict (feature intact, not over-scoped). THE GATE EARNED ITS KEEP:
  first run the test 500'd on a UNIQUE-constraint throw (post-fix merge tries to insert the colliding id) — refined the
  assertion to accept either the leak-free conflicts OR the secure PK-throw (both prove no leak/overwrite). (Biome reflow
  autofixed twice.) Verified: backend validate:local EXIT 0 — 1123 pass / 0 fail (+2), build bundled. #20 CLOSED. Next
  (110): nothing forced (feature cyc 104 = budget at 110; infra #5 sweep due ~C110) → highest-leverage feature, or the #5
  branch-hygiene sweep. cov: be 81.1% / fe 61.4% (carry C107)
- **C110 (infra — #5 branch-hygiene sweep, the milestone cycle; feature category found eyes-on-EXHAUSTED)** — BALANCE:
  `feature` was technically most-starved over budget (cyc 104, starved-for 6 > 4), BUT grounding it (per the C90 "don't
  force a wrong-class pick" rule) showed ALL THREE features are backend-complete + eyes-on(Playwright)-blocked: maintenance
  T9, import-trackers T4–T6, recurring-expenses T4–T8. I verified the one remaining backend SEAM each FE tail depends on is
  already built + characterized — notably recurring-expenses T5's client hook will POST to `POST /reminders/trigger`
  (routes.ts:60 → processOverdueReminders), which has DEEP coverage (trigger-expense/mileage/idempotency-cas/fastforward).
  So the feature category's actionable BACKEND work is genuinely exhausted; forcing a frontend task just hits the sandbox
  wall. Pivoted to the milestone-appropriate #5 branch-hygiene sweep (due ~C110, last C100, branch now 56 commits ≈ 10
  cycles), per the C80 "take the milestone even when blocked" lesson. ALL THREE sweep parts: (1) ZERO stray untracked
  unit/spec tests outside the by-design `*.meshclaw.e2e.ts` set — nothing would silently drop coverage on merge;
  (2) green baseline — backend validate:local EXIT 0 at C109 (1123 BE), unchanged since; regress.sh Playwright still
  sandbox-blocked (the standing limit, per C76/C86/C100); (3) BRANCH_REVIEW.md refresh — header 46→56 commits, status
  1109→1123 BE / 379→385 FE + the C107 measured coverage (be 81.1% / fe 61.4%, FE now the bigger gap), appended §19
  (C100–C109: recurring-expenses T2/T3 backend finish, bug #20 restore cross-tenant leak fix + #103 date-TZ fix, the C106
  arch convergence + financing-EXCLUDED note, C105 idempotency net, C101/C108 deep-review certifications, C107 re-measure),
  refreshed the merge footer to THREE mid-build features + the restore-security-hardening framing. Doc-only — BRANCH_REVIEW
  .md is gitignored (the refresh IS the deliverable), so only the 2 loop docs commit; no build gate (the sweep pattern).
  ESCALATION: flagged to Angelo that the feature category is now eyes-on-blocked across all 3 builds — the real lever is
  unblocking Playwright (the standing #1 improvement). Next (111): `guard` most-starved over budget (cyc 105, starved-for
  6 = budget at 111; deep-review/arch also near) → the C107-re-anchored ratchet (rate-limit.ts 60%, or FE which is now the
  measured gap). cov: be 81.1% / fe 61.4% (carry C107)
- **C111 (feature — recurring-expenses T7 BACKEND CORE: recurring-cost normalizer, the non-eyes-on half)** — BALANCE:
  `feature` the only OVER category (cyc 104, starved-for 7 > 4 — and structurally climbing since it's eyes-on-blocked, so
  C110's forecast of guard was wrong; recomputed the full table). Per the C90 rule I owed a real search for an actionable
  NON-eyes-on slice before punting again (C110 parked the FE tails). Found one: T7 (recurring-cost visibility, R5/D4) has a
  PURE backend core — "derive on read; amount × normalized-to-monthly frequency" — that lands test-first without Playwright
  (the dashboard widget renders it later, eyes-on), exactly how T1–T3 shipped backend-before-UI. GROUNDED first (NORTH_STAR
  #4, don't reinvent): no run-rate/normalization helper exists (computeNextDueDate ADVANCES a date, a different concern);
  read the reminders schema (frequency 'weekly'|'monthly'|'yearly'|'custom' + intervalValue/intervalUnit; type:'expense' +
  isActive + expenseAmount) and computeNextDueDate's frequency interpretation to MIRROR it. SHIPPED: reminder-cost.ts (pure,
  no DB) — occurrencesPerYear(freq, iv, unit) on an occurrences-PER-YEAR÷12 basis so the 4 frequencies stay mutually
  consistent (weekly 365.25/7÷12, monthly 1, yearly 1/12, custom converts per unit + scales inversely); monthlyRunRate
  (reminder) (only active positive-amount expense reminders contribute — notification/inactive/null-amount/un-fireable
  interval → 0, never a divide-by-zero); recurringCostSummary(reminders[]) → {count, monthlyTotal}. NET: reminder-cost.test
  .ts (+10) — frequency consistency, custom per-unit conversion, the 0-contributors, the aggregate, empty-set; the Reminder
  fixture matches the real schema type (tsc-proven). THE GATE EARNED ITS KEEP (biome reflow autofixed). Verified: backend
  validate:local EXIT 0 — 1133 pass / 0 fail (+10), build bundled. T7's backend core is built + pinned; the T7 dashboard
  widget + the T4/T5/T6/T8 tails remain eyes-on (Playwright-blocked). Next (112): `guard` most-starved over budget (cyc 105,
  starved-for 7 > 6) → the C107-re-anchored ratchet (rate-limit.ts 60% line, or FE — the measured gap). cov: be ~81% /
  fe 61.4% (carry C107; backend +1 pure module)
- **C112 (guard — characterize middleware/rate-limit.ts 60% → covered)** — BALANCE: `guard` most-starved over budget (cyc
  105, starved-for 7 > 6), beat arch (6). PICK: the C107-re-anchored ratchet's top named backend low spot, rate-limit.ts at
  60% line — the abuse-prevention middleware, whose limit-exceeded 429 path (with its Retry-After + X-RateLimit-* headers, a
  client-readable contract) + window-reset were uncovered. Mirrors the C105 idempotency net (both middleware, minimal-Hono
  harness). VACUITY GUARD (the C77/C91 trap): windowMs/limit/keyGenerator come from the config ARG (harness-controlled), but
  `disableRateLimit` is a frozen CONFIG singleton — if a harness ever set DISABLE_RATE_LIMIT, every limit assertion would
  vacuously pass. Verified DISABLE_RATE_LIMIT is set by NOTHING in the repo (only read in config.ts) → false in the test
  process; ALSO added an explicit precondition test asserting CONFIG.disableRateLimit===false so the net can never silently
  go vacuous. SHIPPED: rate-limit.test.ts (+5) through a minimal-Hono app with a fixed-key tiny-window limiter: (1)
  precondition (limiting ACTIVE); (2) up-to-limit pass, over-limit 429 with all 4 headers (X-RateLimit-Limit/Remaining/Reset
  + Retry-After); (3) 429 body carries RATE_LIMIT_EXCEEDED + retryAfter>0; (4) per-key isolation (one key's exhaustion
  doesn't 429 another); (5) window reset via setSystemTime (resetTime < now → fresh window passes). THE GATE EARNED ITS KEEP
  (biome reflow autofixed). Verified: backend validate:local EXIT 0 — 1138 pass / 0 fail (+5), build bundled. Both
  middleware low spots (idempotency C105, rate-limit C112) now covered. Next (113): `arch` most-starved over budget (cyc 106,
  starved-for 7 > 5) → the C106 follow-on (vehicles/routes.ts ownership convergence — mixed shapes, verify per-site) or
  rule-7 fan-out. cov: be ~81% / fe 61.4% (carry C107; backend +1 module covered)
- **C113 (arch — converge vehicles/routes.ts ownership checks on validateVehicleOwnership; COMPLETES the C99 arc)** —
  BALANCE: `arch` most-starved over budget (cyc 106, starved-for 7 > 5), beat bug (4). The C106 follow-on — the LAST of the
  C99 three route files (analytics C99, expenses C106, financing EXCLUDED as the HTTPException trap). PER-SITE VERIFICATION
  (the C69/C106 discipline — the file was flagged mixed-shape): 4 NotFoundError('Vehicle') sites, only 2 convertible. GET
  /:id (:205) + PUT /:id (:249) use `findByIdWithAccess` (the SHARED-ACCESS lookup, NOT findByUserIdAndId) AND use the
  returned vehicle (GET enriches financing; PUT reads licensePlate/unitPreferences) → EXCLUDED (different semantics + result
  used). DELETE /:id (:287, binding unused → discard form) + GET /:id/stats (:330) are findByUserIdAndId + throw → CONVERTED.
  THE GATE EARNED ITS KEEP: my pre-edit awk scan said the stats `vehicle` binding was unused, but tsc caught 3 uses at
  :351-353 (vehicle.initialMileage/trackFuel/trackCharging fed to calculateVehicleStats) — so the validator's RETURN value
  is needed there; fixed to `const vehicle = await validateVehicleOwnership(id, user.id)` (the validator returns Promise
  <Vehicle>, so capturing it is byte-equivalent). DELETE stays the discard form. NotFoundError + vehicleRepository imports
  STAY (still used at the 2 excluded sites + delete/findByLicensePlate). GREEN→GREEN PROOF: vehicles route + property suites
  stayed green UNCHANGED — 1138 pass, same as C112 = behavior-preserving. Verified: backend validate:local EXIT 0, build
  bundled. **The C99 ownership-convergence arc is COMPLETE** (analytics/expenses/vehicles converged; financing excluded by
  design). Next (114): nothing forced (deep-review cyc 108 = budget at 113... recompute next cycle) → highest-leverage. cov:
  be ~81% / fe 61.4% (carry C107)
- **C114 (deep-review — adversarial audit of the CSV-import + insurance-cost paths; rule-7 fan-out)** — BALANCE: TWO
  categories breached (deep-review cyc 108 starved-for 6; bug cyc 109 starved-for 5); per the C107 highest-ABSOLUTE rule,
  deep-review (6) > bug (5). Verification-only cycle (no product code; findings → bug queue). Fanned out 2 Explore agents on
  fresh high-risk surfaces with NO prior dedicated read: the untrusted-CSV import/mapping path (import-trackers T1–T3 was
  "backend complete" but never audited) + the insurance premium/cost computation (C73 touched it, but only #14 was filed).
  EVERY finding verified against source (the C67 discipline — NEITHER agent found a HIGH; I pre-read import-mapping.ts +
  the insurance attribution block myself). CERTIFIED CLEAN (positive evidence): CSV path — cross-tenant vehicle resolution
  (targetVehicle is a NAME resolved only within the importer's fleet), userId double-stamp (route + repo), transaction
  atomicity (single db.transaction, only 'ready' rows inserted), idempotency (deterministic clientId + unique index),
  CSV-injection-on-export (neutralizeCsvCell), unit-conversion direction/single-pass, the C61 local-day class (built from
  parts in local time); insurance — div-by-zero guarded (monthsInTerm===0 + null-bound monthKeysInRange), no
  monthly-vs-total double-count (effectiveMonthlyPremium precedence is exclusive; totals add once per policy), year-boundary
  trend correct. FILED (verified real, all MED/LOW, none HIGH): #23 CSV date roll-over (normalizeForeignDate validates only
  integer-ness, no 1–12/1–31 range check → new Date(2024,44,13) silently rolls forward instead of erroring; a wrong
  format-pick or bad row stores a garbage date — VERIFIED at import-mapping.ts:181-194; clean fix = a range guard or a
  post-construct getMonth/getDate echo check); #24 CSV comma-as-thousands ('1,234'→1.234 corrupts amount/volume/mileage,
  passes validation — VERIFIED at normalizeDecimal:139-147; the documented decimal-comma choice, harm is a manually-mapped
  US-thousands file → needs a disambiguation decision); #25 insurance per-vehicle attribution uses the LATEST-term premium
  but the ALL-terms coverage set as the divisor (repository.ts:895-948 — VERIFIED: when coverage changed across terms, the
  current vehicle is understated and dropped vehicles get a phantom share + costByCarrier.vehicleCount over-reports; AGGREGATE
  totals are CORRECT, it's a mis-DISTRIBUTION not a mis-total — MED); + insurance LOWs (inclusive-month off-by-one on a
  renewal-day endDate; open-ended null-endDate term contributes to totals but drops from the trend + sorts last in the
  latest-term race; findExpiringTerms lacks an isActive filter). No code change (rule-7 verification cycle); all → BACKLOG
  bug queue. Next (115): `bug` most-starved over budget (cyc 109, starved-for 6 > 3) → #23 (the cleanest grounded fix — a
  date range guard) is the strongest pick. cov: be ~81% / fe 61.4% (carry C107)
- **C115 (bug #23 — CSV import: out-of-range date silently rolled over → now a clean per-row error)** — BALANCE: `bug`
  most-starved over budget (cyc 109, starved-for 6 > 3). Picked the C114-filed #23 (the cleanest grounded fix; the rest of
  the new bug block is decision-gated (#24) or a bigger insurance change (#25/#26)). THE BUG: normalizeForeignDate
  (import-mapping.ts) validated only integer-ness then did `new Date(year, month-1, day)` — JS rolls out-of-range parts over
  rather than NaN-ing, so a `dmy` row 13/45/2024 stored a date ~3.7yr later, a wrong-format-pick rolled 25/03 forward, Feb 30
  rolled to March, and "2024--15" (Number('')=0) → Dec 2023 — all silently. FIX: an ECHO-CHECK — construct the local Date,
  then verify getFullYear/getMonth/getDate match the input parts; on mismatch return the RAW string so buildImportPlan's
  parseDate reports a clean per-row "Invalid date" (the deferred-error contract this module already uses for non-finite
  numbers). Extracted into a `buildLocalDate(...)→Date|null` helper — which ALSO resolved the biome complexity ceiling the
  inline guard tripped (16>15; the gate earned its keep). MERGE-SURVIVING net: import-mapping.test.ts (+4) — out-of-range
  month/day returns raw, Feb 30 returns raw, empty-segment returns raw, AND a valid in-range date still normalizes (the
  over-reject regression guard). Host-independent (no TZ/now dependency in the assertions). Verified: backend validate:local
  EXIT 0 — 1142 pass / 0 fail (+4), build bundled. #23 CLOSED. Next (116): nothing forced (feature/infra breach next) →
  highest-leverage. cov: be ~81% / fe 61.4% (carry C107)
- **C116 (feature — recurring-expenses T7: GET /reminders/recurring-cost route, the non-eyes-on backend seam)** — BALANCE:
  `feature` most-starved over budget (cyc 111, starved-for 5 > 4). FE tails are eyes-on-blocked, so per the C111 pattern I
  advanced via the next NON-eyes-on slice: the HTTP route that exposes the C111 recurringCostSummary helper — the seam the
  T7 dashboard widget (eyes-on) will fetch, HTTP-characterizable now. GROUNDED first: confirmed the static-suffix-before-/:id
  route pattern (POST /trigger, GET /notifications) + that reminderRepository.findByUserId(userId, {type:'expense'}) returns
  ReminderWithVehicles[] (each .reminder is the full row recurringCostSummary takes). SHIPPED: GET /recurring-cost (placed
  before /:id) → findByUserId(user.id, {type:'expense'}) → recurringCostSummary(rows.map(r => r.reminder)) → {count,
  monthlyTotal}. Read-only derivation over existing rows (NO new table, NORTH_STAR #4); no import cycle (reminders/routes →
  reminder-cost, one-directional). MERGE-SURVIVING net: recurring-cost-route.test.ts (+3) through the real stack — a $100
  monthly + $1200 yearly expense reminder → count 2, monthlyTotal $200 (notification ignored); a fresh user → clean zero;
  user-scoped (a 2nd user sees only their own empty set). THE GATE EARNED ITS KEEP (biome reflow autofixed). Verified:
  backend validate:local EXIT 0 — 1145 pass / 0 fail (+3), build bundled. T7 backend (core C111 + route C116) is now
  complete; only the T7 dashboard WIDGET (eyes-on) + the T4/T5/T6/T8 tails remain Playwright-blocked. Next (117): `infra`
  most-starved over budget (cyc 110, starved-for 7 > 6) → #5 sweep is next due ~C120, so likely a CLAUDE.md orientation
  refresh or another infra need. cov: be ~81% / fe 61.4% (carry C107)
- **C117 (infra — CLAUDE.md orientation refresh; the C93/C72 anti-drift class)** — BALANCE: `infra` most-starved over
  budget (cyc 110, starved-for 7 > 6); the #5 sweep isn't due (~C120), so the high-value infra increment was a CLAUDE.md
  refresh (last C93, 24 cycles ago — a stale entry-point misleads a fresh agent). Fixed THREE actively-misleading drifts
  (verified vs source/LEDGER, the C93 fix-only-real-drift discipline, no cosmetic churn): (1) recurring-expenses was ENTIRELY
  ABSENT — the doc said "Two feature specs signed off" + listed only maintenance/import-trackers, but recurring-expenses
  (D1–D4 signed off C94) is now the MOST backend-complete feature (T1–T3 + T7); added it as the 3rd bullet with the
  load-bearing "engine already exists, EXTEND it" grounding + the T1/T2/T3/T7-backend cycle map + the eyes-on remaining tail.
  (2) Stale coverage — cited "77.8%/63.7% (C81)"; corrected to the C107 re-measure (be 81.1% line/81.8% func, fe 61.4%/59.3%)
  + the key steer that FRONTEND is now the bigger gap. (3) Stale suite size ~1100/~379 → ~1145/~385. Doc-only (no code → no
  build gate, the C93/C100 pattern). Next (118): nothing forced (deep-review cyc 114, guard cyc 112 breach next) →
  highest-leverage. cov: be ~81% / fe 61.4% (carry C107)
- **C118 (guard — characterize FE utils/memoize.ts 0% → covered; FIRST frontend ratchet pick)** — BALANCE: nothing over
  budget (guard/bug/arch all AT); free highest-leverage pick. The C107 reading + the C117 CLAUDE.md steer both name FRONTEND
  as the decisively bigger coverage gap (61.4% vs be 81%), so a FE guard pick on high-risk pure logic is the highest-leverage
  move (attacks the measured gap + the standing angle, vitest/non-eyes-on). SURVEY: most FE money/math utils already have
  tests; the untested high-RISK one is memoize.ts — two REUSABLE primitives (memoizeMulti + debounce) with zero direct
  coverage, where a bug silently corrupts every consumer (stale/wrong-key cache; dropped/early debounced call). The C82 class
  (skipped trivial vehicle-helpers.ts — a 1-line display passthrough, coverage theater). SHIPPED: memoize.test.ts (+7):
  memoizeMulti cache-hit-doesn't-re-invoke, distinct-args-independent, JSON-VALUE identity (equal-shape objects hit), and the
  MAX_CACHE_SIZE=100 eviction; debounce collapse-to-one-trailing-call + latest-args + reset-on-each-call + separated-calls,
  via vi.useFakeTimers. THE GATE EARNED ITS KEEP (genuinely): my eviction test asserted calls=102 but got 103 — re-reasoning
  proved the CODE is correct and MY model was wrong (every over-cap insert evicts one more oldest key, so square(0)'s insert
  ALSO evicts the now-oldest key 1 → square(1) is also a miss). Fixed the test to the real eviction-cascade behavior + a
  self-documenting comment (a real characterization catch — the subtle bit pinned). Verified: frontend validate:local EXIT 0
  — 392 pass / 0 fail (+7), tsc 0, build OK. FE ratchet started. Next (119): `deep-review` most-starved over budget (cyc 114,
  starved-for 5 = budget at 119... recompute) → highest-leverage. cov: be ~81% / fe ~62% (FE +1 module covered; re-measure
  due ~C120)
- **C119 (arch — extract `capitalize` FE helper from 5 hand-rolled sites; rule-7 fan-out)** — BALANCE: two breached (arch
  cyc 113 starved-for 6, bug cyc 115 starved-for 4); highest-ABSOLUTE → arch (6) > bug (4). C99 arc complete + arch #2
  direction-blocked, so per rule 7 fanned out 2 Explore agents (backend + frontend dedup). Took the FE candidate — doubles
  down on the C107/C118 "FE is the bigger gap" steer. VERIFIED all 5 sites vs source (C69 diff-before-extract):
  `<x>.charAt(0).toUpperCase() + <x>.slice(1)` byte-identical at ClaimsSection.svelte:86-88 (a LOCAL `titleCase` already
  hand-written — this formalizes the helper a component already wanted), ReminderForm.svelte:407/411/412, FinancingAnalytics
  .svelte:117-118 (inside a `=== 'own' ? 'Owned' : ...` ternary — extracting just the capitalize call preserves it). Added
  `export function capitalize(s)` to formatters.ts (no collision), removed ClaimsSection's local titleCase (4 calls rerouted),
  wired the other 4 inline sites. +3 unit tests (capitalize: basic, empty/already-capitalized no-op, only-first-char). GREEN→
  GREEN: component + formatters suites stayed green; frontend validate:local EXIT 0 — 395 pass / 0 fail (+3), tsc 0, build OK.
  The backend agent's #1 (provider ownership lookup repeated 5× in providers/routes.ts — byte-identical, returns-the-row
  drop-in, DIFFERENT table than validateVehicleOwnership) is FILED as the next arch pick. Next (120 — milestone): nothing
  forced (deep-review cyc 114 / bug cyc 115 breach next) → highest-leverage; #5 sweep + coverage re-measure both due ~C120.
  cov: be ~81% / fe ~62% (carry; re-measure due C120)
- **C120 (deep-review — adversarial audit of the TCO aggregation + offline-sync paths; found the loop's first HIGH)** —
  BALANCE: two breached (deep-review cyc 114 starved-for 6, bug cyc 115 starved-for 5); highest-ABSOLUTE → deep-review (6) >
  bug (5). The #5 sweep is a SOFT cadence note (infra only starved-for 3, not forced) — balance rule wins (the
  compute-all-six lesson). Verification-only cycle; rule-7 fan-out on 2 fresh high-risk surfaces (TCO grand-total aggregation;
  offline-outbox/clientId idempotency). EVERY finding verified vs source (the C67 discipline; I pre-read the TCO charts +
  caught my OWN false-positive — costPerDistance :475 is guarded by the :468 totalMiles>0 filter). **FOUND THE LOOP'S FIRST
  HIGH (#27, verified):** getVehicleTCO totalCost = purchasePrice + financingInterest + ... (repository.ts:1782-1788), but the
  `financingInterest` bucket sums the WHOLE financing-sourced expense row (categorizeTCOExpenses:1006-1007), and those rows
  are FULL loan PAYMENTS (principal+interest) — proven by computeBalance = originalAmount − SUM(financing expenseAmount)
  (financing/repository.ts:68, payments pay down principal). So for a financed vehicle with a purchasePrice set, the PRINCIPAL
  is counted TWICE (once as purchasePrice, once inside the payments retiring it) — materially inflating the headline TCO. The
  bucket NAME reveals the intended design (purchasePrice + interest-only), but the impl adds the whole payment. NOT a
  mechanical fix — it's an accounting-model DECISION (purchasePrice+interest-only vs downPayment+allPayments vs
  purchasePrice+(payments−principal); interest isn't separately stored) that changes a displayed $ figure → ESCALATED to
  Angelo, filed #27. Also filed #28 (MED): purchasePrice + ownershipMonths are added/divided UNwindowed while a year-filtered
  TCO windows the expenses (a 2024 TCO absorbs the full lifetime purchase price ÷ full-ownership months — mismatched
  numerator/denominator). And #29 (MED, sync): BaseRepository.update keys on `id` ONLY (utils/repository.ts:62-66) — no
  updatedAt/version guard, so an offline edit replayed after a newer online edit is a silent LWW lost-update with no 409
  (design call — LWW is legitimate, but undocumented + no conflict signal). CERTIFIED CLEAN: TCO split (siblings-only, no
  parent double-count), insurance (single source), sign/bucket-exhaustiveness reconciles, div-by-zero (ownershipMonths
  Math.max(1,…) + totalMiles>0 guards), unit normalization (convertDistance per vehicle); sync idempotent-return dedup,
  (userId,clientId) tenant scoping, per-row outbox semantics, userId stamping. No code change (rule-7 verification cycle).
  Next (121): `bug` most-starved over budget (cyc 115, starved-for 6 > 3) → #28 (the windowed-purchasePrice fix, the cleanest
  grounded TCO one) — #27 is the bigger prize but Angelo-gated. cov: be ~81% / fe ~62% (carry; re-measure deferred to a guard
  cycle)
- **C121 (bug #28 — year-scoped TCO no longer adds the full lifetime purchasePrice ÷ full-ownership months)** — BALANCE:
  `bug` most-starved over budget (cyc 115, starved-for 6 > 3). Picked the C120-filed #28 (the cleanest UNBLOCKED TCO fix;
  #27 the principal-double-count HIGH stays Angelo-gated). THE BUG: getVehicleTCO (analytics/repository.ts:1762-1817)
  window-filters detailedExpenses when `year` is set, but added `purchasePrice` to totalCost UNCONDITIONALLY + computed
  ownershipMonths as purchaseDate→now (never year-bounded) — so a 2024-scoped TCO absorbed the full lifetime acquisition
  cost AND divided that windowed numerator by full-ownership months. FIX (two matched halves): (1) `includePurchase = !year`
  — purchasePrice (a one-time acquisition cost) is only in the all-time total, not a per-year one; (2) extracted + exported
  `monthsOwnedInYear(ownershipStart, now, year)` (pure, injected `now` — host-independent, no Date.now) and use it for the
  year-scoped ownershipMonths so costPerMonth divides by a matching ≤12-month span. Both clamp ≥1. MERGE-SURVIVING net:
  tco-months-owned.test.ts (+6): full-year=12, mid-year(Jul)=6, in-progress-year=3, future-year=0, before-ownership=0,
  single-month=1 — the boundary set, all host-independent. Verified: backend validate:local EXIT 0 — 1151 pass / 0 fail
  (+6), build bundled. #28 CLOSED. NOTE: #27 (the bigger principal double-count) is the SAME function + Angelo-gated; when
  decided, fix alongside. Next (122): nothing forced (feature cyc 116 / arch cyc 119... recompute) → highest-leverage; the
  filed provider-ownership arch dedup or recurring-expenses backend are candidates. cov: be ~81% / fe ~62% (carry)
- **C122 (feature — recurring-expenses T6: GET /reminders/:id/expenses, the non-eyes-on backend seam)** — BALANCE:
  `feature` most-starved over budget (cyc 116, starved-for 6 > 4). FE tails eyes-on-blocked, so per the C111/C116 pattern I
  advanced via the next NON-eyes-on slice: the read endpoint the T6 "this reminder materialized N expenses" UI will fetch.
  GROUNDED: clearSource/deleteBySource (mutate-by-source) exist but there was NO findBySource (read-by-source). SHIPPED:
  (1) expenseRepository.findBySource(sourceType, sourceId, userId) → Expense[] ordered by date (the read counterpart to
  clear/deleteBySource, same (sourceType,sourceId,userId) scoping; [] when nothing linked); (2) GET /reminders/:id/expenses
  (a /:id sub-path, no collision) — ownership-check via findByIdAndUserId then findBySource('reminder', id, user.id). Raw
  Expense rows serialize (no mapper, C80 clean pass-through). MERGE-SURVIVING net: reminder-materialized-expenses-route
  .test.ts (+4) through the real stack — expense reminder → trigger → GET returns the source-linked rows ($125.50); a
  notification reminder → []; non-existent id → 404; another user's reminder → 404 (no cross-tenant read). THE GATE EARNED
  ITS KEEP: first run the notification test 400'd — reminder-create REQUIRES vehicleIds even for notification type (ZodError);
  added a vehicleId. (Biome reflow autofixed.) Verified: backend validate:local EXIT 0 — 1155 pass / 0 fail (+4), build
  bundled. recurring-expenses backend is now T1–T3 + T6(read seam) + T7 — only the T4/T5 + the T6/T7 WIDGETS + T8 e2e remain
  eyes-on. Next (123): `arch` most-starved over budget (cyc 119, starved-for 4... recompute) or guard → highest-leverage; the
  filed provider-ownership dedup is the queued arch pick. cov: be ~81% / fe ~62% (carry)
- **C123 (arch — converge providers/routes.ts ownership lookups on findOwnedProviderOrThrow)** — BALANCE: nothing over
  budget (infra AT, breaches next); free highest-leverage = the C119-filed + pre-verified provider-ownership dedup (the C91
  HTTP net already covers providers/routes.ts → lands against an existing safety net, the C17/C91 net-then-dedup pattern).
  RE-VERIFIED all 5 sites byte-identical vs source (C69): the 7-line `select().from(userProviders).where(and(eq id, eq
  userId)).limit(1); if (!existing[0]) throw NotFoundError('Provider')` block at PATCH:360/DELETE:446/health:491/
  backfill:515/sync:575. Extracted `findOwnedProviderOrThrow(db, id, userId): Promise<UserProvider>` (returns the row;
  userId-scoped — a non-owned provider is indistinguishable from missing, no cross-tenant probe; uses the local DbInstance
  type, NOT AppDatabase — match local convention). MIXED SHAPE (the C113 pattern): 3 sites USE the returned row
  (PATCH/DELETE .domain guard, health createProviderInstance) → keep `const existing = [await ...]`; 2 are existence-check-
  ONLY (backfill, sync) → discard form `await findOwnedProviderOrThrow(...)`. THE GATE EARNED ITS KEEP: biome
  noUnusedVariables flagged the 2 existence-only sites where the `existing` binding was dead — the linter ENFORCED the
  C113 split I'd otherwise have to eyeball. green→green: the C91 13-test providers net + suite stayed green UNCHANGED — 1155
  pass, same as C122 = behavior-preserving. Verified: backend validate:local EXIT 0, build bundled. (The 10 noNonNullAssertion
  warnings in other test files are pre-existing, not from this change.) Next (124): `infra` most-starved over budget (cyc 117,
  starved-for 7 > 6) → #5 sweep next due ~C120 (overdue) or a doc need. cov: be ~81% / fe ~62% (carry)
- **C124 (infra — #5 branch-hygiene sweep [overdue] + the deferred coverage re-measure)** — BALANCE: `infra` most-starved
  over budget (cyc 117, starved-for 7 > 6). Folded both due items in. SWEEP: (1) zero stray untracked unit/spec tests
  (all untracked are the by-design *.meshclaw.e2e.ts set); (2) green baseline — backend validate:local EXIT 0 at C123
  (1155 BE), unchanged since; regress.sh Playwright-blocked; (3) BRANCH_REVIEW.md refresh — header 56→71 commits, status
  1123→1155 BE / 385→395 FE + the C124 coverage, appended §20 (C110–C123: recurring-expenses backend finish [T6/T7], the
  #23/#28 bug fixes, the C113/C119/C123 arch dedups, the C105/C112/C118 coverage ratchet incl. the first FE module, and the
  C120 first-HIGH find), refreshed the reviewer checklist to FOUR Angelo decisions (now leading with #27 the TCO HIGH) +
  the merge footer. RE-MEASURE (loop-improvement #4, deferred since C120): ran bun test --coverage + vitest --coverage —
  **be 81.78% line / 82.17% func** (up from C107's 81.10/81.84 — the C111/C116/C121/C122/C123 backend tests); **fe 62.03%
  line / 60.48% func / 52.47% branch** (up from C107's 61.41 — the C118 memoize + C119 capitalize FE ratchet is creeping
  the needle; still the bigger gap). Updated the COVERAGE TREND header. Doc-only (no code → no build gate, the C100/C110
  sweep pattern); coverage artifacts + BRANCH_REVIEW.md are gitignored. Next (125): nothing forced (guard cyc 118 / bug cyc
  121 breach next) → highest-leverage; FE coverage (the measured gap) or the filed analytics-unit-prefs arch dedup. cov:
  be 81.8% / fe 62.0% (MEASURED C124)
- **C125 (guard — characterize FE vehicle-form-validation.ts 15% → covered; FE ratchet)** — BALANCE: two breached (guard
  cyc 118 starved-for 7, bug cyc 121 starved-for 4); highest-ABSOLUTE → guard (7). The C124 re-measure reconfirmed FE is the
  bigger gap (62.0% vs be 81.8%) with the standing "steer FE guard cycles there"; used the C124 FE coverage report to pick a
  GROUNDED target. SURVEY: navigation.ts (untested) is thin SvelteKit-goto wrappers → SKIP (mock-heavy, coverage theater,
  the C118 vehicle-helpers discipline); the report's lowest pure-logic module was `...validation.ts` 15% line/8% branch →
  vehicle-form-validation.ts (the OTHER one, expense-form-validation, was covered C103). It's the C82 class: two PURE
  validators (validateVehicleFields, validateFinancingFields) that GATE what vehicle/financing data enters the DB, almost
  entirely untested. SHIPPED: vehicle-form-validation.test.ts (+10): make/model required, the year boundary (1900..now+2,
  computed vs `now` → host-independent, sidesteps C77), VIN regex + 11–17 length band, negative mileage/price guards;
  financing own-skip short-circuit, provider/amount/term/startDate/payment required, the LOAN-ONLY APR 0–50 band (a lease
  with a wild apr is NOT flagged), term 1–600 boundary. Verified: frontend validate:local EXIT 0 — 405 pass / 0 fail (+10),
  tsc 0, build OK. FE ratchet continues (3rd FE guard pick: C118 memoize, C119 capitalize-dedup, C125 this). Next (126):
  `bug` most-starved over budget (cyc 121, starved-for 5 > 3) → re-verify the queue; #24 CSV decimal is decision-gated, #27
  Angelo-gated, so a fresh fan-out may be needed (the C103/C90 pattern). cov: be 81.8% / fe ~62%+ (FE +1 module)
- **C126 (deep-review — adversarial audit of the AUTH/session + fuel-efficiency paths; rule-7 fan-out)** — BALANCE: two
  breached (deep-review cyc 120 starved-for 6, bug cyc 121 starved-for 5); highest-ABSOLUTE → deep-review (6) > bug (5),
  correcting the C125 forecast (compute-all-six). Verification cycle; 2 Explore agents on fresh high-risk surfaces with no
  prior dedicated read: auth/session (Lucia validate/refresh/cookie + the guards — SECURITY) + the fuel-efficiency/MPG/
  cost-per-distance math. EVERY finding verified vs source (C67; I pre-read validMilesBetween + buildFuelEfficiencyAndCost +
  the MPG constants myself). AUTH = WELL-HARDENED, no HIGH/MED (consistent with the C56 auth-converged finding): CERTIFIED
  clean — fresh session id on login (no fixation), cookie attrs httpOnly/secure-in-prod/sameSite-Lax, logout + requireAuth
  deleteCookie, expired sessions fail closed via Lucia (no past-expiresAt validate window), refresh creates-before-
  invalidates (crash-safe), optionalAuth never sets user on failure (per-request ctx, no stale carryover), all cross-user
  paths userId-scoped + the link/provider CSRF checks; NO password path so enumeration/timing N/A by construction. FUEL =
  no HIGH; div-by-zero guarded at every site, missed-fillup dropped both sides, first-row excluded (loops start i=1),
  sort-before-pair, convertEfficiency direction correct (no inverse bug). FILED (verified, none HIGH): #30 (MED) the
  efficiency outlier filter is UNIT-UNAWARE — MIN/MAX_VALID_MPG (5/100) + MAX_REASONABLE_MILES_BETWEEN_FILLUPS (1000) are
  imperial constants (the file comment even says "must match frontend") applied to NATIVE stored values PRE-conversion, so a
  metric-storing vehicle's km/L + km gaps get filtered against an MPG/mile window (mis-shaped; aggregate math still right).
  NEEDS SCOPE CONFIRM (does VROOM store metric, or convert-on-write to a canonical unit?) + it's a shared FE/BE invariant —
  not a clean unilateral fix. #31 (LOW-MED) pair ordering is by DATE not odometer — a backdated entry yields a non-positive
  delta that's safely DROPPED (no wrong value), but a legit interval is silently lost. #32 (LOW, auth hygiene ×3): /me +
  /refresh skip deleteCookie on bad session (diverge from requireAuth); a refresh-failure catch can orphan the new session
  (same-user, not a priv issue); OAuth email-collision reveals existence (but only to a caller who already owns the email).
  No code change (rule-7 verification cycle); all → BACKLOG bug queue. Next (127): `bug` most-starved over budget (cyc 121,
  starved-for 6 > 3) → #30 is the most concrete UNBLOCKED-ish, but scope-gated; re-verify + possibly fan out. cov: be 81.8%
  / fe 62.0% (carry)
- **C127 (bug #32a — /me + /refresh now clear the session cookie on a bad-session 401)** — BALANCE: `bug` most-starved over
  budget (cyc 121, starved-for 6 > 3). Re-verified the queue (C89 don't-trust-the-label): #24/#27/#30 are decision/scope-
  gated, but #31 + #32 (filed C126) are UNBLOCKED. Chose #32a over #31 because #31's "fix" (sort pairs by odometer not date)
  is a genuine BEHAVIOR CHANGE (recovers intervals the current code safely drops) + needs null-mileage handling — not a clean
  bug fix; #32a is a small, behavior-ALIGNING, ARCC-grounded hygiene fix with a clear correct answer. SECURITY-TRIGGER →
  queried ARCC FIRST (secure_cookie_handling + secure-token/session-fixation): confirms a dead session cookie should be
  cleared (OWASP session-mgmt) + the existing cookie attrs (Secure/HttpOnly/SameSite=Lax/Path) are policy-correct. THE GAP:
  /me (routes.ts:445) + /refresh (:536) threw 401 on an invalid session but never deleteCookie, diverging from requireAuth +
  logout. FIX: added the canonical deleteCookie (mirroring the logout handler :514 exactly — path/secure/httpOnly/maxAge/
  sameSite) before the 401 throw at both sites. Hygiene, not a vuln (the session is already server-side-invalid, not
  replayable) — but it stops the browser re-sending a known-dead cookie. MERGE-SURVIVING net: extended me-http.test.ts (+3):
  /me + /refresh with a garbage-value session cookie → 401 AND a clearing Set-Cookie (Max-Age=0 / epoch-Expires), + a
  missing-cookie 401 stays plain. THE GATE EARNED ITS KEEP: tsc caught ctx.app.request returning Response|Promise<Response>
  (the Hono union) — fixed by making the helper async. (Biome reflow autofixed.) Verified: backend validate:local EXIT 0 —
  1158 pass / 0 fail (+3), build bundled. #32a CLOSED; #32b (refresh orphan-session) + #32c (email-exists disclosure) + #31
  remain (all LOW/LOW-MED). Next (128): nothing forced (feature cyc 122 / deep-review cyc 126... recompute) → highest-leverage.
  cov: be 81.8% / fe 62.0% (carry)
- **C128 (feature — recurring-expenses T5 gate: shouldTriggerRecurringExpenses, the non-eyes-on decision core)** — BALANCE:
  `feature` most-starved over budget (cyc 122, starved-for 6 > 4). Per the C111/C116/C122 pattern, advanced via the next
  NON-eyes-on slice: T5's spec-defined PURE gate ("unit-test the gate: single-call / skip-when-recent / skip-when-offline").
  GROUNDED (NORTH_STAR #4, avoid the C79 dead-scaffold misfit): the backend seam (POST /reminders/trigger) + the client
  (reminderApi.trigger(), reminder-api.ts:54) BOTH already exist — the only genuine T5 gap is the debounce DECISION the
  app-init hook calls. Added `shouldTriggerRecurringExpenses({isAuthed, isOnline, lastRunMs, now?})` to reminder-helpers.ts
  (the established pure-fn-with-injectable-now home): true only when authed + online + (never-run OR last run on a PRIOR
  LOCAL day); the once-per-day debounce compares local Y/M/D parts (host-independent, sidesteps C77). MERGE-SURVIVING net:
  reminder-helpers.test.ts (+5): never-run→trigger, unauthed/offline→skip, earlier-same-local-day→skip, prior-day→trigger,
  offline-beats-never-run. Verified: frontend validate:local EXIT 0 — 410 pass / 0 fail (+5), tsc 0, build OK. CAVEAT
  (NORTH_STAR #3, honest): this is the DECISION CORE, not T5 done — the eyes-on hook that reads navigator.onLine/auth/
  localStorage + calls trigger() on this gate's `true` is still Playwright-blocked, so T5 stays "logic-complete, eyes-on
  pending". NOTED for a future arch pick: reminder-helpers.ts:45 has the same charAt(0).toUpperCase()+slice(1) idiom C119
  extracted as capitalize() but this file wasn't in C119's 5 sites — a small follow-on dedup (not folded in: arch rule 1,
  + this is a feature cycle). Next (129): nothing forced → highest-leverage. cov: be 81.8% / fe ~62%+ (FE +5 tests)
- **C129 (arch — dedup the unit-prefs resolve tail in analytics/repository.ts; the filed C119 #2)** — BALANCE: `arch` most-
  starved over budget (cyc 123, starved-for 6 > 5). Took the C119-filed #2 (a ready, pre-scouted pick). VERIFIED vs source
  (C69/C75 diff-before-extract): getUserUnits (335) + getVehicleUnits (354) share a BYTE-IDENTICAL 4-line tail (`const row =
  rows[0]; if (!row) return {...DEFAULT}; const parsed = parseUnitPreferences(row.unitPreferences); return parsed ??
  {...DEFAULT}`); they differ only in the query (table/col/where) + the error-message string (left in place). Extracted a
  private `resolveUnitsOrDefault(row)`. CRITICAL EXCLUSION (the C90 inverted-semantics catch): getAllVehicleUnits (373) does
  NOT share it — it THROWS a ValidationError on invalid prefs rather than falling back to default, so folding it in would
  silently swallow a real data error; left untouched + documented why in the helper doc-comment. green→green: the analytics
  unit-prefs suites (analytics-units.property.test.ts etc.) stayed green UNCHANGED — 1158 pass, same as C127 = behavior-
  preserving. Verified: backend validate:local EXIT 0, build bundled. Remaining filed arch picks: MS_PER_DAY literal (C119
  #3, NOT byte-identical — per-site verify); the reminder-helpers.ts:45 capitalize 1-site follow-on (C128). Next (130 —
  milestone): nothing forced (guard cyc 125 / infra cyc 124 breach next) → highest-leverage. cov: be 81.8% / fe 62.0% (carry)
- **C130 (guard — characterize FE formatters.ts relative-time + number/date; the C124-named top FE low spot)** — BALANCE:
  nothing over budget (bug + infra AT); free highest-leverage. The C124 reading named formatters.ts (31% line) as the top FE
  pure-logic low spot, and FE remains the measured gap (62.0% vs be 81.8%) — so the FE ratchet continues (guard breaches next
  anyway). The existing formatters.test.ts covered formatCurrency/getCurrencySymbol/dateOnlyToISO/capitalize but NOT the two
  user-facing relative-time formatters, formatNumber, or formatDate. SHIPPED: +11 tests — formatNumber (default/0/3
  decimals), formatDate ("Mon D, YYYY" + ISO-instant, offset-tolerant), formatRelativeTime (null→Never; Today/Yesterday/
  days/weeks/months/years buckets; + a FUTURE-clamp test pinning the load-bearing Math.max(0,…) guard so a regression can't
  produce a negative bucket), formatCompactRelativeTime (Never; Just-now/m/h/d buckets + future-clamp). HOST-INDEPENDENT
  (the C77 discipline): the time formatters use Date.now()/new Date() internally with no injectable now, so every assertion
  drives them with dates computed RELATIVE to now (Date.now() − N·day), never hardcoded instants. Verified: frontend
  validate:local EXIT 0 — 421 pass / 0 fail (+11), tsc 0, build OK. 4th consecutive FE-advancing pick (C118 memoize, C119
  capitalize, C125 vehicle-validation, C130 formatters). Next (131): nothing forced (infra cyc 124 / bug cyc 127 breach) →
  highest-leverage. cov: be 81.8% / fe ~63%+ (FE +11 tests; re-measure due ~C134 sweep)
- **C131 (infra — CLAUDE.md orientation refresh; the C93/C117 anti-drift class)** — BALANCE: two breached (infra cyc 124
  starved-for 7, bug cyc 127 starved-for 4); highest-ABSOLUTE → infra (7). #5 sweep not due (~C134), coverage re-measured
  C124 → the actionable infra increment was a CLAUDE.md refresh (last C117, 14 cycles ago, real drift since). Fixed THREE
  drifts (verified vs source/LEDGER, the C93 fix-only-real-drift discipline): (1) recurring-expenses bullet — its "Remaining"
  list mis-stated T5/T6 as wholly unstarted, but C122 (T6 read-seam: findBySource + GET /reminders/:id/expenses) + C128 (T5
  pure gate shouldTriggerRecurringExpenses) landed since; rewrote to "EVERY non-eyes-on backend slice T1–T7 built; remaining
  is ALL eyes-on". (2) Coverage — C107 reading (be 81.1/fe 61.4, 1145/385) → the C124 re-measure (be 81.8/82.2, fe 62.0/60.5,
  1158/421) + the FE-is-creeping-up-under-the-ratchet steer (C118/C119/C125/C130) + next FE low spots. (3) Open gaps — added
  recurring-expenses T4–T8 to the eyes-on tail list + a NEW "Pending an Angelo decision" line surfacing #27 (the TCO HIGH) so
  a fresh agent doesn't trip over the headline-money double-count + the other 3 gated decisions. Doc-only (no code → no build
  gate, the C93/C117 pattern). Next (132): nothing forced (bug cyc 127 starved-for 5 next, deep-review cyc 126) →
  highest-leverage. cov: be 81.8% / fe ~63%+ (carry)
- **C132 (deep-review — audit the photo-storage/credential + Sheets-backup-write paths; found 2 more HIGHs)** — BALANCE:
  two breached (deep-review cyc 126 starved-for 6, bug cyc 127 starved-for 5); highest-ABSOLUTE → deep-review (6). Rule-7
  fan-out on 2 fresh high-risk surfaces with no prior dedicated read. EVERY finding verified vs source (C67; I pre-read
  encryption.ts + the Sheets write block myself). PHOTO/CREDENTIAL = CERTIFIED CLEAN on the security core: encryption.ts is
  textbook AES-256-GCM (per-call random IV :39, key from PROVIDER_ENCRYPTION_KEY env :14, auth-tag verified) — agent's
  crypto class clean; secrets never echoed (formatProviderResponse strips credentials, the C91 invariant holds); cross-tenant
  fully scoped (findOwnedProviderOrThrow + validateEntityOwnership + per-op entityType/Id asserts). Photo MEDs filed: #33
  (delete-side external-byte orphans — best-effort provider delete logs+continues, ref already gone → unreconcilable; +
  provider-delete leaves dangling photo rows), #34 (upload not atomic — bytes→row→ref, no txn/compensating delete), #35
  (download response lacks X-Content-Type-Options: nosniff + trusts client-asserted MIME — a stored-content-sniff vector;
  the cleanest one-line fix). SHEETS-WRITE = cross-tenant CLEAN (all 15 queries userId-scoped/owned-parent-joined) +
  round-trip completeness GUARDED (sheets-header-coverage.test pins it, sourceType/sourceId + maintenance fields present),
  but TWO HIGHs VERIFIED: **#36 (HIGH)** valueInputOption:'USER_ENTERED' (:605) + formatValue does NO leading-token
  neutralization (:610-616) → a description "=1+1" is EVALUATED to 2 by Sheets (silent round-trip CORRUPTION) AND
  =IMPORTRANGE/=HYPERLINK formulas execute on open (injection); one-line fix = 'RAW' kills both. **#37 (HIGH)** the per-tab
  clear-then-write (:592→:602) over the single REUSED backup spreadsheet is non-atomic + unversioned → a mid-flight failure
  leaves an empty/half-written tab that DESTROYED the only prior good backup (worse than the ZIP path, which retains copies).
  + #38 (LOW latent): the A:Z 26-col clear range ceiling (reminders at 25 cols — a 27th silently truncates the write range).
  ESCALATED #36/#37 to Angelo (security HIGH + backup-corruption HIGH; the 'RAW' fix is a clean next-bug-cycle candidate w/
  an ARCC consult). No code change (rule-7 verification cycle); all → BACKLOG bug queue. Next (133): `bug` most-starved over
  budget (cyc 127, starved-for 6 > 3) → #35 (the nosniff one-liner) is the cleanest unblocked; #36 'RAW' is bigger but
  security-touching. cov: be 81.8% / fe ~63%+ (carry)
- **C133 (bug #35 — add X-Content-Type-Options: nosniff to the photo-serve response)** — BALANCE: `bug` most-starved over
  budget (cyc 127, starved-for 6 > 3). Picked the C132-filed #35 (cleanest unblocked; #36 'RAW' is the higher-impact HIGH
  but bigger). SECURITY-TRIGGER (serving user-uploaded files / content-type) → queried ARCC FIRST per the skill (before any
  code edit): Secure-HTTP-Headers makes `X-Content-Type-Options: nosniff` a MANDATORY response header "to prevent MIME type
  sniffing"; Secure-File-Uploads + "Securely Serving a File" say "do not trust Content-Type / mitigate MIME sniffing". So
  the fix is policy-required, not just intuition. THE GAP (verified C132 + re-confirmed): the thumbnail serve
  (photos/routes.ts:83-89) set Content-Type from the stored CLIENT-asserted mimeType + CORP:cross-origin but NO nosniff → a
  file whose bytes are HTML/script but declared image/png could be MIME-sniffed + executed. FIX: added
  `'X-Content-Type-Options': 'nosniff'` to the Response headers (+ a comment citing ARCC). MERGE-SURVIVING net: a SOURCE-SCAN
  guard photo-serve-headers.test.ts (+2) — the 200-byte-serve path calls the real provider download() (network, not
  in-harness-testable; the property tests model it), so per the codebase's no-*-source-scan convention I pin the header
  literal in the serve block (header present + in the `new Response(buffer,…)` block alongside the mimeType Content-Type). THE
  GATE EARNED ITS KEEP: my 1st guard draft used a brittle 400-char slice that the added comment pushed the header past → 1
  fail; rewrote to anchor on the block boundary (indexOf '});'). Verified: backend validate:local EXIT 0 — 1160 pass / 0
  fail (+2), build bundled. #35 CLOSED. The bigger photo MEDs (#33 orphans, #34 atomicity) + the Sheets HIGHs (#36/#37,
  Angelo-gated) remain. Next (134 — milestone): nothing forced (feature cyc 128 / deep-review cyc 132 breach); #5 sweep due
  ~C134. cov: be 81.8% / fe ~63%+ (carry)
- **C134 (feature — recurring-expenses: FE client methods for the done T6/T7 backend seams)** — BALANCE: recomputed all six
  from the table — `feature` the ONLY over-budget category (cyc 128, starved-for 6 > 4); the prior forecast under-counted it,
  the table rules (the standing C30/C33/C34 "compute every category each cycle" lesson). So feature is forced over the
  ~C134-due #5 branch-hygiene sweep (infra cyc 131, starved-for 3, NOT over). The feature tails are all eyes-on/Playwright-
  blocked — applied the C128 precedent (when feature is forced + the tail is eyes-on, ship the PURE-LOGIC slice the eyes-on
  shell will consume). FOUND THE SLICE: `reminder-api.ts` (the FE client service) was MISSING methods for the two backend
  seams already built + characterized — T6 `GET /reminders/:id/expenses` (C122) + T7 `GET /reminders/recurring-cost` (C116) —
  even though the eyes-on T6 "materialized N expenses" view + T7 dashboard widget both CONSUME them. So the methods are the
  concrete unblock for that tail. Added `reminderApi.getMaterializedExpenses(id): Promise<Expense[]>` + `getRecurringCost():
  Promise<RecurringCostSummary>` (thin wrappers — apiClient.get already unwraps the {success,data} envelope, grounded vs
  source); added the `RecurringCostSummary` FE type to types/reminder.ts MIRRORING the backend reminder-cost.ts shape
  ({count, monthlyTotal}). All response shapes + the Expense.sourceType/sourceId fields + the {success,data} envelope verified
  against backend source FIRST (C67 discipline). Pinned by `reminder-api.test.ts` (+6, the analytics-api.test.ts mocked-
  apiClient pattern — first reminder-api test): exact path interpolation (guards a wrong-segment typo), the source-link
  survives the wrapper untouched (the T6 badge reads it), empty-array + zero-summary passthrough, and 404/503 propagation (no
  swallowing). THE GATE EARNED ITS KEEP: noUncheckedIndexedAccess flagged `result[0].sourceType` → optional-chained (no
  non-null assertion, which the codebase warns on). Verified: frontend validate:local EXIT 0 — type-check 0, build done, 427
  pass (+6). NON-eyes-on (pure .ts service + type, no markup). REMAINING T6/T7 = only the eyes-on UI (badge/view + dashboard
  widget) that now has its client method to call; T4/T5/T8 still eyes-on. cov: be 81.8% (carry) / fe ~63%+ (carry; +6 FE
  service tests)
- **C135 (arch — route reminder-helpers.ts frequencyLabel through the shared `capitalize`; C128-filed follow-on)** — BALANCE:
  recomputed all six — `arch` the ONLY over-budget category (cyc 129, starved-for 6 > 5; matches the C134 forecast). guard was
  AT budget (cyc 130, starved-for 5 = 6 next cycle), not over → arch wins. Took the C128-filed follow-on (the cleaner of the 2
  ready arch picks; the other, `MS_PER_DAY`, is flagged NOT byte-identical → needs per-site care, deferred per arch rule 1's
  one-small-refactor cap). THE DEDUP: `frequencyLabel` (reminder-helpers.ts:75) hand-rolled `frequency.charAt(0).toUpperCase()
  + frequency.slice(1)` — BYTE-IDENTICAL to the `capitalize(s)` C119 extracted to formatters.ts (:50), but this file wasn't in
  C119's 5 sites. Routed it through the shared helper (1 import + 1 call swap), so the last copy of that idiom in the reminder
  path is now the single source of truth. VERIFIED FIRST (arch rules 2/3): (a) byte-identical — capitalize is exactly
  charAt(0).toUpperCase()+slice(1), no semantic shift; (b) test-anchored — frequencyLabel has a green net
  (reminder-helpers.test.ts:88-111: 'monthly'→'Monthly'/'yearly'→'Yearly'/'weekly'→'Weekly' directly exercise :75), so this is
  a green→green proof; (c) NO circular import — formatters.ts imports only settingsStore (grounded vs source), so
  reminder-helpers→formatters is acyclic (C119 already proved this graph via ReminderForm). green→green: frontend validate:local
  EXIT 0 — type-check 0, build done, 427 pass UNCHANGED (the frequencyLabel tests pass identically = behavior-preserving). Pure
  .ts, no markup/reactivity → no eyes-on. ARCH NEXT PICK: only `MS_PER_DAY` (3 spellings/4 files, NOT byte-identical — per-site
  verify before collapsing) remains filed; else a rule-7 fan-out to repopulate. cov: be 81.8% / fe ~63%+ (carry; no new tests —
  a behavior-preserving refactor under the existing net)
- **C136 (bug #21 — replace-mode + empty-but-valid backup = silent TOTAL data wipe; data-safety)** — BALANCE: recomputed all
  six — NOTHING strictly over budget (my C135 forecast over-stated guard: 6 > 6 is false). So highest-leverage; guard + bug
  both breach at C137. Fed `bug` now (tightest budget by design — "a known defect should never sit"; quality-bar #1 No silent
  loss). Took #21, the ONLY data-safety item queued. VERIFIED THE PREMISE vs source FIRST (C108 discipline): validateBackupData
  (backup.ts:523) checks ONLY metadata + per-row schema + referential integrity — an empty-but-valid backup (every data array
  empty, valid metadata/version — a truncated/corrupt download) passes CLEAN; then a `replace` restore runs deleteUserData
  (wipes everything) then insertBackupData (every `.length > 0` guard false → inserts nothing), committing the empty state
  atomically. REAL, on BOTH paths (restoreFromBackup ZIP + restoreFromSheets). FIX: added private `assertReplaceNotEmpty
  (summary, mode)` — sums all ImportSummary row-counts, throws SyncError(VALIDATION_ERROR) if a `replace` carries 0 total rows;
  preview (read-only) + merge (never deletes) pass through. Wired into BOTH restore methods after the merge-conflict check,
  before the txn (both already build the identical `summary`, so it's one chokepoint). DECIDED-half only — the partial-SHRINK
  threshold (reject a backup implausibly smaller than current) stays #21's filed product-decision half, noted in the helper
  doc. MERGE-SURVIVING net: restore-empty-replace-guard.test.ts (+4, the restore-userid-stamp harness): export a ZIP from the
  still-EMPTY user (valid 0-row backup) → seed a vehicle → replace-restore throws + the vehicle SURVIVES (the load-bearing
  pre-fix-wipe assertion); + preview/merge controls (data untouched) + a non-empty replace still works (guard not over-broad).
  Verified: backend validate:local EXIT 0 — 1164 pass / 0 fail (+4), tsc 0, musl-biome clean, build bundled. #21 CLOSED
  (shrink-threshold half remains filed). cov: be 81.8% (carry; +4 BE) / fe ~63%+ (carry)
- **C137 (guard — coverage-ratchet error-handling.ts, the C124 top FE low spot)** — BALANCE: recomputed all six — `guard` the
  ONLY over-budget category (cyc 130, starved-for 7 > 6; matches the C136 forecast). It wins the tie over infra's at-budget #5
  sweep (starved-for 6 = budget, breaches 138) on raw starved-for. Took the C83 coverage-ratchet angle steered at the C124
  report's top FE low spot: `error-handling.ts` (34% line) — LOAD-BEARING (every page's catch routes through
  `handleErrorWithNotification` → the private `handleApiError`, the user-facing error copy), high-risk pure logic (not
  passthrough theater). `extractErrorMessage` was already pinned (C90); the uncovered 34% was the `ApiError` class + the 3-way
  handleApiError branch (VroomError→friendly-or-own / network-TypeError / unknown-fallback) + the error-code→friendly map +
  the notification side-effect. Added `error-handling.test.ts` (+8): drove the FULL branch matrix through the EXPORTED
  handleErrorWithNotification (mocking `$lib/stores/app.svelte` + spying addNotification — the analytics-api.test.ts pattern —
  so the assertions check the message the USER would see), + ApiError class (default code API_ERROR / backend-code override /
  details), + the context-prefix path. KEY behavioral pins: a KNOWN code shows the friendly copy NOT the raw backend text;
  an UNMAPPED code falls back to the error's own message; a non-Error throw → the generic 'unexpected error' copy. THE GATE
  earned its keep: noUncheckedIndexedAccess flagged `mock.calls[0][0]` → routed through a typed `notified()` helper with a
  defined-check (no non-null assertion, which the codebase warns on). Verified: frontend validate:local EXIT 0 — type-check 0,
  build done, 435 pass (+8). (A scoped per-file coverage re-measure was declined; the module is now well-covered by
  construction — the full handleApiError matrix + map + class + side-effect — and the C124 whole-suite reading stays the cov:
  anchor.) NEXT FE low spots (C124): api-client.ts/expense-api.ts (mock-heavier) + the components/routes deficit. cov: be
  81.8% (carry) / fe ~63%+ (carry; +8 FE — error-handling.ts 34%→well-covered, not whole-suite-re-measured)
- **C138 (infra — #5 branch-hygiene sweep, overdue; + the due coverage re-measure)** — BALANCE: recomputed all six — TWO over
  budget (infra cyc 131 starved-for 7 > 6; deep-review cyc 132 starved-for 6 > 5); most-starved wins → `infra` (7) > dr (6).
  Matches the C137 forecast. This is the loop-improvement #5 sweep (last C124, branch now git-authoritative 85 commits off
  origin/main — my per-cycle running tally had drifted ~1, the sweep corrects to git truth). THREE STEPS: (1) untracked-stray
  check — zero stray tracked-worthy files; every untracked entry is the by-design `*.meshclaw.e2e.ts` set + e2e screenshots/
  results + the Playwright config + known-gitignored dirs (.kiro/specs/offline-entries, .meshclaw-tools, mise.local.toml). No
  unit/spec .test.ts stranded outside VCS (which would silently drop coverage on merge). (2) GREEN BASELINE + the DUE coverage
  re-measure (loop-improvement #4, last real reading C124): backend bun test --coverage EXIT 0 (1164 pass / 0 fail / 1 skip),
  frontend vitest --coverage EXIT 0 (435 pass). RESULT: be 82.25% line / 81.81% func (up from C124's 81.78/82.17 — line
  creeping up via the C136 restore guard + accumulated tests; func ~flat as product grew); FE 65.32% line / 61.76% func /
  58.70% branch (UP +3.3 line / +6.2 branch from C124's 62.03/60.48/52.47 — the C125 vehicle-form + C130 formatters + C134
  reminder-api + C137 error-handling ratchet arc DELIVERED; FE still the bigger gap but closing). regress.sh Playwright-blocked
  (unchanged). Updated the COVERAGE TREND header with the C138 reading. (3) BRANCH_REVIEW.md refresh (gitignored): header
  71→85 commits + status to 1164 BE / 435 FE + the C138 coverage; appended §21 (C124–C137: #21 data-safety wipe-guard + #35/
  #32a security hygiene + #36/#37 two more Sheets HIGHs found + recurring-expenses FE client seams + 2 arch dedups + the FE
  ratchet arc); refreshed the reviewer checklist (now THREE HIGHs gated: #27 + #36 + #37, plus #21-shrink) + the merge footer.
  Doc/measurement-only — no product code; the green baseline IS the verification. Next sweep ~C148. cov: be 82.25% / fe 65.32%
  (both freshly re-measured C138)
- **C139 (deep-review → bug #39 — expense-list endDate boundary drops same-day rows)** — BALANCE: TWO over budget (deep-review
  cyc 132 starved-for 7 > 5; feature cyc 134 starved-for 5 > 4); most-starved wins → `deep-review` (7) > feature (5). Matches
  the C138 forecast. Named dr items all eyes-on/sign-off-blocked → fresh backend-correctness fan-out (the C108/C114/C120/C126/
  C132 pattern) on 2 un-audited high-value veins: (A) dashboard headline math (getQuickStats / fleetHealthScore / scorers),
  (B) the expense-list query path (filter/sort/pagination — the most-used page). 2 Explore agents; VERIFIED every finding vs
  source (C67 — agents pointed analytics-charts at the wrong dir + I confirmed paths myself). RESULTS:
  • Agent A (headline math): the fleetHealthScore/getQuickStats/getVehicleHealth core CERTIFIED CLEAN (weights 0.4+0.35+0.25=1.0,
    divisor gated >0, avgEfficiency null-on-empty, normalizeScore clamps + max===min→50 guard, both scorers bounded). 1 real
    MED — buildVehicleRadar ranks a vehicle with MISSING data (initialized 0) as an EXTREME (a never-serviced car → reliability
    100; no fuel pairs → efficiency 0). VERIFIED real, but it's a relative-comparison-radar DISPLAY semantics call (how to render
    "no data") on a secondary surface → FILED #40, needs a product decision (not a mechanical fix).
  • Agent B (expense query): 2 real findings + verified CLEAN the classic traps (count-vs-list share baseWhere; hasMore/limit/
    offset math; sortBy enum-allowlisted → no injection/DoS; tags AND; list==export). FIXED the higher-value one THIS cycle
    (bugs jump the queue): #39 — `buildExpenseConditions` endDate used `lte(date, endDate)`, but the UI DatePicker sends a
    date-only YYYY-MM-DD → z.coerce.date() → LOCAL midnight (START of day), so a "through Mar 31" filter DROPPED every Mar-31
    expense not at exactly midnight (the C6/C61/C103 local-vs-UTC class; VERIFIED the FE sends date-only by reading the picker
    binding). FIX: extracted `endOfDayIfDateOnly(d)` — a LOCAL-midnight value extends to 23:59:59.999 local (inclusive whole
    day); a deliberate mid-day timestamp honored verbatim. host-independent (local Y/M/D, sidesteps C77). One chokepoint fixes
    BOTH list + CSV export (preserves list==export). The OTHER finding — search doesn't escape LIKE `%`/`_` (a search for "50%"
    over-matches) — FILED #41 (real, lower-value: over-matching not data-loss; parameterized so no injection). MERGE-SURVIVING
    net: date-range-boundary.test.ts (+5, the search-paginated harness): afternoon-on-endDate INCLUDED (the regression), last-ms
    boundary in / next-day-midnight out, startDate lower bound unaffected, non-midnight endDate honored verbatim, findAll/export
    shares it. Verified: backend validate:local EXIT 0 — 1169 pass / 0 fail (+5), tsc 0, musl-biome clean (autofix reflowed the
    test's long lines — the C33 whole-tree class), build bundled. cov: be 82.25% (carry; +5 BE) / fe 65.32% (carry)
- **C140 (feature — import-trackers T4/T5 FE client slice: mapping-aware import + detectSource)** — BALANCE: `feature` the ONLY
  over-budget category (cyc 134, starved-for 6 > 4; matches the C139 forecast). The feature tails are all eyes-on/Playwright-
  blocked → applied the C128/C134 precedent: ship the PURE-LOGIC slice the eyes-on shell consumes. FOUND the C134-class gap: the
  import-trackers T3 backend (C70) added a `mapping` param to POST /import + a POST /import/detect endpoint, but the FE client
  `importExpensesCsv` only sent `{csv, dryRun}` (no mapping) and had NO detect method — yet the eyes-on T4/T5 mapping dialog
  CONSUMES both. So this is the concrete unblock for that tail. Added: (1) `src/lib/types/import-mapping.ts` (new domain file +
  barrel export) — `ImportColumnMapping` / `ImportMappingPreset` / `NativeImportField` / `ImportDateFormat` / `ImportPresetId`,
  MIRRORING the backend `ColumnMapping` / `MappingPreset` / `columnMappingSchema` exactly (grounded vs source C67 — every field,
  unit type, dateFormat enum verified); (2) extended `importExpensesCsv(csv, dryRun, mapping?)` — backward-compat: the native
  path omits the mapping key so its request is BYTE-IDENTICAL to before (only spreads `{mapping}` when provided); (3) added
  `detectImportSource(headers): Promise<ImportMappingPreset|null>`; (4) extended `ExpenseImportResult` with the foreign-only
  `duplicates?`/`unmappedCategories?` the route returns. Pinned by expense-import-mapping.test.ts (+5, the mocked-apiClient
  pattern): native path sends ONLY {csv,dryRun} (the load-bearing backward-compat — explicit `'mapping' in body === false`),
  dryRun defaults false, foreign path threads the mapping verbatim + surfaces unmappedCategories, detect posts only headers +
  passes preset/null through. THE GATE earned its keep: ExpenseImportResult is exported from expense-api.ts (not the types
  barrel) — tsc caught my wrong-source import → split the type-only import. Verified: frontend validate:local EXIT 0 —
  type-check 0, build done, 440 pass (+5). NON-eyes-on (pure .ts service + types, no markup). REMAINING import-trackers = only
  the eyes-on T4/T5 mapping-dialog markup (now has its detect + mapping-aware client methods to call) + T6 e2e. cov: be 82.25%
  (carry) / fe 65.32% (carry; +5 FE service tests)
- **C141 (arch — extract `validateVehicleIdsOwned`: the plural multi-vehicle ownership check, 2 sites → 1)** — BALANCE: `arch`
  the ONLY over-budget category (cyc 135, starved-for 6 > 5; matches the C140 forecast). The lone filed pick (`MS_PER_DAY`) is
  flagged NOT byte-identical — I grounded it FIRST (grep): ~20+ sites across BE+FE in 3 spellings AND divergent semantics (pure
  day-divisor vs a 30-day-MONTH approximation), collapsing it = the sweeping multi-file rewrite arch rule 1 forbids + C99
  already rejected the FE half as churn. So per the BACKLOG fallback, ran a rule-7 fan-out (2 Explore agents, BE + FE
  duplication). Backend agent's #1 was the clean pick: the PLURAL "owned-id Set → filter invalid → ValidationError listing the
  bad ids" block, hand-repeated at reminders/routes.ts create (:148-153) + update (:234-241). VERIFIED BYTE-IDENTICAL FIRSTHAND
  (the C24/C30/C90 lesson — read both sites): same findByUserId→Set→filter(!has)→ValidationError with the IDENTICAL error
  string; only the cosmetic param name (id/vid) + input array differ (both → the helper's param). GENUINELY DISTINCT from the
  excluded single-vehicle `validateVehicleOwnership` (that's findByUserIdAndId→Vehicle, throws NotFoundError; this is the plural
  set-membership→ValidationError-list — different query, different error contract). Extracted `validateVehicleIdsOwned(vehicleIds,
  userId): Promise<void>` into utils/validation.ts beside its single-vehicle sibling (vehicleRepository + ValidationError
  already imported there — no new deps). Both sites collapsed to a 1-line call. The C123 dead-import situation recurred: both
  `vehicleRepository` + `ValidationError` became unused in reminders/routes.ts after the swap (biome noUnusedVariables would
  fail) → removed both imports. ARCH RULE 3 (test-anchor both ways): create-path throw was already covered
  (reminders-http.test.ts:105 foreign vehicle → 4xx); the UPDATE path (Site B) was NOT → ADDED a PUT-foreign-vehicleId-rejected
  test (+1) before relying on the convergence (also makes the dedup merge-surviving). green→green: backend validate:local EXIT 0
  — 1170 pass / 0 fail (+1), tsc 0, musl-biome clean, build bundled (the create-path test stayed green = Site A behavior
  preserved; the new test pins Site B). ARCH QUEUE now empty of clean picks (MS_PER_DAY stays filed as too-sprawling); next arch
  fires another rule-7 fan-out. cov: be 82.25% (carry; +1 BE) / fe 65.32% (carry)
  - *(C141.5 docs commit `6c5f930`: filed the C141 FE fan-out's surfaced `roundToCents` candidate (8 byte-identical FE sites)
    as the primed next-arch pick so it survives summarization — loop bookkeeping, no category touched.)*
- **C142 (bug #41 — escape LIKE wildcards in expense search)** — BALANCE: nothing strictly over budget; `guard` + `bug` both
  breach at C143. Highest-leverage among clean/decided options = the C139-filed #41 (it feeds the at-budget `bug`, tightest
  budget by design, and was already grounded firsthand). SCOPE-CHECKED FIRST (grep): the ONLY user-input LIKE in product source
  is the single expenses search site (repository.ts:110) — the 2 other LIKEs are test files with hardcoded literal patterns, no
  user input → #41 is a single-site fix, NOT a class. THE BUG: `buildExpenseConditions` built `%${search.toLowerCase()}%` with
  no ESCAPE clause, so a search for "50%" → `%50%%` matched every row containing "50" (`%` = any chars), and "oil_change"
  matched "oilXchange" (`_` = any one char). Parameterized (no injection) + user-scoped (only over-matches the user's own rows)
  → over-matching search UX, not data-loss/security. FIX: escape `\` `%` `_` in the term (regex `/[\\%_]/g` → `\$&`; backslash
  FIRST so the just-added escapes aren't double-escaped) + append `ESCAPE '\\'` to BOTH LIKEs so the escaped chars match
  literally. MERGE-SURVIVING net: extended search-paginated.test.ts (+5, the file explicitly noted "no metacharacter case"):
  literal "50%" matches only the "50%" row not "...50..." (the regression), "_" literal not any-char, a BARE "%" no longer
  matches every row, a backslash matches literally (escape-char not double-applied), and a normal metachar-free search still
  substring-matches. Verified: backend validate:local EXIT 0 — 1175 pass / 0 fail (+5), tsc 0, musl-biome clean, build bundled.
  #41 CLOSED. cov: be 82.25% (carry; +5 BE) / fe 65.32% (carry)
- **C143 (guard — coverage-ratchet api-client.ts, the C124 FE low spot)** — BALANCE: nothing strictly over budget (C142 forecast
  over-stated guard: 6 > 6 false); `guard` breaches next cycle (C144). Took the standing FE coverage-ratchet (the measured bigger
  gap) at the C124-named next low spot: `api-client.ts` — THE most load-bearing FE module (every API call routes through
  `request`/`requestFull`). The 3 sibling service tests all `vi.mock('../api-client')`, so its real internals were NEVER
  exercised (hence the low C124 reading). Added api-client.test.ts (+17): stubs global.fetch (the auth.test.ts pattern) +
  vi.mock('$env/dynamic/public') and drives the REAL apiClient methods, covering: the {success,data} envelope unwrap INCL. the
  load-bearing `data: 0` falsy-but-present edge (uses `!== undefined`, not truthiness) + the no-data-field passthrough; the
  non-JSON/204 return-Response-as-is path; ALL 3 error-message branches (nested error.message / top-level errorBody.message /
  status fallback when the body isn't JSON) + array-details→{validationErrors}; method+credentials+Content-Type header gating
  INCL. the FormData skip (must NOT set Content-Type, must not stringify); getPaginated's full-envelope (NO unwrap) + its error
  path; withPagination (limit+offset / offset=0-included / bare-url). THE GATE earned its keep: tsc flagged 7 `err is unknown`
  errors from a `.catch((e) => e as ApiError)` cast that didn't narrow → extracted a typed `captureError(promise)` helper (no
  non-null/any). Verified: frontend validate:local EXIT 0 — type-check 0, build done, 457 pass (+17). NEXT FE low spot (C124):
  expense-api.ts (mock-heavier) + the components/routes deficit. cov: be 82.25% (carry) / fe 65.32%+ (carry; +17 FE —
  api-client.ts low→well-covered, not whole-suite-re-measured)
- **C144 (deep-review → bug #42 — backup stamps lastSyncDate end-of-run, silently drops a mid-run data change)** — BALANCE:
  nothing strictly over budget; feature/deep-review/infra tied at-budget (all breach C145). Highest-leverage = deep-review (its
  fan-outs keep surfacing real defects a screenshot misses — #39/#41 last round). Named dr items eyes-on/sign-off-blocked → a
  fresh backend-correctness fan-out (2 Explore agents) on un-swept veins: (A) backup ORCHESTRATION/scheduling (not content), (B)
  vehicle-stats + odometer. VERIFIED every finding vs source FIRST (C67 — I pre-read both surfaces + confirmed the load-bearing
  claims firsthand). RESULTS:
  • Agent A: certified-clean the scary concurrency paths (mutex check-then-act is await-free → atomic; released in finally; TTL
    self-heal; Promise.allSettled isolates per-provider failure; withTimeout caps hangs) — matched my pre-read. 2 HIGH +2 lower.
    FIXED the verified, clean, data-safety one (#42): `updateSyncDate` set `lastSyncDate = new Date()` (END of run), but the ZIP
    snapshots the DB near the START; a long run (BACKUP timeout 10min) means an edit made AFTER the snapshot but BEFORE the
    end-stamp gets `lastDataChangeDate < lastSyncDate` → `hasChangesSinceLastSync` false → SILENTLY dropped from all future
    backups (NORTH_STAR #1). Traced the full chain in source (repository.ts:118 compare, :130 stamp; orchestrator:44 timestamp,
    :85 snapshot, :196 stamp). FIX: `updateSyncDate(userId, syncedAt = new Date())` + orchestrator passes its START `timestamp`
    (slightly before the L85 snapshot → errs SAFE: at worst a redundant re-backup, never a lost change). The other 3 agent-A
    findings are DECISIONS, not clean fixes → filed: #43 (ZIP-fail-but-Sheets-ok marked success → false-success + skip-retry),
    #44 (route returns 200 "Sync completed" when ALL providers fail), + a LOW activity-tracker clobber.
  • Agent B (vehicle-stats/odometer): certified getCurrentOdometer CLEAN (vehicle-scoped UNION, null-safe MAX, unit-consistent
    per-vehicle — matched my pre-read). 4 findings, NONE a clean unilateral fix: Finding 1 (HIGH — totalMileage/costPerMile mix
    a period-FILTERED numerator with an all-time initialMileage denominator → wrong for 4/5 period options) is REAL + VERIFIED
    (route passes filtered fuelExpenses + unfiltered vehicle.initialMileage) but it's the SAME semantics family as the
    already-filed Angelo-gated period-scoped currentMileage / "Current Mileage card" decision → filed #45 GROUPED with it; +
    #46 (negative totalMileage when a reading < initialMileage), #47 (MAX-by-value lets one typo'd 999999 reading poison the
    reminder axis until corrected — pinned-as-design), #48 (getCurrentOdometer not userId-scoped — LOW hardening, no live leak).
  MERGE-SURVIVING net for #42: +3 in settings-repository.property.test.ts — a mid-run edit stamped against SNAPSHOT-time still
  reports unsynced (the regression) + a negative control (end-of-run stamp loses it, proving the param matters) + exact-timestamp
  persist + the now-default backward-compat. Verified: backend validate:local EXIT 0 — 1178 pass / 0 fail (+3), tsc 0,
  musl-biome clean, build bundled. #42 CLOSED. cov: be 82.25% (carry; +3 BE) / fe 65.32% (carry)
  - *(C144.5 docs commit `db9ba28`: the security-assistance skill fired on the delayed a675163e event [user-data backup +
    credential-decryption domain] → queried ARCC FIRST per the mandatory flow; SAX-04 Outcome 1 [FailureModes.systemError →
    FAIL_SAFE; "failing open" = #1 pitfall] + Outcome 3 [alert on backup failure] directly confirm #43/#44 are fail-open
    defects. Recorded the policy grounding on both filed items — fix stays Angelo-gated. No category touched.)*
- **C145 (infra — CLAUDE.md orientation refresh; the C117/C131 anti-drift class)** — BALANCE: TWO over budget (infra cyc 138
  starved-for 7 > 6; feature cyc 140 starved-for 5 > 4); most-starved wins → `infra` (7) > feature (5). Matches the C144 forecast.
  The infra cadence: CLAUDE.md refresh was due ~C145 (per the C131 note); the #5 sweep was just C138 (next ~C148). Fixed 5
  drifts a fresh agent would mis-orient on, each VERIFIED vs source/LEDGER (no churn — the C117/C131 discipline): (1)
  import-trackers "frontend not started" → the FE client slice shipped C140 (types + mapping-aware importExpensesCsv +
  detectImportSource); (2) recurring-expenses "frontend not started" → the T6/T7 FE client methods shipped C134; (3) coverage
  line cited the stale C124 reading (81.8/62.0) + named error-handling/api-client as "next low spots" — but C138 re-measured
  (82.25/65.32) and C137/C143 CLOSED both named targets → updated figures + re-pointed next-low-spot to expense-api.ts +
  components/routes; (4) suite size ~1158/~421 → 1178/457; (5) Pending-Angelo line listed only #27 + lease/loan/#19/#24 — added
  the #36/#37 Sheets HIGHs, the new #43/#44 backup-honesty pair (with the C144.5 ARCC grounding), + #45/#21-shrink. Doc-only
  (verified every claim against the loop files); no build gate needed (the C5/C26/C47/C72/C93/C117/C131 convention). Next
  CLAUDE.md refresh ~C160; #5 sweep ~C148. cov: be 82.25% / fe 65.32% (carry — doc-only cycle)
- **C146 (feature → SPEC — float→integer-cents money migration; the NORTH_STAR horizon item)** — BALANCE: `feature` the ONLY
  over-budget category (cyc 140, starved-for 6 > 4; matches the C144/C145 forecast). ALL three in-flight features are now at
  eyes-on-ONLY tails (every non-eyes-on slice — backend + FE client wrappers + gates — exhausted by C128/C134/C140), so
  manufacturing another marginal pure-logic slice = churn. The legitimate non-eyes-on feature increment is the SPEC-FIRST phase:
  drafted the NORTH_STAR-listed float→cents money migration — the ONE horizon feature buildable WITHOUT Playwright (a backend
  money-type migration is fully verifiable via validate:local), so it breaks the loop's eyes-on logjam. Per arch rule 6 a
  money-type migration is a DIRECTION call → spec + escalate, build-gated on T0. GROUNDED via a 2-agent scoping fan-out +
  firsthand reads (no assumptions): money is `real` (float) across 14 columns / 6 tables (confirmed complete, apr/volume
  excluded); migrations run from ./drizzle wrapped in one txn (connection.ts:84) + an idempotent runDataMigration precedent;
  split-service ALREADY round-trips through cents internally (Math.round(*100)→/100 at :34/58/60) then stores float — the code
  already wants cents. THE load-bearing finding (verified vs source): an OLD float-dollars backup restored into a cents schema
  is SILENTLY corrupted 100× — coerceRow routes `12.34` through parseInt → 12 cents ($0.12) — and validateBackupData only
  compares an unchanged version string `'1.0.0'`, so it passes into corruption (NORTH_STAR #1). Mitigation in the spec: bump
  CONFIG.backup.currentVersion → '2.0.0' (fail-closed) + a version-gated ×100 coercion shim on a money-column allowlist (recovery
  path) — aligns with the C144.5 ARCC SAX-04 fail-closed posture. Wrote .kiro/specs/money-cents-migration/{requirements,design,
  tasks}.md (D1–D5 open: scope/export-rep/old-backup/migration-shape/rollout; T0 sign-off gate → T1 schema+migration+test, T2
  backup-version+shim+roundtrip [the data-safety core], T3 input-edge cents transform, T4 repo/analytics math, T5 split-native-
  cents, T6 display-edge at the API boundary [keeps the FE dollar contract → NO eyes-on], T7 green sweep). Migration is LOW-risk
  (in-place UPDATE ROUND(*100), no rebuild/no FK-cascade — the 0003 class, NOT the 0004 footgun). ESCALATING to Angelo
  (non-blocking). Spec-only — no code, no build gate (the C4/C9 spec-cycle convention). cov: be 82.25% / fe 65.32% (carry)
- **C147 (arch — create the backend `extractErrorMessage` seam, wire the 3 value-capture sites)** — BALANCE: `arch` the ONLY
  over-budget category (cyc 141, starved-for 6 > 5; matches the C146 forecast). DUE-DILIGENCE on the primed pick FIRST (grounded
  every site, the C141/C69/C90 verify-before-extract discipline): the C141-filed `roundToCents` is NOT a clean pick now — its
  only pure-`.ts` site is financing-calculations.ts:456; the other ~7 are `.svelte` (eyes-on-BLOCKED here) AND several round
  MONEY (SplitConfigEditor/ExpensesTable/VehicleForm) that the pending cents-migration T5/T6 will rework → extracting now =
  churn or unverifiable. The C141 #2 ytdSpending reduce also COLLIDES with cents-migration T4. So I hunted a pure-`.ts`,
  verifiable, migration-INDEPENDENT dedup: the `error instanceof Error ? error.message : String(error)` idiom is hand-rolled
  ~60× across the backend with NO canonical helper (the FE has one — C90 extractErrorMessage — the BE doesn't). Converting all 60
  is too big (arch rule 1) + most are `logger.error({error:…})` structured-log sites (a distinct idiom, not value-extraction).
  So scoped to the CLEAN subset: created `utils/error-handling.ts` `extractErrorMessage(error)` (the missing canonical seam,
  mirroring FE C90) + wired the 3 VALUE-capture sites (connection.ts:91 migration-fail message, index.ts:23 startup, sync-
  worker.ts:261 photoRef errorMessage column) — all byte-identical, all where the message is captured as a value not logged.
  The txn-fail site (connection.ts:74) stays inline — its fallback is `'Unknown error'` not `String(error)`, NOT byte-identical
  (the C90 inverted-semantics discipline). Net payoff: creates the one-source-of-truth the backend lacked + a convergence target
  the ~57 logging sites can adopt incrementally; removes 3 hand-rolls. Pinned by error-handling.test.ts (+4: Error→message,
  subclass, empty-message-branches-on-type, non-Error→String() incl. null/undefined/object). green→green: backend validate:local
  EXIT 0 — 1182 pass / 0 fail (+4), tsc 0, musl-biome clean, build bundled (the 3 wired sites behavior-identical = full suite
  unchanged). roundToCents RE-FILED with the eyes-on caveat. cov: be 82.25% (carry; +4 BE) / fe 65.32% (carry)
- **C148 (bug #46 — clamp negative totalMileage in vehicle-stats)** — BALANCE: `bug` the ONLY over-budget category (cyc 144,
  starved-for 4 > 3; matches the C147 forecast). The #5 sweep is ~due but infra isn't over budget → the rule forces bug. Triaged
  the queue: most items are Angelo-gated (#36/#37/#43/#44/#45) or design-calls (#47); the cleanest VERIFIED, UNBLOCKED one is #46
  (a C144-filed finding). THE BUG: `calculateMileageStats` (vehicle-stats.ts:138) did `totalMileage = latestMileage -
  initialMileage` with no floor — a backdated/mistyped reading BELOW initialMileage (or the only in-window reading < the purchase
  odometer) surfaced a NEGATIVE distance to the client verbatim (e.g. 45000 − 50000 = −5000 mi). KEY: this is INDEPENDENT of the
  gated #45 period-semantics question — a driven distance is non-negative under ANY windowing decision, so the fix won't churn
  when #45 lands. FIX: `Math.max(0, latestMileage - initialMileage)`. The costPerMile guard (`> 0`) already protected cost/mile;
  this clamps the distance itself. MERGE-SURVIVING net: +3 in vehicle-stats.property.test.ts (below-initialMileage → 0 not −5000
  [the regression] + currentMileage still surfaced + costPerMile null; normal above-initial still computes the real positive
  distance; exact-boundary → 0). Verified: backend validate:local EXIT 0 — 1185 pass / 0 fail (+3), tsc 0, musl-biome clean,
  build bundled. #46 CLOSED. cov: be 82.25% (carry; +3 BE) / fe 65.32% (carry)
- **C149 (guard — coverage-ratchet expense-api.ts, the C124 FE low spot)** — BALANCE: nothing strictly over budget; `guard` +
  `deep-review` tied at-budget (both breach C150). Took `guard` (highest-leverage: the FE coverage ratchet is the standing
  measured priority; the dr fan-out was just C144 + the bug queue is already gate-saturated so more findings wouldn't help).
  C124-named next FE low spot: `expense-api.ts`. `buildExpenseQuery` was already pinned (build-expense-query.test.ts) so the
  uncovered LAYER is the method→endpoint wiring + the backend↔frontend TRANSFORM those methods drive. Added expense-api.test.ts
  (+13, the api-client/reminder-api mocked-apiClient pattern): getExpense maps expenseAmount→amount + volume→volume(gas)/
  charge(electric)-by-fuelType; getAllExpenses/getExpensesByVehicle drive getPaginated + per-row transform + pagination
  passthrough + vehicleId-in-query; createExpense maps amount→expenseAmount + OMITS an empty description (create payload
  unchanged); updateExpense sends an emptied description as NULL (the clear-field bug-class this repo fixed); downloadExpensesCsv
  throws on non-ok + on success fetches the export URL with filters (tags comma-joined) → blob → clicks a download anchor (stubbed
  the jsdom-absent URL.createObjectURL + the anchor click); split create/delete + deleteExpense endpoint wiring. Verified:
  frontend validate:local EXIT 0 — type-check 0, build done, 470 pass (+13). NEXT FE low spot (C124): the components/routes
  deficit (the remaining gap now that error-handling/api-client/expense-api services are covered). cov: be 82.25% (carry) / fe
  65.32%+ (carry; +13 FE — expense-api.ts service layer low→well-covered, not whole-suite-re-measured)
- **C150 (deep-review → bug #50 — deterministic insurance latest-term tiebreak; + DEBUNKED a false-positive HIGH)** — BALANCE:
  `deep-review` the ONLY over-budget category (cyc 144, starved-for 6 > 5; matches the C149 forecast). #5 sweep overdue but infra
  not over → dr forced, sweep takes C151. Named dr items eyes-on/sign-off-blocked → fresh backend-correctness fan-out (2 Explore
  agents): (A) reminder recurrence date-advance, (B) insurance multi-term attribution. PRE-READ both surfaces myself (C67) — and
  the pre-read ALREADY debunked a hypothesis: anchor-DRIFT in computeNextDueDate is impossible because all 3 call sites thread
  the STABLE `getAnchorDay(reminder)=startDate.getDate()` (not the clamped current day). THE KEY OUTCOME (the verify-discipline
  paying off): agent B's headline MED Finding 1 (a null-endDate ongoing term sorts LAST → wrong premium) is a FALSE POSITIVE —
  insuranceTerms.endDate is `.notNull()` in schema.ts:129, so a null endDate CANNOT exist; the `instanceof Date ? … : 0` branch
  is defensive DEAD code, never reachable. Caught it firsthand (the test couldn't even seed it — NOT NULL constraint rejected the
  insert) + confirmed against the schema → REVERTED the null→Infinity churn (don't fix an impossible state, the C21/C77 vacuity
  rule). KEPT the one GENUINELY-real finding (agent B Finding 2, #50): two terms sharing an endDate had a DB-row-order-dependent
  (nondeterministic) latest-term pick — the term query has no ORDER BY + the comparator returned 0 on a tie. FIX: tiebreak by
  the later startDate (the more-current term). Agent B also verified CLEAN: per-vehicle div-by-zero guard, effectiveMonthlyPremium
  precedence, inactive-policy exclusion, costByCarrier cross-policy dedup, overlapping-month accumulation. MERGE-SURVIVING net:
  +1 in insurance-details.test.ts (equal-endDate → the later-starting term's premium wins, deterministically). green→green:
  backend validate:local EXIT 0 — 1187 pass / 0 fail (+1), tsc 0, musl-biome clean, build bundled (existing latest-term tests
  unchanged = behavior-preserving for the common single-/distinct-endDate path). Agent A (reminders) findings pending its delayed
  completion event → will triage/file then. Filed agent-B LOW #51 (active-policy-with-no-terms inflates activePoliciesCount while
  contributing $0). cov: be 82.25% (carry; +1 BE) / fe 65.32% (carry)
- **C151 (feature → recurring-expenses ENGINE hardening: complete bug #13, the catch-up dupe-flood — root-caused a leaked
  dupe + Angelo APPROVED #27 + lease/loan)** — BALANCE: `feature` the only over-budget category (cyc 146, starved-for 5 > 4).
  In-flight features all at eyes-on tails + money-cents gated → the buildable feature increment is the recurring-expenses
  engine itself (its materialization is backend). Triaged the C150 reminders agent (A, `3e21c241`): its Finding 1 is a REAL
  incomplete-fix gap in bug #13 — the C29 hardening guarded `advanceCustom` (bad unit) + `fastForwardPastNow` (backstop) but
  left TWO reachable holes in the MAIN catch-up loop: (a) a corrupt top-level `frequency` ('monthy') hits `computeNextDueDate`'s
  switch with NO `default` → returns the date UNCHANGED; (b) `intervalValue=0` (`?? 1` doesn't replace 0) → custom advance
  no-ops. Either way `while (nextDue <= now)` re-fires, materializing up to `maxCatchUp`=12 DUPLICATE expense rows (wrong money,
  NORTH_STAR #1) before the backstop. VERIFIED both holes firsthand (C67). FIX, two layers: (1) ROOT-CAUSE throws — `default:
  throw` in computeNextDueDate's frequency switch + `intervalValue <= 0` throw in advanceCustom (both mirror #13's bad-unit
  throw; land in processReminder's per-reminder try/catch as a clean `skipped`). (2) THE NON-OBVIOUS BUG the regression test
  caught: my first cut threw AFTER createExpenseFromReminder inside the transaction, ASSUMING the throw rolls back the insert —
  it does NOT. better-sqlite3 runs the INSERT synchronously and does not roll it back when a throw escapes the ASYNC transaction
  callback, so 1 dupe still persisted (test asserted 0, got 1). FIX: hoist the pure `computeNextDueDate` call ABOVE the insert in
  BOTH processExpensePeriod + processNotificationPeriod → a corrupt reminder throws before ANY row is written. ZERO dupes,
  guaranteed, independent of rollback semantics. MERGE-SURVIVING net: +3 in trigger-nonprogress-frequency.test.ts (corrupt
  frequency → 0 expenses + skip; intervalValue=0 → 0 + skip; a corrupt reminder doesn't block a well-formed one in the same
  batch). green→green: backend validate:local **EXIT 0 — 1189 pass / 1 skip / 0 fail**, tsc 0, musl-biome clean (one
  long-SQL-line reflow autofixed), build bundled. ALSO this
  cycle: Angelo APPROVED **#27 (TCO principal double-count)** + **lease/loan currentOdometer** — both un-gated in BACKLOG (saved
  as lessons); a future bug/feature cycle implements each (#27 default = option (c) exclude financing-sourced rows). cov: be
  82.25%+ (carry; +3 BE) / fe 65.32% (carry)
- **C152 (infra): the #5 branch-hygiene sweep + coverage re-measure (overdue — last C138, branch now 101 commits / 14 cycles
  of drift)** — BALANCE: two over budget → most-starved wins → `infra` (cyc 145, starved-for 7) > `bug` (4); matches the
  C150/C151 forecast. The three-part sweep: (1) STRAY-TEST SCAN — `git status --untracked-files=all` shows ZERO untracked
  unit/spec `*.test.ts` (the only test-like untracked files are the by-design `*.meshclaw.e2e.ts` set + `.meshclaw-tools/`
  harness); nothing vanishes on merge. (2) GREEN BASELINE + RE-MEASURE (loop-improvement #4): backend `bun test --coverage`
  EXIT 0 — 1189 pass / 1 skip; **be 82.02% line / 82.51% func** (func +0.7 from C138's 81.81%). frontend `vitest run --coverage`
  470 pass; **fe 70.09% line / 66.77% func / 62.85% branch** (UP +4.8 line / +4.2 branch from C138's 65.32/58.70 — the C143
  api-client + C149 expense-api service-layer ratchet BROKE 70% line for the first time). Updated the COVERAGE TREND header.
  (3) BRANCH_REVIEW.md refresh — header 85→101 commits, status 1164→1189 BE / 435→470 FE + fresh coverage, appended **§22
  (C138–C151:** #42 backup snapshot-stamp + bug-#13 dupe-flood completion [both data-safety], #39/#41/#46/#50 bug fixes, the
  money-cents migration spec, import-trackers FE client, 2 arch seams [validateVehicleIdsOwned + backend extractErrorMessage],
  the FE service-layer ratchet); reviewer checklist now reflects **#27 + lease/loan APPROVED C151** (moved out of pending →
  loop-buildable) with only #36/#37 HIGHs still Angelo-gated. BRANCH_REVIEW.md is gitignored. Doc/measurement-only — no code
  change, no build gate beyond the two coverage runs. Next sweep ~C162; CLAUDE.md refresh next ~C160. cov: be 82.02% line /
  82.51% func (re-measured) / fe 70.09% line (re-measured)
- **C153 (arch): extract `advanceReminderDueDate(reminder, from)` — the reminder-due-date advance, 4 sites → 1** — BALANCE:
  two over budget → most-starved (absolute) wins → `arch` (cyc 147, starved-for 6) > `bug` (5), by the C152 precedent. The
  arch queue was marked "EMPTY of clean picks" (C147), so I HONESTLY re-evaluated before falling to the juicier approved #27
  (avoid motivated reasoning): my own C151 hoist had left FOUR byte-identical `computeNextDueDate(nextDue, reminder.frequency,
  reminder.intervalValue, reminder.intervalUnit, getAnchorDay(reminder))` blocks. VERIFIED all four firsthand (C141 discipline):
  processExpensePeriod:207, processNotificationPeriod:228, fastForwardPastNow:264 (var `advanced`, identical RHS), AND
  routes.ts:111 (the mark-serviced re-arm — spelled the anchor inline as `reminder.startDate.getDate()`, semantically identical
  to getAnchorDay; the comment literally says "reuse the trigger math"). A COMPLETE 4→1 convergence (no inline site left behind
  → avoids the C75/C92/C99 partial-churn anti-pattern). FIX: exported `advanceReminderDueDate(reminder, from)` in trigger-service
  (folds getAnchorDay in), wired all 4 sites; swapped routes.ts's import + the stale comment from computeNextDueDate. Pure (no
  DB), backend-only, behavior-preserving, cents-migration-independent. Test-anchored (rule 3): +3 in compute-next-due-date.property.test.ts
  (delegation-equivalence across weekly/monthly/yearly/custom; Jan-31 stable-anchor re-anchor; the bug-#13 throws propagate).
  green→green: backend validate:local **EXIT 0 — 1192 pass / 1 skip / 0 fail (+3)**, tsc 0 (caught nothing — clean), musl-biome
  clean (one long-line reflow autofixed), build bundled. cov: be 82.0%+ (carry; +3 BE) / fe 70.09% (carry)
- **C154 (bug #27, HIGH — the loop's FIRST HIGH, Angelo-approved C151): TCO no longer double-counts a financed vehicle's
  principal** — BALANCE: `bug` the only over-budget category + most-starved by far (cyc 148, starved-for 6 > 3) → forced. The
  freshly-approved headline target. THE BUG (found+verified C120, escalated, approved C151): `getVehicleTCO` summed `purchasePrice`
  + the `financingInterest` bucket, but that bucket sums WHOLE financing-sourced expense rows — full loan payments (principal +
  interest), proven by computeBalance = originalAmount − SUM(financing expenseAmount) (financing/repository.ts:68). So a financed
  vehicle with a purchasePrice counted the principal TWICE ($30k car + ~$33k payments → TCO ≈ $63k). FIX (Angelo-approved option
  c, implemented as a CONDITIONAL — the key subtlety): exclude the financing-payment rows from the total ONLY when purchasePrice
  is counted (they retire the already-counted price); when purchasePrice is NOT counted (no price recorded, or a year-scoped view
  per #28), the financing outflow IS the cost signal → keep it (an UNCONDITIONAL exclude would have introduced a NEW undercount
  for an unpriced financed vehicle). GROUNDED firsthand: PerVehicleTab.svelte:112 renders only `totalCost` (no per-bucket
  breakdown shown), and Property 14 (Req 10.2) asserts total == sum of buckets — so I report the financing bucket as the COUNTED
  value (0 when excluded) to keep the breakdown internally consistent. Extracted `computeTCOTotal(costs, purchasePrice, year)`
  (also drops getVehicleTCO's cognitive complexity 16→under-15 — biome enforced it; the #27/#28 model is now a named, isolated
  unit). KEY COVERAGE GAP CLOSED: Property 14's generator never emits sourceType:'financing' rows (seedExpense omits source_type),
  so the double-count had ZERO regression coverage → +2 dedicated tests (priced+financed → payments excluded, total=$30,060,
  bucket=0, breakdown sums; unpriced+financed → payments counted, total=$1,000). green→green: backend validate:local **EXIT 0 —
  1194 pass / 1 skip / 0 fail (+2)**, tsc 0, musl-biome clean (one reflow autofixed), build bundled. #27 CLOSED. cov: be 82.0%+
  (carry; +2 BE) / fe 70.09% (carry)
- **C155 (deep-review → bug #52: userId-scope the split delete/regenerate writes — cross-tenant defense-in-depth)** — BALANCE:
  nothing strictly over budget (feature/deep-review/guard tied AT budget, all breach C156); highest-leverage = `deep-review`
  (its fan-outs keep surfacing real defects — #27/#39/#41/#42/#50; vs a 5th gated feature spec or a thinning guard gap). Fresh
  2-agent fan-out on UN-audited backend-correctness veins: (A) the expenses-repository query/filter/search/pagination/aggregation
  path, (B) fuel-stats + fuel-efficiency math. PRE-READ both surfaces myself (C67) — the pre-read already debunked the likely
  "search-OR widens past userId scope" HIGH (the search is a single pre-parenthesized `(desc LIKE ? OR cat LIKE ?)` AND-joined
  with the userId scope) + confirmed the C97 fuel-fillup-count fix held. Agent A CERTIFIED the whole filter/sort/pagination/
  aggregation core CLEAN (count==rows WHERE, allowlisted sort, split SUM not double-counted, all reads userId-scoped) and
  surfaced the one real, verified, clean finding — **#52 (MED, security)**: `deleteSplitExpense:720` + `updateSplitExpense:771`
  key their destructive `delete(expenses).where(eq(groupId))` on groupId ALONE, while their guarding SELECTs are userId-scoped —
  ownership check + destructive write on DIFFERENT predicates. NOT exploitable today (groupId is a server cuid2, single-owner;
  the SELECT throws NotFoundError first), but a latent cross-tenant boundary if a group ever held cross-user siblings. VERIFIED
  both sites firsthand. FIX (the C109 detectConflicts tenant-scope class): AND `eq(expenses.userId, userId)` into both deletes —
  behavior-identical today, closes the boundary at the write. +2 regression tests (inject a same-groupId sibling owned by USER_2,
  delete/update as USER_1 → the foreign row SURVIVES; pre-fix it would be cross-deleted). green→green: backend validate:local
  **EXIT 0 — 1196 pass / 1 skip / 0 fail (+2)**, tsc 0, musl-biome clean, build bundled. Filed agent-A F3 (endDate inclusivity
  is server-TZ-conditional, UTC-prod-mitigated) as LOW #53. Agent B (fuel-stats) findings pending its delayed completion event →
  will triage/file then. cov: be 82.0%+ (carry; +2 BE) / fe 70.09% (carry)
  - *C155.5 (post-cycle triage, delayed event): the fuel-stats agent (c7bf2ea7) landed after C155 closed. Its Finding 1 →
    **#54 (HIGH), VERIFIED firsthand**: getFuelEfficiencyTrend pairs consecutive fuel rows ACROSS vehicles in the fleet view
    (no vehicleId in the SELECT, ordered by date only, computeEfficiencyPoint has no same-vehicle guard) → a phantom MPG point
    when two cars have close odometers; reachable via /fuel-efficiency with no vehicleId. FILED (not fixed — a fresh
    increment for a future bug/deep-review cycle; needs the query reshape + a regression test). Its div-guard/split-sibling
    checks matched my C155 pre-read (clean). Committed `01175d6` (BACKLOG #54 + this triage note, doc-only).*
- **C156 (guard): coverage-ratchet `middleware/body-limit.ts` (the C138-named backend low spot)** — BALANCE: two over budget
  → most-starved (absolute) wins → `guard` (cyc 149, starved-for 7) > `feature` (5), by the C152/C153 precedent. THE PICK:
  body-limit.ts sat ~35% line — a DoS guard wired LIVE in TWO places (app.ts:41 global + sync/routes.ts:209 backup upload,
  maxSize=CONFIG.backup.maxFileSize; reachability CONFIRMED, not dead code) yet only its happy path was incidentally exercised.
  Mirrored the proven C105/C112 middleware-net pattern (minimal Hono app + a handler-run counter that proves whether next()
  ran). +7 in body-limit.test.ts pinning the full contract: under-limit→200/handler-runs; over-limit→413 PAYLOAD_TOO_LARGE with
  the MB-formatted message + handler NOT run; EXACTLY-at-limit→passes (the check is strict `size > maxSize` — the boundary a
  refactor could flip); no-Content-Length→passthrough (the chunked/streaming gap, documented — the uncompressed-size guards
  backstop the backup path); malformed (NaN) Content-Length→passthrough; custom-message override; multi-MB message formatting
  (5.00MB cap / 10.00MB received). maxSize/message come from the config ARG (no frozen-CONFIG vacuity trap). green→green: backend
  validate:local **EXIT 0 — 1203 pass / 1 skip / 0 fail (+7)**, tsc 0, musl-biome clean, build bundled. Backend middleware trio
  now all covered (idempotency C105 + rate-limit C112 + body-limit C156). cov: be 82.0%+ (carry; +7 BE) / fe 70.09% (carry)
- **C157 (feature → bug: lease/loan miles-used now consume the ALL-TIME `currentOdometer`, Angelo-approved C151)** — BALANCE:
  `feature` the only over-budget category (cyc 151, starved-for 6 > 4) → forced. In-flight features are eyes-on tails + money-cents
  is T0-gated, so the buildable feature increment is the **approved lease/loan currentOdometer swap** (the call-site swap + a
  regression test are loop-buildable; only the FinanceTab render is eyes-on). THE BUG (found+traced C54, approved C151):
  FinanceTab fed `vehicleStatsData?.currentMileage` — which is PERIOD-SCOPED + fuel-only (shrinks under a 7d/30d stats-period
  selection, ignores manual odometer entries) — into BOTH `PaymentMetricsGrid` (loan mileageUsed) + `LeaseMetricsCard` (lease
  overage → projected excess-fee $). Miles-used is inherently all-time, so a non-'all' period silently UNDERSTATED both. FIX
  (verified semantics firsthand vs source — VehicleStats type + GET /stats route both document currentOdometer as the canonical
  ALL-TIME, all-sources, period-INDEPENDENT reading, C52): swap both sites to `currentOdometer`. Rather than duplicate the
  `currentOdometer ?? currentMileage ?? initialMileage` selection at both sites, extracted a pure `resolveCurrentOdometer(...)`
  helper in financing-calculations.ts (a small arch win + makes the logic unit-testable, since the .svelte render is eyes-on).
  Merge-surviving net: +5 in lease-metrics.test.ts pinning the selection contract (currentOdometer wins over a lower period-scoped
  currentMileage [the bug case]; null/undefined fallbacks; initialMileage fallback; null when nothing; the `??`-not-`||` zero-reading
  honored). green→green: frontend validate:local **EXIT 0 — 475 pass (+5)**, tsc 0, build done. CODE-COMPLETE, EYES-ON-PENDING for
  the FinanceTab visual (NORTH_STAR #3 — Playwright-blocked here), but the all-time-odometer LOGIC is now pinned. cov: fe 70.09%+
  (carry; +5 FE) / be 82.0% (carry)
- **C158 (bug #54, HIGH): getFuelEfficiencyTrend no longer pairs fuel rows ACROSS vehicles in the fleet view** — BALANCE: `bug`
  the only over-budget category (cyc 154, starved-for 4 > 3) → forced. The freshly-filed #54 (verified firsthand C155.5 from the
  C155 fuel-stats fan-out). THE BUG: getFuelEfficiencyTrend ordered fuel rows by DATE ONLY (no vehicle group, vehicleId not even
  selected) and paired rows[i]/rows[i-1]; in the fleet view (/fuel-efficiency with NO vehicleId — reachable, vehicleId optional)
  consecutive rows can be DIFFERENT cars → computeEfficiencyPoint subtracts two cars' odometers → a phantom MPG point when they
  have close odometers (12,000 & 12,100 → 100mi/10gal → a plausible 10 MPG that survives the [5,100] filter). FIX: select
  vehicleId, order by (vehicleId, date), and pair only WITHIN each vehicle — reusing the EXISTING forEachVehiclePair helper (the
  same per-vehicle pairing computeMpgAndCostPerMile already uses) rather than hand-rolling. To reuse it I generic-ized it +
  groupByVehicle over `T extends {vehicleId}` (they only read vehicleId; backward-compatible — existing FuelExpenseRow callers
  unaffected) and exported it. Merge-surviving net: +3 in cross-vehicle.property.test.ts (2 cars, close odometers + interleaved
  dates, 1 row each → NO phantom point [pre-fix: 1]; per-vehicle trends still computed [2 points, 25 + 30 MPG]; single-vehicle
  scoping unchanged). green→green: backend validate:local **EXIT 0 — 1206 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean
  (one reflow autofixed), build bundled. #54 CLOSED. cov: be 82.0%+ (carry; +3 BE) / fe 70.09% (carry)
- **C159 (infra): CLAUDE.md orientation refresh (4 drifts fixed post-C145)** — BALANCE: two over budget → most-starved
  (absolute) wins → `infra` (cyc 152, starved-for 7) > `arch` (6). The #5 sweep was just C152 (next ~C162); the CLAUDE.md
  refresh was due ~C160 (C145 cadence) and C155–C158 landed substantial drift (+10 commits, 2 HIGHs closed, 2 approvals shipped).
  4 drifts a fresh agent would mis-orient on, each verified vs the C146–C158 LEDGER (the C117/C131/C145 anti-drift discipline,
  no churn): (1) maintenance "lease/loan follow-on still pending Angelo / should switch to currentOdometer" → DONE C157 (FinanceTab
  consumes all-time currentOdometer via resolveCurrentOdometer); (2) coverage cited the stale C138 reading (82.25/65.3) + named
  expense-api.ts as a "next FE low spot" — but C152 re-measured (82.0 line / 82.5 func BE; **fe 70.1 line — broke 70%**), C149
  closed expense-api, C156 added body-limit → updated figures, re-pointed FE to components/routes + BE to sync/restore, noted the
  middleware trio is complete; (3) suite size ~1178/~457 → **1206/475**; (4) the Pending-Angelo block listed **#27 as a still-open
  HIGH** ("THREE HIGHs") — but C154 CLOSED #27 and C158 CLOSED #54 → added a "Loop-found HIGHs now CLOSED" line + trimmed to the
  TWO remaining (Sheets #36/#37) and refreshed the lower-sev list (#45/#51/#53). Doc-only — no build gate (the C5/C47/C117/C131/
  C145 convention; every claim verified vs source/LEDGER). Next CLAUDE.md refresh ~C174; #5 sweep next ~C162. cov: be 82.0% /
  fe 70.09% (carry, doc-only cycle)
- **C160 (arch): extract `validateReminderOwnership` — the inline reminder ownership guard, 5 sites → 1** — BALANCE: `arch` the
  only over-budget category (cyc 153, starved-for 7) → forced. The queue was "EMPTY of clean picks" → ran the **rule-7 AUDIT
  fan-out** (2 Explore agents: backend + frontend dedup scans, each with the already-done exclusions + a skeptic mandate). Both
  delivered ranked findings with verified false-positives rejected (FE photo/thumbnail/query-builder "dups" differ structurally;
  financing HTTPException sites are the documented C106 exclusion). BEST PICK (backend): the inline
  `const x = await reminderRepository.findByIdAndUserId(id, user.id); if (!x) throw new NotFoundError('Reminder')` guard repeated
  **5×** in reminders/routes.ts (mark-serviced:86, GET/:id:181, GET/:id/expenses:195, PUT:215, DELETE:275). VERIFIED all 5
  byte-identical firsthand + confirmed findByIdAndUserId returns ReminderWithVehicles|null. FIX (the established C99/C113/C141
  convergence pattern): added `validateReminderOwnership(id, userId): Promise<ReminderWithVehicles>` to utils/validation.ts (a
  byte-for-byte mirror of the existing validateExpenseOwnership, slotting into the validateXOwnership family) + wired all 5 sites
  (3 consume the entity, 2 guard-only) + removed the now-dead NotFoundError import (the C123 dead-import class — biome
  noUnusedImports enforced it). Test-anchored (rule 3) by EXISTING 404 coverage: mark-serviced.test.ts:173 ("non-existent /
  cross-tenant id returns 404") + reminder-materialized-expenses-route.test.ts both pass green THROUGH the new helper — the
  convergence preserved the 404 contract. green→green: backend validate:local **EXIT 0 — 1206 pass / 1 skip / 0 fail** (unchanged
  = behavior-preserving), tsc 0, musl-biome clean, build bundled. Filed the FE runner-up (settings.svelte.ts handleError →
  extractErrorMessage, 9 sites) as the next arch pick. cov: be 82.0% / fe 70.09% (carry; behavior-preserving, no net test delta)
- **C161 (deep-review → bug #55: negative-amortization guard in calculateAmortizationSchedule)** — BALANCE: `deep-review` the only
  over-budget category (cyc 155, starved-for 6 > 5) → forced. Fresh 2-agent fan-out on UN-audited verifiable veins: (A) FE
  financing-calculations.ts math (the FinanceTab loan/lease displayed $), (B) backend analytics money rollups (getQuickStats
  ytdSpending / getCrossVehicle / fleet health). PRE-READ both (C67): debunked nothing false but flagged the derivePaymentEntries
  scheduled-vs-actual split (agent confirmed LOW/by-design) + confirmed ytdSpending's year boundary is the correct half-open local
  interval. BOTH agents returned a real, verified, MED, displayed-figure, single-cycle finding. TOOK agent A's (more egregious
  output): **#55** — `calculateAmortizationSchedule` (:91) computes `principalAmount = Math.min(paymentAmount − interest,
  balance)` but, UNLIKE its two siblings calculatePayoffDate (:238) + calculateExtraPaymentImpact (:311) which both bail on
  `principalAmount <= 0`, OMITS the guard. When payment < monthly interest, principal goes NEGATIVE and `balance −
  principalAmount` GROWS the balance every period → the schedule emits rows with negative principal + a climbing balance into the
  displayed amortization table AND into derivePaymentEntries' totalPrincipalPaid/totalInterestPaid (FinanceTab:58,67). VERIFIED
  firsthand + confirmed the sibling-guard asymmetry. FIX: add `if (principalAmount <= 0) break;` (mirrors the siblings; bounded
  for-loop so it was output-corruption not a hang). Merge-surviving net: +2 in amortization-negative-guard.test.ts (under-funded
  loan → no negative principal + non-increasing balance [pre-fix: 60 rows of −2450, −2511…]; healthy loan still amortizes to 0 —
  guard doesn't over-fire). Used a NEW focused test file (the existing property test uses tab-indent the Edit tool couldn't match;
  a separate regression file is equally merge-surviving). green→green: frontend validate:local **EXIT 0 — 477 pass (+2)**, tsc 0,
  build done. FILED agent B's finding as #56 (computeAverageCosts.perFillup divides by withCost.length, double-counting split fuel
  siblings — the #18 class left open in this one field; a one-line predicate swap to isFillup). cov: fe 70.09%+ (carry; +2 FE) /
  be 82.0% (carry)
- **C162 (bug #56): computeAverageCosts.perFillup no longer inflated by split fuel siblings** — BALANCE: two over budget; most-
  starved (absolute) = `feature` (cyc 157, starved-for 5) > `bug` (4). But feature is BLOCKED (all 3 in-flight at eyes-on tails;
  money-cents T0-gated; both approved items #27/lease-loan already shipped — only a 5th gated spec remains, lower-value than a
  clean verified bug). Per the don't-force-a-blocked-pick rule → fell to the next over-budget category `bug`, which had the
  freshly-filed verified #56. THE BUG (filed C161, verified firsthand C162): computeAverageCosts (analytics-charts.ts:405)
  computed perFillup = sum(expenseAmount over expenseAmount>0 rows) / (count of those rows). A split fuel expense materializes one
  sibling PER VEHICLE — each with a positive cost share but volume=null — so a 2-way split fillup counted as 2 in the denominator,
  understating "avg cost/fillup" ~Nx (the #18 class, left open in this one field after C97 fixed the COUNT). FIX: restrict BOTH
  numerator + denominator to volume-bearing rows (`volume != null && volume > 0`) — the same isFillup predicate the fuel-stats
  COUNT uses; a null-volume sibling counts as 0 fillups, so its share drops out of perFillup too (a cost-in-numerator/not-in-
  denominator mismatch would inflate it). `withCost`/`totalSpending` (the avgCostPerDay numerator) left UNCHANGED — split shares
  still sum to the true total there. Verified the common path is byte-equivalent (unsplit: volume>0 && cost>0 both hold). +3 tests
  in analytics-charts-unpinned.test.ts (split fillup → volume-bearing only [$55 not $47.5]; unsplit unchanged [$50]; all-split →
  null, no div-by-zero). green→green: backend validate:local **EXIT 0 — 1209 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome
  clean (one reflow autofixed), build bundled. #56 CLOSED. cov: be 82.0%+ (carry; +3 BE) / fe 70.09% (carry)
- **C163 (guard): coverage-ratchet `reminder-api.ts` (FE service-layer sibling at ~12% line)** — BALANCE: two over budget →
  most-starved (absolute) wins → `guard` (cyc 156, starved-for 7) > `feature` (6); feature is the same eyes-on-blocked
  situation (only a 5th gated spec), so guard is both rule-correct + higher-leverage. STEERED by a real coverage measure (not a
  guess): ran sync-module + FE coverage. The sync low spots (restore.ts:160-246 = restoreFromSheets, routes.ts) need a
  process-global Sheets-service mock — which NO sync test uses (the C38/C91 cross-suite-flake trap), so NOT a clean pick (filed
  the restoreFromSheets gap as a note). The FE measure surfaced `reminder-api.ts` at **12% line** — the service-layer SIBLING the
  C143 (api-client) / C149 (expense-api) ratchet left behind; the existing test (C134) covered only 2 of 11 methods (the T6/T7
  seams). EXTENDED it (didn't clobber): added post/put/delete to the existing vi.mock (file-scoped, NOT the process-global
  mock.module trap) + **+15 tests** driving the 9 uncovered methods (create/list/getById/update/delete/trigger/markServiced/
  getNotifications/markNotificationRead) + the load-bearing `buildReminderQuery` (the `isActive !== undefined` edge — `false` MUST
  survive a truthiness bug would drop) + getNotifications unreadOnly gating. green→green: frontend validate:local **EXIT 0 — 492
  pass (+15)**, tsc 0, build done. FE service layer now fully covered (api-client C143 + expense-api C149 + reminder-api C163 +
  error-handling C137). cov: fe 70.1%+ (carry; +15 FE) / be 82.0% (carry)
- **C164 (infra): the #5 branch-hygiene sweep + coverage re-measure (overdue — last C152, branch now 116 commits) + feature-
  starvation escalation to Angelo** — BALANCE: `feature` the ONLY over-budget category (cyc 157, starved-for 7, badly over) →
  forced. But I HONESTLY exhausted the buildable-feature search: all 3 in-flight features eyes-on-blocked; money-cents HARD-gated
  at T0 (needs Angelo's D1-D5 before ANY build, incl. prep — confirmed in tasks.md); the unspecced horizon (trips/sharing/OCR)
  all need a design call (OCR conflicts with privacy-first self-hosting → external vision dep). Manufacturing a 5th speculative
  spec = low-leverage busywork, so per "don't-force-a-blocked-pick" + "draft, flag, MOVE ON" → ESCALATED the feature-starvation
  reality to Angelo (ratify money-cents T0? which horizon to spec next?) via send_message, then took the overdue infra sweep this
  cycle (non-blocking). The 3-part sweep: (1) STRAY-TEST SCAN — zero untracked unit/spec tests (only the by-design e2e set +
  .meshclaw-tools harness); (2) GREEN BASELINE + RE-MEASURE — backend bun test --coverage EXIT 0 (1209 pass), be 82.70% line /
  82.51% func (line up from C152 82.02); frontend 492 pass, fe 70.18% line / 66.88% func / 62.85% branch (FE service layer now
  FULLY covered); (3) BRANCH_REVIEW.md refresh — header 101→116 commits, status 1189→1209 BE / 470→492 FE + fresh cov, appended
  §23 (C152–C163: both Angelo-approved HIGHs #27/lease-loan SHIPPED, +#54/#52 HIGHs, #55/#56 MEDs, 2 arch dedups, FE service layer
  fully covered), reviewer checklist updated (#27 + lease/loan now SHIPPED not pending). BRANCH_REVIEW.md gitignored. Doc/
  measurement-only — no code change. Next sweep ~C174; CLAUDE.md refresh next ~C174. cov: be 82.70% line / fe 70.18% line (re-measured)
- **C165 (feature → spec: trips & location, a NORTH_STAR horizon item)** — BALANCE: `feature` the ONLY over-budget category (cyc
  157, starved-for 8, SEVERELY over — deferred 4 straight cycles C161–C164). No Angelo response yet to the C164 escalation;
  money-cents T0 still unratified. Couldn't keep dodging — and the NORTH_STAR EXPLICITLY authorizes the move: horizon items "need
  spec + design sign-off before build — draft, flag Angelo, move on." So I drafted the next horizon spec (correcting my C164
  over-hesitation — a grounded spec is a real reusable artifact, not busywork). PICKED trips & location as the draft: it's the
  LOWEST-architectural-risk of the 3 unspecced (additive `trips` table mirroring odometerEntries; NO ownership-model change
  [unlike vehicle-sharing]; NO external dep [unlike receipt-OCR's vision API]; free-text location only, GPS deferred). GROUNDED
  against the real schema (odometerEntries:344) + every established pattern (userId-scope C155/#52, validateXOwnership C160,
  backup round-trip C145/C146 + coverage guards, analytics groupByVehicle div-guard, the #46 distance clamp, C61/#39 tz dates).
  Wrote requirements.md (R1–R6 + D1–D6 open decisions) / design.md (§1 schema … §7 risk fence) / tasks.md (T0 gate → T1–T5
  loop-buildable backend → T6 eyes-on). KEY: trips is a GOOD unblock candidate — T1–T5 are loop-buildable (unlike the 3 in-flight
  features that are all backend-done + eyes-on-tail-only). Spec-only, no code → no build gate (the C4/C9/C146 convention; all
  groundings verified vs source). Re-escalation folded into the C164 ask (which horizon to spec) — NOT a new blocking message.
  cov: be 82.70% / fe 70.18% (carry, spec-only cycle)
- **C166 (arch): converge settings.svelte.ts handleError onto the shared extractErrorMessage — 9 sites → the C90 helper** —
  BALANCE: two over budget → most-starved (absolute) wins → `arch` (cyc 160, starved-for 6) > `bug` (4). Took the FE runner-up
  the C160 audit fan-out filed (the cleaner of the two primed picks: a pure delete-and-replace onto an ALREADY-tested helper, no
  new helper to author; the BE validateOdometerOwnership pick needs a 404 test written from scratch — deferred). THE DUP:
  settings.svelte.ts:18 defined a local `handleError(error) = error instanceof Error ? error.message : 'An unexpected error
  occurred'` — byte-identical to the shared `extractErrorMessage(error, fallback)` (error-handling.ts:13, the C90/C137 helper),
  called 9× in the store. VERIFIED firsthand: same error-wins precedence (NOT the inverted handleApiError:120 fallback-wins
  contract — the C90 exclusion the helper's own doc comment flags). FIX: deleted the local helper, imported extractErrorMessage,
  replaced all 9 sites with `extractErrorMessage(err, UNEXPECTED_ERROR)` (the fallback hoisted to a named const). Behavior-
  preserving (byte-identical). Test-anchored by extractErrorMessage's existing extract-error-message.test.ts + the green→green
  full FE suite (the C160 precedent — the store has no test file, and adding one [mocking settingsApi + $state runes] is heavier
  than this dedup warrants). green→green: frontend validate:local **EXIT 0 — 492 pass (unchanged = behavior-preserving)**, tsc 0,
  build done. ARCH QUEUE: BE validateOdometerOwnership remains the one primed pick. cov: fe 70.18% / be 82.70% (carry; no net
  test delta — behavior-preserving)
- **C167 (deep-review → bug #57, HIGH): deleting an insurance policy orphaned its premium expenses** — BALANCE: two over budget →
  most-starved (absolute) wins → `deep-review` (cyc 161, starved-for 6) > `bug` (5). Fresh 2-agent fan-out on UN-audited veins:
  (A) the insurance WRITE + premium→expense materialization (the less-audited counterpart to the C73/C150 READ audits), (B)
  photos + sync-worker (user-data + retry/concurrency). PRE-READ hooks.ts myself (C67): debunked my own "createTermExpenses not
  idempotent" hypothesis (the 2 create sites are distinct new terms; PUT uses delete-then-recreate). Agent A surfaced the real
  HIGH: **#57** — premium expenses link to terms by plain TEXT sourceType/sourceId (NO FK; schema.ts:233-234), and the DELETE-
  policy route (routes.ts:133) cleans PHOTOS (which also lack an FK) but NEVER deleteBySource the premium expenses → the term
  cascade-deletes but the $1200 expense row PERSISTS with a dangling sourceId, still summed into TCO insuranceCost FOREVER
  (analytics categorizes any financial + sourceType:'insurance_term' row, no term-exists check) + leaks its expense photos. The
  asymmetry is the proof: DELETE-term (routes:221) + UPDATE-term (hooks:70) both deleteBySource; only parent-policy delete didn't.
  VERIFIED firsthand (the route's own comment even notes the photos-no-FK cleanup, but omits the identical expenses-no-FK case).
  FIX: enumerate the policy's terms (insurancePolicyRepository.findById → terms) before delete + deleteBySource('insurance_term',
  term.id, userId) per term, mirroring the existing claim-photo cleanup block. +1 regression test in policy-delete-cascade.test.ts
  (costed term → premium expense materializes → policy delete → 0 insurance_term expenses; pre-fix the orphan survived). Agent B
  CERTIFIED the photos/sync path mostly clean (retry bound finite retryCount<3, cross-tenant delete/serve blocked, nosniff #35
  held, DI not mock.module) + filed its strongest (F1: non-idempotent Drive/Photos retry on the upload-then-DB-write await gap) as
  #58 MED. green→green: backend validate:local **EXIT 0 — 1210 pass / 1 skip / 0 fail (+1)**, tsc 0, musl-biome clean, build
  bundled. #57 CLOSED. cov: be 82.70%+ (carry; +1 BE) / fe 70.18% (carry)
- **C168 (bug #48): userId-scope getCurrentOdometer + getHistory (cross-tenant defense-in-depth)** — BALANCE: `bug` the only
  over-budget category (cyc 162, starved-for 6, badly over) → forced. Triaged the queue: the freshly-filed #58 (sync-worker
  idempotency) + #47 (MAX-by-value poisoning) + #45/#51/#53 all need a DECISION/approach call (not clean one-cycle). The cleanest
  FULLY-DECIDED unblocked pick was **#48** — odometer/repository.ts getCurrentOdometer (:138) + getHistory (:73) filter on
  vehicle_id ONLY, not userId (the C109 detectConflicts / #52 tenant class). No current leak (every live caller validates vehicle
  ownership first), but a latent boundary: an unvalidated vehicleId would return another user's reading + (for getCurrentOdometer)
  poison the mileage-reminder axis. VERIFIED both methods firsthand (raw sql UNION over expenses + odometer_entries; both tables
  have a user_id column). FIX: added a userId param to both + ANDed `user_id = ${userId}` into every WHERE leg (6 total: 2
  getCurrentOdometer + 4 getHistory incl. the 2 COUNT subqueries). Threaded userId through all 5 production callers (reminders/
  routes ×2 via the resolveMileageFields helper + trigger-service processMileageReminder via reminder.userId + vehicles/routes
  GET /stats + odometer/routes GET history) + both test files (tsc caught zero misses — the C113 floor). Merge-surviving net: +1
  cross-tenant regression test in get-current-odometer.test.ts (another user's reading on a queried vehicleId → null under our
  userId; OTHER_USER still reads their own → 77000, so the scope isn't over-broad). green→green: backend validate:local **EXIT 0
  — 1211 pass / 1 skip / 0 fail (+1)**, tsc 0, musl-biome clean, build bundled. #48 CLOSED. cov: be 82.70%+ (carry; +1 BE) / fe
  70.18% (carry)
- **C169 (guard): coverage-ratchet `settings-api.ts` (the last FE service-layer sibling at ~7% line)** — BALANCE: nothing
  strictly over budget; feature + guard tied AT budget (both breach C170). Took GUARD — a real coverage increment (the C124 FE
  measured priority) over a 6th gated feature spec (feature is the same eyes-on/T0-blocked situation, already escalated C164 +
  trips drafted C165). THE PICK: settings-api.ts at ~7% line — the LAST FE service-layer sibling the C143/C149/C163 ratchet left
  behind. +11 tests (the proven file-scoped vi.mock(apiClient) pattern, NOT process-global mock.module) driving all 9 methods +
  the LOAD-BEARING bits: restoreFromProvider's zip-vs-sheets body branch (zip includes fileRef, sheets OMITS it) + the
  Idempotency-Key header on BOTH restore paths (the double-restore data-safety guard), listBackupsFromProvider's encodeURIComponent
  (special chars in providerId), uploadBackup's FormData assembly, downloadBackup via apiClient.raw. tsc caught a real test bug
  (updateSettings takes Partial<UserSettings> — a nested `unitPreferences:{distanceUnit}` is NOT a valid partial since
  UnitPreferences needs all 3 fields; switched to currencyUnit) — the gate earning its keep. green→green: frontend validate:local
  **EXIT 0 — 503 pass (+11)**, tsc 0, build done. **FE SERVICE LAYER now 100% module-covered** (api-client C143 + expense-api
  C149 + reminder-api C163 + settings-api C169 + analytics-api partial + error-handling C137). cov: fe 70.18%+ (carry; +11 FE) /
  be 82.70% (carry)
- **C170 (feature → spec reconcile: tick recurring-expenses T1 done — it shipped C96, checkbox was stale)** — BALANCE: `feature`
  the only over-budget category (cyc 165, starved-for 5 > 4) → forced. HONESTLY re-checked for a buildable slice before falling
  through (don't-force-a-blocked rule): money-cents + trips both T0-gated (Angelo, escalated C164/C165); the 3 in-flight features
  eyes-on-blocked. But found a genuine non-eyes-on feature increment: recurring-expenses tasks.md T1 was UNCHECKED `[ ]` despite
  shipping C96 — a stale checkbox. VERIFIED firsthand (the C150 don't-trust-memory discipline): `expense-source-traceability.test.ts`
  EXISTS (6130 bytes) + covers exactly the T1 deliverable (the read-path HTTP contract — a materialized expense echoes
  sourceType:'reminder'/sourceId through the real route→trigger→DB→serialize stack; manual → null). Ticked T1 [x] with the C96
  grounding (read path was already a clean no-op pass-through → no contract-drift guard warranted per C80; the genuine deliverable
  was the observable-contract test). This RECONCILES the spec with reality + CONFIRMS recurring-expenses' entire BACKEND (T1–T3 +
  T5 gate + T6/T7 seams) is complete — only the eyes-on UI tail remains, so the feature-starvation is honest, not a missed
  buildable slice. Spec-doc-only — no code, no build gate (the C4/C9 convention; verified the test exists firsthand). Re-escalation
  NOT re-sent (folded into the standing C164/C165 asks). cov: carry (doc-only cycle)
- **C171 (infra): CLAUDE.md orientation refresh (3 drifts fixed post-C159)** — BALANCE: `infra` the only over-budget category
  (cyc 164, starved-for 7) → forced. The #5 sweep was just C164 (next ~C174); the CLAUDE.md refresh (last C159) is the more-due
  infra item + counts drifted +12 cycles. 3 drifts, each verified vs the C160–C170 LEDGER (the C117/C131/C145/C159 anti-drift
  discipline, no churn): (1) coverage cited the stale C152 reading (82.0/70.1) + "FE service layer well-covered" → C164
  re-measured (be 82.70 line / fe 70.18), and the FE service layer is now **100% module-covered** (C163 reminder-api + C169
  settings-api completed it) → updated figures, the ratchet list, the "100% module-covered" status, and re-pointed the BE low spot
  to sync/routes.ts (~32%) with the restore.ts mock caveat; (2) suite size ~1206/~475 → **1211/503**; (3) the closed-HIGHs line
  listed only #27/#54 → added **#57** (C167 insurance policy-delete premium-expense orphan) + the MED fixes #52/#55/#56/#48
  (C155–C168). Doc-only — no build gate (the standing convention; every claim verified vs source/LEDGER). Next CLAUDE.md refresh
  ~C184; #5 sweep next ~C174. cov: be 82.70% / fe 70.18% (carry, doc-only)
- **C172 (arch): extract `validateOdometerOwnership` — the inline odometer ownership guard, 3 sites → 1** — BALANCE: two over
  budget → most-starved (absolute) wins → `arch` (cyc 166, starved-for 6) > `bug` (4). Took the one primed arch pick (the C160
  audit's BE runner-up). The `const entry = await odometerRepository.findById(id); if (!entry || entry.userId !== user.id) throw
  new NotFoundError('Odometer entry')` guard repeated **3× byte-identical** in odometer/routes.ts (GET /entry/:id:99, PUT:146,
  DELETE:165). VERIFIED all 3 firsthand + confirmed findById returns OdometerEntry|null (BaseRepository generic). A DIFFERENT repo
  contract than the C160 reminder helper (findById + explicit userId post-filter — the validateInsuranceOwnership shape, NOT
  findByIdAndUserId), so its own helper. FIX: added `validateOdometerOwnership(entryId, userId): Promise<OdometerEntry>` to
  utils/validation.ts (mirrors validateInsuranceOwnership) + wired all 3 (GET consumes entry, PUT/DELETE guard-only) + dropped the
  now-dead NotFoundError import (C123/C160 class; biome enforced). Test-anchored (rule 3 — the C160 caveat: odometer routes had NO
  404 test): +3 not-found 404 tests in update-route.test.ts (GET/PUT/DELETE :id → 404 for a non-existent id), pinning the helper's
  throw at all 3 sites (the cross-tenant leg stays covered by the cycle-138 IDOR suite, which passes green through the helper).
  green→green: backend validate:local **EXIT 0 — 1214 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean (one import reflow
  autofixed), build bundled. **ARCH QUEUE now EMPTY of primed picks** — next arch cycle runs a fresh rule-7 audit fan-out to
  repopulate. cov: be 82.70%+ (carry; +3 BE) / fe 70.18% (carry)
- **C173 (deep-review → bug #59): native CSV-import parseDate now echo-checks date-only (rejects out-of-range, not silent roll)**
  — BALANCE: two over budget → most-starved (absolute) wins → `deep-review` (cyc 167, starved-for 6) > `bug` (5). Fresh 2-agent
  fan-out on UN-audited veins: (A) the native CSV-import pipeline (less-audited than the C60 mapping pre-pass), (B) the
  split-service allocation core (underpins recurring/insurance but never got a dedicated review). PRE-READ both (C67): debunked my
  own split-percentage-over-100 hypothesis (refineSplitConfig enforces sum=100 ±0.001 at the Zod layer — unreachable) +
  confirmed computeEvenSplit is provably exact (cents floor + remainder distribution). Agent B's report not yet landed (delayed —
  will triage); agent A surfaced the real finding. **#59:** native parseDate (import-csv.ts:136) builds a date-only value in LOCAL
  time (the C61 trap correctly avoided) but its ONLY validity check is Number.isNaN — and `new Date(2024,12,45)` ("2024-13-45")
  never NaNs, it silently ROLLS FORWARD to 2025-02-14 (skewing TCO/monthly-trend/year-scoped analytics). The #23/#39 echo-check
  fix was applied to the MAPPING path (buildLocalDate, C115) but NEVER ported to the native path. VERIFIED firsthand + mirrored
  buildLocalDate's exact guard. FIX: echo-check the constructed Y/M/D against the input parts; mismatch → the clean per-row
  "Invalid date" error (full-ISO branch unchanged — round-trips an absolute instant). +1 regression test (2024-13-45 + 2024-02-30
  → both rejected, errorCount 2, imported 0; pre-fix both imported at rolled dates). Agent A also CERTIFIED clean: BOM (C51),
  money-no-NaN-corruption, formula-denormalize symmetry, idempotency (clientId dedup), cross-tenant vehicle resolution. green→green:
  backend validate:local **EXIT 0 — 1215 pass / 1 skip / 0 fail (+1)**, tsc 0, musl-biome clean (one reflow autofixed), build
  bundled. #59 CLOSED. cov: be 82.70%+ (carry; +1 BE) / fe 70.18% (carry)
- **C174 (bug → #60): absolute split EDIT recomputes groupTotal from allocations (no stale-header inconsistency)** — BALANCE:
  `bug` over budget (cyc 168 → starved-for 6 > 3) AND most-starved → FORCED pick. The pick was HANDED to me by C173's split-service
  agent B (0242f1dc), whose delayed completion event landed this cycle: I triaged it firsthand (C67 — agent HIGHs are ~50% false)
  against three source files before acting. My C173 pre-read had only cleared the CREATE/percentage vein (computeEvenSplit exact +
  refineSplitConfig sum=100); agent B found a DIFFERENT, real vein I'd missed — the absolute-method UPDATE path. **#60 (data-safety +
  displayed-$, VERIFIED firsthand):** the trace — updateSplitSchema makes `totalAmount` OPTIONAL (validation.ts:102) AND gates its
  absolute-sum refinement on `totalAmount !== undefined` (:64), so an absolute edit that OMITS the total passes validation; then
  updateSplitExpense (repository.ts:762) falls back `data.totalAmount ?? firstOld.groupTotal ?? …` → the STALE old groupTotal; then
  computeAllocations' absolute branch (split-service.ts:19-23) returns the allocations VERBATIM. Net: create absolute 30/30 (total
  $60) → edit to 40/40 with no totalAmount → two siblings each stamped groupTotal=$60 while the legs sum to $80, a persistent stored
  inconsistency surfaced verbatim by the split header (routes.ts:177/207) and a violation of the documented Property 3 ("legs sum to
  groupTotal", split-service.property.test.ts:441 — its tests only exercise create/total-present paths, so this slipped). FIX
  (minimal, method-aware, pure): for the ABSOLUTE method the total is DEFINITIONALLY the sum of allocations, so derive it
  (`Math.round(Σamount*100)/100`) instead of trusting the omitted/stale value; even/percentage carry no absolute amounts so they
  KEEP the caller-or-stored total to divide. Behavior-preserving where total IS sent (validation already forces sum===total → identical
  value). +3 regression tests in expense-repository.property.test.ts: (1) absolute edit, no total → groupTotal & legs both $80
  (the #60 regression); (2) absolute edit WITH matching total → unchanged (fix is a no-op when total sent); (3) even-split edit,
  no total → still reuses stored $60 (behavior-preservation control proving the fix is scoped to absolute). HONEST CAVEAT: I
  confirmed the BACKEND produces the corrupt state whenever an absolute update omits totalAmount (the API contract permits it); I did
  NOT verify whether the current FE actually omits it on absolute edits (agent B's "ordinary UI editing" claim) — the backend gap is
  real regardless; real-world trigger frequency depends on that unverified FE detail (filed as a follow-on note). green→green:
  backend validate:local **EXIT 0 — 1218 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean, build bundled. #60 CLOSED.
  Split-service vein now fully consumed (both C173 agents triaged). cov: be 82.70%+ (carry; +3 BE) / fe 70.18% (carry)
- **C175 (guard): pin pwa.ts getPlatformInfo UA-classification + promptInstall accept/dismiss branches** — BALANCE: `feature` was
  the only over-budget category (cyc 170 → starved-for 5 > 4), but ALL 5 feature items remain blocked — maintenance T9 /
  import-trackers T4–T6 / recurring-expenses T4–T8 are eyes-on-Playwright-blocked, money-cents T0 + trips T0 are Angelo-sign-off-gated
  and BOTH gates are already escalated (C164/C165, no change since → re-nagging would be noise, and the protocol says don't block).
  Honest starvation. FELL THROUGH to highest-leverage actionable; no other category over budget; AT the 5/3 spawn cap so stayed
  INLINE (no fresh deep-review/arch fan-out). PICK = the standing guard coverage-ratchet (due C176 anyway), steered to a verified-
  firsthand gap. `pwa.ts` getPlatformInfo() is the ONLY pure branching logic in the file and had ZERO tests, yet it decides which
  PWA-install instructions a user sees (iOS Share-sheet vs Android/desktop native prompt); its heuristics are subtle + regression-
  prone: the iPadOS-13+-as-MacIntel+touch masquerade (maxTouchPoints>1 — else a desktop Mac mis-detects as iPad) and isChromium
  EXCLUDING Opera via !/OPR/ despite Opera's "Chrome/" token. The existing suite also ADMITTED (in a comment) it never reached
  promptInstall's accept/dismiss outcome branches (couldn't populate the module-internal deferredPrompt). FIX (guard-only, no product
  code): +8 getPlatformInfo cases (iPhone→ios; iPad-MacIntel-touch→ios; MacIntel-no-touch→desktop [the negative control]; Android
  Chrome; desktop Chrome; Edge→Chromium; Opera→NOT-Chromium [load-bearing]; Firefox→non-Chromium desktop) + 2 promptInstall cases
  driven the REAL way (fire the captured beforeinstallprompt handler to set deferredPrompt, THEN promptInstall → dismissed=false /
  accepted=true+canInstall cleared). Replaced window.navigator wholesale per-test (the harness's own 'sw not supported' technique) +
  restored it in afterEach — did NOT flip the $app/environment browser global (the C38/C91 cross-suite-leak trap). green→green: FE
  validate:local **EXIT 0 — 513 pass (+10)**, tsc 0, build done; ALSO ran the CI-only legs validate:local skips — eslint EXIT 0 +
  prettier --check EXIT 0 on the touched file (CI runs the full `validate` = lint+format+type-check+test). cov: fe 70.18%+ (carry;
  +10 FE, pwa.ts getPlatformInfo 0%→covered) / be 82.70% (carry)
- **C176 (infra — #5 branch-hygiene sweep [overdue] + coverage re-measure; surfaced an untracked-spec hygiene finding)** — BALANCE:
  `feature` the only over-budget category (cyc 170 → starved-for 6 > 4), but blocked for the 3rd cycle running (eyes-on-Playwright /
  Angelo-T0-gated, both escalated C164/C165, nothing changed → honest starvation, don't re-nag). Fell through; among the rest INFRA
  was most-starved (cyc 171, starved-for 5, due C177) AND the #5 sweep was overdue (last C164, ~12 cycles / 128 commits-ahead vs the
  ~10-cycle cadence) — a concrete due obligation, edging arch (4, queue-empty). Inline, no spawn. THE 3-PART SWEEP: **(1) stray-test
  scan** — and it EARNED its keep this cycle: found `.kiro/specs/offline-entries/` (4 docs, dated 2026-06-05, pre-loop) is the ONLY
  untracked `.kiro/specs/` dir. Investigated firsthand (NOT a stray to delete): its implementation IS committed/tracked (TODO #8 ✅ —
  `client_id` column + partial unique index `expenses_user_client_idx`, `createIdempotent`/`findByClientId`, migration
  `0001_blushing_juggernaut.sql`, `idempotent-create.test.ts` — the SAME idempotency infra #59/#52 rely on), and TODO.md:19-22 cites its
  tasks.md as the deferred-follow-ups record. So the docs arguably belong in git, BUT they're Angelo-authored design content (not loop
  output) → per "don't unilaterally commit unauthored specs," FLAGGED to Angelo for a track/keep-local call rather than acting. Other
  untracked items all expected (.meshclaw-tools/, *.meshclaw.e2e.ts, playwright.meshclaw.config.ts, test-results/, mise.local.toml).
  **(2) GREEN BASELINE + RE-MEASURE** — backend `bun test --coverage` EXIT 0 (1218 pass / 1 skip / 0 fail), **be 82.74% line / 82.49%
  func** (line up from C164's 82.70 — the C167–C174 BE fixes); frontend `vitest --coverage` EXIT 0 (513 pass), **fe 73.89% line /
  73.61% func / 66.08% branch** (UP +3.7 line / +6.7 func / +3.2 branch from C164 — the C166 settings-store + C169 settings-api + C175
  pwa FE ratchets DELIVERED; FE closing the gap fast). **(3) BRANCH_REVIEW.md REFRESH** — header 116→128 commits-ahead, status 1209→1218
  BE / 492→513 FE + fresh cov, appended **§24 (C164–C175:** #57 HIGH shipped, #59/#60 MED data-safety bugs, the odometer dedup arch,
  settings-api + pwa guard ratchets, trips spec drafted, CLAUDE.md refresh**)**, + the offline-entries hygiene note in the reviewer
  call-outs. BRANCH_REVIEW.md gitignored (refreshed, not committed). Doc/measurement-only — NO code change. Next #5 sweep ~C186;
  CLAUDE.md refresh next ~C184 (last C171). cov: be 82.74% line / fe 73.89% line (RE-MEASURED)
- **C177 (arch): extract shared `buildLocalDate` — the date echo-check, 2 import paths → 1 source of truth** — BALANCE: `feature`
  the only category STRICTLY over budget (cyc 170 → starved-for 7 > 4) but blocked for the 4th cycle running (eyes-on-Playwright /
  Angelo-T0-gated, both escalated → honest starvation, don't re-nag). Fell through; `arch` was most-starved among the rest (cyc 172,
  starved-for 5 = budget, due THIS cycle — matched the C176 forecast). Stayed INLINE — no spawn (didn't assume the 5/3 cap reset; an
  inline dedup needs none). The arch queue's clean dedup picks were all consumed (C160→C166/C172 runner-ups landed), so rule 7 calls
  for a fresh fan-out — but I had a STRONGER lead from my OWN recent work: C173's #59 fix added an echo-check to import-csv.ts parseDate
  that the commit explicitly noted "mirrors the mapping path's buildLocalDate" (import-mapping.ts, C115/#23). VERIFIED firsthand both
  sites run the IDENTICAL "construct local Date + NaN-check + echo-check getFullYear/getMonth/getDate" guard — two pure-`.ts`,
  cents-migration-INDEPENDENT implementations of one algorithm (the ideal arch candidate: clears the eyes-on + pending-migration
  constraints that rule out most FE/money picks). EXTRACT: new sibling module `expenses/local-date.ts` houses the canonical
  `buildLocalDate(y,m,d,hh=0,mm=0,ss=0): Date|null` (time defaults to 0 → a date-only caller gets local midnight, byte-identical to
  `new Date(y,m-1,d)`). Wired BOTH callers: import-mapping.ts deletes its local copy + imports (normalizeForeignDate unchanged);
  import-csv.ts parseDate's inline echo-check → a `buildLocalDate(...)` call that maps null→its existing `{error}` return (caller keeps
  its own {value}|{error} shaping — the C90 extractErrorMessage pattern: helper stays the leaner primitive). Behavior-preserving (arch
  rule 2): verified `new Date(y,m-1,d)` ≡ local-midnight; no cross-import before (no circular risk). TEST-ANCHORED (rule 3): the
  EXISTING import-csv #59 + import-mapping #23 out-of-range suites are the green→green oracle (both stayed green THROUGH the extraction),
  + new local-date.test.ts (+7: in-range build, time-default-midnight, explicit-time, month>12 rejected, Feb-30 rejected, month-0
  rejected, leap-day 2024-02-29 ok / 2023-02-29 rejected). green→green: backend validate:local **EXIT 0 — 1225 pass / 1 skip / 0 fail
  (+7)**, tsc 0, musl-biome clean, build bundled. cov: be 82.74%+ (carry; +7 BE) / fe 73.89% (carry)
- **C178 (bug → #25): insurance per-vehicle attribution scopes to the LATEST term, not ALL terms** — BALANCE: TWO over budget —
  `feature` (cyc 170, starved-for 8, most-starved) + `bug` (cyc 174, starved-for 4 > 3). Feature blocked for the 4th cycle running
  (eyes-on / Angelo-T0-gated, both escalated) → per "don't-force-a-blocked-pick" fell to the next over-budget category = `bug` (which
  HAS an actionable, non-decision-gated item — unlike the gated HIGHs #36/#37 + the decision-gated #24/#29/#45/#47). Inline, no spawn.
  PICK = #25 (filed C114, MED, displayed-$). VERIFIED FIRSTHAND vs source (C67/C150 — line numbers drift, ~half of filed findings
  need re-confirm): analytics/repository.ts:924 `monthlyPremium = effectiveMonthlyPremium(latestTerm)` (LATEST term's premium) but
  :926-932 built `coveredVehicleIds` from `junctionRows.filter(j => policyTerms.some(t => t.id === j.termId))` — EVERY term's
  junctions — then :977 `perVehicleMonthly = monthlyPremium / coveredVehicleIds.length`. So a policy whose coverage SHRANK across
  terms (old covered {A,B}, latest {A}) divided the latest premium by the all-terms count: A understated (½ instead of full), dropped
  B got a PHANTOM premium it's no longer insured under, costByCarrier.vehicleCount over-counted. Aggregate totalMonthly/Annual
  CORRECT (added once per policy, :934) — a mis-DISTRIBUTION, not a mis-total. FIX (one-line, non-gated, mechanical): scope the filter
  to `j.termId === latestTerm.id` (the term the premium came from). Confirmed junctionRows shape `{termId, vehicleId}` + that the
  query loads all the policy's termIds before acting. +2 tests in insurance-details.test.ts: (1) the #25 regression — old term {veh-1,
  veh-2} + latest {veh-1} @ $120 → only veh-1 in vehicleDetails @ full $120 (pre-fix: both @ $60 + phantom veh-2), carrier
  vehicleCount 1 (pre-fix 2); (2) UNCHANGED-coverage control — both terms {veh-1,veh-2} @ $120 → each $60, count 2 (proves no
  regression to the normal multi-vehicle split). Existing latest-term-selection + #8 + #14 + drift-guard cases stayed green (aggregates
  untouched). One biome reflow on the edited block autofixed (check:musl:fix). green→green: backend validate:local **EXIT 0 — 1227
  pass / 1 skip / 0 fail (+2)**, tsc 0, musl-biome clean, build bundled. #25 CLOSED. cov: be 82.74%+ (carry; +2 BE) / fe 73.89% (carry)
- **C179 (deep-review → guard): audit the VEHICLE lifecycle vein; certified CLEAN + closed a C41-net coverage gap** — BALANCE: TWO
  over budget — `feature` (cyc 170, starved-for 9, most-starved) + `deep-review` (cyc 173, starved-for 6 > 5). Feature blocked for the
  4th cycle running (escalated) → fell to `deep-review` (forced, matched the C178 forecast). The 3 queued deep-review items are
  Playwright-eyes-on-blocked (×2) or arch-DI-gated (getFinancing) → per the established pattern, a FRESH backend-correctness audit on
  an UN-audited vein. SPAWN ATTEMPT: tried a 2-agent spawn_run fan-out (vehicle-lifecycle + odometer-write veins) — both returned
  `HTTP Error 400` and did NOT register in spawn_list (transport failure, not a queue). Rather than burn the cycle debugging the spawn
  transport, did the audit INLINE (higher-fidelity anyway — verify-firsthand means I'd re-read every agent finding vs source
  regardless). VEIN: vehicle CRUD + delete-cascade (vehicles/routes.ts + repository.ts, 375+90 lines). **CERTIFIED CLEAN (all
  verified firsthand):** (1) DELETE /:id — validateVehicleOwnership-guarded, cleans photos for the vehicle + its expense/odometer
  children (the no-FK photos table, correctly avoiding the C167 orphan class) BEFORE delete, then relies on DB FK-cascade for
  expenses/odometer/financing/insurance-junctions/reminder-junctions — VERIFIED every child table has `onDelete:'cascade'`
  (schema.ts:70/159/210/352/482; insurance_claims is `set null` by design) AND that `PRAGMA foreign_keys = ON` IS set on the prod
  connection (connection.ts:28) → cascade actually FIRES (the load-bearing assumption — without the pragma, delete would orphan every
  child row); (2) PUT /:id — the updateVehicleSchema `.partial()` over a table with FOUR .default() columns (vehicleType/trackFuel/
  trackCharging/unitPreferences) is SAFE from the C31/C41 clobber class: PROVED firsthand via a throwaway probe that
  `updateVehicleSchema.parse({})` injects `[]` (drizzle-zod doesn't surface DB defaults as Zod defaults — the C35 scope-note holds for
  vehicles too); probe deleted after. **THE ONE FINDING (deep-review → guard increment): the C41 default-injection net
  (partial-update-no-default-injection.test.ts) did NOT cover updateVehicleSchema** — its own note flagged this future gap, and it's
  the HIGHEST-RISK createInsertSchema-based instance (4 default cols; a future drizzle-zod bump or hand-added .default() could silently
  revert an EV to vehicleType:'gas' or flip trackFuel on a nickname-only PUT). CLOSED IT: exported updateVehicleSchema from the route +
  added it to the net's UPDATE_SCHEMAS (5 pass, was 4) — pins the assumption instead of just documenting it. Behavior-preserving (an
  `export` keyword + 1 test entry, zero runtime change). green→green: backend validate:local **EXIT 0 — 1228 pass / 1 skip / 0 fail
  (+1)**, tsc 0, musl-biome clean, build bundled. cov: be 82.74%+ (carry; +1 BE) / fe 73.89% (carry). (The odometer-write vein —
  agent B's intended scope — remains un-audited; next deep-review cycle, inline if spawn stays down.)
- **C180 (bug → #48 completion): userId-scope `findByVehicleIdPaginated` — the last unscoped odometer read leg** — BALANCE: only
  `feature` over budget (cyc 170, starved-for 10, blocked 5th cycle running) → fell to highest-leverage actionable. Picked up the
  C179-carried-over ODOMETER-WRITE-vein audit (agent B's un-run scope), done INLINE (spawn 400'd last cycle; inline is the reliable +
  higher-fidelity path). Audited odometer/routes.ts + repository.ts adversarially. **CERTIFIED CLEAN (firsthand):** PUT updateSchema =
  createSchema.partial() — PROVED via throwaway probe that the field-level future-date `.refine` SURVIVES .partial() (future recordedAt
  rejected on update), negative odometer rejected, empty update a clean no-op (no .default() → C41-safe); probe deleted. getHistory +
  getCurrentOdometer both userId-scoped (C168), correct UNION/MAX-by-value. The PUT-update recheck gap (Mileage Finding A/B) is the
  DOCUMENTED D5 by-design scope choice (#17) — not a fresh defect. **THE FINDING (#48 completion, the C109/#52 tenant class):
  `findByVehicleIdPaginated` (the backing query for GET /:vehicleId) filtered on `vehicle_id` ALONE on BOTH the data + count legs** —
  C168 userId-scoped getHistory + getCurrentOdometer but MISSED this third method (its own note said "verify ALL methods, no leg
  missed" — this was the missed leg). Not live-exploitable (route validates vehicle ownership first), but the identical latent
  cross-tenant boundary C168 set out to close. FIX: added a `userId` param + ANDed `eq(userId)` into both legs (shared `where`),
  threaded `user.id` through the one route caller. +3 tests (new find-by-vehicle-paginated.test.ts: newest-first + totalCount; limit/
  offset; the #48 cross-tenant case — a foreign same-vehicleId row leaks into NEITHER data NOR count [pre-fix totalCount would be 2]).
  One biome reflow autofixed. green→green: backend validate:local **EXIT 0 — 1231 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome
  clean, build bundled. Odometer vein now FULLY audited + the #48 sweep COMPLETE (all 3 read methods scoped). cov: be 82.74%+ (carry;
  +3 BE) / fe 73.89% (carry)
- **C181 (guard): convert backup-orchestrator's COVERAGE-THEATER test to real coverage + pin the provider-selection filters** —
  BALANCE: only `feature` strictly over budget (cyc 170, starved-for 11, blocked 6th cycle running) → fell through; `guard` AT budget
  (cyc 175, starved-for 6 = 6, due this cycle, matched the C180 forecast) + most-starved actionable → guard pick. Steered the
  coverage-ratchet to the lowest-covered, highest-RISK module: MEASURED firsthand (not the stale tag) — `backup-orchestrator.ts` was
  **0.00% func / 6.97% line**, by far the worst substantive backend module, AND it's the data-safety-critical backup orchestration
  core (NORTH_STAR #1; #42/#43/#44 live here). ROOT CAUSE (read firsthand): there's a backup-orchestrator.test.ts with 17 green tests
  — but it's **COVERAGE THEATER**: it RE-IMPLEMENTS the orchestrator's logic LOCALLY (acquireMutex/filterEnabledProviders/
  needsZipGeneration/collectResults/simulateFanOut are all COPIES in the test file) and asserts against the copies, never importing or
  calling the real module → real code stays 0% while the suite "passes." The exact NORTH_STAR #5 anti-pattern (a guard that doesn't
  guard real code; a copy↔source divergence goes uncaught). FIX (the honest conversion): EXTRACTED the two cleanly-pure filters
  `filterEnabledProviders` + `needsZipGeneration` as EXPORTED fns in the orchestrator + rewired execute() to call them (behavior-
  preserving — same logic, now one source of truth), then pointed the test's import at the REAL exports + added 4 edge-case assertions
  (empty config; strict `=== true` on sheetsSyncEnabled so a disabled/omitted provider drops out — the don't-back-up-a-disabled-
  provider guard; Sheets-only needs-no-ZIP; ZIP+Sheets-only needs-ZIP). RESULT: backup-orchestrator.ts **0% → 50% func** (the provider-
  selection logic that decides WHAT gets backed up is now pinned against real source). HONESTLY DOWN-SCOPED + DOCUMENTED in the test
  header: execute()'s body (lines 54-222) stays getDb()-singleton-bound + dynamic-import-bound → not reachable from an in-memory
  harness without the C38/C91 process-global mock.module trap (the SAME limit deep-review #3 hit on getFinancing); the remaining sims
  (acquireMutex/collectResults/simulateFanOut) are left as flagged behavioral mirrors, NOT falsely claimed as real coverage. Two biome
  reflows autofixed. green→green: backend validate:local **EXIT 0 — 1235 pass / 1 skip / 0 fail (+4 net)**, tsc 0, musl-biome clean,
  build bundled. cov: be 82.78% line (re-measured this run; +backup-orchestrator 0→50% func) / fe 73.89% (carry). NEXT guard low spots:
  analytics/routes.ts (15% func — GET-handler response assembly), sync/routes.ts (50%/31%), activity-tracker.ts (53%/44%).
- **C182 (arch): extract `isEligibleForPayoff` + `PAYOFF_BALANCE_THRESHOLD` — the payoff rule, 3 sites → 1** — BALANCE: only
  `feature` strictly over budget (cyc 170, starved-for 12, blocked 7th cycle running) → fell through; `arch` + `infra` both AT budget
  (5=5 / 6=6, both due, breach C183). Picked `arch` (genuine high-leverage dedup work; queue empty since C177) over `infra` (CLAUDE.md
  refresh near-due ~C184 but not yet, sweep just C176) — infra becomes next cycle's forced pick. SPAWN RECOVERED: a single arch-scout
  (a11fa350) registered cleanly this time (no HTTP 400 — the C179/C180 transport failure was transient). It returned #1 = a
  serializeSessionUser dedup (2 auth sites). I ALSO scouted independently (verify-firsthand prep while it ran) + found a STRONGER
  candidate: `eligibleForPayoff: computedBalance <= 0.01` triplicated at vehicles/routes.ts:154 + :230 + financing/routes.ts:89.
  CHOSE MINE over the agent's #1 — 3 sites vs 2, ALL 3 fully test-anchored (the agent honestly flagged its /refresh site as
  unanchored), and it collapses a BUSINESS RULE + magic number (the payoff threshold — a wrong value is a correctness bug; a
  serialization shape is already guarded by contract tests). VERIFIED all 3 firsthand (the replace_all initially caught only :154
  [10-space indent]; :230 has 8-space indent — verified + fixed separately, the kind of subtlety the firsthand check exists for). FIX:
  added exported `PAYOFF_BALANCE_THRESHOLD = 0.01` + `isEligibleForPayoff(balance)` to financing/repository.ts (beside computeBalance,
  which produces the balance it consumes); wired all 3 sites + threaded the import. ALSO converted the financing-balance property test's
  4 LOCAL `<= 0.01` copies (the C181 theater pattern again — same find!) to call the real export + added a boundary test (exactly 0.01 →
  eligible, 0.0101 → not). Behavior-preserving (arch rule 2 — identical threshold/comparison); test-anchored by the EXISTING vehicles-
  list + financing-GET contract tests + the property test, all green THROUGH the change (green→green). green→green: backend
  validate:local **EXIT 0 — 1236 pass / 1 skip / 0 fail (+1)**, tsc 0, musl-biome clean, build bundled. cov: be 82.78%+ (carry) / fe
  73.89% (carry). (Agent's serializeSessionUser #1 filed below as the next arch candidate.)
- **C183 (infra): CLAUDE.md orientation refresh (post-C171 drift, C172–C182)** — BALANCE: two over budget — `feature` (cyc 170,
  starved-for 13, blocked 8th cycle, escalated) + `infra` (cyc 176, starved-for 7 > 6). Feature blocked → fell to `infra` (forced;
  `bug` was only AT budget 3=3, not over). The #5 sweep isn't due (last C176, ~C186); the CLAUDE.md refresh (last C171, "next ~C184")
  is the more-due infra increment — one cycle early but infra is forced NOW + it's the highest-value infra task available. Doc-only —
  no build gate (standing convention; every claim verified vs LEDGER/source per the C145 convention). FIXED 5 drifts: (1) coverage
  re-measure C164→C176 figures (be 82.70→82.74 line; fe 70.18→73.89 line / 66.9→73.61 func / 62.9→66.08 branch); (2) FE-guard ratchet
  list +C175 pwa.ts; (3) FE low spots — dropped pwa.ts (DONE C175), kept sync-manager ~58%; (4) BE low spots — added backup-orchestrator
  0→50% C181 (+ the coverage-theater warning) + named analytics/routes.ts 15% func as the highest-value next pick; (5) suite size
  ~1211/~503 → ~1236/~513; + the MED-fix line now notes #48 sweep COMPLETED C180 (findByVehicleIdPaginated) + adds #59/#25. No code
  touched. cov: be 82.74% line / fe 73.89% line (carry, doc-only). Next CLAUDE.md refresh ~C194; #5 sweep next ~C186.
- **C184 (bug → #26c): `findExpiringTerms` excludes CANCELLED policies' terms** — BALANCE: two over budget — `feature` (cyc 170,
  starved-for 14, blocked 9th cycle, escalated) + `bug` (cyc 180, starved-for 4 > 3). Feature blocked → fell to `bug` (forced;
  deep-review was only AT budget 5=5, not over). Inline (at the 6/3 spawn cap — no fan-out). Triaged the unblocked bug queue for the
  cleanest non-decision-gated item: #26c over #31 (fuel pair-by-date, already guarded → no wrong output) + #38 (latent, not a bug
  today); skipped the gated #29/#30/#40/#43/#44/#45/#47 + the reconcile-queue-needing #33/#34. #26c (LOW, displayed-data, VERIFIED
  firsthand vs source — C114 finding, line numbers drift): `findExpiringTerms` (insurance/repository.ts:703) joins
  insuranceTerms→insurancePolicies + filters endDate-BETWEEN + userId, but had NO `isActive` predicate → a CANCELLED policy's term
  whose endDate lands in the window still surfaced on GET /expiring-soon (routes.ts:51, the upcoming-renewal nag), telling the user a
  policy they've cancelled needs renewing. FIX: ANDed `eq(insurancePolicies.isActive, true)` — the EXACT pattern the per-vehicle
  coverage query at :741 already uses; behavior-preserving for active policies. Confirmed the single production caller
  (/expiring-soon) wants active-only. +1 regression test (seed an active policy + a cancelled policy with terms in the SAME window →
  the cancelled term is excluded, the active term still shows — proving the filter isn't over-broad). Existing Property-12 tests (all
  seed isActive:true) stayed green THROUGH the change. green→green: backend validate:local **EXIT 0 — 1237 pass / 1 skip / 0 fail
  (+1)**, tsc 0, musl-biome clean, build bundled. #26c CLOSED (#26 a/b remain — both LOW, internally-consistent display nuances).
  cov: be 82.74%+ (carry; +1 BE) / fe 73.89% (carry).
- **C185 (deep-review → guard): audit + HTTP-cover the analytics ROUTE handlers (the 15%-func low spot)** — BALANCE: two over budget
  — `feature` (cyc 170, starved-for 15, blocked 10th cycle, escalated) + `deep-review` (cyc 179, starved-for 6 > 5). Feature blocked →
  fell to `deep-review` (forced). INLINE (at the 6/3 spawn cap — no fan-out). Two-birds pick (the C91 precedent: a route file is a fair
  coverage pick when it doubles as an audit-net): the named coverage low spot `analytics/routes.ts` (15% func / 42% line, C181 re-measure)
  IS the deep-review surface. **AUDIT (firsthand, CERTIFIED CLEAN):** read all 13 GET handlers — thin pass-throughs to analyticsRepository
  (userId-scoped internally, certified across C73/C99/C106/C155/C158/C162/C178); the 6 vehicle-scoped endpoints
  (fuel-stats/fuel-advanced/vehicle-health/vehicle-tco/vehicle-expenses/fuel-efficiency) call validateVehicleOwnership before the repo —
  the required-id ones always, the optional-id ones only `if (vehicleId)` (correct: omitted = all-the-user's-fleet). NO cross-tenant hole.
  **WHY only 15% covered:** the existing summary-route.test.ts RECONSTRUCTS a minimal app inline (mocked repo + fake auth) — it never
  drives the real module (the C181/C182 coverage-theater shape AGAIN). **GUARD:** added analytics-routes-http.test.ts (+8) driving the
  REAL routes via createTestApp() over in-memory SQLite (the C91 pattern): anon→401; financing/insurance→{success,data} 200;
  vehicle-tco owned→200; vehicle-tco + vehicle-health + fuel-efficiency FOREIGN vehicleId→404 (the C109/#52 cross-tenant guard FIRES —
  no analytics leak by id-guessing); fuel-efficiency NO vehicleId→200 (optional-guard branch); vehicle-tco missing required id→400.
  RESULT: analytics/routes.ts 15%→58.82% func / 42%→59.40% line from this test alone (remaining uncovered = the date-range endpoints,
  exercised at the repo layer by the property tests). Test-only, no production change. One biome reflow autofixed. green→green: backend
  validate:local **EXIT 0 — 1245 pass / 1 skip / 0 fail (+8)**, tsc 0, musl-biome clean, build bundled. cov: be 82.74%+ (carry; +8 BE,
  analytics/routes 15→59% line) / fe 73.89% (carry).
- **C186 (infra — #5 branch-hygiene sweep + coverage re-measure; due by cadence)** — BALANCE: only `feature` over budget (cyc 170,
  starved-for 16, blocked 11th cycle, escalated) → fell through to highest-leverage actionable; no other category over budget, so free
  pick → the #5 sweep was DUE (last C176, 10 cycles, branch 128→138 commits-ahead). Inline, doc/measurement-only — no code change.
  THE 3-PART SWEEP: **(1) STRAY-TEST SCAN** — same set as C176, no NEW strays: `.kiro/specs/offline-entries/` (already flagged to
  Angelo C176, his track/keep-local call — re-flagged in BRANCH_REVIEW §25, no re-nag) + the expected harness/playwright-config/
  test-results/mise.local.toml. **(2) GREEN BASELINE + RE-MEASURE** — backend `bun test --coverage` (1245 pass / 0 fail), **be 83.41%
  line / 83.74% func** (UP from C176's 82.74/82.49 — the C178/#25 + C180/#48 + C181/orchestrator + C184/#26c + C185/analytics-routes
  additions); frontend `vitest --coverage` (513 pass / 0 fail), **fe 73.89% line / 73.61% func / 66.08% branch** (FLAT vs C176 — every
  C178–C185 cycle was backend). **(3) BRANCH_REVIEW.md REFRESH** (gitignored) — header 128→138 commits-ahead, status 1218→1245 BE /
  513 FE + fresh cov, appended **§25 (C176–C185:** #25/#48-completion/#26c bugs, the buildLocalDate + isEligibleForPayoff arch dedups,
  the backup-orchestrator + analytics-routes COVERAGE-THEATER fixes, the vehicle-lifecycle audit, CLAUDE.md refresh**)**. NOTE: the
  coverage-theater pattern recurred 3× this window (C181/C182/C185) — flagged in §25 as worth a systematic sweep someday. Next #5 sweep
  ~C196; CLAUDE.md refresh next ~C194. cov: be 83.41% line / fe 73.89% line (RE-MEASURED).
- **C187 (arch): extract `serializeSessionUser` — the auth session-user block, 2 sites → 1 (the C182-scout primed pick)** — BALANCE:
  only `feature` strictly over budget (cyc 170, starved-for 17, blocked 12th cycle, escalated) → fell through; `arch` + `guard` both AT
  budget (5=5 / 6=6, due). Took the PRIMED arch pick (the C182 scout a11fa350's #1, filed in BACKLOG with its caveat) — needs no
  scouting, runnable INLINE (respecting the 6/3 spawn cap). VERIFIED firsthand (C67/C150 — agent finding, lines drift): the 5-field
  block `{id, email, displayName, createdAt?.toISOString()??null, updatedAt?.toISOString()??null}` is byte-identical at auth/routes.ts
  GET /me (:463, source `user`) + POST /refresh (:562, source `result.user`); CONFIRMED the two near-misses stay EXCLUDED — PATCH /me
  (:510, only id/email/displayName, no timestamps) + GET /accounts (:589, `row.createdAt ? … : new Date().toISOString()` fallback) are
  DIFFERENT shapes (folding either would change a response). FIX: added `serializeSessionUser(u)` (structurally typed on
  {id,email,displayName,createdAt:Date|null,updatedAt:Date|null} so it accepts both sources) + wired both sites. CLOSED THE CAVEAT'S
  GAP: the scout flagged /refresh's success body as UNANCHORED (only /me was tested) — added a POST /refresh success-body shape test to
  me-http.test.ts (+1: valid session → 200 + full id/email/displayName/createdAt-ISO/updatedAt-ISO + session). Behavior-preserving
  (arch rule 2 — identical field set + coercion); anchored by the EXISTING me-http /me test + the NEW /refresh test, green THROUGH the
  change. green→green: backend validate:local **EXIT 0 — 1246 pass / 1 skip / 0 fail (+1)**, tsc 0, musl-biome clean, build bundled.
  ARCH QUEUE empty again — next arch cycle runs a rule-7 fan-out (spawn cap permitting) or inline scout. cov: be 83.41%+ (carry) / fe 73.89% (carry).
- **C188 (guard): HTTP success-path coverage for sync/routes.ts (the 31%-line low spot)** — BALANCE: THREE over budget — `feature`
  (cyc 170, starved-for 18, blocked 13th cycle, escalated) + `guard` (cyc 181, starved-for 7) + `bug` (cyc 184, starved-for 4).
  Feature blocked → among the over-budget rest, MOST-STARVED wins → `guard` (7 > bug's 4). Inline (6/3 spawn cap). Steered the ratchet
  to the worst-covered route file: MEASURED firsthand (C186 log) — `sync/routes.ts` 50% func / **31.66% line**, the backup/restore
  data-safety HTTP surface (NORTH_STAR #1). The existing sync-route-errors.test.ts (C30/C36) covers the ERROR paths; the uncovered 31%
  is the SUCCESS/derivation handlers. Read firsthand to pick the HTTP-harness-TRACTABLE ones (no provider network, no mock.module trap):
  GET /status (the backupEnabled/sheetsSyncEnabled derivation from backupConfig), GET /restore/providers (the sourceTypes zip/sheets
  derivation + skip-when-neither), POST / (no-provider success envelope) — deliberately LEFT the byte/provider-bound paths
  (backups/download, restore-from-provider/backup — the C163 restoreFromSheets mock-trap territory). ADDED sync-route-success.test.ts
  (+7) driving the REAL routes via createTestApp() with raw-seeded backup_config + a user_providers row: status both-flags-false /
  enabled→backupEnabled / sheets-only→sheetsSyncEnabled; restore-providers both-sourceTypes / enabled-but-no-lastBackupAt→skipped /
  no-config→skipped (continue branch); POST valid syncTypes + no providers→200. RESULT: sync/routes.ts 50→72.22% func / 31.66→59.04%
  line (errors+success combined). Test-only, no production change. green→green: backend validate:local **EXIT 0 — 1253 pass / 1 skip /
  0 fail (+7)**, tsc 0, musl-biome clean, build bundled. cov: be 83.41%+ (carry; +7 BE, sync/routes 31.66→59% line) / fe 73.89% (carry).
  NEXT guard low spot: `activity-tracker.ts` (53%/44%, timer-bound — less clean) or the components/routes FE deficit (eyes-on).
- **C189 (bug → #61): expense PUT validates a vehicle REASSIGNMENT (mirror the create-path ownership guard)** — BALANCE: two over
  budget — `feature` (cyc 170, starved-for 19, blocked 14th cycle, escalated) + `bug` (cyc 184, starved-for 5 > 3) → `bug` forced.
  Inline (6/3 spawn cap). Triaged the bug queue HONESTLY: the remaining filed items are all weak — #31 (fuel pair-by-date) is a GUARDED
  non-defect (verified firsthand: forEachVehiclePair doesn't even sort — callers pre-sort by (vehicleId,date); validMilesBetween drops
  a non-positive delta by design → NO wrong output, and the filed "sort by odometer" fix would disturb the C126/C155/C158-audited
  efficiency math for zero correctness gain → LEAVE IT); #51 (term-less active-policy count) is a product-semantics CALL → ESCALATED to
  Angelo (send_message, 3 options), didn't decide unilaterally. Per "don't-force-a-blocked-pick" I did NOT manufacture a risky/gated
  change — instead a FRESH inline deep-review of the un-audited expense WRITE path (expenses/routes.ts POST/PUT) surfaced TWO real
  create/update validation-asymmetry findings: **#61 (MED, fixed this cycle)** + **#62 (filed)**. #61: POST validates
  validateVehicleOwnership(vehicleId) but PUT (:641 update(id, updateData)) did NOT re-validate a CHANGED vehicleId → a user could PUT
  their (owned) expense's vehicleId to a vehicle they DON'T own — stays their row but references a non-owned vehicle, corrupting their
  analytics attribution (within-tenant — all reads userId-scoped, NOT a cross-tenant leak; verified firsthand). FIX: when
  updateData.vehicleId is present AND differs from existing, validateVehicleOwnership (exactly mirroring create). +3 tests
  (foreign-vehicle PUT→404 + the bad write never lands; own-second-vehicle→200 [not over-broad]; no-vehicleId PUT→200 [no regression]).
  green→green: backend validate:local **EXIT 0 — 1256 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean (1 reflow autofixed),
  build bundled. #61 CLOSED. cov: be 83.41%+ (carry; +3 BE) / fe 73.89% (carry).
- **C190 (bug → #62): restrict the manual expense route's `sourceType` to `financing` only (system-only links can't be forged)** —
  BALANCE: only `feature` strictly over budget (cyc 170, starved-for 20, blocked 15th cycle, escalated) → fell through to
  highest-leverage actionable (no other category OVER — deep-review only AT 5). Took the PRIMED #62 (filed C189, the create/update
  validation-asymmetry pair's second half) over a speculative fresh audit — higher-confidence leverage, and deep-review (at budget)
  is forced next cycle anyway. Inline (6/3 spawn cap). VERIFIED THE FIX SHAPE FIRSTHAND before acting: `insurance_term` expenses are
  created via `expenseRepository.createSplitExpense` (insurance/hooks.ts:33) + `reminder` expenses via a direct `tx.insert` /
  createSiblings (trigger-service.ts:160/186) — BOTH bypass the POST/PUT route entirely. So the route enum accepting those two was
  PURE over-permissiveness (only `financing` is legitimately route-set, + already fully validated :536). FIX (Option A, zero-risk):
  `sourceType: z.enum(['financing','insurance_term','reminder'])` → `z.literal('financing')` on the route's create/update schema —
  closes the forge (#62: a hand-crafted POST/PUT could stamp an UNVALIDATED insurance_term/reminder link on the caller's own row →
  skewed source-bucketed analytics + a matching sourceId would cascade-delete the manual expense when its parent is removed; within-
  tenant, all source ops userId-scoped so NOT cross-tenant). Confirmed NO test sends those via the route (the traceability test uses
  POST /reminders/trigger, not POST /expenses) + the 2 existing traceability reads stayed GREEN (the system DB-direct writes are
  unaffected). +4 tests (POST reminder→400, POST insurance_term→400, PUT reminder→400, no-source create→201 control). green→green:
  backend validate:local **EXIT 0 — 1260 pass / 1 skip / 0 fail (+4)**, tsc 0, musl-biome clean, build bundled. #62 CLOSED — the
  C189 expense-write-path audit's findings (#61 C189 + #62 C190) are now BOTH landed. cov: be 83.41%+ (carry; +4 BE) / fe 73.89% (carry).
- **C190.5 (ops — REBASE onto squashed main, at Angelo's request)** — Angelo squash-merged claude-loop-dev → main ("Claude loop dev
  (#108)", origin/main 94a155e→0fa0d49), absorbing C51–C189. Recovered C190 (it was mid-commit when he interjected; a stale script had
  mislabeled it "C189" + dropped its test file → amended to the correct C190 with the test, tagged `pre-rebase-c190-safety`). VERIFIED
  the squash captured through C189 (C189's reassignment guard IS in origin/main) + that the ENTIRE branch-vs-main diff is exactly
  C190's 4 files → C190 is the sole un-merged increment. Rebased clean: `reset --hard origin/main` + `cherry-pick` C190 → branch now
  0-behind / 1-ahead of origin/main (6ad1af4 on 0fa0d49). Re-verified GREEN on the new base (validate:local EXIT 0, 1260 pass).
  **PUSH BLOCKED ON ANGELO:** the stale origin/claude-loop-dev (old C189 tip) is NOT an ancestor → updating it needs a FORCE-PUSH
  (forbidden autonomously). send_message'd the options; C190 safe locally + tagged. NOT a balance-category cycle (an ops interjection).
- **C191 (deep-review): audit the providers/routes.ts credential-CRUD vein; certified CLEAN + filed #63** — BALANCE: two over budget —
  `feature` (cyc 170, starved-for 21, blocked 16th cycle) + `deep-review` (cyc 185, starved-for 6 > 5). Feature blocked → `deep-review`
  forced. Inline (6/3 spawn cap). LOCAL-ONLY cycle (push still gated on Angelo's force-push call from C190.5 — flagged, didn't block per
  step 7). Vein: providers/routes.ts (credential-handling CRUD, 57.52% line — a real low spot + security-sensitive). **CERTIFIED CLEAN
  (firsthand):** credentials never leak (formatProviderResponse omits them; all 3 response paths [GET/POST/PUT] route through it — C91/
  C132 held); PUT preserves the encrypted blob on a credential-less update (`if (body.credentials !== undefined)` :397 — no clobber) +
  re-encrypts when present; every mutation ownership-scoped via findOwnedProviderOrThrow (id AND userId, :50); auth-provider guard on
  PUT/DELETE; storage/backup config cleanup on delete; deleteByProvider keys on providerId alone but is transitively safe (FK to an
  already-proven-owned provider). **FILED #63 (LOW, defense-in-depth):** the PUT update (:404) + DELETE (:484) destructive writes key
  `where(eq(id))` ALONE — not id AND userId. Guarded one layer up by findOwnedProviderOrThrow (NOT exploitable today), but the exact
  C109/#52 class the loop closed at split (C155) + odometer (C168/C180): a future guard-drop/reorder would expose it. Clean non-gated
  fix = AND eq(userProviders.userId) into both write predicates (behavior-identical today). NO code change this cycle (deep-review =
  find-not-fix; #63 is a bug-cycle pick). cov: be 83.41% / fe 73.89% (carry, read-only audit).
- **C192 (bug → #63): tenant-scope the provider PUT/DELETE destructive writes (the C191 audit's finding)** — BALANCE: only `feature`
  strictly PAST budget (cyc 170, starved-for 22, blocked 17th cycle) → fell through to highest-leverage actionable (arch/infra only AT
  budget, not past). Took #63 (verified+filed C191) — clean, non-gated, security-relevant, mechanically identical to C155/C180, and it
  COMPLETES the C191 providers audit (audit→fix). Inline (6/3 spawn cap). LOCAL-ONLY (push still gated on Angelo's C190.5 force-push
  call — flagged, not blocking). #63 (LOW, defense-in-depth, C109/#52 class): providers/routes.ts PUT update (:404) + DELETE (:484)
  keyed `where(eq(userProviders.id, id))` ALONE; findOwnedProviderOrThrow guards one layer up (not exploitable), but a future
  guard-drop/reorder would expose a cross-tenant write. FIX: ANDed `eq(userProviders.userId, user.id)` into BOTH write predicates
  (behavior-identical today — the guard already proves ownership; mirrors C155 split + C168/C180 odometer). +3 tests in
  providers-routes-http.test.ts via raw-seeded COEXISTING foreign provider (a 2nd createTestApp resets the DB, so the existing
  cross-user tests couldn't assert survival): foreign DELETE→404 + foreign row SURVIVES; foreign PUT→404 + displayName UNCHANGED; own
  delete→204 (not over-broad). These pin the WRITE PREDICATE itself, not just the guard. One biome reflow autofixed. green→green:
  backend validate:local **EXIT 0 — 1263 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean, build bundled. #63 CLOSED — the C191
  providers-audit finding now landed. cov: be 83.41%+ (carry; +3 BE) / fe 73.89% (carry).
- **C193 (infra): CLAUDE.md orientation refresh (post-C183 drift, C184–C192) — first cycle after the squash→rebase**
  — BALANCE: THREE past budget — `feature` (cyc 170, starved-for 23, blocked 18th cycle) + `arch` (cyc 187, starved-for 6) + `infra`
  (cyc 186, starved-for 7). Feature blocked → among the over-budget actionable, most-starved wins → `infra` (7 > arch 6). The CLAUDE.md
  refresh was DUE (last C183, ~10 cycles) + had real drift to fix after the eventful window (the C190.5 squash→main→rebase + 4 closed
  bugs + a coverage re-measure). Doc-only — no build gate (standing convention; every figure verified vs the C186 measure + the
  C184–C192 ledger). FIXED 4 drifts: (1) coverage C176→C186 (be 82.74→83.41 line / 82.49→83.74 func; fe flat 73.89 — backend-only
  window); (2) suite size ~1236→~1263 BE; (3) BE low-spots — analytics/routes 15→59% (C185) + sync/routes 32→59% (C188) now DONE,
  next = activity-tracker ~44% (timer-bound); (4) closed-bugs line += #26c/#61/#62/#63 + the recurring coverage-theater lesson
  (C181/C182/C185: a green test that re-implements/reconstructs a module locally is NOT real coverage). Left the loop-steering +
  branch hard-rules untouched (accurate + timeless — the squash→rebase IS the documented human-merge workflow, not a drift). NO code
  touched. Next CLAUDE.md refresh ~C203; #5 sweep next ~C196. cov: be 83.41% line / fe 73.89% line (carry, doc-only).
- **C194 (arch): extract `toDate` — the `instanceof Date ? x : new Date(x)` normalization, 4 sites → 1** — BALANCE: THREE past budget
  — `feature` (cyc 170, starved-for 24, blocked 19th cycle) + `arch` (cyc 187, starved-for 7) + `infra` AT budget. Feature blocked →
  most-starved past-budget actionable = `arch` (7). Inline scout (6/3 spawn cap — no fan-out). FOUND: analytics/repository.ts
  hand-repeated `value instanceof Date ? value : new Date(value as unknown as number)` at 4 sites — fuel-monthly (:689), financing
  startDate (:796), term start + end (:1003/:1007). EXCLUDED the `? x.getTime() : 0` / `: Number(x)` sort-comparator variants
  (different fallbacks — the C182-#2 trap). Extracted exported `toDate(value: Date|number|string): Date` (beside the sibling
  monthsOwnedInYear), wired all 4. **tsc EARNED ITS KEEP:** the financing site's local type is `startDate: Date | null`, so toDate's
  non-null param rejected it — surfacing that the original `as unknown as number` cast was masking a null→`new Date(null)`=epoch path.
  Preserved EXACTLY with `toDate(fin.startDate ?? 0)` (startDate is `.notNull()` in schema → null is impossible at runtime anyway; the
  `?? 0` matches the old epoch-on-null behavior). The other 3 sites narrow via their preceding truthy-guards (no cast needed).
  Behavior-preserving (arch rule 2 — identity passthrough for a Date, `new Date` otherwise, exactly as before); anchored by the
  EXISTING fuel-stats + insurance-details + financing analytics tests (green THROUGH the change) + 3 new toDate cases
  (identity-passthrough, epoch-millis, ISO-string) in tco-months-owned.test.ts. green→green: backend validate:local **EXIT 0 — 1266
  pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean, build bundled. ARCH QUEUE empty again — next arch cycle = a fresh rule-7
  scout. cov: be 83.41%+ (carry) / fe 73.89% (carry).
- **C195 (guard): cover activity-tracker's pure `cleanupInactiveUsers` ageout (the 44%-line low spot)** — BALANCE: `feature` PAST
  (cyc 170, starved-for 25, blocked 20th cycle) but blocked → fell through; `guard` most-starved past-budget actionable (cyc 188,
  starved-for 7 > 6 > bug's at-budget 3). Inline (6/3 spawn cap). Steered the ratchet to the named BE low spot `activity-tracker.ts`
  (53.85% func / 44.76% line). Read it firsthand to pick the TRACTABLE slice: `cleanupInactiveUsers` (:126-133) is the only PURE,
  synchronous, timer-free method (the rest — handleInactivity/performAutoSync/performAutoBackup :64-106 — is setTimeout +
  orchestrator-bound, the genuinely-less-clean territory the C186 note flagged + the DB-passthrough catch branches :132-147 need a DB
  seam). The existing C144-era test covered recordActivity/getSyncStatus/stopTracking but NOT the ageout. ADDED 3 cases (via the
  singleton + unique-id + stopTracking-cleanup pattern the file already uses): a NEGATIVE-window cutoff ages out a just-recorded user
  (timing-independent — no fake clock); a large positive window SURVIVES (guard not over-broad); empty-tracker no-op. RESULT:
  cleanupInactiveUsers 0%→covered (uncovered range :126-131 dropped out). HONESTLY left the timer/orchestrator-bound methods +
  DB-catch branches documented as the remaining gap (NOT a clean unit pick — consistent with the C186 caveat). Test-only, no
  production change. green→green: backend validate:local **EXIT 0 — 1269 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean,
  build bundled. NEXT guard low spot: the FE components/routes deficit (needs a fresh FE coverage measure) or a thin FE store/util.
  cov: be 83.41%+ (carry) / fe 73.89% (carry).
- **C196 (bug→ESCALATED #22, then pivoted to the #5 branch-hygiene sweep + coverage re-measure)** — BALANCE: TWO past budget —
  `feature` (cyc 170, starved-for 26, blocked 21st cycle) + `bug` (cyc 192, starved-for 4 > 3). Feature blocked → `bug` forced. But the
  bug queue's clean mechanical fixes are EXHAUSTED — remaining items are decision-gated (#24/#29/#40/#43/#44/#45/#47/#51), approach-gated
  (#33/#34/#58), or scope-gated (#30). The one tempting unblocked item, #22 (zip-bomb guard trusts attacker-declared header.size),
  I investigated firsthand + concluded it's NOT a clean single-cycle fix: AdmZip getData() inflates the whole entry in-memory
  synchronously, so a post-inflation length check is too late (OOM already happened) — a robust fix needs an APPROACH call
  (compression-ratio cap / streaming lib / accept-the-compressed-cap), and exploitability hinges on AdmZip internals I'd be guessing at.
  Per "don't-force-a-blocked-pick" → ESCALATED #22 to Angelo (send_message, 3 approach options + the #51 reminder), then PIVOTED (step
  7) to the cadence-due **#5 sweep** (last C186; balance forced bug over the soft-cadence infra, but the sweep is the highest-leverage
  ACTIONABLE once bug is honestly blocked). THE 3-PART SWEEP: **(1) STRAY SCAN** — no new strays (offline-entries already Angelo-flagged;
  + the expected gitignored harness/config/test-results/mise); branch now a 6-commit post-squash stack (C190–C195), not 138. **(2)
  GREEN + RE-MEASURE** — backend 1269 pass / 0 fail, **be 84.08% line / 84.44% func** (up from C186's 83.41/83.74); frontend 513 pass,
  **fe 73.89% line** (flat — C188–C195 all backend). Captured FRESH FE low spots (a ~15% form-validation module = next clean FE guard
  pick; analytics-api ~36%; sync-manager ~56%) into the coverage-trend header + BACKLOG guard note. **(3) BRANCH_REVIEW.md REFRESH**
  (gitignored) — REFRAMED for the post-squash reality (§1–§25 + C51–C189 are now IN origin/main via "#108"; the reviewable delta is
  the 6 commits C190–C195), appended **§26 (C190–C195: #62/#63 bugs, the providers credential audit, toDate dedup, activity-tracker
  guard, CLAUDE.md refresh)**, status 1245→1269 BE + fresh cov. Doc/measurement-only — NO code change. Next #5 sweep ~C206; CLAUDE.md
  refresh next ~C203. cov: be 84.08% line / fe 73.89% line (RE-MEASURED).
- **C197 (deep-review): audit the reminders mark-serviced / mileage-re-arm vein — CERTIFIED CLEAN (1 false positive debunked)** —
  BALANCE: THREE past budget — `feature` (cyc 170, starved-for 27, blocked 22nd) + `bug` (cyc 192, starved-for 5) + `deep-review`
  (cyc 191, starved-for 6). Feature blocked; bug still honestly blocked (C196 — clean fixes exhausted, #22 escalated) → most-starved
  actionable = `deep-review` (6 > 5). Inline (6/3 spawn cap). Vein: reminders/routes.ts mark-serviced re-arm + trigger-service mileage
  processing (data-integrity — drives WHEN reminders fire; prior findings #16/#47). **CERTIFIED CLEAN (firsthand):** (1) the
  mark-serviced MILEAGE axis (:101) uses `vehicleIds[0]` WITHOUT a length-check — looked like an asymmetry vs the trigger's
  D4 length===1 skip (:380), but VERIFIED it's a FALSE POSITIVE (C150): the single-vehicle invariant is ENFORCED at validation
  (refineMileageTrigger :113-119, "A mileage reminder must be linked to exactly one vehicle", on BOTH create :181 + update :188), so a
  mileage reminder PROVABLY has exactly 1 vehicle by the time mark-serviced runs — `[0]` is safe, the trigger's check is
  belt-and-braces. (2) mark-serviced anchoring (`current ?? lastServiceOdometer ?? 0` → `nextDueOdometer = anchor + interval`) is
  CONSISTENT with resolveMileageFields create-seed (:43-51); the `?? 0` floor is a harmless brand-new-reminder default that
  self-corrects on the first real reading via recheckMileageReminders. **#16 RE-CONFIRMED present** (time-axis advances one period from
  the possibly-past nextDueDate :115 → an overdue mark-serviced can land still-past) — but it's the documented SEMANTICS call
  (catch-up-to-≥now vs one-period), decision-gated, stays filed. NO code change (clean cert + a debunk; #16 not loop-decidable).
  cov: be 84.08% / fe 73.89% (carry, read-only audit).
- **C198 (bug → #64): lease excess-mileage projection treated the ANNUAL limit as the whole-lease allowance** — BALANCE: TWO past
  budget — `feature` (cyc 170, starved-for 28, blocked 23rd) + `bug` (cyc 192, starved-for 6). Feature blocked → `bug` forced. The
  FILED queue is still all gated (#22/#51 escalated, no Angelo answer; rest decision/approach-gated), so per the C189 precedent I
  HUNTED A FRESH bug on an un-scanned surface — FE money math (the #55/#56 displayed-$ class). Inline (6/3 spawn cap). **FOUND #64
  (MED-HIGH, displayed-$, VERIFIED firsthand):** `calculateLeaseMetrics` (frontend financing-calculations.ts:369) compares the
  lifetime `mileageUsed` + `projectedFinalMileage` against `financing.mileageLimit` DIRECTLY — but that field is the ANNUAL limit
  (CONFIRMED: the form labels it "Annual Mileage Limit" FinancingFormSection.svelte:261 + schema.ts:84 comment). So a 36-mo lease at
  12,000 mi/yr (36,000 total allowed) driven a normal 30,000 mi showed ~18,000 PHANTOM excess miles × the per-mile fee = thousands of
  $ of fake excess-mileage fees on the FinanceTab/LeaseMetricsCard. Backend analytics doesn't touch these fields → FE-only, contained.
  FIX: `totalMileageAllowance = mileageLimit × (termMonths/12)` (termMonths .notNull; falls back to the annual value if 0), used in all
  3 comparisons (projected-excess, remaining, init). VERIFY-FIRSTHAND PAID OFF TWICE: (1) confirmed the annual semantics at the
  form+schema before acting (not a false positive); (2) the existing lease-metrics.test.ts had BAKED IN the bug (its 36000 fixture
  treated annual-as-total; even its header said "no product bug found") → reconciled its 5 affected assertions to a realistic 12000/yr
  fixture (→ 36000 term-scaled total, preserving their intent) + added a #64 describe (3 cases pinning annual×years scaling; my own
  first draft over-drove the fixture → caught + corrected the projection arithmetic). green→green: FE validate:local **EXIT 0 — 516
  pass (+6)**, tsc 0, build OK; + CI-only eslint + prettier clean on both touched files. #64 CLOSED. cov: fe 73.89%+ (carry; +6 FE) /
  be 84.08% (carry).
- **C199 (deep-review): audit the FE financing DATE-math vein (continuing the C198 #64 thread) — CERTIFIED CLEAN; 1 guard-pickup filed**
  — BALANCE: TWO past budget — `feature` (cyc 170, starved-for 29, blocked 24th) + `deep-review` (cyc 197, starved-for 6 > 5). Feature
  blocked → `deep-review` forced (most-starved past, 6 > arch's at-budget 5). Inline (6/3 spawn cap). Continued the PROVEN-fruitful FE
  money vein (C198 #64 was here): the date-math functions in financing-calculations.ts (the #39/#53/C103 TZ/off-by-one class). **CERTIFIED
  CLEAN (firsthand):** (1) `calculateNextPaymentDate` (:158) — bounded iteration (maxIterations 1000 → no infinite loop), guarded base
  date, advances by frequency; the monthly setMonth(+1) day-rollover is cosmetic (next-payment display, not displayed-$). (2)
  `calculateDaysUntil` (:465) — getTime() deltas → TZ-independent; ceil is right for "days until." (3) `derivePaymentEntries` (:502) —
  remainingBalance = max(0, original − Σpayments) consistent with the C101-certified backend computeBalance; principal/interest from
  the schedule by index; no div/date hazard. (4) `calculateMinimumPayment` (:475) — standard amortization formula, div-guarded
  (apr>0, term>0, original>0 all checked). (5) `calculatePayoffDateFromStart` (:545) — the month-overflow clamp VERIFIED correct
  firsthand: Jan-31 + 1mo → new Date(y,1,31) rolls to Mar 3, the guard `payoff.getDate() !== start.getDate()` fires (only on genuine
  overflow — a non-overflow preserves the day exactly), `setDate(0)` → Feb 28; handles month>12 via Date normalization. **GUARD-PICKUP
  FILED: `calculatePayoffDateFromStart` is correct but UNPINNED** (no test — the C196 :540-547 uncovered range; the C54/C77
  traced-clean-but-uncovered class) — a subtle date clamp a refactor could silently break → primed for the next FE guard cycle.
  NO code change (clean cert; deep-review = find-not-fix). cov: fe 73.89% / be 84.08% (carry, read-only audit).
- **C200 (arch): extract `sortByVehicleThenDate` — the (vehicleId, date) fuel-row sort, 3 sites → 1** — BALANCE: TWO past budget —
  `feature` (cyc 170, starved-for 30, blocked 25th — milestone cycle) + `arch` (cyc 194, starved-for 6 > 5). Feature blocked → `arch`
  forced (most-starved past, 6 > guard's 5). Inline scout (6/3 spawn cap). FOUND: the ENTIRE `[...fuelRows].sort((a,b) => { vehicleId
  localeCompare; then date getTime })` comparator block was hand-duplicated BYTE-FOR-BYTE at 3 analytics/repository.ts sites
  (:1283/:1436/:2048 — the per-vehicle MPG/cost/odometer-progression pre-sorts). EXCLUDED the `:923-930` latest-term sort (different
  `: 0` fallback + a startDate tiebreak — the C194/C182-#2 trap). Extracted `sortByVehicleThenDate<T extends {vehicleId; date:
  Date|number|null}>(rows): T[]` to analytics-charts.ts beside forEachVehiclePair/groupByVehicle (the per-vehicle pairing family it
  feeds). Behavior-preserving (arch rule 2): VERIFIED the date-key `instanceof Date ? getTime() : Number(x)` is kept VERBATIM (not
  swapped to toDate().getTime() — confirmed firsthand FuelExpenseRow.date is `Date|number|null`, never a string, so number=epoch-ms +
  Number(null)=0 are unchanged; toDate would have changed the null path). Returns a COPY (matches `[...rows]`). Test-anchored by the
  EXISTING analytics property/fuel-stats/cross-vehicle suites (green THROUGH the 3 substitutions) + 3 new cases in
  analytics-charts-unpinned.test.ts (group+date-order; no-mutation; numeric/null date handling). One biome import-sort autofixed.
  green→green: backend validate:local **EXIT 0 — 1272 pass / 1 skip / 0 fail (+3)**, tsc 0, musl-biome clean, build bundled. ARCH QUEUE
  empty again — next arch cycle = a fresh rule-7 scout. cov: be 84.08%+ (carry) / fe 73.89% (carry).
- **C201 (guard): cover expense-form-validation.ts (the ~15% FE low spot — amount/volume/charge/mileage branches)** — BALANCE: only
  `feature` strictly PAST budget (cyc 170, starved-for 31, blocked 26th) but blocked → fell through; `guard` + `bug` both AT budget
  (6=6 / 3=3, due). Took `guard` via the PRIMED C196 pick (the ~15% form-validation module) — higher-confidence than a fresh hunt.
  Inline (6/3 spawn cap). IDENTIFIED it firsthand as `expense-form-validation.ts` (127 lines; the C196 :42/48-126 uncovered range; C103
  covered only the date slice). +19 cases in a new expense-form-validation-fields.test.ts (PURE — ValidationContext in, error-or-null
  out): required vehicleId/category, amount bounds (>0, ≤999999), the fuel-vs-charging UNIT GATING (electric fuelType → charge branch,
  liquid → volume branch), fuelType length, and — the load-bearing one — `validateMileage`'s MONOTONICITY check (a fuel entry's odometer
  must sit strictly between the nearest earlier/later-dated entries; + the edit-self-exclusion). VERIFY-FIRSTHAND PAID OFF: my first
  draft used `fuelType:'electric'` but isElectricFuelType matches the EXACT case-sensitive ELECTRIC_FUEL_TYPES members ('Electric',
  'Level 2 (AC)', …) — caught the 2 failures in isolation + fixed to 'Electric' (the C150 assume-nothing class). expense-form-validation
  ~15%→well-covered. green→green: FE validate:local **EXIT 0 — 535 pass (+19)**, tsc 0, build OK; + prettier (auto-fixed tabs) + eslint
  clean on the new file. cov: fe 73.89%+ (carry; +19 FE) / be 84.08% (carry). The C199-primed calculatePayoffDateFromStart remains the
  NEXT FE guard pick.
- **C202 (bug #65): offline-storage legacy-clientId backfill minted a FRESH UUID on every read → duplicate-expense idempotency hole**
  — BALANCE: `feature` most-starved (cyc 170, starved-for 32, blocked 27th) but blocked → fell through; `bug` forced (cyc 198,
  starved-for 4 > 3 — most-starved over-budget actionable). Filed bug queue is all decision/approach-gated (#22/#24/#29/#30/#33/#34/
  #40/#43/#44/#45/#47/#51/#58) → hunted a FRESH bug per the C189/C198 precedent. Inline (6/3 spawn cap). HUNTED the FE offline/sync
  data-safety vein (NORTH_STAR #1, never deeply scanned). FOUND + VERIFIED firsthand: `loadOfflineExpenses` (offline-storage.ts:48-58)
  backfills a pre-v3 entry's missing clientId with `expense.clientId ?? crypto.randomUUID()` BUT returns the migrated array WITHOUT
  persisting — and the migration re-runs on every read of a not-yet-persisted legacy entry, so it mints a DIFFERENT UUID each call.
  clientId IS the offline-POST idempotency key (offline-storage.ts:160 / sync-manager.ts:222), so a legacy entry whose first sync POST
  commits server-side but loses its response gets re-read with a fresh key on the next run → the server's clientId-dedup can't match →
  DUPLICATE expense row + double-counted TCO. The doc comment (lines 11-12) explicitly promises a STABLE key — the code broke its own
  contract. FIX (deterministic, minimal, behavior-preserving for v3, NO write-on-read side-effect — safe since +layout.svelte:67 reads
  it once in onMount, not a $derived/$effect): backfill from the entry's own stable+unique `id` (`expense.clientId ?? expense.id`) — same
  key every read → server dedups correctly. VERIFIED the existing sync-manager/sync-offline-expenses tests' setItem-call-index assertions
  tolerate it (no write-on-read added) before editing. Guard: +2 in offline-storage.test.ts — (1) the load-bearing read-twice→SAME-clientId
  stability invariant (the #65 regression), (2) an existing-clientId-never-re-minted control. green→green: FE validate:local **EXIT 0 —
  537 pass (+2)**, tsc 0, build OK; + prettier + eslint clean on both touched files. cov: fe 73.89%+ (carry; +2 FE) / be 84.08% (carry).
- **C203 (infra): #5 branch-hygiene sweep + coverage re-measure (last sweep C196, branch 13 commits deep)** — BALANCE: `feature`
  most-starved (cyc 170, starved-for 33, blocked 28th) but blocked → fell through; `infra` FORCED (cyc 196, starved-for 7 > 6 — the only
  other over-budget category, exactly the C202 forecast). The standing #5 cadence sweep. (1) STRAY-TEST CHECK CLEAN: zero untracked
  unit/spec `.test.ts` — all untracked are the by-design `*.meshclaw.e2e.ts` set + e2e screenshots/snapshots/results + playwright config +
  `.meshclaw-tools/` harness + `mise.local.toml`. ONE observation logged (not acted on): `.kiro/specs/offline-entries/` is the only
  untracked spec dir (every other `.kiro/specs/*` is committed) — a pre-loop doc dated Jun 5, untouched since, NOT a test (doesn't drop
  coverage on merge), not loop-authored → left as-is, noted in BRANCH_REVIEW. (2) GREEN BASELINE + RE-MEASURE: backend `bun test
  --coverage` EXIT 0 (1272 pass / 1 skip / 0 fail) — be 84.06% line / 84.43% func (FLAT vs C196's 84.08/84.44; C198/C201/C202 all FE, only
  C200 touched BE); frontend `vitest --coverage` EXIT 0 (537 pass) — fe 77.79% line / 75.57% func / 72.96% branch (UP SHARPLY +3.9 line /
  +2.0 func / +6.9 branch vs C196 — the C198 lease-metrics + C201 form-validation [+19] + C202 offline-storage [+2] FE ratchet DELIVERED;
  the BE↔FE gap narrowed to ~6pts). (3) BRANCH_REVIEW.md REFRESH (gitignored): header scope 6→13 commits (C190–C202), status block to
  1272 BE / 537 FE + the C203 coverage, appended §27 (C196–C202: the FE-weighted arc — #64 lease-$ + #65 offline-idempotency bugs, the
  C201 form-validation guard, C200 sortByVehicleThenDate dedup, C197/C199 deep-review certs), fixed the stale "116 themed commits" →
  "13 commits (C190–C202)" in Suggested-merge + refreshed the arc paragraph. Doc/measurement-only, no product code. Next sweep ~C213;
  next CLAUDE.md refresh ~C203-onward (last C193). cov: be 84.06% / fe 77.79% (FRESH C203 reading).
- **C204 (deep-review → #66): offline-created ELECTRIC charge silently dropped on sync (fuelType never carried in the outbox)** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 34, blocked 29th) but blocked → fell through; `deep-review` AT budget (cyc 199, starved-for
  5 = 5, due) → the most-starved actionable. Inline focused review (spawn cap/flake — C179/C189/C199 precedent). SURFACE: the FE
  api-transformer (toBackendExpense/fromBackendExpense), the FE↔BE expense serialization seam every create/update/offline-sync flows
  through (the C202 #65 hunt touched it but never audited it); pure-`.ts` → reviewable + unit-testable without eyes-on. The transform reads
  CLEAN (symmetric volume/charge gating, 0-value edge handled, every field mapped) — BUT tracing it against the offline path surfaced a real,
  reachable, HIGH data-safety bug (#66, NORTH_STAR #1 + #2/EV-correctness). VERIFIED FIRSTHAND end-to-end: (1) toBackendExpense decides
  volume-vs-charge SOLELY via isElectricFuelType(fuelType); (2) the `OfflineExpense` type had NO fuelType field + BOTH ExpenseForm.svelte
  addOfflineExpense sites (:565/:605) omit it (even though :601 just computed it); (3) the 2 sync-transform callers (offline-storage
  syncOfflineExpenses + sync-manager) call toBackendExpense WITHOUT fuelType. Net: an offline ELECTRIC charging expense (charge set,
  fuelType absent) → isElectricFuelType(undefined)=false → the volume-only else-branch → volume undefined → the CHARGE IS SILENTLY DROPPED
  from the POST (broken mi/kWh + cost/charge); AND every offline-synced expense loses its fuelType label. The offline fuel-validation
  (volume OR charge) lets a charge-only electric entry through into the lossy transform. FIX (root-cause, threads fuelType end-to-end):
  added fuelType? to OfflineExpense + carried it through all 4 propagation sites (both addOfflineExpense outbox objects + both
  toBackendExpense sync callers + the resolveConflict keep_local path). GUARDS (+5): api-transformer.property.test.ts — the discriminant
  REGRESSION (electric WITHOUT fuelType drops charge — documents the bug) + WITH fuelType maps charge→volume + Level-2(AC) + a liquid-fuel
  negative control; offline-storage.test.ts — addOfflineExpense persists fuelType into the outbox. green→green: FE validate:local EXIT 0 —
  542 pass (+5), tsc 0, build OK; prettier (auto-fixed the .svelte reflow) + eslint clean on all touched files. HONEST CAVEAT: root-cause
  data-loss fixed + unit-pinned end-to-end; the .svelte change is mechanical data-passing (tsc/build-verified, no markup), but the full
  offline-create→sync→render round-trip for an electric charge is Playwright-eyes-on-BLOCKED here → lands code-complete/eyes-on-pending per
  the feature-DoD rule, correctness locked by the transform + outbox unit guards. cov: fe 77.79%+ (carry; +5 FE) / be 84.06% (carry).
- **C205 (arch): extract offlineExpenseToBackend — the OfflineExpense→toBackendExpense mapping, 3 sites → 1** — BALANCE: `feature`
  most-starved (cyc 170, starved-for 35, blocked 30th — milestone) but blocked → fell through; `arch` AT budget (cyc 200, starved-for 5 = 5)
  was the most-starved actionable (longer-waiting than `bug` at 3). Inline scout (arch queue empty; spawn cap/flake — C194/C200 precedent).
  STRONG fresh lead from C204: the OfflineExpense→toBackendExpense field-mapping block was copy-pasted at 3 sync sites (offline-storage
  syncOfflineExpenses + sync-manager syncSingleExpense + resolveConflict keep_local) — and that drift is EXACTLY how #66 happened (fuelType
  added to the online path, missed in the duplicated offline copies). VERIFIED firsthand all 3 map the same 10 fields, differing only in a
  defensive `tags || []` no-op (tags is a required string[] on OfflineExpense) + the source var (expense vs conflict.localExpense) → behaviorally
  identical. Extracted exported `offlineExpenseToBackend(e: OfflineExpense)` to offline-storage.ts (beside the type it maps) + wired all 3 +
  removed the now-dead `toBackendExpense` + `ExpenseCategory` imports from sync-manager (biome/eslint noUnusedVariables — confirmed clean).
  PAYOFF (NORTH_STAR #6 + concrete regression-prevention): collapses the triplication that bred #66 so a future field can't be carried in one
  copy and forgotten in another. Test-anchored (arch rule 3): the EXISTING sync-manager + sync-offline-expenses suites green THROUGH the
  substitution + 3 new direct helper tests (core field mapping; the electric-charge #66 invariant at the dedup boundary; liquid-fuel control).
  CAUGHT + FIXED a test-mock gap firsthand (verify-in-isolation paid off): sync-manager.test.ts `vi.mock('../offline-storage')` stubbed only 4
  fns, so the new helper was undefined → 3 failures; fixed with importActual to keep the REAL pure mapper (stubbing it would assert against a
  fake transform) — a net IMPROVEMENT (the test now exercises the genuine transform). green→green: FE validate:local EXIT 0 — 545 pass (+3),
  tsc 0, build OK; prettier (auto-fixed the helper-signature reflow) + eslint clean on all touched files. cov: fe 77.79%+ (carry; +3 FE) /
  be 84.06% (carry).
- **C206 (bug → #67): re-financing a paid-off vehicle silently produced an INACTIVE record (upsert never re-activates)** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 36, blocked 31st) but blocked → fell through; `bug` FORCED (cyc 202, starved-for 4 > 3 —
  most-starved over-budget actionable, the C205 forecast). Filed bug queue all decision/approach-gated → hunted a FRESH bug per the
  C189/C198/C202/C204 precedent. The offline/sync vein is now deduped + twice-audited, so I PIVOTED to a fresh surface: the financing
  WRITE path (un-hunted for the C189 create/update-asymmetry class). FE pure-utils (chart-formatters/formatters) read CLEAN; rejected two
  LATENT-but-guarded boundaries firsthand (C21/C77 discipline — did NOT inflate into a forced bug): (a) financingRepository.findByVehicleId
  is NOT userId-scoped, but vehicleFinancing has NO userId column [ownership is transitive via vehicleId→vehicles FK, by design] + every
  caller validates vehicle ownership first → no live leak; (b) the loan↔lease upsert leaves stale type-specific cols [apr on a now-lease],
  but every read gates on financingType → latent, not a live displayed-value bug [noted for a future cycle]. THE LIVE ONE — #67, VERIFIED
  firsthand end-to-end: POST /vehicles/:id/financing is a create-or-REPLACE keyed on vehicleId; when a prior row exists it reuses it via
  `update(existing.id, {...financingData})`. `isActive` is .optional() in the create schema (a .notNull().default(true) col → drizzle-zod
  omits it) AND the VehicleForm financing payload (VehicleForm.svelte:420-449) NEVER sends it → so re-financing a vehicle whose prior
  financing was paid off (isActive=false via PUT /payoff or DELETE) reused that row and LEFT isActive=false → the new ACTIVE loan/lease was
  silently dropped from findActiveFinancing + loanBreakdown/analytics (:863 filters f.isActive) + the FE's `vehicle.financing?.isActive`
  gate → the user's real financing vanished from TCO/analytics. FIX (root-cause, behavior-preserving for the normal edit): on the upsert
  update branch, set `isActive: true` + `endDate: null` (mirrors how create() defaults isActive=true; a still-active record stays active =
  idempotent; clears a stale payoff/lease-end date). +2 HTTP tests in financing-get-contract.test.ts (the #67 regression: payoff → re-finance
  → isActive true; + an already-active-update idempotent control). NON-VACUOUS: confirmed the regression FAILS RED with the fix reverted
  (isActive stayed false) then GREEN restored (the C77 anti-vacuity check). green→green: backend validate:local EXIT 0 — 1274 pass / 1 skip
  / 0 fail (+2), tsc 0, musl-biome clean, build bundled. cov: be 84.06%+ (carry; +2 BE) / fe 77.79% (carry).
- **C207 (guard): cover calculatePayoffDateFromStart — the vehicle-form payoff-date month-overflow clamp** — BALANCE: `feature`
  most-starved (cyc 170, starved-for 37, blocked 32nd) but blocked → fell through; `guard` AT budget (cyc 201, starved-for 6 = 6, due) →
  the most-starved actionable (the C206 forecast). Took the C199-PRIMED pick — `calculatePayoffDateFromStart` (financing-calculations.ts:545,
  the VehicleForm amortization-preview payoff date), VERIFIED-correct firsthand at C199 but with ZERO test coverage (confirmed: only the source
  + the VehicleForm caller reference it). The load-bearing logic is a subtle month-overflow CLAMP: `new Date(y, startMonth+n, startDay)` rolls
  a day past the target month's length INTO the next month (Jan 31 + 1mo → Mar 3, Feb has no 31st), so it detects the rolled day
  (`getDate() !== start.getDate()`) + `setDate(0)`s back to the intended month's last day — exactly the date arithmetic a refactor silently
  breaks. Created payoff-date-from-start.test.ts (+12): the clamp (Jan31+1→Feb28; leap→Feb29; Aug31+1→Sep30; May31+1→Jun30), no-clamp paths
  (mid-month exact day; 0 payments; the 28th never overflows), year-rollover (Mar15+12→next-year; Oct15+6 crosses; Dec31+2 rolls year AND
  clamps → Feb28 2025), + the real date-only-STRING call path with timezone-ROBUST relative assertions (payoff > start, year lands; the C103/C77
  UTC-parse trap — Date-OBJECT inputs for the exact-field cases so getMonth/getDate read the same frame the fn constructs). VERIFY-FIRSTHAND:
  ran in isolation FIRST — all 12 green, my reasoned clamp values (Feb 28/29, Sep 30, Dec31+2→Feb28-2025) confirmed correct. green→green:
  FE validate:local EXIT 0 — 557 pass (+12), tsc 0, build OK; prettier + eslint clean on the new file. Test-only, no production change.
  cov: fe 77.79%+ (carry; +12 FE) / be 84.06% (carry). Next FE guard pick (no primed): analytics-api.ts ~36% func or auth.ts ~56%.
- **C208 (infra): CLAUDE.md orientation refresh (post-C193 drift, C194–C207)** — BALANCE: `feature` most-starved (cyc 170, starved-for 38,
  blocked 33rd) but blocked → fell through; nothing else strictly OVER budget → highest-leverage pick. `infra` was the most-starved actionable
  (cyc 203, starved-for 5) AND the CLAUDE.md refresh was concretely due (last C193, ~15 cycles of real drift — a fresh agent reading stale
  figures re-plans done work). Fixed 3 actively-misleading drifts, each VERIFIED vs source/LEDGER (the C93/C145/C193 doc-refresh discipline —
  fix what misleads, don't churn): (1) COVERAGE — the C186 reading (be 83.41/83.74, fe 73.89/73.61/66.08) → the FRESH C203 re-measure (be
  84.06% line / 84.43% func · fe 77.79% line / 75.57% func / 72.96% branch); added C201/C207 to the FE-ratchet list + re-pointed the next FE
  low spots (analytics-api ~36%, auth ~56%, sync-manager ~56% — form-validation/payoff now done). (2) SUITE SIZE ~1263 BE / ~513 FE → 1274 BE /
  557 FE. (3) CLOSED-BUG list ended at #63 → appended #64 (lease excess-mileage annual×term, C198) + #65 (offline legacy-clientId fresh-per-read
  dup hole, C202) + #66 (offline electric charge dropped on sync, C204) + #67 (re-finance → inactive record, C206); range C155–C192 → C155–C206.
  Doc-only, no code → no build gate (the C93/C131/C145/C193 precedent). Next CLAUDE.md refresh ~C220; next #5 branch-hygiene sweep ~C213 (last
  C203). cov: be 84.06% / fe 77.79% (carry, C203 reading).
- **C209 (deep-review → #68): restore coerceRow truncated a thousands-separated number (parseInt stops at the comma)** — BALANCE: `feature`
  most-starved (cyc 170, starved-for 39, blocked 34th) but blocked → fell through; `deep-review` AT budget (cyc 204, starved-for 5 = 5, due) →
  the most-starved actionable (the C208 forecast). Inline focused review (spawn cap/flake — C179/C204 precedent). SURFACE: the restore-path
  per-field coercion `coerceRow` (backup.ts:70) — THE data-safety surface (NORTH_STAR #1), flagged in the C146 money-cents spec as a latent
  crux + never directly audited (C108/C136/C144 covered cross-tenant + empty-replace + mid-run-change, not the coercion). FOUND + VERIFIED
  firsthand end-to-end: the INTEGER branch did `Number.parseInt(strVal, 10)`, which STOPS at the first non-digit. The Google Sheets restore
  reads cells via `values.get` with NO valueRenderOption → defaults to FORMATTED_VALUE (google-sheets-service.ts:622), so a thousands-separated
  odometer/mileage comes back as the string "12,345" → parseInt → 12 (a 1000x SILENT corruption — 12 is not NaN, so it passed straight
  through; mileage/odometer/initialMileage all confirmed `integer` columns). The REAL branch had the same hazard (parseFloat("1,234.56")→1).
  CONFIRMED the CSV path writes raw integers with NO separators (convertToCSV:451), so a VROOM-own-export round-trip never hit it — but the
  Sheets path does. FIX (minimal, complete, behavior-preserving for valid input): strip grouping commas + a STRICT whole-string parse
  (`Number(strVal.replace(/,/g,''))`, which unlike parseInt rejects a "12abc" tail to NaN→null, matching the existing garbage→null contract;
  Math.round on INTEGER so a Sheets "12345.0" lands whole). Did NOT unilaterally switch the Sheets read to UNFORMATTED_VALUE (deeper, separate)
  — the coercion-layer fix is complete + covers CSV too. +5 tests in backup.test.ts (INTEGER "12,345"→12345 [the regression]; "45000.0"→45000;
  "12abc"→null [strict]; REAL "1,234.56"→1234.56; plain "50" CSV-round-trip unchanged); the existing per-table Zod re-validation block still
  green. NON-VACUOUS: confirmed the INTEGER regressions FAIL RED with the fix reverted (12,345→12) then GREEN restored. DE-RISKS the money-cents
  migration (the C146-named parseInt crux). green→green: backend validate:local EXIT 0 — 1279 pass / 1 skip / 0 fail (+5), tsc 0, musl-biome
  clean, build bundled. cov: be 84.06%+ (carry; +5 BE) / fe 77.79% (carry).
- **C210 (bug → #70 fixed; #69 escalated): insurance /expiring-soon `days` param unguarded → NaN → Invalid Date → silently empty** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 40, blocked 35th) but blocked → fell through; `bug` FORCED (cyc 206, starved-for 4 > 3 — over
  budget; arch was AT-budget 5=5, not strictly over, so bug's tighter budget tipped it first). Fresh hunt. FIRST pursued the #68 parseInt/parseFloat
  CLASS-SWEEP (the C41/#48 pattern) — swept all BE parseInt/parseFloat sites: the query-param + import-time-parse sites are guarded/bounded
  (import-mapping `||0` + buildLocalDate echo-check; body-limit; pagination) → NO comma-truncation class repeat (C21/C77 — did not force it). PIVOTED
  to the insurance write/route surface. FOUND TWO: (a) #69 (SEMANTICS, escalated — see below); (b) #70 (CLEAN, decision-free — the forced-bug fix).
  #70 VERIFIED firsthand end-to-end: GET /insurance/expiring-soon read `days` via `Number.parseInt(c.req.query('days')||'30',10)` with NO
  finite-guard — UNLIKE its SIBLING `limit` two lines down (guarded `Number.isFinite(x) ? clamp : 100`). So `?days=<non-numeric>` → NaN →
  `endDate = new Date(now + NaN*86400000)` = Invalid Date → findExpiringTerms' `between(endDate, now, InvalidDate)` matched NOTHING → the
  "expiring soon" nag SILENTLY returned ZERO expiring policies → a user misses an insurance-renewal reminder (NORTH_STAR #2). The asymmetry
  (limit guarded, days not, right beside each other) is the tell — the C189 create/update-asymmetry class applied to sibling params. FIX
  (decision-free, mirrors the sibling): `Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays,1),366) : 30`. +4 HTTP tests in a new
  expiring-soon-http.test.ts (default finds a ~20-day term; the `?days=abc` REGRESSION falls back to 30 + still finds it; `?days=45` honored;
  `?days=99999` clamps to 366). NON-VACUOUS: confirmed the regression FAILS RED with the guard reverted (daysAhead NaN, term vanished) then GREEN
  restored. green→green: backend validate:local EXIT 0 — 1283 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean, build bundled.
  **#69 (consistency, ESCALATED C210 — NOT auto-fixed, it's a semantics call) — a monthly-only insurance term (monthlyCost set, totalCost null)
  shows in the analytics insurance card (effectiveMonthlyPremium honors monthlyCost) but materializes NO expense row (createTermExpenses guards
  `totalCost > 0`) → ABSENT from vehicle TCO/$-per-month → same cost, two headline numbers.** Verified firsthand (schema both nullable :137-138;
  analytics-charts effectiveMonthlyPremium:176 returns monthlyCost directly; routes :84/:176 gate materialization on totalCost>0). send_message
  options: materialize monthlyCost×term-months as one lump (TCO==analytics) / N monthly rows / leave analytics-only + document. Awaiting Angelo;
  did NOT block. cov: be 84.06%+ (carry; +4 BE) / fe 77.79% (carry).
- **C211 (arch): extract parseClampedInt — the insurance /expiring-soon days/limit parse-clamp, 2 sites → 1 (the #70 divergence)** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 41, blocked 36th) but blocked → fell through; `arch` FORCED (cyc 205, starved-for 6 > 5 — the
  C210 forecast). Inline scout (queue empty; spawn cap/flake). SCOUTED THOROUGHLY + REJECTED several as churn (the C75/C99 discipline — arch
  rule 5): the FE query-string builders (analytics buildQuery / reminder-api / expense-api / api-client) have GENUINELY DIVERGENT inclusion
  rules (`value != null` vs truthy-`if` vs field-specific — the C69 "looks identical, diverges" trap, esp. empty-string/falsy edges); the
  ~57 `logger.error({error: instanceof…})` sites are EXPLICITLY excluded by the C147 error-handling.ts doc comment ("the structured-log shape,
  NOT a value extraction — converging is a separate larger call") → re-deciding that without new cause is churn; clampPagination operates on
  pre-parsed numbers (no NaN-guard) — a different concern. THE clean pick: parseClampedInt — the `Number.parseInt(raw) + Number.isFinite ?
  clamp : fallback` idiom was hand-rolled at the 2 insurance /expiring-soon sites (days + limit), and that copy-paste is EXACTLY how #70
  happened (limit carried the finite-guard, days was written without it). CONCRETE PAYOFF (arch rule 5 + the C205 "the dup caused the bug →
  dedup it" logic): one tested helper so the guard can't be present on one param and forgotten on its sibling. Extracted
  `parseClampedInt(raw, fallback, min, max)` to utils/calculations.ts (beside getPeriodStartDate, the shared-route-helper home) + wired both
  sites (days→30/1..366, limit→100/1..200). Test-anchored (rule 3): the C210 expiring-soon-http.test.ts stayed GREEN through the substitution
  (behavior-preserving proof) + 6 new unit tests (valid/in-range; undefined→fallback; non-numeric→fallback [the #70 guard]; above-max + below-min
  clamp; the parseInt trailing-unit-vs-leading-non-digit semantics documented). green→green: backend validate:local EXIT 0 — 1289 pass / 1 skip /
  0 fail (+6), tsc 0, musl-biome clean, build bundled. cov: be 84.06%+ (carry; +6 BE) / fe 77.79% (carry). ARCH QUEUE empty.
- **C212 (guard): cover analytics-api.ts (the ~36%-func FE low spot — 13 method wirings + getDefaultDateRange + buildQuery)** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 42, blocked 37th) but blocked → fell through; nothing else strictly OVER budget → highest-leverage
  pick; `guard` was the most-starved actionable (cyc 207, starved-for 5 — the C211 forecast). Took the primed FE low spot: analytics-api.ts ~36%
  func — the ONE FE service the C137/C143/C149/C163/C169 "service layer 100%" arc left behind. IDENTIFIED firsthand: the existing test covered
  ONLY getSummary() (its 404/network fallback control flow — well-pinned); the 12 other method→endpoint wrappers + the pure exported
  getDefaultDateRange + buildQuery's inclusion-rule edges were entirely uncovered (= the gap). +19 cases: getDefaultDateRange (unix-SECONDS not ms;
  start exactly 1yr before end same month/day; end at-not-after now), the 13 method wirings (exact path + query, mirroring the C149 expense-api
  pattern — incl. the no-query bare-path methods financing/insurance + the optional-param buildQuery edges: getFuelStats omits undefined
  vehicleId / getVehicleTCO + getYearEnd omit absent year, none emit a stray "?"), + a verbatim-return check. VERIFY-FIRSTHAND: ran in isolation
  FIRST — 24 green (was 5, +19), my getDefaultDateRange seconds/one-year assumptions confirmed empirically. green→green: FE validate:local EXIT 0
  — 576 pass (+19), tsc 0, build OK; prettier + eslint clean. Test-only, no production change. analytics-api ~36%→well-covered. cov: fe 77.79%+
  (carry; +19 FE) / be 84.06% (carry). Next FE guard low spot: auth.ts ~56% / sync-manager.ts ~56% (timer/network-bound — less clean).
- **C213 (infra): #5 branch-hygiene sweep + coverage re-measure (last sweep C203, branch 23 commits deep)** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 43, blocked 38th) but blocked → fell through; nothing else strictly OVER budget → highest-leverage pick. `infra` was
  the most-starved actionable (cyc 208, starved-for 5) AND the #5 sweep was concretely due (last C203, ~10 cycles / 23 commits — the C212
  forecast). (1) STRAY-TEST CHECK CLEAN: zero untracked unit/spec `.test.ts` — all untracked are the by-design `*.meshclaw.e2e.ts` set +
  e2e screenshots/snapshots/results + playwright config + `.meshclaw-tools/` + `mise.local.toml` + the pre-loop `.kiro/specs/offline-entries/`
  doc (unchanged since C203). (2) GREEN BASELINE + RE-MEASURE: backend `bun test --coverage` EXIT 0 (1289 pass / 1 skip) — be 84.14% line /
  84.49% func (up slightly from C203's 84.06/84.43 — the C206/C209/C210/C211 BE additions); frontend `vitest --coverage` EXIT 0 (576 pass) —
  fe 79.22% line / 78.89% func / 73.52% branch (UP +1.4 line / +3.3 func vs C203 — the C207 payoff-date + C212 analytics-api FE ratchet; the
  BE↔FE gap is NEARLY CLOSED, 84 vs 79). (3) BRANCH_REVIEW.md REFRESH (gitignored): header scope 13→23 commits (C190–C212), status block to
  1289 BE / 576 FE + the C213 coverage, appended §28 (C203–C212: the balanced arc — #66 offline-electric-charge + #68 restore-comma-truncation
  [2 HIGH data-safety], #67/#70 + the C205/C211 dedups-that-collapsed-the-bug-they-just-fixed, the C207/C212 guard ratchet that closed the FE
  service layer, #69 escalated), fixed the stale "13 commits" → "23 commits (C190–C212)" in Suggested-merge. Doc/measurement-only, no product
  code. Next sweep ~C223; next CLAUDE.md refresh ~C220 (last C208). cov: be 84.14% / fe 79.22% (FRESH C213 reading).
- **C214 (bug → #71): mileage-reminder recheck was CREATE-only — an EDIT crossing a milestone didn't fire until the next /trigger** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 44, blocked 39th) but blocked → fell through; `bug` FORCED (cyc 210, starved-for 4 > 3 — the C213
  forecast). Hunted a FRESH surface (offline/sync + restore-coercion + insurance-route veins each already mined+deduped). SCOUTED SIX surfaces
  firsthand + REJECTED each as not-a-clean-live-bug (C21/C77 — did NOT manufacture one): CSV export (neutralizeCsvRow guards the human-facing
  path; backup convertToCSV unguarded is the DOCUMENTED round-trip exemption, not a bug); year-end costPerDistance (windowed max−min distance is
  the ratified approximation, the #45 family — gated); getQuickStats ytdSpending (C161-clean); the cost-per-mile fencepost (current.expenseAmount
  ÷ miles-since-previous is applied UNIFORMLY across both paths → a defensible convention, not a divergence; flipping it is a semantics call).
  THE clean one — #71, the filed "Mileage Finding A/B" (VERIFIED C108, deferred for ORDERING not gating — a decision-free fix): VERIFIED firsthand
  that recheckMileageReminders is wired on odometer CREATE (:131) + expense CREATE (:573) but NOT on either PUT (expense :658, odometer :149), so
  editing a reading UP across a reminder's milestone silently did NOT fire until the next /trigger/login — the D5 "fires the moment crossed"
  guarantee held for creates but not EDITS. FIX (mirror the create-path best-effort recheck, never-throws/idempotent): expense PUT → recheck on
  the UPDATED vehicleId when mileage != null (handles a vehicle-reassign edit too); odometer PUT → unconditional recheck (every entry is a
  reading). +2 HTTP tests in recheck-on-write.test.ts (edit odometer 34000→35200 across a 35000 milestone fires; edit expense mileage
  34000→35500 fires) — NON-VACUOUS: confirmed both FAIL RED with the fixes reverted (edit didn't fire) + the 5 create-path tests stayed green
  (fix is additive). green→green: backend validate:local EXIT 0 — 1291 pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean, build bundled.
  cov: be 84.14%+ (carry; +2 BE) / fe 79.22% (carry).
- **C215 (deep-review → #72): photos list/pagination certified CLEAN; closed the lone non-userId-scoped read method** — BALANCE: `feature`
  most-starved (cyc 170, starved-for 45, blocked 40th — milestone) but blocked → fell through; `deep-review` FORCED (cyc 209, starved-for 6 > 5
  — the C214 forecast). Inline focused review (spawn cap/flake — C179/C204/C209 precedent). SURFACE: the photos list/pagination path (C132/C167
  covered cross-tenant delete/serve + nosniff, NOT the list/paginate queries). CERTIFIED CLEAN firsthand: validateEntityOwnership gates every
  list/serve/delete via an EXHAUSTIVE switch (vehicle/insurance_policy/insurance_claim/expense/odometer_entry each ownership-checked) + a
  `default` that THROWS ValidationError — so an arbitrary entityType string (the route's `min(1).max(64)` is just a length bound) can't slip past;
  the batch endpoint listPhotosByEntityType is userId-scoped (findByUser); nosniff + CORP + private-cache headers correct (C133/#35). ONE finding
  → #72 (defense-in-depth, the C168/#48 + C180 + C192 tenant-scope-at-the-read class): `findByEntityPaginated` (backs GET /:entityType/:entityId)
  filtered (entityType, entityId) ALONE on BOTH legs — the LONE photo read-method not userId-scoped, even though photos carries user_id + every
  sibling (findByUser/countByUser/findIdsByUser) filters on it. NOT a live leak (the route's validateEntityOwnership proves ownership before the
  query) but a latent boundary — and directly fixable here (unlike financing's no-userId-column case at C206 which I correctly DECLINED). FIX:
  threaded userId param + ANDed `eq(photos.userId, userId)` into the shared whereClause (covers both count + data legs) + threaded userId through
  the one caller (listPhotosForEntity). +2 tests in photo-user-scoped.property.test.ts — the load-bearing cross-tenant case (two users' photos on
  the SAME entityType+entityId, raw-seeded — only constructible by direct seed; foreign photo excluded from BOTH count & data) + an owner-still-
  sees-theirs over-filter control. NON-VACUOUS: confirmed the cross-tenant test FAILS RED with the scope reverted (count 3 not 2) then GREEN
  restored. green→green: backend validate:local EXIT 0 — 1293 pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean, build bundled. cov: be
  84.14%+ (carry; +2 BE) / fe 79.22% (carry).
- **C216 (arch): extract calendarYearRange — the [Jan1, nextJan1) year-boundary Date pair, 3 sites → 1** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 46, blocked 41st) but blocked → fell through; nothing else strictly OVER budget → highest-leverage; `arch` was the
  most-starved actionable (cyc 211, starved-for 5 = 5, due). Inline scout (queue thin). FOUND a clean one: the `new Date(year, 0, 1)` /
  `new Date(year + 1, 0, 1)` calendar-year-boundary pair was hand-repeated at 3 analytics/repository.ts sites — queryTotalSpending (:654),
  the year-scoped vehicle-expenses filter (:1835), getYearEnd (:1937). VERIFIED firsthand the consumption: sites 1+2 feed `gte(start)+lt(end)`
  (the half-open year filter), site 3 `Math.floor(.getTime()/1000)`s the same pair into a DateRange (seconds) — so the SHARED thing is the
  boundary PAIR, not how each consumes it (the safe extraction boundary; not the C69 divergence trap since I extract only the pair). Extracted
  exported `calendarYearRange(year): {start, end}` BESIDE monthsOwnedInYear/toDate (the file's own exported year-date-helper cluster — kept it
  local to its only consumer, matching the established pattern rather than importing from calculations) + wired all 3 via destructuring
  (`const {start: yearStart, end: yearEnd} = calendarYearRange(year)`). Behavior-identical (each site consumes the two Dates exactly as before;
  local-time preserved). Test-anchored (rule 3): the EXISTING analytics year-end + total-spending + vehicle-expenses suites green THROUGH the
  substitution + 3 new helper tests in tco-months-owned.test.ts (Jan1/nextJan1 boundaries; the half-open 366-day leap window with Dec-31-23:59
  inside + end excluded; the 365-day non-leap). VERIFY-FIRSTHAND: ran in isolation FIRST — 12 green, the leap-year/half-open assumptions
  confirmed. green→green: backend validate:local EXIT 0 — 1296 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean, build bundled. cov: be
  84.14%+ (carry; +3 BE) / fe 79.22% (carry). ARCH QUEUE thin — next arch cycle prefers a fan-out over forcing a micro-dedup.
- **C217 (guard): cover auth.ts requireAuth — the untested per-page route guard (the ~56% FE low spot)** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 47, blocked 42nd) but blocked → fell through; nothing else strictly OVER budget → highest-leverage; `guard` was the
  most-starved actionable (cyc 212, starved-for 5 — the C216 forecast). Took the primed FE low spot: auth.ts ~56%. IDENTIFIED firsthand: the
  existing auth.test.ts covered isPublicRoute/isProtectedRoute/handleRouteProtection thoroughly but `requireAuth` was ENTIRELY untested (not
  even imported) — the ~44% gap. requireAuth is the per-page guard a protected page-load awaits; a regression either bounces an authenticated
  user (broken page) or fails to bounce a logged-out one (security-load-bearing). +4 cases driving the REAL authStore (setUser/clearUser/
  setLoading — the ProtectedRoute.test.ts convention, not a mock, so the genuine state machine runs): synchronous authed→resolves-true/no-
  redirect; synchronous unauthed→resolves-false + goto('/auth'); + BOTH loading-POLL paths (setLoading(true) → enter the setTimeout(check,50)
  loop → resolve mid-poll authenticated [resolves true] / unauthenticated [resolves false + redirect], driven via vi.useFakeTimers +
  advanceTimersByTimeAsync). VERIFY-FIRSTHAND: ran in isolation FIRST — 16 green (was 12, +4), the fake-timer poll both resolve correctly.
  green→green: FE validate:local EXIT 0 — 580 pass (+4), tsc 0, build OK; prettier + eslint clean. Test-only, no production change. auth.ts
  ~56%→well-covered. cov: fe 79.22%+ (carry; +4 FE) / be 84.14% (carry). Next FE guard low spot: sync-manager.ts ~56% (timer/network-bound — less
  clean) — the FE pure/service modules are now essentially all covered; the rest is the components/routes deficit (eyes-on).
- **C218 (bug → #73): a split-config-only reminder UPDATE (omitting vehicleIds) falsely 400'd** — BALANCE: `feature` most-starved (cyc 170,
  starved-for 48, blocked 43rd) but blocked → fell through; `bug` FORCED (cyc 214, starved-for 4 > 3 — the C217 forecast). Hunted a FRESH surface
  (the reminders create/update WRITE-path validation — the C189 create/update-asymmetry class; C150/C153/C197 had covered the trigger
  date-advance + mark-serviced, NOT the Zod write schema). REJECTED firsthand a vehicleIds-reassign mileage-anchor edge as a SEMANTICS edge
  (lastServiceOdometer is a stored historical anchor; whether it should auto-follow a vehicle swap is ambiguous — C21/C77, did not force). THE
  real one — #73, VERIFIED firsthand end-to-end: `refineSplitConfig` (validation.ts:133) compares the split's vehicle IDs against
  `data.vehicleIds`, but `updateReminderSchema` is `.partial()` + the FE `reminderApi.update` takes vehicleIds OPTIONAL — so a PUT changing ONLY
  the split config (omitting vehicleIds) → `data.vehicleIds` undefined → `new Set(undefined)` = ∅ → the match check (0 vs N) ALWAYS failed →
  `zValidator('json', updateReminderSchema)` (routes.ts:206, runs BEFORE the handler's merged re-parse) 400'd every legitimate split-config-only
  edit with "Split config vehicle IDs must match vehicleIds". FIX (mirror the other refiners' presence-guards — refineCustomFrequency/
  refineMileageTrigger already guard on their fields): wrap the MATCH check in `if (data.vehicleIds)` — it's a cross-field invariant meaningful
  only when both are present; the route's merged `createReminderSchema.parse(merged)` (routes.ts:228) still catches a genuine mismatch against
  the full object. The percentage/absolute SUM checks (vehicleIds-independent) stay UNCONDITIONAL. +4 tests in update-validation.test.ts (the
  #73 regression: split-only-no-vehicleIds ACCEPTED; the percentage-sum still fires without vehicleIds; both-sent genuine-mismatch still fails;
  both-sent-match accepted). NON-VACUOUS: confirmed the regression FAILS RED with the guard reverted (split-only still rejected) + the other 3
  stayed green (invariant intact). green→green: backend validate:local EXIT 0 — 1300 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean, build
  bundled. cov: be 84.14%+ (carry; +4 BE) / fe 79.22% (carry).
- **C219 (infra): CLAUDE.md orientation refresh (post-C208 drift, C209–C218)** — BALANCE: `feature` most-starved (cyc 170, starved-for 49,
  blocked 44th) but blocked → fell through; nothing else strictly OVER budget → highest-leverage; `infra` was the most-starved actionable
  (cyc 213, starved-for 6 = 6, due) AND the CLAUDE.md refresh was concretely due (last C208, ~11 cycles of drift; the #5 sweep isn't due til
  ~C223). Fixed 5 actively-misleading drifts, each VERIFIED vs source/LEDGER (the C93/C145/C193/C208 doc-refresh discipline — fix what misleads,
  don't churn): (1) COVERAGE — the C203 reading (84.06/77.79) → the FRESH C213 re-measure (be 84.14% line / 84.49% func · fe 79.22% line /
  78.89% func / 73.52% branch); (2) FE-ratchet list — added C212 analytics-api + C217 auth.ts; (3) "FE service layer 100%" → "FE service +
  pure-util layers essentially fully covered" (analytics-api/auth were the last gaps) + re-pointed the next low spot to sync-manager (the
  components/routes deficit is the bulk); (4) SUITE SIZE ~1274 BE / ~557 FE → 1300 BE / 580 FE; (5) CLOSED-BUG list ended at #67/C206 →
  appended #68 (C209 restore comma-truncation) + #70 (C210 expiring-soon NaN) + #71 (C214 mileage-recheck-on-edit) + #72 (C215 photos
  userId-scope) + #73 (C218 split-config-only update), range C155–C206 → C155–C218; + added #69 (insurance monthly-only TCO, escalated C210) to
  the Angelo-pending list. Doc-only, no code → no build gate (the C93/C131/C145/C193/C208 precedent). Next CLAUDE.md refresh ~C232; next #5
  branch-hygiene sweep ~C223 (last C213). cov: be 84.14% / fe 79.22% (carry, C213 reading).
- **C220 (deep-review → #74): photos route was the LONE mutating module missing changeTracker → a photo-only change didn't re-trigger the
  auto-backup** — BALANCE: `feature` most-starved (cyc 170, starved-for 50, blocked 45th — milestone) but blocked → fell through; `deep-review`
  AT budget (cyc 215, starved-for 5 = 5, due — the C219 forecast). Inline review (spawn cap/flake). SURFACE: the `changeTracker` middleware
  wiring (the #42 silent-backup-gap class, never audited for COMPLETENESS across route modules). CERTIFIED `changeTracker` itself CLEAN
  firsthand: mutating-method filter (:50), runs after handler (:54), stamps lastDataChangeDate only on 2xx (:56 — a failed write correctly
  doesn't mark changed). THE finding → #74: of 12 route modules, changeTracker is on 8; the 4 without it are analytics (read-only ✓), auth
  (sessions ✓), sync (the backup itself — circular ✓) — and PHOTOS, which has POST upload + DELETE. VERIFIED end-to-end: photos + photo_refs ARE
  in the backup payload (backup.ts:368/414), and the orchestrator SKIPS when !hasChangesSinceLastSync (backup-orchestrator.ts:70-76) — so a
  photo-only change between backups never bumped lastDataChangeDate → silently excluded from the next auto-backup until some OTHER tracked
  mutation bumped it (NORTH_STAR #1). FIX: added `routes.use('*', changeTracker)` to photos/routes.ts (mirrors the 8 siblings; fire-and-forget
  after 2xx, no response-behavior change — the photos-http suite stayed green). GUARD: photo-change-tracker.test.ts (+3 source-scan, the C133
  photo-serve-headers precedent — a full upload/delete needs a real storage provider, not in-harness-testable, so pin the WIRING: import +
  `routes.use('*', changeTracker)` + the mutating endpoints still exist). NON-VACUOUS: confirmed the "registered" assertion FAILS RED with the
  routes.use line removed. NOTE: the gate first went red on my new test's FORMAT (long regex line) — check:musl:fix reflowed it; the 10
  pre-existing noNonNullAssertion are WARNINGS (exit 0), not errors (verified firsthand — did NOT touch the 4 unrelated files). green→green:
  backend validate:local EXIT 0 — 1303 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean, build bundled. cov: be 84.14%+ (carry; +3 BE) /
  fe 79.22% (carry).
- **C221 (arch): extract parseUploadedPhoto — the multipart upload parse+File-validate block, 2 sites → 1** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 51, blocked 46th) but blocked → fell through; nothing else strictly OVER budget → highest-leverage; `arch` was the
  most-starved actionable (cyc 216, starved-for 5 = 5, due — vs bug also at 3=3 but arch waited longer). Inline scout. WHILE scouting, VERIFIED
  firsthand a potential #74 SIBLING-gap is NOT real: vehicles/photo-routes.ts (the vehicle-photo sub-router, also mutating) inherits
  changeTracker from its parent vehicles/routes.ts (routes.use('*', changeTracker) at :128, BEFORE .route('/:vehicleId/photos') at :131 — Hono
  parent use('*') covers mounted sub-routes) → correctly covered, confirming C220's fix targeted the genuinely-standalone photos/routes.ts. THE
  dedup: the `parseBody() → body.photo → instanceof File → AppError('No photo file provided', 400)` block was byte-identical at both upload
  routes (photos/routes.ts:63 + vehicles/photo-routes.ts:27). Extracted `parseUploadedPhoto(c): Promise<File>` to photos/helpers.ts (beside
  validateEntityOwnership) + wired both sites (each collapses to `const file = await parseUploadedPhoto(c)`) + dropped the now-unused AppError
  import from BOTH route files. PAYOFF: one source of truth for the upload-input contract + the natural seam for the filed #34 follow-on
  (size/type/magic-byte upload validation lands once, not twice). Test-anchored (rule 3): the existing photos + vehicle-photo upload suites green
  THROUGH the substitution + 3 new direct tests (parse-uploaded-photo.test.ts — File present→returned; missing→400; non-File text field→400; via
  a minimal Hono app + real FormData, no storage provider needed). NOTE: gate first red on helpers.ts import-order (organizeImports, the
  Context-type import) → check:musl:fix reflowed it (the C33 whole-tree lesson; pre-existing noNonNullAssertion are warnings, untouched).
  green→green: backend validate:local EXIT 0 — 1306 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean, build bundled. cov: be 84.14%+ (carry;
  +3 BE) / fe 79.22% (carry). ARCH QUEUE thin — next arch cycle prefers a fan-out.
- **C222 (bug → #75): calculateAverageMpg silently depended on caller date-ordering (an unordered future caller → mis-paired/wrong MPG)** —
  BALANCE: `feature` most-starved (cyc 170, starved-for 52, blocked 47th) but blocked → fell through; `bug` FORCED (cyc 218, starved-for 4 > 3
  — the C221 forecast). Hunted FRESH surfaces + REJECTED several as not-a-live-bug (C21/C77 — did NOT manufacture): vehicle-stats core (the one
  caller sorts; the fencepost is the C214 uniform convention), split-service (C173-certified), the offline.svelte store (trivial get/set),
  FE settings store (no backup-config logic). THE genuine defect-class found in calculateVehicleStats: `calculateAverageMpg` pairs CONSECUTIVE
  fillups (current − previous) for the per-segment distance, so it's correct ONLY on chronologically-ordered input — but it neither sorted nor
  documented that, silently trusting the caller (the C168/#48 "helper trusts the caller" class, applied to MATH). The sole production caller
  (vehicles/routes.ts:348) DOES sort, so no LIVE bug today — but any future consumer reusing this pure util would get silently-WRONG MPG
  (out-of-order segments mis-paired; negatives dropped by the mpg>0 filter but valid segments scrambled). FIX (behavior-preserving for the
  current caller — sorting an already-sorted copy is idempotent; closes the class): sort `[...unorderedExpenses]` by date inside
  calculateAverageMpg. (calculateMileageStats uses Math.max — order-independent, no fix needed.) +3 tests (chronological baseline avg=31;
  SHUFFLED + fully-reversed inputs yield the SAME 31). NON-VACUOUS: confirmed the shuffled + reversed tests FAIL RED with the sort reverted
  (mis-paired MPG) while the baseline stayed green. green→green: backend validate:local EXIT 0 — 1309 pass / 1 skip / 0 fail (+3), tsc 0,
  musl-biome clean, build bundled. cov: be 84.14%+ (carry; +3 BE) / fe 79.22% (carry).
- **C223 (guard): cover sync-manager conflict classification (determineConflictType — the duplicate-vs-modified data-safety distinction)** —
  BALANCE: `feature` most-starved (cyc 170, starved-for 53, blocked 48th) but blocked → fell through; nothing else strictly OVER budget →
  highest-leverage; `guard` was the most-starved actionable (cyc 217, starved-for 6 = 6, due — vs infra at 4, the #5 sweep is next). Took the
  primed FE low spot sync-manager.ts ~56%, but STEERED to its CLEANEST, highest-stakes slice (the C163 lesson — avoid the network/timer mock-trap
  paths): `determineConflictType`, which decides whether an offline-vs-server sync collision is 'duplicate' (silently DROPPED) vs 'modified'
  (surfaced to the user) — a regression mislabeling a real edit as 'duplicate' DISCARDS the user's offline change (data-safety). It was only
  indirectly hit (one 'duplicate' assertion at :180); the 'modified' branch + each match-component were uncovered. +4 cases driven through the
  PUBLIC syncAll conflict path (the existing-test convention, NOT private access): amount+tags+date all-match → 'duplicate'; a differing amount
  (tag still matches so checkForExistingExpense FINDS it) → 'modified'; a differing date → 'modified'; the <0.01 amount epsilon still matches →
  'duplicate'. VERIFY-FIRSTHAND: ran in isolation FIRST — 13 green (was 9, +4), the conflict-path mechanics + the epsilon confirmed. green→green:
  FE validate:local EXIT 0 — 584 pass (+4), tsc 0, build OK; prettier + eslint clean. Test-only, no production change. cov: fe 79.22%+ (carry;
  +4 FE) / be 84.14% (carry). sync-manager's remaining gap = the network/setTimeout-retry paths (the C163 mock-trap territory — left).
- **C224 (infra): #5 branch-hygiene sweep + coverage re-measure (last sweep C213, branch 34 commits deep)** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 54, blocked 49th) but blocked → fell through; nothing else strictly OVER budget → highest-leverage pick. `infra` was the
  most-starved actionable (cyc 219, starved-for 5) AND the #5 sweep was due (last C213, ~11 cycles / 34 commits — the C223 forecast). (1)
  STRAY-TEST CHECK CLEAN: zero untracked unit/spec `.test.ts` — all untracked are the by-design `*.meshclaw.e2e.ts` set + e2e
  screenshots/snapshots/results + playwright config + `.meshclaw-tools/` + `mise.local.toml` + the pre-loop `.kiro/specs/offline-entries/` doc.
  (2) GREEN BASELINE + RE-MEASURE: backend `bun test --coverage` EXIT 0 (1309 pass / 1 skip) — be 84.25% line / 84.60% func (up from C213's
  84.14/84.49 — the C214/C218/C220/C221/C222 BE additions); frontend `vitest --coverage` EXIT 0 (584 pass) — fe 80.33% line / 79.87% func /
  74.45% branch (CROSSED 80% line; UP +1.1 vs C213 — the C217 auth + C223 sync-manager guard ratchet). BE↔FE gap ~4pts (84 vs 80) — the FE
  pure/service modules are now essentially ALL covered. (3) BRANCH_REVIEW.md REFRESH (gitignored): header scope 23→34 commits (C190–C223),
  status block to 1309 BE / 584 FE + the C224 coverage, appended §29 (C213–C223: the balanced arc — #71/#73/#74 data-safety bugs, #72 photos
  userId-scope, the C216/C221 dedups, the C217/C223 guard ratchet, #75 mpg-ordering; recurring theme = "guard/middleware wired on most paths but
  missed one" for #71+#74), fixed the stale "23 commits" → "34 commits (C190–C223)" in Suggested-merge. Doc/measurement-only, no product code.
  Next sweep ~C234; next CLAUDE.md refresh ~C232 (last C219). cov: be 84.25% / fe 80.33% (FRESH C224 reading).
- **C225 (deep-review): auth session-refresh + OAuth callback (state/CSRF/PKCE + new-user resolution) — CERTIFIED CLEAN, no fix needed** —
  BALANCE: `feature` most-starved (cyc 170, starved-for 55, blocked 50th — milestone) but blocked → fell through; `deep-review` AT budget (cyc
  220, starved-for 5 = 5, due — vs bug also at 3=3 but deep-review waited longer; the C224 forecast). Inline review of the auth surface C56/C126
  certified for SESSION/email but NOT the OAuth-callback + session-refresh paths. CERTIFIED CLEAN firsthand, FOUR sub-paths: (1)
  validateAndRefreshSession (utils.ts) — create-new-before-invalidate-old ordering is correct; the `c?`-optional cookie-set-last has NO live
  cookie-loss path because BOTH callers (middleware/auth.ts:35 + routes.ts:563 /refresh) pass `c`; the C32(b) invalidate-throws-orphans-new
  edge is the documented sprawl note (not a priv issue). (2) requireAuth middleware — deletes the cookie + 401s on null (C127), sets ctx on
  success; optionalAuth correctly swallows. (3) OAuth state/CSRF/PKCE: validateLoginState requires the state be in the in-mem store (proves
  this-server-minted) + flowType-undefined (a link-state can't replay at the login callback) + single-use delete; the generic callback
  VALIDATES STATE BEFORE the token exchange (:418 before :424) + exchanges with the state-bound codeVerifier (PKCE) — order-correct,
  CSRF-protected, and ALREADY guarded by auth-routes.property.test.ts (flowType discrimination + route-order + rate-limiter). (4) resolveNewUser
  — email-conflict guard (no implicit merge), txn-atomic user+provider insert, UNIQUE-constraint race-recovery; VERIFIED the
  findByProviderIdentity lookup queries the SAME userProviders table the insert writes, with a BYTE-MATCHING WHERE (domain:'auth' +
  providerType + providerAccountId) → a returning OAuth user is correctly found (no new-row-per-login bug). NO fix + NO new test (the structural
  invariants are already pinned — adding more would be coverage-theater, the C181 anti-pattern). The lone note: oauthStateStore is in-memory →
  OAuth breaks under horizontal scaling (documented :54; the self-host PWA is single-instance per NORTH_STAR — a scaling-arch limitation, not a
  correctness bug). Record-only (the C179/C191 clean-certification precedent), no build gate (no code touched). cov: be 84.25% / fe 80.33% (carry).
- **C226 (bug → #76): switching an expense's category away from fuel left stale volume/charge/fuelType/mileage in form-state, riding onto a
  non-fuel row** — BALANCE: `feature` most-starved (cyc 170, starved-for 56, blocked 51st) but blocked → fell through; `bug` FORCED (cyc 222,
  starved-for 4 > 3; arch only AT-budget 5=5). Hunted FRESH surfaces + CERTIFIED CLEAN firsthand (C21/C77 — not manufactured): the
  insurance-CLAIM write path (POST/PUT/DELETE all ownership-gated; update/delete scope WHERE id+policyId [C155 class clean]; findOwnerUserId's
  claimId-only key is the correct owner-resolver, not a tenant read). THE live one — #76, VERIFIED UI-reachable firsthand: ExpenseForm's
  `selectCategory` resets the financing source on switch-away-from-financial (:358) but did NOT clear the fuel fields on switch-away-from-fuel —
  so a user who fills fuel inputs then switches to misc/maintenance submits with `expenseData.volume/charge/fuelType/mileage` STILL populated
  (the inputs hide via showFuelFields but formData values persist; expenseData :489 sends them regardless of category). Impact: inert in
  analytics (every fuel query filters category='fuel', :616/:683/:1116/:1928 — a stray volume on a misc row is never read), BUT a real
  data-hygiene leak + a stray `mileage` feeds getCurrentOdometer CROSS-CATEGORY (odometer/repository.ts:151 — no category filter). FIX
  (decision-free, mirrors the EXISTING financing-reset idiom in the same handler): `if (categoryValue !== 'fuel') { clear volume/charge/fuelType/
  mileage/missedFillup }`. Behavior-preserving (a real fuel expense keeps its fields; only switch-AWAY clears). GUARD: +1 source-scan
  (category-switch-clears-fuel-fields.test.ts — the C133/C220 + sibling category-selector-labels precedent, since selectCategory mutates Svelte
  component state, not unit-testable without mount; pins the clear-block inside selectCategory). NON-VACUOUS: confirmed RED with the block
  reverted. CAVEAT: the full select→clear→submit round-trip is eyes-on/Playwright-BLOCKED → code-complete/source-pinned/eyes-on-pending per the
  feature-DoD rule. (Process: my first guard draft used bun:test/import.meta.dir [the BACKEND source-scan idiom] → vitest rejected it; fixed to
  vitest + fileURLToPath, the FE sibling convention.) green→green: FE validate:local EXIT 0 — 585 pass (+1), tsc 0, build OK; prettier + eslint
  clean. cov: fe 80.33%+ (carry; +1 FE) / be 84.25% (carry).
- **C227 (arch → also closed #77 security gap): extract photoThumbnailResponse — the photo byte-serve Response, 2 sites → 1** — BALANCE:
  `feature` most-starved (cyc 170, starved-for 57, blocked 52nd) but blocked → fell through; `arch` FORCED (cyc 221, starved-for 6 > 5 — the
  C226 forecast). Inline scout. FOUND a dedup that ALSO closes a real security divergence (the C205/C211 "dedup-collapses-the-bug" pattern, here
  on a SECURITY header): the photo-thumbnail byte-serve `new Response(buffer, {headers})` existed at 2 sites — generic photos/routes.ts (:85) +
  vehicles/photo-routes.ts (:59) — with the SAME headers EXCEPT the generic route carried `X-Content-Type-Options: nosniff` (the C133/#35 fix)
  and the VEHICLE route did NOT (#77, VERIFIED firsthand). Since the serve uses the client-asserted never-sniffed mimeType, the vehicle path —
  the PRIMARY photo surface — was MIME-sniff-exploitable (a declared-image/actually-HTML file could execute). Extracted
  `photoThumbnailResponse(buffer, mimeType)` to photos/helpers.ts (beside parseUploadedPhoto) with nosniff baked in + wired BOTH sites → the
  vehicle path GAINS nosniff (security fix) + the generic path is behavior-identical + future header drift between the two is structurally
  prevented. Test-anchored: UPDATED the C133 photo-serve-headers.test.ts source-scan to follow the literal to its new home (helpers.ts builder)
  + EXTENDED it to pin BOTH routes call the shared builder (the #77 assertion). NON-VACUOUS: confirmed the vehicle-route assertion FAILS RED with
  that wiring reverted. (Process: gate first red on the test's long-line FORMAT → check:musl:fix reflowed it; pre-existing noNonNullAssertion are
  warnings, untouched.) green→green: backend validate:local EXIT 0 — 1310 pass / 1 skip / 0 fail (+1), tsc 0, musl-biome clean, build bundled.
  cov: be 84.25%+ (carry; +1 BE) / fe 80.33% (carry). #77 (vehicle-photo serve missing nosniff) CLOSED as a side effect.
- **C228 (guard): cover the vehicle-photo sub-router's provider-free HTTP paths (list + set-cover) — the 0%-covered `vehicles/photo-routes.ts`** —
  BALANCE: `feature` most-starved (cyc 170, starved-for 58, blocked 53rd) but blocked → fell through; nothing else strictly OVER budget →
  highest-leverage; `guard` was the most-starved actionable (cyc 223, starved-for 5 = 5 → 6 at this cycle, due — the C227 forecast). RESUME NOTE:
  this cycle's test file was authored in a prior session that was cut before validate/commit/ledger (HEAD was still C227, the file untracked) —
  resumed by verifying + landing it. STEERED to the file's CLEAN slice (the C163/C223 mock-trap lesson): the C227 dedup confirmed
  vehicles/photo-routes.ts inherits requireAuth + changeTracker from the parent vehicles router, but its own LIST (GET /) + SET-COVER
  (PUT /:photoId/cover) handlers were 0%-covered (upload + thumbnail need a real storage provider — not in-harness-testable, modeled by the
  property tests). +6 HTTP tests via createTestApp over the FULL route stack with RAW-seeded photo rows (the C215/C220 provider-free pattern):
  LIST is ownership-gated (foreign vehicle → 404, no cross-tenant leak) + paginated + 401-on-anon; SET-COVER flips the target + clears the prior
  cover (the single-cover invariant, asserted on the raw is_cover flags) + enforces the entityType/entityId match (another entity's photoId via
  my vehicle URL → 404, foreign flag untouched) + foreign-vehicle → 404. VERIFY-FIRSTHAND: ran in isolation FIRST — 6 green, 16 expect()s; the
  ownership + single-cover mechanics confirmed against the real handlers. (Process: gate first red on the test's long-line FORMAT →
  check:musl:fix reflowed 1 file; the 10 pre-existing noNonNullAssertion stay warnings, untouched — the recurring C220/C221/C227 note.)
  green→green: backend validate:local EXIT 0 — 1316 pass / 1 skip / 0 fail (+6), tsc 0, musl-biome clean, build bundled. cov: be 84.25%+
  (carry; +6 BE) / fe 80.33% (carry).
- **C229 (bug): `PhotoRepository.setCoverPhoto` second UPDATE keyed on `id` ALONE + bound the getDb() singleton (untestable) —
  scoped to (id,entityType,entityId), validated BEFORE the unset, switched to `this.db.transaction`** — BALANCE: `feature` most-starved
  (cyc 170, starved-for 59, blocked 54th) but blocked → fell through; `bug` FORCED (cyc 226, starved-for 3 = 3, due — the C228 forecast).
  Scouted the photo write-paths firsthand (the queued #34 upload-atomicity is storage-provider-blocked in-harness — deferred, not forced).
  Found a THREE-PART defect in setCoverPhoto, the same method: (1) the second (set-cover) UPDATE keyed on `photoId` ALONE while the first
  (unset) was (entityType,entityId)-scoped → the C63/#192 + C72/#215 "write keyed on id alone, match proven a layer up" class: a photoId from a
  DIFFERENT entity would clear the named entity's cover AND flag the foreign photo (entity left cover-less). (2) it used the MODULE-level
  `transaction()` helper, which binds the `getDb()` singleton + IGNORES the injected `this.db` (the lone repo method that did — every sibling in
  expenses/insurance uses `this.db.transaction`), so it was UNTESTABLE via a constructed repo → the two photo "property" tests only drive an
  in-memory REFERENCE model, never the real method (the C181 coverage-theater pattern); it also wrapped the internal NotFoundError into a 500
  DatabaseError. (3) discovered while testing: even an entity-scoped second UPDATE + a throw does NOT undo the unset — the C151 bun:sqlite
  ASYNC-transaction footgun (a throw escaping the async callback AFTER a sync write does not roll it back). FIX (all three, one coherent
  setCoverPhoto change): VALIDATE the target's (id,entityType,entityId) match BEFORE any write (so a bad/foreign id mutates nothing regardless
  of rollback semantics — strictly safer than both the old flag-foreign and an unset-then-throw), switch to `this.db.transaction` (DI-consistent
  with siblings + 404 propagates cleanly; production has this.db===getDb() so behavior-preserving). GUARD: set-cover-entity-scope.test.ts (+3)
  drives the REAL repo over a migrated in-memory SQLite DB (the batch-by-entity-type pattern — closes the coverage-theater gap): happy-path
  flip+single-cover; a foreign-entity photoId → NotFoundError + VEH_1 keeps its cover + foreign flag untouched (the #-class regression); an
  unknown id → NotFoundError, cover intact. NON-VACUOUS: the foreign-entity + unknown-id cases went RED under both the original id-alone code
  AND an interim unset-then-throw (coverFlag('p1')===0) — green only once validation precedes the unset (live evidence this session). green→green:
  backend validate:local EXIT 0 — 1319 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean (1 unused-import + reflow fixed), build bundled.
  cov: be 84.25%+ (carry; +3 BE, setCoverPhoto now really covered) / fe 80.33% (carry).
- **C230 (infra): CLAUDE.md orientation refresh — stale coverage reading + suite size + closed-bug list (drifted C219→C229)** — BALANCE: TWO
  at-budget — `infra` (cyc 224, starved-for 6 = 6) + `deep-review` (cyc 225, starved-for 5 = 5); `infra` waited LONGER (touched C224 vs C225) →
  infra wins the tiebreak. The #5 branch-hygiene sweep just ran C224 (only ~6 cycles / a few commits ago — not due), so the actionable infra
  increment is the CLAUDE.md refresh: it last refreshed ~C219 and three things had drifted materially. (1) The coverage paragraph cited the
  SUPERSEDED C213 reading (be 84.14/84.49, fe 79.22/78.89) — replaced with the C224 #5-sweep measure (be 84.25% line / 84.60% func, fe 80.33%
  line / 79.87% func / 74.45% branch; FE crossed 80%), and folded C223 sync-manager into the FE-ratchet list. (2) "Next BE low spot:
  activity-tracker.ts ~44%" was stale — its pure slice (cleanupInactiveUsers) was covered C195 + the rest is timer/orchestrator-bound; updated to
  "clean BE route/util low spots largely worked through; next guard cycles thin both sides." (3) Suite size "~1300 BE / ~580 FE" → "~1320 BE /
  ~585 FE" (actual 1319/585) and the closed-bug list ended at #73/C218 → extended with #74 (C220 photos changeTracker), #75 (C222 mpg ordering),
  #76 (C226 category-switch fuel fields), #77 (C227 vehicle-photo nosniff), #78 (C229 setCoverPhoto); also threaded C229 into the recurring
  coverage-theater lesson (the property tests never drove the real setCoverPhoto). DOCS-ONLY (CLAUDE.md only — verified `git diff --name-only`
  shows just CLAUDE.md), no source touched → no build gate (the C195/C213/C224 doc-refresh precedent). Next CLAUDE.md refresh ~C240; next #5
  sweep ~C234. cov: be 84.25% / fe 80.33% (carry — no code, no re-measure this cycle).
- **C231 (deep-review): expense split-service allocation math + offline-outbox idempotency — both CERTIFIED CLEAN; filed #79 (stuck malformed
  offline entry) + pinned its current behavior** — BALANCE: `deep-review` OVER budget (cyc 225, starved-for 6 > 5, FORCED — the C230 forecast).
  spawn_run fan-out hit the HTTP 400 transport failure (the C179 precedent) → did it inline, higher-fidelity. TWO data-safety surfaces audited
  firsthand: (A) SPLIT-SERVICE (split-service.ts + repository createSplitExpense/updateSplitExpense) — CERTIFIED CLEAN: even split = largest-
  remainder cents (Math.round total→cents, floor base, first `remainderCents` siblings get +1¢) sums EXACTLY; percentage = floor-all-but-last +
  last absorbs the clamped remainder; absolute = verbatim with validation enforcing sum===total; updateSplitExpense DERIVES the absolute total
  from the legs (not the stale groupTotal — the C-documented Property-3 fix) + carries groupId/sourceType/sourceId from firstOld; siblings carry
  null volume/mileage by design (C97). NOT coverage-theater — split-service.property.test.ts drives the REAL computeAllocations + pins the sum
  invariant for all 3 methods. (B) OFFLINE-OUTBOX IDEMPOTENCY (offline-storage.ts syncOfflineExpenses + repository createIdempotent/importExpenses)
  — CERTIFIED CLEAN: the `(userId,clientId)` UNIQUE PARTIAL index (schema.ts:262 `WHERE client_id IS NOT NULL`; migration 0001) backs a pre-check +
  race-recovery re-read; clientId is userId-scoped (no cross-tenant collision); the deterministic clientId backfill (C202) + the #66 fuelType
  single-source mapper hold; batch import is atomic (one txn). Odometer has NO clientId — but the outbox is EXPENSE-ONLY (offline.svelte.ts queues
  only OfflineExpense), so that's not a live gap (CERTIFIED, not a defect). THE one finding → #79 (LOW, data-hygiene, ESCALATED): a malformed fuel
  offline entry (no volume/charge or no mileage) is `continue`-skipped in syncOfflineExpenses → never markExpenseAsSynced'd → clearSyncedExpenses
  (drops only synced===true) leaves it PENDING forever, silently re-skipped every sync, no user signal (a user write that never lands + no signal,
  NORTH_STAR #1-adjacent). The resolution (drop+toast / failed-bucket / confirm the form already blocks it) is a PRODUCT call → send_message'd
  Angelo. Decision-free increment this cycle: a CHARACTERIZATION test pinning the current stuck-forever behavior (the existing malformed-fuel test
  asserted only "not POSTed", never what happens to the entry after) so a fix can't change it unnoticed — +1, drives the REAL syncOfflineExpenses
  over the stateful localStorage mock (two syncs → entry persists unsynced, never POSTed). green→green: frontend validate:local EXIT 0 — 586 pass
  (+1), tsc 0, build OK; prettier + eslint clean. Test-only, no production change. cov: fe 80.33%+ (carry; +1 FE) / be 84.25% (carry).
- **C232 (arch): collapse trigger-service's 3 byte-identical `reason:'error'` skip-push blocks into one `pushReminderSkipError` helper** —
  BALANCE: TWO at budget — `bug` (cyc 229, starved-for 3 = 3) + `arch` (cyc 227, starved-for 5 = 5); `arch` waited LONGER (touched C227 vs C229)
  → arch wins the tiebreak. Inline scout. REJECTED the obvious target first (C21/C77 — didn't force churn): the `error instanceof Error ?
  .message : String(error)` idiom is hand-rolled in 16 files, but `extractErrorMessage` (C147) ALREADY exists for the VALUE form and its doc +
  test EXPLICITLY carve out the 16 logger `{error: <idiom>}` structured-shape sites + the `'Unknown error'` fixed-fallback as deliberately-inline
  — so a sweep would reverse a documented decision (arch rule 5). The genuine, contained dedup: trigger-service.ts built
  `result.skipped.push({ reminderId, reason:'error', message: error instanceof Error ? error.message : 'Unknown error' })` BYTE-IDENTICALLY at 3
  catch sites (time axis :312, mileage axis :329, recheck-on-write per-reminder :372). Extracted a module-level `pushReminderSkipError(result,
  reminderId, error)` (beside clampToAnchorDay/advanceCustom) + routed all 3 → one call each. PAYOFF: one source of truth for the per-reminder
  error-skip shape so it can't drift between the axes (a real risk — the recheck axis was added later, C214). DELIBERATELY LEFT inline: the
  `recheck_query_failed` site (:360 — different reason + reminderId:'all', single occurrence) + the pre-math `no_vehicles`/`mileage_requires_
  single_vehicle`/`catch_up_limit_reached` skips (no message, distinct reasons). Kept the `'Unknown error'` fallback inside the helper (NOT routed
  through extractErrorMessage, whose contract is String(error)) — honors the C147 carve-out. Test-anchored (rule 3, green→green): the
  reason:'error' path is pinned by trigger-bad-interval-unit.test.ts (asserts skip.message CONTAINS 'intervalUnit') +
  trigger-nonprogress-frequency + recheck-on-write — all passed UNCHANGED through the substitution (proves the helper preserves the real
  error-message extraction). green→green: backend validate:local EXIT 0 — 1319 pass / 1 skip / 0 fail (UNCHANGED — behavior-preserving), tsc 0,
  musl-biome clean (no reflow needed), build bundled. cov: be 84.25% / fe 80.33% (carry — no test count change, pure refactor).
- **C233 (bug → #80): license-plate uniqueness was GLOBAL across all tenants (cross-tenant false-409 + plate-existence enumeration oracle) —
  scoped per-user at BOTH the route check AND the DB unique index** — BALANCE: `bug` OVER budget (cyc 229, starved-for 4 > 3, FORCED — the C232
  forecast). The filed queue's unblocked items are all weak/gated (#79 escalated; #29/#40/#47 product calls), so per the bug-cycle pattern
  (C189/C218/C222/C226 — find a FRESH verified defect over forcing a gated one) I hunted the vehicles write-path. FOUND #80 (MED, tenant-isolation
  + info-leak): `vehicleRepository.findByLicensePlate(plate)` queried `WHERE license_plate = ?` GLOBALLY (no userId), and it backs the
  plate-uniqueness check on BOTH create (routes.ts:177) + update (:261) → a user adding a plate that ANOTHER tenant already owns got a 409 "A
  vehicle with this license plate already exists" (a cross-tenant FALSE conflict — two users may legitimately share a plate string: reissued
  plates across states, sold-then-rebought cars) AND the 409 is an ENUMERATION ORACLE (probe whether any plate exists system-wide). VERIFIED
  firsthand + via a RED test. KEY DISCOVERY mid-fix: the route check is only HALF — migration 0000's `vehicles_license_plate_idx` is a GLOBAL
  UNIQUE partial index, so scoping the route alone turned the cross-tenant collision from a 409 into a SQLITE_CONSTRAINT_UNIQUE 500. The complete
  fix is TWO layers: (1) route + repo — added a `userId` param to findByLicensePlate, ANDed `eq(vehicles.userId, userId)`, threaded user.id
  through both sites; (2) migration 0005 (the low-risk 0003-class index swap — NO data rebuild, and the existing globally-unique data trivially
  satisfies the more-permissive composite constraint so it can't fail on existing rows): DROP the global index, CREATE UNIQUE
  `vehicles_user_license_plate_idx ON (user_id, license_plate) WHERE license_plate IS NOT NULL`; registered in _journal.json (idx 5) + added the
  composite index to schema.ts (it was ABSENT there — fixing pre-existing schema↔migration drift too, since the global one lived only in 0000).
  GUARD: +3 HTTP tests (vehicles-http.test.ts, raw-seeded foreign user — the C215/C220 pattern): cross-tenant CREATE with a foreign-owned plate →
  201; same-user duplicate plate → 409 (per-user constraint intact); cross-tenant UPDATE → 200. NON-VACUOUS: the 2 cross-tenant cases were RED
  pre-fix (409 on the route, then 500 on the DB index before 0005). Migration applied cleanly across the WHOLE suite via the harness's
  runMigrations() — no other test relied on the global plate constraint. green→green: backend validate:local EXIT 0 — 1322 pass / 1 skip / 0 fail
  (+3), tsc 0, musl-biome clean, build bundled. cov: be 84.25%+ (carry; +3 BE) / fe 80.33% (carry). NOTE: this is a real tenant-isolation fix
  (not just defense-in-depth) — the false-409 was user-observable.
- **C234 (guard): pin the expense-category display maps' EXHAUSTIVENESS (categoryLabels / getCategoryIcon / getCategoryColor) — the uncovered
  exports of expense-helpers.ts** — BALANCE: `guard` AT budget (cyc 228, starved-for 6 = 6, FORCED — the C233 forecast). SCOUTED for a grounded,
  non-theater pick: the backend utils are genuinely worked through — VERIFIED firsthand that csv-safety.ts (both directions + round-trip +
  idempotence) and unit-conversions.ts (correctness/identity/round-trip for all 3 fns via property tests) are FULLY covered, NOT gaps; the named
  BE low spots (activity-tracker timer-bound, restore.ts mock-trap) stay non-clean. Pivoted FE per the standing angle: expense-helpers.ts had only
  compareExpenseRows pinned (compare-expense-rows.test.ts) — its 3 category-display exports (categoryLabels, getCategoryIcon, getCategoryColor)
  were UNCOVERED. Picked the EXHAUSTIVENESS invariant (real value, not theater): every ExpenseCategory in the union must map to a label/icon/color
  — a missing key is a SILENT UI bug (categoryLabels[newcat]=undefined renders blank; the icon/color maps fall through to DollarSign/muted). +6
  tests (expense-category-maps.test.ts, drives the REAL exports): ALL_CATEGORIES (a literal mirror of the union) has exactly 6 / no dupes; every
  category has a truthy string label + Object.keys(categoryLabels) EXACTLY equals the union (catches a stale/extra key too); a defined icon
  component + a `text-`-containing color class for each; representative known values (fuel→'Fuel & Charging', the chart-1 color); and the unknown-
  category FALLBACK (icon→DollarSign, color→muted, no throw — the `|| fallback` guards, reachable via a legacy/garbage row cast through unknown).
  PAYOFF: adding a 7th ExpenseCategory without updating these maps now FAILS CI instead of shipping a blank label. green→green: frontend
  validate:local EXIT 0 — 592 pass (+6), tsc 0, build OK; prettier + eslint clean. Test-only, no production change. cov: fe 80.33%+ (carry; +6 FE)
  / be 84.25% (carry). (vehicle-helpers.ts — the one truly untested FE util — was REJECTED as a pick: a single trivial display-name helper,
  pinning it would be borderline coverage-theater.)
- **C235 (deep-review → bug-class fix): `Math.max(...arr)` argument-spread crash-class across the analytics read-path — 18 sites swept to
  spread-safe `maxOf`/`minOf` reduce helpers** — BALANCE: `infra` was most-starved (cyc 230, starved-for 5) BUT its only real increment (the #5
  sweep's coverage re-measure via `bun test --coverage`) is BLOCKED by refused heavy tooling this session → per don't-force-a-blocked-pick, took
  the next most-starved ACTIONABLE = `deep-review` (cyc 231, starved-for 4, inline-doable; the C231/C179 spawn-400 precedent). Audited the analytics
  aggregation read-path firsthand. FOUND a systemic latent crash-class (VERIFIED, NORTH_STAR #1-adjacent): `Math.max(...mileages)` /
  `Math.min(...arr)` spreads every element as a function argument, so a large array overflows the engine's argument-count cap and throws
  `RangeError: Maximum call stack size exceeded`, crashing the analytics REQUEST. CONFIRMED the arrays are UNBOUNDED: queryFuelExpenses /
  queryAllExpenses have NO LIMIT (the all-time 'all' period has no range filter either), so the mileages/volumes arrays scale 1:1 with a heavy
  logger's fillup count — thousands-to-tens-of-thousands of rows reaches the cap (V8 ~65k, stack-depth-dependent). 18 spread sites across 3 files:
  analytics/repository.ts (4 — incl. line 503 cross-fleet total distance, hit on EVERY /analytics summary), utils/analytics-charts.ts (12 — radar
  + best/worst efficiency/cost), utils/vehicle-stats.ts (1 — per-vehicle latestMileage, also fillup-scaled). FIX (one coherent class-closing
  increment): added spread-safe `maxOf`/`minOf` (O(n) reduce, no spread) to utils/calculations.ts + swept ALL 18 sites to them. Behavior-IDENTICAL:
  the helpers return -Infinity/+Infinity on [] exactly like Math.max()/Math.min(), so every call site (incl. the `length > 0 ? : null` and
  `length >= 2` guards already present) is unchanged. GUARD: +6 tests (array-min-max.test.ts) — correctness (incl. negatives/floats/single),
  behavior-IDENTITY with Math.max/min incl. the empty→±Infinity contract + a 50-trial randomized parity vs the spread form, and the REGRESSION:
  maxOf/minOf compute correctly on a 500k array (the no-spread path well beyond the argument cap). NOTE: my first draft asserted
  `Math.max(...big)` THROWS at 500k — but Bun/JSC tolerates a far larger spread than V8, so I removed that environment-specific assertion (the
  C77 vacuity discipline — don't assert an engine-specific premise); the test pins the helper's correctness at scale, not the engine's throw
  threshold. Test-anchored green→green: every existing analytics + vehicle-stats test passed UNCHANGED through the 18-site swap. green→green:
  backend validate:local EXIT 0 — 1328 pass / 1 skip / 0 fail (+6), tsc 0, musl-biome clean (3 import-order autofixed), build bundled. cov: be
  84.25%+ (carry; +6 BE) / fe 80.33% (carry). This is a real reliability fix (an analytics crash for the most-engaged users), surfaced by a
  deep-review and fixed in-cycle since the whole class was a mechanical, behavior-preserving swap.
- **C236 (infra): #5 branch-hygiene sweep + coverage re-measure (last measured C224, last #5 sweep C224 — ~12 cycles / overdue)** — BALANCE: TWO
  at budget — `infra` (cyc 230, starved-for 6 = 6) + `bug` (cyc 233, starved-for 3 = 3); `infra` waited LONGER (touched C230 vs C233) → infra
  wins. The coverage-re-measure increment was TOOL-BLOCKED last cycle (C235, `bun test --coverage` refused) — retried this cycle and it RAN. (1)
  STRAY-TEST CHECK CLEAN: zero untracked non-e2e `.test.ts` in the tree. (2) GREEN BASELINE + RE-MEASURE: backend `bun test --coverage` EXIT 0
  (1328 pass / 1 skip) — **be 85.18% line / 84.74% func** (up from C224's 84.25/84.60 — the C229 setCoverPhoto + C233 vehicles + C235 maxOf/minOf
  BE additions); frontend `vitest --coverage` EXIT 0 (592 pass) — **fe 80.64% line / 80.51% func / 74.97% branch** (up from C224's 80.33 — the C231
  characterization + C234 category-maps FE additions). BE↔FE gap ~4.5pts (85 vs 81). (3) LOWEST substantive spots (for steering future guard/bug
  cycles, all KNOWN-hard): `auth/routes.ts` 18% (OAuth flow — needs a real provider, the mock-trap), `photo-service.ts` 30% func + `google-photos-
  service.ts` 25% func + `backup-orchestrator.ts` 29% func (all storage-provider/DI-bound — the documented deep-review #3 + C181 gaps),
  `settings/routes.ts` 56%, `providers/routes.ts` 58%, `sync/routes.ts` 59% + `analytics/routes.ts` 59% (HTTP-harness-reachable but largely
  worked — partial). The clean pure/util layer is ~fully covered both sides (calculations 98.9%, the C235 maxOf/minOf now pinned). NO clean
  high-value low spot remains that isn't provider/DI/OAuth-bound — confirms the "guard cycles thin both sides" note; next guard should expect a
  characterization-of-a-known-hard-seam or an eyes-on-acknowledged punt. DOCS/MEASUREMENT-ONLY (no source touched) → no build gate beyond the two
  coverage runs that WERE the verification. Next #5 sweep ~C246; next CLAUDE.md refresh ~C240. cov: be 85.18% line / 84.74% func / fe 80.64% line /
  80.51% func / 74.97% branch (FRESH C236 reading).
- **C237 (bug → #82): PUT /settings wrote `backupConfig` WHOLESALE while storageConfig was merged — a partial PUT silently wiped other providers'
  backup settings; merge per-provider server-side** — BALANCE: `bug` OVER budget (cyc 233, starved-for 4 > 3, FORCED — the C236 forecast). Per the
  bug-cycle pattern (fresh verified defect over a gated one), hunted un-audited write-paths. CERTIFIED CLEAN firsthand: the insurance term
  write-path — addTerm (repository.ts:407) + updateTerm (:541) BOTH validateVehicleOwnership on the term↔vehicle junction (no #61 cross-tenant
  link gap). THE live defect in PUT /settings: storageConfig is MERGED with existing (mergeStorageConfig, :262) but backupConfig was written
  WHOLESALE (`...(backupConfig && { backupConfig })`, :278). backupConfig = { providers: Record<providerId, settings> }, and backupConfigSchema
  REQUIRES the full providers map → a client PUT-ing backupConfig with only the provider it's editing WIPES every other provider's backup settings
  (retentionCount / sheetsSyncEnabled / folderPath) — silent data loss (NORTH_STAR #1). VERIFIED the frontend currently MITIGATES (ProviderForm.svelte:356
  spreads ...backupConfig.providers, sending the full map), but that makes the backend contract FRAGILE: a partial sender (future client, direct
  API caller, or a stale-load race) loses data — and storageConfig already defends server-side, so the asymmetry IS the bug. FIX (mirror
  mergeStorageConfig): `mergeBackupConfig(existing, incoming)` merges per-provider — a named entry is replaced wholesale (its settings are a small
  fixed shape the editor always sends complete) but un-named providers are PRESERVED; wired into the PUT. validateBackupConfig still gates the
  INCOMING providers (ownership), and the merged-in existing ones were validated when first written, so no validation bypass. Behavior-preserving
  for today's full-map caller; protective for partial callers. GUARD: +2 HTTP tests (backup-config-merge.test.ts, 2 raw-seeded owned providers):
  a partial PUT naming only drive-b PRESERVES drive-a's settings (the #82 regression — pre-fix drive-a was wiped); a named entry IS replaced
  wholesale (sheetsSyncEnabled dropped on re-PUT without it). NON-VACUOUS: the preserve assertion fails RED pre-fix (wholesale write → drive-a
  absent). green→green: backend validate:local EXIT 0 — 1330 pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean (1 import-order + test reflow
  autofixed), build bundled. cov: be 85.18%+ (carry; +2 BE) / fe 80.64% (carry).
- **C238 (arch): extract the byte-identical `unitPreferencesSchema` + partial + merge idiom (vehicles + settings routes) to one shared module** —
  BALANCE: `arch` OVER budget (cyc 232, starved-for 6 > 5, FORCED — the C237 forecast). Inline scout. FOUND a clean 2-file dedup: vehicles/routes.ts
  (24-38) and settings/routes.ts (156-170) each declared a BYTE-IDENTICAL `unitPreferencesSchema = z.object({ distanceUnit/volumeUnit/chargeUnit
  enums + identical error-message strings })` + `partialUnitPreferencesSchema = .partial()`, AND both PUT handlers repeated the same
  `partialUnitPrefs ? { ...existing.unitPreferences, ...partialUnitPrefs } : undefined` merge — two sources of truth for one validation contract (a
  future enum/message change would have to land in both or silently drift). FIX: new pure module `utils/unit-preferences-schema.ts` (depends only on
  zod + the type enums, NOT the repo-heavy validation.ts) exporting `unitPreferencesSchema`, `partialUnitPreferencesSchema`, and
  `mergeUnitPreferences(existing, partial)` (returns undefined when nothing to merge so the caller leaves the column untouched; null/undefined
  existing spread safely — preserving the vehicle-path edge where existing may be null). Wired both routes to import the shared symbols + call the
  helper; dropped the now-unused unit-enum + UnitPreferences imports from both files. Behavior-IDENTICAL (the helper reproduces the exact spread the
  two inline sites did). Test-anchored (rule 3, green→green): every existing vehicles + settings route test (incl. the C237 backup-config-merge + the
  vehicle clear-optional-field + unit-defaults suites) passed UNCHANGED through the swap; +7 direct tests (unit-preferences-schema.test.ts — full vs
  partial schema validity, enum rejection, and the merge contracts incl. the undefined-when-no-partial + null-existing edges). tsc caught a real
  test-type issue (the helper's `UnitPreferences` return needs an `as` cast on the partial-expected values — the prior inline behavior). green→green:
  backend validate:local EXIT 0 — 1338 pass / 1 skip / 0 fail (+7), tsc 0, musl-biome clean (import-order autofixed), build bundled. cov: be 85.18%+
  (carry; +7 BE) / fe 80.64% (carry). NOTE: the C237 mergeBackupConfig + mergeStorageConfig stay in settings/routes.ts (config-specific, single-site
  — not over-extracted; arch rule 5 no churn-for-churn).
- **C239 (guard): cover the 4 `validateStorageConfig` consistency branches (settings/routes.ts, was ~56%)** — BALANCE: nothing OVER budget; `guard`
  most-starved (cyc 234, starved-for 5) → highest-leverage. Per the C236 steering note (clean coverage low spots exhausted → characterize a
  known-hard seam via the HTTP harness), picked validateStorageConfig: it gates a user from saving a BROKEN or CROSS-TENANT storage-routing config
  (a regression would let photos route to a non-owned/disabled provider — data-routing + tenant), and it's HTTP-harness-reachable via PUT /settings
  with raw-seeded providers (the C237 pattern); the validator runs on the MERGED config so it also exercises mergeStorageConfig. The C237
  settings-route-errors test covered GET + the ZodError path + a path-traversal backupConfig + a valid partial — but NONE of the 4 storageConfig
  consistency branches. +4 HTTP tests (storage-config-validation.test.ts, raw-seeded owned providers): (1) fully-consistent config → 200 (positive
  control); (2) a default referencing a NON-OWNED provider → 400 'does not belong to this user' (the cross-tenant routing guard); (3) a default
  whose provider has NO providerCategories entry → 400 'no category settings'; (4) a default whose category is present but NOT enabled → 400
  'Cannot disable'. PROCESS: first draft sent partial providerCategories maps → all 400'd as ZodError ('Invalid request data') BEFORE reaching the
  validator — the inner `z.record(photoCategoryEnum, …)` is EXHAUSTIVE in Zod v4 (the C70 trap), so added a categoryMap() helper building all 4
  category keys; the assertions then hit the real validator branches (confirmed via the distinct 400 messages, not the schema 400). green→green:
  backend validate:local EXIT 0 — 1341 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean (no reflow), build bundled. Test-only, no production
  change. cov: be 85.18%+ (carry; +4 BE, settings/routes.ts validateStorageConfig now branch-covered) / fe 80.64% (carry).
- **C240 (deep-review): financing write+balance+hook path — CERTIFIED CLEAN; pinned the refinance-after-payoff balance-reset invariant** —
  BALANCE: TWO at budget — `deep-review` (cyc 235, starved-for 5 = 5) + `bug` (cyc 237, starved-for 3 = 3); deep-review waited LONGER (touched C235
  vs C237) → deep-review wins. spawn_run 400 → inline (the C231/C235 precedent). Audited the financing write-path firsthand, CERTIFIED CLEAN: (1)
  computeBalance/computeBalances are payment-history-based (originalAmount − SUM(financing-payment expenses), clamped ≥0), C101-consistent; the
  SUM isn't userId-scoped but `sourceType='financing'` expenses require validated ownership to create (#62) so no cross-tenant injection. (2) Every
  route entry-point is ownership-gated: POST create-or-replace validates the VEHICLE (findByUserIdAndId) then findByVehicleId; PATCH
  payment-amount / PUT payoff / DELETE all call validateFinancingOwnership (financing→its vehicle→owned, throws NotFound on either miss, no info
  leak). (3) onFinancingDeactivated → clearSource('financing', id, userId) nulls BOTH sourceType+sourceId, userId-scoped, best-effort. (4) The
  #67/C206 re-finance reactivation (isActive→true, endDate→null) is correct. THE one subtle invariant with NO dedicated test: re-financing REUSES
  the same row (#67), so the new loan's balance is correct ONLY because payoff/DELETE first clearSource the old payment links — else computeBalance
  (filtered by source_id) would subtract the OLD loan's payments from the NEW originalAmount (a wrong headline $, NORTH_STAR #1/#2). The
  financing-balance property test covers the math but not this multi-step chain. GUARD (record-only cert + a merge-surviving net where coverage was
  thin — the C108/C179 precedent): +2 DB-integration tests (refinance-balance-reset.test.ts, real FinancingRepository + ExpenseRepository over an
  in-memory DB): pay-down→clearSource→reuse-row→FRESH full balance ($20k−$8k paid, cleared, re-fin $30k → $30k); + a proves-the-dependency case
  (SKIP the clear → the reused row wrongly shows $22k, documenting WHY payoff must clearSource so a dropped-hook regression resurfaces). NON-VACUOUS
  by construction (the two cases differ ONLY by the clearSource call → 30000 vs 22000). green→green: backend validate:local EXIT 0 — 1344 pass /
  1 skip / 0 fail (+2), tsc 0, musl-biome clean (1 unused-import + a long-line reflow autofixed), build bundled. NO production change (clean cert).
  cov: be 85.18%+ (carry; +2 BE) / fe 80.64% (carry).
- **C241 (bug → #83): mark-serviced time-axis re-arm advanced nextDueDate only ONE period — a multi-period-overdue reminder stayed overdue +
  immediately re-fired** — BALANCE: `bug` OVER budget (cyc 237, starved-for 4 > 3, FORCED — the C240 forecast). Hunted the reminders mark-serviced
  path (markServiced repo is userId-scoped clean; the re-arm MATH lives in the route). FOUND #83 (MED, UX/correctness): POST /:id/mark-serviced
  time axis did `fields.nextDueDate = advanceReminderDueDate(reminder, reminder.nextDueDate)` — a SINGLE one-period advance. For a reminder serviced
  when it's MULTIPLE periods overdue (e.g. a monthly reminder serviced 5 months late, or any reminder whose startDate-anchored nextDueDate lapsed
  long ago), one advance lands the new date STILL <= now → the just-serviced reminder remains overdue and re-fires on the next trigger pass (the
  user serviced it but the app keeps nagging). VERIFIED firsthand. The trigger path already advances to-future (the `while (nextDue <= now)` catch-up
  + fastForwardPastNow); mark-serviced did not. FIX (mirror fastForwardPastNow, NOT the capped catch-up — maxCatchUpOccurrences=12 is a
  MATERIALIZATION budget; mark-serviced creates nothing so it must reach the future regardless of how lapsed it is): loop
  `while (nextDue <= now)` advancing via advanceReminderDueDate, with the strict-advance backstop (throw ValidationError if the date doesn't move —
  the bug #13 non-progress guard; advanceReminderDueDate also throws on a bad interval). GUARD: +1 HTTP test (mark-serviced.test.ts: a 2020-01
  monthly reminder serviced now → next_due_date strictly in the FUTURE). NON-VACUOUS by construction (old single-advance → 2020-02, still ≪ now →
  RED). PROCESS: two self-caught test bugs — first capped the loop at maxCatchUp=12 (only reached ~2021 for a 2020 reminder → still past; switched
  to the unbounded fastForwardPastNow pattern), then compared the `mode:'timestamp'` next_due_date (unix SECONDS) against Date.now() (ms) → fixed
  to now-in-seconds. green→green: backend validate:local EXIT 0 — 1344 pass / 1 skip / 0 fail (+1), tsc 0, musl-biome clean (no reflow), build
  bundled. cov: be 85.18%+ (carry; +1 BE) / fe 80.64% (carry).
- **C242 (infra): CLAUDE.md orientation refresh — suite size + closed-bug list (#78→#83) + the known-hard-seam guard note (drift C236→C241)** —
  BALANCE: `infra` AT budget (cyc 236, starved-for 6 = 6, FORCED — the C241 forecast). The #5 sweep ran recently (C236) so it's not due; the
  actionable infra increment is the CLAUDE.md refresh (forecast ~C240, last content-refreshed C230 + coverage-line C236). Three drifts fixed: (1)
  suite size ~1328 BE → ~1344 (FE 592 still accurate); (2) the closed-bug list ended at #78/C229 → extended with #80 (C233 per-user license-plate +
  migration 0005), #81 (C235 Math.max-spread crash-class, 18 sites), #82 (C237 backupConfig per-provider merge), #83 (C241 mark-serviced to-future
  re-arm), range bumped C155–C229 → C155–C241; (3) added a note that recent guard/deep-review cycles now characterize KNOWN-HARD seams via the
  HTTP harness + raw-seeded providers (C239 validateStorageConfig's 4 branches; C240 the financing refinance-balance DB-integration net) — so a
  future guard cycle knows that vein is being actively worked, not just "thin." DOCS-ONLY (CLAUDE.md only — verified `git diff --name-only` shows
  just CLAUDE.md), no source touched → no build gate (the C230/C236 doc-refresh precedent). Next CLAUDE.md refresh ~C252; next #5 sweep ~C246. cov:
  be 85.18% / fe 80.64% (carry — no code, no re-measure this cycle).
- **C243 (arch): extract `withComputedBalance` — the financing `{...financing, computedBalance, eligibleForPayoff}` enrichment, 3 sites → 1** —
  BALANCE: `arch` AT budget (cyc 238, starved-for 5 = 5, FORCED — the C242 forecast). The arch vein is thin (noted C221/C227), so scouted a
  contained dedup with a concrete payoff (rule 5, no churn). FOUND: the `{ ...financing, computedBalance, eligibleForPayoff: isEligibleForPayoff(
  computedBalance) }` shape was hand-rolled at 3 sites — vehicles/routes.ts list (batch computeBalances Map path) + single GET, and
  financing/routes.ts (a local enrichWithBalance helper) — the SAME trio C182 collapsed the `<= 0.01` threshold across. Extracted a pure
  `withComputedBalance<T>(financing, computedBalance)` beside isEligibleForPayoff in financing/repository.ts (takes the ALREADY-computed balance, so
  it serves both the per-record computeBalance and the batch-Map paths without coupling to how the balance was fetched; generic over the financing
  shape so it covers both the full VehicleFinancing and the vehicle-joined object). Wired all 3 sites + dropped the now-unused isEligibleForPayoff
  import from both route files. PAYOFF: one source of truth for the derived-field SET (not just the threshold) — a future enrichment field can't be
  added to one site and forgotten in the others. Test-anchored (rule 3, green→green): every existing vehicles + financing route test passed
  UNCHANGED through the substitution (incl. vehicles-list-financing-contract.test.ts which pins the enriched key-shape) + 3 new direct unit tests
  (with-computed-balance.test.ts: enrichment shape, payoff-threshold boundary, no-mutation). green→green: backend validate:local EXIT 0 — 1347 pass
  / 1 skip / 0 fail (+3), tsc 0, musl-biome clean (1 test reflow autofixed), build bundled. cov: be 85.18%+ (carry; +3 BE) / fe 80.64% (carry).
- **C244 (bug → #76 BACKEND): a non-fuel expense write persisted fuel-only fields (volume/fuelType/mileage/missedFillup) — server-side clear added** —
  BALANCE: `bug` AT budget (cyc 241, starved-for 3 = 3, FORCED — the C243 forecast). Hunted fresh write-paths: odometer create/PUT CERTIFIED CLEAN
  firsthand (both ownership-gated + recheck-wired C214; updateSchema=createSchema.partial() so the future-date .refine + odometer.min(0) survive,
  C180 class). THE live gap — the BACKEND analog of #76 (the C226 FE fix): `validateFuelExpenseData` only enforces the FORWARD direction (a `fuel`
  expense MUST have volume+mileage) — it never strips fuel fields from a NON-fuel write, and both POST `/` (createIdempotent({...expenseData})) +
  PUT `/:id` (update(id, updateData)) wrote verbatim. So a direct API caller (or a future/stale client — the FE clears client-side, C226) could
  persist a maintenance/misc row carrying volume/fuelType/missedFillup AND a stray `mileage` — which getCurrentOdometer reads CROSS-CATEGORY
  (odometer/repository.ts UNION has NO category filter, VERIFIED) → a typo'd mileage on a non-fuel row POISONS the reminder/lease odometer axis
  (#76's documented reachability, now reachable server-side). FIX: a pure `clearFuelFieldsIfNotFuel(data)` that nulls the 4 backend fuel columns
  (volume/fuelType/mileage/missedFillup; `charge` is FE-only, mapped to volume at the boundary) when `category` is explicitly present + non-fuel —
  mirrors the FE C226 clear-set (lines 369-374). Applied on POST (normalize before validate+write) + PUT (normalize updateData before update; keyed
  on updateData.category so a fuel→maintenance switch that OMITS the fuel fields still clears them, and a non-category edit is a no-op). Decision-
  free (a non-fuel expense definitionally has none of these). GUARD: +3 HTTP tests (non-fuel-clears-fuel-fields.test.ts, read row back via
  ctx.sqlite): POST misc w/ stray volume/fuelType/mileage/missedFillup → all nulled; PUT fuel→maintenance (category-only) → fuel fields nulled; a
  genuine fuel expense KEEPS its fields (no over-clear). NON-VACUOUS by construction (pre-fix the verbatim write stored the stray values).
  green→green: backend validate:local EXIT 0 — 1350 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean (1 test reflow autofixed), build bundled.
  cov: be 85.18%+ (carry; +3 BE) / fe 80.64% (carry).
- **C245 (guard): cover DELETE /providers/:id storage+backup config cleanup side effects (providers/routes.ts, ~58% func)** — BALANCE: TWO at
  budget — `guard` (cyc 239, starved-for 6 = 6) + `deep-review` (cyc 240, starved-for 5 = 5); guard waited LONGER (touched C239 vs C240) → guard
  wins. Per the C236/C239 steering (clean low spots exhausted → characterize a known-hard seam via the HTTP harness), picked the providers DELETE
  cleanup: deleting a STORAGE provider must scrub it from the user's settings (cleanupStorageConfig nulls any storageConfig.defaults pointer at it +
  removes its providerCategories entry; cleanupBackupConfig removes its backupConfig.providers entry, routes.ts:418-454) — a regression leaves a
  dangling default (photo uploads route to a deleted provider) or a stale backup entry. The existing providers-routes-http DELETE tests cover only
  the 204 + tenant-scoping (#63); the cleanup HELPERS had no end-to-end coverage. +2 HTTP tests (delete-provider-config-cleanup.test.ts, the C91
  s3-seam — no OAuth/env-gate): (1) create s3 → PUT settings pointing a category default + a providerCategories entry + a backupConfig entry at it →
  DELETE → GET settings asserts the default is NULLED + both entries GONE; (2) a 2-provider case proving the OTHER provider's config references stay
  intact (the scrub is targeted, not over-broad). Used the all-4-category exhaustive map (the C70 Zod-v4-record trap) + all-null defaults helper (the
  C239 pattern). green→green: backend validate:local EXIT 0 — 1352 pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean (no reflow), build bundled.
  Test-only, no production change. cov: be 85.18%+ (carry; +2 BE, providers/routes.ts DELETE-cleanup now covered) / fe 80.64% (carry).
- **C246 (deep-review): sync RESTORE path (ZIP + Sheets, insert/stamp/ref-integrity) — CERTIFIED CLEAN; pinned the financing-ref ownership
  invariant** — BALANCE: `deep-review` OVER budget (cyc 240, starved-for 6 > 5, FORCED — the C245 forecast). spawn_run 400 → inline (C231/C235/C240
  precedent). Audited the restore path firsthand, CERTIFIED CLEAN: (1) BOTH restoreFromBackup (ZIP) + restoreFromSheets call assertReplaceNotEmpty
  (the #21 empty-replace TOTAL-wipe guard) symmetrically (lines 123/238) — no path-asymmetry. (2) stampUserId force-stamps the importer on every
  userId-COLUMN table (vehicles/insurance/reminders/reminderNotifications/expenses/odometer/userPreferences/syncState — C145); the un-stamped
  children (financing/insuranceTerms/insuranceClaims/junctions) own INDIRECTLY via an FK to a stamped parent. (3) The model is SOUND because
  validateReferentialIntegrity (backup.ts:574) constrains EVERY FK-child to the backup's OWN in-backup id sets (expenses/financing/terms/term-veh
  junctions/claims/odometer/photos/photoRefs/reminders/reminder-veh junctions/notifications) — so a child can't reference a parent outside the
  (importer-stamped) backup, and metadata.userId is validated against the importer. A crafted backup can't smuggle foreign-owned data. (4)
  detectConflicts is tenant-scoped (C109). THE merge-surviving guard left where coverage was thin (the C108/C179/C240 record-only-cert precedent):
  restore-junction-refs.test.ts covered the JUNCTION ref-check (reminder_vehicles → bogus vehicle) but NOT financing — the highest-stakes UNSTAMPED
  child (no userId column; its ENTIRE ownership safety rests on validateFinancingRefs constraining it to in-backup vehicleIds). +1 HTTP test: create
  financing → tamper vehicle_financing.csv to point at an out-of-backup vehicleId → restore REJECTED (cites 'vehicle'), original data intact (no
  wipe — validation runs before the replace txn). NON-VACUOUS (the control restores cleanly). Fixed a self-caught path bug: financing mounts at
  /api/v1/financing/vehicles/:id/financing (not /api/v1/vehicles/...). green→green: backend validate:local EXIT 0 — 1353 pass / 1 skip / 0 fail
  (+1), tsc 0, musl-biome clean (no reflow), build bundled. NO production change (clean cert). cov: be 85.18%+ (carry; +1 BE) / fe 80.64% (carry).
- **C247 (bug → #84): insurance claim create/update wrote vehicleId/termId VERBATIM — no ownership/policy validation (cross-tenant FK + integrity)** —
  BALANCE: `bug` AT budget (cyc 244, starved-for 3 = 3, FORCED — the C246 forecast). Hunted the insurance CLAIM write-path (noted "certified clean
  in passing" C226 but never focus-hunted). FOUND #84 (MED, within-tenant integrity + cross-tenant FK): createClaimSchema/updateClaimSchema accept
  OPTIONAL `vehicleId` + `termId` ("links to a specific term/vehicle"), and both POST `/:id/claims` + PUT `/:id/claims/:claimId` validated ONLY
  policy ownership then passed the data to claims-repository create/update which write termId/vehicleId VERBATIM (claims-repository.ts:103-104/
  133-134). So a user could file/edit a claim referencing a vehicle they DON'T own (a cross-tenant FK — the claim row is theirs but points at a
  foreign vehicle) or a termId from a DIFFERENT policy (even another tenant's) → corrupted claim attribution + a planted cross-tenant reference (the
  #61/#62/C240 class). VERIFIED firsthand. FIX: a `validateClaimRefs(data, policyId, userId)` helper — if `vehicleId` present → validateVehicle-
  Ownership (the existing C240 validator, already imported); if `termId` present → findById(policyId) [returns the policy WITH terms] + assert the
  termId is among policy.terms, else ValidationError. Wired into both POST (create) + PUT (re-validate a changed link). Only checks present fields (a
  null-clear on update is a no-op). GUARD: +4 HTTP tests (claims-http.test.ts): foreign vehicleId → 404; termId-not-on-policy → 400 (cites 'term');
  own-vehicle+real-term → 201 control (no over-block); PUT re-point to unowned vehicle → 404. NON-VACUOUS (pre-fix the verbatim write stored the
  foreign ids → 201). green→green: backend validate:local EXIT 0 — 1357 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean (no reflow), build
  bundled. cov: be 85.18%+ (carry; +4 BE) / fe 80.64% (carry).
- **C248 (infra): #5 branch-hygiene sweep + coverage re-measure (last sweep C236, ~12 cycles / overdue)** — BALANCE: TWO at budget — `infra` (cyc
  242, starved-for 6 = 6) + `arch` (cyc 243, starved-for 5 = 5); infra waited LONGER (touched C242 vs C243) → infra wins. The #5 sweep was due
  (last C236, forecast ~C246); CLAUDE.md was refreshed recently (C242) so the doc-refresh wasn't the pick. (1) STRAY-TEST CHECK CLEAN: zero
  untracked non-e2e `.test.ts` in the tree. (2) GREEN BASELINE + RE-MEASURE: backend `bun test --coverage` EXIT 0 (1357 pass / 1 skip) — **be
  85.91% line / 85.31% func** (up from C236's 85.18/84.74 — the C237 backupConfig + C239 validateStorageConfig + C244 fuel-clear + C245
  delete-cleanup + C247 claim-refs BE additions); frontend `vitest --coverage` EXIT 0 (592 pass) — **fe 80.64% line / 80.51% func / 74.97%
  branch** — FLAT vs C236 (every C237–C247 cycle was backend, so FE didn't move). BE↔FE gap ~5pts (86 vs 81). The BE bug/guard arc keeps lifting
  backend; FE is steady at ~80.6 (its pure/service layer is saturated, the rest is eyes-on components). Refreshed CLAUDE.md's coverage line to the
  C248 reading. DOCS/MEASUREMENT-ONLY (CLAUDE.md + ledger; no source touched) → the two coverage runs + stray-test check WERE the verification.
  Next #5 sweep ~C258; next CLAUDE.md content-refresh ~C252. cov: be 85.91% line / 85.31% func / fe 80.64% line / 80.51% func / 74.97% branch
  (FRESH C248 reading).
- **C249 (arch): hoist the duplicated `findIdsByVehicleId` query body into a shared `BaseRepository.findIdsByColumn`** — BALANCE: `arch` OVER budget
  (cyc 243, starved-for 6 > 5, FORCED — the C248 forecast). Scouted honestly (the vein is thin, noted C221/C227): REJECTED the photo-cleanup-on-
  delete blocks (4 route files, but each enumerates DIFFERENT child entity-types via different repos → a shared abstraction would be MORE complex,
  the C75 churn trap) and the claim/term/expense FK-validators (different parent-scopes). FOUND a genuine contained dup: ExpenseRepository.
  findIdsByVehicleId (:195) + OdometerRepository.findIdsByVehicleId (:36) had BYTE-IDENTICAL bodies (select id-and-map where vehicleId=?) differing
  only by the table — both back the C-tested vehicle-delete photo-cascade cleanup. Both extend BaseRepository, so hoisted a protected generic
  `findIdsByColumn(column, value)` into the base; each repo's named method collapses to a one-line delegate (keeping the public typed contract the
  vehicle-delete relies on). PROCESS: two self-caught tsc fights — `select({ id: this.table.id })` rejects the loose generic `Column` type (the
  projection slot wants the concrete SQLiteColumn), and casting via `Parameters<typeof eq>` still mismatched; resolved by selecting the FULL row
  (like the base's findById, type-clean, zero casts) + mapping `.id` — immaterial row-width for these small bounded per-vehicle child sets. Test-
  anchored (rule 3, green→green): the vehicle-delete-cascade test exercises BOTH findIdsByVehicleId paths + passed UNCHANGED. green→green: backend
  validate:local EXIT 0 — 1357 pass / 1 skip / 0 fail (UNCHANGED, behavior-preserving), tsc 0, musl-biome clean, build bundled. cov: be 85.91% / fe
  80.64% (carry — pure refactor, no test-count change).
- **C250 (guard): cover the provider-free sync-backup route slices — GET /backups/download + /backups/providers (sync/routes.ts, was 72%/59%)** —
  BALANCE: nothing OVER budget; `guard` most-starved (cyc 245, starved-for 5) → highest-leverage. Per the C236/C239 steering (characterize a
  known-hard seam via the HTTP harness), the C248 measure flagged sync/routes.ts as the genuine BE low spot (72% func / 59% line). C188 covered the
  status/restore-providers/POST handlers; the byte/provider-bound paths were left as C163 mock-trap territory — but TWO slices are PROVIDER-FREE and
  were uncovered: (1) GET /backups/download (:139-154) — exportAsZip reads the user's OWN db data, no provider; (2) GET /backups/providers with no
  providerId (:135) — listAllBackups iterates enabledProviders, which is EMPTY for a user with no backup providers → returns [] with no provider
  call. +3 HTTP tests (sync-route-success.test.ts): download → 200 with a REAL ZIP (PK signature, Content-Type application/zip, attachment
  Content-Disposition w/ vroom-backup- filename, matching Content-Length) after seeding a vehicle; anon download → 401; empty-provider list → 200
  []. The download route is the user's "download my backup" button — its header-shaping + auth wrapper had no route-level coverage (existing tests
  use exportAsZip at the SERVICE level only). green→green: backend validate:local EXIT 0 — 1360 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean
  (no reflow), build bundled. Test-only, no production change. cov: be 85.91%+ (carry; +3 BE, sync/routes.ts download+list slices now covered) / fe
  80.64% (carry).
- **C251 (bug → clean sweep + escalation): hunted 6 fresh write/compute surfaces, NO live defect — the cross-tenant/integrity vein is exhausted** —
  BALANCE: `bug` AT budget (cyc 247, starved-for 3 = 3, FORCED — the C250 forecast). Per the bug-cycle pattern + the C21/C77 don't-manufacture rule,
  hunted SIX surfaces firsthand, ALL CERTIFIED CLEAN against source: (1) insurance POLICY create (validates nested term vehicleCoverage via
  repo.create C240) + PUT (updatePolicySchema is scalar-only — company/notes/isActive, no FK to validate); (2) insurance TERM + CLAIM writes
  (guarded C240/C247); (3) CSV import-mapping units — resolveTargetUnits passes the target vehicle's units (the C60 risk was already closed); (4)
  expense SPLIT create/update — both validateVehicleOwnership on the splitConfig (C101/C240); (5) getQuickStats ytdSpending (sum of all expense
  rows — split siblings sum to the group total, financing/reminder rows are real outflows → no double-count); (6) analytics getYearEnd (totalSpent
  vs prevTotalSpent are calendar-year-bounded identically at second-granularity → previousYearComparison compares like-for-like; well-covered by
  year-end.property.test). markNotificationRead is userId-scoped. NO defect found → NO code change (the don't-manufacture rule; this is the honest
  C21/C77 outcome, not a punt). CONCLUSION: the cross-tenant/integrity vein that produced #80/#82/#83/#84/#76-backend over C233–C247 is genuinely
  worked through. send_message'd Angelo: the autonomous bug vein is past its high-leverage frontier — the HIGH-value remaining work (the ~30-commit
  branch is PR-ready; the 3 eyes-on feature tails; the filed product/accounting calls #36/#37/#43/#44/#79/#45/#19/#24/#51/#69) is all human-gated.
  Loop continues on marginal guard/arch/coverage increments. NO build gate (no code touched — record-only, the C225/C246 clean-cert precedent). cov:
  be 85.91% / fe 80.64% (carry).
- **C252 (deep-review): analytics getSummary/getFuelStats path — CERTIFIED CLEAN except FILED #85 (fuel-stats "This/Last Year" mislabel,
  product-gated)** — BALANCE: `deep-review` AT budget (cyc 246, starved-for 5 = 5, FORCED — the C251 forecast). spawn_run 400 → inline. Audited the
  getSummary dashboard aggregation + getFuelStats firsthand. CERTIFIED CLEAN: ytdSpending = sum of all expense rows (split siblings sum to the group
  total, no double-count); fleetHealthScore uses neutral-50 defaults (C139); avgEfficiency per-vehicle unit-converted; isFillup volume-bearing
  predicate (bug #18 fix) consistent. THE finding → #85 (MED, ESCALATED, product-gated): buildFuelStatsFromData computes `currentYearFillups` = ALL
  fillups in the client-supplied range (NO year filter, :1340) and `previousYearFillups` = prevYearAgg.count over the immediately-PRECEDING
  equal-length window (:1341), but the FuelStatsTab labels them "This Year" / "Last Year" (FuelStatsTab.svelte:170/174) — while the sibling
  "This/Last Month" numbers ARE true calendar months (getMonth(), :1343/1347). The analytics range is whatever the dashboard requests (default all,
  or 7d/30d/90d/1y), almost never a calendar year → for a 30d view "This Year" = last 30 days + "Last Year" = the prior 30 days, both labeled as
  years (the #9 interestPaidYtd-rename class; same family as the filed #45 period-scoped-stats call). FIX is a SEMANTICS decision (calendar-YTD vs
  relabel "This/Last Period" vs hide-on-non-year-range) → NOT loop-decidable (changes a headline figure + the FE↔BE contract). send_message'd
  Angelo + filed #85. NO code change (the rest of the path is clean + the finding is gated — record-only, the C225/C246/C251 precedent). cov: be
  85.91% / fe 80.64% (carry).
- **C253 (infra): CLAUDE.md content refresh — suite size, closed-bug list (#83→#84 incl. #76-backend), pending-Angelo list (+#79/#85)** — BALANCE:
  nothing OVER budget; `infra` most-starved (cyc 248, starved-for 5) → highest-leverage. The #5 sweep + coverage line were done recently (C248), so
  the actionable infra increment is the CLAUDE.md content-refresh (forecast ~C252). Three drifts fixed: (1) suite size ~1344 BE → ~1360 (FE 592
  accurate); (2) closed-bug list ended at #83/C241 → extended with #76-backend (C244 non-fuel-write fuel-field clear) + #84 (C247 claim vehicleId/
  termId validation), range bumped C155–C241 → C155–C247; (3) pending-Angelo product-call list += #79 (stuck malformed offline entry, escalated
  C231) + #85 (fuel-stats This/Last Year range-relative mislabel, escalated C252). DOCS-ONLY (CLAUDE.md only — verified `git diff --name-only`
  shows just CLAUDE.md), no source touched → no build gate (the C230/C242/C248 doc-refresh precedent). Next CLAUDE.md content-refresh ~C263; next #5
  sweep ~C258. cov: be 85.91% / fe 80.64% (carry — no code, no re-measure this cycle).
- **C254 (arch→guard pivot): arch vein dry (2 more candidates rejected as churn) → covered the registry createProviderInstance google-photos/s3
  validation branches** — BALANCE: `arch` AT budget (cyc 249, starved-for 5 = 5, FORCED). SCOUTED a rule-7 FE candidate per the BACKLOG note +
  REJECTED two as churn (arch rule 5 / the C75 outlier lesson): the analytics-api buildQuery (generic, `?`-prefixed, .set-only) vs expense-api
  buildExpenseQuery (bare string, `tags` .append array + .trim + no-default-sort, EXPORTED+tested as the search-correctness contract) are DIFFERENT
  shapes — converging them would force the tested one to lose its array handling or thread a special case. With C249's 3 BE rejections, the arch
  vein is genuinely exhausted of clean dedups → per don't-force-a-blocked-pick, pivoted to the next-actionable `guard` (cyc 250, starved-for 4).
  GROUNDED guard pick (C248 measure: providers/domains/storage/registry.ts 66% func): registry.test.ts already covers getDefaultProvider (3
  throws + happy + no-settings), getBackupProviders, getProvider, createProviderInstance (google-drive + unsupported-type + GD-missing-refreshToken)
  — the UNCOVERED branches were the google-photos + s3 builder validation gates (registry.ts:41-64, credential/config integrity throws). +5 tests
  (createProviderInstance is pure-construct, no network/DB): google-photos happy [reuses cached albumId] + missing-refreshToken throw; s3 happy +
  missing-accessKeyId/secretAccessKey throw + missing-endpoint/bucket/region throw. green→green: backend validate:local EXIT 0 — 1365 pass / 1 skip
  / 0 fail (+5), tsc 0, musl-biome clean (no reflow), build bundled. Test-only, no production change. cov: be 85.91%+ (carry; +5 BE, registry
  createProviderInstance now fully branch-covered) / fe 80.64% (carry). NOTE: the arch category is now reliably dry — future arch picks should
  expect to pivot unless a NEW dup is introduced by feature work.
- **C255 (bug): second clean sweep — 4 more surfaces hunted, all clean + already test-covered; bug category now effectively DORMANT** — BALANCE:
  `bug` AT budget (cyc 251, starved-for 3 = 3, FORCED). Per the C251 finding (integrity vein exhausted) + don't-manufacture (C21/C77), hunted FOUR
  surfaces NOT covered in C251's sweep, all CERTIFIED CLEAN against source: (1) expense CSV export — neutralizeCsvRow guards every string cell
  (CWE-1236, one-way, the #36-class closed here); (2) odometer getHistory UNION ALL — keeps an expense-mileage reading + a manual reading as
  DISTINCT events by design (no double-count; count query sums both legs consistently; ORDER BY recorded_at DESC + LIMIT/OFFSET correct); (3)
  buildExpenseConditions filter combination — vehicleId/category/date(×2)/each-tag-as-EXISTS (AND semantics ✓) / search as a parenthesized
  (desc LIKE OR category LIKE) sub-clause that can't break the outer AND; date inclusive (#39), LIKE-escaped (#41); (4) re-confirmed the high-risk
  paths are ALREADY test-covered (odometer-history.property.test, the registry suite C254, the restore suite C246). NO defect → NO code (the honest
  C21/C77 outcome). CONCLUSION: across C251+C255 (10+ surfaces) the bug vein is confirmed DRY and the high-risk paths are pinned. STANDING
  GUIDANCE: treat `bug` as effectively DORMANT — a forced bug cycle should do ONE quick fresh-surface scout, and if clean (the expected outcome),
  record a one-line sweep + pivot to the next-actionable category rather than burn tokens re-hunting covered ground. Re-arms only when feature work
  or an Angelo-unblocked product call lands new code. (Already escalated C251 — no re-escalation.) NO build gate (no code touched). cov: be 85.91%
  / fe 80.64% (carry).
- **C256 (deep-review): mileage-reminder trigger path — CERTIFIED CLEAN; pinned the per-MILESTONE dedup invariant** — BALANCE: `deep-review`
  most-starved (cyc 252, starved-for 4) → highest-leverage. spawn_run 400 → inline. Audited processMileageReminder + the notification dedup
  firsthand. CERTIFIED CLEAN: guards null-milestone + single-vehicle (D4) + currentOdometer≥milestone (the due check, getCurrentOdometer is the
  MAX-across-sources C168-scoped); idempotency is BELT-AND-BRACES — app-level mileageNotificationExists check + the PARTIAL unique index
  rn_reminder_odo_idx on (reminderId, dueOdometer) WHERE dueOdometer IS NOT NULL as the race backstop + createMileageNotification catches the
  UNIQUE violation → null (no double-fire under concurrent triggers); the time-axis (reminderDueIdx on (reminderId,dueDate)) + mileage-axis are
  cleanly separated via the NULL-distinct trick + the partial index; no auto-re-arm (mark-serviced is the explicit path, C25 design). THE guard
  gap (the C108/C246 record-only-cert precedent): trigger-mileage.test covered at/over/below-milestone + idempotent-re-trigger (SAME milestone →
  still 1) + no-vehicle + MAX-across-sources — but NOT the DISTINCT-milestone invariant: after mark-serviced re-arms to a new milestone, crossing
  THAT must fire a fresh notification (the dedup is per-milestone via the composite index, not per-reminder; a regression to a reminderId-only
  index would silently block every future milestone). +1 HTTP test: cross 35000 → 1 notif; mark-serviced re-arms to 40200; below → still 1; cross
  40500 → 2 notifs at [35000, 40200]. NON-VACUOUS (a reminderId-only dedup would leave it at 1). green→green: backend validate:local EXIT 0 — 1366
  pass / 1 skip / 0 fail (+1), tsc 0, musl-biome clean (1 reflow autofixed), build bundled. NO production change (clean cert). cov: be 85.91%+
  (carry; +1 BE) / fe 80.64% (carry).
- **C257 (guard): cover GET /providers/pending/:nonce — the OAuth-pending-email route + its userId:nonce cross-user isolation** — BALANCE: nothing
  OVER budget; `infra` nominally most-starved (cyc 253, 4/6) but its increments are recent+not-due (#5 sweep forecast ~C258; CLAUDE.md fresh C253),
  so per don't-force-a-blocked-pick the next-actionable is `guard` (cyc 254, 3/6). GROUNDED pick (C248 measure: providers/routes.ts 58% line):
  GET /pending/:nonce reads the in-memory pending-OAuth-credentials store via getPendingEmail(user.id, nonce) — the store's UNIT logic is covered
  (pending-credentials.test) but the ROUTE slice (auth + found/not-found branch + the userId:nonce KEY-SCOPING) was uncovered. +4 HTTP tests:
  own-nonce → 200 + email; unknown → 404; a nonce stored under ANOTHER userId → 404 (cross-user isolation — the key is `${userId}:${nonce}`, so
  user B can't read user A's pending OAuth email); anon → 401. SEAM NOTE: pending-credentials is a process-global Map (no DB), but createTestApp
  dynamic-imports the app AFTER rewriting env — so the test dynamic-imports storePending INSIDE the test (post-harness) to seed the SAME instance
  the route reads (the C163 same-instance discipline); ran clean in the full 182-file suite (no cross-suite Map-pollution flake). green→green:
  backend validate:local EXIT 0 — 1370 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean (no reflow), build bundled. Test-only, no production
  change. cov: be 85.91%+ (carry; +4 BE, providers/routes.ts /pending slice now covered) / fe 80.64% (carry).
- **C258 (infra): #5 branch-hygiene sweep + coverage re-measure (last C248) — + the 90%-goal-plateau observation** — BALANCE: `infra` most-starved
  (cyc 253, starved-for 5) AND the #5 sweep was due (last C248, ~10 cycles). (1) STRAY-TEST CHECK CLEAN: zero untracked non-e2e `.test.ts`. (2)
  GREEN BASELINE + RE-MEASURE: backend `bun test --coverage` EXIT 0 (1370 pass / 1 skip) — **be 85.95% line / 85.64% func** (up a hair from C248's
  85.91/85.31 — the C254 registry + C257 pending-route additions); frontend `vitest --coverage` EXIT 0 (592 pass) — **fe 80.64% line / 80.51% func
  / 74.87% branch** — FLAT vs C248 (C249–C257 all backend). Refreshed CLAUDE.md's coverage line to C258. (3) STRUCTURAL OBSERVATION (worth
  recording at the 30-cycle mark): the coverage curve has PLATEAUED — be ~86% (+0.04 since C248), fe 80.64% (UNMOVED across C248→C258). The 90%
  goal is now structurally UNREACHABLE by the loop alone: the BE pure/route/util layer is essentially saturated (remaining gaps are the
  DI/orchestrator-bound tails — backup-orchestrator execute() body, activity-tracker timers, restore.ts Sheets mock-trap — that need a DI seam, not
  a test), and the FE remaining gap is the components/routes deficit that needs the eyes-on Playwright harness (sandbox-blocked in the loop). So
  90% requires either an Angelo-unblocked harness or a DI-refactor sign-off — NOT loop-grindable. DOCS/MEASUREMENT-ONLY (CLAUDE.md + ledger, no
  source) → the two coverage runs + stray-test check WERE the verification. Next #5 sweep ~C268; next CLAUDE.md content-refresh ~C263. cov: be
  85.95% line / 85.64% func / fe 80.64% line / 80.51% func / 74.87% branch (FRESH C258 reading).
- **C259 (deep-review): analytics getCrossVehicle + its builders — CERTIFIED CLEAN, already well-tested (pure record-only cert)** — BALANCE:
  `deep-review` most-starved (cyc 256, starved-for 3) → highest-leverage. spawn_run 400 → inline. Audited getCrossVehicle (the fleet-comparison
  tab: vehicleCostComparison + fuelEfficiencyComparison + monthlyExpenseTrends + expenseByCategory) firsthand. CERTIFIED CLEAN: (1) per-vehicle
  costPerDistance = totalCost / (maxMileage−minMileage over in-range mileaged expenses) — the period-scoped distance pairs correctly with the
  period cost; the maxMileage>0 && minMileage<Infinity guard requires ≥1 reading; single-reading → distance 0 → null (handled). This is the
  documented #45-family period-scoped semantics (already escalated), NOT a new bug. (2) buildMonthlyExpenseTrends sorts-then-slice(-24) [newest,
  the C11 oldest-slice guard satisfied]; buildExpenseByCategory unknown-cat→misc bucket + div-by-zero guarded (total===0→[]); per-vehicle unit
  conversion correct (#54 per-vehicle pairing). NO guard gap to fill: cross-vehicle.property.test ALREADY drives getCrossVehicle — Property 4
  (category %s sum to 100), Property 5 (costPerDistance formula + null-on-zero edge), #54 (per-vehicle pairing); the only skip is Property 23
  (financing-DI, the deep-review #3 gap, not loop-fixable). Adding a test would be coverage-theater. NO code change (record-only, the
  C225/C246/C251/C256 precedent — certified clean AND already pinned). cov: be 85.95% / fe 80.64% (carry).
- **C260 (guard): cover the providers PUT credentials-re-encrypt + auth-domain-guard branches (providers/routes.ts, the 58% low spot)** — BALANCE:
  nothing OVER budget; `guard` most-starved (cyc 257, starved-for 3) → highest-leverage. GROUNDED pick (C258 measure: providers/routes.ts 58%
  line): the C91 net covered PUT displayName+config + the no-credentials-echo, but TWO PUT branches were uncovered: (1) the
  CREDENTIALS-RE-ENCRYPT branch (:397-399, the security-sensitive one) and (2) the auth-domain → 400 guard via the LIVE HTTP path (domain-guard.test
  covers it only by source-scan). +2 HTTP tests: PUT with new credentials → 200, the response NEVER echoes the new secret + `credentials` absent,
  AND the stored DB column (read via ctx.sqlite) was updated + does NOT contain the plaintext secret (encrypted-at-rest invariant); PUT against a
  raw-seeded auth-domain provider → 400 ('Auth providers cannot be modified through this endpoint'). green→green: backend validate:local EXIT 0 —
  1372 pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean (no reflow), build bundled. Test-only, no production change. cov: be 85.95%+ (carry;
  +2 BE, providers/routes.ts PUT credentials/auth-guard now covered) / fe 80.64% (carry).
- **C261 (arch dry re-cert → guard pivot): pin the sync-worker's path-resolution resilience branches** — BALANCE: feature most-starved (cyc 170,
  starved-for 91) but structurally human-gated (escalated; 3 eyes-on tails + product calls await Angelo) → next actionable over-budget = `arch`
  (cyc 254, starved-for 7 > 5). ARCH SWEEP (2 inline scouts, spawn_run still 400s): production frontend CLEAN (Intl/toLocaleString only in tests;
  chart-formatters already converged C-prior); backend dry — the 7 validateXOwnership validators are deliberately individual (documented shape
  differences: NotFoundError-name + findById-vs-findByIdAndUserId vary; collapsing = churn, rule 5), the recent dedups (C243 withComputedBalance /
  C249 findIdsByColumn / C254 registry) cleared the clean picks, `groupByVehicle`/`buildPaginatedResponse` are ALREADY shared, the 66 structured
  `logger.error({error})` sites are the distinct idiom C147 correctly left (converging risks changing log serialization — NOT behavior-preserving),
  and the `new Set(map(v=>v.id))` pair isn't byte-identical. → arch RE-CERTIFIED DRY (the C254 precedent; recording no-churn-warranted IS the arch
  job) and PIVOTED the increment to a grounded guard slice. PICK (high-value, genuinely uncovered): `processSingleRef` (sync-worker.ts:228-234) has
  TWO unpinned resilience branches every existing test skipped — (1) `resolveProviderFolderPath` THROWS → caught, upload still proceeds with empty
  pathHint (a storage_config glitch must NOT strand a photo in `failed` forever, NORTH_STAR #1 no-silent-loss); (2) an entityType NOT in
  ENTITY_TO_CATEGORY → category undefined → resolve SKIPPED via the `if (category)` guard, upload still proceeds. +2 unit tests (sync-worker.test.ts):
  throwing resolve → resolve-attempted + upload(pathHint:'') + ref ends ACTIVE-not-failed; unknown-entityType → resolve-NOT-called + upload(pathHint:'')
  + ACTIVE. NON-VACUOUS (each asserts the upload happened AND the ref didn't strand). green→green: backend validate:local EXIT 0 — 1374 pass / 1 skip /
  0 fail (+2), tsc 0, musl-biome clean, build bundled. Test-only, no production change. cov: be 85.95%+ (carry; sync-worker path-resolution branches
  now covered) / fe 80.64% (carry).
- **C262 (bug — found+fixed a LIVE defect, NOT the dormant-sweep outcome): #86 fuel-stats "This/Last Month" counted cross-year** — BALANCE: feature
  most-starved (starved-for 92) but human-gated; next actionable over-budget = `bug` (cyc 255, starved-for 7 > 3). Bug was declared DORMANT (C251/C255),
  so the protocol is scout-a-fresh-surface → record → pivot — but this scout HIT a real defect on a surface the recent sweeps hadn't touched
  (analytics fuel-stats month aggregation), so it's a genuine bug cycle, not a sweep. FOUND (firsthand, repository.ts:1342-1356):
  buildFuelStatsFromData filtered currentMonth/prevMonth fillups + gallons on `toDate(r).getMonth() === currentMonth` with NO year check. fuelRows
  spans the WHOLE requested range (default 'all' = multi-year), so a fillup from the SAME calendar month in a PRIOR year was folded into "This Month"
  — three years of January data → the "This Month" figure triple-counted. The FE (FuelStatsTab.svelte:184/188/227/231) labels these "This Month"/"Last
  Month" = true calendar months, consistent with the `now`-derived currentMonth → the contamination is unambiguously wrong (NORTH_STAR #2). DISTINCT
  from the product-gated #85 (which is ONLY the year-ROW's range-relative labeling — none of its 3 options touch the month rows). FIX: derive
  `currentYear = now.getFullYear()` + `prevMonthYear` (Jan → previous year rollover) + `inCurrentMonth`/`inPrevMonth` predicates matching BOTH month
  AND year; applied to all 4 month figures (fillups + gallons, current + prev). +2 deterministic regression tests (fuel-stats-calendar-month.test.ts,
  dates RELATIVE to now → host/run-date independent): a prior-year same-month fillup does NOT contaminate This Month (currentMonth=1 not 3,
  volume=10 not ~208; currentYear range-figure still sees all 3); "Last Month" rolls into the previous YEAR when now is January (wrong-year same-month
  excluded). NON-VACUOUS (the prior-year rows carry volume 99 → pre-fix currentMonth would be 3). green→green: backend validate:local EXIT 0 — 1376
  pass / 1 skip / 0 fail (+2), tsc 0, musl-biome clean, build bundled; the existing single-year fuel-stats property tests passed UNCHANGED
  (behavior-preserving for them). cov: be 85.95%+ (carry) / fe 80.64% (carry).
- **C263 (infra): CLAUDE.md content refresh — suite size, closed-bug list (+#86/C262), the #85 parenthetical (now post-#86)** — BALANCE: feature
  most-starved (starved-for 93) but human-gated + already-escalated (re-escalating each cycle is spam, step-7); next actionable = `infra` (cyc 258,
  starved-for 5, breaches next cycle) → the C253/C258 docs-accuracy cadence so future cycles ground correctly, and #86 just closed → 3 stale spots.
  FIXED (CLAUDE.md only): (1) suite size ~1360→~1376 BE; (2) the closed-bug list ended at #84/C247 → appended #86/C262 (fuel-stats "This/Last Month"
  year-scoped) + bumped the arc span C155–C247→C155–C262 and the coverage-arc span C178–C247→C178–C262 / C237–C247→C237–C262 (all backend); (3) the
  #85 pending-Angelo parenthetical said "the sibling month fields ARE true calendar months" — that WAS the #86 bug; now reads "are now true calendar
  months after #86/C262, so this is purely the YEAR row." DOCS-ONLY — verified `git diff --name-only` = CLAUDE.md alone; no code/test/build touched
  (no validate run needed — the prior C262 gate is the last code state, unchanged). The pending-Angelo HIGH list (#36/#37/#43/#44) + the eyes-on
  feature tails are unchanged from C253; not re-escalated (already standing).
- **C264 (deep-review): backup EXPORT path — table-set symmetry CERTIFIED CLEAN; pinned the one uncovered VALUE-round-trip vector** — BALANCE:
  feature most-starved (starved-for 94) but human-gated + escalated; `deep-review` at budget (cyc 259, starved-for 5 = 5, due) → the most-starved
  actionable. Picked the backup EXPORT path (the symmetric partner to the restore path C246 certified; never deep-reviewed). FAN-OUT: spawn_run still
  400s → did it firsthand. CERTIFIED CLEAN: the export/restore TABLE-SET symmetry is AIRTIGHT — FIVE hand-maintained lists (createBackup's 15 data
  keys, TABLE_SCHEMA_MAP, TABLE_FILENAME_MAP, restore insertBackupData's tx.insert() calls, ImportSummary count fields) are ALL pinned equal by the
  C208/C209 drift guards, INCLUDING the exact `if (table && filename)` silent-skip in exportAsZip:434 (backup-table-coverage.test "registry and
  filename map cover exactly the same keys") + every-schema-table-backed-up-or-EXCLUDED_BY_DESIGN. THE finding (the one vector those KEY guards don't
  reach): the per-column VALUE round-trip through convertToCSV's `JSON.stringify(value)` (backup.ts:458) → real csv-stringify (quoted:true) → csv-parse
  → coerceRow's `JSON.parse` — existing coerceRow tests pin the PARSE direction in ISOLATION on hand-built rows (flat unitPreferences, string[] tags),
  but NOTHING round-tripped a NESTED-object JSON column through the full serialize→parse pipe (the CSV-hostile case: commas between allocations + quotes
  around every key, which the CSV layer double-quotes and the parser must unwrap losslessly). expenseSplitConfig (ReminderSplitConfig: { method,
  allocations:[{vehicleId,amount}] }) is the deepest such column. GUARD: reminder-split-config-roundtrip.test.ts (+2 HTTP, the claims-roundtrip
  precedent — seed a multi-vehicle ABSOLUTE split + an EVEN split via the real route, exportAsZip → wipe → restoreFromBackup('replace'), assert the
  nested config is structurally `.toEqual` intact). NON-VACUOUS (asserts the config persisted pre-export as a real object AND survived round-trip — a
  mangle/truncate/double-stringify would fail the post-restore toEqual). green→green: backend validate:local EXIT 0 — 1378 pass / 1 skip / 0 fail (+2),
  tsc 0, musl-biome clean (one format reflow auto-fixed via check:musl:fix; the pre-existing unitPreferencesSchema unused-import is a WARNING, exit 0),
  build bundled. Test-only, no production change. cov: be 85.95%+ (carry) / fe 80.64% (carry).
- **C265 (guard): cover the 3 uncovered trusted-proxy / fallback branches of getClientIp (the rate-limit-key spoof defense)** — BALANCE: nothing OVER
  budget → highest-leverage. feature most-starved (starved-for 95) but human-gated; guard & arch both furthest (4), arch twice-certified dry (C254/C261)
  → grounded guard coverage slice. PICK (scout: utils/client-ip.ts had only 1 referencing test, security-critical — it derives the rate-limit key, and
  keying on a spoofable X-Forwarded-For lets an attacker get a fresh bucket per request, bypassing the auth brute-force limiter). The existing test
  covered the 4 headline trust rules but left 3 security-meaningful branches uncovered: (1) trusted proxy but NO XFF (the `xff ? : undefined` false leg +
  `if (forwarded)` false → must fall through to the socket IP, not crash/'unknown'); (2) trusted proxy with EMPTY/whitespace XFF (`first || undefined` →
  undefined → fall through, NOT key on '' which would pool every empty-XFF request); (3) the no-socket in-process fallback (:62) with a MULTI-hop XFF
  (takes leftmost+trim, mirroring the trusted parse — was only single-value-tested). +3 unit tests (extend client-ip.test.ts via the injected
  trusted-proxy list + the connInfoThrows toggle — no new harness). NON-VACUOUS (each asserts the resolved key is the socket/leftmost IP, not '' or
  'unknown'). green→green: backend validate:local EXIT 0 — 1381 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean, build bundled. Test-only, no
  production change. cov: be 85.95%+ (carry; client-ip.ts trusted-proxy + fallback branches now covered) / fe 80.64% (carry).
- **C266 (bug — DORMANT-vein sweep, record-only): 3 fresh surfaces scouted, all CLEAN + already well-pinned; no live defect, no warranted test** —
  BALANCE: `bug` the only ACTIONABLE over-budget category (cyc 262, starved-for 4 > 3); feature is more-starved (96) but human-gated. Bug has been
  DORMANT since C251/C255 (re-confirmed C262 found the last live one, #86) → the protocol is scout-a-fresh-surface → fix if real, else record + pivot.
  SCOUTED THREE surfaces the recent sweeps hadn't deeply hit, all CERTIFIED CLEAN firsthand: (1) `OdometerRepository.getCurrentOdometer` — cross-source
  MAX(expenses.mileage ∪ odometer_entries.odometer) BY VALUE, userId-scoped on BOTH legs (#48/#168), null-vs-zero distinct; its dedicated test already
  pins all of it incl. the cross-TENANT leg (a foreign user's higher reading returns null) + NULL-mileage skip + per-vehicle scope — comprehensive. (2)
  reminder due-date math (computeNextDueDate/advanceCustom/clampToAnchorDay in trigger-service.ts) — month/year advance sets day=1 BEFORE the month bump
  (the Jan-31→Feb overflow guard), anchor-day clamp to min(anchorDay,lastDay), non-positive-interval throws (#13); pinned by compute-next-due-date.property
  + trigger-nonprogress-frequency + the C153/C241 work. (3) csv-safety neutralize/denormalize — FORMULA_TRIGGERS leading-token guard (=/+/-/@/TAB/CR,
  CWE-1236) is symmetric + covered. ALSO a quick arch scout (arch at-budget 5/5): NO clean byte-identical dedup — the `new Date(x*1000)` 8-site idiom is
  trivial/divergent (churn, rule 5), `c.get('user')` (105 sites) is the standard Hono pattern, not a dedup target. RECORD-ONLY (the C255/C259 precedent —
  the scout IS the bug touch; forcing a test on an already-comprehensively-pinned surface is coverage-theater, the C225 rule). No code, no test, no gate
  run (no source touched — the C265 gate is the last code state). The bug vein remains EXHAUSTED; next forced bug cycle, scout a not-yet-hit surface again.
- **C267 (arch): extract `toDateInputValue` — the date→YYYY-MM-DD input idiom, 9 sites → 1 (FE fan-out found it)** — BALANCE: `arch` the only ACTIONABLE
  over-budget category (cyc 261, starved-for 6 > 5); feature more-starved (97) but human-gated. arch was twice-cert-dry on the BACKEND (C254/C261) +
  C266's quick backend scout — so per rule 7 ran a fresh FE fan-out (spawn_run still 400s → inline). FOUND: `new Date(x).toISOString().split('T')[0]` /
  `.slice(0,10)` (identical output for an ISO string) hand-repeated 9× across 6 files — ExpenseForm + expense-form-validation, ReminderForm (×2),
  VehicleForm (×2: purchaseDate + financing.startDate), the odometer-new route, and the CSV-download filename in expense-api. CONCRETE PAYOFF (rule 5):
  it's ALSO the UTC-based off-by-one tz class the NORTH_STAR flags + `dateOnlyToISO` already guards on the REVERSE direction — converging the writers to
  one chokepoint makes that future local-date fix ONE edit not nine. NOT previously filed/rejected (grep'd the loop docs). Added `toDateInputValue(date:
  Date | string)` to formatters.ts (beside dateOnlyToISO/formatDate — the right home, NORTH_STAR #4; pure `.ts`, fully testable). BEHAVIOR-PRESERVING
  (rule 2): replicates the CURRENT UTC `.slice(0,10)` output EXACTLY — NOT the local-date fix (that stays a future `bug` cycle changing displayed
  values). The C135/C166 precedent: a pure value-helper swap returning the IDENTICAL string can't change rendered output, so it's anchored by the
  helper's tests + the green FE suite, not a screenshot (no eyes-on needed for a provably-identical value substitution). Wired all 9 (mixed Date and
  string inputs — the helper takes both) + the 4 needed imports; removed the now-redundant `|| ''` fallbacks where the helper always returns a string.
  +3 unit tests (formatters.test.ts: Date input, ISO-string input, parity-with-the-legacy-idiom split-vs-slice). green→green: frontend validate:local
  EXIT 0 — type-check 0, build OK, 595 tests pass (+3), every existing form/service test passed UNCHANGED through the 9 swaps (behavior-preserving
  proof). cov: fe 80.64%+ (carry; +3 FE) / be 85.95% (carry).
- **C268 (bug — #87, the leverage payoff C267 set up): `toDateInputValue` read the UTC date → off-by-one + broken stored-date round-trip** — BALANCE:
  nothing OVER budget → highest-leverage. The standout: C267 had just CENTRALIZED the date→input idiom into one chokepoint, explicitly so this latent
  tz defect (NORTH_STAR #2 correct-for-everyone) becomes a one-line fix — unambiguous (not a product call) + deterministically unit-testable, the highest
  leverage available. FOUND/FIXED: `toDateInputValue` used `new Date(x).toISOString().slice(0,10)` = the UTC calendar date. Two harms: (a) a
  negative-offset (Americas) user editing late in the day saw TOMORROW pre-filled; (b) — the worse one — it BROKE THE STORED-DATE ROUND-TRIP:
  `dateOnlyToISO` persists date-only values anchored at NOON LOCAL, and noon-local in a positive offset (e.g. +14) is the PREVIOUS day in UTC, so a
  vehicle's saved purchaseDate / financing.startDate reloaded ONE DAY EARLIER in the edit form. FIX: read the LOCAL components
  (getFullYear/getMonth+1/getDate, zero-padded) — the forward partner to dateOnlyToISO's reverse direction. Noon ± any real offset (±14h) never crosses
  LOCAL midnight, so a dateOnlyToISO→toDateInputValue round-trip is now EXACT in every timezone (the property the UTC version violated). Updated the C267
  tests UTC→LOCAL + made them host-tz-INDEPENDENT by construction (build the Date from local components `new Date(y,m,d,…)`, assert the same y/m/d back)
  + added a round-trip-in-every-tz test (dateOnlyToISO→toDateInputValue identity over 4 dates incl. leap-day) + zero-pad. NON-VACUOUS (the round-trip
  test FAILS under the old UTC `.slice(0,10)` for a positive-offset host). green→green: frontend validate:local EXIT 0 — type-check 0, build OK, 596
  tests pass (net +1: consolidated 3 C267 tests → 4), every form/service test UNCHANGED (the call sites bind correctly to the local output). Single FE
  chokepoint, all 9 call sites benefit. cov: fe 80.64%+ (carry) / be 85.95% (carry).
- **C269 (infra): coverage RE-MEASURE — 11 cycles stale (last C258); ground the post-C260/C265/C262/C268 reading** — BALANCE: nothing OVER budget →
  most-starved of the due pair (infra 6 = budget, deep-review 5 = budget); feature most-starved (99) but human-gated. Picked infra — the C236/C248/C258
  cadence: a fresh MEASURED reading (not an estimate) grounds future guard/coverage picks, and the C260/C265 guard adds + C262/C268 fixes had moved it.
  RAN both suites with `--coverage`: **backend 85.65% line / 85.95% func** (was 85.64/85.95 at C258 — line +0.01; the C260/C265 guard adds were
  already-covered-adjacent, so no jump — expected, those pinned uncovered BRANCHES of already-line-covered files). **frontend 80.72% line / 80.58% func /
  75.00% branch** (was 80.64/80.51/74.97 — crept up on the C267/C268 formatters tests). Both suites hold > 80% line. The 90% goal remains the C258
  STRUCTURAL PLATEAU: backend is saturated except DI/orchestrator-bound tails; the FE gap is the eyes-on components/routes deficit (Playwright-gated) —
  NOT loop-closable without an eyes-on harness or a human glance. DOCS-ONLY: updated the CLAUDE.md coverage line (C258→C269 figures) + this entry; no
  source/test/build touched (the C268 gate is the last code state). Recorded the measure honestly; no churn-test forced to chase a structurally-gated number.
- **C270 (deep-review): offline-sync outbox + conflict-resolution write path — CERTIFIED CLEAN; pinned the 3 uncovered resolveConflict outcomes** —
  BALANCE: `deep-review` the ONLY actionable OVER-budget category (cyc 264, starved-for 6 > 5); feature more-starved (100) but human-gated. Picked the
  offline-first data-safety surface (NORTH_STAR #1 — offline writes never drop), never fully deep-reviewed. spawn_run still 400s → firsthand. CERTIFIED
  CLEAN: (1) `offline-storage.ts` is COMPREHENSIVELY pinned already — the deterministic clientId backfill (idempotency-key-stability bug guard), #66
  electric-charge survival through the shared offlineExpenseToBackend mapper, corrupted-localStorage graceful fallback, every CRUD primitive, and the
  syncOfflineExpenses happy-path + mid-batch-partial-failure (no data loss) + malformed-fuel-skip + the #79 stuck-queue characterization. (2)
  `sync-manager.ts` determineConflictType (duplicate-vs-modified) is C223-pinned. THE finding (the one genuinely uncovered high-value branch):
  `resolveConflict` (the keep_local/keep_server/merge WRITE path — the data-safety decision point where a user's choice between their offline edit and
  the server row is honored) had only the two BOOLEAN happy-path tests; the load-bearing OUTCOMES were unpinned. +4 tests: keep_local POSTs
  forceOverwrite+clientId; keep_local FAILED overwrite → returns FALSE (the catch→break→return-false path — the edit survives to retry, NOT silently
  dropped); keep_server returns true with NO POST (server wins, local retired); merge delegates to keep_local (proves it's not a silent no-op). NON-VACUOUS
  (the failure case asserts false; keep_server asserts zero fetch). NOTE: resolveConflict calls the class-PRIVATE this.markExpenseAsSynced (not the module
  fn), so the assertions pin the observable boolean + fetch behavior, not the mocked module spy (a wrong-target assertion I caught + removed via the gate).
  green→green: frontend validate:local EXIT 0 — type-check 0, build OK, 600 tests pass (+4), every existing sync test UNCHANGED. cov: fe 80.72%+ (carry;
  resolveConflict branches now covered) / be 85.65% (carry).
- **C271 (guard): committed source-scan guard for the #87 UTC date-input class + caught & fixed a RESIDUAL (odometer-edit page)** — BALANCE: guard
  most-starved actionable (cyc 265, starved-for 6 = budget, due); feature more-starved (101) but human-gated. Scouted BE+FE pure-logic for a clean
  coverage pick — all genuinely saturated (client-ip C265, unit-conversions property-tested, mergeUnitPreferences directly tested, payment-planner has a
  7-property suite; the truly-thin FE files are display-name/DOM-observer theater) → the C258/C269 plateau. PIVOTED to the higher-leverage guard the C268
  fix earned: a MERGE-SURVIVING source-scan pinning the #87 class (the UTC date-input idiom can't re-creep into forms), mirroring the no-utc-month-parse /
  no-hardcoded-currency precedent. The new guard IMMEDIATELY EARNED ITS KEEP — it caught a RESIDUAL the C267 sweep missed: `odometer/[entryId]/edit/+page.svelte:69`
  still did `new Date(entry.recordedAt).toISOString().split('T')[0]` → a stored noon-local recordedAt reloads ONE DAY EARLIER in the edit form for
  positive-offset users (the exact #87 bug, on the EDIT page C267 didn't touch). FIXED: routed it through `toDateInputValue` (the C268 local-date
  chokepoint) + added the import. GUARD: `no-utc-date-input.test.ts` (+2) — scans every product .svelte/.ts (comments stripped, line-preserving;
  __tests__ dirs excluded since a test may assert on the idiom) for `.toISOString().split('T')[0]` / `.slice(0,10)`; toDateInputValue (local components,
  no toISOString) never matches. NON-VACUOUS (it found the residual RED before the fix; the live-scan precondition asserts >50 sources). green→green:
  frontend validate:local EXIT 0 — type-check 0, build OK, 602 tests pass (+2 guard; the edit-page fix is product-only), every existing test UNCHANGED.
  cov: fe 80.72%+ (carry) / be 85.65% (carry).
- **C272 (bug-cycle scout → guard): insurance TERM write paths CERTIFIED CLEAN for the #84-class; pinned the cross-tenant vehicle-ownership guard via HTTP** —
  BALANCE: `bug` the only actionable OVER-budget category (cyc 268, starved-for 4 > 3); feature more-starved (102) but human-gated. Bug DORMANT → scout-fresh
  → fix-or-record. SCOUTED two never-recently-hit write paths, BOTH clean: (1) insurance term/coverage writes — the repo's PRIVATE validateVehicleOwnership
  gates create()/addTerm()/updateTerm() before junction insert (repository.ts:175/407/541), so a term's vehicleCoverage.vehicleIds can't reference a
  foreign vehicle (#84/#61 cross-tenant FK class); (2) financing PATCH/payoff/refinance — already C240-certified (reactivation + clearSource ordering). NO
  live defect. THE finding → guard: create()'s guard is property-tested, but the addTerm/updateTerm HTTP paths (the live request surface) were UNPINNED
  (terms-http.test only covered clear-optional-field). +4 HTTP tests (terms-http.test.ts): POST /insurance, POST /:id/terms, and PUT /:id/terms/:termId
  with a RAW-SEEDED foreign vehicleId all → 404 with ZERO junction rows planted (read via ctx.sqlite); PUT also asserts the original owned coverage is
  intact; + an owned-vehicle control proving the guard isn't over-broad. NON-VACUOUS (the 404s + junction-count=0 fail if the guard regresses). green→green:
  backend validate:local EXIT 0 — 1385 pass / 1 skip / 0 fail (+4), tsc 0, musl-biome clean, build bundled. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C273 (arch): extract `vehicleIdsForTerm` — the term junction→vehicleIds derivation, 3 sites → 1** — BALANCE: `arch` the only ACTIONABLE over-budget
  category (cyc 267, starved-for 6 > 5); feature more-starved (103) but human-gated. FAN-OUT scout (spawn_run still 400s → inline): FE candidates all
  rejected — MS_PER_DAY is the C99-rejected churn (divergent month-approx vs day-divisor spellings, re-confirmed), roundToCents is cents-migration-deferred
  (C147), the `n>1`-vs-`n!==1` pluralization idiom (20+ sites) carries an n=0 behavior trap + violates rule-1-small, raw toFixed(2) is only 2 non-currency
  sites. Backend re-scan FOUND a clean one: the `policy.termVehicleCoverage.filter(tc => tc.termId === X).map(tc => tc.vehicleId)` derivation was
  byte-identical at 3 sites in insurance/routes.ts (create-policy loop :114, addTerm :206, updateTerm :238 — only the termId source + surrounding args
  differ), each feeding createTermExpenses/updateTermExpenses. Extracted pure `vehicleIdsForTerm(termVehicleCoverage, termId): string[]` to insurance/hooks.ts
  (beside its consumers; typed `readonly TermCoverageRow[]` so it's decoupled from the full policy) + wired all 3 → one-liners. PAYOFF (rule 5): one source
  for the junction→vehicleIds shape — a future coverage-shape change touches one place. BEHAVIOR-PRESERVING (faithful 1:1 map, no dedup — the consumers
  dedup downstream). +3 unit tests (vehicle-ids-for-term.test.ts: filter+project in order, empty/unknown term → [], no cross-term leak); anchored ALSO by
  the existing premium-expense-hook + the C272 term-ownership HTTP tests passing UNCHANGED through the extraction. green→green: backend validate:local
  EXIT 0 — 1388 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome clean (import-order auto-fixed), build bundled. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C274 (infra): gitignore Playwright transient artifacts — branch-hygiene sweep found test-results/ unignored (~155 churning files)** — BALANCE: nothing
  OVER budget → highest-leverage; infra most-starved (cyc 269, starved-for 5, breaches next), and the #5 branch-hygiene cadence is high-value at ~84
  commits deep pre-PR. SWEEP (firsthand): NO untracked SOURCE files (src/ or loop/) + NO modified-uncommitted tracked files — the branch is clean of real
  gaps. But the working tree carried 329 untracked files, ~232 of them under `frontend/test-results/` (Playwright's per-run artifacts: traces, .network
  logs, transient PNGs/JPEGs, error-context) + a stray `playwright.meshclaw.config.ts` — NONE gitignored, so every hygiene sweep drowns in churn and a
  pre-PR `git add .` would commit megabytes of regenerated junk. FIX (config-only, the standard Playwright convention): added a Playwright section to
  frontend/.gitignore — `test-results/`, `playwright-report/`, `blob-report/`, `.playwright-artifacts-*/`. VERIFIED scope precisely via `git check-ignore`:
  test-results/ + playwright-report/ now IGNORED; the e2e `*.meshclaw.e2e.ts` specs + the committed `*-snapshots/` baselines stay VISIBLE (untouched —
  those are a separate tracked-or-deliberate-untracked decision). Untracked dropped 329 → 122 (the remaining 122 = the deliberate set: e2e specs,
  snapshot baselines, .meshclaw-tools/, .kiro specs, mise.local.toml). DOCS/CONFIG-ONLY (only frontend/.gitignore tracked-diff; no code → no build gate
  needed, gitignore doesn't affect compilation). De-noises every future hygiene sweep + protects the eventual PR from artifact pollution.
- **C275 (deep-review): vehicle-stats computation path — CERTIFIED CLEAN; extended #30 with a SECOND unit-unaware-filter site** — BALANCE: `deep-review`
  most-starved actionable (cyc 270, starved-for 5 = budget, due); feature more-starved (105) but human-gated. Picked the per-vehicle headline-stats path
  (calculateVehicleStats: avg MPG, cost/mile, fuel/charge totals — never deep-reviewed). spawn_run still 400s → firsthand. CERTIFIED CLEAN: the function
  is COMPREHENSIVELY property-pinned already — fuelType partition (totalFuel+totalCharge = Σvolume; electric-only vs liquid-only splits), tracking-flag
  gating (averageMpg null unless trackFuel; mi/kWh null unless trackCharging), the #46 negative-distance clamp (Math.max(0, latest−initial)), the #75
  order-independence (calculateAverageMpg sorts a copy before pairing), missed-fillup pair exclusion, costPerMile div-guard. THE finding (record-only, NOT
  loop-actionable): `vehicle-stats.ts:179` calculateAverageMpg's inline `mpg > 0 && mpg < 150` outlier bound is a SECOND INSTANCE of the #30 unit-unaware-filter
  class (the C126-filed, product-scope-gated finding that named ONLY analytics-charts.ts's MIN/MAX_VALID_MPG) — a metric km/L vehicle's realistic efficiency
  is mis-shaped against the 150 imperial ceiling. Same scope-gate (store-native-vs-canonical units + shared FE/BE invariant) → NOT a clean unilateral fix.
  Extended the #30 BACKLOG entry to record this site so the eventual scope-call fix doesn't miss it (a fix touching only analytics-charts would leave the
  per-vehicle averageMpg cull mis-calibrated). RECORD-ONLY (the C259/C246 clean-cert precedent — surface clean + already comprehensively pinned; the one
  finding is a known product-gated class, not a fresh defect). No code, no test, no gate run (no source touched — the C274 state is unchanged). cov:
  be 85.65% (carry) / fe 80.72% (carry).
- **C276 (bug-cycle scout → guard): mark-serviced re-arm CERTIFIED CLEAN; pinned the uncovered EARLY-service time-axis branch** — BALANCE: `bug` the only
  category strictly OVER budget (cyc 272, starved-for 4 > 3); feature more-starved (106) but human-gated. Bug DORMANT → scout-fresh → fix-or-record.
  SCOUTED the reminder mark-serviced re-arm path (POST /:id/mark-serviced) firsthand. CERTIFIED CLEAN: the two-axis re-arm is sound by domain semantics —
  TIME axis is SCHEDULE-anchored (advance from nextDueDate; the #83 multi-period-overdue fast-forward loop is correct + tested), MILEAGE axis is
  USAGE-anchored (reset to current odometer + intervalMileage); the axis difference is INTENTIONAL, not a bug. Comprehensively pinned already: mileage
  anchor+recompute, re-armed-no-longer-due-at-trigger, time one-period advance, the #83 overdue catch-up, `both`-axis, cross-tenant 404. THE finding → guard:
  every existing time-axis test seeds a PAST startDate (overdue → the `while (nextDue <= now)` loop runs), so the EARLY-service branch (servicing when
  nextDueDate is already in the FUTURE → loop skips, single unconditional advance) was UNCOVERED. +1 HTTP test: a yearly reminder anchored 2099 (always
  future, host-independent) serviced early advances EXACTLY one year forward (Δ 364–367 days) and stays future — pins the schedule-anchored early-service
  semantics (NOT "reset relative to now"). NON-VACUOUS (the Δ bound fails if the advance is skipped or collapsed toward now). green→green: backend
  validate:local EXIT 0 — 1389 pass / 1 skip / 0 fail (+1), tsc 0, musl-biome clean, build bundled. NO live defect — bug vein still exhausted. cov:
  be 85.65%+ (carry) / fe 80.72% (carry).
- **C277 (guard): cover the two zero-coverage settings POST endpoints — /backup (side effect) + /restore + auth-gating** — BALANCE: `guard` most-starved
  actionable (cyc 271, starved-for 6 = budget, due); feature more-starved (107) but human-gated. SCOUT: settings/routes.ts was the thinnest route module
  (4 referencing test files); the GET + PUT branches are well-pinned (C237/C238/C239), but `POST /settings/backup` and `POST /settings/restore` had ZERO
  HTTP coverage. /backup has a REAL observable side effect — syncStateRepository.updateBackupDate writes sync_state.last_backup_date (read by a
  backup-status UI) — worth pinning end-to-end. +3 HTTP tests (settings-route-errors.test.ts): POST /backup → 200 + the DB row's last_backup_date goes
  from null → a real timestamp (read via ctx.sqlite, bounded ≤ now+5s — proves the write LANDED, not just a 200); POST /restore → 200 success envelope;
  BOTH require auth (anon → 401, pinning the routes.use('*', requireAuth) chain). NON-VACUOUS (the null→timestamp assertion fails if updateBackupDate
  regresses; the 401s fail if the auth chain drops). green→green: backend validate:local EXIT 0 — 1392 pass / 1 skip / 0 fail (+3), tsc 0, musl-biome
  clean, build bundled. Test-only. cov: be 85.65%+ (carry; settings POST /backup+/restore now covered) / fe 80.72% (carry).
- **C278 (arch): extract `triggerBlobDownload` — the browser save-as Blob-download idiom, 2 sites → 1** — BALANCE: `arch` most-starved actionable (cyc 273,
  starved-for 5 = budget, due); feature more-starved (108) but human-gated. FAN-OUT scout (spawn_run still 400s → inline): backend dry (groupByVehicle/
  parseClampedInt already shared; deleteBySource one-liners; envelope is the standard Hono pattern — no clean dedup). FE FOUND one: the 7-line object-URL →
  anchor → href → download → appendChild → click → revokeObjectURL → removeChild "save a Blob as a file" dance was BYTE-IDENTICAL at 2 sites (expense-api
  CSV export :162-169 + settings-store backup download :77-84), differing only in blob + filename. Extracted pure `triggerBlobDownload(blob, filename)` to
  new `utils/download.ts` (no existing DOM/download util — NORTH_STAR #4 checked) + wired both → one-liners (+ 2 imports). PAYOFF (rule 5): one source for
  the download mechanics — a future fix (revoke ordering / Safari workaround) is one edit. BEHAVIOR-PRESERVING (same append→click→revoke→remove ordering as
  both copies; callers still guard browser/ok upstream). +2 unit tests (download.test.ts: object-URL created+revoked + anchor clicked + no DOM leak; the
  download filename is set) via jsdom stubs on window.URL + an HTMLAnchorElement.click spy. green→green: frontend validate:local EXIT 0 — type-check 0,
  build OK, 604 tests pass (+2), every existing expense-api + settings-store test UNCHANGED through the rewire (behavior-preserving proof; tsc caught a
  vi.fn-vs-spyOn typing nit, fixed). cov: fe 80.72%+ (carry) / be 85.65% (carry).
- **C279 (infra): CLAUDE.md suite-size refresh — ~1376→~1392 BE / ~592→~604 FE** — BALANCE: nothing OVER budget → highest-leverage; infra most-starved
  (cyc 274, starved-for 5); feature more-starved (109) but human-gated. The C253/C263 docs-accuracy cadence: the suite-size line was last set C263 (~1376/
  ~592) and the C264/C270/C272/C276/C277/C278 test adds have moved it to 1392 BE / 604 FE — a fresh reading keeps the "don't regress the floor" guidance
  honest. CHECKED the closed-bug list is still ACCURATE at #87/C268 (the "all landed C155–C271" span is correct — C272/C276/C277 added merge-surviving
  GUARDS on certified-clean surfaces + C278 a dedup, NOT new bug fixes; bumping the span would falsely imply a fix landed later). DOCS-ONLY: only the
  CLAUDE.md suite-size line changed (verified `git diff --name-only` = CLAUDE.md before the loop-file edits); no source/test/build touched (the C278 gate
  is the last code state). Minimal, correct refresh.
- **C280 (bug — FIXED #34, a real defect from a fresh scout): photo upload was non-atomic → orphaned provider bytes on a post-upload DB failure** —
  BALANCE: `bug` the only category strictly OVER budget (cyc 276, starved-for 4 > 3); feature more-starved (110) but human-gated. Bug DORMANT → scout-fresh
  → and this one HIT a real, filed-but-unfixed defect. FOUND (firsthand, photo-service.ts uploadPhotoForEntity): provider.upload (external bytes) →
  photoRepository.create (photo row) → photoRefRepository.create (active ref) ran with NO transaction + NO compensating delete. A DB error/constraint after
  the bytes land ORPHANS the external object — no DB row references it, so it's never reconcilable or deletable through the app (#34, NORTH_STAR #1 no
  silent loss). FIX (loop-sized, no new DI seam — `provider` already in scope): extracted `persistUploadedPhotoOrCleanup(provider, providerId, storageRef,
  meta)` that wraps the two inserts in try/catch and best-effort `provider.delete(storageRef.externalId)`s the just-uploaded object before re-throwing; a
  failed cleanup is logger.warn'd (reconcilable) but never masks the original error. The extraction ALSO cleared the Biome complexity ceiling
  (uploadPhotoForEntity went 16→17 with the inline try/catch; the helper drops it back under 15). GUARD: source-scan upload-compensating-delete.test.ts
  (+3, the C133/C220 precedent — a real upload needs a live provider's bytes, not in-harness-drivable without the mock.module leak trap): pins the helper
  exists + is invoked, the catch best-effort-deletes externalId:storageRef.externalId + re-throws, and the orphan-cleanup-failure is logged. NON-VACUOUS
  (body-isolation asserts catch + provider.delete + throw all present). green→green: backend validate:local EXIT 0 — 1395 pass / 1 skip / 0 fail (+3),
  tsc 0, musl-biome clean, build bundled. #34 CLOSED. (#33 — the delete-side external-byte orphan reconcile-queue — remains the larger filed follow-on.)
  cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C281 (deep-review): buildAmortizationSchedule CERTIFIED CLEAN; pinned the negative-amortization edge** — BALANCE: `deep-review` the only category
  strictly OVER budget (cyc 275, starved-for 6 > 5); feature more-starved (111) but human-gated. Picked buildAmortizationSchedule (the loan principal/
  interest projection a user relies on for payoff planning; bug #10 lived here; not re-reviewed since C38) — the C67 analytics-builder cert covered 6
  OTHER builders, not this one. CERTIFIED CLEAN firsthand: balance-clamped principal (final payment can't exceed balance), paid-off loans skip, interest
  non-negative-clamped, no caller-mutation (local balances copy). Comprehensively pinned already: interest-declines/principal-rises (#10), payoff-clamp
  (no negative/phantom), multi-loan aggregation, no-mutation, empty-input. THE finding → guard: the NEGATIVE-AMORTIZATION edge (payment < monthly interest
  → principal = Math.max(0, payment−interest) clamps to 0 → balance frozen, loan never pays off) was UNCOVERED (every prior test used payment > interest).
  +1 test: $10k @ 24% APR, $150/mo payment (< $200 interest) → principal 0 every month, interest a constant $200 (frozen balance), identical across rows —
  pins the under-water-loan behavior (correct, not a bug, but unpinned). NON-VACUOUS (a regression allowing negative principal or un-clamped balance breaks
  the frozen-balance signature). green→green: backend validate:local EXIT 0 — 1397 pass / 1 skip / 0 fail (+1), tsc 0, musl-biome clean (format
  auto-fixed), build bundled. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C282 (guard): pin the cross-tenant WRITE defense on AuthProviderRepository.updateProfile** — BALANCE: nothing OVER budget → highest-leverage; guard
  most-starved (cyc 277, starved-for 5); feature more-starved (112) but human-gated. SCOUT: auth-provider-repository.ts was the thinnest auth module (1
  referencing test) — the OAuth-identity store (links Google/etc accounts to users), constructor-DI'd so directly testable over in-memory SQLite (no
  harness leak trap). Its property-test ALREADY covers 6 methods + domain isolation + delete's cross-tenant guard ("does not delete other users' rows"),
  but `updateProfile` had ONLY the happy path — its parallel cross-tenant WRITE defense (scoped on (id, userId, domain='auth'), so updating another user's
  auth profile with the wrong userId is a no-op — account-profile-tampering defense) was UNPINNED. +1 test: attacker(USER_ID) tries to rewrite USER_ID_2's
  google profile via updateProfile(row.id, USER_ID, {hijacked}) → the victim's row is UNCHANGED (displayName 'Victim', email 'victim@test.com' intact).
  NON-VACUOUS (a regression dropping the userId predicate lets the attacker's values land → fails). green→green: backend validate:local EXIT 0 — 1398 pass
  (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Test-only. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C283 (arch): extract `buildAuthProviderConfig` — the auth-provider `config:{email,avatarUrl}` shape, 3 sites → 1** — BALANCE: `arch` most-starved
  actionable (cyc 278, starved-for 5 = budget, due); feature more-starved (113) but human-gated. FAN-OUT scout (spawn_run still 400s → inline): rejected
  the trivial/divergent candidates per the C99/C273 churn rule — `new Date(x*1000)` (8 trivial analytics sites), the FE store try/catch wrappers (11 sites
  but the catch is the only common part; a HOF wrapper is refactor-for-taste with error-timing risk), createLoadState (already a filed direction call,
  C79). PICKED a real one-source-of-truth dedup: the OAuth-identity `config: { email, avatarUrl }` blob was hand-assembled BYTE-IDENTICALLY at 3 write
  sites — auth-provider-repository create:55 + updateProfile:90 + auth/routes.ts new-user insert:246 — and it's READ BACK via `config.email`/`config.avatarUrl`,
  so the writers must stay in lockstep (the FE↔BE-contract-drift class; rule-5 "collapse N sources into one"). Extracted `buildAuthProviderConfig(email,
  avatarUrl?)` to auth-provider-repository.ts + wired all 3 (+ the routes.ts import). PAYOFF: a future config field (e.g. locale) is added in one place,
  not three. BEHAVIOR-PRESERVING (returns the identical literal). Anchored by the existing create/updateProfile config-shape property assertions + the
  auth-routes tests passing UNCHANGED, +2 direct helper tests (full shape; avatarUrl optional). green→green: backend validate:local EXIT 0 — 1400 pass
  (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean (format auto-fixed), build bundled. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C284 (bug-cycle scout → guard): odometer write paths CERTIFIED CLEAN; pinned the DELETE-no-recheck (downward-change-safe) invariant** — BALANCE: `bug`
  the only category strictly OVER budget (cyc 280, starved-for 4 > 3); feature more-starved (114) but human-gated. Bug DORMANT → scout-fresh → fix-or-record.
  SCOUTED two surfaces, BOTH clean: (1) odometer routes — DELETE /:id does NOT call recheckMileageReminders (POST :131 + PUT :158 do), which I initially
  flagged as a possible gap, but VERIFIED it's CORRECT: processMileageReminder only fires on a FORWARD crossing (currentOdometer >= nextDueOdometer) +
  dedups, never un-fires, so a DELETE (which can only LOWER the odometer) has nothing to re-evaluate; (2) expenses repository source/clientId queries
  (findBySource/findIdsByGroupId/findByClientId) — all userId-scoped, idempotency CAS race-recovery clean. NO live defect. THE finding → guard: the
  downward-odometer-is-safe invariant was subtle + unpinned (recheck-on-write.test covered CREATE+UPDATE firing but not the DELETE/un-fire case). +1 HTTP
  test (recheck-on-write.test.ts): a reading crosses 35000 → fires; DELETE that highest reading (odometer drops below the milestone) → the notification
  SURVIVES (durable history, no un-fire) AND a later /trigger does NOT re-fire (dedup holds, no reading ≥ milestone). NON-VACUOUS (a future "recheck on
  delete" un-fire or a dedup regression breaks it). green→green: backend validate:local EXIT 0 — 1401 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean,
  build bundled. cov: be 85.65%+ (carry) / fe 80.72% (carry).
- **C285 (infra): coverage RE-MEASURE — 16 cycles stale (last C269); ground the post-C270–C284 reading** — BALANCE: nothing OVER budget → infra
  most-starved actionable (cyc 279, starved-for 6 = budget, due); feature more-starved (115) but human-gated. The C236/C248/C258/C269 cadence (~every
  10–11 cycles): a fresh MEASURED reading (not an estimate) grounds future guard/coverage picks, and the C270/C272/C276/C277/C280/C281/C282/C284 BE test
  adds + C271/C278 FE adds moved it. RAN both suites with `--coverage`: **backend 85.74% line / 86.04% func** (was 85.65/85.95 at C269 — +0.09/+0.09; the
  guard adds nudged it). **frontend 81.41% line / 80.64% func / 75.20% branch** (was 80.72/80.58/75.00 — +0.69 line on the C271 no-utc-date-input guard +
  C278 download.ts util tests). Both suites hold > 80% line; FE broke 81%. The 90% goal remains the C258 STRUCTURAL PLATEAU (BE saturated except
  DI/orchestrator-bound tails; FE gap is eyes-on components/routes, Playwright-gated) — not loop-closable without an eyes-on harness or DI sign-off.
  DOCS-ONLY: updated the CLAUDE.md coverage line (C269→C285 figures); no source/test/build touched (the C284 gate is the last code state). Recorded the
  measure honestly; no churn-test forced to chase a structurally-gated number.
- **C286 (deep-review): split-expense edit/delete cascade + expense-filter builder — BOTH CERTIFIED CLEAN, already comprehensively pinned (record-only)** —
  BALANCE: `deep-review` most-starved actionable (cyc 281, starved-for 5 = budget, due); feature more-starved (116) but human-gated. spawn_run still 400s →
  firsthand. SCOUTED two surfaces, both CLEAN + thoroughly covered: (1) `updateSplitExpense`/`deleteSplitExpense` (repository.ts) — userId-scoped destructive
  writes (the #52/C109 cross-tenant class), absolute-edit derives groupTotal from the new legs (NOT the stale stored header — the #60 Property-3 fix),
  source-link (sourceType/sourceId) preserved across an edit (C101), photos migrated to the first new sibling; ALL pinned by expense-repository.property.test
  (groupId preservation, photo migration, source survival, #52 cross-tenant delete+update, #60 absolute-no-total + matching-total-no-op). (2)
  `buildExpenseConditions` (the single source for list + CSV-export filtering) — endDate-inclusive-of-local-day (#39/C6/C61/C103 boundary class), tag AND-semantics
  via json_each, LIKE-metachar escape (#41 `50%`-literal); ALL pinned by date-range-boundary.test (5 cases incl. the findAll/CSV-export-shares-boundary +
  non-midnight-verbatim) + search-paginated.test (#41) + repository.property.test (tag-every). NO defect, NO warranted new test (more would be coverage-theater,
  the C225/C259/C275 rule). RECORD-ONLY (the C259/C275 clean-cert precedent — both targets clean AND already comprehensively pinned). No code, no test, no gate
  run (the C284 state is the last code change; C285 was docs). cov: be 85.74% (carry) / fe 81.41% (carry).
- **C287 (guard): pin the percentage-split penny-residue placement + the over-100% clamp branch** — BALANCE: nothing OVER budget → highest-leverage; guard
  most-starved (cyc 282, starved-for 5); feature more-starved (117) but human-gated. SCOUT: split-service.ts was the thinnest service module (1 referencing
  test) — the money-allocation math (NORTH_STAR #2 currency-correctness). computeAllocations is property-tested for SUM-invariant + even-split fairness +
  count + absolute-passthrough, but two deterministic percentage edges the gens don't reach were UNPINNED: (1) the LAST vehicle absorbs the rounding residue
  (floor the first N-1, exact remainder to last → precise sum: 33/33/34 of $100 = [33,33,34]; 33.33/33.33/33.34 → last carries the cents); (2) the
  Math.max(0,…) clamp (computeAllocations does NOT re-validate — only the route's Zod sum=100 refinement does — so a config whose NON-LAST legs overshoot
  100, e.g. 60/60/10, drives the last remainder negative → must clamp to 0, never −20). +3 deterministic tests. NON-VACUOUS (the clamp test asserts 0 not
  −20; the first attempt RED-validated my algorithm reading — the clamp only triggers when non-last legs overshoot, since only the last leg takes the
  remainder). green→green: backend validate:local EXIT 0 — 1404 pass (+3) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Test-only. cov:
  be 85.74%+ (carry) / fe 81.41% (carry).
- **C288 (bug scout → FILED+ESCALATED #88, pinned current behavior): split reminder naming a DELETED vehicle leaves a partial group** — BALANCE: `bug` the
  only category strictly OVER budget (cyc 284, starved-for 4 > 3); feature more-starved (118) but human-gated. Bug DORMANT → scout-fresh → this scout FOUND
  a real defect, but the FIX is a product call (not loop-decidable) → file + escalate + pin current behavior + don't block. FOUND (firsthand): a SPLIT
  recurring-expense reminder's expenseSplitConfig is a JSON blob (NOT a FK); the reminder_vehicles junction IS FK-cascade-cleaned on a vehicle delete, but
  the config isn't → a deleted vehicle's id persists in it. On the next trigger, createExpenseFromReminder → createSiblings inserts siblings one-by-one; the
  deleted vehicle's leg FK-violates expenses.vehicle_id (onDelete:cascade ref). SHARPER than expected: a throw escaping the async tx callback after the prior
  sync insert does NOT roll back (the C151 better-sqlite3 footgun) → the SURVIVING vehicle's leg can PERSIST as a partial/inconsistent group (groupTotal=$100,
  one $50 leg) while the deleted leg never lands — repeating every trigger, NO user signal (NORTH_STAR #1). The per-reminder try/catch contains it (recorded
  `skipped`, run stays 200). ESCALATED #88 to Angelo (+ a correction msg once I saw the partial-group nuance); resolution is a product call (drop+renormalize
  config on vehicle-delete / deactivate / single-vehicle fallback). CHARACTERIZATION GUARD (+1, trigger-expense.test.ts): split[v1,v2] + independent[v3];
  DELETE v2; trigger → deleted v2 never gets a leg + reminder in `skipped` + the independent v3 reminder STILL fires (containment) + run 200. NON-VACUOUS
  (a fix, or an uncaught-throw regression breaking the whole run, both change these). green→green: backend validate:local EXIT 0 — 1405 pass (+1) / 1 skip /
  0 fail, tsc 0, musl-biome clean, build bundled. cov: be 85.74%+ (carry) / fe 81.41% (carry).
- **C289 (arch): extract `assertLicensePlateAvailable` — the per-user plate-uniqueness check, 2 vehicle-route sites → 1** — BALANCE: `arch` the only
  ACTIONABLE over-budget category (cyc 283, starved-for 6 > 5); feature more-starved (119) but human-gated. FAN-OUT scout (spawn_run still 400s → inline):
  rejected the already-shared (withComputedBalance C243, parseClampedInt C211, getPaginated is the apiClient method). PICKED a real one: the license-plate
  uniqueness check (findByLicensePlate(plate, userId) → ConflictError('A vehicle with this license plate already exists')) was hand-rolled at 2 sites in
  vehicles/routes.ts — POST (162) + PUT (245), the latter adding the self-exclusion (!== id). Extracted async `assertLicensePlateAvailable(plate, userId,
  excludeId?)` (the excludeId param folds in the PUT self-exclusion: POST omits it, PUT passes the current id). PAYOFF (rule 5): the #80/#233 per-user
  plate-uniqueness rule + its message live in ONE place. BEHAVIOR-PRESERVING (POST: existing.id !== undefined is always true when a row exists → throws,
  identical; PUT: excludeId=id self-excluded, identical). Anchored by the existing #80/#233 HTTP tests passing UNCHANGED, +2 NEW tests for the excludeId
  branches the dedup centralizes (re-save-without-plate-change → no self-409; same-user dup on a DIFFERENT vehicle → still 409, proving excludeId isn't
  over-broad). green→green: backend validate:local EXIT 0 — 1407 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean (format auto-fixed), build bundled.
  cov: be 85.74%+ (carry) / fe 81.41% (carry).
- **C290 (guard): pin the cross-tenant ownership guard on /fuel-stats + /fuel-advanced (the 2 uncovered optional-vehicleId analytics endpoints)** —
  BALANCE: nothing OVER budget → highest-leverage; guard most-starved (cyc 287, starved-for 3); infra most-starved (5) but has no pressing work (cov
  re-measured C285, hygiene C274, docs C279 — forcing it would be manufactured); feature more-starved (120) but human-gated. SCOUT: 12 analytics GET
  endpoints, only 7 with HTTP coverage. The C185 net pinned the required-vehicleId guards (vehicle-tco/health) + the optional-vehicleId pair on
  fuel-efficiency, but /fuel-stats + /fuel-advanced carry the IDENTICAL `if (vehicleId) validateVehicleOwnership` optional-guard with its cross-tenant
  branch UNCOVERED. +4 HTTP tests (analytics-routes-http.test.ts): each endpoint — omitted vehicleId → 200 all-fleet envelope (no validation); FOREIGN
  vehicleId → 404 (no cross-tenant analytics leak, the C109/#52 class). DISCOVERY (the RED first run): unlike fuel-efficiency, these two REQUIRE
  startDate+endDate (dateRangeVehicleQuerySchema) — omitting them 400s at zValidator BEFORE the guard; supplying a valid 2024 unix-seconds range reaches
  the guard branch. NON-VACUOUS (foreign-id asserts 404 not 200/400; no-id asserts the 200 envelope). green→green: backend validate:local EXIT 0 — 1411
  pass (+4) / 1 skip / 0 fail, tsc 0, musl-biome clean (format auto-fixed), build bundled. Test-only. cov: be 85.74%+ (carry) / fe 81.41% (carry).
- **C291 (deep-review → guard): backup-orchestrator execute() CERTIFIED CLEAN; converted the C181 skip-path SIMS to real-execute() coverage** — BALANCE:
  infra + deep-review both due (cyc 285/286, starved-for 6/5); infra has no pressing work (cov C285, hygiene C274, docs C279 — manufactured if forced) →
  picked deep-review. Audited BackupOrchestrator.execute() firsthand. CERTIFIED CLEAN: mutex (idempotent delete → the inline-release-at-early-returns +
  finally double-release is HARMLESS, not a bug), force-bypass + change-detection skip, no-providers early return, ZIP-fail→Sheets-only resilience,
  per-provider decrypt-fail skip, Promise.allSettled containment (one provider's failure can't sink the others), the #42 snapshot-START-timestamp
  persist-only-on-success (C144). THE finding: backup-orchestrator.test.ts's mutex/change-skip/no-providers cases are LOCAL SIMS (the C181 coverage-theater
  pattern its own header flags as "execute() not reachable in-harness") — but that note was OVER-CAUTIOUS: createTestApp rewrites DATABASE_URL to in-memory
  BEFORE the (dynamically-imported-here) orchestrator + its getDb() resolve, so the REAL execute() runs against the harness DB, and the EARLY-RETURN skip
  paths return before any storage-provider work → genuinely drivable. +3 real-execute() tests (new backup-orchestrator-execute.test.ts): force=false+no-changes
  → {skipped:true}; has-changes(seeded vehicle bumps lastDataChangeDate)+no-providers → not-skipped+empty results; force=true+no-providers → not-skipped+empty.
  NON-VACUOUS (skipped=true vs undefined distinguishes the change-gate path from the no-providers path; migrations ran + the real module imported, proving
  it's the genuine execute(), not a sim). green→green: backend validate:local EXIT 0 — 1414 pass (+3) / 1 skip / 0 fail, tsc 0, musl-biome clean (format
  auto-fixed), build bundled. cov: be 85.74%+ (carry; execute() skip paths now REAL-covered) / fe 81.41% (carry).
- **C292 (infra): CLAUDE.md refresh — add #88 to the pending-Angelo block + suite size ~1392→~1414 BE** — BALANCE: TWO over budget (infra 7 > 6, bug 4 > 3);
  infra most-starved → picked it (the C253/C279 docs-accuracy cadence). #88 was filed+escalated C288 but the CLAUDE.md pending-Angelo list ended at #85, and
  the suite-size line (C279, ~1392) drifted as C287/C288/C289/C290/C291 added ~22 BE tests → now 1414. FIXED (CLAUDE.md only): (1) appended #88 (split
  reminder + deleted vehicle → partial-group, the C151 async-tx footgun; drop+renormalize / deactivate / single-vehicle — product-gated) to the
  pending-Angelo block beside #79/#85; (2) suite size ~1392→~1414 BE / ~604 FE. CHECKED the closed-bug list is still ACCURATE (last fix was #87/C268; C272–C291
  were guards/dedups/a-filed-#88, not new fixes). DOCS-ONLY — verified `git diff --name-only` = CLAUDE.md alone before the loop-file edits; no source/test/
  build touched (the C291 gate is the last code state). Keeps the next cycle's product-call backlog accurate.
- **C293 (bug): create-or-replace financing leaves STALE cross-type fields when a vehicle's financing type changes (the sibling to C240)** —
  BALANCE: feature most-starved (170, starved-for 123) but every feature tail is Playwright/Angelo-gated (standing escalation, not loop-actionable);
  bug next-actionable over budget (288, starved-for 5 > 3) → forced pick. Bug vein dormant → fresh-surface scout of the FINANCING module (less recently
  scoured). repository.ts/hooks.ts certified clean; the defect is in routes.ts POST. THE finding: `POST /vehicles/:id/financing` is a create-OR-REPLACE
  that REUSES the existing row via `update(...financingData, isActive:true, endDate:null)` (its own comment: "the vehicle's financing is now THIS"). But
  `update()` SKIPS `undefined` keys, and the cross-type fields are all `.optional()` in the create schema — loan-only `apr`, lease-only `residualValue`/
  `mileageLimit`/`excessMileageFee`, schedule `paymentDayOfMonth`/`paymentDayOfWeek`. So converting a vehicle's financing TYPE (lease↔loan) without
  re-sending the prior type's fields LEAVES them stale → a `financingType:'loan'` row carrying a lease `mileageLimit`, consumed by FE lease-metrics
  (financing-calculations.ts:419-433) + the Google-Sheets export (all three lease columns) → a self-contradictory row (NORTH_STAR #2). C240 pinned the
  BALANCE reset on this same reuse path but never the FIELD reset. FIX: coalesce every optional cross-type/schedule field to `null` in the replace path so
  the reused row mirrors a fresh `create()` (where absent nullable columns default to NULL). GUARD: new refinance-cross-type-field-reset.test.ts drives the
  REAL POST over createTestApp in BOTH directions (lease→loan clears the 3 lease fields + keeps apr; loan→lease clears apr + keeps the lease fields) —
  RED before the fix (residualValue 18000 / apr 6.5 lingered), GREEN after. green→green: backend validate:local EXIT 0 — 1415 pass (+2) / 1 skip / 0 fail,
  tsc 0, musl-biome clean, build bundled. cov: be 85.74%+ (carry; the replace path now field-reset-covered) / fe 81.41% (carry).
- **C294 (arch): financing routes adopt the shared `validateVehicleOwnership` — kill the lone hand-rolled vehicle-ownership guard** —
  BALANCE: feature most-starved (170) but Playwright/Angelo-gated (not loop-actionable); arch DUE (last 289, starved-for 5 = budget) → forced
  pick. Arch is "reliably dry" — rule-7 inline scout (spawn_run reliably 400s). THE finding: financing/routes.ts was the SOLE route module
  hand-rolling the vehicle-ownership guard inline (`vehicleRepository.findByUserIdAndId` + a manual `throw new HTTPException(404, {message:
  'Vehicle not found'})`) at 2 sites (GET + POST), while EVERY sibling (expenses/insurance/odometer/analytics/vehicles, ~20 call sites) uses the
  shared `validateVehicleOwnership(vehicleId, userId)` from utils/validation. Neither financing site used the returned vehicle (pure guard-then-
  throw) → a clean dedup. BEHAVIOR-PRESERVING verified (rule 2): `validateVehicleOwnership` throws `NotFoundError('Vehicle')` → the global
  error-handler renders it 404 + message "Vehicle not found" — byte-identical status+message to the inline HTTPException. The only raw-envelope
  delta is the `code` field ('HTTPException'→'NotFoundError'), which CONVERGES financing onto the code every other route already emits for this
  exact case; the FE never branches on either (both absent from ERROR_CODE_MESSAGES → falls back to error.message, unchanged). Side win: the POST
  404 now logs as a client `warn` (NotFoundError IS an AppError, statusCode<500) instead of "Server error" (HTTPException isn't). PAYOFF: -8 LOC
  net, one source of truth for the guard, dead `vehicleRepository` import dropped from the module. GUARD (rule 3, test-anchored both ways): new
  financing-vehicle-ownership-404.test.ts pins the observable 404+message on GET & POST over the REAL routes via createTestApp — GREEN before the
  refactor (against the inline guard) AND after (against validateVehicleOwnership). green→green: backend validate:local EXIT 0 — 1418 pass (+2) /
  1 skip / 0 fail, tsc 0, musl-biome clean (test reflow auto-fixed), build bundled. cov: be 85.74%+ (carry) / fe 81.41% (carry).
- **C295 (deep-review → bug): lease-overage projection compared an ABSOLUTE odometer against a DRIVEN-miles budget — phantom excess fee on
  any used-car lease (#91)** — BALANCE: nothing over budget except gated feature; deep-review highest non-gated budget-pressure (last 291,
  starved-for 4) + pairs with the C293/C294 financing focus → picked it. Inline-scouted the financing/analytics MONEY math (spawn_run 400s).
  CERTIFIED CLEAN: buildAmortizationSchedule (bug #10 fix — walks balance down, clamps at 0), effectiveMonthlyPremium (bug #8 — totalCost
  amortized across the term span), buildSingleFinancingDetail (monthlyInterestEstimate guarded on loan+apr, monthsElapsed clamped). THE FINDING
  (frontend/src/lib/utils/financing-calculations.ts calculateLeaseMetrics): `totalMileageAllowance`/`mileageUsed`/`mileageRemaining` all live in
  DRIVEN-miles space (current − initial), but `projectedFinalMileage` is an ABSOLUTE odometer reading (currentMileage + milesPerDay·daysRemaining),
  and the excess compared the absolute reading DIRECTLY against the driven budget → over-reported projectedExcessMiles + the $ projectedExcessFee
  by EXACTLY initialMileage. A 40k-mi car leased + driven on-pace showed a ~$10k phantom fee at $0.25/mi. Sibling to #64 (C198 fixed the allowance
  SCALING but left this coordinate-space mismatch). NORTH_STAR #2. FIX: project DRIVEN miles (projectedFinalMileage − initialMileage) before
  comparing to the budget. Fields aren't rendered yet (latent in the LeaseMetrics contract) → no UI moved, pure-logic util, no screenshot needed.
  GUARD: +1 lease-metrics test — a 40k-initial / 52k-current on-pace lease projects EXACTLY $0 excess (pre-fix: 76k−36k = 40k phantom miles →
  $10k fee, so non-vacuous). green→green: frontend validate:local EXIT 0 — type-check 0, build, 605 pass (+1), lease-metrics 21/21. cov: be
  85.74% (carry) / fe 81.41%+ (carry; the lease projection now correctly-anchored).
- **C296 (guard): translation-invariance property pins the C295/#91 coordinate-space bug CLASS (not just one example)** — BALANCE:
  guard forced (last 290, starved-for 6 = budget, most-starved actionable; feature gated). Per the LEDGER steering note, steered the
  guard to the freshest high-risk surface — the C295 lease-overage fix. THE GAP: C295 left a single example test (40k-initial on-pace →
  $0), and the pre-existing lease-metrics property test asserts only finiteness + non-negativity — which would NOT have caught #91 (the
  over-reported fee was still finite & non-negative). The bug was a coordinate-space mix (absolute odometer vs driven-miles budget), and
  the merge-surviving guard for that CLASS is a translation-invariance property: adding the SAME constant to both initialMileage and
  currentMileage shifts only the odometer baseline (the car was leased with more miles on it), NOT how far it's driven — so every
  DRIVEN-miles output (mileageUsed, mileageRemaining, projectedExcessMiles, projectedExcessFee, isOverMileage) must be INVARIANT, and only
  projectedFinalMileage (absolute) moves by exactly the shift. +1 fast-check property (200 runs) asserting exactly that. NON-VACUOUS,
  PROVEN: temporarily reverted the #91 fix line → BOTH the C295 example AND this new property went RED (projectedExcessMiles leaked the
  shift: "expected 1 to be close to 0"); restored the fix → green. green→green: frontend validate:local EXIT 0 — type-check 0, build, 606
  pass (+1), lease-metrics 22/22. Guard-only (pure test addition, no source touched) → no UI moved, no screenshot. cov: be 85.74% (carry)
  / fe 81.41%+ (carry).
- **C297 (bug): calculateExtraPaymentImpact treated EVERY 0%-APR loan as inert → "0 mos saved" for an interest-free loan an extra
  payment clearly shortens (#92)** — BALANCE: bug over budget (last 293, starved-for 4 > 3, most-starved actionable; feature gated) →
  forced pick. Pivoted OFF financing (3 cycles deep) to scout odometer/split-service/import-mapping (all CERTIFIED CLEAN — odometer
  repo #48-hardened both legs + getCurrentOdometer MAX-by-value; split-service cents-based remainder-to-last; import-mapping
  decimal-comma + local-date + unit-convert all sound), then back to the FE financing payment-planner. THE FINDING
  (frontend/src/lib/utils/financing-calculations.ts calculateExtraPaymentImpact): the early guard `financingType !== 'loan' ||
  !financing.apr || financing.apr <= 0` lumped every 0%-APR (or no-APR-entered) loan in with leases/own and returned a FLAT
  {monthsSaved:0, interestSaved:0}. But a 0% loan is interest-free, NOT inert — extra payments retire principal faster and genuinely
  shorten the term. PaymentPlannerDialog.svelte:153 renders impact.monthsSaved ("{n} mos"), so an interest-free loan (common: 0%
  dealer financing) wrongly showed "0 mos" for an extra payment that obviously shortens payoff. NORTH_STAR #2. FIX: the amortization
  loop already handles 0% correctly (monthlyRate 0 → full payment to principal), so bail early ONLY for non-loans and let 0%-APR loans
  run the loop with rate 0 (`apr && apr>0 ? apr/100/12 : 0`). GUARD: new extra-payment-zero-apr.test.ts (+4): a $12k @ 0% / $500-a-mo
  loan + $500 extra saves exactly 12 months (24→12) with $0 interestSaved; monotonic; positive-APR path unaffected (both savings >0);
  lease still inert. NON-VACUOUS, PROVEN: restoring the old guard turned the two 0%-APR tests RED ("expected +0 to be 12"). The fixed
  $ figure is shown in the planner dialog (markup unchanged → no pixel moved; eyes-on screenshot Playwright-gated, logic fully pinned).
  green→green: frontend validate:local EXIT 0 — type-check 0, build, 610 pass (+4). cov: be 85.74% (carry) / fe 81.41%+ (carry).
- **C298 (infra): CLAUDE.md docs-accuracy refresh — record #90/#91/#92 in the closed-bug list + suite size ~1418 BE / ~610 FE** —
  BALANCE: infra forced (last 292, starved-for 6 = budget, most-starved actionable; feature gated). The C253/C279/C292 docs-accuracy
  cadence: three bugs closed since the last refresh (#90 C293, #91 C295, #92 C297) but the CLAUDE.md closed-bug list ended at #87/C268
  and even SKIPPED #90 entirely; suites drifted (BE 1414→1418 via C294's +2 ownership-404 tests; FE 604→610 via C295/C296/C297's +1/+1/+4).
  FIXED (CLAUDE.md only): (1) appended #90 (create-or-replace stale cross-type fields), #91 (lease overage absolute-vs-driven), #92
  (0%-APR planner inert) to the closed-bug list + bumped the arc range C155–C271 → C155–C297; (2) suite size ~1414→~1418 BE / ~604→~610
  FE. DOCS-ONLY — verified `git status --short` = CLAUDE.md alone (the ?? items are the pre-existing untracked-by-design e2e/tooling
  scaffold); no source/test/build touched (the C297 gate is the last code state). Keeps the next cycle's closed-bug + suite-floor refs
  accurate. cov: be 85.74% (carry) / fe 81.41% (carry).
- **C299 (arch): extract `simulateAmortization` — collapse the two byte-identical balance-walk loops in calculateExtraPaymentImpact
  into one pure helper** — BALANCE: arch DUE (last 294, starved-for 5 = budget; feature gated) → forced pick. Arch is reliably-dry —
  rule-7 inline scout. THE FINDING (frontend/src/lib/utils/financing-calculations.ts): calculateExtraPaymentImpact ran the SAME
  amortization balance-walk loop TWICE — once for the original payment, once for payment+extra — byte-identical but for the payment
  amount + local var names (originalBalance/originalMonths/originalTotalInterest vs new*). C161's note records that a hand-copied
  variant of exactly this loop once LOST its negative-amortization guard → concrete proof these copies are a live bug vector (rule-5
  payoff: one source of truth for the guarded walk). FIX: extracted `simulateAmortization(balance, monthlyRate, paymentAmount,
  maxMonths) → {months, totalInterest}` (pure; the `principal ≤ 0` break = the C161 guard; monthlyRate 0 ⇒ 0%-APR path #92), called
  twice; savings are the deltas. (Left calculatePayoffDate's loop ALONE — it `return`s today on the under-funded path rather than
  break-ing, so it's NOT byte-identical; rule-2 forbids changing that observable behavior.) The only dropped code was two DEV-only
  console.warn lines (not observable, no test asserts them). −28 LOC. BEHAVIOR-PRESERVING + test-anchored both ways (rule 3): the
  extra-payment-zero-apr + financing-calculations.property + amortization-negative-guard + payment-planner.property suites (46 tests)
  pass UNCHANGED before & after. green→green: frontend validate:local EXIT 0 — type-check 0, build, 610 pass (unchanged — pure
  refactor). Pure util, no UI moved, no screenshot. cov: be 85.74% (carry) / fe 81.41% (carry).
- **C300 (deep-review → bug): merge-mode restore threw a raw PK-violation on the (always-present) userPreferences/syncState collision
  instead of reporting a clean conflict (#93)** — BALANCE: deep-review DUE (last 295, starved-for 5 = budget; feature gated) → forced
  pick. Pivoted off financing to the sync/RESTORE path (NORTH_STAR #1 data-safety hotspot). Inline-audited restore.ts firsthand:
  stampUserId chokepoint, tenant-scoped conflict probes (C109), empty-replace guard, FK-ordered inserts — all SOUND. THE FINDING:
  detectConflicts probes only 6 tables (vehicles/expenses/financing/insurance/photos/photoRefs) but insertBackupData inserts 15 —
  including userPreferences + syncState, whose PRIMARY KEY is userId. The importer ALWAYS has a prefs row (getOrCreate / first-use) and
  a backup ALWAYS carries the creator's prefs row, so a MERGE restore whose 6 probed tables DON'T collide (e.g. importing fresh data
  into an account with only default prefs) slipped past conflict detection straight into insert(userPreferences) against the existing
  PK → `UNIQUE constraint failed: user_preferences.user_id`, an unhandled SQLite throw that rolled back the WHOLE restore. Merge was
  effectively broken for the no-other-collision case (NORTH_STAR #1 — restore must be predictable, not a raw DB error). The existing
  tenant-scope test MASKED it: its merge backups always also self-collided on a vehicle, which short-circuited before the prefs insert.
  FIX: detectConflicts now probes userPreferences + syncState like any owned table (scope eq(userId); the conflict id IS the userId);
  generalized the probe loop with per-entry idColumn/idField so the userId-PK'd tables match + report on userId, not a missing `id`
  column. GUARD: new restore-merge-prefs-collision.test.ts ISOLATES the case (export a ZIP, DELETE the vehicle so ONLY the prefs row
  still collides, merge) — RED before the fix (the raw UNIQUE throw), GREEN after (a clean conflict). green→green: backend
  validate:local EXIT 0 — 1418 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Backend-only, no UI. cov: be
  85.74%+ (carry; detectConflicts now covers prefs/syncState) / fe 81.41% (carry).
- **C301 (bug → file+escalate + guard): fleet-wide fuel-stats pools per-vehicle distance/cost WITHOUT unit conversion — mixed-unit
  fleets get garbage on the main analytics view (#94)** — BALANCE: bug over budget (last 297, starved-for 4 > 3; feature gated) → forced
  pick. Scouted fresh surfaces (financing-deep already): reminders trigger-service (#12/#13/#42/#71/C151-hardened — CLEAN), reminder-cost
  (occurrences/yr — CLEAN), offline-storage syncOfflineExpenses (the batch-abort-on-first-error is INTENTIONAL + test-pinned, the
  failing entry's fate is the product-gated #79 — NOT a clean bug), insurance repo, analytics divisions (all `>0?` guarded). THE FINDING:
  GET /analytics/fuel-stats with NO vehicleId (the DEFAULT analytics-summary path, confirmed in analytics-api.ts:146) aggregates across
  ALL vehicles; buildFuelStatsFromData sums each vehicle's (max−min) odometer span into distance.totalDistance + takes min/max of per-pair
  cost/distance into averageCost.best/worstCostPerDistance — both WITHOUT unit conversion. Vehicles carry PER-VEHICLE unitPreferences
  (vehicles.unit_preferences), so a mi+km fleet pools miles+km into one distance + blends $/mi with $/km on the headline view (NORTH_STAR
  #2). The per-vehicle CHARTS (computeConvertedTotalDistance) already convert; only the summary SCALARS don't. DISTINCT from #45 (period-
  scoping). A SEMANTICS decision (convert-to-user-global / per-vehicle-only / require vehicleId) → FILED #94 + send_message'd Angelo, NOT
  self-fixed. SHIPPABLE increment (bug-cycle floor): a characterization guard (new fuel-stats-fleet-distance-pooling.test.ts, +2) pinning
  the CURRENT raw-pooled behavior (totalDistance = per-vehicle spans summed 800+200=1000 NOT the 40_200 cross-vehicle pool; best/worst =
  $0.05/$0.20 raw min/max) so the eventual fix has a red→green anchor + the bug can't silently worsen. green→green: backend validate:local
  EXIT 0 — 1420 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 85.74% (carry) / fe 81.41% (carry).
- **C302 (guard): drift-proof the #93 conflict-probe symmetry — every inserted table is conflict-probed OR a documented child of a probed
  parent** — BALANCE: guard forced (last 296, starved-for 6 = budget; feature gated). Steered to the freshest high-risk surface — the C300
  #93 restore fix, which was AD-HOC: it added userPreferences + syncState to detectConflicts because those are the always-present singleton
  collisions, but the broader symmetry (insertBackupData inserts 15 tables, detectConflicts probes 8) stayed UNDEFENDED — a future
  parent-less table added to inserts without a probe would silently reintroduce the #93 raw-PK-throw class. THE GUARD (new 3rd test in
  restore-table-coverage.test.ts, the existing source-scan idiom — no DB): every `.insert(<table>)` in restore.ts must be either (a)
  conflict-probed (`name: '<db_table>'` in detectConflicts) or (b) on an explicit CHILD_OF_PROBED_PARENT allowlist (the 7 children whose
  insert is UNREACHABLE on a colliding merge because a probed ANCESTOR collides first → detectConflicts returns before the tx runs:
  insuranceTerms/TermVehicles/Claims, odometerEntries, reminders/Vehicles/Notifications). A new parent-less unprobed table fails loudly with
  a fix-it message. NON-VACUOUS, PROVEN: re-ran the guard logic with the C300 probes stripped → it flagged EXACTLY userPreferences +
  syncState (the #93 gap), confirming it discriminates. green→green: backend validate:local EXIT 0 — 1421 pass (+1) / 1 skip / 0 fail, tsc 0,
  musl-biome clean, build bundled. Guard-only (one test added, no source) → no UI. cov: be 85.74% (carry) / fe 81.41% (carry).
- **C303 (infra): #5 branch-hygiene sweep + coverage RE-MEASURE (last full re-measure C258, ~45 cycles overdue; C285 was a CLAUDE.md-only
  spot-reading)** — BALANCE: nothing over budget except gated feature; infra forced NEXT cycle (C304, 6=budget) AND the #5 sweep was
  genuinely overdue (last full one C258) → took it now as highest-leverage rather than manufacture docs work under the C304 force. (1)
  ZERO stray untracked unit/spec tests (`git status` filtered = the by-design `*.meshclaw.e2e.ts` set + tooling/screenshots only). (2) Green
  baseline BOTH sides: backend bun test --coverage EXIT 0 (1421 pass / 1 skip), frontend validate:local EXIT 0 (610 pass + type-check +
  build). (3) RE-MEASURE: **be 86.07% line / 86.21% func** (up from C285's 85.74/86.04 — the C283/C289/C291/C294/C300/C302 BE arc);
  **fe 81.76% line / 80.70% func / 75.70% branch** (up from C285's 81.41/80.64/75.20 — the C295/C296/C297 FE tests). Both >80% line, gap
  ~4–5pts + stable. Updated the LEDGER COVERAGE TREND header (appended the C303 reading) + CLAUDE.md (coverage line C285→C303, suite
  ~1418→~1421 BE). The 90%-line goal stays structurally gated (BE tail DI/singleton + OAuth-network; FE gap the eyes-on components/routes
  deficit, Playwright-blocked). DOCS/MEASUREMENT-ONLY — no source/test/build touched (the C302 gate is the last code state). Next #5 sweep
  ~C313. cov: be 86.07% / fe 81.76%.
- **C304 (arch): extract `fetchTermsAndCoverage` — collapse the 5× term+coverage query-assembly in InsurancePolicyRepository into one
  helper** — BALANCE: arch DUE (last 299, starved-for 5 = budget, most-starved actionable; bug also at 3 but arch waited longer) → forced
  pick. Arch reliably-dry — rule-7 inline scout. Rejected the analytics-api buildQuery wrappers (already factored — each method is a thin
  typed wrapper over divergent param sets, collapsing = churn over divergent shapes, rule 5). THE FINDING (insurance/repository.ts): the
  byte-identical "select terms by policyId ordered by endDate desc → select the term→vehicle junction rows for those termIds → dedupe
  vehicleIds" block was hand-repeated at 5 sites — attachTermsAndCoverage + the update-policy / add-term / update-term / delete-term
  transactions — differing ONLY in the db handle (this.db vs the tx) + the spread target (some add newTermId). PAYOFF (rule 5): 5 sources of
  truth for the response's coverage shape → 1; a junction-schema change can't drift across them. FIX: extracted private
  `fetchTermsAndCoverage(handle: AppDatabase | DrizzleTransaction, policyId) → {terms, termVehicleCoverage, vehicleIds}` (the existing
  dbOrTx pattern from validateVehicleOwnership, so the in-tx callers still read their own uncommitted writes); callers spread its result +
  add their own policy row / newTermId. DELIBERATELY left the CREATE path (line 253) alone — it builds termCoverage IN-MEMORY from the
  just-inserted terms (accumulated in the insert loop), NOT a re-query; converting would add a redundant round-trip + change behavior (rule
  2). ~75 LOC → 1 helper + 5 thin calls. BEHAVIOR-PRESERVING + test-anchored both ways (rule 3): all 56 insurance tests
  (terms-http/repository.property/policy-delete-cascade/etc.) pass UNCHANGED. green→green: backend validate:local EXIT 0 — 1421 pass
  (unchanged — pure refactor) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Backend-only, no UI. cov: be 86.07% (carry) / fe
  81.76% (carry).
- **C305 (bug → dormant-vein clean scout + contract-pin guard): seven mature surfaces certified clean; pinned the paid-off-financing
  list contract** — BALANCE: bug over budget (last 301, starved-for 4 > 3, most-starved actionable; deep-review also due at 5 but bug is
  over) → forced pick. Bug vein DORMANT → fresh-surface scout. CERTIFIED CLEAN (firsthand): vehicles repo (findByUserId/findByIdWithAccess/
  findByLicensePlate — tenant-scoped, #48/#52-hardened), photos service+repo (deletePhoto refs-then-row ordering safe-by-design;
  setCoverPhoto validate-before-unset in a tx, C151/C63/C72 baked in; cover reassignment deterministic via sortOrder/createdAt), expenses
  filtering (LIKE-escaping correct #41, json_each tag match, endDate-inclusive), auth/OAuth-state (size-capped + expiry-swept + PKCE +
  IP-keyed limiter) + session (dead-cookie clear), Sheets-header coverage (already bidirectionally guarded by sheets-header-coverage.test.ts).
  THE ONE OBSERVED unguarded edge: vehicleRepository.findByUserId leftJoins vehicleFinancing with NO isActive filter, so a PAID-OFF
  (isActive=false) financing row — its row reused-not-deleted per #67/C293 — still rides along on the GET /vehicles list. BENIGN today (every
  FE consumer gates on financing?.isActive), but UNPINNED: a future BE consumer reading vehicle.financing without the gate would resurface a
  paid-off loan. SHIPPABLE increment (bug-cycle floor): +1 contract-pin in vehicles-list-financing-contract.test.ts asserting a paid-off row
  STILL surfaces flagged isActive:false (same reused row id) — so the FE isActive gate stays the documented source of truth + any future
  join-filter change is a conscious, test-visible decision. green→green: backend validate:local EXIT 0 — 1422 pass (+1) / 1 skip / 0 fail,
  tsc 0, musl-biome clean (test reflow auto-fixed), build bundled. cov: be 86.07% (carry) / fe 81.76% (carry).
- **C306 (deep-review): provider/storage CREDENTIAL layer CERTIFIED CLEAN — VROOM's most security-sensitive surface (ARCC-grounded)** —
  BALANCE: deep-review over budget (last 300, starved-for 6 > 5, most-starved actionable; feature gated) → forced. Per ARCC governance
  (credentials domain), consulted search_arcc FIRST (SAX-01 Outcome 2 + SAX-08 Outcome 1: encrypt content at rest, key managed outside the
  data store, unreadable without the key) before reading code. AUDITED FIRSTHAND + CERTIFIED CLEAN: (1) utils/encryption.ts — AES-256-GCM,
  random 96-bit IV per call, 128-bit auth tag (authenticated → tamper-detecting), 256-bit key from PROVIDER_ENCRYPTION_KEY env (NOT in the DB
  — ARCC key-mgmt aligned), correct [IV|tag|ciphertext] layout; (2) providers/routes.ts — encrypt-on-write (create + update), the
  formatProviderResponse is a WHITELIST of 8 non-secret fields (credentials structurally CANNOT leak — robust vs a blacklist); (3)
  s3-compat-provider — clean split: secretAccessKey/accessKeyId = the encrypted credentials blob, endpoint/bucket/region = non-secret config
  (the verbatim-returned config carries no secret); (4) registry.createProviderInstance decrypt-on-read throws on corrupt/wrong-key →
  contained per-provider by the C291 orchestrator's Promise.allSettled; fake provider double-gated (non-prod + opt-in); (5) NO credential
  leakage in any logger.* call. COVERAGE already comprehensive: encryption.test.ts (round-trip incl. empty/unicode/long, random-IV
  uniqueness, wrong-key/tamper/truncated/invalid-base64 throws, missing/wrong-length key) + providers-routes-http.test.ts
  (credentials-never-echoed across create/list/update, the C260 re-encrypt-at-rest branch verifying plaintext is NOT in the stored column,
  domain-guard, ownership-scope). NO defect, NO code change warranted — adding a test would be coverage-theater against an already-pinned
  invariant (the C291 certification precedent). DOCS-ONLY (LEDGER + BACKLOG); no source/test/build touched (C305 gate is the last code state).
  cov: be 86.07% (carry) / fe 81.76% (carry).
- **C307 (guard): pin activity-tracker's two unguarded SAFETY invariants — mid-sync eviction shield + fail-open change-check** — BALANCE:
  nothing over budget except gated feature; guard highest pressure (last 302, starved-for 5/6, forced next cycle) → highest-leverage pick.
  Per the LEDGER steering note, steered to a low-covered/high-risk module: sync/activity-tracker.ts (71% func / 57% line — the auto-sync
  inactivity logic; the C195 ratchet covered cleanupInactiveUsers' ageout but two SAFETY branches stayed unpinned). +2 guards: (1)
  cleanupInactiveUsers must NOT evict a STALE-but-syncInProgress user (line 129's `!activity.syncInProgress` AND) — evicting mid-sync would
  clear its timer + drop tracking with the backup still running (orphaned state, flag never reset); the test flips the in-memory flag, proves
  the stale syncing user SURVIVES, then clears it + proves the same stale user THEN ages out (the guard is exactly the flag, not a blanket
  exemption). (2) hasChangesSinceLastSync FAILS OPEN — a throwing syncStateRepository returns `true` (back up, don't silently skip), the
  conservative NORTH_STAR #1 choice; the test stubs the repo to reject + asserts true, so a refactor can't flip it fail-closed (a transient DB
  hiccup silently dropping an expected auto-backup). Both pin real branch behavior (non-vacuous: removing the syncInProgress AND → RED; a
  fail-closed catch → RED). green→green: backend validate:local EXIT 0 — 1424 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean, build
  bundled. Guard-only (no source touched) → no UI. cov: be 86.07%+ (carry; activity-tracker safety branches now covered) / fe 81.76% (carry).
- **C308 (bug): settings store cleared a stale `error` on only 2 of 9 async ops → a succeeded retry kept showing a phantom error (#95)** —
  BALANCE: bug at budget (last 305, starved-for 3 = 3, tightest budget per the rule; infra at 5 but bug's limit is the hard one) → pick.
  Bug vein dormant → fresh-surface FE scout. CERTIFIED CLEAN: api-client (envelope-unwrap + ApiError shaping sound), api-transformer (#66
  charge↔volume routing symmetric, null-clear-on-edit guard), formatters (hardcoded en-US is design-consistent — no locale setting exists,
  so it's not a bug). THE FINDING (stores/settings.svelte.ts): load()/update() reset `error = null` on entry, but the OTHER SEVEN async ops
  (downloadBackup/uploadBackup/executeSync/listBackupsFromProvider/listAllBackups/restoreFromProvider/loadRestoreProviders) did NOT — so a
  failure from one left a stale error string on the store that a LATER SUCCEEDING op never cleared. Masked TODAY in the one UI consumer
  (settings/+page.svelte gates loadError on `&& !settings` = initial-load only), but a latent footgun: any future component rendering
  settingsStore.error ungated would show a phantom error after a succeeded retry. FIX: add `error = null` on entry to all seven (symmetry
  with load/update). GUARD: new settings-error-clearing.test.ts (+3, the store's FIRST test) — a failed load() then a SUCCEEDING
  loadRestoreProviders()/listAllBackups() clears the stale error; + a failing op still SETS its error (the clear-on-entry doesn't swallow
  real errors). NON-VACUOUS, PROVEN: reverting one method's clear → that test RED ("a succeeding op must clear the stale error"). FE store
  logic only — error is computed state, no markup moved → no screenshot. green→green: frontend validate:local EXIT 0 — type-check 0, build,
  613 pass (+3). cov: be 86.07% (carry) / fe 81.76%+ (carry; settings store now has coverage).
- **C309 (infra): CLAUDE.md docs-accuracy refresh — record #93/#95 closed + #94 in pending-Angelo + suite ~1424 BE / ~613 FE** — BALANCE:
  both arch (5=5) + infra (6=6) at budget; infra MOST-starved (6 > 5) → forced. The C253/C279/C292/C298 docs-accuracy cadence: the
  CLAUDE.md closed-bug list ended at #92/C297 (missing #93 C300 + #95 C308; #94 correctly absent there — it's escalated, not closed), the
  pending-Angelo block ended at #88 (missing #94, escalated C301), and the suites drifted (BE ~1421→~1424 via C302/C307, FE ~610→~613 via
  C308). FIXED (CLAUDE.md only): (1) appended #93 (merge-restore raw-PK → clean conflict + the C302 symmetry guard) + #95 (settings stale-
  error clearing) to the closed-bug list + bumped the arc range C155–C297 → C155–C308; (2) added #94 (fleet-wide fuel-stats mixed-unit
  pooling) to the pending-Angelo block beside #88; (3) suite size ~1421→~1424 BE / ~610→~613 FE. DOCS-ONLY — verified `git status` =
  CLAUDE.md alone (the ?? items are the by-design untracked e2e/tooling scaffold); no source/test/build touched (the C308 gate is the last
  code state). Keeps the next cycle's closed-bug + pending-Angelo + suite-floor refs accurate. cov: be 86.07% (carry) / fe 81.76% (carry).
- **C310 (arch): converge 4 inline pagination-clamp sites onto the existing (zero-caller) `clampPagination` helper** — BALANCE: arch over
  budget (last 304, starved-for 6 > 5; it had waited since C304) → forced. Arch reliably-dry — rule-7 inline scout. Rejected the FE
  query-building dedup (analytics buildQuery skips null; reminder/expense-api use bespoke per-field truthiness that deliberately skips 0/''
  — converging would change falsy-value behavior, churn trap rule 5/2). THE FINDING: the `limit = Math.min(query.limit ??
  defaultPageSize, maxPageSize); offset = query.offset ?? 0` block was hand-repeated at 4 sites (odometer/routes ×2, expenses/routes ×1,
  expenses/repository.findPaginated ×1) — while utils/pagination.ts ALREADY exports `clampPagination` (written beside buildPaginatedResponse)
  with ZERO callers. The helper is also the MORE CORRECT version: it floors limit at minPageSize + clamps offset ≥0, which the inline `?? 0`
  did NOT (a negative offset could slip through if a schema ever loosened). BEHAVIOR-PRESERVING verified (rule 2): every site's Zod schema
  pre-bounds limit `[1,100]`/positive + offset `≥0`, and minPageSize=1, so the helper's clamps are no-ops on the validated inputs — identical
  observable output today, defensive if a schema loosens tomorrow. PAYOFF (rule 5): 4 inline copies → 1 canonical helper that finally has its
  intended callers; dropped a now-dead `CONFIG` import from expenses/repository.ts (tsc-confirmed). BEHAVIOR-PRESERVING + test-anchored both
  ways (rule 3): 221 odometer+expenses+pagination tests pass UNCHANGED. green→green: backend validate:local EXIT 0 — 1424 pass (unchanged —
  pure refactor) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Backend-only, no UI. cov: be 86.07% (carry) / fe 81.76% (carry).
- **C311 (deep-review): expenses split create/update/delete + group-integrity CERTIFIED CLEAN; pinned the split-is-cost-only contract** —
  BALANCE: deep-review at budget (last 306, starved-for 5 = budget, most-starved; bug also at 3 but deep-review waited longer) → forced.
  Audited the split money/integrity surface firsthand. CERTIFIED CLEAN: (1) updateSplitExpense — absolute total DERIVED from the legs (the
  Property-3 fix: never trusts a stale groupTotal on an absolute edit), userId-scoped delete matching the read, photo migration to
  newSiblings[0] (reasonable — re-split has no 1:1 vehicle mapping); (2) deleteSplitExpense — userId-scoped, photo_refs auto-cascade via the
  FK onDelete:'cascade', and the ROUTE layer cleans provider files + refs BEFORE the row delete (deletePhotosForEntities, documented at
  routes.ts:276-282 — provider cleanup is at the right layer, not a gap); (3) createSiblings — cents-based remainder-to-last (C84), and a
  split is COST-ONLY by design: the create-split schema has NO volume/mileage/fuelType/missedFillup input path (splitting a SHARED cost
  across vehicles can't attribute a physical volume/odometer per leg), so a category:'fuel' split is a pure cost row. THE worthwhile guard:
  that cost-only contract was UNPINNED — a future change stamping a volume on split siblings would silently pollute MPG attribution + the
  fuel-stats fillup count. +1 design property (Property 4, split-service.property.test.ts): every persisted sibling has null
  volume/mileage/fuelType + missedFillup=false ACROSS ALL categories (incl. 'fuel' from the arb). NO defect, no source change. green→green:
  backend validate:local EXIT 0 — 1425 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.07%+ (carry) / fe
  81.76% (carry).
- **C312 (bug → dormant-vein clean scout + money-correctness guard): four surfaces certified clean; pinned the term-cost-UPDATE premium
  replacement** — BALANCE: bug over budget (last 308, starved-for 4 > 3, most-starved actionable) → forced. Bug vein dormant → fresh-surface
  scout. CERTIFIED CLEAN: insurance claims-repository (policy-scoped + defense-in-depth claimId+policyId, null-clear semantics; claim-delete
  photo cleanup at the route via deleteAllPhotosForEntity), insurance hooks createTermExpenses/updateTermExpenses (best-effort by design —
  derived projection, not source-of-truth), deleteBySource (catches ALL split siblings via sourceType/sourceId, photo_refs cascade), analytics
  buildFinancingTimeline (spread-safe Math.max + 0 floor, 24-cap, positive-payment filter). NO defect. THE worthwhile guard: a costed term
  auto-materializes a split premium expense (sourceType:'insurance_term'); on a term UPDATE, updateTermExpenses must DELETE the stale
  auto-expenses + RE-CREATE at the new cost — but the existing tests (terms-http clear-field + #84; policy-delete-cascade create+delete) NEVER
  pinned the update-REPLACES path, so a regression leaving stale/missing premium siblings would silently drift the premium from its term
  (NORTH_STAR #2). +1 HTTP guard (terms-http.test.ts): a 2-vehicle costed term → 2 even-split siblings summing to 1200; PUT a new totalCost
  1800 → still exactly 2 siblings summing to 1800 (no stale lingering, no missing). Drives the REAL PUT route + reads the persisted expenses;
  non-vacuous (skip the delete → count 4/total 3000; skip the recreate → count 0). green→green: backend validate:local EXIT 0 — 1426 pass
  (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.07%+ (carry) / fe 81.76% (carry).
- **C313 (guard): pin validateAndRefreshSession — the untested security-critical session-rotation core** — BALANCE: guard forced (last 307,
  starved-for 6 = budget, most-starved; feature gated). Confirmed the obvious guard targets are already covered (sourceType-rejection #62/C190;
  the backend UTC-date scan found only a cosmetic CSV-filename stamp; the SECONDS-vs-MS footgun has no live instance — Drizzle reads
  mode:'timestamp' as Dates). Also ran the standing #5 stray-untracked-test sweep: CLEAN (all untracked tests = the by-design *.meshclaw.e2e.ts
  set; branch 123 commits ahead of origin/main; BRANCH_REVIEW.md gitignored at §27). Per the LEDGER steering note, steered to the
  lowest-LINE-covered PURE-logic module: auth/utils.ts validateAndRefreshSession (100% func / 40% line — the refresh + failure branches
  untested; used by BOTH requireAuth + POST /auth/refresh, ZERO direct tests). +4 unit guards (new validate-and-refresh-session.test.ts,
  mockable Lucia, no DB): (1) invalid session → null, no refresh attempted; (2) FRESH session → returned as-is refreshed:false, NO
  create/invalidate (the no-churn invariant — else every request rotates); (3) NEAR-EXPIRY → rotates with call order ['validate','create',
  'invalidate'] (create-before-invalidate: never lose the session if create fails — the source's stated ordering); (4) createSession THROWS →
  FAILS OPEN to the existing session, old NOT invalidated (a transient hiccup must not log the user out). Real call-order assertions →
  non-vacuous (swap create/invalidate → RED; fail-closed → RED). green→green: backend validate:local EXIT 0 — 1430 pass (+4) / 1 skip / 0 fail,
  tsc 0, musl-biome clean, build bundled. Guard-only (no source) → no UI. cov: be 86.07%+ (carry; auth/utils.ts line coverage up from ~40%) /
  fe 81.76% (carry). Next #5 sweep ~C323.
- **C314 (arch): extract `fetchOrThrow` — dedup the byte-identical fetch-setup + error-parsing across api-client's request/requestFull** —
  BALANCE: nothing over budget except gated feature; arch (4/5) + infra (5/6) both forced NEXT cycle → took arch now (higher-leverage; infra's
  docs C309 + sweep C313 are fresh = manufactured). Arch reliably-dry — rule-7 inline scout. Rejected the c.json success-message responses
  (divergent per-site strings → trivial-wrapper churn, rule 5). THE FINDING (frontend/src/lib/services/api-client.ts): `request` and
  `requestFull` shared a BYTE-IDENTICAL 37-line block — URL resolve + JSON Content-Type (FormData-skip) + credentials fetch + the
  `!response.ok` backend-error-envelope parse → throw ApiError — differing ONLY in the success path (request unwraps `.data` + handles
  non-JSON/204; requestFull returns raw JSON). PAYOFF (rule 5): the error-shape parsing is load-bearing + drift-prone (an ApiError fix could
  land in one copy, be forgotten in the other). FIX: extracted `fetchOrThrow(url, options) → Promise<Response>` (setup + error-check, returns
  the ok Response); each wrapper does its OWN success-body handling. ~74 LOC → 1 shared core + 2 thin wrappers. BEHAVIOR-PRESERVING +
  test-anchored both ways (rule 3): the dedicated api-client.test.ts (envelope unwrap / no-over-unwrap / falsy-data / 204 non-JSON / method+
  header / error message+code+status+array-details) + the expense/analytics/reminder service suites (75 tests) pass UNCHANGED. green→green:
  frontend validate:local EXIT 0 — type-check 0, build, 613 pass (unchanged — pure refactor). Pure service util, no UI. cov: be 86.07%
  (carry) / fe 81.76% (carry).
- **C315 (bug): idempotency middleware would 500 on a non-JSON 2xx body — defensive parse + guard (#96)** — BALANCE: bug at budget (last
  312, starved-for 3 = budget, tightest; infra also at 6 but its docs/sweep/cov are all fresh → manufactured, so took bug). Bug vein dormant
  → scouted the full MIDDLEWARE layer (activity/change-tracker, idempotency, body-limit, rate-limit). CERTIFIED CLEAN: change-tracker
  (2xx-only mark, fire-and-forget contained), rate-limiter (window-reset, limit-before-increment, full 429 headers), body-limit
  (Content-Length 413 — the chunked-no-CL bypass is a documented header-limiter limitation, not a clean fix). THE FINDING (idempotency.ts):
  after next(), it did `await c.res.clone().json()` UNCONDITIONALLY before caching — a 2xx NON-JSON body (CSV export / binary / 204) would
  make .json() THROW, and the throw escapes the middleware → errorHandler → turns a SUCCESSFUL response into a 500. LATENT today (all 3
  idempotency-mounted sync routes return c.json), but a footgun: adding a non-JSON idempotent route would regress into a 500. FIX: gate on
  status 2xx FIRST (moved the check before the parse), then try/catch the json() — a non-JSON 2xx is left UNCACHED (the dup safely re-runs;
  a non-JSON body couldn't round-trip the replay c.json anyway). Behavior-preserving on all-JSON paths. GUARD: +1 test (a 2xx CSV body →
  200 not 500, not cached → dup re-runs); NON-VACUOUS (pre-fix the unconditional json() throws → 500). green→green: backend validate:local
  EXIT 0 — 1431 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. Backend-only, no UI. cov: be 86.07%+ (carry) / fe
  81.76% (carry).
- **C316 (infra): CLAUDE.md docs-accuracy refresh — record #96 closed + suite ~1424→~1431 BE** — BALANCE: infra OVER budget (last 309,
  starved-for 7 > 6, most-starved actionable; deep-review at 5 but infra waited longer + over) → forced. The C253/.../C309 docs-accuracy
  cadence: the closed-bug list ended at #95/C308 (missing #96 C315), and the suite drifted (BE ~1424→~1431 via C310's pagination dedup test
  delta + C311 +1 / C312 +1 / C313 +4 / C315 +1). FIXED (CLAUDE.md only): (1) appended #96 (idempotency non-JSON-2xx → 500 defensive fix) to
  the closed-bug list + bumped the arc range C155–C308 → C155–C315; (2) suite size ~1424→~1431 BE (FE unchanged ~613). DOCS-ONLY — verified
  `git status` = CLAUDE.md alone (the ?? items are the by-design untracked e2e/tooling scaffold); no source/test/build touched (the C315 gate
  is the last code state). Keeps the next cycle's closed-bug + suite-floor refs accurate. cov: be 86.07% (carry) / fe 81.76% (carry).
- **C317 (deep-review): odometer→reminder D5 mileage-trigger seam CERTIFIED CLEAN; pinned the both-axis notification coexistence** —
  BALANCE: deep-review OVER budget (last 311, starved-for 6 > 5, most-starved actionable; feature gated) → forced. Audited the
  odometer→reminder mileage-trigger seam firsthand. CERTIFIED CLEAN: findMileageTracking (filters isNotNull(nextDueOdometer)),
  mileageNotificationExists (check-then-insert) + createMileageNotification (race-safe: catches the UNIQUE-index violation → null, a
  belt-and-braces double-fire guard), and the TWO partial unique indexes — rn_reminder_due_idx (reminderId, dueDate) [mileage rows' null
  dueDate are SQLite-distinct → unconstrained] + rn_reminder_odo_idx (reminderId, dueOdometer) PARTIAL WHERE dueOdometer IS NOT NULL [time
  rows' null dueOdometer excluded] — a textbook-correct disjoint-domain design for whichever-comes-first. THE worthwhile guard: the
  cross-axis COEXISTENCE (a `both` reminder simultaneously time-overdue AND mileage-past-milestone fires TWO distinct notifications, one per
  axis, neither colliding) was UNPINNED — existing tests cover each axis in ISOLATION; a regression collapsing the two indexes into one
  (reminderId, dueDate) — or a single (reminderId) — would silently DROP the mileage notification with no failing test. +1 guard
  (trigger-mileage.test.ts): a `both` reminder past both a 35000 milestone AND a past next_due_date → exactly 1 mileage notif (dueOdometer
  35000, dueDate null) AND ≥1 time notif (dueDate set, dueOdometer null). NON-VACUOUS (a single-index regression → the dropped-axis assertion
  RED). NO defect, no source change. green→green: backend validate:local EXIT 0 — 1432 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome clean
  (test reflow auto-fixed), build bundled. cov: be 86.07%+ (carry) / fe 81.76% (carry).
- **C318 (bug → file+escalate + characterization guard): reminder orphaned (vehicle-less, still active) when its last vehicle is deleted
  (#97)** — BALANCE: bug at budget (last 315, starved-for 3 = budget, tightest; guard at 5 but bug's limit is the hard one) → pick. Bug vein
  dormant → scouted the DELETE-CASCADE surfaces. CERTIFIED CLEAN: vehicle-delete photo cascade (cleans vehicle/expense/odometer_entry — the
  complete dependent set; insurance policy/claim are user-owned not vehicle-dependent, claim.vehicleId is set-null), financing payoff/DELETE
  (soft-delete: isActive=false + clearSource, never deletes rows → no photo orphan). THE FINDING: reminder_vehicles.vehicleId is
  onDelete:'cascade', so deleting a vehicle drops its junction row — a reminder linked to ONLY that vehicle is left with ZERO vehicles: the
  row SURVIVES + stays is_active, but processReminder skips it forever with reason 'no_vehicles' (a silent never-firing orphan still shown
  active). Same family as the gated #88 (reminder orphaned on vehicle delete) but distinct mechanism (junction cascade, not the split-config
  blob). The FIX is a UX decision (deactivate / delete / surface in a needs-attention bucket / block-delete-of-sole-target) → FILED #97 +
  send_message'd Angelo, NOT self-fixed. SHIPPABLE increment (bug-cycle floor): a characterization guard (vehicle-delete-cascade.test.ts, +1)
  pinning the CURRENT behavior — junction count 0, reminder row survives is_active=1, trigger skips it no_vehicles — so the eventual fix has a
  red→green anchor + the bug can't silently worsen. green→green: backend validate:local EXIT 0 — 1433 pass (+1) / 1 skip / 0 fail, tsc 0,
  musl-biome clean, build bundled. cov: be 86.07%+ (carry) / fe 81.76% (carry).
- **C319 (guard): pin the settings store's state-management contracts (~12%-covered settings.svelte.ts)** — BALANCE: guard forced (last 313,
  starved-for 6 = budget, most-starved; arch also at 5 but guard waited longer). Per the LEDGER steering note → steered to the lowest-covered
  FE logic module: stores/settings.svelte.ts (~12% func/line per the C303 re-measure; C308 pinned only error-clearing on 2 methods). +6 guards
  (new settings-state-contract.test.ts, mocked fetch): (1) update() REPLACES settings state with the server response + returns it (the
  unitPreferences/currency render path); (2) update() RE-THROWS on failure + records the error (caller await must reject); (3) a NON-preview
  restoreFromProvider REFRESHES state via this.load() (2 fetches: restore + reload — a destructive restore changes stored settings, stale
  in-memory state would mislead, NORTH_STAR #1); (4) a PREVIEW restore does NOT reload (1 fetch, read-only); (5) reset() clears
  settings/error/loading (logout path); (6) the unitPreferences getter falls back to miles/gallons defaults when settings is null. NON-VACUOUS
  (dropping the non-preview this.load() → the 2-call + populated-settings assertions RED). green→green: frontend validate:local EXIT 0 —
  type-check 0, build, 619 pass (+6). Guard-only (no source) → no UI. cov: be 86.07% (carry) / fe 81.76%+ (carry; settings.svelte.ts up
  sharply from ~12%).
- **C320 (arch): collapse the 4× `units` field-by-field projection in analytics into a `{ ...userUnits }` spread** — BALANCE: arch OVER
  budget (last 314, starved-for 6 > 5, most-starved actionable; feature gated) → forced. Arch reliably-dry — rule-7 inline scout. Rejected
  the analytics route-handler abstraction (per-route validator/repo/shape differences → HOF-over-handlers churn, rule 5). THE FINDING
  (analytics/repository.ts): the `units: { distanceUnit: userUnits.distanceUnit, volumeUnit: userUnits.volumeUnit, chargeUnit:
  userUnits.chargeUnit }` projection was hand-repeated at 4 response sites (getSummary fleet + cross-vehicle + 2 fuel-stats surfaces).
  UnitPreferences is EXACTLY that 3-field shape, so it's a verbatim re-spread. PAYOFF (rule 5): when a 4th unit is ever added to
  UnitPreferences (e.g. a pressureUnit for tire tracking), the spread auto-propagates to all 4 response surfaces — the field-by-field literal
  would SILENTLY DROP it at all 4 (the exact clientId-drop / sheets-header data-loss class). FIX: `units: { ...userUnits }` ×4 (the
  enum-typed UnitPreferences fields satisfy the string-typed response `units` shape — tsc-confirmed). −12 LOC. BEHAVIOR-PRESERVING +
  test-anchored (rule 3): the analytics-routes-http + summary/cross-vehicle/fuel-stats property suites pass UNCHANGED (the 4 surfaces emit the
  identical units object). green→green: backend validate:local EXIT 0 — 1433 pass (unchanged — pure refactor) / 1 skip / 0 fail, tsc 0,
  musl-biome clean, build bundled. Backend-only, no UI. cov: be 86.07% (carry) / fe 81.76% (carry).
- **C321 (bug → dormant-vein clean scout + round-trip-fidelity guard): import-csv parse/commit/round-trip CERTIFIED CLEAN; pinned the
  missedFillup truthy round-trip** — BALANCE: bug at budget (last 318, starved-for 3 = budget, tightest; arch fresh at 1) → pick. Bug vein
  dormant → audited the import-csv parse → validate → dedup → atomic-commit → round-trip surface firsthand. CERTIFIED CLEAN: the per-field
  parsers (date-only local-build #23/#59, amount/mileage/volume bounds mirroring the create schema), the deterministic occurrence-keyed
  clientId (two identical rows get distinct keys → both import; re-import → same keys → all dedup), importExpenses (single transaction →
  atomic; per-row (clientId,userId) check-then-insert → idempotent; error → rollback), and the export↔import round-trip incl. the cycle-192
  formula-injection denormalization symmetry. NO defect (the concurrent-double-import 500 is a narrow edge with a SAFE rollback failure mode,
  not a clean fix). THE worthwhile guard: the missedFillup TRUTHY parse path was UNPINNED — the export writes 'true'/'false' (routes.ts:432),
  import parses /^(true|1|yes)$/i, but the round-trip test only used missedFillup=false; a regression narrowing that regex would silently
  import every missed-fillup row as false, corrupting MPG pairing (a missed fillup spans two tanks → must be excluded from efficiency,
  NORTH_STAR #2). +1 guard (import-csv.test.ts): a 'true' row → stored missed_fillup=1, a 'false' row → 0, read straight off sqlite.
  NON-VACUOUS (narrowing the regex → the 'true'→1 assertion RED). green→green: backend validate:local EXIT 0 — 1434 pass (+1) / 1 skip / 0
  fail, tsc 0, musl-biome clean (test reflow auto-fixed), build bundled. cov: be 86.07%+ (carry) / fe 81.76% (carry).
- **C322 (infra): CLAUDE.md docs-accuracy refresh — add #97 to pending-Angelo + suite ~1434 BE / ~619 FE** — BALANCE: infra at budget (last
  316, starved-for 6 = budget, most-starved; deep-review also at 5 but infra waited longer) → forced. The C253/.../C316 docs-accuracy
  cadence: #97 was escalated C318 but the CLAUDE.md pending-Angelo block ended at #94, and the suites drifted (BE ~1431→~1434 via C317 +1 /
  C318 +1 / C321 +1; FE ~613→~619 via C319 +6). FIXED (CLAUDE.md only): (1) appended #97 (reminder orphaned vehicle-less on last-vehicle
  delete — junction-cascade mechanism, same family as #88) to the pending-Angelo block beside #94; (2) suite size ~1431→~1434 BE / ~613→~619
  FE. DOCS-ONLY — verified `git status` = CLAUDE.md alone (the ?? items are the by-design untracked e2e/tooling scaffold); no source/test/
  build touched (the C321 gate is the last code state). Keeps the next cycle's pending-Angelo + suite-floor refs accurate. cov: be 86.07%
  (carry) / fe 81.76% (carry).
- **C323 (deep-review): insurance premium-allocation analytics CERTIFIED CLEAN + the overdue #5 coverage re-measure** — BALANCE: deep-review
  OVER budget (last 317, starved-for 6 > 5, most-starved actionable; feature gated) → forced. Audited buildInsuranceDetails +
  buildInsuranceVehicleEntries + accumulateMonthlyPremiums firsthand. CERTIFIED CLEAN: latest-term scoping (#25 — premium + covered-vehicles
  both from the SAME latest term, so a coverage change across terms can't mis-distribute), #50 deterministic endDate-then-startDate tiebreak,
  #8 totalCost amortization (effectiveMonthlyPremium), cycle-14 day-1-anchored monthKeysInRange. The per-vehicle premium DIVISION
  (monthlyPremium / coveredVehicleIds.length, guarded length>0) is a DISPLAY distribution — the headline totalMonthlyPremiums is computed
  INDEPENDENTLY (+= full premium once per policy, never by re-summing the per-vehicle entries), so float-division per-vehicle values (e.g.
  $33.33 ×3 of $100) carry NO internal inconsistency (this is analytics display, not stored money like the cents-based split-service). NO
  defect, no source change. PAIRED the due #5 re-measure (last full C303, 20 cycles): stray-test sweep CLEAN; **be 86.53% line / 86.21% func**
  (line +0.46 vs C303 — the C304–C321 BE arc); **fe 84.39% line / 83.97% func / 76.43% branch** (UP +2.6 line / +3.3 func vs C303 — the
  C308/C314/C319 FE arc; settings.svelte.ts ~12%→covered). BE↔FE gap ~2pts, the tightest ever. Appended the C323 reading to the LEDGER
  COVERAGE TREND header. green→green: both suites pass (BE 1434 / 1 skip via cov run; FE via cov run). DOCS/MEASUREMENT + cert only (LEDGER),
  no source/test/build touched (the C321 gate is the last code state). Next #5 sweep ~C333. cov: be 86.53% / fe 84.39%.
- **C324 (bug → file+escalate + characterization guard): sync-manager keep_local "overwrite" is a silent no-op on a real clientId collision
  (#98)** — BALANCE: bug at budget (last 321, starved-for 3 = budget, tightest; guard at 5 but bug's limit is the hard one) → pick. Bug vein
  dormant → scouted the FE sync/offline layer. sync-manager fuzzy conflict-detection is ALREADY-pinned design (C223 determineConflictType), so
  not a fresh bug there; pwa.ts clean (95% line). THE FINDING (resolveConflict keep_local / merge): it POSTs the local expense to the CREATE
  endpoint with `{ ...backendExpense, clientId, forceOverwrite: true }` — but the backend NEVER handles forceOverwrite (Zod strips unknown
  keys) and createIdempotent dedups on (userId, clientId). So on a GENUINE clientId collision (a true re-sync), the create returns the existing
  row UNCHANGED → the user's "keep my local edit" is SILENTLY NOT APPLIED, yet the FE markExpenseAsSynced + returns true (a NORTH_STAR #1
  offline-edit loss). It only "works" because the fuzzy pre-check flags DISTINCT rows whose clientId is new → a clean insert. The FE code +
  comment ("server row replaced") + the existing test (asserts forceOverwrite===true) all imply an overwrite that doesn't exist — a
  maintainer-misleading dead field over a real data-loss path. The FIX is product/arch-gated (real upsert / PUT-on-collision, or drop the
  fuzzy conflict flow + trust clientId, or surface the no-op) and TANGLED with the C223-pinned conflict-detection design → FILED #98 +
  send_message'd Angelo, NOT self-fixed. SHIPPABLE increment (bug-cycle floor): (1) a warning COMMENT on resolveConflict keep_local marking
  forceOverwrite a known backend no-op pending #98 (behavior-preserving); (2) +1 characterization test pinning the FE reality — keep_local
  POSTs to /api/v1/expenses (create) carrying the local clientId (idempotency governs the outcome), NOT a dedicated overwrite/PUT route — so
  when #98 lands, the endpoint/shape change is visible. green→green: frontend validate:local EXIT 0 — type-check 0, build, 620 pass (+1).
  Comment + test only, no logic change → no UI. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C325 (guard): pin sync-manager's retry EXPONENTIAL BACKOFF + the HARD CAP — both unpinned despite real branching** — BALANCE: guard
  forced (last 319, starved-for 6 = budget, most-starved; arch also at 5 but guard waited longer). Per the LEDGER steering note → steered to
  real branching with loose coverage: sync-manager syncExpenses' retry path. The existing tests check only the retryCount COUNTER (and the
  "max retries" test's `<= firstCount + 1` bound is too weak to pin the cap); the exponential backoff DELAY (retryDelay * 2^retries) and the
  scheduling-STOPS-at-cap behavior were never asserted. A regression to constant/linear delay (retry-storm risk) or an off-by-one cap (retry
  past maxRetries, or none) would pass the counter tests. +2 guards (sync-manager.test.ts, setTimeout spy): (1) a failed sync schedules the
  retry at EXACTLY retryDelay * 2^0 = 100ms (first failure); (2) once retries reach maxRetries, NO retry-family delay (100/200/400/800) is
  scheduled — using fake timers so the prior call's scheduled retry can't leak into the spy, and filtering OUT syncAll's unrelated 3000ms
  idle-reset timer (the subtlety that made the first cap-test attempt flake). NON-VACUOUS (an off-by-one cap → a 200ms retry scheduled → RED).
  green→green: frontend validate:local EXIT 0 — type-check 0, build, 622 pass (+2). Guard-only (no source) → no UI. cov: be 86.53% (carry) /
  fe 84.39%+ (carry; sync-manager retry branches now pinned).
- **C326 (arch): extract `insertVehicleJunctions` — dedup the reminder→vehicle junction-insert loop across create/update** — BALANCE: arch
  OVER budget (last 320, starved-for 6 > 5, most-starved actionable; feature gated) → forced. Arch reliably-dry — rule-7 inline scout.
  Rejected the reminder-route vehicleIds handling (already factored: shared validateVehicleIdsOwned + resolveMileageFields). THE FINDING
  (reminders/repository.ts): the `for (const vehicleId of vehicleIds) tx.insert(reminderVehicles).values({reminderId, vehicleId})` loop was
  byte-identical at 2 sites (createWithVehicles + updateWithVehicles' replace-junctions branch), differing only in reminder.id vs id. It also
  MIRRORS the insurance repo's established insertJunctionRows helper (C304-adjacent precedent) — so this is consistency with an existing idiom,
  not a novel abstraction. PAYOFF (rule 5): one source of truth for the junction write — a future change (batch insert / a new junction column)
  lands once. FIX: extracted private `insertVehicleJunctions(tx, reminderId, vehicleIds)` (the dbOrTx-in-a-transaction pattern), wired both
  sites. BEHAVIOR-PRESERVING + test-anchored both ways (rule 3): all 115 reminder tests (create/update/trigger/refinements) pass UNCHANGED.
  green→green: backend validate:local EXIT 0 — 1434 pass (unchanged — pure refactor) / 1 skip / 0 fail, tsc 0, musl-biome clean, build
  bundled. Backend-only, no UI. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C327 (bug → dormant-vein clean scout, certification): photos upload/serve/delete + provider sync-worker CERTIFIED CLEAN** — BALANCE: bug
  at budget (last 324, starved-for 3 = budget, tightest; infra at 5 but bug's limit is the hard one) → pick. Bug vein dormant → audited two
  NORTH_STAR #1 surfaces firsthand. CERTIFIED CLEAN: (1) photo UPLOAD (uploadPhotoForEntity) — ownership-gated, ALLOWED_MIME_TYPES allowlist +
  MAX_FILE_SIZE + category-mapping + provider-capability gate (D2a), the #34 upload-atomicity compensation (persistUploadedPhotoOrCleanup
  best-effort deletes the just-uploaded object on a DB-write failure → no orphaned bytes); (2) photo SERVE (getPhotoThumbnailForEntity) —
  ownership + entityType/entityId match (no cross-entity serve), default-provider-first w/ active-ref fallback, client-asserted mimeType served
  WITH X-Content-Type-Options:nosniff (the C133/#77 fix — the browser can't sniff/execute a mislabeled file); (3) DELETE + provider sync-worker
  — shouldSkipDueToBackoff (failed-only, syncedAt??createdAt fallback, 30*2^retryCount seconds → ms, elapsed<backoff), processSingleRef
  failure → status:'failed' + retryCount++ (the unbounded-retry self-throttles via the exponential backoff — a perma-failed ref queries ~once
  a year, not a storm; surfacing it is a #79-class product call, not a defect). COVERAGE already comprehensive: sync-worker.test.ts (backoff
  boundaries 30/60/120s, success→active, failure→failed+retryCount++ for both upload + download errors, all skip cases) + photo-serve-headers
  + ownership-uses-shared-validators. NO defect, NO unpinned invariant — adding a test here would be coverage-theater (the C306/C323
  certification precedent). DOCS-ONLY (LEDGER + BACKLOG); no source/test/build touched (the C326 gate is the last code state). cov: be 86.53%
  (carry) / fe 84.39% (carry).
- **C328 (deep-review → #94 is a CLASS, not one scalar; +1 characterization guard, ESCALATED broadened)** — BALANCE: deep-review AND infra both
  first-come-due this cycle (deep-review 328−323=5=budget; infra 328−322=6=budget); feature 158-over but every item is eyes-on/Playwright- or
  T0-sign-off-blocked (standing escalation). Picked deep-review (higher leverage — it feeds the dormant bug vein; the infra #5 sweep isn't due
  till ~C333). Fresh surface: is the just-escalated #94 (fleet fuel-stats summary pools mixed mi+km distance + blends $/mi-vs-$/km without unit
  conversion) ISOLATED, or a class? Fanned out 2 Explore agents (analytics unit-conversion siblings + calculateVehicleStats correctness).
  RESULT: (a) per-vehicle calculateVehicleStats CERTIFIED CLEAN — every ratio div-guarded (costPerMile gated on totalMileage>0, averageMpg on
  length>=2 + mpg>0&&<150 filter, averageMilesPerKwh length+volume gated), unit-by-design at the route layer, comprehensively property-tested
  (vehicle-stats.property.test.ts 100-run props + currentOdometer contract); no defect. (b) #94 is NOT one scalar — it's a CLASS spanning the
  whole fleet-SUMMARY + fuel-advanced path. VERIFIED FIRSTHAND against source (C21/C60 rule): getCrossVehicle (repository.ts:1500/1531-1532) is
  the correct contrast — it threads vehicleUnitsMap+userUnits, computes skipConversion=allVehiclesMatchUnits, and convertDistance(...)s each
  vehicle to the user's unit BEFORE pooling; buildFuelStatsFromData (called by getFuelStats AND getSummary:2072) receives NO units and its own
  comment (:1386) wrongly assumes "this summary path is single-unit so it doesn't convert". The convertDistance-per-vehicle in getCrossVehicle is
  the firsthand PROOF stored distance/volume are in each vehicle's NATIVE unit → raw pooling across a mixed fleet IS garbage. Siblings (all
  un-filed, all same no-conversion mechanism): volume.currentYear + fillupDetails (gal+L, buildFuelStatsFromData :1357-1372), buildMonthlyConsumption
  (volume+efficiency :314-352), buildSeasonalEfficiency (mi/gal+km/L :608-655), buildVehicleRadar (efficiency+distance normalizeScore :709-784),
  buildDayOfWeekPatterns (volume :787-812) — the latter four via getSummary/getFuelAdvanced → buildFuelAdvancedFromData, also units-less. ALL
  product-semantics-gated (convert-to-user-global / per-vehicle-only / require vehicleId) → NOT a clean atomic loop fix; folded into the #94
  escalation as one class. INCREMENT: pinned the cleanest unfiled sibling (volume pooling, SAME file+path as #94's distance pin) — +1
  characterization test in fuel-stats-fleet-distance-pooling.test.ts (volume.currentYear=50 raw gal pool, fillupDetails avg/min/max [20,20,5,5])
  + broadened the file docblock to record the class. Follows the established raw-sum proof shape (no divergent prefs seeded — the harness
  seedVehicle has no unit_preferences path; the point of record is the un-normalized pool). NON-VACUOUS (the assertions pin the current pooled
  values; the fix will turn them red→update). green→green: backend validate:local EXIT 0 — 1435 pass (+1) / 1 skip / 0 fail, tsc 0, musl-biome
  clean, build bundled. Backend test-only, no UI. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C329 (infra): #5 branch-hygiene sweep + BRANCH_REVIEW.md refresh** — BALANCE: infra OVER budget (last 322, starved-for 329−322=7 > budget 6)
  → FORCED most-starved pick (the queue is empty; the standing #5 cadence is the infra increment). Last full sweep C303 (theme write last C224 —
  the §-digest lapsed C224→C328 even as the per-delta status header refreshed C303). (1) STRAY-TEST CHECK (the load-bearing half — bun discovers
  tests by filesystem, so an untracked .test.ts counts locally but VANISHES on merge, silently dropping coverage): `git status` shows ZERO stray
  untracked unit/spec tests; every untracked entry is the by-design set (*.meshclaw.e2e.ts specs + snapshots, .meshclaw-tools/ harness,
  playwright.meshclaw.config.ts, mise.local.toml, the squash-merged .kiro/specs/offline-entries/ doc). (2) GREEN BASELINE: backend 1435 pass /
  1 skip / 0 fail carried from C328 (validate:local EXIT 0, unchanged — this cycle is docs-only, no source touched, the C303/C100 measurement-
  only pattern → no build gate needed). (3) BRANCH_REVIEW.md refresh (gitignored): the digest was BADLY stale — claimed 34 commits (C190–C223)
  but the branch is 139 ahead of origin/main (C190–C328, no squash since C190.5). Bumped scope 34→139, status 1309→1435 BE / 584→~622 FE +
  the C323 coverage re-measure (be 86.53/86.21, fe 84.39/83.97/76.43 — BE↔FE gap closed ~4→~2pts), appended §30 (the C224–C328 arc by category:
  ~16 shipped within-tenant bug fixes incl. the lone migration 0005/#80, 4 escalated bugs #88/#94/#97/#98, ~11 arch dedups, ~7 guard ratchets,
  ~15 deep-review certs). ALSO corrected two stale claims: the "Playwright sandbox-blocked" note (a MISDIAGNOSIS resolved 2026-06-11) + the
  "no migration" checklist line (0005 landed C233). Refreshed the Reviewer-checklist pending-Angelo set (+#43/#44, +#88/#94/#97/#98, +the lower-sev
  #45/#51/#69/#79/#85) + the Suggested-merge footer (34→139). Doc/measurement-only; only loop/LEDGER.md commits (BRANCH_REVIEW.md is gitignored).
  Next sweep ~C339; next CLAUDE.md refresh ~C332 (last C322). cov: be 86.53% (carry) / fe 84.39% (carry).
- **C330 (bug → #99: financing date projections shifted a payment/payoff/lease-end date into the WRONG month for any 29th–31st contract; +arch dedup +guard)** —
  BALANCE: bug at budget (last 327, starved-for 330−327=3 = budget, tightest "never sits") → pick. Bug vein dormant → 2-agent adversarial fan-out on the
  money-bearing surfaces that bred this session's #90/#91/#92 cluster: (a) financing-calculations.ts loan/projection math, (b) the expense split write-path.
  FINDINGS: the expense-split hits were product-semantics-gated (split-create sourceType not restricted to 'financing' like the singular path — a debatable
  design choice, not an atomic defect; the money-conservation Property 3/4 are already pinned) → NOT self-fixed. The financing-calculations hit IS a clean
  atomic sibling of #90/#91/#92: THREE sites advance months via bare `Date.setMonth(getMonth()+n)`, which rolls a day-of-month overflow into the FOLLOWING
  month (Aug 31 + 1mo → Oct 1 not Sep 30; May 31 + term → the month after the intended lease end) — VERIFIED firsthand (C21/C60): calculatePaymentDate:139/148
  (amortization-schedule + extra-payment payoff dates), calculateNextPaymentDate:202/211 (the NextPaymentCard due date), calculatePayoffDate:230 (lease end =
  start + termMonths). The CORRECT clamp already lived inline in calculatePayoffDateFromStart:572 (detect rolled day → setDate(0) to the target month's last
  day) but wasn't shared. FIX (#99, atomic + arch-clean): extracted ONE `addMonthsClamped(date, months)` helper (the single source of truth for the clamp) +
  routed all three sites through it. KEY subtlety on the ITERATIVE next-payment loop: a step-by-step clamp would let the day "stick" lower after the first short
  month (a 31st payment passing through Feb → 28th forever, losing the contractual day) → anchored that path on baseDate and re-derive (base + N months) each step,
  so only a genuinely-short TARGET month clamps. GUARD: rewrote next-payment-date.test.ts's month-end block (it had CHARACTERIZED the buggy rollover `d===31||d<=3`
  → now asserts the clamp 28..31, never rolled forward) + new financing-month-overflow-clamp.test.ts (+5) pinning the lease-end clamp (the C330 site with ZERO
  prior coverage: May31+36mo→May31'27, +1mo→Jun30 not Jul1, Jan31+1mo→Feb29 leap, Aug31+13mo→Sep30'25 year-rollover, mid-month unaffected). NON-VACUOUS (revert a
  site to bare setMonth → 31st-start dates land a month late → RED). green→green: frontend validate:local EXIT 0 — 627 pass (+5 net) / 0 fail, tsc 0, build OK.
  Pure-util fix (the calc fns are unit-pure; the .svelte consumers — NextPaymentCard, AmortizationSchedule, FinanceTab payoff/lease — render the corrected dates,
  visual is eyes-on but the date VALUE is now pinned). cov: be 86.53% (carry) / fe 84.39%+ (carry, FE suite +5).
- **C331 (guard): pin getSyncStatusInfo, the user-facing sync-indicator precedence cascade (zero-coverage pure module)** — BALANCE: guard AND arch
  both at budget this cycle (guard 331−325=6=budget; arch 331−326=5=budget); guard MORE starved (6 vs 5) → pick. Guard veins are thin per the cadence note
  (FE pure/service layers essentially all covered, BE route/util low spots worked through), so scanned for a genuinely-untested logic-bearing module: a grep
  of every non-type/non-UI-reexport src/lib/*.ts against the test suite surfaced sync/sync-status.ts (58 lines) at ZERO test references. getSyncStatusInfo
  is the centralized derivation behind BOTH SyncStatusIndicator + SyncStatusInline (the persistent sync badge); its branch ORDER is load-bearing — a
  PRIORITY CASCADE (offline > conflicts > syncing > error > success > pending > up-to-date), not independent flags — so a refactor reordering the `if`s
  would silently show the WRONG status (e.g. "Synced" while offline, or hide an unresolved conflict behind the "Syncing…" spinner). +14 guards
  (sync-status.test.ts, the new sync/__tests__/ dir): all 8 branches' {color, icon, text} in isolation (+ the singular/plural conflict copy via the `> 1`
  guard) + 6 PRECEDENCE cases pinning the cross-branch ordering a naive per-branch test misses (offline beats all; conflicts beat syncing/success; syncing/
  error/success each beat pending). NON-VACUOUS (reorder any pair, or drop the `>1` plural guard → RED). Pure-logic, host-independent (asserts the exact
  Lucide icon identity + token color). green→green: frontend validate:local EXIT 0 — 641 pass (+14) / 0 fail, tsc 0, build OK. cov: be 86.53% (carry) /
  fe 84.39%+ (carry, sync-status.ts 0%→covered).
- **C332 (arch): collapse computeBalance onto computeBalances — ONE source of truth for the financing-payment money query** — BALANCE: arch OVER budget
  (last 326, starved-for 332−326=6 > budget 5) → FORCED most-starved pick. The seeded arch queue is a done-trail, so ran the rule-7 fan-out (2 Explore
  agents, BE + FE duplication). FE top pick (a createStateAccessor factory over sync-state.svelte.ts's 8 $state accessors) REJECTED — rewiring Svelte 5
  $state plumbing with NO test net is exactly the silent-reactivity-regression / churn the arch rules 3/5 warn against (a broken accessor breaks the sync
  UI invisibly), + the conditional `update` method breaks clean typing. Also REJECTED converging calculatePayoffDateFromStart onto the C330 addMonthsClamped
  (it constructs at local-midnight via `new Date(y,m,d)`, dropping time-of-day — converging risks the C103/C77 tz-shift its own test docstring warns about;
  rule 2). PICKED the BE financing-balance dedup: computeBalance + computeBalances both ran the financing-payment money query (originalAmount lookup +
  `WHERE sourceType='financing' AND sourceId=… COALESCE(SUM(expenseAmount),0)` clamped to ≥0) — a RAW-`sql` copy vs a typed-`and/eq/inArray` copy, the
  drift-prone money duplication that silently miscounts a balance (+ TCO downstream) if one copy diverges. FIX: computeBalance(id) now delegates →
  `(await computeBalances([id])).get(id) ?? 0` (the `?? 0` mirrors the prior explicit `return 0` for a missing record; computeBalances omits unmatched ids).
  −24 LOC, one money query. Behavior-preserving + INDEPENDENTLY ANCHORED: financing-balance.property.test.ts already has a `computeBalances (batch)
  equivalence` block asserting batch == per-record, PLUS Property 5/6 drive computeBalance directly (happy/non-financing/clamp/no-payments/non-existent/
  payoff-boundary) — all pass UNCHANGED. The only deltas are an error-message string + one log line (no test asserts either; grep-confirmed) and query count
  is 2→2 (no N+1 regression). green→green: backend validate:local EXIT 0 — 1435 pass (unchanged) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled.
  cov: be 86.53% (carry) / fe 84.39% (carry).
- **C333 (deep-review → guard): TCO money-aggregation CERTIFIED CLEAN; pinned the unguarded YEAR-SCOPED #28/#27 accounting invariant (+3)** —
  BALANCE: deep-review AND bug both due (deep-review 333−328=5=budget; bug 333−330=3=budget); deep-review MORE starved (5 vs 3) → pick (bug forces
  next cycle, nothing sits). 2-agent fan-out: (A) TCO total/breakdown/trend correctness, (B) reminder-materialization idempotency + CSV value round-trip.
  RESULTS: (B) CERTIFIED CLEAN firsthand — reminder re-trigger is CAS-guarded on nextDueDate (no double-materialize), the BACKEND reminder advance uses
  clampToAnchorDay (NO C330-class setMonth-overflow — the bug was FE-only), CSV round-trip handles thousands-separators/booleans/nested-JSON/null
  (C209/C321 + reminder-split-config-roundtrip pin it); the lone hit was #88, already filed. (A) the agent flagged a "year-scoped + unpriced + financed
  double-count BUG" — VERIFIED FIRSTHAND (C21/C60) it is NOT a bug: computeTCOTotal's doc comment (repository.ts:1081) DOCUMENTS the behavior as the
  Angelo-approved #28/#27 design — purchasePrice is an all-time-only acquisition cost (EXCLUDED from any year window, whose expenses are already
  date-filtered), and because the price is NOT counted in a year window the financing-payment rows for that year ARE kept (they're the window's cost signal,
  not a double-count — the acquisition isn't in the window). The agent's "$1500 is loan principal not new spend" is the OPPOSITE of the decided rationale →
  a product opinion, not a defect. So TCO math CERTIFIED CLEAN. THE genuine finding → guard: every getVehicleTCO call in the suite OMITTED the optional
  `year` arg, so the entire year-scoped accounting path (incl. this load-bearing #28/#27 invariant) was UNPINNED — a future "fix" like the agent's would
  silently break it (the C256/C312/C317 deep-review→guard pattern). +3 guards in per-vehicle.property.test.ts (#28/#27 year-scoped describe): priced+financed
  year-window (price EXCLUDED, in-year financing KEPT, out-of-year payment date-filtered out); unpriced+financed year-window (financing kept — the exact
  case mis-flagged); + the year-window breakdown contract (totalCost = windowed buckets, purchasePrice REPORTED but NOT summed in — the #28 divergence).
  Caught + corrected my own initial mis-assumption that the response zeroes purchasePrice in a year window (it REPORTS the stored price; only totalCost
  excludes it) before settling the assertions. NON-VACUOUS (gate the financing on `year` like the agent proposed → the unpriced+financed case drops to 0 →
  RED). green→green: backend validate:local EXIT 0 — 1438 pass (+3) / 1 skip / 0 fail, tsc 0, musl-biome clean (one format reflow auto-fixed via
  check:musl:fix), build bundled. cov: be 86.53%+ (carry, year-scoped TCO path 0→covered) / fe 84.39% (carry).
- **C334 (bug → dormant-vein clean scout: insurance + units/import CERTIFIED CLEAN; +2 per-field-conversion guard)** — BALANCE: bug OVER budget
  (last 330, starved-for 334−330=4 > budget 3, tightest) → FORCED. Vein dormant → 2-agent adversarial fan-out on surfaces NOT recently audited:
  (A) insurance write path (routes/repo/validation/hooks/claims), (B) unit-conversion + the import-mapping pre-pass. RESULTS: (A) NO new defect —
  every agent "finding" was a FALSE ALARM debunked on second read (term-coverage-reduction replaces the WHOLE split group cleanly; empty-coverage
  rejected by Zod .min(1); claim cross-policy termId already guarded C247; premium-expense cross-tenant gated by validateVehicleOwnership in addTerm)
  or PRODUCT-GATED (claim payoutAmount > coverageLimit — real claims legitimately exceed coverage via deductible/depreciation, a product call not a
  defect). (B) unit conversions mathematically sound + property-tested (round-trip invertible, mpg↔L/100km inverse correct, no div-by-zero); import-mapping
  pre-pass clean (date echo-check guards rollover, non-finite defers to buildImportPlan, unmapped categories surfaced). VERIFIED FIRSTHAND (C21/C60) the
  one non-product-gated candidate — applyMapping's `target = {}` default: when a field's target unit is absent mapMileage/mapVolume pass the value through
  UNCONVERTED. NOT a bug: the sole caller resolveTargetUnits returns {} or BOTH-units-set (never partial), and {} = the documented "no target vehicle → don't
  guess" pass-through (pinned line 65). So NO atomic defect → certification (the C306/C327 precedent). THE one unpinned by-design invariant worth a
  non-theater guard: mapMileage/mapVolume guard conversion on each field's OWN `from && to` INDEPENDENTLY — so a future change handing applyMapping a
  PARTIAL target (one unit resolved, the other not) would convert ONE axis + silently pass the other through in the SAME row (mixed converted/unconverted —
  NORTH_STAR #2). +2 guards (import-mapping.test.ts): partial target {distanceUnit only} → distance converts (km→mi 100), volume passes through verbatim
  (37.854, NOT →gal); the mirror {volumeUnit only}. NON-VACUOUS (coupling the two guards, or dropping one, flips a field). Caught my own Math.round(160.9344)=161
  slip mid-write. green→green: backend validate:local EXIT 0 — 1440 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.53%
  (carry) / fe 84.39% (carry).
- **C335 (infra): CLAUDE.md orientation refresh (post-C322 drift, C323–C334)** — BALANCE: infra at budget (last 329, starved-for 335−329=6 = budget,
  most-starved) → pick. The #5 branch sweep was just done C329; the due infra increment is the CLAUDE.md refresh (last C322, ~13 cycles drift). Read the
  drift-prone sections against source/LEDGER (no churn — the C5/C47/C72 discipline). FOUND the doc largely current (the closed-bug list is kept current
  inline each bug cycle — accurate through #99/C330; the pending-Angelo block accurate incl. #94-broadened-C328/#97/#88; coverage re-measured C323 still
  recent → carried, NOT re-claimed). The one material drift: suite size cited **~1434 BE / ~619 FE** → corrected to **~1440 BE / ~641 FE** (VERIFIED the FE
  count by running vitest — 641, not a guess; my first edit said 643 from memory, fixed to the measured 641) + named the C322–C334 additions (the #94-volume
  pin, #99 month-overflow guards, getSyncStatusInfo, year-scoped TCO pins, per-field import-conversion guards). Docs-only; no source/test/build touched (the
  C309/C316/C322 refresh pattern → no build gate). Next CLAUDE.md refresh ~C348; next #5 sweep ~C339. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C336 (guard): pin themeStore, the user-facing light/dark/system theme controller (zero-coverage store)** — BALANCE: nothing over budget (guard 5/6
  closest to starving, hasn't run since C331) → highest-leverage guard. Scanned for a genuinely-untested logic module (the C331 method): grep'd every BE
  pure-logic util/helper against the suite — ALL covered (csv-safety/drive-file-utils/reminder-cost/computeNextDueDate directly tested; data-migration is a
  no-op stub, checkpoint a CLI script — non-targets). Confirmed the cadence note: BE pure-logic veins are genuinely worked through, manufacturing a guard
  there = theater. Pivoted to FE: the 3 stores (app/offline/theme.svelte.ts) have NO direct test. Picked theme.svelte.ts (68 lines) — the single source of
  truth for dark mode (setPreference persists to localStorage, resolves 'system' against prefers-color-scheme, toggles the <html> `dark` class, swaps the
  PWA theme-color meta); a regression silently breaks dark mode for every user. +5 guards (theme-store.test.ts, new stores/__tests__/): explicit dark/light
  (class + #1a1a2e/#2563eb theme-color + localStorage persist + current); 'system' resolves against matchMedia (OS=dark→dark, OS=light→light, stored pref
  stays 'system' not the frozen resolved value); + the SAME 'system' pref flips with the OS (not frozen at set-time). Uses test-setup.ts's browser=true +
  localStorage + matchMedia mocks (matchMedia overridden per-case for the system branch). NON-VACUOUS (drop the classList toggle / meta swap / persistence,
  or invert the system resolution → RED). green→green: frontend validate:local EXIT 0 — 646 pass (+5) / 0 fail, tsc 0, build OK. cov: be 86.53% (carry) /
  fe 84.39%+ (carry, theme.svelte.ts 0%→covered).
- **C337 (arch): extract buildQueryString — collapse the 2 service-layer query-string builders onto one shared helper** — BALANCE: arch at budget
  (last 332, starved-for 337−332=5 = budget, most-starved) → pick. Rule-7 fan-out (2 Explore agents, BE + FE). BE candidate (recheckMileageReminders
  wrapper, 4 sites) was thin/borderline-churn (wraps a one-line service call + a guard that legitimately differs expense-vs-odometer). FE pick was cleaner:
  analytics-api `buildQuery` is ALREADY the generic form (URLSearchParams + `value != null` filter + `qs ? '?'+qs : ''`), and reminder-api
  `buildReminderQuery` repeats that byte-identical convention by hand. Extracted `buildQueryString` to a new services/api-utils.ts (single source of truth)
  + routed both through it. KEY behavior-preservation subtlety VERIFIED firsthand (C21/C60): buildReminderQuery used TRUTHY checks for vehicleId/type (empty
  string DROPPED) but `isActive !== undefined` (false SURVIVES), while the generic `!= null` filter would KEEP an empty-string vehicleId — so mapped
  `vehicleId: filters.vehicleId || undefined` (+ type) to preserve the exact truthy-drop, and passed `isActive` through as-is so false still serializes.
  Test-anchored both ways (rule 3): reminder-api.test.ts pins the load-bearing edges (`isActive=false MUST survive`, empty/no-filter → '', vehicleId+type
  appended) — all GREEN before AND after. −9 LOC net. green→green: frontend validate:local EXIT 0 — 646 pass (unchanged) / 0 fail, tsc 0, build OK.
  cov: be 86.53% (carry) / fe 84.39% (carry).
- **C338 (bug → vehicle write-path CERTIFIED CLEAN; settings lost-update race FILED+ESCALATED #100, architecture-gated)** — BALANCE: bug OVER budget
  (last 334, starved-for 338−334=4 > budget 3, tightest) → FORCED. Vein dormant → 2-agent fan-out on surfaces not recently audited: (A) vehicle write-path
  (routes/repo/photo-routes), (B) settings + sync-state. RESULTS: (A) NO defect — clear-field null-vs-undefined correct (.nullish()), cross-tenant scoped,
  plate-uniqueness per-tenant (#80 follow-through), cover-photo entityId-gated; the one agent flag (photo ops check entityId not photo.userId) is a
  defense-in-depth gap MASKED by the entityId/entityType check (guarded, not exploitable — cuid2 ids), and unitPreferences-retroactivity is the filed #85
  class. (B) found a REAL but ARCHITECTURE-GATED defect → #100: userPreferences writes are an un-serialized read-modify-write — PUT /settings
  (routes.ts:255-292) does getOrCreate → JS-spread merge (mergeUnit/Storage/BackupConfig) → update with NO transaction/lock/version, and the SAME pattern
  repeats at 5+ sites (provider create :340/:524, cleanupStorageConfig:419, cleanupBackupConfig:448). VERIFIED firsthand (C21/C60) it's genuinely
  un-serialized → a lost-update race clobbers a sibling config under concurrent edits (a provider-DELETE racing a settings PUT; two settings PUTs naming
  different providers). The #82/C237 per-provider merge fixed the within-request wholesale-wipe but can't help across two interleaved requests. Severity
  tempered by deployment (self-host single-user/household PWA → narrow same-user concurrent window) but a genuine NORTH_STAR #1 silent-loss class. NOT a
  clean one-cycle fix (optimistic-version+migration / transactional-merge vs the C151 async-tx footgun [the merge awaits validate*Config DB reads] /
  per-user serial queue — all bigger-than-atomic + cross-cutting) → FILED #100 + ESCALATED to Angelo (send_message) + recorded in BACKLOG/CLAUDE.md. NO
  characterization test — a timing-dependent concurrency test would be FLAKY (worse than none); the #82 backup-config-merge test already pins the
  sequential within-request merge. Docs-only cycle (file+escalate+cert, the C306/C327 escalation-gated precedent); no source/test/build touched → no build
  gate (the C337 gate is the last code state). cov: be 86.53% (carry) / fe 84.39% (carry).
- **C339 (deep-review → bug #101: offline missedFillup silently dropped on sync; backup-validation gaps filed)** — BALANCE: deep-review OVER budget
  (last 333, starved-for 339−333=6 > budget 5) → FORCED. 2-agent fan-out on the NORTH_STAR #1 crown jewels not recently audited: (A) backup/restore
  round-trip, (B) offline-sync write path. (B) surfaced a CLEAN ATOMIC live defect → #101 (the C204/C209 deep-review→bug pattern): the offline outbox drops
  `missedFillup` on sync. VERIFIED FIRSTHAND (C21/C60): OfflineExpense had no missedFillup field, offlineExpenseToBackend didn't map it, and BOTH
  ExpenseForm addOfflineExpense call sites (:579/:621) omitted it — while the form DOES collect it (formData.missedFillup, :1230) and the ONLINE path sends
  it (:517). So a fuel fill-up logged OFFLINE with "missed previous fill-up" checked loses the flag on sync → calculateAverageMpg pairs it as a normal
  consecutive fill-up across the unlogged gap → inflated/garbage MPG (NORTH_STAR #1 silent-loss + #2, the exact #66 offline-field-dropout family). FIX
  (clean, 4 edits): added missedFillup? to OfflineExpense (+doc), mapped it in offlineExpenseToBackend (the C205 single-source boundary), carried it at
  both form sites (the 2nd expenseData needed the field too). GUARD: +1 round-trip test in offline-storage.test.ts pinning true AND false survive (the #66
  test's sibling). NON-VACUOUS (drop the map → undefined → backend default false → the true case RED). (A) backup/restore: the agent flagged
  validateBackupData doesn't cross-check expense sourceType:'financing' sourceId or reminder expenseSplitConfig vehicleIds against the in-backup sets —
  but these are DEFENSE-IN-DEPTH on the user's OWN self-created backup (no FK on sourceId by design; a tampered backup is the only trigger), LOWER priority
  than a live-flow bug; FILED as a note in BACKLOG (not escalated — it's a hardening nicety, the C246 referential-integrity already constrains the
  FK-children). Insert-order + table-coverage + JSON/date/bool round-trip all RE-CONFIRMED clean. green→green: frontend validate:local EXIT 0 — 647 pass
  (+1 net) / 0 fail, tsc 0, build OK. Pure FE; the offline→sync→DB path now carries the flag (the .svelte form render unchanged). cov: be 86.53% (carry) /
  fe 84.39%+ (carry).
- **C340 (infra): #5 branch-hygiene sweep + BRANCH_REVIEW.md refresh (branch 150 commits, last full sweep C329)** — BALANCE: nothing over budget (infra
  5/6 closest to starving + the #5 sweep due, last full C329) → highest-leverage infra. (1) STRAY-TEST CHECK (the load-bearing half): `git status` shows
  ZERO stray untracked unit/spec .test.ts — every untracked entry is the by-design set (*.meshclaw.e2e.ts + snapshots, .meshclaw-tools/,
  playwright.meshclaw.config.ts, mise.local.toml, the squash-merged offline-entries spec). (2) GREEN BASELINE: 1440 BE / 647 FE carried from C338/C339
  (docs-only cycle, no source touched → the C303/C329 measurement-only pattern, no build gate). (3) BRANCH_REVIEW.md refresh (gitignored): scope 139→150
  (C190–C328 → C190–C339), status 1435→1440 BE / ~622→647 FE, appended §31 (the C329–C339 delta: #99 + #101 fixed, #100 filed+escalated, the C331/C333/C336
  guards, the C332/C337 arch dedups, C334/C338 clean-certs), refreshed the pending-Angelo set (+#100) + the Suggested-merge footer (139→150). Coverage
  carried from the C323 re-measure (no test-adding arc large enough to warrant a re-measure; C330–C339 was coverage-positive). Doc/measurement-only; only
  loop/LEDGER.md + loop/BACKLOG.md commit. Next sweep ~C350; next CLAUDE.md refresh ~C348. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C341 (bug → dormant-vein clean scout: analytics-charts + auth CERTIFIED CLEAN; +2 buildMonthlyConsumption invariant guard)** — BALANCE: bug at budget
  (last 338, starved-for 341−338=3 = budget, tightest "never sits") → pick. Vein dormant → 2-agent fan-out on surfaces not recently audited:
  (A) analytics chart builders (last deep C67), (B) auth/session/OAuth (last C225). RESULTS — every agent "REAL DEFECT" debunked firsthand (C21/C60):
  (A.1) buildMonthlyConsumption "NaN-NaN month key on null date" — NOT reachable: expenses.date is .notNull() (schema:220), the volume loop guards `if (!d)
  continue`, AND the efficiency loop's `if (entry)` drops any phantom key (the agent missed that guard). (A.2) buildGasPriceHistory "String(epochMs)" — dead
  branch: date is mode:'timestamp' so Drizzle returns a Date → the `instanceof Date` arm always wins for real rows. (A.3) unsorted-input → 0 efficiency = the
  documented caller-sorts convention (#75 class; repository always sortByVehicleThenDate). (A.4) computePreviousYearComparison field-name = a naming nit, not
  a correctness bug. (B) ALL auth findings are SECURITY-POLICY/PRODUCT calls (email_exists / account_conflict enumeration-vs-UX tradeoff; Google email_verified
  enforcement = an identity-policy decision — ARCC+Angelo territory, not a clean loop fix) or BEHAVIOR-IDENTICAL hygiene (requireAuth hardcoded maxAge ==
  CONFIG.auth.cookieMaxAge today). NO reachable atomic defect → certification (the C306/C327/C334 precedent). THE one genuinely-unpinned reachable invariant
  worth a non-theater guard: buildMonthlyConsumption's `if (entry)` (the efficiency loop only AUGMENTS volume-created months, never CREATES one) was unpinned —
  a refactor swapping it for an upsert/`?? default` would silently emit phantom efficiency-but-no-volume months. +2 guards (analytics-charts-month-window.test.ts):
  a cross-month pair → both volume months exist + efficiency lands on the LATER fill-up's month (Jan eff 0, Feb 30mpg); emitted month set == distinct
  volume-row months (same-month pair → ONE month, volume pooled). NON-VACUOUS (drop `if (entry)` → phantom NaN-NaN month → RED). green→green: backend
  validate:local EXIT 0 — 1442 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C342 (guard): pin appStore — the global vehicle-list + notification (toast) store (zero-coverage store)** — BALANCE: guard AND arch both at budget
  (guard 342−336=6=budget; arch 342−337=5=budget); guard MORE starved → pick. Continuing the C331/C336 zero-coverage-store sweep: of the 3 untested FE stores,
  offline.svelte.ts is trivial get/set accessors (pinning bare setters = theater, the C332-rejected createStateAccessor class), so picked app.svelte.ts (89
  lines) — the app-wide vehicle list (every vehicle CRUD surface reads it) + the toast notification system. Load-bearing logic: updateVehicle's ID-MATCH map
  (only the matched vehicle changes, unknown id = no-op), removeVehicle's ID filter, addNotification's id+timestamp+default-5000-duration, and the FOUR show*
  helpers' DISTINCT default toast lifetimes (success 5000 / error 8000 / warning 6000 / info 5000 — the user-facing dismiss timings; a flattening regression
  makes errors vanish too fast). +11 guards (app-store.test.ts, new stores/__tests__/): vehicle CRUD incl. the update-only-matches + unknown-id-no-op +
  filter-remove; notification id/timestamp/default + explicit-override + remove-by-id + clear; the 4 distinct durations; loading + reset. NON-VACUOUS (flip an
  update/remove predicate or a default duration → RED). svelte-check strict caught noUncheckedIndexedAccess + index-signature bracket-access (fixed with `!`
  + `['key']`). green→green: frontend validate:local EXIT 0 — 658 pass (+11) / 0 fail, tsc 0 errors, build OK. cov: be 86.53% (carry) / fe 84.39%+ (carry,
  app.svelte.ts 0%→covered).
- **C343 (arch): extract deactivateFinancing — ONE source of truth for the financing deactivation write + side-effect** — BALANCE: arch OVER budget
  (last 337, starved-for 343−337=6 > budget 5) → FORCED. Rule-7 fan-out (2 Explore agents). FE pick (the settings-store try/catch wrapper) REJECTED — it's
  the same skeleton a prior fan-out PERMANENTLY rejected (bodies differ: some assign state, some don't; closure-over-error churn). BE pick was clean: the
  payoff (PUT /:id/payoff) + delete (DELETE /:id) routes ran a BYTE-IDENTICAL `financingRepository.update({isActive:false, endDate:new Date()})` +
  `onFinancingDeactivated(financingId, user.id)` pair (routes.ts:221-226 / :241-246), differing only in the response message + whether the updated row is
  echoed. A money/lifecycle drift risk: a future change to what deactivation entails (extra cleanup, the #67/C206 re-finance reset) would have to land twice.
  FIX: extracted `deactivateFinancing(financingId, userId) → VehicleFinancing` into hooks.ts (the natural home — it already owns onFinancingDeactivated;
  composes the repo write + the hook), routed both sites through it (payoff echoes the return, delete ignores it). Swapped the route's import
  onFinancingDeactivated → deactivateFinancing (no longer called directly). VERIFIED no import cycle (repository doesn't import hooks). −10 LOC. Test-anchored
  both ways (rule 3): financing-deactivate-hook.test.ts drives BOTH routes end-to-end (PUT payoff + DELETE sever the source link, best-effort no-op, unrelated
  expense untouched) — all GREEN before AND after. green→green: backend validate:local EXIT 0 — 1442 pass (unchanged) / 1 skip / 0 fail, tsc 0, musl-biome
  clean, build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C344 (deep-review → bug #102: ambiguous-vehicle CSV import silently misattributed every row)** — BALANCE: deep-review AND bug both due (deep-review
  344−339=5=budget; bug 344−341=3=budget); deep-review MORE starved-for → pick. 2-agent fan-out on surfaces not audited this session: (A) the NATIVE CSV
  import pipeline (post-mapping, distinct from the C334/C60 mapping layer), (B) year-end + quick-stats analytics. (B) the agent's 3 "defects" were all
  self-classified schema-shape nits where it admitted "the math is sound" (categoryBreakdown:[] on a zero-total year is CORRECT — FE reads .length; the
  div-by-zero "drift" is same-array same-rounding) → NO defect, year-end CERTIFIED CLEAN (year-boundary/tz, div-guards, empty-shape, no #94-pooling all
  sound). (A) surfaced a CLEAN ATOMIC live defect → #102 (the C204/C339 deep-review→bug pattern): buildImportPlan built `vehicleByName` with
  `set("year make model", id)` — two vehicles legally sharing that string (distinct nicknames, NO unique constraint) → the 2nd OVERWRITES the 1st, so a CSV
  row using that name form silently attaches to the LAST-seen vehicle, no signal (NORTH_STAR #1). VERIFIED firsthand (C21/C60). FIX: build the map
  collision-aware (a key seen twice → null = AMBIGUOUS) + resolveImportVehicleId rejects an ambiguous name with a clear "give them distinct nicknames"
  per-row error instead of last-wins. Extracted the resolution to resolveImportVehicleId (parseRow's added branch tipped it over the Biome
  noExcessiveCognitiveComplexity cap → the extraction both fixes that AND isolates the logic — a bonus arch-clean). GUARD: +2 HTTP tests
  (import-csv.test.ts): two same-model cars → the shared name errors (imported 0, "more than one vehicle"); a UNIQUE nickname still resolves (proves the
  fix is per-name-key targeted, not a blanket reject). NON-VACUOUS. green→green: backend validate:local EXIT 0 — 1444 pass (+2) / 1 skip / 0 fail, tsc 0,
  musl-biome clean (one format reflow auto-fixed), build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C345 (bug → dormant-vein clean scout: expense read-path + odometer + sync-worker CERTIFIED CLEAN, no defect, no manufactured test)** — BALANCE: bug
  OVER budget (last 341, starved-for 345−341=4 > budget 3, tightest) → FORCED. Vein dormant → 2-agent fan-out on surfaces not audited this session:
  (A) the expense LIST/FILTER/SEARCH/PAGINATION read path, (B) odometer write/recheck + photo-service. RESULTS — every agent finding debunked firsthand
  (C21/C60): (A) CERTIFIED CLEAN — cross-tenant scoped (userId always from c.get('user'), vehicleId ownership-validated), LIKE-escaped (#41), pagination
  totalCount/hasMore correct + stable-id tiebreak, sortBy enum-allowlisted (no orderBy injection), AND/OR precedence sound; the only hits were the
  redundant-double-clampPagination (harmless, same values) + empty-string-tags-after-CSV-split (returns 0 rows correctly — expenses can't have empty tags),
  both by-design-safe. (B.A1) "backward odometer reading accepted" → BY-DESIGN, not a bug: a lower reading is a legitimate correction / second-vehicle /
  out-of-order historical entry, and getCurrentOdometer uses MAX() so it can't corrupt "current" — rejecting it would break real flows (a warn-on-backward
  would be a product/UX feature, not a defect). (B.B1) "sync-worker multi-ref orphan stuck forever if no active source" → CORRECT resilient behavior, not a
  bug: processSingleRef with no findActiveByPhoto source `return`s WITHOUT marking failed / burning a retryCount — exactly right (it's "source temporarily
  unavailable", not a failure; marking it failed would wrongly exhaust retries so it never syncs when a provider is re-added) AND already PINNED
  (sync-worker.test.ts:227 asserts updateStatus NOT called on the no-source path; :238 the no-photo path). NO reachable atomic defect, NO unpinned invariant
  → certification only (the C306/C327/C334/C341 precedent — a manufactured test here = coverage-theater). DOCS-ONLY (LEDGER + BACKLOG); no source/test/build
  touched (the C344 gate is the last code state). cov: be 86.53% (carry) / fe 84.39% (carry).
- **C346 (infra): CLAUDE.md suite-size refresh (post-C335 drift)** — BALANCE: nothing OVER budget; infra most-starved AT budget (last 340, starved-for
  346−340=6 = budget) → pick. The two big infra cadences aren't due (#5 sweep ~C350, full CLAUDE.md refresh ~C348) + the closed-bug list is kept current
  inline each bug cycle (accurate through #102/C344), so this is a TARGETED single-drift fix, not a full refresh: the suite-size line cited **~1440 BE /
  ~641 FE** (stale since C335) → corrected to **~1444 BE / ~658 FE** (VERIFIED by running bun test + vitest — not guessed) + named the C336–C344 test arc
  (themeStore + appStore zero-coverage-store sweep, the buildMonthlyConsumption if-entry invariant, the #102 ambiguous-import guards). Resisted manufacturing
  a fuller refresh — the doc is otherwise current. Docs-only; no source/test/build touched → no build gate (the C309/C316/C322/C335 refresh pattern). Next
  CLAUDE.md refresh ~C348; next #5 sweep ~C350. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C347 (guard): class-level completeness pin for the offline-field-dropout family (#66/#101) on offlineExpenseToBackend** — BALANCE: nothing OVER budget;
  guard most-starved (347−342=5, budget 6) → highest-leverage pick. SCANNED for a real zero-coverage logic module: the FE store/util veins are genuinely
  worked through (sync-status C331 / theme C336 / app C342 stores done; the remaining untested FE modules — visibility-watch.svelte.ts, use-google-oauth,
  is-mobile — are IntersectionObserver/MutationObserver/$effect + OAuth-popup/postMessage bound = integration/eyes-on territory, the C163 mock-trap, pinning
  the wiring = theater) and the BE security-pure modules (csv-safety, encryption) are comprehensive (neutralize/denormalize/round-trip; round-trip/wrong-key/
  tamper). So NOT a zero-coverage pick. Instead pinned a CLASS-level invariant the loop has now re-found TWICE (#66 fuelType-drop C204, #101 missedFillup-drop
  C339): the offline outbox carries a field but offlineExpenseToBackend (the C205 single-source mapper) forgets it → silent sync data-loss. The per-field
  tests each pin ONE field; the missing guard is that EVERY user-settable OfflineExpense field survives the mapping TOGETHER. +1 completeness test
  (offline-storage.test.ts): a fully-populated OfflineExpense → assert vehicleId/tags/category/amount/date/mileage/volume/fuelType/missedFillup/description ALL
  round-trip. NON-VACUOUS (a future field added to OfflineExpense + the form but forgotten in the mapper — the exact #66/#101 shape — leaves its assertion
  unmet → RED). green→green: frontend validate:local EXIT 0 — 659 pass (+1) / 0 fail, tsc 0, build OK. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C348 (arch): extract findOwnedProvider — ONE source of truth for the tenant-scoped provider lookup in the storage registry** — BALANCE: arch at budget
  (last 343, starved-for 348−343=5 = budget, most-starved) → pick. Rule-7 fan-out (2 Explore agents). FE: NO clean win (the only byte-identical block,
  photo-upload FormData ×4, is genuine 3-liner churn — agent agreed). BE: the agent's cross-file findUserProviderById (backup.ts + registry.ts) was weak —
  the two files use DIFFERENT db-access (getDb()+dynamic-import+.get() vs this.db+.limit(1)) → it proposed TWO helpers (not a real dedup). But the
  registry.ts SAME-SCOPE subset is clean: getDefaultProvider/getBackupProviders/getProvider ran a BYTE-IDENTICAL tenant-scoped query
  `this.db.select().from(userProviders).where(and(eq(id), eq(userId))).limit(1) → row[0]` (3 sites), differing only in caller null/status handling (throw vs
  skip). VERIFIED firsthand (C21/C60). FIX: extracted private `findOwnedProvider(providerId, userId) → UserProvider | null` (returns the row/null, callers
  keep their own handling). Left getProviderInternal alone (queries by id ALONE, no userId — the deliberate no-auth variant, NOT routed here). A divergent
  copy dropping the userId predicate would be a CROSS-TENANT read, so one source of truth keeps the ownership scope in lockstep. −~18 LOC. Test-anchored
  (rule 3): registry.test.ts (23 tests) drives all 3 methods — GREEN before AND after. green→green: backend validate:local EXIT 0 — 1444 pass (unchanged) /
  1 skip / 0 fail, tsc 0, musl-biome clean (one format reflow auto-fixed), build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C349 (bug → #103: S3 provider create accepts an incomplete config → a broken row that throws on EVERY use)** — BALANCE: bug OVER budget (last 345,
  starved-for 349−345=4 > budget 3, tightest) → FORCED. Vein dormant → 2-agent fan-out on surfaces not audited this session: (A) insurance CLAIMS sub-path,
  (B) provider credential CRUD. RESULTS: (A) the claims "term doesn't cover the vehicle" finding is PRODUCT-SEMANTICS-GATED, not a clean defect (#84/C247
  deliberately validated the SECURITY props — ownership + policy-membership — while leaving coverage-consistency loose, same family as the by-design
  claimDate-before-start + payout>coverage; real insurance is messy) → not self-fixed. (B) the credential layer is leak-clean/tenant-clean/nonce-clean
  (C306/C260/C257 hold), but surfaced a CLEAN ATOMIC fail-late defect → #103: createProviderSchema's `config: z.record(...)` is shape-open, so an S3 create
  with NO endpoint/bucket/region (or no config at all) persists a 201 row + auto-populates storageConfig, then EVERY later use (test/sync) throws at
  buildS3Provider:62 — a broken-row footgun (NORTH_STAR #1-adjacent reliability). VERIFIED firsthand (C21/C60). FIX: fail-fast at CREATE in
  resolveProviderCredentials — reject an S3 config missing endpoint/bucket/region BEFORE encrypt/persist, mirroring the google-drive nonce gate in the same
  function + the buildS3Provider use-time check (google-photos needs only credentials.refreshToken → no required-config gate). GUARD: +2 HTTP tests
  (incomplete config → 400 + nothing persisted; no-config → 400) + updated 2 existing S3-create helpers (providers-routes-http + delete-provider-config-cleanup)
  to send a valid endpoint/bucket/region config (they'd relied on the no-validation behavior). NON-VACUOUS. green→green: backend validate:local EXIT 0 —
  1446 pass (+2) / 1 skip / 0 fail, tsc 0, musl-biome clean (one reflow auto-fixed), build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C350 (deep-review → guard): health-score surface CERTIFIED CLEAN; pinned the fleet-aggregation no-data-vehicle invariant (+1)** — BALANCE: deep-review
  OVER budget (last 344, starved-for 350−344=6 > budget 5) → FORCED. 1-agent firsthand audit (the 2nd agent on the Sheets path didn't return) of
  getVehicleHealth + computeFleetHealthScore + the score builders. Every agent "REAL DEFECT" debunked: (1) "insurance coverage counts an active policy with
  an EXPIRED term" IS the already-filed #14 (expired-latest-term-still-counts, characterization-pinned, awaiting Angelo) on a different surface — not new,
  not self-fixable. (2/3) "negative mileage/time intervals mis-score" are UNREACHABLE in production: the maintenance rows feeding the score builders are
  .orderBy(asc(expenses.date)) (repository.ts:1225) — the #75 caller-sorts-by-design class; a backward mileage gap scoring as "not a good interval" is
  defensible scoring-semantics, not an atomic bug. (4) the per-vehicle-vs-fleet rounding is the agent's own product-gated nit. Bounds/div-guards all
  VERIFIED present (scores in [0,100], no NaN, no-vehicles→0). NO new reachable defect → certification (C306/C327/C345 precedent). THE one
  genuinely-unpinned reachable invariant worth a non-theater guard (C256/C333 pattern): computeFleetHealthScore INCLUDES a no-data vehicle in the mean at
  its default sub-scores (reg 50 + mile 50 + ins 0 → round(37.5)=38), NOT excluded, NOT zeroed — the existing tests pin bounds/integer/no-vehicles→0 but not
  this load-bearing aggregation semantic (a refactor excluding empty vehicles or scoring them 0 would silently shift every multi-vehicle fleet score). +1
  deterministic guard (quick-stats.property.test.ts): a single no-data vehicle → 38; a 2nd no-data vehicle → still 38 (both counted). NON-VACUOUS (exclude
  → NaN/0; zero them → 25; the 38 pins reg=mile=50 defaults + inclusion). green→green: backend validate:local EXIT 0 — 1447 pass (+1) / 1 skip / 0 fail,
  tsc 0, musl-biome clean (one reflow auto-fixed), build bundled. cov: be 86.53% (carry) / fe 84.39% (carry).
- **C351 (infra): #5 branch-hygiene sweep + coverage RE-MEASURE + BRANCH_REVIEW.md refresh (branch 161 commits, last full sweep C340)** — BALANCE: nothing
  OVER budget; infra most-starved (351−346=5) + the #5 sweep due (last full C340) → pick. (1) STRAY-TEST CHECK (load-bearing): ZERO stray untracked
  unit/spec .test.ts — all by-design (e2e specs+snapshots, .meshclaw-tools/, configs, the squash-merged offline-entries doc). (2) GREEN BASELINE + a fresh
  COVERAGE RE-MEASURE (last full C323, 28 cycles ago, with a substantial test arc since): backend bun test --coverage → be 86.25% line / 86.67% func
  (line ~flat/−0.3 vs C323's 86.53 as product code grew, func +0.5); frontend vitest --coverage → fe 84.17% line / 83.9% func / 76.32% branch (~flat vs
  C323's 84.39/83.97/76.43 — the C336/C342 store sweep + C347 dropout-class pin held the line). 1447 BE / 659 FE pass. BE↔FE gap stable ~2pts; 90%-goal
  still structurally gated. (3) BRANCH_REVIEW.md refresh (gitignored): scope 150→161 (C190–C339 → C190–C350), status 1440→1447 BE / 647→659 FE + the C351
  re-measure, appended §32 (the C340–C350 arc: #102/#103 fixed, the C341/C345/C350 clean-certs, deactivateFinancing/findOwnedProvider dedups, the C342/C347
  guards), bumped the Suggested-merge footer (150→161). Updated the LEDGER COVERAGE TREND header with the C351 reading. Doc/measurement-only; only
  loop/LEDGER.md + loop/BACKLOG.md commit. Next sweep ~C361; CLAUDE.md full refresh is overdue (~C348) — fold into the next infra cycle. cov: be 86.25% / fe 84.17%.
- **C352 (bug → #104: a tag containing the CSV delimiter (; or ,) silently round-trip-split on export→re-import)** — BALANCE: bug at budget (last 349,
  starved-for 352−349=3 = budget, tightest) → pick. Vein dormant → 2-agent fan-out on un-audited surfaces: (A) EV/charge math, (B) CSV EXPORT path. (A) the
  agent's findings were debunked: "averageMilesPerKwh reads volume" is CORRECT (electric rows store kWh in the volume column by design; the
  isElectricFuelType partition guards it), and "costPerMile pools fuel+charge for a plug-in hybrid" is PRODUCT-SEMANTICS-GATED (a single blended $/mi is a
  debatable display choice, not a data bug) → no fix. (B) surfaced a CLEAN ATOMIC defect → #104: the expense CSV export joins tags with '; ' (routes.ts:431)
  and the import splits on /[;,]/ (import-csv.ts:169), but tags were validated only for length — so a tag CONTAINING a semicolon/comma (e.g. "oil; filter")
  round-trips into MULTIPLE tags ("oil","filter") → silent data loss on export→re-import (NORTH_STAR #1). VERIFIED firsthand (C21/C60). FIX: reject the two
  delimiter chars in a tag at the write boundary via a refine — and factored a shared `tagElementSchema` (the create base + the update override both built
  their own `z.string().min(1).max(tagMaxLength)` tags element; the override drops the base .default([]) for the C34 .partial() clobber, so it needed the
  refine TOO — a bonus dedup that put the rule in ONE place so a future schema can't miss it). GUARD: +4 HTTP tests (create-with-; → 400 + nothing
  persisted; create-with-, → 400; update-introducing-delimiter → 400 + stored tags survive; a normal tag still creates — control). NON-VACUOUS. green→green:
  backend validate:local EXIT 0 — 1451 pass (+4) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.25% (carry) / fe 84.17% (carry).
- **C353 (guard): pin the mixed plug-in-hybrid MPG/mi-kWh ISOLATION invariant (Property 6) — the C352 EV-fan-out follow-through** — BALANCE: guard AND arch
  both at budget (guard 353−347=6=budget; arch 353−348=5=budget); guard MORE starved → pick. The C352 EV fan-out flagged that a MIXED plug-in-hybrid (a
  vehicle logging BOTH gas fill-ups AND electric charges) leans entirely on calculateVehicleStats's isElectricFuelType partition to keep MPG and mi/kWh
  separate — and that partition's EFFICIENCY isolation was UNPINNED (Property 4 pins the volume/cost partition; Property 5 the trackFuel/trackCharging
  gating; neither asserts a gas row stays OUT of the mi/kWh denominator + a charge OUT of the MPG pairing — the #66 cross-contamination class). VERIFIED
  firsthand the partition is correct (vehicle-stats.ts:70-76 → fuelGroup→averageMpg, chargeGroup→averageMilesPerKwh). +3 deterministic guards (Property 6,
  vehicle-stats.property.test.ts): a 4-row INTERLEAVED mixed vehicle (gas 10000→10300mi/10gal=30 MPG; electric 20000→20060mi/15kWh=4 mi/kWh, disjoint
  mileage ranges) → averageMpg=30 (only gas), averageMilesPerKwh=4 (only charge), totals partitioned (20gal/30kWh, counts 2/2). NON-VACUOUS: a leak that
  cross-paired a gas+charge row would give a ~10000-mile absurd interval, NOT 30/4. green→green: backend validate:local EXIT 0 — 1454 pass (+3) / 1 skip /
  0 fail, tsc 0, musl-biome clean (one reflow auto-fixed), build bundled. cov: be 86.25% (carry) / fe 84.17% (carry).
- **C354 (arch): extract computeAverageEfficiency — ONE source of truth for the analytics efficiency-average + empty→null guard** — BALANCE: arch OVER
  budget (last 348, starved-for 354−348=6 > budget 5) → FORCED. Rule-7 fan-out (2 Explore agents). FE candidate (a shared photoApi over the
  insurance-api/expense-api per-entity photo methods, 2 services) was the higher-surface pick (different naming conventions across modules, overlaps the
  already-rejected photo-upload-FormData). Picked the cleaner BE one: getQuickStats/getYearEnd/getSummary computed `avgEfficiency` as a BYTE-IDENTICAL
  4-liner (convertedEfficiencyValues.length > 0 ? reduce(sum)/len : null) at 3 sites (repository.ts:1183/1980/2056), all consuming the same
  computeConvertedEfficiencyValues() → number[]. VERIFIED firsthand (C21/C60). FIX: extracted private computeAverageEfficiency(values) → number|null
  (sibling to computeConvertedEfficiencyValues), routed all 3 through it. The empty→null guard (a div-by-zero vector) now lives in ONE place. −9 LOC.
  Test-anchored both ways (rule 3): the analytics property/HTTP suites (quick-stats, year-end, summary) drive all 3 readers — GREEN before AND after.
  green→green: backend validate:local EXIT 0 — 1454 pass (unchanged) / 1 skip / 0 fail, tsc 0, musl-biome clean, build bundled. cov: be 86.25% (carry) /
  fe 84.17% (carry).
- **C355 (bug → dormant-vein clean scout: reminder mark-serviced + vehicle-stats period/cost CERTIFIED CLEAN, no new defect)** — BALANCE: bug at budget
  (last 352, starved-for 355−352=3 = budget, tightest) AND deep-review at budget (5); bug tighter → pick. Vein dormant → 2-agent fan-out: (A) reminder
  mark-serviced/re-arm, (B) vehicle-stats cost/period math. RESULTS — every finding debunked firsthand (C21/C60): (A) mark-serviced re-arm CERTIFIED CLEAN
  (both axes re-arm, anchor-to-CURRENT-odometer, future-advance for multi-period-overdue, ownership-scoped — ALL comprehensively pinned in mark-serviced.test.ts:
  mileage-anchor/re-armed-not-due/time-one-period/multi-period→future/early-service/both-axis/cross-tenant-404). The agent's "mark-serviced↔trigger
  double-advance race" is the #100 architecture-gated family (un-serialized read-modify-write; narrow same-user concurrent window on a single-user PWA, not a
  clean atomic fix) → NOTED under #100, not separately filed. The "stale unread notification after mark-serviced" is PRODUCT-GATED (the notification is a
  historical record — "was due on Jan 1" WAS true; auto-clear-on-service vs keep-as-history-until-dismissed is a UX call, user can markNotificationRead). (B)
  vehicle-stats: NO new defect — the period-cost-over-all-time-span mixing is the already-FILED #45 (semantics-gated, grouped with the currentMileage card
  call), and totalMileage clamp / costPerMile div-guard / single-expense / refund / boundary all CERTIFIED CLEAN + pinned. NO reachable atomic defect, NO
  unpinned reachable invariant (mark-serviced is comprehensively covered) → certification only (the C306/C345/C350 precedent — a manufactured test = theater).
  DOCS-ONLY (LEDGER + the #100 note); no source/test/build touched (the C354 gate is the last code state). cov: be 86.25% (carry) / fe 84.17% (carry).
- **C356 (deep-review → bug #105: Google Photos uploadBytes misclassified a 401 auth-expiry as a retryable NETWORK_ERROR)** — BALANCE: deep-review OVER
  budget (last 350, starved-for 356−350=6 > budget 5) → FORCED. 2-agent fan-out: (A) Google provider service wrappers, (B) backup-orchestrator + restore.
  Both agents over-reported; triaged firsthand: (B) the orchestrator "per-provider status not recorded" findings are the FILED #43/#44 fail-open-honesty
  family; ZIP-omission/restore-atomicity/coercion all GUARDED (the agent talked itself out of 7/9). (A) #36/#37 filed; listAlbums->50-album pagination
  (rare) + Sheets-sparse-row (manual-edit) are lower-priority hardening. The CLEAN ATOMIC defect → #105: createRealPhotosClient.uploadBytes (the ONE Photos
  call that bypasses authedFetch — it needs raw-octet upload headers) threw a flat NETWORK_ERROR on !res.ok, so a 401/403 (expired/revoked token) was
  classified as a retryable network flake → the sync backoff retries it as a transient glitch (a 401 storm) instead of surfacing AUTH_INVALID for the user to
  re-connect. VERIFIED firsthand (C21/C60): authedFetch (:150) AND the sibling batchCreate/download/list paths already map 401/403→AUTH_INVALID; only
  uploadBytes was inconsistent. FIX: mirror authedFetch's status→code mapping in uploadBytes (401/403→AUTH_INVALID, else NETWORK_ERROR). Correct regardless
  of testability. NO guard added — the fix lives in createRealPhotosClient (the REAL HTTP client); the service test suite injects a FAKE PhotosClient that
  bypasses it, so exercising the real 401 path needs a global-fetch mock the suite deliberately avoids (the C163 mock-trap) → documented, not manufactured
  (coverage-theater avoidance). green→green: backend validate:local EXIT 0 — 1454 pass (unchanged; the fix is in the un-faked real client) / 1 skip / 0 fail,
  tsc 0, musl-biome clean, build bundled. cov: be 86.25% (carry) / fe 84.17% (carry).
- **C357 (infra): CLAUDE.md FULL orientation refresh (the overdue ~C348 refresh)** — BALANCE: nothing OVER budget; infra most-starved AT budget (last 351,
  starved-for 357−351=6 = budget) + the full CLAUDE.md refresh was overdue (flagged ~C348; only targeted suite-size spot-fixes since C335). Read the
  drift-prone sections vs source/LEDGER (no churn — the C5/C47/C72 discipline). FIXED the two material drifts: (1) the coverage line cited the C323 reading
  (86.53/84.39) → updated to the C351 re-measure (be 86.25/86.67, fe 84.17/83.9/76.32) + the "coverage has PLATEAUED, reachable remainder held flat as
  product grows" honest framing + extended the FE-ratchet narrative past C223 (the C336/C342 store sweep + C347/C353 pins); (2) suite size ~1444/658 →
  ~1454/659 + the C345–C356 test arc (the #103/#104 guards, C350 fleet-health, C353 hybrid-isolation). The closed-bug list (through #105/C356) +
  pending-Angelo block (#88/#94/#97/#98/#100) are kept current inline each cycle — verified accurate, no change. Docs-only; no source/test/build touched →
  no build gate (the C309/C316/C322/C335 refresh pattern). Next CLAUDE.md refresh ~C370; next #5 sweep ~C361. cov: be 86.25% / fe 84.17%.
- **C358 (bug → #106: the expense-list date-range filter EXCLUDED an expense on the chosen END day — date-picker off-by-one)** — BALANCE: bug at budget
  (last 355, starved-for 358−355=3 = budget, tightest) → pick. Vein dormant → 2-agent fan-out: (A) offline outbox queue, (B) date/timezone utils. (A) the
  agent's findings were the #100 family (concurrent-tab lost-update on localStorage), #79 (stuck queue), or crypto-UUID-negligible; the "#11 currency
  dropped in offlineExpenseToBackend" is a real #66/#101-class sibling BUT currency is NOT user-settable on the offline form (the form has no currency
  input — it's the user's single global currency), so it's latent-not-live → NOTED, not fixed. (B) surfaced a CLEAN ATOMIC live defect → #106: filterExpenses
  (expense-filters.ts:51) did `new Date(expense.date) <= new Date(filters.endDate!)`, but the DateRangePicker binds a date-only 'YYYY-MM-DD'
  (CalendarDate.toString(), date-range-picker.svelte:56) → `new Date('2024-06-15')` = midnight UTC, so an expense stored that day (noon-local via
  dateOnlyToISO) was EXCLUDED from a range whose end IS that day (off-by-one, the #87/#39 class on the client-side list filter). VERIFIED end-to-end firsthand
  (C21/C60): picker→filters.endDate→filterExpenses. FIX: parse both bounds as LOCAL calendar days (localDayStart, reading the date PARTS not new Date(UTC)),
  end = local-midnight of the day AFTER endDate (exclusive) so the WHOLE end day is included regardless of time-of-day. GUARD: +2 tests (a noon-on-end-day
  expense is INCLUDED; a YYYY-MM-DD closed range includes both boundary days); the 3 existing full-ISO range tests still pass (CI is UTC). NON-VACUOUS.
  green→green: frontend validate:local EXIT 0 — 661 pass (+2) / 0 fail, tsc 0, build OK. cov: be 86.25% (carry) / fe 84.17%+ (carry).
- **C359 (guard): pinned `formatPaymentFrequency` — the user-visible payment-frequency label rendered in NextPaymentCard** — BALANCE: nothing actionable
  OVER budget (feature 359−170=189 but the only open feature is maintenance T9, e2e-harness-blocked, + the rest is Angelo-gated → not loop-actionable);
  guard AT budget (last 353, starved-for 359−353=6 = budget) and the most-starved actionable category → pick guard. Vein dormant → 2-agent fan-out for a
  genuinely-unpinned REACHABLE invariant (pin, don't manufacture coverage-theater): (A) backend pure helpers, (B) frontend pure utils. (A) the agent's top
  pick was `normalizeDate`'s Unix-seconds-vs-ms threshold in analytics-charts.ts — but it SELF-ADMITS "today's DB path always surfaces a Date object", so
  the numeric branch is reachable only by hypothetical future callers → REJECTED as not-live coverage-theater (the C306/C327/C341/C355 protocol). (B)
  surfaced a CLEAN reachable pick: `formatPaymentFrequency` (financing-calculations.ts:496) — pure, ZERO test refs (grep-verified), rendered LIVE at
  NextPaymentCard.svelte:149 with `financing.paymentFrequency`, whose DB column (schema.ts:86) admits exactly {monthly|bi-weekly|weekly|custom}. A refactor
  that renames/drops a case or mis-cases a label ("Bi-Weekly") would silently change a real user-facing label → genuinely-unpinned reachable invariant, NOT
  theater. VERIFIED firsthand (C21/C60): function source + the 4 schema values + the live render site + no existing test. GUARD: +2 tests appended to
  next-payment-date.test.ts (the NextPaymentCard display-helper family's home) — (1) each of the 4 schema-valid frequencies maps to its exact label; (2) an
  unknown frequency + '' pass through verbatim (the graceful no-blank fallback). NON-VACUOUS (a wrong label fails). green→green: frontend validate:local
  EXIT 0 — 663 pass (+2) / 0 fail, tsc 0, build OK. cov: be 86.25% (carry) / fe 84.17%+ (carry).
- **C360 (arch): extract `groupOwnedBy` — ONE source of truth for the split-expense tenant-scope predicate (6 sites → 1)** — BALANCE: arch OVER budget
  (last 354, starved-for 360−354=6 > budget 5) → MUST pick arch (feature is more-starved at 190 but its only-open T9 is e2e-blocked / the rest Angelo-gated,
  not loop-actionable). rule-7 fan-out (2 agents). DEBUNKED firsthand (C21/C60): the FE agent's "dead getCategoryColor/categoryLabels/getCategoryIcon" claim
  was FALSE — all three are live in ExpenseOverviewSection/ExpensesTable/RecentActivityCard/ReminderForm/ExpenseForm + 2 routes (the C234-guarded category-map
  trio); rejected. Also rejected the BE `Number(x)||0` coercion (idiomatic, a variadic helper is churn not a real collapse) + the test-only formatters rework
  (low leverage). PICK (CONFIRMED firsthand): the split-group tenant predicate `and(eq(expenses.groupId, groupId), eq(expenses.userId, userId))` was copied
  BYTE-IDENTICAL at SIX sites — four reads (findIdsByGroupId:203, getSplitExpense:678, deleteSplitExpense-read:695, updateSplitExpense-read:740) AND TWO
  destructive delete-writes (deleteSplitExpense:717, updateSplitExpense:786). Two C109 comments (710-714, 782-783) manually plead "keep ownership and deletion
  on the SAME predicate" — a divergent copy dropping the userId scope = a cross-tenant read or (worse) cross-tenant DELETE. Extracted
  `private groupOwnedBy(groupId, userId): SQL | undefined` (and+eq, the existing import) and routed all 6 → the C109 boundary is now enforced STRUCTURALLY,
  not by comment. Behavior-preserving (the SQL is identical). Test-anchored: delete-split-child + split-service.property drive every routed path — GREEN
  before AND after. Biome reflowed 2 now-short `.delete().where()` chains (check:musl:fix). validate:local EXIT 0, 1454 pass (unchanged). cov: be 86.25%
  (carry) / fe 84.17% (carry).
- **C361 (deep-review): financing-amortization + depreciation/cost-per-period audit → CERTIFIED CLEAN; +1 beyond-schedule guard** — BALANCE: deep-review
  AT budget (last 356, starved-for 361−356=5 = budget) + bug also at budget; picked deep-review (broader value, surfaces the next bug; feature over-budget
  but T9 e2e-blocked / rest Angelo-gated, not loop-actionable). 2-agent fan-out on under-audited money surfaces: (A) financing amortization/payoff/min-payment,
  (B) depreciation + cost-per-period rollups. (B) CLEAN — every cost/mile, cost/month, value-over-time path is div-guarded (Math.max(1, ownershipMonths) +
  >0 checks) and anchored by the `expectAllFinite(tco)` property test; no NaN/Infinity escapes; #27/#28 year-vs-all-time honored. (A) the agent flagged
  derivePaymentEntries' beyond-schedule fallback as a "money bug" — DEBUNKED FIRSTHAND (C21/C60): calculateAmortizationSchedule's 2nd arg only sets isPaid;
  the schedule is the CONTRACTUAL projection (stops at termMonths, or earlier on payoff / the C161 negative-am guard). A payment logged BEYOND it gets
  principal=expense.amount, interest=0 — CORRECT, because those payments land after the balance is already 0 (no interest to attribute) and remainingBalance
  stays Math.max(0,…)-floored. No money lost/invented → NOT a defect, the "should amortize" is a preference with no balance to amortize. THE genuinely-unpinned
  invariant → guard: the Property-10 test SKIPS this case via `if (entry && scheduleEntry)`. +1 deterministic guard (financing-calculations.property.test.ts):
  a 1000@12%/6mo loan overpaid with 8×200 payments → schedule shorter than the payment count, every beyond entry all-principal/zero-interest/balance-floored-0.
  NON-VACUOUS (asserts schedule.length<entries.length AND beyond.length>0, so the case actually triggers). green→green: fe validate:local EXIT 0, 664 pass
  (+1). cov: be 86.25% (carry) / fe 84.17% (carry).
- **C362 (bug → #107: fastForwardPastNow left a bounded reminder ACTIVE when its endDate fell in the period straddling now)** — BALANCE: bug OVER budget
  (last 358, starved-for 362−358=4 > budget 3) → forced pick. Vein dormant → 2-agent fan-out: (A) expense-split allocation/rounding, (B) reminder
  trigger/materialization. (A) the agent's "duplicate vehicleId in a split not rejected → metrics inflated 100%" was DEBUNKED FIRSTHAND (C21/C60): a
  v-1:$50 + v-1:$50 config on a $100 total stores two self-consistent legs; v-1's attributed total is $100 = exactly what the user split — NO double-count
  beyond what was entered. A validation nicety, not a money-correctness defect → NOT fixed. (B) surfaced a CLEAN ATOMIC live defect → #107: fastForwardPastNow
  (trigger-service.ts:273) checks `nextDue > endDate` only at the TOP of its `while (nextDue <= now)` loop — so the FINAL advance that steps nextDue PAST now
  and exits is NEVER tested against endDate. A bounded reminder, lapsed past maxCatchUp (=12) into fast-forward, whose endDate lands in the period straddling
  now (lastStep ≤ endDate < final nextDue) is written FORWARD of its endDate yet left is_active=1 → it fires AGAIN next trigger (the bug #12 family, on
  fast-forward's exit boundary; the C25 in-loop fix didn't cover the exit). VERIFIED end-to-end firsthand: traced the maxCatchUp→fastForward handoff (:454)
  + the reachable endDate window. FIX: mirror the in-loop guard ONCE after the loop, before the write — deactivate instead of advancing past endDate (+7 lines).
  GUARD: +1 HTTP test (trigger-fastforward-enddate.test.ts) — a monthly bounded reminder with endDate≈now (lands in the straddling period, ≥ the last ≤now
  step so the IN-loop guard never fires — exercises ONLY the exit guard) → is_active=0 after trigger. NON-VACUOUS (RED pre-fix: stays active). NOTE filed: the
  insurance Property-1 test is FLAKY (non-fixed fast-check seed + a same-second endDate tiebreak + a tight 5s timeout — one full-suite run hit it, isolation
  + re-run both GREEN); a future guard/infra cycle should pin the tiebreak deterministically + raise the timeout. green→green: be validate:local EXIT 0, 1455
  pass (+1) / 0 fail (re-run clean). cov: be 86.25% (carry) / fe 84.17% (carry).
- **C363 (infra): killed the C362-filed FLAKE in insurance Property-1 (non-deterministic green-build floor)** — BALANCE: infra most-starved AT budget (last
  357, starved-for 363−357=6 = budget) → pick. Of the two infra candidates (#5 branch-hygiene sweep + the C362-filed flaky test), took the flake — a
  non-deterministic failure in the green-build FLOOR is exactly the harness debt infra exists to kill, and it's fresh. ROOT CAUSE (verified firsthand):
  getCurrentTermDates is `ORDER BY end_date DESC LIMIT 1` — a SINGLE sort key — but the test's reference loop picked the latest term via strict `>` (keeps the
  FIRST max). validTermInputArb derives endDate=startMs+gapMs, which can COLLIDE → two terms tie on end_date with different start_dates → SQL's arbitrary
  tie-break disagrees with the loop on startDate → spurious failure; fast-check then SHRANK the false counterexample 47× against a real in-mem DB, blowing the
  5s timeout (the "timed out" symptom was the shrink, not a hang). FIX (test-only, no product change): assert the REAL tie-tolerant contract — the returned
  end_date IS the max, and the returned (start,end) pair belongs to SOME created term at that max (a real round-tripped row, not mangled) — + 20s timeout
  headroom. Also +1 DETERMINISTIC tie test (two terms, SAME end / DIFFERENT start) that pins the tie-tolerant contract head-on (the exact shape that flaked).
  STRESS-VERIFIED: insurance file 6× consecutive → 16 pass / 0 fail every run (was the 15-test file). green→green: be validate:local EXIT 0, 1456 pass (+2) /
  0 fail. cov: be 86.25% (carry) / fe 84.17% (carry). Next infra: #5 branch-hygiene sweep (now most-starved cadence) ~C366; CLAUDE.md refresh ~C370.
- **C364 (guard): pinned the REAL getVehicleDisplayName — fixed a C229 coverage-theater gap on a 12-site display helper** — BALANCE: nothing actionable over
  budget; guard closest to budget (last 359, starved-for 364−359=5, budget 6) → highest-leverage pick. 2-agent fan-out for a genuinely-unpinned REACHABLE
  invariant. The FE pick (verified firsthand, C21/C60): getVehicleDisplayName (vehicle-helpers.ts) is used across 8 components + 4 routes, yet its ONLY
  "coverage" was VehicleManagement.test.ts:275 which RE-IMPLEMENTS the function as a local arrow and tests the COPY — never importing the real export (the
  exact C229 coverage-theater anti-pattern CLAUDE.md warns about). So the load-bearing `!vehicle → 'Unknown Vehicle'` fallback was UNGUARDED — and it's
  REACHABLE: a split expense / reminder / insurance term can outlive the vehicle it references (the #88/#97 deleted-vehicle family), and every consumer leans
  on this helper to render a safe label instead of dereferencing .year on null. (Rejected the BE picks as lower-value: import-csv buildImportPlan ambiguity is
  already pinned at the ROUTE level [#102, C344, import-csv.test.ts:332]; pagination hasMore is already property-tested; sync mixed-type is a thin HTTP nicety.)
  +1 test file (vehicle-helpers.test.ts, 5 tests driving the REAL export): nickname-wins, year/make/model fallback, empty-nickname-falls-through, null +
  undefined → 'Unknown Vehicle'. NON-VACUOUS. green→green: fe validate:local EXIT 0, 669 pass (+5) / 0 fail, tsc 0, build OK. cov: be 86.25% (carry) / fe
  84.17%+ (carry).
- **C365 (arch): extract odometerRepository.vehicleScope — ONE source of truth for the odometer tenant+vehicle predicate (6 sites → 1)** — BALANCE: arch AT
  budget (last 360, starved-for 365−360=5 = budget) → most-starved actionable pick (feature over-budget but not loop-actionable). rule-7 fan-out (2 agents).
  PICK (CONFIRMED firsthand, C21/C60): odometer/repository.ts repeated the raw-SQL tenant scope `vehicle_id = ${vehicleId} AND user_id = ${userId}` at SIX
  sites — getHistory's data query (2 UNION legs) + its count query (2 subqueries) + getCurrentOdometer's MAX-UNION (2 legs). The #48/#52/C109 belt-and-braces
  comments (46-49/82-84/143-144) manually plead "scope BOTH legs" — a divergent copy dropping user_id on ANY one leg = a cross-tenant history leak OR a
  poisoned maintenance mileage trigger (design D2). Extracted `private vehicleScope(vehicleId, userId): ReturnType<typeof sql>` returning the scoped fragment,
  routed all 6 (the expense legs keep their `AND mileage IS NOT NULL` suffix appended after the fragment). RULE-3 GREEN→GREEN VERIFIED FIRST: getCurrentOdometer
  is comprehensively anchored (get-current-odometer.test.ts — both-source MAX, NULL-mileage exclusion, per-vehicle scope, AND the #48 userId cross-tenant test
  at :129) + getHistory by odometer-history.property.test.ts — all pass UNCHANGED before AND after. Behavior-preserving (identical emitted SQL). Rejected the FE
  calculateDaysUntil↔getDaysRemaining collapse (real but crosses 2 modules into a NEW file + the two differ in input type/name — thinner collapse, more churn;
  deferred). validate:local EXIT 0, 1456 pass (unchanged). cov: be 86.25% (carry) / fe 84.17% (carry).
- **C366 (deep-review): vehicle-delete cascade + backup/restore round-trip audit → CERTIFIED CLEAN; +1 claim-survival data-safety guard** — BALANCE:
  deep-review AT budget (last 361, starved-for 366−361=5 = budget) + bug also at budget; picked deep-review (broader value, surfaces the next bug). 2-agent
  fan-out on under-audited NORTH_STAR #1 surfaces. (B) backup/restore: CERTIFIED CLEAN — all 15 tables round-trip, insert-order is FK-correct (parents before
  children), validateReferentialIntegrity rejects dangling refs, the whole thing is one atomic transaction; symmetry pinned by backup/restore-table-coverage
  guards. (A) vehicle-delete cascade: CERTIFIED CLEAN — every child table is correctly cascaded (financing/odometer/expenses/reminderVehicles/termVehicles
  junctions) or set-null (insuranceClaims); photos manually cleaned pre-cascade (the no-FK string-link). Both known orphan findings (#88 split-reminder, #97
  vehicle-less reminder) are ALREADY FILED + characterized. The agent's lone un-filed nit (non-transactional delete handler) is the documented best-effort
  photo-cleanup pattern (photos has no FK → a mid-cleanup throw leaves orphan photo rows, not data loss; lower than a live bug + broader than one increment)
  → NOTED, not fixed. THE genuinely-unpinned invariant → guard: insurance_claims.vehicleId is onDelete:'set null' (schema.ts:188), deliberately UNLIKE the
  cascade FKs — a claim is a financial/legal record (payoutAmount/claimDate/status) belonging to its POLICY, so a vehicle delete must PRESERVE it with vehicleId
  nulled, NOT destroy it (no silent loss). NOTHING pinned this; a regression flipping that FK to 'cascade' would silently wipe claim history on an unrelated
  vehicle delete. +1 HTTP guard (vehicle-delete-cascade.test.ts): seed policy+claim→vehicleId, DELETE the vehicle, assert the claim SURVIVES with vehicle_id
  NULL + policy_id + payout intact. NON-VACUOUS (cascade would null the whole row). green→green: be validate:local EXIT 0, 1457 pass (+1) / 0 fail. cov: be
  86.25% (carry) / fe 84.17% (carry).
- **C367 (bug → #108: buildSeasonalEfficiency inflated fillupCount by N for a split fuel fillup — the #56/#18/C97 split-sibling class)** — BALANCE: bug OVER
  budget (last 362, starved-for 367−362=5 > budget 3) → forced pick. Vein dormant → 2-agent fan-out: (A) analytics chart-assembly, (B) photo/photoRef sync
  worker. (B) the agent's "retryCount<3 cap → silent data loss" was DEBUNKED (C21/C60): a bounded retry is by-design, and the loss path requires deactivating
  the PRIMARY provider AFTER the backup ref failed 3× — the #43/#44 fail-open family, already escalated → NOT a clean atomic bug. (A) surfaced a CLEAN ATOMIC
  live defect → #108: buildSeasonalEfficiency (analytics-charts.ts:641) did `entry.fillupCount++` UNCONDITIONALLY per row. queryFuelExpenses (repository.ts:628)
  selects ALL category='fuel' rows with NO volume filter, and a split fuel expense creates one sibling PER VEHICLE each with volume=null (createSiblings never
  sets volume — VERIFIED firsthand: grep volume in split-service.ts = 0 hits). So a single split fillup inflated the season's fillupCount by N — the EXACT
  #56/#18 row-overcount class, here on the seasonal-efficiency surface (fuel-advanced is a public endpoint). The fix already exists everywhere else:
  computeAverageCosts (:434) + the fuel-stats COUNT (C97) restrict to `volume != null && volume > 0`. FIX: same isFillup guard before the count (+`continue` on
  null/≤0 volume). GUARD: +2 (analytics-charts-unpinned.test.ts) — a split fillup (1 volume row + 2 null siblings) counts as 1 not 3; a zero-volume row counts
  as 0. NON-VACUOUS (pre-fix = 3). green→green: be validate:local EXIT 0, 1459 pass (+2) / 0 fail. cov: be 86.25% (carry) / fe 84.17% (carry).
- **C368 (infra): #5 branch-hygiene sweep + coverage re-measure (the overdue ~C361/C366 cadence)** — BALANCE: nothing over budget; infra closest (last 363,
  starved-for 368−363=5, budget 6) + the #5 sweep was the overdue cadence → pick. SWEEP: working tree CLEAN — `git status` shows ONLY by-design untracked files
  (the *.meshclaw.e2e.ts runtime specs that are untracked per quality-bar #5, .meshclaw-tools/, mise.local.toml, .kiro/specs/offline-entries/, e2e snapshots);
  NO tracked-file drift, no stray modifications. Branch is 178 commits ahead of origin/main, purely claude-loop-dev off main (never touched main). COVERAGE
  RE-MEASURED (the trend-rule duty, last full C351): be 86.68% line / 86.26% func (+0.43 line vs C351 — the C353–C367 BE arc held/nudged it up against product
  growth); fe 84.45% line / 84.3% func / 76.43% branch (+0.28 line / +0.4 func — the C358/C364 FE guards held the line). Both GREEN, both creeping up, gap stable
  ~2pts; 90% goal still structurally gated (BE DI/singleton+OAuth; FE eyes-on components/routes). Build floor GREEN both sides. The branch is genuinely PR-ready
  and hasn't been flagged recently → ESCALATED to Angelo (rule 7). Docs-only cycle (no source/test touched → no build gate beyond the coverage runs, which were
  EXIT 0). cov: be 86.68% / fe 84.45%. Next #5 sweep ~C373; CLAUDE.md refresh ~C370.
- **C369 (guard): pin the PUT-claim termId cross-policy isolation guard (the unpinned leg of validateClaimRefs/#84)** — BALANCE: nothing over budget; guard
  closest (last 364, starved-for 369−364=5, budget 6) → highest-leverage. 2-agent fan-out. DEBUNKED the BE agent's top "PUT vehicleId cross-tenant unpinned"
  (C21/C60): it's ALREADY pinned (claims-http.test.ts:247). Its SIBLING was the real gap: validateClaimRefs (routes.ts:46) gates BOTH vehicleId-ownership AND
  termId-on-this-policy, on create AND update — but only the CREATE termId leg (:210) + the UPDATE vehicleId leg (:247) were pinned; the UPDATE termId leg was
  UNGUARDED. A claim re-pointed at a term on ANOTHER policy is a cross-policy referential-integrity violation (a claim belongs to its own policy's coverage).
  +1 HTTP guard: seed a 2nd policy, PUT this policy's claim at the other policy's (valid-but-foreign) termId → 400 'term...'. NON-VACUOUS (a real foreign term
  id, not a missing-id 400). Rejected the other picks: the updateClaimSchema empty-`{}` rejection (a no-op-defense nicety, not a correctness/isolation
  invariant); the FE formatRelativeTime/shouldTriggerRecurring boundary nits (already representatively tested — boundary-only adds were thin). green→green: be
  validate:local EXIT 0, 1460 pass (+1) / 0 fail. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C370 (arch): route expense-form-validation's 3 hand-built local-date strings onto the canonical toDateInputValue (3 sites → 1)** — BALANCE: arch AT budget
  (last 365, starved-for 370−365=5 = budget) → most-starved actionable pick. rule-7 fan-out. PICK (CONFIRMED firsthand, C21/C60): expense-form-validation.ts
  built a local `YYYY-MM-DD` string `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` BYTE-IDENTICAL at 3
  sites (future-date check :44, mileage-ordering entriesBefore :103, entriesAfter :116) — while the file ALREADY imports toDateInputValue (:2) and ALREADY uses
  it at :96. toDateInputValue (formatters.ts:97) is BYTE-EQUIVALENT (same parts + padStart) AND is the #87 timezone-fix locus (reads LOCAL calendar parts so a
  dateOnlyToISO noon-local round-trip is exact in every tz). A divergent hand-built copy silently re-introduces the UTC-midnight #87/#6/#61 bug class on the
  date-validation surface. Routed all 3 onto toDateInputValue (the 2 mileage sites keep their `new Date(exp.date)` then pass it; the helper takes Date|string).
  Behavior-preserving (byte-equivalent). RULE-3 GREEN→GREEN: expense-form-validation-date.test.ts pins the date-format + mileage ordering — pass UNCHANGED
  before AND after. Rejected: the BE analytics `new Date(range.start*1000)` ×3 (a 2-line mechanical pair, thinner payoff); the FE dead calculateDaysUntil delete
  (deferred — deleting a tested export is lower-value than collapsing a live triplicate onto the canonical, #87-critical helper). fe validate:local EXIT 0, 669
  pass (unchanged). cov: be 86.68% (carry) / fe 84.45% (carry).
- **C371 (bug → NO new defect; CERTIFIED CLEAN + pinned the unpinned multi-tag import round-trip)** — BALANCE: bug OVER budget (last 367, starved-for
  371−367=4 > budget 3) → forced pick. Vein dormant → 2-agent fan-out: (A) cross-vehicle/fleet analytics, (B) CSV-import value parsing. BOTH agent "bugs"
  DEBUNKED firsthand (C21/C60): (A) "buildMonthlyConsumption pools volume without per-vehicle unit conversion" IS the already-filed #94 class (the SUMMARY/
  fuel-stats builders pool distance/volume/efficiency unconverted — escalated C328; getCrossVehicle's convertDistance-per-vehicle is the correct contrast). NOT
  new. (B) "parseTags should REJECT a tag containing ;/," is BY-DESIGN-WRONG: the exporter JOINS tags with '; ' and import SPLITS on /[;,]/ — a delimiter in a
  cell is ALWAYS a separator (and #104/C352 already bars a tag from CONTAINING ;/, at the write boundary), so the proposed "reject" would BREAK normal multi-tag
  import. NOT a bug. THE genuinely-unpinned reachable invariant → pin (dormant-vein protocol, no manufacture): the round-trip test imported a `road; trip` cell
  but only asserted AMOUNTS — the tags ARRAY parseTags produces was never verified (listExpenses doesn't even return tags). +1 HTTP guard (import-csv.test.ts):
  `road; trip; toll` → ['road','trip','toll'] (semicolon split+trim); quoted `"errand,grocery"` → ['errand','grocery'] (comma split). Reads tags off sqlite.
  NON-VACUOUS (a narrowed split merges two tags). green→green: be validate:local EXIT 0, 1461 pass (+1) / 0 fail. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C372 (deep-review → #109: updateExpenseSchema dropped the both-or-neither sourceType/sourceId refine — a PUT could persist an asymmetric source link)** —
  BALANCE: deep-review OVER budget (last 366, starved-for 372−366=6 > budget 5) → forced pick. 2-agent fan-out: (A) auth/session/ownership, (B) expense
  create/update write-path. (A) CERTIFIED CLEAN — comprehensive firsthand cross-tenant verification: every CRUD route requireAuth-gated + userId-scoped, PUT
  vehicle-reassign re-validates ownership, 404 (not 200) for not-owned (no enumeration), Lucia session lifecycle sound, cross-tenant-idor.test.ts (7 tests)
  passes. (B) surfaced a CLEAN ATOMIC live defect → #109: createExpenseSchema has a both-or-neither sourceType/sourceId .refine() (routes.ts:115), but
  updateExpenseSchema (:131) does NOT — `.refine()` does NOT survive `.partial()`/`.omit()` re-derivation and was never re-added. VERIFIED firsthand (C21/C60):
  sourceType (z.literal('financing').optional()) + sourceId are client-settable on PUT (only clientId is omitted), and the handler passes the parsed body
  straight to expenseRepository.update — so `PUT {sourceId:'fin-x'}` (no type) or `PUT {sourceType:'financing'}` (no id) persists an ASYMMETRIC link (the
  #62/#34 within-tenant integrity class: skews source-bucketed analytics + a half-link with a real sourceId mis-/never-triggers the financing cascade-delete
  cleanup). FIX: re-add the same both-or-neither refine to updateExpenseSchema. GUARD: +3 (expense-source-traceability.test.ts) — PUT only-sourceId → 400,
  PUT only-sourceType → 400, PUT neither (normal edit) → 200 (not over-broad). NON-VACUOUS. green→green: be validate:local EXIT 0, 1464 pass (+3) / 0 fail. cov:
  be 86.68% (carry) / fe 84.45% (carry).
- **C373 (infra): CLAUDE.md full orientation refresh (the overdue ~C370 cadence; last full C357)** — BALANCE: nothing over budget; infra closest (last 368,
  starved-for 373−368=5, budget 6) + the CLAUDE.md refresh was the overdue cadence → pick. Read the drift-prone sections vs source/LEDGER (no churn — the
  C5/C47/C72 discipline). FIXED the two MATERIAL drifts: (1) the coverage line cited the C351 reading (86.25/86.67 · 84.17/83.9/76.32) → updated to the C368
  re-measure (be 86.68/86.26 · fe 84.45/84.3/76.43) + the "creeping UP, not flat" framing + the structural-gate note; (2) suite size ~1454/659 + the C345–C356
  arc → ~1464/669 + the C358–C372 arc (the #106–#109 fix guards, C363 flake-kill, C364 coverage-theater fix, C366 claim-survival, C369 cross-policy, C371
  multi-tag). The closed-bug list (through #109/C372) + the pending-Angelo block (#88/#94/#97/#98/#100) + testing-infra/open-gaps were VERIFIED accurate inline
  — no change. Docs-only; no source/test/build touched → no build gate (the C309/C316/C322/C357 refresh pattern). Next CLAUDE.md refresh ~C383; next #5 sweep
  ~C378. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C374 (bug → #110: calculateLeaseMetrics no-endDate fallback used termMonths×30 days, not calendar months → over-reported the excess fee)** — BALANCE: bug
  AT budget (last 371, starved-for 374−371=3 = budget, tightest) → pick. Vein dormant → 2-agent fan-out: (A) lease-metrics/financing projection, (B)
  settings/preferences merge. (B) the agent's "orphaned unowned provider persists after backupConfig merge" was DEBUNKED firsthand (C21/C60): a provider can't
  become unowned without a delete (which runs cleanupBackupConfig), so the orphan needs a delete-vs-PUT race on stale prefs — that's the filed #100
  un-serialized read-modify-write family, NOT new (real but: storageConfig validates the MERGED result while backupConfig validates only INCOMING — a hardening
  inconsistency, noted not fixed). (A) surfaced a CLEAN ATOMIC live defect → #110: calculateLeaseMetrics (financing-calculations.ts:430) derived a missing
  endDate as `startDate + termMonths × 30 × dayMs`. endDate is NULLABLE (schema.ts:95 no notNull; FE type endDate?), so a lease stored without an explicit end
  hits this — and ×30 runs ~0.4 days short PER month (a 36-mo lease ended ~16 days / half a month early), understating daysRemaining → inflating the milesPerDay
  burn rate → OVER-reporting the projected excess-mileage FEE (money-facing, NORTH_STAR #1). FIX: derive via addMonthsClamped(startDate, termMonths) — real
  CALENDAR months, the same helper calculatePayoffDate (:254) already uses, so a no-endDate lease + an explicit payoff agree. GUARD: +1 (lease-metrics.test.ts)
  — a no-endDate 36-mo lease's daysRemaining matches the calendar-month end (±1) AND is strictly > 36×30=1080. NON-VACUOUS (the ×30 fallback fails the >1080
  assertion). green→green: fe validate:local EXIT 0, 670 pass (+1) / 0 fail. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C375 (guard): pin the reminder refineDateRange `endDate === startDate` equality boundary (the `<=`-not-`<` load-bearing case)** — BALANCE: guard AT budget
  (last 369, starved-for 375−369=6 = budget) → most-starved actionable pick (arch also at budget, ticks to forced next cycle). 2-agent fan-out. PICK (verified
  firsthand, C21/C60): refineDateRange (reminders/validation.ts:124) rejects a reminder when `endDate <= startDate` — but reminder-refinements.test.ts only
  covers strictly-after (ok) + strictly-before (fail), NOT the EQUALITY boundary. The `<=` (vs `<`) is load-bearing: a regression to `<` would silently ACCEPT a
  zero-duration start==end reminder (fires its start period then immediately deactivates). +1 test: endDate EQUAL startDate → fails with 'endDate must be after
  startDate'. NON-VACUOUS (a `<` would pass it). Rejected the other picks: FE getCategoryColor bogus-fallback already pinned (expense-category-maps.test.ts,
  confirmed C370/C234); FE getLatestTerm/sortTermsByEndDateDesc tiebreak a low-stakes determinism nit; BE photo-ref retryCount===3 the by-design cap (C367, +
  needs a mock); reminder is the cleanest pure-schema reachable boundary. green→green: be validate:local EXIT 0, 1465 pass (+1) / 0 fail. cov: be 86.68%
  (carry) / fe 84.45% (carry).
- **C377 (deep-review → #111: ExpenseForm error-fallback offline-save DROPPED missedFillup — #101 re-occurring at the sibling call site)** — BALANCE:
  deep-review AT budget (last 372, starved-for 377−372=5 = budget) + bug also at budget; picked deep-review (broader, surfaces the next bug). 2-agent fan-out:
  (A) offline outbox sync, (B) photo upload/serve. (B) CERTIFIED CLEAN — every photo route ownership-scoped (validateEntityOwnership) + nosniff'd + mime/size-
  gated; #74/#77/#78 confirmed fixed+guarded. (A) surfaced a CLEAN ATOMIC live defect → #111: ExpenseForm saves offline from TWO sites — the offline-first path
  (:579, carries fuelType+missedFillup, the #66+#101 fixes) AND the error-fallback path (:624, online-create throws → catch → save offline). The error-fallback
  addOfflineExpense (:635) carried fuelType but OMITTED missedFillup — the #101 fix landed on the offline-first path ONLY. VERIFIED firsthand (C21/C60):
  expenseData.missedFillup is built at :621 but never spread into the :624 call. So a fuel fill-up logged with "missed previous" checked during an online-create
  FAILURE (timeout/5xx) drops the flag → calculateAverageMpg pairs across the gap → garbage MPG (NORTH_STAR #1). FIX: add the missedFillup spread at :635,
  mirroring :592. GUARD: the mapper side is pinned (C347) but can't catch a field the CALL SITE never adds + the catch path is Playwright-gated (C229 trap) →
  +1 SOURCE-SCAN (offline-save-carries-fuel-fields.test.ts, 3 tests): extract every addOfflineExpense({...}) body, assert BOTH sites carry missedFillup AND
  fuelType (+ the scan-is-live count). Merge-surviving, pins the whole #66/#101/#111 dropout class at the call-site layer. NON-VACUOUS (pre-fix the
  missedFillup test RED). green→green: fe validate:local EXIT 0, 673 pass (+3) / 0 fail. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C378 (bug → NO new defect; CERTIFIED CLEAN + pinned the costPerMile cost/miles-consistency invariant)** — BALANCE: bug OVER budget (last 374, starved-for
  378−374=4 > budget 3) → forced pick. Vein dormant → 2-agent fan-out: (A) vehicle-stats cost-per-period rollup, (B) sync-manager conflict classification. BOTH
  "bugs" DEBUNKED firsthand (C21/C60): (A) "costPerMile includes untracked charge cost" is BY-DESIGN-CORRECT — costPerMile = (fuelCost+chargeCost)/totalMileage
  has a CONSISTENT numerator+denominator (both span all mileage rows); trackCharging gates the EFFICIENCY display (mi/kWh), NOT cost. The agent's "fix" (drop
  charge cost, keep charge miles) would UNDER-report real spend — a worse bug. (B) "tagsMatch partial-overlap → silent drop" is NOT data loss: a 'duplicate'
  classification is surfaced via syncConflicts→SyncConflictResolver.svelte for the USER to resolve (keep_local/keep_server/merge); conflictType only changes
  the displayed LABEL, the local is preserved either way → cosmetic imprecision, not a defect. THE genuinely-unpinned reachable invariant → pinned (dormant-vein
  protocol, no manufacture): vehicle-stats.property.test.ts pins totals partition (P4), flag gating (P5), MPG/mi-kWh isolation (P6) — but NOT that costPerMile is
  the consistent total-energy/total-miles ratio INDEPENDENT of the flags (the exact invariant the agent's "fix" would break). +1 (Property 7 in the C353 mixed
  block): costPerMile == (fuelCost+chargeCost)/20060, IDENTICAL across all 4 trackFuel/trackCharging combos. NON-VACUOUS (flag-gating the cost would fail the
  cross-combo equality). green→green: be validate:local EXIT 0, 1466 pass (+1) / 0 fail. cov: be 86.68% (carry) / fe 84.45% (carry).
- **C376 (arch): extract assertVehiclesOwned — ONE source of truth for the cross-tenant vehicle-ownership query (2 repos → 1)** — BALANCE: arch OVER budget
  (last 370, starved-for 376−370=6 > budget 5) → forced pick. rule-7 fan-out (2 agents). PICK (CONFIRMED firsthand, C21/C60): the expense split repo
  (repository.ts:611) and the insurance repo (repository.ts:103) each ran a private validateVehicleOwnership doing the BYTE-IDENTICAL core `select id from
  vehicles where userId AND id IN (ids)` → throw NotFoundError if any unowned. Verified behavior-equivalent (empty→no-op both; dupes: Set-membership ==
  dedup+length; missing: both throw). Differences were only the splitConfig-extraction (expenses) + the dbOrTx tx-handle (insurance term writes run in a tx).
  This is the C109 cross-tenant auth boundary — a divergent copy dropping the userId leg = another user's vehicle into a split allocation or insurance term
  (a money/coverage cross-tenant write). Extracted `assertVehiclesOwned(handle, vehicleIds, userId)` into a NEW dependency-free utils/vehicle-ownership.ts
  (zero repo imports → no cycle); both privates delegate (expenses keeps its config-extraction + passes this.db; insurance keeps its dbOrTx signature).
  Deliberately did NOT route through the existing validateVehicleIdsOwned — it throws ValidationError, NOT NotFoundError, so reusing it would CHANGE the
  observable error (arch rule 2 violation). Behavior-preserving (NotFoundError + empty/dupe/missing semantics identical). Test-anchored: the split + insurance
  ownership property/HTTP suites drive both call sites — GREEN before AND after. validate:local EXIT 0, 1465 pass (unchanged). Rejected the FE dead
  calculateDaysUntil delete (twice-deferred — deleting a tested export is lower-value than collapsing a live cross-tenant-boundary duplicate). cov: be 86.68%
  (carry) / fe 84.45% (carry).
- **C379 (infra): #5 branch-hygiene sweep + coverage re-measure (the C368 cadence, ~due)** — BALANCE: infra AT budget (last 373, starved-for 379−373=6 =
  budget) → most-starved actionable pick. SWEEP: working tree CLEAN — `git status` shows ONLY by-design untracked files (the *.meshclaw.e2e.ts runtime specs
  untracked per quality-bar #5, .meshclaw-tools/, mise.local.toml, .kiro/specs/offline-entries/, e2e snapshots); NO tracked-file drift. Branch is 189 commits
  ahead of origin/main, purely claude-loop-dev off main. COVERAGE RE-MEASURED (last C368): be 86.79% line / 86.39% func (+0.11 line — the C369/C372/C376 BE
  additions); fe 84.39% line / 84.3% func / 76.53% branch (~flat vs C368's 84.45/84.3/76.43 — the C374/C377 FE guards held the line as components grew). Both
  GREEN, flat-to-up, gap stable ~2.4pts; 90% goal still structurally gated (BE DI/singleton + OAuth; FE eyes-on components/routes). Build floor GREEN both sides.
  PR-readiness was escalated C368 (standing, open) — NOT re-spammed (no new decision needed; the loop keeps improving the reachable remainder). Docs-only cycle
  (no source/test touched → no build gate beyond the coverage runs, both EXIT 0). cov: be 86.79% / fe 84.39%. Next #5 sweep ~C384; CLAUDE.md refresh ~C383.
- **C380 (guard): pin the buildSummary singular/plural month rendering (the formatMonths `=== 1` boundary, via the public API)** — BALANCE: nothing over budget;
  guard closest (last 375, starved-for 380−375=5, budget 6) → highest-leverage. 2-agent fan-out. DEBUNKED 2 picks firsthand (C21/C60): FE isElectricFuelType is
  NOT untested — it's used as the ORACLE in api-transformer.property.test.ts (:160, the test calls it to decide the expected branch), so it's load-bearing-tested,
  not unpinned; the BE analytics date-range startDate>endDate case is thin characterization (would need a behavior CHANGE to 400, not a guard). PICK (verified
  firsthand): buildSummary (payment-planner.ts:113) renders monthsSaved via the private formatMonths, which pluralizes on `months === 1` ("1 month" vs "N
  months"). Property 6 pins the summary STRUCTURE (contains "vs minimum" etc.) but NEVER the singular/plural rendering — a regression dropping the `=== 1`
  branch silently emits "saves 1 months" (a visible grammar bug on the planner card). +2 tests via the PUBLIC buildSummary (the helper isn't exported):
  monthsSaved=1 → contains '1 month' AND not '1 months' (the load-bearing boundary — '1 month' is a substring of '1 months', so the not-contains distinguishes
  them); monthsSaved=2 → '2 months'. NON-VACUOUS. green→green: fe validate:local EXIT 0, 675 pass (+2) / 0 fail. cov: be 86.79% (carry) / fe 84.39% (carry).
- **C381 (arch): extract ExpenseRepository.sourceScope — ONE source of truth for the source-linked-expense tenant predicate (4 sites → 1)** — BALANCE: arch AT
  budget (last 376, starved-for 381−376=5 = budget) → most-starved actionable pick. rule-7 fan-out. PICK (CONFIRMED firsthand, C21/C60): the triple-predicate
  `and(eq(sourceType), eq(sourceId), eq(userId))` was BYTE-IDENTICAL at 4 sites in expenses/repository.ts — findBySource (:185), deleteBySource's read (:538)
  AND its destructive delete-write (:557), clearSource's update (:585). These act on AUTO-MATERIALIZED expenses (reminder/insurance/financing cascade cleanup),
  so a divergent copy dropping the userId leg = one user's source-entity delete/deactivate wiping or nulling ANOTHER user's expenses (a cross-tenant destructive
  write, the C109/#57/#62 class; 2 of the 4 sites ARE destructive). Extracted `private sourceScope(sourceType, sourceId, userId): SQL | undefined` (the existing
  SQL import from groupOwnedBy C360), routed all 4. Behavior-preserving (identical emitted SQL). RULE-3 GREEN→GREEN: delete-reminder-cascade +
  premium-expense-hook + financing-deactivate-hook + refinance-balance-reset drive deleteBySource/clearSource/findBySource across all three source paths —
  GREEN before AND after. validate:local EXIT 0, 1466 pass (unchanged). Rejected the FE dead calculateDaysUntil delete (thrice-deferred — deleting a tested
  export < collapsing a live 4-site cross-tenant-boundary duplicate, 2 destructive). cov: be 86.79% (carry) / fe 84.39% (carry).
- **C382 (deep-review): insurance premium-materialization + financing lifecycle audit → BOTH CERTIFIED CLEAN; +1 non-even-split materialization guard** —
  BALANCE: deep-review AT budget (last 377, starved-for 382−377=5 = budget) + bug over budget; picked deep-review (broader, and bug stays forced next cycle
  regardless). 2-agent fan-out. (B) financing create-or-replace / refinance / payoff CERTIFIED CLEAN — type-change field reset (#90/C293), refinance-reactivation
  (#67/C206), balance=max(0, original−SUM) clamped + single computeBalances source (C332), deactivateFinancing single-call-site (C343), inactive excluded from
  analytics — all verified firsthand + guarded. (A) insurance premium materialization CERTIFIED CLEAN — totalCost split via the integer-cents largest-remainder
  algorithm (exact to the cent), re-materialize-on-edit deletes+recreates (no double-count), #57 orphan-cleanup FIXED, zero-vehicle/zero-cost/empty-update
  handled. THE genuinely-unpinned invariant → guard: the existing premium test uses 1200/2=600 (EVEN), so the REMAINDER-distribution path (legs not all equal but
  MUST sum exactly to the total) was unpinned at the HTTP/materialization layer (the pure algorithm is property-tested, but not the insurance term→expense
  round-trip). +1 HTTP guard (premium-expense-hook.test.ts): a $100/3 premium → 3 legs summing to EXACTLY 10000 cents, distributed [3333,3333,3334]. NON-VACUOUS
  (a lost/invented cent fails the exact-cents sum). green→green: be validate:local EXIT 0, 1467 pass (+1) / 0 fail. cov: be 86.79% (carry) / fe 84.39% (carry).
- **C383 (bug): CSV export CERTIFIED CLEAN; #112 found but DESIGN-GATED (escalated); pinned the full export→import round-trip crown jewel** — BALANCE: bug OVER
  budget (last 378, starved-for 383−378=5 > budget 3) → forced pick. 2-agent fan-out: (A) CSV export, (B) FE chart-data assembly. (A) export→import CERTIFIED
  CLEAN — every field round-trips (date ISO, vehicle-by-name, category case-insensitive, amount unquoted-number, mileage/volume null↔'', fuelType/description
  formula-injection-guarded, tags '; '-join↔/[;,]/-split, missedFillup true/false, currency+createdAt export-only). (B) surfaced #112: CrossVehicleTab assigns
  series colors via `CHART_COLORS[i % 5]` but the design system defines only 5 --chart-N tokens → a 6th vehicle reuses --chart-1 (two lines same color, chart
  misleading). VERIFIED firsthand (C21/C60): reachable (VROOM is multi-vehicle; #94's fleet has 6). But the modulo is the CORRECT way to cycle a bounded palette
  — the fix is a DESIGN call (extend palette / generate hues / accept), so ESCALATED to Angelo, NOT self-invented colors (the #36/#37/#88/#94 product-gated
  pattern). THE genuinely-unpinned invariant → pinned (no clean self-fixable defect this cycle): export-csv pins the export SHAPE + import-csv pins individual
  fields, but NOTHING drove a create→EXPORT→import→re-read asserting EVERY field survives together — the NORTH_STAR #1 crown jewel. +1 HTTP guard
  (import-csv.test.ts): a fully-populated fuel expense create→export→WIPE→import → all 10 fields intact (incl. vehicleId-resolved-by-name, tags array,
  missedFillup=1, calendar day). NON-VACUOUS (any field's export-serialize OR import-parse regression turns it RED). green→green: be validate:local EXIT 0, 1468
  pass (+1) / 0 fail. cov: be 86.79% (carry) / fe 84.39% (carry).
- **C384 (infra): CLAUDE.md full orientation refresh (the overdue ~C383 cadence; last full C373)** — BALANCE: nothing over budget; infra closest (last 379,
  starved-for 384−379=5, budget 6) + the CLAUDE.md refresh was the overdue cadence → pick. Read the drift-prone sections vs source/LEDGER (no churn — C5/C47/C72
  discipline). FIXED the two MATERIAL drifts: (1) the coverage line cited the C368 reading → updated to the C379 re-measure (be 86.79/86.39 · fe 84.39/84.3/76.53)
  + the C353–C382 arc framing + ~2.4pt gap; (2) suite size ~1464/669 + the C358–C372 arc → ~1468/675 + the C373–C383 arc (the #110 fix + C375/C380/C382/C383
  guards). Also ADDED #112 (the C383 chart-palette-collision, DESIGN-gated) to the pending-Angelo escalation list. The closed-bug list correctly ends at #111/C377
  (#112 is escalated, NOT closed — verified, left as-is); testing-infra/open-gaps sections current. Docs-only; no source/test/build touched → no build gate (the
  C309/C357/C373 refresh pattern). Next CLAUDE.md refresh ~C394; next #5 sweep ~C384-ish (just did C379, so ~C390). cov: be 86.79% (carry) / fe 84.39% (carry).
- **C385 (guard): pin buildLocalDate's out-of-range-hour rejection (the foreign-import time-parse path) + document the same-day-wrap partial coverage** —
  BALANCE: nothing over budget; guard closest (last 380, starved-for 385−380=5, budget 6) → highest-leverage. 2-agent fan-out. DEBUNKED the FE pick firsthand
  (C21/C60): buildQueryString is NOT untested — reminder-api.test.ts:176 pins "isActive=false MUST survive" asserting `?isActive=false` end-to-end through the
  wrapper, exercising the `!= null`-not-truthiness distinction (the agent only grepped for an *api-utils* test FILE + missed the wrapper coverage). PICK (verified
  firsthand): buildLocalDate (local-date.ts) echo-checks Y/M/D but NOT hh/mm/ss; normalizeForeignDate (import-mapping.ts:192) parses a foreign CSV time segment
  with a bare `parseInt || 0` (no range clamp), so a malformed cell "2024-03-15 25:00:00" feeds hh=25 here. The EXISTING date echo-check INCIDENTALLY rejects an
  hour that rolls the DAY forward (hh≥24 → getDate() mismatch → null) — a reachable, correct, UNPINNED invariant. +2 guards (hh=25, hh=48 → null). Also pinned
  the KNOWN partial coverage honestly: a same-day time wrap (mm=90 → 13:30 same date) is ACCEPTED — by design, since expense analytics bucket by day/month not
  hour, so a wrapped minute can't corrupt a chart; +1 test documents the current behavior (date intact) so the gap is explicit + a future change is conscious,
  not coverage-theater. NON-VACUOUS (a Y/M-only echo-check loosening would import day-shifted foreign rows → RED). green→green: be validate:local EXIT 0, 1470
  pass (+3) / 0 fail. cov: be 86.79% (carry) / fe 84.39% (carry).
- **C386 (arch): extract monthsBetween — ONE source of truth for the calendar-month-diff in two analytics money denominators (2 sites → 1)** — BALANCE: arch
  AT budget (last 381, starved-for 386−381=5 = budget) → most-starved actionable pick. rule-7 fan-out. PICK (CONFIRMED firsthand, C21/C60): the month-diff
  expression `(now.getFullYear()−X.getFullYear())*12 + (now.getMonth()−X.getMonth())` was BYTE-IDENTICAL at 2 analytics money-paths — the financing monthsElapsed
  (repository.ts:836, → monthsRemaining) and the all-time TCO ownershipMonths (:1891, → costPerMonth = total/months). The two wrap it in DIFFERENT clamps
  (Math.max(0,…) vs Math.max(1,…)), so the shared part is the unclamped month-diff. A divergent copy (a dropped `*12`, a flipped subtraction) would skew one
  money denominator against the other. Extracted `monthsBetween(from, to)` as a sibling to the existing monthsOwnedInYear/toDate (C121/C194) pure date-math
  helpers; callers keep their own clamp. Behavior-preserving (identical computation). RULE-3 GREEN→GREEN: per-vehicle.property.test.ts (monthsRemaining +
  costPerMonth) + vehicle-tco-zero-state.test.ts (the ≥1 clamp) drive both sites — GREEN before AND after. validate:local EXIT 0, 1470 pass (unchanged). Rejected
  the FE dead calculateDaysUntil delete (4×-deferred — deleting a TESTED export is net-negative coverage vs collapsing a live money-denominator dup). cov: be
  86.79% (carry) / fe 84.39% (carry).
- **C388 (deep-review): dashboard quick-stats + expense-list pagination/filter audit → BOTH CERTIFIED CLEAN (docs-only, no manufactured test)** — BALANCE:
  deep-review OVER budget (last 382, starved-for 388−382=6 > budget 5) → forced pick. 2-agent fan-out on two heavily-used-but-this-cycle-unaudited surfaces.
  (A) dashboard quick-stats/getSummary CLEAN — every known issue already FILED (#94 fleet unit-pooling, #85 This/Last-Year range) or FIXED (#86 This/Last-Month
  year-scope C262); div-by-zero/NaN/precision guards present + property-tested; summary↔per-method equivalence pinned. (B) expense-list pagination+filter CLEAN
  — VERIFIED firsthand: the id-tiebreaker makes the sort fully deterministic (no drop/dup across pages, sort-paginated.test.ts:122 = 30 tied rows → 30 unique),
  hasMore = `offset + data.length < totalCount` (pagination.ts:53, strict < — correct at the exact boundary, spot-checked firsthand), list↔CSV-export share
  buildExpenseConditions (date-range-boundary.test.ts pins list==export), tag-AND via json_each, LIKE-metachar escape (#41), endOfDayIfDateOnly endDate-inclusive,
  EXPENSE_SORT_COLUMNS allowlist (no injection) — all already pinned. NO reachable defect, NO genuinely-unpinned invariant on either surface (both comprehensively
  guarded — the named tests cover every edge). Per the dormant-vein protocol, recorded a CERTIFICATION (docs-only) rather than manufacture a redundant test
  (coverage-theater) — the vein is genuinely dry on these two surfaces. No source/test/build touched → no build gate. cov: be 86.79% (carry) / fe 84.39% (carry).
- **C387 (bug): reminder mark-serviced CERTIFIED CLEAN; provider cross-tenant claim DEBUNKED firsthand (ARCC-consulted); pinned the backup-provider tenant-
  isolation invariant** — BALANCE: bug OVER budget (last 383, starved-for 387−383=4 > budget 3) → forced pick. 2-agent fan-out: (A) reminder mark-serviced
  re-arm, (B) provider credential resolution. (A) CERTIFIED CLEAN — both axes re-arm correctly (mileage anchors to getCurrentOdometer, time advances via the
  while-loop to first FUTURE occurrence [#83/C241], both-axes independent + atomic), defensively guarded. (B) the agent's "crafted cross-tenant PhotoRef →
  getProviderInternal decrypts another user's credentials" — domain = CREDENTIALS + cross-tenant → queried ARCC FIRST (SAX-05 Outcome-2 Data-Processing-
  Isolation: confirms "missing tenant validation in background jobs" is a real pitfall). Then VERIFIED FIRSTHAND (C21/C60): the premise is FALSE — both real
  photo_ref creation sites derive providerId from the AUTHENTICATED user's OWN providers (photo-service.ts:144 getBackupProviders(userId,…) routes through
  findOwnedProvider/C348 userId-scoped + skips non-owned/inactive; routes.ts:562 uses the just-created owned provider). No app path supplies a client-controlled
  or cross-tenant providerId → every ref is co-owned with its photo by construction → getProviderInternal's id-only lookup (explicitly @internal "where userId is
  unavailable") is safe. The "attacker inserts a PhotoRef" needs direct DB write = out of threat model. NOT a reachable defect. THE genuinely-unpinned invariant
  → pinned (the actual safety property): getBackupProviders SKIPS a config-listed provider whose row isn't owned by the user. +1 guard (registry.test.ts):
  a 'provider-foreign' in storageConfig whose findOwnedProvider → [] yields 0 backup targets. NON-VACUOUS. ARCC-grounded defense-in-depth note filed (a sync-
  worker co-ownership assertion = an architecture change, not self-fixed). green→green: be validate:local EXIT 0, 1471 pass (+1) / 0 fail. cov: be 86.79%
  (carry) / fe 84.39% (carry).
- **C389 (infra): #5 branch-hygiene sweep + coverage re-measure (infra most-starved; the C379 cadence)** — BALANCE: nothing over budget; infra most-starved
  (last 384, starved-for 389−384=5, budget 6) → pick (the #5 sweep one cycle early, but infra is the most-starved actionable category). SWEEP: working tree
  CLEAN — only by-design untracked files (the *.meshclaw.e2e.ts runtime specs per quality-bar #5, .meshclaw-tools/, mise.local.toml, .kiro/specs/offline-entries/,
  e2e snapshots); NO tracked-file drift. Branch 199 commits ahead of origin/main, purely claude-loop-dev off main. COVERAGE RE-MEASURED (last C379): be 86.78%
  line / 86.39% func (~FLAT vs C379's 86.79/86.39 — C385/C387 added guards, C386 was a behavior-preserving extract, no product code grew); fe 84.39% line /
  84.3% func / 76.63% branch (line flat vs C379's 84.39, branch +0.1 — the C380 month-plural guard). Both GREEN, flat-to-up, gap stable ~2.4pts; 90% goal still
  structurally gated. Build floor GREEN both sides. PR-readiness escalated C368 (standing, open) — NOT re-spammed. Docs-only cycle (no source/test touched → no
  build gate beyond the coverage runs, both EXIT 0). cov: be 86.78% / fe 84.39%. Next #5 sweep ~C399; next CLAUDE.md refresh ~C394.
- **C390 (bug → #113: buildDayOfWeekPatterns overcounted fillupCount + skewed avgCost/avgVolume for a split fuel fillup — the #108 sibling builder)** — BALANCE:
  bug AT budget (last 387, starved-for 390−387=3 = budget, tightest) → pick. Vein dormant → 2-agent fan-out: (A) restore round-trip, (B) fuel-advanced builders.
  (B) surfaced a CLEAN ATOMIC live defect → #113: buildDayOfWeekPatterns (analytics-charts.ts:803) did `entry.count++` UNCONDITIONALLY per row + divides
  avgCost/avgVolume by that count (:814-815). A split fuel expense creates one sibling PER VEHICLE with volume=null (queryFuelExpenses has no volume filter), so a
  single split fillup inflated the day's fillupCount by N AND skewed avgVolume (totalGallons/N, e.g. 12/3=4 not 12) + avgCost (per-row not per-fillup) — the EXACT
  #108 class buildSeasonalEfficiency already guards at :644 (the C367 fix), missed on this sibling. FIX: same volume-bearing guard (`continue` on null/≤0). +2
  guards (split fillup → 1 fillup, real avg; zero-volume → 0). VERIFIED firsthand (C21/C60). (A) the agent's "restore photoRefs cross-tenant provider" is a real
  defense-in-depth gap (restore.ts:525 validates providerIds without a userId scope) BUT requires a TAMPERED backup ZIP (the app never writes a cross-tenant
  providerId — same threat class as the C339/C387 notes) → NOTED for a future hardening cycle (ARCC/credentials-adjacent), not the clean within-app defect this
  cycle. green→green: be validate:local EXIT 0, 1473 pass (+2) / 0 fail. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C391 (guard): complete the #108/#113 split-sibling SWEEP of the fuel-advanced builder family + pin buildFillupIntervals' same-date safety** — BALANCE: guard
  AT budget (last 385, starved-for 391−385=6 = budget; arch also at budget but ticks forced next) → pick. Followed up the C390 flag (the remaining siblings may
  share the overcount). SWEEP (all 4 builders verified firsthand, C21/C60): buildSeasonalEfficiency = guarded (#108/C367); buildDayOfWeekPatterns = was the bug
  (#113/C390); buildFillupIntervals = SAFE (accumulateIntervalBuckets' `days <= 0 → continue` at :893 drops a same-date split pair); buildVehicleRadar = SAFE (its
  fuel axis goes through computePerVehicleFuelEfficiency→computeEfficiencyPoint, which null-guards volume :120 + mileage :116, and its cost axis SUMS expenseAmount
  which is correct per-leg like costPerMile/C378). So the family is FULLY audited — only the 2 count-based builders were vulnerable, both fixed. THE
  genuinely-unpinned reachable invariant the sweep surfaced → guard: buildFillupIntervals had only the C67 input-not-mutated test; its SPLIT-safety (a same-date
  sibling must not phantom a 0-day '1-3 days' interval) was unpinned. +1 guard: a 3-row same-date split fillup + one real later fillup → exactly 1 interval (the
  real gap), no phantom bucket. NON-VACUOUS (loosening days<=0 → RED). green→green: be validate:local EXIT 0, 1474 pass (+1) / 0 fail. cov: be 86.78% (carry) /
  fe 84.39% (carry).
- **C392 (arch): route buildFuelStatsFromData's inline per-vehicle distance onto the existing computeConvertedTotalDistance (2 sites → 1)** — BALANCE: arch OVER
  budget (last 386, starved-for 392−386=6 > budget 5) → forced pick. rule-7 fan-out (FE returned a clean "none" — heavily deduped). PICK (CONFIRMED firsthand,
  C21/C60): buildFuelStatsFromData (repository.ts:1404) inlined the per-vehicle mileage group → max−min → sum, BYTE-IDENTICAL to the existing private
  computeConvertedTotalDistance (:511) under skipConversion=true — and the inline code's OWN comment already said "Mirrors the grouped
  computeConvertedTotalDistance; this summary path is single-unit so it doesn't convert". A divergent copy (a null-mileage filter or `< 2` change on one) skews
  the per-vehicle distance total against the year-end path (both feed cost-per-distance money analytics). The shared method ALREADY has the skipConversion flag,
  so this is a pure call-the-existing-helper collapse — NO new helper, NO param churn. Routed the inline block → computeConvertedTotalDistance(fuelRows, new Map(),
  DEFAULT_UNIT_PREFERENCES, true) (the unit args are ignored under skipConversion). Behavior-preserving (identical math). RULE-3 GREEN→GREEN:
  fuel-stats-fleet-distance-pooling.test.ts (totalDistance = SUM of per-vehicle max-min) + year-end.property.test.ts drive both sites — GREEN before AND after.
  validate:local EXIT 0, 1474 pass (unchanged). cov: be 86.78% (carry) / fe 84.39% (carry).
- **C393 (deep-review): middleware (idempotency/rate-limit/body-limit) + split-tx-integrity audit → BOTH CERTIFIED CLEAN; idempotency in-memory-race hardening
  FILED** — BALANCE: deep-review AT budget (last 388, starved-for 393−388=5 = budget) + bug also at budget; picked deep-review (broader, surfaces next bug).
  2-agent fan-out. (B) split create/update tx integrity CLEAN — the C151 async-tx footgun is NOT exposed: all validation (ownership, computeAllocations, firstOld)
  is pre-hoisted OUT of the async tx callback (mirrors the trigger-service pattern), createSiblings is throw-free inserts, the delete→insert→photo-migrate
  sequence rolls back atomically; groupTotal==sum-of-legs penny-exact by construction (property-pinned). (A) middleware: idempotency is COMPREHENSIVELY pinned —
  user-scoped no-collision, non-2xx-not-cached, non-JSON-2xx-no-500 (#96/C315), TTL-drop, method-gating (idempotency.test.ts, verified firsthand); rate-limit
  per-user, body-limit strict-`>`. The agent's "check-then-cache RACE (get at :71, set at :88, await next() yield between → both handlers run)" — VERIFIED real
  in-principle BUT honestly low-sev: (1) the DURABLE dedup is the DB-level clientId (createIdempotent, C8) which prevents a duplicate expense regardless of this
  in-memory replay cache racing; (2) the sync worker POSTs SEQUENTIALLY (not parallel same-key), so it's theoretically-reachable-not-in-app-traffic. The agent
  itself rated it "UNLIKELY". A per-key lock/promise is a concurrency-ARCHITECTURE change (and the DB layer arguably makes it unnecessary) → FILED, not self-fixed;
  no flaky timing test manufactured (the singleton-store-across-tests constraint makes one fragile). NO genuinely-unpinned invariant on either surface → docs-only
  certification. No source/test/build touched → no build gate. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C394 (bug → #114: mark-serviced re-arm ignored endDate — a bounded reminder serviced past its end was re-armed forward + left active; the #107/bug-#12
  family on the mark-serviced path)** — BALANCE: bug OVER budget (last 390, starved-for 394−390=4 > budget 3) → forced pick. 2-agent fan-out: (A) FE api-client
  error/retry, (B) odometer/mileage trigger. (A) surfaced a real-but-lower-sev UX gap (apiClient.raw() bypasses fetchOrThrow → export/backup errors show
  "status N" not the backend message) — NOTED, not the clean data-correctness pick. (B) surfaced a CLEAN ATOMIC live defect → #114: the mark-serviced time-axis
  re-arm (routes.ts:119) advanced nextDueDate past now + WROTE it, but NEVER checked endDate — so a BOUNDED reminder (endDate nullable + accepted on create)
  serviced AFTER its end got re-armed to a future date and left is_active=1 (lives on past its end, fires again). The EXACT bug the trigger-service
  fastForwardPastNow guards (C362/#107), missed on the mark-serviced path. VERIFIED firsthand (C21/C60). FIX: mirror C362 — after the advance, if endDate &&
  nextDue > endDate → deactivate the (whole) reminder + return it inactive, not a forward date. My added branch pushed the handler over Biome's cognitive-
  complexity cap (17>15) → extracted advanceToFirstFutureDue (the loop + bug-#13 strict-advance backstop) as a module helper (bonus arch-clean, dropped it
  under 15). GUARD: +1 (mark-serviced.test.ts): a monthly start+end-in-past reminder serviced now → is_active=0 + response isActive:false. NON-VACUOUS. green→green:
  be validate:local EXIT 0, 1475 pass (+1) / 0 fail. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C395 (infra): CLAUDE.md full orientation refresh (the overdue ~C394 cadence; last full C384)** — BALANCE: infra most-starved AT budget (last 389,
  starved-for 395−389=6 = budget) + the CLAUDE.md refresh was overdue → pick. Read the drift-prone sections vs source/LEDGER (no churn — C5/C47/C72 discipline).
  FIXED the two MATERIAL drifts: (1) the coverage line cited the C379 reading → updated to the C389 re-measure (be 86.78/86.39 · fe 84.39/84.3/76.63) + the
  C353–C394 arc framing + #107–#114; (2) suite size ~1468/675 + the C373–C383 arc → ~1475/675 + the C384–C394 arc (the #113/#114 fixes, C385 buildLocalDate-hour,
  C391 the split-sibling family sweep, C392/C394 arch-extracts). The closed-bug list (through #114/C394) + pending-Angelo block + testing-infra/open-gaps were
  VERIFIED accurate inline — no change. Docs-only; no source/test/build touched → no build gate (the C309/C357/C373/C384 refresh pattern). Next CLAUDE.md refresh
  ~C405; next #5 sweep ~C399. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C396 (guard): pin restore's expense-source dangling-ref rejection (validateExpenseSourceRefs — the expense-level sibling of the junction/financing ref
  checks)** — BALANCE: nothing over budget; guard closest (last 391, starved-for 396−391=5, budget 6) → highest-leverage. 2-agent fan-out. PICK (verified
  firsthand, C21/C60): validateReferentialIntegrity hard-fails a restore if a 'reminder'-sourced expense points at a reminder NOT in the backup
  (validateExpenseSourceRefs, backup.ts:781) — a real restore-integrity guard (the C246/C339 dangling-ref class). restore-junction-refs.test.ts pins the
  JUNCTION (reminder_vehicles→vehicle) + FINANCING (vehicle_financing→vehicle) ref checks but NOT the expense-SOURCE one. +1 guard: seed a reminder-sourced
  expense (source_type='reminder', source_id=<real>), export, tamper expenses.csv to repoint source at a bogus reminder → restore REJECTS citing 'reminder' +
  mutates nothing (validation runs pre-transaction). NON-VACUOUS. Also partially closes the C339-filed "validateBackupData doesn't cross-check expense source
  refs" note (the reminder-source direction is now validated AND pinned). Rejected the FE chart-formatters picks (getXTickCount/getTrendLineProps/formatDecimalAxis
  — real but lower-stakes DISPLAY utils vs a data-safety restore guard); the BE pagination-offset-beyond was ~certified C388. green→green: be validate:local
  EXIT 0, 1476 pass (+1) / 0 fail. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C397 (arch): extract chunk() + SQLITE_BATCH_SIZE — ONE source of truth for the batched-IN-clause loop (4 photo/photoRef sites → 1)** — BALANCE: arch AT
  budget (last 392, starved-for 397−392=5 = budget; more starved than bug at 3) → pick. rule-7 fan-out (FE clean "none"). PICK (verified firsthand, C21/C60):
  the batched-IN-clause loop `for (i += 500) { ids.slice(i, i+500); inArray(col, batch) }` + the magic `500` was hand-rolled BYTE-IDENTICAL at 4 sites — photo-
  repository findByEntities/deleteByEntities, photo-ref-repository findAllByPhotos/deleteByPhotos (cascade-delete fan-outs that must stay under SQLite's variable
  limit; 2 are destructive DELETEs). A divergent stride/limit copy silently drops or double-processes a batch on a cascade DELETE (data loss). The bodies differ
  (select-photos vs select-refs vs delete), so the clean collapse is NOT a batchSelect/batchDelete pair (type churn over drizzle builders) — it's the CHUNKING:
  a pure `chunk<T>(items, size=SQLITE_BATCH_SIZE)` + the shared constant. RULE-3: the 4 batch methods had NO test net (called via the cascade HTTP path, not unit-
  tested), so the increment is the pure helper + ITS characterization test (the safety net), then route the 4 sites to `for (const batch of chunk(ids))` — a
  locally-obvious, behavior-preserving rewrite (chunk yields identical batches). +1 test file (chunk.test.ts, 7 tests): empty→[], exact-multiple, remainder, the
  flatten-round-trips-exactly data-loss guard, default-500, size<1 throws. Left the google-sheets-service:500 + backup.ts:373 sibling copies (C163 mock-trap
  territory) — noted for a future cycle. green→green: be validate:local EXIT 0, 1483 pass (+7) / 0 fail. cov: be 86.78% (carry) / fe 84.39% (carry).
- **C398 (bug → #115: PaymentMetricsGrid "Mileage Overage" card compared LIFETIME driven miles against the bare ANNUAL mileageLimit — the #64/#110 annual-vs-total
  class the sibling card already fixed)** — BALANCE: bug OVER budget (last 394, starved-for 398−394=4 > 3) → forced pick (the most-starved autonomously-actionable
  category; feature is parked on eyes-on/Playwright-blocked tails, escalated). 2-agent fan-out (BE analytics-aggregation + FE calc/state). VERIFIED FIRSTHAND
  (C21/C60): PaymentMetricsGrid.svelte:62 did `Math.max(0, mileageUsed − financing.mileageLimit)`, but `mileageUsed` (FinanceTab:157) is LIFETIME driven miles
  (currentOdometer − initialMileage) and `mileageLimit` is the ANNUAL allowance (the schema + form label "Annual Mileage Limit"; the sibling calculateLeaseMetrics:
  458 correctly scales `× leaseYears`). So a 36-mo/12k-yr lease (36k total) driven 30k showed "18,000 over" + a phantom fee on this card, while LeaseMetricsCard on
  the SAME Finance-tab screen showed 0 — two contradicting figures, the grid's inflated ~Nx. The exact #64/#91/#110/C198/C374 annual-vs-total class, Angelo-approved
  on the sibling card (C157/C198) → a KNOWN-CORRECT invariant the loop lands autonomously (not a new direction call). FIX (atomic + arch-clean): extracted the
  `annual × termMonths/12` total-allowance math (it lived inline ONLY at calculateLeaseMetrics:458-459) into a shared `leaseTotalMileageAllowance(financing)` + a pure
  `calculateLeaseOverage(financing, mileageUsed)` in financing-calculations.ts (the audited, UNIT-TESTABLE module — the safety net the eyes-on card can't have);
  routed BOTH calculateLeaseMetrics AND the .svelte card through it (ONE source of truth). NOTE the card shows CURRENT overage, LeaseMetricsCard the PROJECTED
  end-of-lease excess — genuinely different metrics, but BOTH must use the term-scaled total. GUARD: +12 (leaseTotalMileageAllowance term-scaling/0-term-fallback/
  no-limit; calculateLeaseOverage under-total→0 [the bug case, RED pre-fix], genuinely-over→excess×fee, longer-term-more-allowance, agrees-with-calculateLeaseMetrics,
  no-fee→0-cost, non-lease→0, no-limit→0). NON-VACUOUS (reverting the helper to the bare annual → RED). The paired BE finding (split null-mileage siblings break the
  consecutive-fillup PAIRING adjacency → dropped efficiency points, ~10 pairing sites) is REAL + reachable but a multi-site arch change, NOT a clean one-cycle bug fix
  → NOTED for a future arch cycle (route all pairing sites through forEachVehiclePair + a volume pre-filter), not self-fixed this cycle. green→green: fe validate:local
  EXIT 0, 686 pass (+12) / 0 fail, svelte-check + build clean. cov: be 86.78% (carry) / fe 84.39%+ (the +12 lease-overage guards nudge it up; not re-measured this cycle).
- **C399 (deep-review → #116: the reminder catch-up loop's NATURAL exit left a bounded reminder active past its endDate — the #107/#114 bug-#12 endDate family on a
  THIRD, unfixed path)** — BALANCE: deep-review OVER budget (last 393, starved-for 399−393=6 > 5) → forced pick (feature parked on eyes-on/Playwright-blocked tails).
  2-agent fan-out on under-recently-audited surfaces (reminder trigger/recurring-materialization engine + CSV import↔export round-trip integrity). VERIFIED FIRSTHAND
  (C21/C60): trigger-service.ts processReminder's catch-up `while` (:443) has an in-loop endDate guard (:445) that only inspects nextDue <= now (the while condition);
  the FINAL advance steps nextDue PAST now and exits the loop UNDER the 12-occurrence cap, so that last value is never tested against endDate — and the post-loop block
  (:464) only runs at the cap. A bounded reminder whose endDate falls between its last in-window occurrence and that final advance was left is_active=1 with a future
  nextDueDate → inflates GET /reminders/recurring-cost (monthlyRunRate gates ONLY on isActive, reminder-cost.ts:66) + stays in the active list until a LATER trigger
  lazily closes it (NO duplicate expense — the in-loop guard runs before materialization — purely a wrong active-state / wrong run-rate defect). The EXACT #107(C362,
  fastForwardPastNow exit)/#114(C394, mark-serviced) bug-#12 family on a THIRD path neither fix touched (this path stays well under the cap → fastForward never reached).
  FIX (atomic, consolidates to ONE deactivation site): the in-loop guard now just `break`s, and a single post-loop guard deactivates+returns — covering BOTH the
  in-loop-break case AND the natural-exit boundary with no duplication; mirrors fastForwardPastNow:303. GUARD: +1 HTTP (trigger-expense.test.ts): a weekly reminder
  with 4 weeks of history (« the 12 cap) + endDate≈now → is_active=0 after trigger + no re-fire on a second trigger. NON-VACUOUS (pre-fix: catchUpCount=4<12 skips
  fast-forward → left active). The existing "endDate bounds to 3 then deactivates" test still passes (break → post-loop guard deactivates). The paired CSV finding
  (a free-text value literally beginning with `'`+a formula-trigger char round-trips lossy: neutralizeCsvCell only escapes a LEADING trigger, but denormalizeCsvCell
  strips a leading `'` whenever char-2 is a trigger → asymmetric; csv-safety.ts:22/35/64) is REAL + reachable but NARROW (only `'`+`=/+/-/@/TAB/CR`-led values) → NOTED
  below for a guard cycle, not bundled into this deep-review. green→green: be validate:local EXIT 0, 1484 pass (+1) / 0 fail. cov: be 86.78%+ (carry, +1 guard) / fe 84.39% (carry).
- **C400 (infra): #5 branch-hygiene sweep + coverage re-measure (the overdue ~C399 cadence; last actual C389)** — BALANCE: NOTHING over budget (deep-review 1, guard 4,
  bug 2, arch 3, infra 5/6, feature parked); infra was the MOST-STARVED actionable category (5/6) AND the #5 sweep was overdue → highest-leverage pick (cadences exist
  so they don't get starved by shinier work; the freshly-filed CSV-apostrophe guard takes the next cycle). SWEEP: re-measured both suites — be 86.92% line / 86.54%
  func (UP +0.14/+0.15 vs C389's 86.78/86.39 — C396 + #116/C399 guards); fe 84.45% line / 84.4% func / 76.87% branch (UP +0.06/+0.1/+0.24 — the #115/C398 +12
  lease-overage guards delivered). Both creeping UP, gap stable ~2.5pts. Branch 210 ahead of origin/main. HYGIENE CATCH: the sweep found .kiro/specs/offline-entries/
  (requirements/design/tasks.md) was the ONLY feature spec left UNTRACKED, while ~29 sibling specs all commit their 3 .md docs AND the offline-entries CODE foundation
  already shipped (CLAUDE.md confirms client_id idempotency + outbox sync committed) — so a fresh clone / the eventual PR would lose this feature's design rationale.
  FIX: committed the 3 spec docs (matching every sibling; .config.kiro stays untracked as siblings do). No product code touched → no build gate beyond the coverage
  runs (both EXIT 0). All other untracked items confirmed by-design (*.meshclaw.e2e.ts specs, .meshclaw-tools/, screenshots, mise.local.toml, playwright config).
  cov: be 86.92% / fe 84.45%. Next #5 sweep ~C410; next CLAUDE.md refresh ~C405.
- **C401 (guard → the C399-filed CSV-apostrophe round-trip: VERIFIED REAL but the "clean fix" DEBUNKED → reclassified to a DIRECTION CALL + escalated; pinned the
  actual lossy behavior)** — BALANCE: nothing over budget (deep-review 2, bug 3=budget, arch 4, infra 1, feature parked); guard MOST-STARVED actionable (5/6) →
  highest-leverage pick, and the freshly-filed CSV-apostrophe guard was the obvious target. VERIFIED FIRSTHAND (C21/C60) — and the verification PAID OFF: the bug is
  REAL + reachable (makeCellGetter:88 DOES call denormalizeCsvCell on every cell incl. the vehicle name; a user-typed `'=mc2` exports unescaped [neutralizeCsvCell only
  prefixes when value[0] is itself a trigger] then imports stripped to `=mc2` [denormalize strips `'` when value[1] is a trigger] → lossy; a `'=Daily` nickname then
  fails to re-match → row drops). BUT the C399-filed "clean atomic fix" (escape to `''=mc2`) is WRONG: denormalizeCsvCell:65 strips only when value[1] is a TRIGGER, and
  `'` isn't one → `''=mc2` returns UNCHANGED (still corrupt), AND it collides with the pinned `''=double`-stays test. A single-`'` sentinel CANNOT disambiguate a
  user-typed `'=` from an export-escaped `'=`; the only invertible scheme (escape EVERY leading-`'` on write, strip one on read) reinterprets hand-authored leading-`'`
  FOREIGN CSVs, flipping the deliberate import-csv.test.ts:532 "preserves a genuinely apostrophe-led description" contract → a data-safety TRADEOFF (optimize
  VROOM-own-export round-trip vs foreign-import faithfulness), NOT a one-side fix. INCREMENT (safe, behavior-preserving): (1) fixed the FALSE doc claim in csv-safety.ts
  (denormalizeCsvCell claimed "this can never eat real data" — it can, for `'`+trigger); (2) +5 CHARACTERIZATION tests pinning the actual lossy round-trip (clearly
  labeled NOT an endorsement — flips to a true round-trip assertion when the call lands); (3) ESCALATED to Angelo via send_message with options (a) VROOM-own-export
  faithfulness / (b) foreign-import faithfulness / (c) discuss. No production behavior changed (doc + tests only). green→green: be validate:local EXIT 0, 1490 pass (+5)
  / 0 fail (format reflow → check:musl:fix double-quoted the escaped-`'` describe/test names, then re-validated clean). cov: be 86.92% (carry, tests-only) / fe 84.45% (carry).
- **C402 (bug): vehicle-stats/odometer aggregation + insurance claims/term/premium-materialization CERTIFIED CLEAN (dormant-vein scout, no defect; docs-only)** —
  BALANCE: bug OVER budget (last 398, starved-for 402−398=4 > 3) → forced pick (arch was AT budget 5=5, less starved). 2-agent fan-out on two under-recently-audited
  within-tenant surfaces. (A) vehicle-stats + odometer (vehicle-stats.ts, odometer/repository.ts, vehicles/routes.ts /stats): CERTIFIED CLEAN — every division div-by-0
  guarded (costPerMile behind totalMileage>0, averageMpg behind volume truthiness, mi/kWh behind kwh>0); the #46 negative-distance clamp (Math.max(0,...)) keeps
  costPerMile NULL not Infinity; split-fuel siblings (volume/mileage=null) correctly excluded from sumVolume + mpg pairing + expensesWithMileage (the residual
  fuelExpenseCount inclusion is the CERTIFIED-CLEAN #56/#328 class); all 6 odometer raw-SQL legs tenant-scoped via vehicleScope; period enum fully covered by PERIOD_DAYS
  (no NaN date). The live deltas are filed/escalated (#45 period span; Current-Mileage card semantics). (B) insurance claims/term/premium (insurance routes/repository/
  hooks/claims): CERTIFIED CLEAN — premium largest-remainder split sums exact (100/3→3333/3333/3334, C382-pinned), re-materialize-on-edit = deleteBySource+recreate (no
  dup/orphan), #57 orphan-cleanup complete, #84 claim link validation on create+update, findExpiringTerms excludes cancelled (#26c). Candidates DEBUNKED firsthand
  (C21/C60): photo-loss on term edit is UI-UNREACHABLE (FE hard-locks insurance-managed expenses — raw-API only); non-atomic re-materialize is the documented
  swallow-on-failure design; getCurrentTermDates/getActiveInsurancePolicyId missing-startDate-tiebreak is TEST-ONLY (no production consumer); lump-sum totalCost
  regardless of premiumFrequency is the escalated #69. NO reachable atomic defect, NO genuinely-unpinned reachable invariant (the #46 clamp + costPerMile-null + #75
  order-independence + #66 isolation + C378 costPerMile-consistency are ALL already pinned in vehicle-stats.property.test.ts; the premium split + re-materialize in
  premium-expense-hook/terms-http) → CERTIFICATION only (C306/C345/C355/C388 precedent; a manufactured test = the C181/C229 coverage-theater trap). Docs-only, no
  source/test touched. cov: be 86.92% (carry) / fe 84.45% (carry).
- **C403 (arch): extract isFillup — ONE source of truth for the volume-bearing-fillup predicate (3 inline analytics-charts sites + 1 local repository def → 1)** —
  BALANCE: arch OVER budget (last 397, starved-for 403−397=6 > 5) → forced pick. rule-7 2-agent fan-out (FE returned only a contrived test-only MS_PER_DAY dup —
  REJECTED as churn-for-churn per rule 5: a ms/day constant is fixed 86400000, the "DST divergence" risk is fiction). PICK (verified firsthand, C21/C60): the
  split-sibling guard predicate `r.volume != null && r.volume > 0` was hand-inlined BYTE-IDENTICAL at 3 analytics-charts.ts sites — computeAverageCosts (:434 filter),
  buildSeasonalEfficiency (:644 negated loop-guard), buildDayOfWeekPatterns (:807 negated loop-guard) — PLUS re-defined locally in analytics/repository.ts
  buildFuelStatsFromData (:1353 `const isFillup = (r: FuelExpenseRow) => ...`). This predicate guards the #56/#18/#108/#113 SPLIT-SIBLING OVERCOUNT class (a split fuel
  expense creates one volume=null sibling per vehicle; counting raw rows overcounts one split fillup as N) — so a divergent copy silently REINTRODUCES the overcount on
  one surface (a real latent bug, not cosmetic). Clean single home: exported `isFillup` from analytics-charts.ts (typed `Pick<FuelExpenseRow,'volume'>`), where
  FuelExpenseRow already lives + which repository.ts already imports (no cycle). Routed all 4 (3 inline → isFillup(row)/filter(isFillup); deleted the local def). Rule-2
  behavior-preserving (identical boolean). Rule-3 green→green: analytics-charts-unpinned.test.ts (the #108/#113/#56 split-sibling guards) + fuel-stats-fleet-distance-
  pooling.test.ts (the #18 COUNT) drive all 4 sites — GREEN before AND after, no test touched. be validate:local EXIT 0, 1490 pass (unchanged). cov: be 86.92% (carry) / fe 84.45% (carry).
- **C404 (deep-review → #C404: insurance_claim photos broke backup/restore — a HARD restore failure on a valid backup, NORTH_STAR #1 crown-jewel violation)** —
  BALANCE: deep-review most-starved actionable AT budget (last 399, starved-for 404−399=5=budget; feature parked) → highest-leverage pick. 2-agent fan-out (backup/
  restore round-trip + financing planner math). VERIFIED FIRSTHAND (C21/C60): validateReferentialIntegrity's validatePhotoRefs (backup.ts:739) entityTypeToIds map had
  vehicle/expense/insurance_policy/odometer_entry but OMITTED insurance_claim — yet insurance_claim IS a real photo-upload target (photos/helpers.ts:56
  validateEntityOwnership accepts it, ownership transitive through the claim's policy; the ClaimsSection UI uploads to it). createBackup serializes ALL user photos
  (backup.ts:368, entityType-agnostic), so a claim photo lands in the backup; on restore validatePhotoRefs finds no idSet for 'insurance_claim' → pushes "unknown entity
  type" → validateBackupData returns valid:false → restoreFromBackup THROWS → the ENTIRE restore aborts (not just the photo). A user who attached a photo to ANY
  insurance claim could not restore ANY of their data from their own valid backup — worse than silent loss, a hard round-trip failure on the data-safety crown jewel.
  The original 15-table cert (C366) predated claim photos. FIX (atomic, mirrors the existing pattern): build `claimIds` from backup.insuranceClaims (already serialized +
  parsed), pass it into validatePhotoRefs, add insurance_claim→claimIds to the entity map (+ a comment pinning the map to the upload allowlist). Claims insert before
  photos (restore.ts:461<:513) so FK order was already safe — only validation blocked it. GUARD: +1 round-trip (claims-roundtrip.test.ts): seed a claim + a
  entity_type='insurance_claim' photos row → exportAsZip → restoreFromBackup(replace) → success + the photo survives pointing at its claim. NON-VACUOUS (pre-fix the
  restore throws on the unknown entity type). be validate:local EXIT 0, 1491 pass (+1) (a format reflow → check:musl:fix one-lined the query string, re-validated clean).
  The paired FE finding (0%-APR loan in the Payment Planner shows "0 mos / $0 saved" because computePlannerState uses minimumPayment=0 as the baseline → defeats the C297
  fix one layer down — the #92 symptom re-manifested at the planner layer) is REAL + reachable → FILED below for a near-term bug cycle (clean atomic fix: baseline =
  minimumPayment>0 ? minimumPayment : financing.paymentAmount). cov: be 86.92%+ (carry, +1 guard) / fe 84.45% (carry).
- **C405 (bug → #117: a 0%-APR loan in the Payment Planner showed "0 mos / $0 saved" — the #92 symptom re-manifested at the planner layer)** — BALANCE: bug AT budget
  (last 402, starved-for 405−402=3=budget; the most-starved actionable with a clean ready fix beats infra's raw 5/6 — taking it resets the tightest budget + closes a
  money-facing bug). The C404-filed #117, verified FIRSTHAND (C21/C60): computePlannerState (payment-planner.ts:65) built the baseline as `{...financing,
  paymentAmount: minimumPayment}`. For a 0%-APR loan calculateMinimumPayment returns null → PaymentPlannerDialog passes `minimumPayment ?? 0 = 0` → the baseline
  amortization simulateAmortization(balance, 0, 0) trips the negative-am guard (principal = 0−0 ≤ 0 → 0 months) → monthsSaved = max(0, 0−accelerated) = 0. So a user
  paying $500 vs a $400 contractual payment on a $12k 0%-APR loan (genuinely 30→24mo) saw "0 mos / $0 saved". The C297 0%-APR fix lives one layer DOWN in
  calculateExtraPaymentImpact (0%-APR runs the loop), but the planner DEFEATED it by feeding a $0 baseline. Reachable: NextPaymentCard "Change Payment" (no apr guard) +
  FinanceTab renders PaymentPlannerDialog for ANY loan (apr=0 only adds an "APR Not Set" alert). FIX (atomic): `baselinePayment = minimumPayment > 0 ? minimumPayment :
  financing.paymentAmount` — fall back to the loan's REAL contractual payment so the baseline is a genuine amortizing schedule; routed both the primary + secondary-delta
  branches through it. apr>0 paths (minimum>0) byte-unchanged. GUARD: +5 (payment-planner.property.test.ts): 0%-APR minimum null; $500-vs-$400 → monthsSaved=6 (was 0,
  RED pre-fix) + interest $0; more-extra→strictly-more-months (monotonic, never stuck at 0); apr>0 baseline unchanged. NON-VACUOUS. fe validate:local EXIT 0, 690 pass
  (+5; one self-corrected assertion — I'd mislabeled the with-delta state 'normal', fixed). cov: be 86.92% (carry) / fe 84.45%+ (carry, +5 guards).
- **C406 (infra): CLAUDE.md full orientation refresh (the overdue ~C405 cadence; last full C395)** — BALANCE: nothing over budget (deep-review 2, guard 5, bug 1,
  arch 3, infra 6/6, feature parked); infra MOST-STARVED AT budget (last 400, starved-for 406−400=6=budget) AND the CLAUDE.md refresh cadence was due → highest-leverage
  pick. REFRESHED the drift-prone "Current state & gaps" section so a fresh-agent entry point reflects reality: (1) coverage reading C389→C400 fresh measure (be
  86.78→86.92 line / 86.39→86.54 func; fe 84.39→84.45 line / 84.3→84.4 func / 76.63→76.87 branch — both creeping UP); (2) suite size ~1475/~675 → ~1491/~690; (3)
  appended the C395–C405 closed-bug arc to the fix list (#115 lease-overage annual-vs-total, #116 reminder catch-up-natural-exit endDate [the bug-#12 family's THIRD
  path], #C404 claim-photo backup-roundtrip crown-jewel, #117 0%-APR planner) + bumped "all landed C155→C405"; (4) added the C401 CSV-apostrophe DATA-CONTRACT direction
  call to the pending-Angelo block. Doc-only, no code touched → no build gate (CLAUDE.md is not compiled; verified the edits read coherently + preserved the structure
  the loop depends on). cov: be 86.92% (carry) / fe 84.45% (carry). Next CLAUDE.md refresh ~C416; next #5 sweep ~C410.
- **C407 (guard): DRIFT-GUARD for the #C404 class — a photo on EVERY upload-accepted entity type must survive backup→restore (5 types, not just claim)** — BALANCE:
  nothing over budget (deep-review 3, bug 2, arch 4, infra 1, feature parked); guard MOST-STARVED actionable AT budget (last 401, starved-for 407−401=6=budget) →
  highest-leverage pick. The C404 fix added insurance_claim to the restore validator's entityTypeToIds map (backup.ts validatePhotoRefs), but that map and the photo-
  upload allowlist (photos/helpers.ts validateEntityOwnership) are SEPARATE lists in separate files with NO shared source of truth — exactly the drift that broke restore
  (#C404). VERIFIED FIRSTHAND (C21/C60): the upload path accepts 5 types (vehicle/insurance_policy/insurance_claim/expense/odometer_entry), the validator map now lists
  the same 5 — but ONLY insurance_claim had a round-trip test (C404), and a generic "a photo round-trips" test would NOT catch a per-type omission (that's how #C404 slipped
  past the C366 15-table cert). GUARD: +1 (claims-roundtrip.test.ts) — seed a photo on ALL FIVE upload-accepted types (vehicle/policy/claim/expense/odometer via the real
  create routes + direct photo-row inserts), exportAsZip → restoreFromBackup(replace) → assert all 5 survive pointing at their entities. NON-VACUOUS: dropping ANY type
  from the validator map → that photo restores as "unknown entity type" → validateBackupData false → the WHOLE restore aborts → RED. When a 6th photo target is added to
  the upload path, this fails until the validator map learns it. be validate:local EXIT 0, 1492 pass (+1) (a useConsistentArrayType lint on Array<[...]> → hand-fixed to
  the T[] shorthand, re-validated clean). cov: be 86.92% (carry, +1 guard) / fe 84.45% (carry).
- **C408 (bug → #118: the split-expense create schema's tags BYPASSED the #104 separator-rejection — re-opening the C352 CSV round-trip data-loss on the one boundary
  that fix missed)** — BALANCE: bug AT budget (last 405, starved-for 408−405=3=budget, the tightest "never-sits" category) tied with arch (5=5) → took bug. 2-agent
  fan-out (EV/unit math + split/tag). VERIFIED FIRSTHAND (C21/C60): createSplitExpenseSchema (validation.ts:80) had `tags: z.array(z.string()).optional()` — a bare array
  that bypassed the tagElementSchema separator-refine the REGULAR create/update boundaries enforce (routes.ts:55-64, the #104/C352 fix). The FE forwards split tags
  verbatim (expense-api createSplitExpense → POST /expenses/split), createSiblings persists `tags: params.tags ?? null` onto every sibling (split-service.ts:103), the CSV
  export joins tags with '; ' + import splits on /[;,]/ → a `road; trip` tag round-trips into TWO tags (silent data loss). #104/C352 fixed this "at the write boundary"
  but landed only on the regular create/update schemas — the SPLIT-create schema is a separate def in validation.ts that the fix missed. The split-UPDATE path is safe
  (reuses firstOld.tags, accepts no fresh tags). FIX (atomic + arch-clean, ONE source of truth): lifted tagElementSchema from routes.ts INTO validation.ts (its natural
  home — a validation primitive; routes→validation is the existing import direction, no cycle), exported it, routed createSplitExpenseSchema's tags through
  `z.array(tagElementSchema).max(maxTags)`, and re-imported it into routes.ts (the 2 regular boundaries unchanged). GUARD: +4 (split-validation-schema.test.ts): split-
  create rejects a ';'-tag (cites the #104 message) / a ','-tag / an empty tag; separator-free tags pass (control). NON-VACUOUS (RED pre-fix — the bare array accepted
  them). be validate:local EXIT 0, 1496 pass (+4) (a format reflow → check:musl:fix one-lined a .some(), re-validated clean). The paired EV finding (PHEV charge rows
  contaminate the analytics FuelStats MPG card — computeMpgAndCostPerMile has no gas/charge partition, unlike vehicle-stats.ts/C353; the agent flags it spans the
  sibling builders too) is REAL + reachable → FILED below for a near-term cycle (NOT bundled — broader than one boundary). cov: be 86.92% (carry, +4 guards) / fe 84.45% (carry).
- **C409 (arch): extract hasReminderEndedBy — ONE source of truth for the endDate-boundary predicate (4 inline sites in trigger-service.ts → 1)** — BALANCE: arch OVER
  budget (last 403, starved-for 409−403=6 > 5) → forced pick. rule-7 2-agent fan-out, and FIRSTHAND VERIFICATION (C21/C60) DEBUNKED both proposed candidates: the FE
  DAY_MS constant = churn-for-churn (rejected C403 — ms/day is fixed, divergence is fiction); the BE calculateAverageMPG-vs-vehicle-stats "dup" = the exported
  calculateAverageMPG has NO production caller (only its own test imports it), so "merging" means either deleting a tested export (net-negative, rejected C381/C386) or
  coupling vehicle-stats to test-only scaffolding — no real win. Declined both rather than manufacture churn. INSTEAD found the genuine LIVE duplication the recent fixes
  created: the predicate `reminder.endDate && nextDue > reminder.endDate` ("a bounded reminder's advance has crossed its end") hand-inlined BYTE-IDENTICAL at 4 sites in
  trigger-service.ts — fastForwardPastNow's in-loop (:281) + post-loop (:303) guards, processReminder's in-loop break (:447) + natural-exit (:473) guards. This is THE
  bug-#12 family the loop kept re-finding (#107/C362 fast-forward exit, #114/C394 mark-serviced, #116/C399 catch-up natural exit) — a divergent copy (a `>=`/`>` slip, or
  dropping the `endDate &&` null-guard) is exactly that defect class. Extracted a pure module-level `hasReminderEndedBy(reminder, nextDue): boolean` (sibling to the
  existing getAnchorDay helper); callers keep their own ACTION (break vs deactivate+return — the 4 sites diverge there by design), only the boundary TEST is shared.
  Rule-2 behavior-preserving (`endDate != null && nextDue > endDate` ≡ the old truthy check for a Date|null). Rule-3 green→green: trigger-fastforward-enddate +
  trigger-expense (#116) + the other endDate tests drive all 4 sites — GREEN before AND after, no test touched. be validate:local EXIT 0, 1496 pass (unchanged). cov: be 86.92% (carry) / fe 84.45% (carry).
- **C410 (deep-review → #120: OfflineExpenseCards rendered a RAW ISO date string instead of a formatted date)** — BALANCE: deep-review OVER budget (last 404, starved-for
  410−404=6 > 5) → forced pick. 2-agent fan-out (offline-sync outbox + route-load/dashboard display). VERIFIED FIRSTHAND (C21/C60): OfflineExpenseCards.svelte rendered
  `{expense.date}` raw at TWO sites (:58 pending, :108 synced) — the offline-first save stores `date` as a full ISO timestamp (dateOnlyToISO → noon-local), so the
  "Pending Sync"/"Recently Synced" cards on /expenses literally showed `2024-03-15T17:00:00.000Z` next to a clean formatCurrency amount, while EVERY other date in the app
  (ExpensesTable, RecentActivityCard, reminders) goes through formatDate → "Mar 15, 2024". FIX (atomic, mirrors the app-wide pattern): import formatDate +
  `{formatDate(expense.date)}` at both sites (formatDate accepts string|Date, handles both the ISO-timestamp offline-first form AND the date-only error-fallback form).
  The formatDate contract is ALREADY pinned (formatters.test.ts:96/187 cover both offline date shapes incl. the #87 negative-offset round-trip), so this is a wiring fix to
  a tested helper — the merge-surviving net is that existing coverage. EYES-ON: offline-state-BLOCKED — OfflineExpenseCards only renders with a client-side IndexedDB
  offline queue the screenshot harness can't seed (a /expenses shot needs auth + a queued offline expense; the harness auth-state was also stale → login screen), the
  same documented eyes-on-blocked class as the maintenance-T7/import-trackers tails. fe validate:local EXIT 0, 690 pass / svelte-check + build clean. The paired offline
  finding (retrySingleExpense silently drops a conflict result — no syncConflicts.current push, unlike the main loop) is REAL but TIMING-RACE-gated (conflict-on-retry-
  only, the C163 mock-trap class) → FILED below, not this cycle's pick. cov: be 86.92% (carry) / fe 84.45% (carry, wiring-only).
- **C411 (bug → #119: a plug-in hybrid's CHARGE sessions contaminated the analytics FuelStats "MPG" card)** — BALANCE: nothing over budget (deep-review 1, guard 4, arch
  2, infra 5/6); bug AT budget (last 408, starved-for 411−408=3=budget, the tightest "never-sits") + a ready clean money/efficiency-facing fix → highest-leverage (beats
  the routine #5 sweep, which infra forces next anyway). The C408-filed #119, VERIFIED FIRSTHAND (C21/C60): computeMpgAndCostPerMile (analytics-charts.ts:311) pushed
  EVERY computeEfficiencyPoint into mpgValues — and computeEfficiencyPoint accepts electric rows (electric-aware realistic band), so a charge session (kWh in `volume`)
  emitted its ~3 mi/kWh into the SAME array as ~40 mi/gal gas points → fuelConsumption (the FuelStats Average/Best/Worst card, labeled mi/gal) blended them: worst showed
  ~3 "mi/gal", the avg dragged down. The C353 gas/charge isolation vehicle-stats.ts does, missed on this analytics path. FIX (SURGICAL, not the agent's blanket
  `if(electric)return` which would have wrongly dropped charge from cost too): gate the `mpgValues.push` on `!isElectricFuelType(current.fuelType)` ONLY — costPerMileValues
  stays UNFILTERED because cost-per-mile is total energy spend over total miles (fuel+charge), a consistent $/mi (the C378-certified invariant; dropping charge cost would
  UNDER-report spend). GUARD: +3 (analytics-charts-unpinned.test.ts): a gas+charge vehicle → mpgValues has ONLY the ~30 gas point (len 1, was 2 RED pre-fix), no
  mi/kWh-magnitude leak; costPerMileValues KEEPS the charge $/mi (len 2, C378 preserved); gas-only control unaffected. NON-VACUOUS. be validate:local EXIT 0, 1499 pass
  (+3) (a format reflow → check:musl:fix, re-validated clean). The sibling builders (buildMonthlyConsumption/buildSeasonalEfficiency/buildDayOfWeekPatterns) share
  computeEfficiencyPoint + have the SAME contamination → FILED as #122 (a coherent multi-site sweep, the C367→C390→C391 per-builder-then-sweep precedent), not scattered
  into this bug cycle. cov: be 86.92% (carry, +3 guards) / fe 84.45% (carry).
- **C412 (infra): #5 branch-hygiene sweep + coverage re-measure (the overdue ~C410 cadence; last actual C400)** — BALANCE: nothing over budget (deep-review 2, guard 5,
  bug 1, arch 3, infra 6/6, feature parked); infra MOST-STARVED AT budget (last 406, starved-for 412−406=6=budget) AND the #5 sweep was overdue → highest-leverage pick.
  SWEEP: re-measured both suites — be 86.92% line / 86.56% func (line FLAT vs C400's 86.92, func +0.02 — the C403–C411 fix+guard arc held); fe 84.46% line / 84.4% func /
  76.92% branch (line +0.01 / branch +0.05 vs C400's 84.45/84.4/76.87 — the #117/C405 +5 + #120 wiring). Both flat-to-up, gap stable ~2.5pts. Branch 222 ahead of
  origin/main, working tree clean of TRACKED changes. HYGIENE CATCH (+ a SELF-CORRECTION): .kiro/specs/offline-entries/.config.kiro was still untracked — C400 committed
  that spec's 3 .md docs but left .config.kiro out, noting "as siblings do." That note was WRONG (verified firsthand C412): 23 of 24 specs DO track their .config.kiro
  (plain `{specId, workflowType, specType}` metadata, no secrets) — offline-entries was the lone straggler. Committed it → the spec is now fully consistent with every
  sibling, finishing the C400 fix. No product code touched → coverage runs were the gate (both EXIT 0). All other untracked items confirmed by-design (*.meshclaw.e2e.ts,
  .meshclaw-tools/, screenshots, playwright config, mise.local.toml). cov: be 86.92% / fe 84.46%. Next #5 sweep ~C422; next CLAUDE.md refresh ~C416.
- **C413 (bug → #122: the #119 sibling-builder sweep — extract gasEfficiencyPoint, route ALL gas-MPG aggregators through it so a PHEV's charge mi/kWh stops diluting them)** —
  BALANCE: nothing over budget (deep-review 3, guard 6=budget, bug 2, arch 4, infra 1); guard not OVER, and the C411-filed #122 was a live money/efficiency bug → highest-leverage.
  VERIFIED FIRSTHAND (C21/C60), and the verification WIDENED the scope: the filed note named 3 sibling builders, but grep found computeEfficiencyPoint feeding a gas-MPG average
  at 5 sites — computeMpgAndCostPerMile (#119/C411), buildMonthlyConsumption, addSeasonalEfficiencyData, computePerVehicleFuelEfficiency (→ vehicleRadar), and
  buildFuelEfficiencyComparison's per-vehicle monthly. ALSO verified the label is ALWAYS gas-derived (getFuelEfficiencyLabel = distance/volume, no adaptive mi/kWh on these
  charts) → excluding electric is correct (an EV-only car has no gas MPG for a mi/gal chart; its efficiency belongs on the mi/kWh surface), not an EV regression. FIX (arch-clean
  for a bug — ONE source of truth instead of 5 inline gates, dodging the C403/C409 drift risk): extracted `gasEfficiencyPoint(current, previous)` = computeEfficiencyPoint but
  null for an electric current row; routed all 5 gas-MPG sites through it (incl. replacing C411's inline `!isElectricFuelType` gate). cost-per-mile STILL calls
  computeEfficiencyPoint directly (spans all energy, C378). GUARD: +3 (gasEfficiencyPoint gas→point/electric→null; buildMonthlyConsumption + buildSeasonalEfficiency efficiency =
  the gas 30 MPG, NOT the diluted (30+4)/2=17). NON-VACUOUS. be validate:local EXIT 0, 1502 pass (+3) (an import-sort + format reflow → check:musl:fix, re-validated clean).
  cov: be 86.92% (carry, +3 guards) / fe 84.46% (carry).
- **C414 (guard): pin the LOAD-BEARING edge of the #119/#122 gas/charge partition — an EV-ONLY vehicle yields an EMPTY gas-MPG series but a real cost-per-mile** —
  BALANCE: guard OVER budget (last 407, starved-for 414−407=7 > 6) → forced pick. The C411/C413 fix rests on TWO sides: (a) charge excluded from the gas-MPG average
  (pinned by the mixed-PHEV tests), and (b) an EV-ONLY car produces a CLEAN-EMPTY gas-MPG series — null avg / empty mpgValues, NOT a phantom mi/kWh mislabeled mi/gal, NOT
  NaN — WHILE cost-per-mile still computes from charge spend (cost spans all energy, C378). Side (b) was GENUINELY UNPINNED (the existing tests all carry a gas point).
  VERIFIED FIRSTHAND (C21/C60): computeFuelConsumptionMetrics([]) returns all-null (clean), buildMonthlyConsumption with no gas pair → effCount 0 → efficiency 0 (documented
  empty value). GUARD: +3 (analytics-charts-unpinned.test.ts) — an all-charge vehicle: mpgValues EMPTY (a refactor reverting gasEfficiencyPoint→computeEfficiencyPoint → len
  1 [the ~4 mi/kWh] → RED) but costPerMileValues len 1 = $9/240mi; computeFuelConsumptionMetrics all-null (no NaN); buildMonthlyConsumption efficiency 0 not ~4, volume
  still aggregates the real kWh. NON-VACUOUS. This is a NORTH_STAR #5 merge-surviving tripwire on the C411/C413 partition — distinctly catches an EV-only regression a
  mixed test (still has a gas point) would miss. No source touched (test-only). be validate:local EXIT 0, 1505 pass (+3). cov: be 86.92% (carry, +3 guards) / fe 84.46% (carry).
- **C415 (arch): extract resetSplitAllocations — ONE source of truth for the split-method allocation reset (2 byte-identical form copies → 1)** — BALANCE: arch OVER budget
  (last 409, starved-for 415−409=6 > 5) → forced pick. rule-7 2-agent fan-out; the BE scout found NO clean byte-identical dup (well-deduped) — it flagged a MAX_VALID_MPG
  100-vs-150 band DIVERGENCE, but unifying that CHANGES behavior → bug/direction-call, NOT arch (rejected for this cycle). The FE candidate was clean: VERIFIED FIRSTHAND
  (C21/C60) the ENTIRE resetAllocationsForMethod (all 3 branches: even→[], absolute→{amount:0}, percentage→{percentage: round(100/N,1dp)}) was BYTE-IDENTICAL in ExpenseForm
  (:767) + InsuranceTermForm (:166). The 100/N rounded-to-1-decimal seed is load-bearing — a divergent copy (2-decimal round, or different N math) would materialize the SAME
  multi-vehicle split with DIFFERENT per-vehicle percentages depending on which form created it (rule-5 concrete payoff). FIX: extracted pure `resetSplitAllocations(method,
  vehicleIds): SplitAllocationDraft[]` into expense-helpers.ts (already a tested pure-util home both forms can import; no cycle); routed both forms to a one-line call.
  Rule-2 behavior-preserving (identical output). Rule-3: the forms are eyes-on/Playwright-blocked, so the increment is the helper + ITS OWN test net (+6, reset-split-
  allocations.test.ts: even→[], absolute→amount:0, percentage 100/N, the 100/3→33.3 1-decimal load-bearing rounding, empty-list→[] no-NaN, single→100); svelte-check
  verified the wiring green→green. fe validate:local EXIT 0, 696 pass (+6). No eyes-on needed — pure-logic extraction moves no pixel. cov: be 86.92% (carry) / fe 84.46% (carry, +6).
- **C416 (deep-review → #123: the provider PUT path bypassed the C349 S3-config validation CREATE has — the #103/C349 footgun re-manifested on UPDATE)** — BALANCE:
  deep-review OVER budget (last 410, starved-for 416−410=6 > 5) → forced pick (CLAUDE.md refresh ~C416 waits). 2-agent fan-out (auth/session/OAuth + storage-providers/
  sync-worker). (A) auth/session/OAuth + cross-tenant ownership CERTIFIED CLEAN — third independent confirmation (C341/C372/C416): every route requireAuth + userId-scoped,
  session refresh creates-before-invalidates, cookies httpOnly/secure/sameSite, OAuth 3-flow state single-use + flowType-gated + session-bound, the id-only repo writes are
  all defense-in-depth behind a userId ownership guard. (B) storage scout surfaced #123, VERIFIED FIRSTHAND (C21/C60): PUT /providers/:id (routes.ts:406-408) wrote
  body.config VERBATIM with NO provider-type validation — while CREATE fail-fasts an incomplete S3 config (resolveProviderCredentials, the C349 fix). So editing an S3
  provider (the edit form's canSave doesn't even require region) to a config missing endpoint/bucket/region persisted a 200 + a bricked row that throws at buildS3Provider
  on EVERY later test/upload/sync — silent backup loss, the exact #103/C349 footgun C349 only closed on CREATE. FIX (atomic + arch-clean, ONE source of truth): extracted
  validateStorageProviderConfig(providerType, config) from resolveProviderCredentials's inline S3 block; called from BOTH CREATE and the PUT handler (when body.config is
  updated, against the existing provider's type). GUARD: the existing PUT test codified the BUG (PUT {config:{changed:true}} on an s3 default → asserted 200) — flipped it
  to send a complete config for the happy path + added a NEW 400 guard (incomplete-config PUT rejected, original config survives — no partial persist). NON-VACUOUS
  (pre-fix 200). be validate:local EXIT 0, 1506 pass (+1 net). cov: be 86.92% (carry) / fe 84.46% (carry).
- **C417 (bug → #124: import normalizeDecimal corrupted a US-format number with BOTH separators — "1,234.56" → 1.23456, a ~1000x money under-count via the Fuelly preset)** —
  BALANCE: bug OVER budget (last 413, starved-for 417−413=4 > 3) → forced pick. 2-agent fan-out (import-mapping + TCO/depreciation); TCO CERTIFIED CLEAN (C361 corroborated:
  #27 exclusion correct, all cost-per-X div-guarded, percentages sum ~100). The import scout surfaced #124 AND corrected my filed grounding (there is NO "per-mapping
  decimalComma flag" — normalizeDecimal runs UNCONDITIONALLY; that note was wrong). VERIFIED FIRSTHAND (C21/C60): normalizeDecimal (import-mapping.ts:145) on `hasDot &&
  hasComma` did `s.replace(/\./g,'').replace(',','.')` — hard-assuming EUROPEAN (dot=thousands, comma=decimal). But the dot-AFTER-comma ordering of US `1,234.56` is
  UNAMBIGUOUSLY US (no locale puts a decimal dot after a thousands comma), so it stripped the dots → `1,23456` → `1.23456` = a $1,234.56 expense imported as $1.23. Applied
  unconditionally to `amount` (:295) on EVERY import incl. the US Fuelly preset (mdy/miles/US-gallons, NO decimal flag) → reachable money under-count, NORTH_STAR #1.
  DISTINCT from the product-gated #24 (a LONE-comma `1,234` IS ambiguous US-thousands-vs-EU-decimal; the BOTH-separators case is NOT — provably wrong regardless of locale).
  FIX (atomic): in the both-separators branch, the decimal separator is whichever appears LAST (`lastIndexOf`); strip the other as thousands. Handles BOTH `1.234,56` (EU,
  comma last → 1234.56) AND `1,234.56` (US, dot last → 1234.56). GUARD: +2 (US 1,234.56→1234.56 [RED pre-fix: 1.23456]; multi-group 1,234,567.89→1234567.89); the existing
  EU `1.234,56` test stays green (comma last). NON-VACUOUS. be validate:local EXIT 0, 1508 pass (+2). cov: be 86.92% (carry, +2 guards) / fe 84.46% (carry).
- **C418 (infra): CLAUDE.md full orientation refresh (the overdue ~C416 cadence; last full C406)** — BALANCE: nothing over budget (deep-review 2, guard 4, bug 1, arch 3,
  infra 6/6, feature parked); infra MOST-STARVED AT budget (last 412, starved-for 418−412=6=budget) AND the CLAUDE.md refresh cadence was overdue → highest-leverage pick.
  REFRESHED the drift-prone "Current state & gaps" section so a fresh-agent entry point reflects reality: (1) coverage reading C400→C412 fresh measure (be 86.92 line /
  86.54→86.56 func; fe 84.45→84.46 line / 76.87→76.92 branch — flat-to-up, the C403–C417 fix+guard arc held); (2) suite size ~1491/~690 → ~1508/~696; (3) appended the
  C406–C417 closed-bug arc to the fix list (#C404 claim-photo, #118 split-tag, #119/#122 PHEV-MPG gasEfficiencyPoint partition, #120 offline-date, #123 provider-PUT,
  #124 import-decimal-US-format) + bumped "all landed C155→C417". Doc-only, no code touched → no build gate (CLAUDE.md is not compiled; verified the edits read coherently +
  preserved the structure the loop depends on). The pending-Angelo block is unchanged (PR-readiness C368 + CSV-apostrophe C401 remain the open escalations; #121 + the
  MAX_VALID_MPG band divergence are loop-actionable BACKLOG items, not Angelo-gated). cov: be 86.92% (carry) / fe 84.46% (carry). Next CLAUDE.md refresh ~C428; next #5 sweep ~C422.