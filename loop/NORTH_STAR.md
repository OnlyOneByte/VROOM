# NORTH STAR — VROOM

> The fixed point the autonomous loop steers toward. Read first, every cycle. Changes
> to this file are a **direction call** → flag Angelo, don't self-rewrite the vision.

## What VROOM is
A **self-hostable, privacy-first PWA for tracking the true cost of car ownership.** Fuel,
maintenance, insurance, financing, depreciation — unified into per-vehicle and
cross-fleet cost insight (TCO, $/mile, $/month). The user owns their data: storage
providers (photos + backups) are bring-your-own (Google Drive/Sheets/Photos, S3, …),
and the app runs offline-first as an installable PWA.

## Who it's for
A car owner (often multi-vehicle / a household) who wants honest, durable, portable
records — not a SaaS silo. Mobile is the primary surface (logging a fill-up at the pump);
desktop is for review and analytics.

## What "good" means here (the quality bar — every increment honors these)
1. **Data safety is sacred.** No silent loss. Backup/restore round-trips every table;
   destructive actions disclose their full cascade; offline writes never drop.
2. **Correct for everyone.** Currency- and unit-correct for non-USD / metric users;
   timezone-correct dates; cross-tenant isolation (a user never sees/writes another's data).
3. **Four-states + a11y + mobile-first.** Every surface handles loading / empty / error /
   data; passes axe; no mobile horizontal overflow. A green build is the FLOOR, not "done"
   — UI work needs an eyes-on screenshot.
4. **Compose, don't reinvent.** Use the kit (`/dev/gallery`, DesignSystem.md). One way to
   do a thing (e.g. `ConfirmDialog`, `formatCurrency`).
5. **Regression-proof under autonomous dev.** When a bug class is fixed, leave a
   merge-surviving guard (committed test / source-scan) so it can't silently return.

## Non-negotiable guardrails (from CLAUDE.md)
- Work only in this repo; branch `claude-loop-dev` off latest `origin/main`. **Never** commit/push to `main`; never force-push; human approves every merge.
- `mise exec --` for all node/bun; `env -u GIT_SSH_COMMAND` for git network ops; one path per `git add`.
- Verify before "done": backend `bun run validate`, frontend `npm run type-check && npm run build`, UI `regress.sh` + screenshot.
- Biome runs here via the **musl** binary (`node_modules/@biomejs/cli-linux-arm64-musl/biome`); the glibc one is dead. CI is the lint source of truth.

## How the loop steers (balance over greed)
Work is bucketed into categories (see BACKLOG.md). Each has a **starvation budget** — a
max number of cycles it may go untouched. If any category is over budget, the next
increment MUST come from the most-starved one; otherwise take the highest-leverage item.
This keeps features, reviews, guards, bugs, and infra all advancing — not just whatever's
shiniest.

## Where VROOM is going (horizon, not commitments)
Maintenance-schedule reminders (mileage/time intervals) · richer recurring expenses ·
import from other trackers (Fuelly/Fuelio/…) · trips & location · vehicle sharing /
multi-household · receipt OCR auto-fill · float→integer-cents money migration. These need
spec + design sign-off before build — draft, flag Angelo, move on.
