---
name: Add API Endpoint
description: Step-by-step guide for adding a new API domain with routes, repository, frontend service, types, and tests.
---

# Add API Endpoint

Use this skill when adding a new API domain (e.g., trips, reminders) or adding endpoints to an existing domain.

## Adding a New Domain

### 1. Create the Backend Domain Directory

```
backend/src/api/<domain>/
├── routes.ts
├── repository.ts
└── __tests__/
```

### 2. Define the Database Table (if needed)

File: `backend/src/db/schema.ts`

Add the new table using Drizzle's `sqliteTable()`. Follow existing patterns:
- Use `text('id').primaryKey().$defaultFn(() => createId())` for IDs
- Use `integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())` for timestamps
- Add foreign keys with `onDelete: 'cascade'` where appropriate
- Export the inferred types: `type Entity = typeof entityTable.$inferSelect`

After modifying schema.ts, follow the Database Migration SOP (see `DatabaseMigrations.md` steering).

### 3. Create the Repository

File: `backend/src/api/<domain>/repository.ts`

```typescript
import { eq } from 'drizzle-orm';
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

  async findByUserId(userId: string): Promise<Entity[]> {
    try {
      return await this.db
        .select()
        .from(entityTable)
        .where(eq(entityTable.userId, userId));
    } catch (error) {
      logger.error('Failed to find entities', { userId, error });
      throw new DatabaseError('Failed to find entities', error);
    }
  }
}

export const entityRepository = new EntityRepository(getDb());
```

### 4. Create the Routes

File: `backend/src/api/<domain>/routes.ts`

Follow the pattern in `APIConventions.md` steering:
- Derive Zod schemas from Drizzle schema with `createInsertSchema()`
- Apply `requireAuth` and `changeTracker` middleware
- Use `zValidator()` for request validation
- Use typed errors from `errors.ts`
- Return `{ success: true, data: ... }` responses

### 5. Mount the Routes

File: `backend/src/index.ts`

```typescript
import { routes as domainRoutes } from './api/<domain>/routes';
app.route('/api/v1/<domain>', domainRoutes);
```

### 6. Create the Frontend API Service

File: `frontend/src/lib/services/<domain>-api.ts`

```typescript
import { apiClient } from './api-client';
import type { Entity } from '$lib/types';

export const domainApi = {
  async getAll(): Promise<Entity[]> {
    const response = await apiClient.get<Entity[]>('/api/v1/<domain>');
    return response;
  },

  async getById(id: string): Promise<Entity> {
    return apiClient.get<Entity>(`/api/v1/<domain>/${id}`);
  },

  async create(data: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entity> {
    return apiClient.post<Entity>('/api/v1/<domain>', data);
  },

  async update(id: string, data: Partial<Entity>): Promise<Entity> {
    return apiClient.put<Entity>(`/api/v1/<domain>/${id}`, data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/<domain>/${id}`);
  },
};
```

### 7. Add Frontend Types

File: `frontend/src/lib/types/index.ts`

Add the entity type. If the backend response shape differs from the frontend type, add a transformer in `api-transformer.ts`.

### 8. Update Backup/Restore (if new table)

- Add to `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` in `backend/src/config.ts`
- Add to `ParsedBackupData` type in `backend/src/types.ts`
- Update `createBackup` and `restoreFromBackup`
- Update `validateReferentialIntegrity` if the table has foreign keys

### 9. Write Tests

- Create `backend/src/api/<domain>/__tests__/<domain>.property.test.ts` for property tests
- Create migration test if a new table was added
- Run `bun run validate` and `npm run validate`

## Adding Endpoints to an Existing Domain

1. Add the Zod schema for the new endpoint in `routes.ts`
2. Add the route handler
3. Add the repository method if new data access is needed
4. Add the frontend service method
5. Update types if the response shape is new
6. Write tests

## Verification Checklist

- [ ] Repository extends `BaseRepository` and exports a singleton
- [ ] Routes use `zValidator()` for all inputs
- [ ] Routes apply `requireAuth` and `changeTracker`
- [ ] Error handling uses typed errors from `errors.ts`
- [ ] Frontend service created with methods matching backend endpoints
- [ ] Types added to `$lib/types/`
- [ ] Backup/restore updated (if new table)
- [ ] Migration generated and tested (if schema changed)
- [ ] `bun run validate` passes in backend/
- [ ] `npm run validate` passes in frontend/
