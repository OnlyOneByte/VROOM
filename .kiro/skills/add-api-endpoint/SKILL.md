---
name: Add API Endpoint
description: Step-by-step guide for adding a new API domain with routes, repository, frontend service, types, and tests.
---

# Add API Endpoint

Use this skill when adding a new API domain (e.g. trips, reminders) or endpoints to an existing one.

The per-file patterns live in `.kiro/steering/APIConventions.md` — route and repository templates,
validation, typed errors, response shape, ownership checks, the frontend seam. This skill is the
*order*, plus the cross-cutting files that are easy to miss.

## Adding a New Domain

### 1. Backend domain directory

```
backend/src/api/<domain>/
├── routes.ts
├── repository.ts
├── validation.ts   # optional — schemas too complex for routes.ts (trips, reminders, insurance)
├── hooks.ts        # optional — cross-domain side effects (financing, insurance)
└── __tests__/
```

### 2. Database table (if needed)

Use the `add-db-table` skill. A new table carries its own migration and backup/restore
obligations that a route change does not.

### 3. Repository

`repository.ts`: extend `BaseRepository<Entity, NewEntity>`, take `AppDatabase` (never
`BunSQLiteDatabase`), export a singleton bound to `getDb()`. Any method taking `userId` must scope
its query by it, and a destructive delete keys on both `id` and `userId`.

### 4. Routes

`routes.ts`: `requireAuth` then `changeTracker` on `'*'`, `zValidator()` on every input, typed
errors from `errors.ts`, `{ success: true, data }` responses. Export as `routes`.

### 5. Mount

`backend/src/app.ts` — **not** `index.ts`, which only adds runtime side effects (migrations, sync
worker, signal handlers) around the app `app.ts` builds.

```typescript
import { routes as domainRoutes } from './api/<domain>/routes';
app.route('/api/v1/<domain>', domainRoutes);
```

### 6. Frontend service

`frontend/src/lib/services/<domain>-api.ts`: an exported object of methods over `apiClient`
(`get`, `post`, `put`, `patch`, `delete`, `getPaginated`, `raw`). `get` unwraps `data` and throws
`ApiError`; `getPaginated` keeps the whole `{ data, pagination }` envelope. Services are grouped by
frontend domain, so they need not map 1:1 to route groups.

### 7. Frontend types

`frontend/src/lib/types/<domain>.ts`, re-exported from the `types/index.ts` barrel — one file per
domain, declared there rather than inline in the barrel. If the wire shape differs from the frontend
type, put the mapping in `frontend/src/lib/services/api-transformer.ts` and route every read *and*
write through it; returning a raw wire row typed as the frontend type is a type lie.

### 8. Backup/restore (new table only)

Follow "Adding a Table to the Backup" in `.kiro/steering/BackupRestore.md`. Committed drift guards
fail by name on each list you miss — run `bun test src/api/sync src/api/providers`.

### 9. Tests

Route tests drive the real app through the `createTestApp()` harness
(`backend/src/test-helpers/http-client.ts`) — `<domain>-http.test.ts` for routes,
`repository.test.ts` for repo queries, `<module>.property.test.ts` for fast-check invariants.
Conventions in `.kiro/steering/Testing.md`.

Then `bun run validate` in `backend/` and `npm run validate` in `frontend/`.

## Adding Endpoints to an Existing Domain

Zod schema → route handler → repository method (if new data access) → frontend service method →
types → tests.

## Verification Checklist

- [ ] Repository extends `BaseRepository`, takes `AppDatabase`, exports a singleton
- [ ] Every `userId`-taking repository method scopes its query by it
- [ ] Routes apply `requireAuth` + `changeTracker` and `zValidator()` every input
- [ ] Mounted in `app.ts` at `/api/v1/<domain>`
- [ ] Ownership verified before the repository call on every write
- [ ] Frontend service goes through `apiClient`; types in `types/<domain>.ts` and the barrel
- [ ] Backup/restore lists updated (if new table)
- [ ] Migration generated and tested (if schema changed)
- [ ] `bun run validate` and `npm run validate` pass
