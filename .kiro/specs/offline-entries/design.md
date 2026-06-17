# Design Document — Offline Entries

## Overview

Offline support is implemented as a **foreground outbox + sync engine**, not via the
Background Sync API. Rationale: Background Sync is unsupported on iOS Safari and Firefox,
and VROOM's users are cross-platform PWA installers. A foreground engine driven by the
running app and `navigator.onLine` works everywhere, is testable in Playwright, and keeps
all logic in TypeScript rather than the untyped `sw.js`.

The write path is inverted: today the UI calls `expenseApi.createExpense()` directly. After
this change, the UI enqueues an **OutboxOp**, optimistically updates local state, and the
**SyncEngine** drains the queue. When online, the queue drains in milliseconds, so the
online experience is unchanged (Req 7.1). When offline, ops accumulate durably in IndexedDB
and drain when connectivity returns.

```
 UI (expenses/new) ──enqueue──▶ Outbox (IndexedDB) ──drain──▶ expenseApi ──▶ backend
        │                            ▲                            │
        └──optimistic render─────────┘       reconcile (clientId→serverId)
```

## Architecture

### New frontend modules

| Module | Path | Responsibility |
|---|---|---|
| `outbox.ts` | `frontend/src/lib/offline/outbox.ts` | IndexedDB CRUD for OutboxOps (enqueue, list, update status, prune). Single object store `outbox`, keyed by op `id`. |
| `sync-engine.ts` | `frontend/src/lib/offline/sync-engine.ts` | Drains the outbox FIFO, applies backoff, reconciles responses, emits events. Idempotent + reentrancy-guarded. |
| `connectivity.svelte.ts` | `frontend/src/lib/offline/connectivity.svelte.ts` | Reactive `$state` online/offline signal from `navigator.onLine` + `online`/`offline` events. |
| `offline-store.svelte.ts` | `frontend/src/lib/offline/offline-store.svelte.ts` | Reactive view of pending-op count + per-entity pending state for the UI to read. |
| `OfflineIndicator.svelte` | `frontend/src/lib/components/layout/OfflineIndicator.svelte` | The persistent connectivity/queue affordance. |

### Modified modules

- `expense-api.ts` — gains a thin `createExpenseViaOutbox` path; the raw `createExpense`
  becomes what the SyncEngine calls.
- Expense create/edit pages — call the outbox path; render optimistic + pending badge.
- `+layout.svelte` — mount `OfflineIndicator`, init connectivity, kick the SyncEngine on
  startup and on `online`.
- `frontend/static/sw.js` — **delete** the dead `syncOfflineExpenses` / IndexedDB helpers;
  keep the network-first navigation fetch handler.

### Backend

- Idempotency: accept an `Idempotency-Key` header (or `clientId` field) on
  `POST /api/v1/expenses`. Persist a per-user `(userId, idempotencyKey) → expenseId` mapping;
  on a repeat key, return the existing record. Smallest implementation: a nullable unique
  `client_id` column on `expenses` with a unique index on `(user_id, client_id)`, and an
  upsert-or-return in the repository. (See DatabaseMigrations.md for the additive-migration
  rule — this is a nullable column + index, fully backward compatible.)

## Data Model

### OutboxOp (IndexedDB, store `outbox`)

```ts
interface OutboxOp {
  id: string;            // op UUID (primary key)
  kind: 'create' | 'update' | 'delete';
  entityType: 'expense'; // generalizes later
  clientId: string;      // entity's client UUID (idempotency key for create)
  serverId?: string;     // set once known (update/delete of synced entities)
  payload: unknown;      // the create/update body; undefined for delete
  status: 'pending' | 'in-flight' | 'failed';
  attempts: number;
  createdAt: number;     // enqueue time, for FIFO ordering
  lastError?: string;
}
```

### Backend additive migration

```
ALTER TABLE expenses ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX expenses_user_client_idx ON expenses(user_id, client_id) WHERE client_id IS NOT NULL;
```

Partial unique index so existing rows (NULL client_id) are unaffected — matches the schema-v2
indexing approach already in `schema.ts`.

## Sync algorithm

1. Trigger: app startup (if online + non-empty), `online` event, or post-enqueue (if online).
2. Reentrancy guard: a module-level `draining` flag prevents concurrent drains.
3. Take the oldest `pending` op (FIFO by `createdAt`). Mark `in-flight`.
4. Dispatch by kind via `expenseApi`. For `create`, send `clientId` as the idempotency key.
5. On success: reconcile (map `clientId`→`serverId` in local state, clear pending badge),
   delete the op, continue.
6. On transient failure (network/5xx): mark `pending`, `attempts++`, stop the drain, schedule
   a backoff retry (`min(30s, 2^attempts * 1s)` + jitter).
7. On permanent failure (4xx validation): mark `failed`, surface in the indicator, skip it,
   continue with the next op.

### Op coalescing (Req 3.4)

Before dispatch, ops are normalized so they never reference a non-existent server record:
- `create` then `update` of the same `clientId` while still offline → fold the update into the
  create payload (single create with final values).
- `create` then `delete` of the same `clientId` while still offline → drop both ops (net no-op).
- `update` then `update` → keep the latest payload.

---

## UI / UX design decisions — **NEED SIGN-OFF**

These are the user-facing choices. My recommendation is marked ✅; alternatives listed.

### D1. Offline indicator placement & style
- ✅ **Recommended:** a slim, persistent status pill in the existing app header/nav. Neutral
  (hidden or tiny "✓ synced") when online+empty; amber **"Offline — N pending"** when offline
  or queue non-empty; a spinner while draining. Non-blocking, always visible, mobile-friendly.
- Alt A: a toast that appears only on transition (less discoverable; pending count gets lost).
- Alt B: a full-width banner under the header (more prominent, costs vertical space on mobile).

### D2. Optimistic entity affordance
- ✅ **Recommended:** render the new/edited expense immediately in the list with a subtle
  "pending sync" badge (clock icon + muted styling). It looks real because it is real — it
  just hasn't been confirmed server-side.
- Alt: hold optimistic entries in a separate "pending" section. (Clearer separation, but
  fragments the timeline and feels less "it just worked.")

### D3. Conflict resolution policy
- ✅ **Recommended for v1: last-write-wins (LWW), client wins.** Because each entity is owned by
  a single user and sharing is not yet implemented (ranked item #9), true multi-writer conflicts
  effectively cannot occur in v1. The queued op is the user's latest intent; apply it. Idempotency
  keys prevent duplicate creates; updates/deletes target a stable server ID. Revisit when Sharing
  lands (that spec will add real conflict handling — e.g. updated-at precondition / 409 merge UI).
- Alt: server-wins / precondition-failed prompts. Rejected for v1 as over-engineered for a
  single-writer model and a worse offline UX (prompts the user can't resolve while offline).

### D4. What is offline-capable in v1
- ✅ **Recommended: expenses only** (create/edit/delete). Highest-frequency field write; smallest
  blast radius; proves the outbox. Odometer/insurance/etc. follow once the pattern is proven.
- Alt: all entity types at once. Rejected — larger surface, more conflict edge cases, slower to
  ship and verify.

### D5. Failed-op recovery UX
- ✅ **Recommended:** failed ops (permanent 4xx) surface in the indicator with a "Review" action
  that opens a small list; user can retry or discard each. Transient failures retry silently with
  backoff and never need user attention.
- Alt: auto-discard failed ops after N attempts. Rejected — silent data loss is the one thing
  this feature exists to prevent.

### D6. Photos on offline expenses
- ✅ **Recommended for v1: defer.** Offline expense *fields* queue; an attached photo is held as a
  Blob in the op payload and uploaded after the expense create confirms (a follow-up op). If the
  Blob is too large for comfortable IndexedDB storage, prompt the user that the photo will upload
  when back online. (Flag if you'd rather fully exclude photos from v1 offline — simpler still.)

---

## Testing strategy

- **Unit (Vitest, fast-check):** outbox FIFO ordering, coalescing rules (create+update,
  create+delete, update+update), backoff schedule, reconcile mapping.
- **Backend (bun test):** idempotency — same `client_id` twice returns one record; different
  users with the same key don't collide.
- **E2E (Playwright, `*.meshclaw.e2e.ts`):** use `context.setOffline(true)` to (1) create an
  expense offline → assert pending badge + queue count, (2) `setOffline(false)` → assert the
  entry reconciles and the badge clears, (3) reload while offline → assert the queued op
  survived (durability). Add to `route-smoke` only the new indicator's no-error guarantee.
- **Screenshot:** `shot.mjs` of the offline indicator in each state for visual review.

## Migration / rollout notes

- The backend `client_id` column is additive + nullable → no data migration, no downtime.
- Deleting the dead `sw.js` sync code requires users' old service workers to update; the
  network-first nav handler and `skipWaiting()`/`clients.claim()` already force prompt updates.
- No feature flag needed: online behavior is unchanged; offline is purely additive.
