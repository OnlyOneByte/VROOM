# Backend API Conventions

## Domain Structure

```
api/<domain>/
├── routes.ts        # Hono routes, Zod schemas, request handling
├── repository.ts    # Drizzle queries, extends BaseRepository
├── validation.ts    # (optional) schemas too complex for routes.ts
├── hooks.ts         # (optional) cross-domain side effects
└── __tests__/
```

Domains with real logic add named services (`split-service.ts`, `trigger-service.ts`,
`photo-service.ts`); `providers/` additionally nests `domains/<kind>/` registries. Every
domain exports `routes` and is mounted in `app.ts` at `/api/v1/<domain>`.

## Route File Pattern (`routes.ts`)

```typescript
import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { tableName } from '../../db/schema';
import { type ApiResponse, NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { commonSchemas } from '../../utils/validation';
import { domainRepository } from './repository';

const routes = new Hono();

const baseSchema = createInsertSchema(tableName, {
  fieldName: z.string().min(1).max(CONFIG.validation.domain.fieldMaxLength),
});
const createSchema = baseSchema.omit({ id: true, userId: true, createdAt: true, updatedAt: true });
const updateSchema = createSchema.partial();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

// GET list, POST create, GET :id, PUT :id, DELETE :id
routes.post('/', zValidator('json', createSchema), async (c) => { /* ... */ });
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => { /* ... */ });

export { routes };
```

## Repository File Pattern (`repository.ts`)

```typescript
import { and, desc, eq } from 'drizzle-orm';
import { type AppDatabase, getDb } from '../../db/connection';
import { type Entity, entityTable, type NewEntity } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

export class EntityRepository extends BaseRepository<Entity, NewEntity> {
  constructor(db: AppDatabase) {
    super(db, entityTable);
  }

  // Domain queries use Drizzle directly — no query-builder abstraction
  async findByUserId(userId: string): Promise<Entity[]> { /* ... */ }
}

export const entityRepository = new EntityRepository(getDb());
```

`BaseRepository` supplies `findById`/`create`/`update`/`delete` (the last two throw
`NotFoundError` on a missing row). Take `AppDatabase`, never `BunSQLiteDatabase` — the alias
is the seam for a future non-SQLite dialect.

Extending it is the default, not a requirement: 8 repositories do. Its signature is
`table: Table & { id: Column }`, so a table without a single `id` column cannot extend it.
`user_preferences` (keyed on `user_id`) is the structural case. `analytics` runs read-only
aggregations and has no row CRUD to inherit. Extend it when the generic CRUD is genuinely what you
need; don't reshape a repository to qualify.

## Rules

### Validation
- Mirror a table with `createInsertSchema()`; domains with heavy cross-field rules hand-write
  `z.object` schemas in `validation.ts` (reminders, insurance, trips). Both are current.
- Field constraints come from `CONFIG.validation.*`, not inline literals.
- Validate with `zValidator('json' | 'param' | 'query', schema)`; never parse the body by hand.
  `commonSchemas` (`utils/validation.ts`) has `idParam`, `vehicleIdParam`, `pagination`,
  `clampedPaginationFields`, `dateRange`.
- `.refine()` does NOT survive `.partial()`/`.omit()` — re-add every cross-field refinement to
  the update schema, or a PUT persists what the POST rejects.
- Nullable columns use `.nullish()`, not `.optional()`: an update that re-validates a merged DB
  row sees `null` for unset columns, which `.optional()` rejects.

### Error Handling
- Throw typed errors from `errors.ts`: `ValidationError` (400), `AuthenticationError` (401),
  `NotFoundError` (404), `ConflictError` (409), `DatabaseError` (500). `app.onError(errorHandler)`
  formats them all — don't try/catch in a route just to reshape an error.
- Provider/sync failures throw `SyncError` with a `SyncErrorCode`; the global handler maps the
  code to its status (400/401/403/409/429/503). No local catch needed.
- Repositories throw `DatabaseError` with the original error as `details`.

### Response Format
- Success: `{ success: true, data, message? }`, typed as `ApiResponse<T>` from `errors.ts`.
  `201` on create, `200` otherwise.
- Paginated lists: `clampPagination()` the query params, respond via `buildPaginatedResponse()`
  (`utils/pagination.ts`) → `{ success: true, data, pagination: { totalCount, limit, offset,
  hasMore } }`.
- Errors: `{ success: false, error: { code, message, details? } }`, emitted by the global
  handler — don't hand-build it.

### Middleware
- `requireAuth` validates the session and sets `c.get('user')`. First line of every domain router.
- `changeTracker` marks data changed after a 2xx write so auto-sync/backup picks it up. A domain
  that writes backed-up data and omits it is silently missing from the next backup.
- `bodyLimit`, the global `rateLimiter`, `optionalAuth`, `activityTracker`, CORS, CSRF and
  secure-headers are applied once in `app.ts` — don't re-apply per domain.
- Scoped limiters come from `CONFIG.rateLimit` (`auth`, `sync`, `backup`, `restore`, `trigger`)
  and are applied in the owning `routes.ts`. A config entry nothing applies is a bug.
- `idempotency({ required })` replays a cached 2xx JSON body per `Idempotency-Key`
  (`sync/routes.ts`); a non-JSON 2xx is intentionally left uncached.

### Ownership & Authorization
- Every POST/PUT/DELETE verifies the resource belongs to `c.get('user')` *before* the repository
  call, via the `validate*Ownership` helpers in `utils/validation.ts`. Don't delegate it downstream.
- A repository method taking `userId` must scope its query by it. Never `_`-prefix the param to
  silence `noUnusedVariables` after dropping a check.
- Shared-vehicle access goes through `utils/sharing.ts` (`resolveVehicleAccess`,
  `requireVehicleRead`, `requireVehicleWrite`, `resolveVehicleOwnerId`), not a raw `userId` compare.

### Batching & Migrations
- Build any `inArray`/`IN (...)` clause over an unbounded id list with `chunk()`
  (`utils/chunk.ts`, batch 500) — SQLite's variable limit is 999.
- Prefer one batched query to a per-item loop in cascade operations.
- `storageProviderRegistry.createProviderInstance` decrypts credentials on every call, so resolve a
  provider once and reuse it.

### Photo Entity Types
The photo-bearing entities are `vehicle`, `expense`, `insurance_policy`, `insurance_claim`,
`odometer_entry`. Three maps must list all five and stay in sync: `validateEntityOwnership`
(`photos/helpers.ts`, the upload allowlist), `validateReferentialIntegrity` (`sync/backup.ts` —
a missing type makes restore reject an otherwise-valid backup outright), and
`ENTITY_TO_CATEGORY` (`providers/domains/storage/storage-provider.ts`).

### Cross-Domain Side Effects
A mutation affecting another domain goes in `hooks.ts` (`financing/`, `insurance/`) and is called
from the route handler, never a repository. Repositories stay data access only; business logic
lives in routes, hooks, or a named service.

### Frontend Seam
- The frontend reaches the API only through a domain service in `frontend/src/lib/services/`,
  which calls `apiClient` (it unwraps `data` and throws `ApiError` from the error envelope).
  Services are grouped by frontend domain, so they don't map 1:1 to route groups (financing
  lives in `vehicle-api.ts`; photo endpoints sit on each entity's service).
- Expense wire rows differ from the frontend `Expense` type: every read maps through
  `fromBackendExpense`, every write through `toBackendExpense`
  (`services/api-transformer.ts`). Returning a raw row typed as `Expense` is a type lie.
