# Implementation Tasks — Offline Entries

> **Implementation note (2026-06-05):** On opening the code, most of the offline
> *plumbing* already existed — a localStorage outbox (`offline-storage.ts`), a
> `SyncManager` with retry/backoff/conflict handling (`sync/sync-manager.ts`), an
> `OfflineIndicator`, `OfflineExpenseCards`, and `ExpenseForm` offline branch, all
> wired into `+layout.svelte`. The real correctness gap was **idempotency**: sync
> sent no stable key, so a retried POST relied on a fragile fuzzy duplicate-check and
> could double-insert. This iteration closed that gap end-to-end (the highest-value,
> lowest-risk increment) and removed the dead `sw.js` Background-Sync code. Phases B/C/D
> below were already substantially present; checked items reflect what is now correct.

> Each task is independently verifiable. Backend tasks: `cd backend && mise exec -- bun run validate`.
> Frontend tasks: `cd frontend && mise exec -- npm run type-check && npm run build`.
> Feature E2E: `START_SERVERS=1 .meshclaw-tools/regress.sh` + the new offline spec.
> Do not start implementation until the D1–D6 UI/UX decisions in design.md are signed off.

## Phase A — Backend idempotency (unblocks reliable retries) ✅ DONE

- [x] A1. Added nullable `client_id` column to `expenses` + partial unique index
  `expenses_user_client_idx (user_id, client_id) WHERE client_id IS NOT NULL`. Migration
  `drizzle/0001_blushing_juggernaut.sql` generated (additive). _(Req 6.1, 6.3)_
- [x] A2. `ExpenseRepository.createIdempotent()` + `findByClientId()`: returns the existing row
  on a repeat `(userId, clientId)`, recovers from the insert race by re-reading. _(Req 6.2)_
- [x] A3. `clientId` accepted on the create Zod schema, omitted from update (create-only key),
  threaded through the POST route via `createIdempotent`. _(Req 6.1)_
- [x] A4. Tests: `idempotent-create.test.ts` (5 pass — dedup, original-wins, per-user isolation,
  no-key plain create, scoped lookup) + `migration-0001.test.ts` (4 pass — column, index, seed
  survival, NULL-tolerant uniqueness). _(Req 6.2, 6.3)_

## Phase B — Frontend offline core ✅ PRE-EXISTING (+ idempotency added)

- [x] B1. Connectivity signal exists: `stores/offline.svelte.ts` `onlineStatus` from
  `navigator.onLine` + `online`/`offline` listeners. _(Req 1.1, 1.2)_
- [~] B2. Durable outbox exists as **localStorage** (`offline-storage.ts`), not IndexedDB.
  Adequate for the current entry volume; IndexedDB migration deferred (logged below).
  Added `clientId` to `OfflineExpense` (v3 storage version) + backfill-on-load. _(Req 5.1)_
- [x] B3. `SyncManager` exists: retry w/ exponential backoff, conflict detection/resolution,
  auto-sync on `online`. Added `clientId` to both POST paths (sync + keep_local). _(Req 4.1–4.6)_
- [x] B4. Unit tests green: `offline-storage.test.ts` + `sync-manager.test.ts` (19 pass) updated
  for the clientId/v3 migration.

## Phase C — Expense write path ✅ PRE-EXISTING

- [x] C1. `ExpenseForm.svelte` already branches on `onlineStatus`: online → `expenseApi`,
  offline → `addOfflineExpense` (now auto-generates a `clientId`). _(Req 2.1–2.4)_
- [x] C2. Reactive pending state exists via `offlineExpenseQueue` + sync-state stores. _(Req 1.4)_
- [x] C3. Offline create path renders via `OfflineExpenseCards.svelte`. _(Req 2.1, 2.5)_

## Phase D — UI affordances ✅ PRE-EXISTING

- [x] D1. `components/sync/OfflineIndicator.svelte` exists and is wired in `Navigation`. _(Req 1.3–1.5)_
- [x] D2. Mounted via `+layout.svelte`; `syncManager.setupAutoSync()` kicks on startup + `online`. _(Req 4.1, 4.2)_
- [x] D3. `OfflineExpenseCards` / `SyncStatusInline` surface pending state. _(Req 2.5)_

## Phase E — Remove dead code + verify

- [x] E1. Removed the stale `syncOfflineExpenses` + IndexedDB/localStorage helpers (defunct
  `/api/vehicles/{id}/expenses` path) from `frontend/static/sw.js`; kept the network-first
  navigation fetch handler. _(Req 7.2)_
- [x] E2. Authored `offline-entries.meshclaw.e2e.ts` using `context.setOffline()`: queue offline →
  survive reload → drain via real syncManager → assert exactly one backend row → replay same
  clientId → assert no duplicate. **Needs a live server run to execute** (see Stage 5). _(Req 2.1, 4.1, 5.1, 6.2)_
- [ ] E3. Add the offline-indicator no-error guarantee to `route-smoke.meshclaw.e2e.ts`. _(Req 7.4)_
- [ ] E4. `shot.mjs` screenshots of the indicator states for visual review.
- [ ] E5. Photos-on-offline (D6): deferred — explicitly out of v1 scope (the offline branch
  drops `uploadPendingPhotos`; documented gap). _(design D6)_

## Phase F — Tick & advance

- [ ] F1. Check "Offline entries" off in `TODO.md`; update LOOP.md next item to "Sharing between
  people". Hand off branch for PR. _(Stage 5)_

## Deferred follow-ups (logged, not silently dropped)
- Outbox storage is localStorage, not IndexedDB (Req 5.2 graceful-degradation + large-volume
  durability). Fine at current scale; revisit if offline entry volume grows or Blobs are queued.
- Offline edit/delete (Req 3) and op coalescing (Req 3.4) are not implemented — the existing
  offline path covers **create** only. Tracked for a follow-up iteration.
- Photos on offline expenses (D6) deferred.
