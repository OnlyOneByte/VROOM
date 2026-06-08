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
3. VERIFY    Backend:  cd backend  && mise exec -- bun run validate
             Frontend: cd frontend && mise exec -- npm run type-check && npm run build
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

### Hard rules (inherited from .meshclaw-autopilot/LOOP.md)
- Work ONLY in `/local/home/angryang/.meshclaw/workspace/VROOM`. Never commit to `main`;
  branch as `autopilot/<task>` or `feat/<task>` off latest `origin/main`.
- All node/bun commands run under `mise exec --` (node22+bun scoped via `mise.local.toml`;
  do not touch the global mise node18).
- Git network ops need `env -u GIT_SSH_COMMAND` (sandbox injects a `-F /dev/null` that
  ignores `~/.ssh/config`). Commit identity: `OnlyOneByte` / the noreply email.
- Stage ONE short path per `git add` (multi-path add trips the permission engine).
- **Biome CLI can't run on this aarch64 AL2 host (GLIBC too old).** Apply Biome fixes by
  hand from the rules in `CodeQualityRules.md`; CI is the lint source of truth.
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
For the live snapshot (branch, what's done, what's next, open gaps) read **`STATUS.md`**
in the repo root — it's kept current each cycle and is the fastest way to orient.
Highlights as of the offline-entries branch:
- Reminders `/reminders` route is **built and wired** (the old "route missing" gap is closed).
- Offline-entries foundation (client_id idempotency + migration 0001 + outbox sync) is committed.
- Remaining gaps: full in-process backend HTTP test harness needs a DB-injection refactor
  (the `const sqlite = new Database(...)` singleton binds at import); screenshot visual-diffing
  is capture-only (no baseline comparison yet); storage-backup-toggle E2E needs an OAuth
  provider (not headless-feasible).
