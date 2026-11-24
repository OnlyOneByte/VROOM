# Architecture

VROOM is a monorepo: a Bun/Hono REST API over SQLite, and a SvelteKit PWA that consumes it.

```
Browser (SvelteKit PWA)
    ↓ REST /api/v1/* (JSON, cookie auth)
Hono backend (Bun)
    ↓ Drizzle ORM
SQLite (WAL mode)
    ↓ optional, user-configured
Storage providers — Google Drive / Sheets / Photos, S3-compatible
```

This document covers the shape and the reasoning. For layout, read the tree: directory
names and file names are the index, and they change more often than prose does.

## Backend

### Layering

`middleware → routes → repository → Drizzle → SQLite`, one folder per domain under
`src/api/<domain>/` holding `routes.ts` (HTTP + Zod validation) and, for whatever data access
the domain has, one or more `*repository.ts` — usually `repository.ts`, sometimes split
(`insurance/claims-repository.ts`, `photos/photo-ref-repository.ts`) and sometimes owning no
table at all (`analytics/repository.ts` only aggregates). Domains mount at
`/api/v1/<domain>` in `src/app.ts`.

Every repository takes a Drizzle handle in its constructor and is exported as a singleton.
There is no DI container — that constructor handle is what lets tests pass an in-memory
database. Many extend `BaseRepository` (`src/utils/repository.ts`) for
findById/create/update/delete; the rest only ever need their own queries.

`src/app.ts` builds the app with **no side effects** — no migrations, no timers, no server
start. `src/index.ts` adds those for the real process. That split is what makes the whole
backend drivable in-process from tests via `app.request()`.

### Middleware order

Composed in `src/app.ts`, in this order: error handler → body limit (10MB; 50MB for the
backup restore upload) → secure headers (CSP, HSTS, `X-Frame-Options`) → optional auth
(`/api/*` only) → rate limiter → CORS → CSRF → request logging → activity tracking.

Optional auth runs _before_ the rate limiter on purpose: it populates the user context, so
authenticated callers are rate-limited per user instead of sharing an IP bucket.

### Authentication

Lucia sessions over HTTP-only cookies, established by OAuth (Google, GitHub). `requireAuth`
rejects anonymous requests; `optionalAuth` only populates context. Every repository read and
write is scoped by `userId` — cross-tenant isolation is enforced in the data layer, not just
at the route.

### Errors

`AppError` is the base (500) with `ValidationError` (400), `AuthenticationError` (401),
`NotFoundError` (404), `ConflictError` (409), `UnprocessableEntityError` (422), and
`DatabaseError` (500). Sync and provider failures use a separate `SyncError` carrying a
`SyncErrorCode` (`AUTH_INVALID`, `NETWORK_ERROR`, `QUOTA_EXCEEDED`, `PERMISSION_DENIED`,
`CONFLICT_DETECTED`, `SYNC_IN_PROGRESS`), so callers can tell a revoked token from a
transient network blip and avoid retrying what will never succeed.

### Database

SQLite via `bun:sqlite` + Drizzle. Schema is one file, `src/db/schema.ts`. Migrations live in
`backend/drizzle/` and run on startup via `drizzle-orm/bun-sqlite/migrator`; `bun run db:init`
applies them locally. Do not use `drizzle-kit push` against a real database — it diffs the
schema directly and will offer to drop columns.

Migrations start from a single `0000_baseline`. A database created before that baseline cannot
migrate in place; the deployment guide covers how to move one forward.

PRAGMAs set in `src/db/connection.ts`: WAL journaling for concurrent reads, `synchronous =
NORMAL`, `foreign_keys = ON`, a large page cache, and `wal_autocheckpoint`. A timer
checkpoints the WAL periodically, plus forced checkpoints on startup and shutdown. A copy of
`vroom.db` taken while the backend runs must include its `-wal` and `-shm` files, or it can miss
recent writes.

**Expense-linked records use a polymorphic link.** Financing payments, insurance premiums,
and reminder materializations are real rows in `expenses` tagged with `source_type` +
`source_id` rather than per-feature boolean columns or separate tables. One query path serves
all of them, and analytics can bucket by source without knowing which features exist.

**An insurance term is in force on every calendar day from its start date through its end
date, in the user's time zone** (the request's `timeZone`, UTC without one). The backend has
one definition in `src/api/insurance/in-force.ts`: `isTermInForce` for rows already loaded and
`termInForceAt` for SQL. Analytics premium totals, the active-policy count and Fleet Health's
insurance coverage all use it, so a term still counts on its last day, as the Insurance page
shows it. One difference is deliberate: the Insurance page's `isPolicyInForce`
(`frontend/src/lib/utils/insurance.ts`) lists a policy as active while any term has not ended,
so a policy whose only term starts next month is active there but covers and costs nothing in
analytics until that start date.

### Providers and sync

Everything the user brings their own account for sits under `src/api/providers/domains/`,
one registry per capability:

- **storage** — Google Drive, Google Photos, S3-compatible, plus an in-memory fake for tests and local development
- **vlm** — receipt parsing (Anthropic, Gemini, OpenAI-compatible)
- **llm** — the assistant (same three, plus tool-calling)

Each domain defines a provider interface and a registry; adding a vendor means adding one
file, not touching call sites. Backups go through the `BackupStrategy` interface and registry
in `src/api/sync/`, implemented under `src/api/providers/backup-strategies/`: a generic ZIP
strategy for any storage provider (S3-compatible, fake), and a Google Drive strategy that adds
the Sheets mirror. `src/api/sync/init.ts` registers each storage type's strategy from its
descriptor's features (the Drive strategy when `backupSheets` is set, ZIP otherwise), and
`src/api/sync/backup-orchestrator.ts` fans out to every enabled provider. An enabled provider
whose type has no strategy is marked failed rather than skipped, so the run ends `failed`, or
`partial` when another provider succeeded. Photo-only types (`features.photoOnly` on the
storage descriptor) get no strategy, offer no ZIP backup, and the orchestrator ignores any
backup settings left on them.

Every provider is a `ProviderDescriptor` (`src/api/providers/descriptor.ts`): label, config
schema and field specs, secret names, connect kind, availability and features.
`GET /api/v1/providers/catalog` serves the available descriptors as JSON (storage, the two
model capabilities, and the built-in import formats, which `GET /expenses/import/formats`
still lists for the import dialog), and the frontend
reads labels, fields and features from it (`lib/stores/provider-catalog.svelte.ts`). The
frontend keeps only what can't travel as JSON, an icon and an optional custom form per id, in
`PROVIDER_UI`; a test checks every backend storage id has an entry.
Every provider also passes the contract kit for its capability
(`backend/src/test-helpers/provider-contracts/`: storage, model, auth and descriptor), run by
`provider-contracts.test.ts` and `auth-provider-contracts.test.ts`; both fail when a registry
entry has no contract subject.

Auto-sync is inactivity-driven: a per-domain `changeTracker` middleware marks data changed on
each successful write, the global activity middleware arms the inactivity timer, and when it
elapses `src/api/sync/activity-tracker.ts` triggers the enabled backups. The orchestrator
no-ops when nothing changed since the last sync, so an idle user with no edits costs nothing.

### Community stats

`src/api/community/aggregator.ts` is the only code that reads more than one user's rows. It runs as a daily background job, started from `src/index.ts` next to the sync worker, and no request handler can reach it. It loads opted-in owners' vehicles and the last 12 months of their expenses through `repository.ts`, which selects only the columns the metrics need. It then computes one value per vehicle using the analytics efficiency helpers, and keeps one value per owner per bucket.

Before a bucket is stored, the job enforces the privacy rules:

- n counts people, and a bucket is published only when that count, rounded down to a multiple of 5, is at least K (10, or `COMMUNITY_STATS_MIN_GROUP`);
- quartiles are published only from 20 people;
- implausible values are dropped first;
- Laplace noise from a cryptographic source is scaled to the rounded count, then the values are rounded.

The write replaces the `scope='local'` rows in one transaction. `GET /api/v1/community/compare` (`routes.ts`) only answers callers who have opted in. It computes the caller's own values with the same `vehicleSamples` function and looks up only rows with `n_published >= K`.

## Frontend

### Layering

`route/page → component → store → service → apiClient`.

- `services/api-client.ts` is the only place app code calls the global `fetch`. Everything
  else goes through a domain service (`expense-api.ts`, `vehicle-api.ts`, …).
- `services/api-transformer.ts` owns the expense shape conversion — `expenseAmount` →
  `amount`, and the backend's single `volume` column split into `volume` or `charge` by fuel
  type. An expense read that skips `fromBackendExpense` gets raw column names and loses the
  electric split, so route all of them through it.
- `stores/` holds cross-route state (app, auth, offline, settings, theme). Component-local
  state stays in the component.

`src/lib/routes.ts` centralizes route paths; navigation goes through `resolve()` from
`$app/paths` so the app works under any base path.

### Conventions

Svelte 5 runes only — `$state`, `$derived`, `$effect`, `$props`; no `$:` and no
`$app/stores`. UI primitives live under `lib/components/ui/`; the ones pulled from the
shadcn-svelte registry (`components.json`) are upstream-managed and not edited by hand.
Colors are semantic tokens (`text-foreground`, `bg-background`, `chart-1`–`chart-8`), never
raw hex, so theming and dark mode work everywhere at once.

Expense categories are a closed set: `fuel`, `maintenance`, `financial`, `regulatory`,
`enhancement`, `misc`.

Full conventions, including the Svelte 5 decision trees, are in `docs/conventions/`.

### Offline

The PWA accepts writes while offline. Entries are queued locally with a client-generated
`client_id`, and the create route inserts idempotently on `(user_id, client_id)` — backed by
a partial unique index — so replaying a queued write after a flaky reconnect returns the
original row instead of creating a duplicate.

## Key design decisions

| Decision                               | Rationale                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SQLite over Postgres                   | Single file, no server to run or secure, trivially backed up — right for self-hosting one household |
| WAL mode                               | Readers don't block the writer, which matters because analytics queries are wide                    |
| Hono on Bun                            | Small, fast, first-class TypeScript, no transpile step                                              |
| Repository singletons, no DI framework | Less indirection to trace; constructor-injected DB handle is all testing needs                      |
| Side-effect-free `app.ts`              | Lets the real app run in-process against an in-memory DB, so route tests exercise real middleware   |
| Polymorphic `source_type`/`source_id`  | New expense-generating features add no columns and no query paths                                   |
| Provider registries per capability     | A new storage or model vendor is one file; call sites stay untouched                                |
| Svelte 5 runes                         | Finer-grained reactivity and less ceremony than stores-everywhere                                   |
| shadcn-svelte                          | Accessible primitives you own in-tree, no component-library lock-in                                 |
| layerchart over raw D3                 | Svelte-native, so charts are components rather than imperative DOM code                             |
