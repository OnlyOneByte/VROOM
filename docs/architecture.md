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

Composed in `src/app.ts`, in this order: error handler → body limit (10MB) → secure headers
(CSP, HSTS, `X-Frame-Options`) → optional auth (`/api/*` only) → rate limiter → CORS → CSRF
→ request logging → activity tracking.

Optional auth runs *before* the rate limiter on purpose: it populates the user context, so
authenticated callers are rate-limited per user instead of sharing an IP bucket.

### Authentication

Lucia sessions over HTTP-only cookies, established by OAuth (Google, GitHub). `requireAuth`
rejects anonymous requests; `optionalAuth` only populates context. Every repository read and
write is scoped by `userId` — cross-tenant isolation is enforced in the data layer, not just
at the route.

### Errors

`AppError` is the base (500) with `ValidationError` (400), `AuthenticationError` (401),
`NotFoundError` (404), `ConflictError` (409), and `DatabaseError` (500). Sync and provider
failures use a separate `SyncError` carrying a `SyncErrorCode`
(`AUTH_INVALID`, `NETWORK_ERROR`, `QUOTA_EXCEEDED`, `PERMISSION_DENIED`, `VALIDATION_ERROR`,
`CONFLICT_DETECTED`, `SYNC_IN_PROGRESS`), so callers can tell a revoked token from a
transient network blip and avoid retrying what will never succeed.

### Database

SQLite via `bun:sqlite` + Drizzle. Schema is one file, `src/db/schema.ts`. Migrations live in
`backend/drizzle/` and run on startup via `drizzle-orm/bun-sqlite/migrator`; `bun run db:init`
applies them locally. Do not use `drizzle-kit push` against a real database — it diffs the
schema directly and will offer to drop columns.

The fourteen migrations that predate `0000_baseline` were collapsed into it, so the journal no
longer describes the path any pre-collapse database took. A database created before the collapse
cannot migrate forward in place; it has to be re-created and repopulated from a backup restore.
Collapsing also closed two defects the incremental chain carried: the money columns were still
declared `real` (the cents conversion rewrote values but never the types, and SQLite's loose typing
hid the disagreement with `schema.ts`), and `expenses.created_by` had no `ON DELETE` action, so
once account deletion shipped it would have refused to delete any user who had logged an expense on
a vehicle shared with them.

PRAGMAs set in `src/db/connection.ts`: WAL journaling for concurrent reads, `synchronous =
NORMAL`, `foreign_keys = ON`, a large page cache, and `wal_autocheckpoint`. A timer
checkpoints the WAL periodically, plus forced checkpoints on startup and shutdown, so the
`.db` file a user copies out is never missing recent writes.

**Expense-linked records use a polymorphic link.** Financing payments, insurance premiums,
and reminder materializations are real rows in `expenses` tagged with `source_type` +
`source_id` rather than per-feature boolean columns or separate tables. One query path serves
all of them, and analytics can bucket by source without knowing which features exist.

### Providers and sync

Everything the user brings their own account for sits under `src/api/providers/domains/`,
one registry per capability:

- **storage** — Google Drive, Google Photos, S3-compatible, plus a fake for tests
- **vlm** — receipt parsing (Anthropic, Gemini, OpenAI-compatible)
- **llm** — the assistant (same three, plus tool-calling)

Each domain defines a provider interface and a registry; adding a vendor means adding one
file, not touching call sites. Backups go through the `BackupStrategy` interface and registry
in `src/api/sync/`, implemented under `src/api/providers/backup-strategies/` (Google Drive
today), and `src/api/sync/backup-orchestrator.ts` fans out to every enabled provider.

Auto-sync is inactivity-driven: a per-domain `changeTracker` middleware marks data changed on
each successful write, the global activity middleware arms the inactivity timer, and when it
elapses `src/api/sync/activity-tracker.ts` triggers the enabled backups. The orchestrator
no-ops when nothing changed since the last sync, so an idle user with no edits costs nothing.

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

| Decision | Rationale |
|---|---|
| SQLite over Postgres | Single file, no server to run or secure, trivially backed up — right for self-hosting one household |
| WAL mode | Readers don't block the writer, which matters because analytics queries are wide |
| Hono on Bun | Small, fast, first-class TypeScript, no transpile step |
| Repository singletons, no DI framework | Less indirection to trace; constructor-injected DB handle is all testing needs |
| Side-effect-free `app.ts` | Lets the real app run in-process against an in-memory DB, so route tests exercise real middleware |
| Polymorphic `source_type`/`source_id` | New expense-generating features add no columns and no query paths |
| Provider registries per capability | A new storage or model vendor is one file; call sites stay untouched |
| Svelte 5 runes | Finer-grained reactivity and less ceremony than stores-everywhere |
| shadcn-svelte | Accessible primitives you own in-tree, no component-library lock-in |
| layerchart over raw D3 | Svelte-native, so charts are components rather than imperative DOM code |
