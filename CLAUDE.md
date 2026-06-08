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
- Two feature specs are signed off (backend-first, one `tasks.md` task per loop cycle):
  - `.kiro/specs/maintenance-schedule/` (mileage+time service-interval reminders) is **mid-build**:
    backend nearly done — T1 (additive mileage columns), T2 (`getCurrentOdometer`), T3 part 1 (the
    nullable-date rebuild migration 0004 + partial mileage dedup index), and T3 part 2 (the
    whichever-comes-first mileage trigger pass: emits a mileage notification when
    `getCurrentOdometer >= nextDueOdometer`, no auto-re-arm) all shipped. The trigger engine is
    **dormant** until **T4** wires routes + validation (no mileage reminder is API-creatable yet):
    `POST /:id/mark-serviced` re-arm (D3), Zod refinements (D4 single-vehicle), `recheckMileageReminders`
    on odometer write (D5), then the deferred `vehicle-stats.currentMileage` reconcile. Frontend
    (T6–T9) follows. Track progress in its `tasks.md`.
  - `.kiro/specs/import-trackers/` (Fuelly/Fuelio/Drivvo CSV via a mapping pre-pass over the
    hardened import pipeline) is **approved, not started** (T1+).
- Standing goal (TODO.md → Misc): raise test coverage to **90%** both sides (last-measured
  baseline in TODO.md: frontend ~59%, backend ~74% — the backend suite has grown to ~918 tests
  since, so treat these as a floor, not a current reading) — fold into bug/guard/arch cycles,
  don't regress it.
- Open gaps: full in-process backend HTTP harness needs a DB-injection refactor (the
  `const sqlite = new Database(...)` singleton binds at import); screenshot visual-diffing is
  capture-only (no baseline compare); storage-backup-toggle E2E needs an OAuth provider (not
  headless-feasible).
