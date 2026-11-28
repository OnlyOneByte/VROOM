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

SQLite via `bun:sqlite` + Drizzle. Tables are defined once, in `src/db/sqlite/schema.ts`; `src/db/pg/schema.ts` builds their Postgres twins from it, and `src/db/schema.ts` exports the active dialect's tables under the same names (#1682). Migrations live in
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

**Async transactions (#1378): one connection, one transaction at a time.** The `bun:sqlite`
driver needs a synchronous transaction callback: an awaited statement inside it commits on its
own. Postgres and MySQL drivers are async only. The chosen path, prototyped in
`src/db/async-sqlite.ts`, keeps the single `bun:sqlite` connection and drives it through
Drizzle's async `sqlite-proxy` session:

- A transaction runs `BEGIN IMMEDIATE`, awaits its callback, then commits, or rolls back if the
  callback throws. Writes on both sides of an `await` are atomic.
- While a transaction is open, a query from any other async context waits until it ends, so
  nothing can join it or read its uncommitted rows. Code inside the transaction is recognised
  through `AsyncLocalStorage` and never waits.
- Transactions from different requests queue: SQLite has a single writer anyway. A
  `transaction()` (or `db.transaction()`) started inside an open one joins it through a
  savepoint. Nested transactions that run at once take turns, and the parent's own queries wait
  while one is open, so a failed savepoint only undoes its own writes. `db.batch` runs as a
  transaction, or as a savepoint inside one, so a failed batch leaves none of its rows.
- A query that still carries a transaction's context after it ended throws
  `TransactionEndedError` instead of committing on its own. Examples are an un-awaited write, or
  a `Promise.all` branch that outlives a failed sibling, or a nested transaction still queued
  when the callback returns. A transaction is sealed the moment its callback settles. Await
  every query inside the callback. Work that should outlive the transaction, such as a timer or
  a background job armed from inside it, starts through `outsideTransaction(fn)`. That includes
  a lazy query builder: it runs after the transaction ends, so never await it inside the
  transaction.
- SQLite rolls a transaction back by itself on some errors, such as disk full, I/O errors and
  `OR ROLLBACK`. The caller then gets that original error. If the callback catches it and carries
  on, every later statement throws `TransactionRolledBackError` instead of committing on its own.
- Keep awaits inside a transaction to database work. A slow `fetch` there makes every other
  query wait. Two waits deadlock:
  - awaiting a promise that another request started (such as a shared in-flight cache), when
    that request then needs the database;
  - a nested transaction awaiting a query its parent issued after the nested one opened, since
    the parent's queries wait for the nested transaction.

`src/db/__tests__/async-sqlite.test.ts` proves each of these properties, and removing either
the wait or the queue fails a test. Rows map the same as with the sync driver, Drizzle's
relational queries and raw SQL included. Builder queries read positional rows, so joined
tables that share a column name still map correctly. Raw `db.all(sql…)` and `db.get(sql…)`
return rows keyed by column name, and raw `db.values(sql…)` returns positional arrays. A raw
query that selects two columns with the same name keeps only the last, so alias them. Inside
`db.batch`, raw `all` and `get` still return positional rows, so keep raw SQL out of batches. App
code runs raw SQL through `rawAll` in `src/db/dialect`. The module keeps its own cache of 500 prepared
statements, because `bun:sqlite`'s `query()` cache holds only 20 and the app has hundreds of
distinct statements. Over 20,000 single-row selects cycling through 200 statement shapes, a
query took 32 µs through the proxy against 44 µs through the sync driver.

Two alternatives were rejected:

- **A second connection for each transaction:** `bun:sqlite` waits for a lock synchronously.
  While one connection holds the write lock, a write on the other freezes the event loop for up
  to `busy_timeout`, and with it the transaction it is waiting for, before failing with
  `SQLITE_BUSY`. The tests' plain `:memory:` database can't be shared either. A shared-cache
  memory database can be, but it locks per table and fails with `SQLITE_LOCKED` instead of
  waiting.
- **libsql:** this means a new native dependency and a driver swap for every query, for the
  same single-writer result. Reconsider it only if serialising transactions becomes a
  bottleneck.

On Postgres (#1635) the same `transaction(async (tx) => …)` signature maps onto the driver's
own pooled transaction, so call sites won't change again.

**One database handle (#1378).** All app code queries through the async session,
`appContext().asyncDb`, directly or through a repository, and every transaction runs on it.
Only `src/db/` holds the synchronous `bun:sqlite` handle: `getDb()` opens the connection,
migrations and the boot-time email fold run on it before the async session is used, and
connection upkeep runs through `upkeep(kind)`. `src/__tests__/sync-db-boundary.test.ts` fails
when a production file outside `src/db/` imports the sync driver, loads or re-exports a
`bun:sqlite` value (statically or with a dynamic `import()` or `require()`), names `AppDatabase`, mentions `getDb`
or reads `$client` (the context factory excepted), or takes a `db` off the app context. Tests may still open their own sync handle for fixtures.

Inside a transaction callback, use the transaction handle `tx`; outside it, use the async
session. Key rotation reads each batch and decrypts it before its write transaction opens, then
writes with a compare-and-set on the old ciphertext. A demo or sample garage is seeded in one
transaction, so a failed seed leaves none of it. Insurance writes check vehicle ownership inside
the transaction that writes, and a currency change rescales the owner's money and saves the new
currency in one transaction. A money write re-checks the owner's money scale inside the
transaction that saves it (`preferences.writeAtScale`), and refuses with a 409 if a currency
change committed after the request converted its amounts.

A read that gates a write runs inside the async transaction that does the write. An async
transaction opens with `BEGIN IMMEDIATE` and the session queues every other writer behind it,
so nothing can change the checked rows between the check and the write. A check made before
the transaction opens could pass on data that has changed by the time the write lands. The
share transitions in `src/api/shares/routes.ts` read the share, the owner and any per-person
grants inside their transaction; the role, assignment and override writes in
`src/api/roles/routes.ts` read the role, the vehicle owner, the target member and the row they
replace inside theirs; and `keepingARoleManager` counts role managers before and after the
change in the same transaction. An expense, trip or odometer write checks that the reading
fits between its neighbours (`assertOdometerInOrder`) inside its transaction, and a reminder
claims its period inside the transaction that creates the expense or notification. Each request's own permissions are still loaded once, before
its transaction opens (see "Permissions load, then check").

Inside an async transaction, await only database work. The transaction holds the write lock,
so a network call there stalls every other writer for as long as the call takes. Tests enforce
the network part of that rule: `src/test-helpers/transaction-guard.ts` refuses `fetch` and
outbound DNS lookups while a transaction is open, including stubs a test assigns over them, and
fails the test even when the code catches the error. `inAsyncTransaction()` in
`src/db/async-sqlite.ts` tells it when one is. Other slow awaits, such as file reads, are not
checked. Use `outsideTransaction` for work that must start inside one and outlive it.

Work started inside a transaction callback carries the transaction with it, because the
session tracks the open transaction through the async context. A fire-and-forget call made
there (a notification, activity tracking, a sync trigger) joins the transaction while it is
open, and is refused with `TransactionEndedError` once it has closed. Start such work after
the transaction returns, or hand it to `outsideTransaction`. Tests report every refused late
query through `reportLateQueries` and fail the test even when the code swallows the error.
Today the app's detached calls (the activity tracker in `changeTracker`, the sync worker and
community refresh timers, and the backup lock release) all start outside any transaction.
The guard has two limits. It cannot see detached work that runs while its transaction is still
open: that work joins the transaction, and if the transaction rolls back the work is lost
without a report. And its listener is process-wide, so a late query from a timer that fires
after its own test has finished fails whichever test is running then.

The role-manager count skips accounts still waiting for approval, so a role given to one can't
stand in for the last real role manager.

A backup reads one snapshot: `createBackup` in `src/api/sync/backup.ts` reads every table in one
deferred read transaction, and the Sheets mirror uses `createBackup` too. While it is open every
other query waits, so it holds only the reads; zipping, CSV writing and the Sheets upload happen
after it closes. On the seeded garage it is held for about 5 ms (median of 20 runs, 10 ms worst),
and with 10,000 extra expenses about 33 ms (82 ms worst).

Provider construction resolves its private-network policy on the async session:
`privateEndpointPolicyFor` in `src/utils/outbound-url.ts` is async, so building a storage
provider (`createProviderInstance`) and resolving model settings (`resolveModelSettings`) are
async too, and the provider create and photo backfill transactions run on the async session.

Restore runs its wipe and inserts in one async transaction (see
`docs/conventions/BackupRestore.md`).

**Permissions load, then check.** A request's resolver reads its grants on the async session
before anything is decided. `authorize()` calls `loadResolver(c, resources)` for the resources
it checks, and `requestResolver(c)` then hands out that same resolver, whose `can()` and
`rulesFor()` stay synchronous. A check on a scope nobody loaded throws `ScopeNotLoadedError`,
which the error handler answers with a 500, so a missed load fails closed and never allows.
Code that checks a vehicle the route didn't authorize (a list across cars, an expense moved to
another car, a reminder's other cars) calls `loadResolver` with those vehicles first; the
server scope is loaded with any load. Outside a request, `resolverFor(userId, resources)`
loads and returns a resolver. `src/permissions/__tests__/scope-loading.test.ts` sends a
request to every route in the permission route map as the owner, an editor, a viewer and a
stranger, and fails on any `ScopeNotLoadedError`. Its requests carry a placeholder id and a
minimal body, so they reach `authorize()` and the code before validation; checks deeper in a
handler are covered by that route's own tests, which fail on the same 500. The 500 response
carries a generic message, and the unloaded scope goes only to the server log.

A sync query issued while an async transaction is open would run inside it, so the async module
refuses one. It wraps the connection's `prepare`, `query`, `run`, `exec` and `transaction`, and any call that doesn't
come from the async session while an async transaction is open throws
`SyncQueryInAsyncTransactionError`. The guard can't see a statement prepared before the
transaction opened and run during it, so sync code must not hold prepared statements
(`sqlite.prepare`, Drizzle's `.prepare()`). Outside `src/db/` nothing can, since no app code
holds the sync handle.

Connection upkeep in `src/db/connection.ts` stays sync by design. The health check's
`SELECT 1` and the two WAL checkpoints run through `upkeep(kind)`, a fixed list of three
queries that the guard exempts, so it can't carry anything else. The checkpoints skip while
a transaction is open. The health check still runs then and its `SELECT 1` reads inside that
transaction, so a richer health query must not read data.

Raw `BEGIN`, `COMMIT`/`END`, `ROLLBACK`, `SAVEPOINT` or `RELEASE` through the async session
throws `RawTransactionControlError` at the moment `run`, `all`, `get` or `values` is called,
inside a callback or outside one, awaited or not. Leading whitespace, `;` and SQL comments
are skipped before the check, as SQLite skips them. Only `transaction()` opens and closes
transactions. Drizzle's internal `tx.session` is the one path past the call-time check, and
app code must not use it. A query sent that way is still checked when it runs, but an
un-awaited one could slip into the moment the callback settles.

A query runs in the scope that is current when it runs. When Bun has dropped that context,
it falls back to the scope it was built in. Bun drops the `AsyncLocalStorage` context when an
async callback returns an un-awaited query after an earlier `await` (#1786). So each scope
hands its builders, and the raw `run`/`all`/`get`/`values`, a session whose client re-enters
that scope when the context is gone.

What this means in practice:
- `return tx.select()…` and `return tx.all(sql…)` work.
- A query built inside a transaction but run after it ended is refused with
  `TransactionEndedError`, rather than committing on its own.
- Await any query you didn't build in the current callback. One built outside any
  transaction, or in a parent transaction, and returned un-awaited from a nested callback
  still waits on the transaction that is waiting for it.
- Don't cache a builder or a `.prepare()`d query made inside a transaction. It stays bound to
  that transaction and is refused once the transaction ends.
- `outsideTransaction` marks its work explicitly, so a query handed to it still runs outside.

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
- **vlm** — receipt parsing (Anthropic, Gemini, OpenAI-compatible), plus the built-in `local-ocr` text reader (tesseract.js on the server), used when no AI provider is set up or when it is picked as the default
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

`src/api/community/aggregator.ts` is the only code that combines different users' data into one result. It runs as a daily background job, started from `src/index.ts` next to the sync worker, and no request handler can reach it. It publishes a new release at most once per release period (`CONFIG.communityStats.releasePeriodMs`, 30 days); see Release cadence below. It loads opted-in owners' vehicles, plus their last 12 months of fuel and maintenance expenses and the insurance premiums whose term overlaps that window, through `repository.ts`, which selects only the columns the metrics need. It then computes one value per vehicle per metric using the analytics efficiency helpers, and keeps one value per owner per bucket.

Before a bucket is stored, the job enforces the privacy rules:

- n counts people: each owner contributes one value per bucket, the median of their vehicles in it;
- every bucket has a band `[lo, hi]` that comes only from public data, never from the bucket's own values:
  - **Fuel efficiency:** a petrol or electric model and year in `fuel-economy-ratings.json` uses 80% of its lowest to 120% of its highest fueleconomy.gov combined rating, and hybrids and unrated models use the wide plausible band for their unit. An efficiency outside the band is dropped.
  - **Running cost, maintenance and insurance:** the bands are set in US cents (`MONEY_BANDS_USD_CENTS`) and scaled to the bucket's currency with the approximate rates in `usd-rates.json` and the currency's minor unit. A money value outside the band still counts, clamped to the nearest edge. A currency with no rate gets no money buckets, and the comparison shows no data for it. The rates only size the bands, so change them rarely: an edit changes the bands, and every bucket in that currency draws fresh noise at the next release. An edit never adds a release, since it waits for the next one like any other change. A currency whose rate moves fast, such as TRY, slowly ends up with bands that are too narrow in real terms, and more of its values get clamped to the top edge. Review the table about once a year, and update only the rates that have moved by more than about 20%;
- running cost is fuel plus maintenance in the window over the distance between the lowest and highest readings in the window. Fill-ups at or below the lowest reading are left out, because they paid for distance driven before it;
- the count and the sum are noised separately, and everything published is computed from those two noisy numbers. No quantiles are published.

#### The release, and what it guarantees (#1591)

For one bucket with owner values `v₁ … vₙ` in `[lo, hi]`, each rounded to the unit's publish step, each release computes:

| Step | Formula | Budget |
|---|---|---|
| Noisy count | `ñ = n + Lap(1 / ε_c)` | `ε_c = 0.5` (a count changes by at most 1 when one person joins or leaves) |
| Threshold | publish only if `ñ ≥ T`, where `T = COMMUNITY_STATS_MIN_GROUP` (default 30, never below 20) | none: it only reads `ñ` |
| Noisy sum | `S̃ = Σ(vᵢ − lo) + Lap((hi − lo) / ε_s)` | `ε_s = 0.5` (each term lies in `[0, hi − lo]`) |
| Published | `n_published = 5·⌊ñ / 5⌋`, `mean = clamp(lo + S̃ / ñ, lo, hi)`, rounded to the unit's step | none: computed only from `ñ` and `S̃` |

- **Guarantee:** (ε = 1, δ) per bucket per release, where two datasets are neighbours when one person is added or removed. By basic composition the two Laplace releases add up to `ε_c + ε_s = 1`. The threshold and the rounding are post-processing. A change in one person's value that stays inside the band leaves the count alone and moves the sum by at most `hi − lo`, so it costs only `ε_s = 0.5`. A money value that leaves the band is clamped and stays in the bucket, so it costs the same. A fuel efficiency that leaves the band removes the person from the bucket, which costs the full 1.
- **Per person:** a person's vehicles in the same bucket count once, and each vehicle lands in at most one bucket per metric. Their total per release is the sum over the buckets they are in. One vehicle is in at most 4 (efficiency, running cost, maintenance, insurance), which gives at most (4, 4δ). Vehicles in different buckets add more. Across releases the total grows again for every bucket whose data changed, and releases are at least one release period apart, so a bucket has at most 13 in any year.
- **The δ term** covers the one case pure ε can't: a bucket that exists only because one person is in it. Without them nothing is published. With them, `ñ = 1 + Lap(2)` reaches `T` with probability `δ = ½·e^(−(T − 1)/2)`, which is about 2.5e-7 at `T = 30` and about 4e-5 at `T = 20`.
- **Sampler:** each draw is a 52-bit uniform strictly inside (0, 1), taken from HMAC-SHA256, and the Laplace value comes from the inverse CDF. The largest possible draw is about 36 scales, so cutting off the tail adds at most about 1e-16 to δ. Floating-point Laplace sampling has known small leaks; rounding to the publish step softens them.
- **Stable noise:** the uniform for a draw is `HMAC(k, bucket key | schema version, lo, hi, ε_c, ε_s | SHA-256(sorted, step-rounded owner values) | "count" or "sum")`. `k` is a random 256-bit key per scope in `community_noise_keys`, created on the first refresh and never exported or backed up. The same inputs always give the same draw, and the hash covers exactly the values the sum uses, so a reused draw only ever goes with an identical release. A bucket whose owners and rounded values haven't changed republishes the same numbers, and repeating that release costs nothing. Any change draws fresh noise, and that includes a change to the band or the budget. In practice an active bucket changes often: one of 30 or more owners logs a record, a record ages out of the 12-month window, or an insurance premium's pro-rated share moves by a publish step. So releases are mostly fresh draws, and the cost adds up with the number of releases, as the per-person line says. Anyone holding `k` together with the database could recompute the noise, but database access already exposes the raw data.
- **Accuracy:** the noise on the published mean is about `(hi − lo) / (ε_s · ñ)`. The compare API shows an average only when `(hi − lo) / (ε_s · n_published)` is at most 25% of it, and reports `not_enough_data` otherwise.
- **Release cadence:** a daily run releases only when no release exists yet, when the last one is at least `releasePeriodMs` old, or when stored rows have no member tags (rows from before tags existed). Otherwise it changes no published number: new records, new opt-ins, and changes to a band, a budget or `usd-rates.json` all wait for the next release, so a group's figures are fixed for the whole period. That run only withdraws. Each release stores, for every published bucket, a tag `HMAC(k, "member|" + owner id)` per owner in `community_release_members`. A run between releases deletes every bucket holding a tag that no longer belongs to an opted-in owner, which covers opting out and account deletion, so an opt-out still takes effect from the next daily run. A withdrawn bucket stays absent until the next release. Withdrawing publishes nothing new.

A release replaces the `scope='local'` rows and their member tags in one transaction. `GET /api/v1/community/compare` (`routes.ts`) only answers callers who have opted in. It computes the caller's own values with the same `vehicleSamples` function and looks up only rows with `n_published` at least `T` rounded down to a multiple of 5.

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
