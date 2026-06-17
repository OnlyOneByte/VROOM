# Requirements Document

## Introduction

The Offline Entries feature lets a user create and edit VROOM records while their
device has no network connection, then transparently syncs those records when
connectivity returns. VROOM is already a PWA (installed to the home screen, launched
standalone), so users reasonably expect to log a fill-up at a gas station with poor
signal and have it "just work."

This feature introduces a client-side **outbox**: a durable IndexedDB queue of pending
write operations (create/update/delete) that the app drains in the foreground whenever
the device is online. It deliberately does **not** rely on the Background Sync API
(unsupported on iOS Safari and Firefox); sync is driven by the running app. The scope
of the first iteration is **expense entries** (the highest-frequency write and the one
users most often make in the field), with the outbox designed to generalize to other
record types (odometer readings, etc.) later.

The existing `frontend/static/sw.js` contains stale, never-wired Background-Sync
scaffolding that posts to a defunct `/api/vehicles/{id}/expenses` path. That dead code
is replaced by this design.

## Glossary

- **Outbox**: The client-side IndexedDB-backed queue of pending write operations awaiting
  sync to the backend. Survives reloads, tab close, and app restart.
- **OutboxOp**: A single queued operation — `{ id, kind, entityType, payload, clientId, status, attempts, createdAt, lastError }`.
- **ClientId**: A client-generated UUID assigned to a created entity so the optimistic UI
  and the eventual server record can be reconciled (idempotency key).
- **OptimisticEntity**: A locally-rendered record (e.g. an expense) that exists in the UI
  before the server has confirmed it, tagged with a `pending` sync state.
- **SyncEngine**: The foreground module that observes connectivity, drains the Outbox in
  order, applies backoff on failure, and reconciles server responses into local state.
- **Online/Offline signal**: A reactive boolean derived from `navigator.onLine` plus the
  browser `online`/`offline` events, surfaced app-wide.
- **OfflineIndicator**: The persistent UI affordance showing connectivity state and the
  count of unsynced operations.
- **Expense_API_Service**: The existing frontend `expenseApi` in `expense-api.ts`, the
  write path that the Outbox wraps.
- **Idempotency key**: The `ClientId` sent on create requests so a retried POST does not
  create a duplicate server record.

## Requirements

### Requirement 1: Connectivity Awareness

**User Story:** As a user, I want the app to know when I am offline, so that my actions
are queued instead of failing.

#### Acceptance Criteria

1. THE Online/Offline signal SHALL initialize from `navigator.onLine` on app load.
2. WHEN the browser fires an `online` or `offline` event, THE Online/Offline signal SHALL
   update reactively and app-wide within one tick.
3. WHEN the device is offline, THE OfflineIndicator SHALL be visible and clearly communicate
   offline status.
4. WHEN there are unsynced operations in the Outbox, THE OfflineIndicator SHALL display the
   count of pending operations regardless of connectivity state.
5. WHEN the device is online and the Outbox is empty, THE OfflineIndicator SHALL be either
   hidden or show a neutral "all synced" state (per the design decision in design.md).

### Requirement 2: Offline Expense Creation

**User Story:** As a vehicle owner at a gas station with no signal, I want to log a fill-up
and have it saved, so that I do not lose the entry.

#### Acceptance Criteria

1. WHEN a user submits a valid expense while offline, THE app SHALL enqueue an OutboxOp of
   kind `create` and immediately render the expense as an OptimisticEntity with `pending`
   sync state, without showing an error.
2. WHEN an expense is created offline, THE app SHALL assign it a ClientId (UUID) used as the
   idempotency key on the eventual create request.
3. WHEN the device returns online, THE SyncEngine SHALL POST the queued create and, on
   success, replace the OptimisticEntity's ClientId with the server-assigned ID and clear
   the `pending` state.
4. WHEN a user creates an expense while online, THE app SHALL still route the write through
   the Outbox so the create and online paths share one code path (online = an Outbox that
   drains immediately).
5. THE OptimisticEntity SHALL be visually distinguishable (e.g. a "pending sync" badge) from
   confirmed entities until the server confirms it.

### Requirement 3: Offline Edit and Delete

**User Story:** As a user, I want to edit or delete an entry while offline, so that the app
behaves consistently regardless of connectivity.

#### Acceptance Criteria

1. WHEN a user edits an entity while offline, THE app SHALL enqueue an OutboxOp of kind
   `update` and reflect the change optimistically in the UI.
2. WHEN a user deletes an entity while offline, THE app SHALL enqueue an OutboxOp of kind
   `delete` and optimistically remove it from the UI.
3. WHEN multiple OutboxOps target the same entity (by ClientId or server ID), THE SyncEngine
   SHALL apply them in enqueue order so the final server state matches the user's last action.
4. WHEN an entity created offline (still only a ClientId) is edited or deleted before its
   create has synced, THE SyncEngine SHALL coalesce or sequence the ops so no operation
   references a non-existent server record (see design.md "Op coalescing").

### Requirement 4: Sync, Retry, and Failure Handling

**User Story:** As a user, I want my queued entries to sync reliably and not silently vanish
on transient failures.

#### Acceptance Criteria

1. WHEN the device transitions from offline to online, THE SyncEngine SHALL begin draining
   the Outbox automatically.
2. WHEN the app loads and the Outbox is non-empty and the device is online, THE SyncEngine
   SHALL drain the Outbox on startup.
3. WHEN a queued op fails with a transient/network error, THE SyncEngine SHALL retain the op,
   increment its attempt count, and retry with exponential backoff.
4. WHEN a queued op fails with a permanent error (e.g. 4xx validation), THE SyncEngine SHALL
   mark the op `failed`, surface it to the user for manual resolution, and NOT block other ops.
5. WHEN a create op is retried after a network timeout where the server may have already
   processed it, THE backend SHALL use the Idempotency key to avoid creating a duplicate.
6. THE SyncEngine SHALL drain the Outbox in FIFO order and SHALL NOT lose ordering across
   reloads.

### Requirement 5: Durability

**User Story:** As a user, I want my offline entries to survive closing the app, so that I do
not lose data logged in a dead zone.

#### Acceptance Criteria

1. THE Outbox SHALL persist to IndexedDB so queued ops survive page reload, tab close, and
   app restart.
2. WHEN IndexedDB is unavailable, THE app SHALL degrade gracefully (surface that offline
   queueing is unavailable) rather than crash or silently drop writes.
3. THE Outbox SHALL retain successfully-synced ops only long enough to reconcile, then prune
   them so the store does not grow unbounded.

### Requirement 6: Backend Idempotency

**User Story:** As a developer, I want create requests to be idempotent, so that client
retries cannot create duplicate records.

#### Acceptance Criteria

1. WHEN a create request includes an Idempotency key, THE backend SHALL persist that key with
   the created record.
2. WHEN a create request arrives with an Idempotency key that matches an already-processed
   request, THE backend SHALL return the original created record (200/201) instead of creating
   a second record.
3. THE idempotency mechanism SHALL be scoped per user so keys cannot collide across users.

### Requirement 7: Non-Regression and Scope Boundary

**User Story:** As a maintainer, I want the offline feature to not destabilize the existing
online flows.

#### Acceptance Criteria

1. WHEN the device is online, the user-visible latency and behavior of creating/editing an
   expense SHALL be equivalent to today (optimistic render + immediate drain).
2. THE stale Background-Sync code in `frontend/static/sw.js` SHALL be removed and replaced by
   the foreground SyncEngine.
3. THE first iteration SHALL implement offline support for **expenses** only; the Outbox and
   SyncEngine SHALL be structured so additional entity types can be added without rework.
4. THE route-smoke E2E harness SHALL continue to pass, and a new E2E SHALL prove the
   offline→online expense round-trip.
