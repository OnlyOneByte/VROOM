# CLAUDE.md — VROOM agent entry point

VROOM is a self-hostable PWA for tracking car costs: **SvelteKit + Svelte 5 (runes)**
frontend (`frontend/`, dev :5173) and **Hono-on-Bun + Drizzle/SQLite + Lucia** backend
(`backend/`, :3001). This file is what a fresh agent session reads first. The detailed
conventions live in `.kiro/steering/*.md` (always-included); read `MainSteering.md`,
`SveltePatterns.md`, `CodeQualityRules.md`, `DatabaseMigrations.md`, and `Testing.md`
before writing code.

## The autonomous dev loop

VROOM is set up for AI-native development with minimal human intervention. Each unit of
work is **one ranked item** from `TODO.md` → "Ranked Priority Queue". Drive it through
this loop, then advance to the next item:

```
1. SPEC      Write/refresh .kiro/specs/<feature>/ (requirements.md, design.md, tasks.md).
             Surface real UI/UX decisions to the human and get sign-off before building.
2. IMPLEMENT Backend first (schema → repository → routes → validation → tests), then
             frontend (types → service → store/state → route/page → component). Match
             the patterns in the steering docs exactly — runes, $lib/routes resolve(),
             polymorphic source_id/source_type for expense-linked records.
3. VERIFY    Backend:  cd backend  && mise exec -- bun run validate:local
             (`validate:local` = tsc + musl-biome + `bun test` + build in one command — the
              local-green path on this host; plain `validate` uses the dead glibc biome, see Hard
              rules. CI still runs glibc biome and is the lint source of truth.)
             Frontend: cd frontend && mise exec -- npm run validate:local
             (`validate:local` = type-check + build + vitest in one command)
             E2E:      .meshclaw-tools/regress.sh   (route-smoke + axe + mobile + screenshots)
             UI proof: node .meshclaw-tools/shot.mjs <route> [mobile|desktop] [out.png]
   UI WORK?  A passing build is a FLOOR, not "human-ready". For any UI feature:
             - COMPOSE from the kit — see `.kiro/steering/DesignSystem.md` + the live
               component gallery at `/dev/gallery` (dev-only). Don't reinvent components,
               colors, or spacing the kit already provides.
             - Satisfy `.kiro/steering/UIQuality.md` (Four-States, mobile-first, a11y, reuse).
             - Drive it to clean with the **autonomous build→critique→fix loop**
               (`.meshclaw-tools/ui-autoloop.md`) — shoot → critic subagent → fix → re-shoot,
               cap 3 rounds. (The one-shot critic is `.meshclaw-tools/ui-critic.md`.)
4. REGRESS   regress.sh must stay green — no route white-screens, no new console errors,
             no mobile horizontal overflow. The axe a11y scan runs in REPORT mode (warns;
             flip to A11Y=strict once debt is paid). Add a route to
             e2e/route-smoke.meshclaw.e2e.ts for every new page.
5. TICK      Check the item off in TODO.md, commit on a branch, hand off to the human
             for PR/merge. Then advance to the next ranked item.
```

### Hard rules
- Work ONLY in `/local/home/angryang/.meshclaw/workspace/VROOM`. Never commit to `main`;
  the autonomous loop works on the long-lived `claude-loop-dev` branch (cut off latest
  `origin/main`); a human opens the PR and approves every merge. (One-off task branches may
  still use `feat/<task>`.)
- All node/bun commands run under `mise exec --` (node22+bun scoped via `mise.local.toml`;
  do not touch the global mise node18).
- Git network ops need `env -u GIT_SSH_COMMAND` (sandbox injects a `-F /dev/null` that
  ignores `~/.ssh/config`). Commit identity: `OnlyOneByte` / the noreply email.
- Stage ONE short path per `git add` (multi-path add trips the permission engine).
- **Biome on this aarch64 AL2 host: use the MUSL binary.** The default glibc CLI (what
  `bun run check` invokes) is dead here (`GLIBC_2.29 not found`), but the musl build runs
  fine: `backend/node_modules/@biomejs/cli-linux-arm64-musl/biome check --write <paths>`
  auto-fixes format + organizeImports + safe lint. The package scripts now wrap this:
  **`bun run check:musl`** (+ `check:musl:fix`) runs the musl binary over `src/`, and
  **`bun run validate:local`** = `type-check && check:musl && test && build` — the single
  full-green command for this host (plain `bun run validate` fails at its glibc `check` step).
  CI runs the glibc CLI and is the lint source of truth, so `check:musl` is the faithful
  local mirror — run it over the WHOLE tree before committing (a per-file check can miss a
  formatter reflow CI would flag).
- NEVER `git push` to `main`, force-push shared branches, run destructive ops, or read
  credential files. The human approves every merge.

## Verify-it-works toolkit (`.meshclaw-tools/`, untracked)
- `make-auth-state.ts` — mints a real Lucia session for the seeded `demo@example.com`
  user and writes `auth-state.json` (Playwright storageState). Run from `backend/`:
  `mise exec -- bun ../.meshclaw-tools/make-auth-state.ts`.
- `shot.mjs` — full-page screenshot of any route on the running dev server, auth-injected.
  **Always invoke via the `shot.sh` wrapper, never inline.** Inline `node …`/`mise exec -- node …`
  is refused by the permission engine (same block as inline `git commit`); running it from a script
  file is approved. `bash .meshclaw-tools/shot.sh <route> [mobile|desktop] [out.png]` cd's to
  `frontend/` and runs it. chromium-1223 is installed and `chromium.launch()` works with NO flags
  — the long-standing "Playwright sandbox-denied" note was a misdiagnosis (it was inline-execution
  denial, not a sandbox/browser problem; RESOLVED 2026-06-11). With the dev server up
  (`regress.sh START_SERVERS=1`), eyes-on UI capture works: shoot → `Read` the PNG → critique.
- `regress.sh` — **self-healing** one-command harness: mint auth → type-check → run the
  authenticated Playwright config (`frontend/playwright.meshclaw.config.ts`) → drop
  screenshots in `frontend/e2e/__screenshots__/`. Flags:
  - `START_SERVERS=1` — kills orphaned `bun --hot`/`vite` dev servers, frees :3001/:5173,
    boots fresh backend+frontend, and waits for BOTH before running. Use this by default;
    it's the fix for "my change didn't take" (a stale orphaned backend was serving).
  - `RESET_DB=1` — wipes + reseeds `backend/data/vroom.db` for a deterministic baseline.
    Use when accumulated test rows push seeded rows off page 1 / cause false failures.
  - Run a single spec: `cd frontend && mise exec -- npx playwright test --config
    playwright.meshclaw.config.ts e2e/<name>.meshclaw.e2e.ts`.
- **E2E specs are self-cleaning**: any spec that creates data via `page.request.post`
  deletes it in a `finally` block (`page.request.delete`). Keep this invariant — it's what
  lets specs run in parallel against the shared dev DB without polluting each other.
- **Interaction-spec selector lessons**: `getByLabel(x)` matches any element whose
  accessible name *contains* x (input AND a "Save x" button) → use
  `getByRole('textbox',{name})`. Assert paginator STATE (indicator + button disabled-ness),
  not raw row counts (split-expense siblings group into fewer rendered rows than the
  server's totalCount). Give seeded rows DISTINCT dates (tie order isn't stable).

## Local bring-up (aarch64 AL2)
- Backend: `cd backend && mise exec -- bun install`, write `backend/.env`, then
  `mise exec -- bun run db:init && mise exec -- bun run db:seed` (drizzle-kit push FAILS
  under bun — use db:init). Seeded user: `demo@example.com` (2 vehicles, 9 expenses).
- Frontend: `cd frontend && mise exec -- npm install`, then `mise exec -- npm run dev`
  (:5173, proxies `/api` → :3001).

## Current state & gaps
The autonomous loop steers from `loop/` (tracked): **`loop/NORTH_STAR.md`** (vision + quality
bar), **`loop/BACKLOG.md`** (ranked queue by category), **`loop/LEDGER.md`** (per-cycle log +
balance table). Read those three first to orient — they are the live snapshot.
(Note: `STATUS.md`, `BRANCH_REVIEW.md`, and `.meshclaw-autopilot/` are gitignored agent working
files, absent from a fresh clone — don't rely on them.)

Highlights:
- Reminders `/reminders` route is built and wired; offline-entries foundation (client_id
  idempotency + outbox sync) is committed; insurance/claims, analytics, CSV import/export,
  and pluggable storage providers (Drive/Sheets/Photos/S3) all ship.
- Backup/restore round-trips every table on the CSV path (schema-derived + coverage guards)
  and the Google Sheets path (header set is pinned by `sheets-header-coverage.test.ts`).
- Three feature specs are signed off (backend-first, one `tasks.md` task per loop cycle):
  - `.kiro/specs/maintenance-schedule/` (mileage+time service-interval reminders) — **backend COMPLETE,
    frontend nearly done.** Backend (T1–T5): nullable-date rebuild migration 0004 + partial mileage
    dedup index, `getCurrentOdometer`, whichever-comes-first trigger (fires on /trigger AND on
    odometer/expense write via `recheckMileageReminders`), `POST /:id/mark-serviced` re-arm, D4 Zod
    refinements (mileage reminders are API-creatable), backup round-trip guard. Frontend: T6 (types +
    `markServiced` client), T7 (`ReminderForm` trigger-mode control + mileage branch), T8 (/reminders
    milestone render + "Serviced" re-arm button) all shipped — **T7/T8 await an eyes-on screenshot**
    (the Playwright harness is sandbox-denied in the autonomous loop; an untracked
    `reminder-mileage.meshclaw.e2e.ts` captures it on regress.sh). The deferred T3-part-3 vehicle-stats
    reconcile is **DONE (C52)** — chose the additive path: GET /stats now also returns an all-time,
    all-sources `currentOdometer` (via `getCurrentOdometer`), with the period-filtered + fuel-only
    `currentMileage` left untouched (zero behavior change), pinned by `vehicle-stats-current-odometer.test.ts`.
    **Remaining: T9 only** (promote the e2e + the T7/T8 eyes-on). The lease/loan follow-on is now DONE
    (C157, Angelo-approved C151): FinanceTab's loan miles-used + lease overage consume the all-time
    `currentOdometer` via the pure `resolveCurrentOdometer` helper (the FinanceTab visual render stays
    eyes-on). The "Current Mileage" stat-card display-semantics remains a direction call for Angelo.
  - `.kiro/specs/import-trackers/` (Fuelly/Fuelio/Drivvo CSV via a mapping pre-pass over the
    hardened import pipeline) — **backend COMPLETE (T1–T3) + the FE client slice (C140); only the
    eyes-on dialog markup remains.** T1 (C58) `import-mapping.ts` pure `applyMapping` (rename +
    unit-convert + decimal-comma + category map + local-time dates); T2 (C64) `import-mapping-presets.ts`
    (preset table + `detectSource`); T3 (C70) `POST /import` gained an optional `mapping` (+
    `POST /import/detect`) — backward-compatible, the native CSV path is unchanged when no mapping is
    sent. FE client (C140): `src/lib/types/import-mapping.ts` + `expenseApi.importExpensesCsv(csv, dryRun,
    mapping?)` (backward-compat) + `detectImportSource(headers)`. **Remaining: the T4/T5 mapping-step
    dialog MARKUP + T6 e2e** (incl. real-export signature validation) — eyes-on/Playwright-blocked, so the
    feature is code-complete-but-not-DONE per the feature-DoD rule.
  - `.kiro/specs/recurring-expenses/` (recurring expense reminders auto-materialize expense rows) —
    **backend COMPLETE (T1–T3 + T7) + the T6/T7 FE client methods (C134); only the eyes-on UI remains.**
    KEY GROUNDING: the engine ALREADY EXISTS —
    a `type:'expense'` reminder auto-creates real expense rows (single or multi-vehicle split,
    `sourceType:'reminder'`) on its frequency via `trigger-service.ts` (C94 deep-review CERTIFIED it
    clean), so the spec EXTENDS it, never a new table/scheduler (NORTH_STAR #4). T1 (C96) source-
    traceability API test; T2 (C102) split-materialization characterization; T3 (C104) cascade-safe
    delete via `clearSource` (keep history, sever link, D2); T7 backend = `reminder-cost.ts`
    (`recurringCostSummary`, C111) + `GET /reminders/recurring-cost` (C116, the monthly run-rate the
    dashboard widget fetches); T6 read-seam = `expenseRepository.findBySource` + `GET /reminders/:id/
    expenses` (C122, the "materialized N expenses" list); T5 gate = pure `shouldTriggerRecurringExpenses`
    in reminder-helpers.ts (C128). The T6/T7 FE CLIENT METHODS are also done (C134): `reminderApi.
    getMaterializedExpenses(id)` + `getRecurringCost()` + the `RecurringCostSummary` type. **EVERY
    non-eyes-on slice (backend T1–T7 + the FE client wrappers) is now built/characterized.** **Remaining
    is ALL eyes-on/Playwright-blocked MARKUP:** T4 multi-vehicle split in ReminderForm; the T5
    app-init/focus hook (calls the gate → `POST /reminders/trigger`); the T6 "Recurring" badge + view; the
    T7 dashboard widget; T8 round-trip e2e.
- Standing goal (TODO.md → Misc): raise test coverage to **90%** both sides. Latest MEASURED reading
  (re-measured C447, not an estimate): **backend 86.96% line / 86.55% func · frontend 85.89% line / 87.15%
  func / 78.35% branch** (both suites > 85% line; UP vs the C435 reading 86.94/86.60 · 85.26/85.53/77.40 — the C436–C446 guard/fix arc [the C436 chart-formatters cluster + C444 isIncompleteFuelExpense + the C445/C446 sync/activity guards lifted the FE ratio +0.63 line / +1.62 func]). BE↔FE gap now **~1.1pts — the tightest ever**. The 90% goal stays structurally gated: BE tail is DI/singleton-bound + OAuth-network; FE gap is the eyes-on components/routes deficit (Playwright-blocked).
  Frontend climbed 65.3→84 since C138 under a sustained
  FE-guard ratchet (C118 memoize, C125 vehicle-form-validation, C130 formatters, C137 error-handling.ts,
  C143 api-client.ts, C149 expense-api.ts, C163 reminder-api.ts, C169 settings-api.ts, C175 pwa.ts, C201
  expense-form-validation, C207 payoff-date clamp, C212 analytics-api, C217 auth.ts, C223 sync-manager, then the C336/C342 zero-coverage STORE sweep [themeStore + appStore] + C347 offline-dropout-class pin + C353 hybrid MPG/mi-kWh isolation).
  **The FE SERVICE + pure-util + STORE layers are now fully covered** (api-client + expense-api + reminder-api +
  settings-api + error-handling + analytics-api + auth + sync-manager's clean slice + app/theme stores); the remaining FE gap is the **components/routes deficit**
  (largely eyes-on) + the network/timer-bound retry tails (the C163 mock-trap, low-value) — so the next FE guard cycles are thin; prefer BE low spots. Backend
  middleware trio all covered (idempotency C105, rate-limit C112, body-limit C156); `backup-orchestrator.ts`
  0→50% func (C181 — its old test was COVERAGE THEATER, re-implementing the logic locally instead of importing
  it; watch for that pattern), `analytics/routes.ts` 15→59% (C185), `sync/routes.ts` 32→59% (C188) — all via
  the createTestApp HTTP harness. `activity-tracker.ts`'s pure slice (`cleanupInactiveUsers` ageout) covered C195; its
  rest (handleInactivity/performAutoSync/performAutoBackup) is setTimeout + orchestrator-bound — left documented, not a
  clean unit pick. NOTE: `restore.ts` restoreFromSheets needs a process-global Sheets mock the sync suite avoids
  (see C163) — defer until a DI seam exists. **The clean BE route/util low spots are now largely worked through —
  next guard cycles are thin both sides; prefer a fresh deep-review-surfaced fix.** Recent guard/deep-review cycles now
  characterize KNOWN-HARD seams via the HTTP harness + raw-seeded providers: `validateStorageConfig`'s 4 consistency
  branches (C239), and the financing refinance-after-payoff balance-reset invariant (C240, a DB-integration net).
  loop-improvement #4 records a `cov:` tag on every LEDGER cycle entry.
  Suite size today: **~1543 backend tests / ~714 frontend** (a floor — grows most cycles; the C440–C453 arc added
  the C441 restore-reminders-probe + C443 term-schema + C446 sheets-sync + C448 import-fuel-clear + C452
  photo-cascade-symmetry + C453 0%-APR-loanBreakdown guards, the C444 isIncompleteFuelExpense extract, and the C450
  getLatestTerm tiebreak guard, on top of the C430–C439 arc). Don't regress coverage; name why if a cycle drops it.
- Testing infra that DOES exist: an in-process backend HTTP harness —
  `backend/src/test-helpers/http-client.ts` `createTestApp()` drives the REAL app over an
  in-memory SQLite DB with a seeded user + a real Lucia session cookie (`ctx.authed/anon`); it's
  how the route-level tests run (e.g. `providers-routes-http.test.ts`, C91). NOTE: `CONFIG` is a
  process-cached env snapshot read at first import, so env-gated branches (e.g.
  `ALLOW_FAKE_STORAGE`) can't be flipped per-file in the full suite — pick a path that doesn't
  need the gate (C91 used an `s3` provider, not `fake`).
- Open gaps: the analytics financing path (`getFinancing`→`computeBalance`) is still unpinnable
  in-memory because `computeBalance` binds the real-DB singleton, not the test drizzle (the C77
  Property-23 skip — needs a repo-DI refactor, flagged for sign-off); screenshot visual-diffing is
  capture-only (no baseline compare); storage-backup-toggle + the eyes-on UI tails
  (maintenance T7–T9, import-trackers T4–T6, recurring-expenses T4–T8) need Playwright/an OAuth
  provider — sandbox-blocked in the loop, so those land "code-complete, eyes-on pending."
- Loop-found HIGHs now CLOSED: **#27** (TCO financed-principal double-count) fixed C154 (Angelo-approved
  option c — keep purchasePrice, exclude financing-payment rows when price is counted); **#54** (fuel-
  efficiency trend paired rows across vehicles in the fleet view) fixed C158 (per-vehicle pairing via
  `forEachVehiclePair`); **#57** (deleting an insurance policy orphaned its auto-materialized premium
  expenses — still summed into TCO forever, no FK) fixed C167 (deleteBySource per term before delete).
  Plus the MED/LOW fixes #52/#55/#56/#48/#59/#25/#26c/#61/#62/#63/#64/#65/#66/#67/#68/#70/#71/#72/#73 (split-delete
  tenant-scope, amortization neg-guard, perFillup split inflation, odometer userId-scope [sweep COMPLETED C180 — the
  3rd read method `findByVehicleIdPaginated` was the leg C168 missed], native-CSV out-of-range date echo-check,
  insurance latest-term attribution, findExpiringTerms excludes cancelled policies, expense-PUT vehicle-reassignment
  ownership, manual-expense sourceType restricted to `financing`, provider PUT/DELETE tenant-scoped writes,
  lease excess-mileage scales the ANNUAL limit by term [C198], offline legacy-clientId minted fresh per read →
  dup-expense idempotency hole [C202], offline ELECTRIC charge dropped on sync because fuelType wasn't carried
  in the outbox [C204], re-financing a paid-off vehicle produced an INACTIVE record [C206], restore coerceRow
  truncated a thousands-separated number via parseInt [C209], /insurance/expiring-soon `days` NaN → Invalid Date →
  silently zero results [C210], mileage-reminder recheck was CREATE-only so an EDIT crossing a milestone didn't fire
  [C214], photos findByEntityPaginated userId-scoped [C215], a split-config-only reminder update falsely 400'd [C218],
  photos route missing changeTracker → photo-only change excluded from the next auto-backup [#74, C220], calculateAverageMpg
  caller-ordering dependence [#75, C222], expense category-switch leaves stale fuel fields [#76, C226], vehicle-photo serve
  missing nosniff [#77, C227 — closed as an arch-dedup side effect], setCoverPhoto id-alone write + getDb-singleton bind +
  validate-before-unset [#78, C229], license-plate uniqueness scoped per-user (route + DB index migration 0005) was global →
  cross-tenant false-409 + enumeration oracle [#80, C233], `Math.max(...arr)` argument-spread crash-class swept to spread-safe maxOf/minOf across
  18 analytics sites [#81, C235], PUT /settings backupConfig merged per-provider (was wholesale → partial PUT wiped other providers) [#82, C237],
  mark-serviced time re-arm advances to the first FUTURE occurrence (was one period → a multi-period-overdue reminder stayed overdue) [#83, C241],
  non-fuel expense write now nulls fuel-only fields server-side (a stray mileage on a misc row poisoned getCurrentOdometer cross-category) [#76-backend, C244],
  insurance claim create/update validates the optional vehicleId/termId links (owned vehicle; term on THIS policy — they were written verbatim) [#84, C247],
  fuel-stats "This/Last Month" now year-scoped (was getMonth()-only → a prior-year same-month fillup folded into "This Month" under a multi-year range) [#86, C262],
  toDateInputValue reads the LOCAL calendar date (was UTC .slice(0,10) → date-input off-by-one for negative offsets + broke the noon-local stored-date round-trip for positive offsets) [#87, C268; residual on the odometer-edit page swept + a committed no-utc-date-input source-scan guard added C271],
  create-or-replace financing left STALE cross-type fields when a vehicle's financing TYPE changed (lease↔loan) — update() skips undefined keys, so a loan row kept the prior lease's mileageLimit etc.; coalesce optional cross-type fields to null so the reused row mirrors a fresh create (sibling to the #67/C206/C240 reset) [#90, C293],
  lease-overage projection compared an ABSOLUTE odometer against a DRIVEN-miles budget → phantom excess fee by exactly initialMileage on any used-car lease (sibling to #64; +a translation-invariance property guarding the coordinate-space class C296) [#91, C295],
  extra-payment planner treated every 0%-APR loan as inert → "0 mos saved" for an interest-free loan an extra payment clearly shortens (bail early only for non-loans; 0%-APR loans run the amortization loop with rate 0) [#92, C297],
  merge-mode restore threw a raw UNIQUE-PK error on the always-present userPreferences/syncState collision instead of a clean conflict — detectConflicts probed 6 of the 15 inserted tables; added prefs/syncState probes + a drift-guard for the symmetry (C302) [#93, C300],
  settings store cleared a stale `error` on only 2 of 9 async ops → a succeeded retry kept showing a phantom error (masked today by the `&& !settings` UI gate); `error = null` on entry to all seven [#95, C308],
  idempotency middleware did `await c.res.clone().json()` UNCONDITIONALLY before caching → a 2xx NON-JSON body (CSV/binary/204) made .json() throw + escape → a SUCCESSFUL response became a 500; gate 2xx first + try/catch the parse, leaving a non-JSON 2xx uncached [#96, C315],
  three financing date projections (calculatePaymentDate / calculateNextPaymentDate / calculatePayoffDate-lease) advanced months via bare Date.setMonth(getMonth()+n), which rolls a day-of-month overflow into the FOLLOWING month (Aug 31 + 1mo → Oct 1 not Sep 30; May 31 + termMonths → the month after the intended lease end) → a payment/payoff/lease-end date displayed in the wrong month for any 29th–31st contract; extracted the shared addMonthsClamped helper (the clamp calculatePayoffDateFromStart already used inline) + routed all three through it [#99, C330, sibling of #90/#91/#92],
  an offline fuel fill-up logged with "missed previous fill-up" checked silently DROPPED the flag on sync — OfflineExpense lacked the field, offlineExpenseToBackend didn't map it, both ExpenseForm offline call sites omitted it (the form collects it + the online path sends it), so calculateAverageMpg paired the missed fill-up across the unlogged gap → garbage MPG; added missedFillup to OfflineExpense + the mapper + both call sites [#101, C339, same offline-field-dropout family as #66],
  a CSV-import vehicle name shared by two cars ("year make model" with no unique constraint) silently misattributed every row to the LAST-seen match — buildImportPlan's name map did last-wins; made it collision-aware (ambiguous→null) + a clear per-row "use distinct nicknames" error via the extracted resolveImportVehicleId [#102, C344],
  an S3 storage-provider created with an incomplete config (no endpoint/bucket/region — createProviderSchema's config is shape-open) persisted a broken 201 row + auto-populated storageConfig, then threw on EVERY use; fail-fast at create in resolveProviderCredentials [#103, C349],
  a tag containing the CSV-export delimiter (';' or ',' — export joins with '; ', import splits on /[;,]/) round-trip-split into multiple tags on export→re-import; reject those chars in a tag at the write boundary via a shared tagElementSchema [#104, C352],
  Google Photos uploadBytes (the one Photos call bypassing authedFetch) threw a flat NETWORK_ERROR on a 401, so an expired/revoked token was retried as a transient network flake instead of surfacing AUTH_INVALID; mirror authedFetch's 401/403→AUTH_INVALID mapping [#105, C356],
  the expense-list date-range filter excluded an expense logged on the chosen END day — filterExpenses compared `new Date(expense.date) <= new Date(endDate)` but the DateRangePicker binds a date-only 'YYYY-MM-DD' (→ midnight UTC), so a noon-local-stored expense on the end day fell outside; parse bounds as LOCAL calendar days with an inclusive (next-local-midnight-exclusive) end [#106, C358, the #87/#39 off-by-one family],
  fastForwardPastNow left a bounded reminder ACTIVE when its endDate fell in the period straddling now — the `nextDue > endDate` check ran only at the top of `while (nextDue <= now)`, so the final advance that steps PAST now and exits was never tested against endDate, leaving is_active=1 with a future nextDue (fires again next trigger); mirror the in-loop guard once after the loop, before the write [#107, C362, the bug #12 family on fast-forward's exit boundary],
  buildSeasonalEfficiency inflated a season's fillupCount by N for a single split fuel fillup — it counted every category='fuel' row, but a split fuel expense creates one sibling per vehicle with volume=null (queryFuelExpenses has no volume filter), so count only volume-bearing rows like computeAverageCosts/#56 + the fuel-stats COUNT/C97 already do [#108, C367, the #56/#18/C97 split-sibling overcount class],
  updateExpenseSchema dropped the both-or-neither sourceType/sourceId refine the create schema has (.refine() doesn't survive .partial()/.omit()) — a PUT could persist an asymmetric source link (only one of the pair), skewing source-bucketed analytics + mis-/never-triggering the financing cascade-delete cleanup; re-add the refine to the update schema [#109, C372, the #62/#34 within-tenant integrity class],
  calculateLeaseMetrics over-reported the projected excess-mileage fee for a lease stored with NO endDate — endDate is nullable, and the fallback derived the end as startDate + termMonths×30 days (~0.4 days short/month → a 36-mo lease ended ~16 days early → understated daysRemaining → inflated the burn rate → inflated the fee); derive via addMonthsClamped (real calendar months, the helper calculatePayoffDate already uses) [#110, C374, money-facing NORTH_STAR #1],
  ExpenseForm's ERROR-FALLBACK offline-save (online create throws → catch → save offline) dropped missedFillup — the #101 fix landed on the offline-first save path only, not the sibling catch-path addOfflineExpense, so a fuel fill-up logged "missed previous" during a create failure synced as normal → calculateAverageMpg pairs across the gap → garbage MPG; carry the missedFillup spread on the error path + a source-scan guard pinning every addOfflineExpense site carries missedFillup AND fuelType [#111, C377, the #66/#101 offline-field-dropout class at the call-site layer],
  buildDayOfWeekPatterns overcounted fillupCount + skewed avgCost/avgVolume for a split fuel fillup — it counted every category='fuel' row unconditionally, but a split fuel expense creates one sibling per vehicle with volume=null (queryFuelExpenses has no volume filter), so count only volume-bearing rows like buildSeasonalEfficiency/#108 + computeAverageCosts/#56 already do [#113, C390, the #56/#18/C97/#108 split-sibling overcount class on the day-of-week sibling builder],
  mark-serviced re-arm ignored endDate — the time-axis advance wrote a forward nextDueDate but never checked endDate, so a bounded reminder serviced AFTER its end was re-armed + left is_active=1 (lives past its end, fires again); mirror the trigger-service fastForwardPastNow guard — if the advanced date crosses endDate, deactivate the whole reminder [#114, C394, the #107/bug-#12 endDate family on the mark-serviced path],
  PaymentMetricsGrid's "Mileage Overage" card compared LIFETIME driven miles against the bare ANNUAL mileageLimit while the sibling LeaseMetricsCard scales by the term — two contradicting figures on one screen, the grid inflated ~Nx; extracted leaseTotalMileageAllowance (annual × termMonths/12) + a pure calculateLeaseOverage, routed both cards through it [#115, C398, the #64/#110 annual-vs-total class on the overage card],
  the reminder catch-up loop's NATURAL exit (under the 12-occurrence cap) left a bounded reminder active past endDate — the in-loop guard only inspects nextDue ≤ now, but the FINAL advance steps past now and exits untested, so a bounded reminder whose endDate falls between its last in-window occurrence and that final advance stayed is_active=1 (inflates recurring-cost run-rate); consolidated to ONE post-loop deactivation guard covering both the in-loop break and the natural exit [#116, C399, the #107/#114 bug-#12 endDate family on a THIRD path],
  a CLAIM photo broke backup/restore — validateReferentialIntegrity's photo entity-type map omitted insurance_claim (a real photo-upload target), so a backup carrying a claim photo failed validation → valid:false → the WHOLE restore aborted (the user couldn't recover ANY data from their own valid backup); add insurance_claim→claimIds to the map [#C404, C404, NORTH_STAR #1 crown-jewel hard round-trip failure the C366 15-table cert predated],
  a 0%-APR loan in the Payment Planner showed "0 mos / $0 saved" — computePlannerState fed minimumPayment (=0 for a 0%-APR loan, calculateMinimumPayment returns null) as the baseline paymentAmount, so the baseline amortization tripped the negative-am guard → 0 months → monthsSaved 0; baseline = minimumPayment>0 ? minimumPayment : financing.paymentAmount [#117, C405, the #92 0%-APR symptom re-manifested at the planner layer],
  the split-expense CREATE schema's tags bypassed the #104 separator-rejection (a bare z.array(z.string()) vs the regular boundaries' tagElementSchema) — a split tag `road; trip` round-tripped into two tags via CSV export/import; lifted tagElementSchema into validation.ts as ONE source of truth, routed the split schema through it [#118, C408, the #104/C352 class on the boundary that fix missed],
  a plug-in hybrid's CHARGE sessions (kWh in volume → ~mi/kWh) contaminated the gas-MPG analytics — computeEfficiencyPoint accepts electric rows, so they polluted mpgValues (mislabeled mi/gal) across 5 aggregators; extracted gasEfficiencyPoint (null for an electric current row), routed all 5 through it, cost-per-mile stays all-energy (C378) [#119/#122, C411/C413, the C353 gas/charge isolation missed on the analytics path],
  OfflineExpenseCards rendered a RAW ISO date string ({expense.date}) instead of formatDate — the offline-first save stores a full ISO timestamp, so the pending/synced cards showed `2024-03-15T17:00:00.000Z`; wrap both sites in formatDate [#120, C410, eyes-on offline-state-blocked],
  PUT /providers/:id wrote body.config verbatim with NO provider-type validation while CREATE fail-fasts an incomplete S3 config — editing an S3 provider to a config missing endpoint/bucket/region persisted a bricked row that threw on every later use; extracted validateStorageProviderConfig, shared by CREATE + PUT [#123, C416, the #103/C349 footgun on the UPDATE path],
  normalizeDecimal corrupted a US-format number with BOTH separators (1,234.56 → stripped dots → 1.23456, a ~1000x money under-count via the US Fuelly preset) — it hard-assumed comma-decimal; the decimal separator is whichever appears LAST (handles EU 1.234,56 + US 1,234.56) [#124, C417, money-facing, distinct from the product-gated #24],
  PUT /expenses/:id skipped the financing-source verification POST enforces — a forged {sourceType:financing, sourceId:<arbitrary>} link persisted + corrupted the displayed loan balance (computeBalance sums that exact predicate); extracted assertFinancingSourceValid, shared by POST + PUT [#125, C422, the #62/#109 within-tenant integrity class on the UPDATE path],
  the CONVERTED/trend analytics efficiency builders (computeConvertedEfficiencyValues, buildConvertedEfficiencyTrend, getFuelEfficiencyTrend, buildConvertedFuelEfficiencyComparison) used computeEfficiencyPoint not gasEfficiencyPoint — a PHEV's charge mi/kWh contaminated the gas-MPG average (worse on the converted path: convertEfficiency mis-converts mi/kWh as mi/gal); routed all 4 through gasEfficiencyPoint [#126, C427, the C413 sweep's missed repository twin],
  replace-mode restore wipe is NON-ATOMIC with the insert — bun-sqlite's async-tx callback doesn't roll back a thrown insert (the C151 footgun), so a mid-restore failure leaves the account WIPED (total data loss); MITIGATED C428 by pre-validating cross-row uniqueness (dup clientId/licensePlate rejected before the wipe), the GENERAL atomicity fix ESCALATED [#127, C428, HIGH data-safety, the transaction-semantics fix is a direction call],
  reminderApi.getMaterializedExpenses returned RAW backend-shaped rows typed as Expense[] — the one expense read that skipped fromBackendExpense, so a consumer reading expense.amount got undefined + an electric charge's kWh stayed in volume (latent: the T6 consumer is unbuilt); map through fromBackendExpense like every other read [#128, C431, FE→BE seam type-lie],
  PUT /expenses/:id wrote a stray mileage onto an ALREADY-non-fuel row when category wasn't resent — clearFuelFieldsIfNotFuel keyed off updateData.category (undefined → no-op), so the stray mileage persisted + poisoned getCurrentOdometer cross-category (wrong reminder firing + inflated lease-overage money); key the clear off the EFFECTIVE finalCategory [#130, C434, the #76/C244 third leg],
  ReminderForm read stored ISO dates via a bare UTC `.slice(0,10)` while the save path persists at noon-local (dateOnlyToISO) — for a UTC+13/+14 user the date silently shifted back a day every edit-open; route both reload lines through toDateInputValue + extend the no-utc-date-input source-scan guard to catch the bare-string-field form [#131, C437, the #87/#106 date family],
  sync-manager checkForExistingExpense returned RAW backend rows (expenseAmount, un-split volume) → serverExpense.amount was undefined → determineConflictType mis-classified a genuine duplicate as 'modified' EVERY time + the resolve dialog showed a blank server amount; map the GET rows through fromBackendExpense [#133, C442, the #128 class on the fuzzy-conflict path],
  merge-restore detectConflicts didn't probe `reminders` (userId-owned, own id PK, NOT FK'd to vehicles) → a surviving vehicle-less reminder (the #97 state) in a backup hit a raw UNIQUE-constraint throw mid-restore instead of a clean conflict; add the reminders probe [#132, C441, the #93/C300 raw-UNIQUE-throw class on a third table],
  an orphaned backoff retry could RESURRECT an already-resolved sync conflict — retrySingleExpense guarded only on onlineStatus, never re-checking still-pending, so a timer scheduled on an earlier failed POST re-listed a conflict the user already resolved; early-return when getPendingExpenses() no longer contains the row [#134, C445, sync-conflict-resolution deep-review],
  the activity middleware armed the inactivity timer ONLY for enabled-ZIP providers (.some(p.enabled)) — NARROWER than the orchestrator's filterEnabledProviders (s.enabled || s.sheetsSyncEnabled), so a Sheets-only-sync user got NO auto-backup-on-inactivity (silent, while changeTracker still marked data changed); route the middleware through filterEnabledProviders [#136, C446, NORTH_STAR #1 silent-backup-loss],
  CSV import persisted stray fuel-only fields on a NON-fuel imported row — parseRow parsed mileage/volume for every category + importExpenses inserts verbatim (no clearFuelFieldsIfNotFuel), so a foreign-tracker odometer on a maintenance row poisoned getCurrentOdometer; extracted clearImportedFuelFields [#137, C448, the #76/C244 class's import write site — closes all 4 #76 sites],
  InsuranceTermForm (+ ClaimsSection sibling) stored term/claim dates at UTC-midnight (raw "YYYY-MM-DD" → z.coerce.date()) → displayed a day early for Americas users; route save through dateOnlyToISO + reload through toDateInputValue + generalize the source-scan guard to the `.split('T')[0]` form [#138, C449, the #87 class — closes all date-only forms],
  a 0%-APR loan (apr===0, schema .min(0)-valid) was silently excluded from /analytics/financing loanBreakdown by a truthy `&& f.apr` filter → the Interest-vs-Principal chart rendered nothing for an actively-paid-down 0% loan; drop the clause [#139, C453, the #92/#117 0%-APR class — closes all 3 sites])
  all landed C155–C453. Recurring lesson the loop keeps re-finding (C181/C182/C185/C229):
  a green test that RE-IMPLEMENTS or RECONSTRUCTS a module's logic locally is NOT real coverage — drive the real module
  (C229: the two photo "property" tests only drove a reference model, never the real setCoverPhoto, which was also
  getDb-singleton-bound and thus untestable via a constructed repo until switched to this.db.transaction).
- Pending an Angelo decision (filed, NOT auto-fixed — each changes a displayed $/HTTP behavior or is a
  product call). TWO HIGHs, both in the Google Sheets backup path: **#36** (writes `USER_ENTERED` →
  formula injection + silent round-trip corruption; ARCC-consult before fixing), **#37** (non-atomic
  in-place rewrite that can destroy the only good copy). Plus the backup-honesty pair **#43** (a ZIP-fail-
  but-Sheets-ok run is marked success + won't retry) + **#44** (HTTP 200 when all providers fail) — both
  ARCC-grounded C144.5 as the SAX-04 fail-open pitfall, direction = surface failure honestly. Lower-sev:
  **#45** (period-scoped totalMileage/costPerMile) + the "Current Mileage card" semantics call; #19 (TCO
  trend scope), #24 (CSV decimal separator), #21-shrink, #51 (term-less active policy count), #53 (endDate
  inclusivity server-TZ-conditional, UTC-mitigated), **#69** (a monthly-only insurance term shows in analytics
  but is absent from TCO — escalated C210: materialize monthlyCost×term-months / N monthly rows / analytics-only),
  **#79** (a malformed fuel offline entry is stuck in the outbox forever, silently re-skipped — drop+toast / failed-bucket / confirm-the-form-blocks-it),
  **#85** (fuel-stats "This/Last Year" is range-relative not calendar-year — the sibling month fields are now true calendar months after #86/C262, so this is purely the YEAR row: calendar-YTD / relabel "This/Last Period" / hide-on-non-year-range; #9-rename class),
  **#88** (a SPLIT recurring-expense reminder naming a DELETED vehicle leaves a partial/inconsistent group every trigger — expenseSplitConfig is a JSON blob, NOT FK-cascade-cleaned like the junction, so the deleted vehicle's leg FK-violates [the C151 async-tx rollback footgun leaves the surviving leg]; found+escalated C288 — drop+renormalize on vehicle-delete / deactivate / single-vehicle fallback),
  **#94** (BROADENED to a CLASS C328: the fleet-wide analytics SUMMARY + fuel-advanced builders pool UNIT-BEARING quantities across vehicles WITHOUT per-vehicle conversion — distance + cost/distance [the original, C301], volume gal+L + fillupDetails [C328], and efficiency mi/gal+km/L via buildMonthlyConsumption/buildSeasonalEfficiency/buildVehicleRadar/buildDayOfWeekPatterns; 6 members verified firsthand C328 vs getCrossVehicle's correct convert-before-pool contrast. So a mixed mi+km/gal+L fleet shows garbage pooled scalars on the headline view; per-vehicle charts + getCrossVehicle convert, the summary builders don't; found+escalated C301, broadened+re-escalated C328, characterization-pinned distance C301 + volume C328 — the fix is one coherent thread-units-into-builders change: convert-to-user-global / per-vehicle-only / require-vehicleId. The C328 fan-out also certified per-vehicle calculateVehicleStats CLEAN).
  **#97** (a reminder linked to ONLY the deleted vehicle is left vehicle-less but still active — reminder_vehicles.vehicleId is onDelete:cascade, so the junction row drops but the reminder row survives is_active with zero vehicles, skipped 'no_vehicles' every trigger forever, no user signal; same family as #88 but the junction-cascade mechanism; found+escalated C318, characterization-pinned — deactivate / delete / surface-in-needs-attention / block-delete-of-sole-target).
  **#100** (userPreferences writes are an un-serialized read-modify-write — PUT /settings getOrCreate→JS-merge→update + the same at 5 sites incl. the two provider-cleanup helpers — so concurrent edits lost-update-clobber a sibling config; the #82 per-provider merge fixed the within-request wipe but not the across-request interleave; found+escalated C338, architecture-gated [optimistic-version+migration / transactional-merge vs the C151 async-tx footgun / serial-queue / accept-as-single-user-deployment-non-issue]; NO test added — a timing test would be flaky, the #82 sequential merge is pinned).
  **#112** (DESIGN-gated, LOW — CrossVehicleTab colors series via `CHART_COLORS[i % 5]` but only 5 `--chart-N` design tokens exist, so a fleet of ≥6 vehicles reuses --chart-1 → two chart lines share a color; found+escalated C383; reachable [VROOM is multi-vehicle; #94 fleet=6] but the fix is a palette/design call: extend the palette with a11y-safe tokens / generate HSL hues for N>5 / accept-as-limitation — NOT self-invented).
  **CSV-apostrophe round-trip** (DATA-CONTRACT direction call, escalated C401 — NOT a clean fix): a user value typed as `'`+a formula-trigger char (`'=mc2`, a nickname `'=Daily`) round-trips LOSSY (export's neutralizeCsvCell only escapes a LEADING trigger; import's denormalizeCsvCell strips `'` when char-2 is a trigger). A single-`'` sentinel can't disambiguate user-`'=` from export-escaped-`'=`; the only invertible scheme reinterprets hand-authored leading-`'` foreign CSVs (flips the deliberate "preserve apostrophe-led description" import contract) → optimize VROOM-own-export vs foreign-import faithfulness is Angelo's call. C401 fixed the false doc claim + pinned the actual lossy behavior (characterization test), gated the fix on the decision.
  **#30 realistic-MPG band divergence** (escalated C419): the outlier filter is [5,100] gas / [1,10] electric in analytics-charts (documented) but an inline `mpg > 0 && mpg < 150` (no min, no electric band) in calculations.ts/vehicle-stats.ts — so the SAME car's outlier pair shows a different average on the per-vehicle stats card vs the Analytics Fuel Stats card. Unifying changes a displayed number + picks a canonical band (recommend [5,100]/[1,10]). C419 guard-pinned the real analytics band; awaiting the band pick.
  **#127 restore-atomicity** (HIGH data-safety, escalated C428): replace-mode restore's wipe+insert isn't atomic — bun-sqlite's async-tx callback doesn't roll back a thrown insert (the C151 footgun), so a mid-restore failure leaves the account WIPED. C428 MITIGATED the reachable trigger (pre-validate cross-row uniqueness before the wipe); the GENERAL fix (a synchronous-tx restructure / codebase-wide async-tx-safety wrapper — every `async (tx)` shares the footgun) is the direction call.
  **#129 OAuth-login email-sync** (MED, data-integrity, found+filed C433 on an auth deep-review — loop-fixable but a product nuance): the OAuth login callback (updateExistingUserProfile, auth/routes.ts:176) OVERWRITES users.email with the provider's reported email on EVERY login; the UNIQUE-collision branch is correct but a within-account email drift (the user changed their GitHub/Google primary email → next login silently changes their VROOM login email) is silent. Bounded (no cross-user takeover — collision handled). The fix is a 1-line product call: don't sync on login / sync only if unset / surface a "your email changed" notice. Queued in the bug list awaiting the steer.
  **#135 SyncManager never reaps synced rows** (LOW, hygiene/growth, found+filed C445 — a reaping-lifecycle behavior call): syncAll + resolveConflict only markExpenseAsSynced (row stays in localStorage), never removeOfflineExpense/clearSyncedExpenses (the legacy syncOfflineExpenses reaps; SyncManager doesn't). No correctness impact (getPendingExpenses filters !synced — the #134 fix relies on it) — purely unbounded localStorage growth. Fix is a behavior call: reap after a successful syncAll / keep a short history / leave as-is.
  **#140 LeaseMetricsCard annual-vs-total** (MED-HIGH, money/UX, found+filed C453 — clean one-edit but eyes-on verification): LeaseMetricsCard.svelte:34/48/66 compare LIFETIME driven miles against the bare ANNUAL mileageLimit → "24000/12000, 100% RED" while the same card's "left" figure (routes through leaseTotalMileageAllowance) says "12000 left" — an internal contradiction + false over-mileage panic on an on-pace multi-year lease. The #64/#110/#115 annual-vs-total class on the ONE card #115 missed. Fix = route the 3 display lines through leaseTotalMileageAllowance (already exported); deferred because verification is eyes-on (Playwright-blocked) — do it in a UI-work cycle / alongside a screenshot pass.
  (CLOSED since the last refresh: #132 restore-reminders-probe [C441], #133 sync-conflict fromBackendExpense [C442], #134 conflict-resurrection [C445], #136 sheets-only auto-backup [C446], #137 import-fuel-clear [C448], #138 insurance-form UTC-date [C449], #139 0%-APR loanBreakdown [C453] — all landed, see the fix list above. The #76 odometer-poison class is now closed across all 4 write sites; the #87 UTC-date family across all forms; the #92/#117 0%-APR class across all 3 sites.)
  See `loop/BACKLOG.md` bug queue for the full list + grounding.
