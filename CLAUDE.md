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
  (re-measured C164, not an estimate): **backend 82.70% line / 82.5% func · frontend 70.18% line / 66.9%
  func / 62.9% branch** — backend steady ~82%; frontend climbed 65.3→70.2 since C138 under a sustained
  FE-guard ratchet (C118 memoize, C125 vehicle-form-validation, C130 formatters, C137 error-handling.ts,
  C143 api-client.ts, C149 expense-api.ts, C163 reminder-api.ts, C169 settings-api.ts). **The FE SERVICE
  layer is now 100% module-covered** (api-client + expense-api + reminder-api + settings-api + error-
  handling); the remaining FE gap is the **components/routes deficit** (largely eyes-on; prefer the few
  thin pure-`.ts`/`.svelte.ts`/store/util modules — e.g. pwa.ts ~56%, sync-manager.ts ~58%). Backend
  middleware trio all covered (idempotency C105, rate-limit C112, body-limit C156); the next BE low spot
  is `sync/routes.ts` (~32%; NOTE: `restore.ts` restoreFromSheets needs a process-global Sheets mock the
  sync suite avoids — see C163). loop-improvement #4 records a `cov:` tag on every LEDGER cycle entry.
  Suite size today: **~1211 backend tests / ~503 frontend** (a floor — grows most cycles). Don't regress
  coverage; name why if a cycle drops it.
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
  Plus the MED fixes #52/#55/#56/#48 (split-delete tenant-scope, amortization neg-guard, perFillup split
  inflation, odometer userId-scope) all landed C155–C168.
- Pending an Angelo decision (filed, NOT auto-fixed — each changes a displayed $/HTTP behavior or is a
  product call). TWO HIGHs, both in the Google Sheets backup path: **#36** (writes `USER_ENTERED` →
  formula injection + silent round-trip corruption; ARCC-consult before fixing), **#37** (non-atomic
  in-place rewrite that can destroy the only good copy). Plus the backup-honesty pair **#43** (a ZIP-fail-
  but-Sheets-ok run is marked success + won't retry) + **#44** (HTTP 200 when all providers fail) — both
  ARCC-grounded C144.5 as the SAX-04 fail-open pitfall, direction = surface failure honestly. Lower-sev:
  **#45** (period-scoped totalMileage/costPerMile) + the "Current Mileage card" semantics call; #19 (TCO
  trend scope), #24 (CSV decimal separator), #21-shrink, #51 (term-less active policy count), #53 (endDate
  inclusivity server-TZ-conditional, UTC-mitigated). See `loop/BACKLOG.md` bug queue for the full list +
  grounding.
