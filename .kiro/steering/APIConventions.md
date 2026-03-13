---
inclusion: fileMatch
fileMatchPattern: "backend/src/api/**"
---

# Backend API Conventions

## Domain Structure

Each domain under `backend/src/api/` follows this structure:

```
api/<domain>/
├── routes.ts           # Hono route definitions, validation schemas, request handling
├── repository.ts       # Data access layer (Drizzle queries), extends BaseRepository
├── __tests__/          # Property tests and unit tests
│   ├── *.property.test.ts
│   └── *-test-generators.ts
├── validation.ts       # (optional) Complex validation logic extracted from routes
└── hooks.ts            # (optional) Cross-domain side effects (e.g., financing hooks)
```

## Route File Pattern (`routes.ts`)

```typescript
import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { tableName } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { commonSchemas } from '../../utils/validation';
import { domainRepository } from './repository';

const routes = new Hono();

// 1. Define Zod schemas derived from Drizzle schema
const baseSchema = createInsertSchema(tableName, {
  // Override specific fields with custom validation
  fieldName: z.string().min(1).max(CONFIG.validation.domain.fieldMaxLength),
});
const createSchema = baseSchema.omit({ id: true, createdAt: true, updatedAt: true });
const updateSchema = createSchema.partial();

// 2. Apply middleware to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// 3. Define routes: GET list, POST create, GET :id, PUT :id, DELETE :id
routes.get('/', async (c) => { /* ... */ });
routes.post('/', zValidator('json', createSchema), async (c) => { /* ... */ });
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => { /* ... */ });
routes.put('/:id', zValidator('param', commonSchemas.idParam), zValidator('json', updateSchema), async (c) => { /* ... */ });
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => { /* ... */ });

export { routes };
```

## Repository File Pattern (`repository.ts`)

```typescript
import { eq, and, desc, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { Entity, NewEntity } from '../../db/schema';
import { entityTable } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export class EntityRepository extends BaseRepository<Entity, NewEntity> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, entityTable);
  }

  // Add domain-specific query methods
  async findByUserId(userId: string): Promise<Entity[]> {
    // Use direct Drizzle queries, not abstraction layers
  }
}

// Export singleton instance
export const entityRepository = new EntityRepository(getDb());
```

## Rules

### Validation
- Derive Zod schemas from Drizzle schema using `createInsertSchema()` from `drizzle-zod`
- Override fields with custom constraints referencing `CONFIG.validation.*`
- Use `zValidator('json', schema)` and `zValidator('param', schema)` middleware — don't manually parse
- Use `commonSchemas.idParam` from `utils/validation.ts` for `:id` route params
- Validate ownership before mutations: check that the resource belongs to the authenticated user

### Error Handling
- Use typed errors from `errors.ts`: `NotFoundError`, `ValidationError`, `ConflictError`, `DatabaseError`
- Don't catch errors in routes unless you need to transform them — the global error handler catches `AppError` subclasses
- For sync/Drive operations, use `handleSyncError()` from `errors.ts`
- Repository methods should throw `DatabaseError` for DB failures, with the original error as `details`

### Response Format
- All responses use `{ success: true, data: ..., message?: ... }` for success
- Error responses use `{ success: false, error: { code, message, details? } }`
- Use HTTP status codes correctly: 200 (OK), 201 (created), 400 (validation), 404 (not found), 409 (conflict), 429 (rate limit), 500 (server error)

### Middleware
- `requireAuth` — validates session, sets `c.get('user')`. Apply to all protected routes.
- `changeTracker` — records data changes for sync. Apply to routes that modify data.
- Rate limiters are configured in `CONFIG.rateLimit` and applied per-domain in `index.ts`. If you add a rate limit config entry, you must also apply it — unused config is a bug.

### Ownership & Authorization
- Every mutation (POST/PUT/DELETE) must verify the resource belongs to the authenticated user before proceeding. Don't rely on downstream services to enforce this — validate at the route level.
- When removing ownership checks (e.g., refactoring a service function), ensure the caller still validates ownership. Document the contract if ownership is the caller's responsibility.
- Functions that accept `userId` must actually use it for scoping. Prefixing with `_` to silence lint warnings while removing the check is a security regression.

### Raw SQL & Data Migrations
- When building raw SQL `IN (...)` clauses with dynamic arrays, batch in chunks of ~500 to stay under SQLite's `SQLITE_MAX_VARIABLE_NUMBER` limit (default 999). Unbounded arrays will crash for users with large datasets.
- Data migrations that run after Drizzle schema migrations must be idempotent — safe to run multiple times without duplicating data.

### Entity Type Mappings
- When mapping entity types to categories or behaviors, cover ALL entity types the system supports. Check the existing entity types in `photos.entityType`: `vehicle`, `expense`, `insurance_policy`, `odometer_entry`. Missing mappings cause runtime errors for valid operations.

### Imports & Module Initialization
- Keep all `import` statements at the top of the file. Don't place imports mid-file after runtime code — they're hoisted by the runtime anyway, and mid-file placement is misleading.
- Singleton instances that call `getDb()` at module scope work in this project but create tight coupling to initialization order. Be aware of this when adding new singletons.

### Performance
- Avoid N+1 query patterns in cascade operations (e.g., deleting all photos for an entity). When iterating over a list and querying per item, consider batch queries with `inArray()` instead.
- Provider credential decryption and instantiation is expensive. Don't create new provider instances per-request in hot paths if the same provider is used repeatedly.

### Cross-Domain Side Effects
- When a mutation in one domain affects another (e.g., expense creation adjusting financing balance), use a hooks file (`hooks.ts`)
- Hooks are called from the route handler, not the repository
- Keep repositories focused on data access — business logic lives in routes or hooks

### Frontend Counterpart
- Each backend domain should have a corresponding frontend API service in `frontend/src/lib/services/`
- Service methods map 1:1 to backend endpoints
- Types shared between frontend and backend are defined in `frontend/src/lib/services/api-transformer.ts`
