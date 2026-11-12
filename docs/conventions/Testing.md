# Testing Conventions

## Frameworks

| Layer | Framework | Runner | Location |
|---|---|---|---|
| Backend unit/integration | `bun:test` | `bun test` | `backend/src/**/__tests__/` |
| Frontend unit/component | Vitest + `@testing-library/svelte` | `npm run test` (`vitest --run`) | `frontend/src/**/__tests__/` |
| Frontend e2e | Playwright | `npm run test:e2e` | `frontend/e2e/` (config `frontend/playwright.config.ts`) |

Backend runs on `bun test` — never Vitest. Frontend runs on Vitest — never bun.
Property tests (`fast-check`) exist on both sides, in the same `__tests__/` dirs.
Vitest only collects `src/**/*.{test,spec}.{js,ts}`, so a frontend test outside `src/`
never runs.

## File Naming

- `<module>.test.ts` in a `__tests__/` dir next to the source
- `<module>.property.test.ts` for fast-check property tests
- `<domain>-test-generators.ts` for shared arbitraries (e.g. `analytics-test-generators.ts`)
- `<feature>.spec.ts` in `frontend/e2e/` for Playwright
- `migration-NNNN.test.ts` in `backend/src/db/__tests__/`

## Backend

### HTTP harness — the default for route tests

`createTestApp()` (`src/test-helpers/http-client.ts`) drives the REAL Hono app via
`app.request()` over an in-memory SQLite DB with a seeded user and a real Lucia session —
no network, no port. It exercises the whole stack (middleware → auth → zValidator →
handler → repository → DB), which repository-level unit tests bypass.

```typescript
import { createTestApp, json, type PaginatedEnvelope, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
beforeEach(async () => { ctx = await createTestApp(); });
afterEach(() => ctx.close());

const vehicleId = await seedVehicle(ctx, { make: 'Honda' });
await ctx.authed('POST', '/api/v1/expenses', { vehicleId, category: 'fuel', expenseAmount: 45.12, date: '2026-01-15' });

const res = await ctx.authed('GET', '/api/v1/expenses'); // ctx.anon for 401 assertions
const body = await json<PaginatedEnvelope<{ id: string; category: string }>>(res);
expect(res.status, JSON.stringify(body)).toBe(200);
```

`json<T>()` holds the only cast, so each test declares inline the shape it asserts against.
Single-resource routes return `DataEnvelope<T>` (`{ data: T }`); list routes return
`PaginatedEnvelope<T>` (adds `pagination`). Always pass the body as the assertion message.

The bunfig preload (`src/test-helpers/preload.ts`) sets `NODE_ENV=test` and
`DATABASE_URL=:memory:` before any test file loads, so a test never opens the `.env` database
and static imports of DB-bound modules are safe. `CONFIG` and the DB singleton still snapshot
`process.env` once per process, so env-gated branches can't be flipped per-file in a full-suite
run — pick a path that doesn't need the gate.

For a second signed-in user, use `createInvitee(ctx, idPrefix)` (`test-helpers/invitee.ts`): it
returns the user's id, email, cookie, a JSON `request` function, and `acceptShare(vehicleId,
level)`. `requestAs(ctx, userId)` (`http-client.ts`) gives the same request function for an
existing user.

Never `mock.module` a VROOM module — inject the collaborator. See `TestingExternalAPIs.md`.

### Property tests (fast-check)

Use them for invariants over generated input: repository query contracts (filtering,
sorting), validation boundaries, calculations and unit conversions.

```typescript
describe('Property N: descriptive name', () => {
  test('invariant description', () => {
    fc.assert(
      fc.property(validExpenseArb, (input) => {
        expect(computeTotal(input)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });
});
```

For complex data shapes, put the arbitraries in a shared generator file:

```typescript
// __tests__/<domain>-test-generators.ts
export const validExpenseArb = fc.record({
  vehicleId: fc.constantFrom('vehicle-A', 'vehicle-B'),
  category: fc.constantFrom('fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'),
  expenseAmount: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  date: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
});
```

### Migration tests

Full pattern in `DatabaseMigrations.md`. Key points:

- In-memory SQLite (`new Database(':memory:')`), then `db.run('PRAGMA foreign_keys = ON')`
- Use `migration-helpers.ts`: `loadMigrations`, `applyMigration`, `applyMigrationsUpTo`,
  `getTables`, `getColumnNames`, `getIndexNames`, `countRows`, `seedCoreData`
- Assert that seed data survives the migration

## Frontend

- `src/test-setup.ts` runs for every Vitest file under the `happy-dom` environment and
  already mocks `localStorage`, `fetch`, `matchMedia`, the service worker, and
  `$app/env`. Don't re-mock those per file.
- Mock API calls — never hit the real backend.
- Playwright needs no backend and no database: its `webServer` starts `npm run dev` on 5173
  itself (reusing one already there), a `globalSetup` pre-compiles the routes the specs visit,
  and every `/api/v1/...` call is answered in-browser by `mockApi` (`e2e/support/mock-api.ts`).
  Narrow with `npm run test:e2e:chromium` / `test:e2e:mobile`. `frontend/e2e/README.md` carries
  the selector and auth-mocking conventions, the a11y ratchet, and why the dev server rather
  than the production build.

## Rules

- Mocks must match current types. If `Expense` changes, update them — no stale field names.
- Type what you assert against: import the real type or declare the shape inline (`json<T>()` is
  the only cast in the backend harness). `no-explicit-any` is deliberately off for test files
  (`frontend/eslint.config.js`) and only a warning in `backend/biome.json`, so this is a convention,
  not a lint error — reach for `as any` only to feed a deliberately-invalid input (`'banana' as any`)
  or to reach a global test shim, never to dodge typing a response body.
- `{ numRuns: 100 }` is the baseline. Raise it for critical invariants.
- Test the public contract, not private methods or internal state.
- Test names state the invariant or behavior, not "it works".
