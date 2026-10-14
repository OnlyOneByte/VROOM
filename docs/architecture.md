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
`src/api/<domain>/` holding `routes.ts` (HTTP + Zod validation) and `repository.ts` (data
access). Domains mount at `/api/v1/<domain>` in `src/app.ts`.

Repositories extend `BaseRepository` (`src/utils/repository.ts`) and are exported as
singletons. There is no DI container — a repository takes a Drizzle handle in its
constructor, which is what lets tests pass an in-memory database.

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
file, not touching call sites. Backups go through `backup-strategies/` behind
`backup-strategy.ts`, and `sync/backup-orchestrator.ts` fans out to every enabled provider.

Auto-sync is inactivity-driven: the activity middleware marks data changed, and when a user
goes idle long enough `sync/activity-tracker.ts` triggers the enabled backups. The trigger
keys off *changes*, so an idle user with no edits costs nothing.

## Frontend

### Layering

`route/page → component → store → service → apiClient`.

- `services/api-client.ts` is the only place raw `fetch` appears. Everything else goes
  through a domain service (`expense-api.ts`, `vehicle-api.ts`, …).
- `services/api-transformer.ts` owns every backend↔frontend shape conversion. Reads that skip
  it get raw column names and the wrong units — route all of them through it.
- `stores/` holds cross-route state (app, auth, offline, settings). Component-local state
  stays in the component.

`src/lib/routes.ts` centralizes route paths; navigation goes through `resolve()` from
`$app/paths` so the app works under any base path.

### Conventions

Svelte 5 runes only — `$state`, `$derived`, `$effect`, `$props`; no `$:` and no
`$app/stores`. UI primitives come from shadcn-svelte under `lib/components/ui/`, which is
upstream-managed and not edited by hand. Colors are semantic tokens (`text-foreground`,
`bg-background`, `chart-1`–`chart-5`), never raw hex, so theming and dark mode work
everywhere at once.

Expense categories are a closed set: `fuel`, `maintenance`, `financial`, `regulatory`,
`enhancement`, `misc`.

Full conventions, including the Svelte 5 decision trees, are in `.kiro/steering/`.

### Offline

The PWA accepts writes while offline. Entries are queued locally with a client-generated
`client_id`, and the backend's idempotency middleware dedupes on it, so replaying a queued
write after a flaky reconnect can't create a duplicate.

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
