# Task: Remove `users.provider` and `users.providerId` Columns

## Context

The `users` table has `provider` (TEXT NOT NULL DEFAULT 'google') and `provider_id` (TEXT NOT NULL) columns that were the original auth identity storage before the `user_providers` table existed. With the multi-provider OAuth design, identity resolution moves to `user_providers WHERE domain = 'auth'`, making these columns redundant.

This task removes them entirely. No migration file needed — edit the schema and the 0000 migration directly.

## Scope

### 1. Schema: `backend/src/db/schema.ts`

Remove from the `users` table definition:
```typescript
// DELETE these two lines:
provider: text('provider').notNull().default('google'),
providerId: text('provider_id').notNull(),
```

### 2. Migration: `backend/drizzle/0000_regular_shiver_man.sql`

Remove `provider` and `provider_id` columns from the `CREATE TABLE users` statement.

### 3. Lucia config: `backend/src/api/auth/lucia.ts`

- Remove `provider` and `providerId` from `getUserAttributes` return
- Remove them from the `DatabaseUserAttributes` interface
- Remove them from the `lucia` module declaration's `User` interface

### 4. Auth routes: `backend/src/api/auth/routes.ts`

- The login callback currently does `where(eq(users.providerId, googleUser.sub))` to find existing users — this query needs to be updated or removed (the multi-provider OAuth design replaces this with a `user_providers` lookup, but for now just remove the column references)
- The user INSERT on signup sets `provider: 'google'` and `providerId: googleUser.sub` — remove these fields from the INSERT

### 5. Backend types: `backend/src/db/types.ts`

- `AuthProvider` type is `'google'` — remove or replace with a string union if still needed elsewhere

### 6. Frontend types: `frontend/src/lib/types/user.ts`

- Remove `provider: 'google'` and `providerId: string` from the `User` interface

### 7. Frontend test mocks (update all to remove `provider` / `providerId`):

- `frontend/src/lib/utils/test-helpers.ts`
- `frontend/src/lib/stores/__tests__/auth.test.ts`
- `frontend/src/lib/components/__tests__/Navigation.test.ts`
- `frontend/src/lib/components/__tests__/AuthFlow.test.ts`
- `frontend/src/lib/components/__tests__/ProtectedRoute.test.ts`
- `frontend/src/lib/components/__tests__/VehicleManagement.test.ts`

### 8. Backend test mocks (update all to remove `provider` / `providerId`):

- `backend/src/api/analytics/__tests__/summary-route.test.ts`
- `backend/src/api/auth/__tests__/preservation-login-sync.property.test.ts`
- `backend/src/db/seed.ts`

### 9. E2E tests:

- `frontend/e2e/auth.spec.ts` — remove `provider: 'google'` from mock responses

### 10. Exported schema types

The `User` and `NewUser` types are inferred from the schema (`typeof users.$inferSelect` / `$inferInsert`). Removing the columns from the schema automatically removes them from these types. Any code importing `User` or `NewUser` that references `.provider` or `.providerId` will get a compile error — fix those.

## Validation

After changes, run:
```bash
# Backend
cd backend && bun run all:fix && bun run validate

# Frontend
cd frontend && npm run all:fix && npm run validate
```

Fix all compile errors from removed fields.
