---
inclusion: fileMatch
fileMatchPattern: "**/*.test.ts,**/*.test.js,**/*.spec.ts,**/playwright/**,**/e2e/**"
---

# Testing Conventions

## Test Frameworks

| Layer | Framework | Runner | Location |
|---|---|---|---|
| Backend unit/integration | `bun:test` | `bun test` | `backend/src/**/__tests__/` |
| Backend property tests | `fast-check` + `bun:test` | `bun test` | `backend/src/**/__tests__/*.property.test.ts` |
| Frontend unit | Vitest + Testing Library Svelte | `npm run test` | `frontend/src/**/__tests__/` or colocated `*.test.ts` |
| Frontend e2e | Playwright | `npm run test:e2e` | `frontend/tests/` (Playwright config at `frontend/playwright.config.ts`) |
| DB migrations | `bun:test` (in-memory SQLite) | `bun test` | `backend/src/db/__tests__/migration-*.test.ts` |

## File Naming

- Unit/integration tests: `<module>.test.ts` colocated in `__tests__/` next to the source
- Property tests: `<module>.property.test.ts` in `__tests__/`
- Migration tests: `migration-000N.test.ts` in `backend/src/db/__tests__/`
- E2e tests: `<feature>.spec.ts` in `frontend/tests/`
- Test helpers/generators: `<domain>-test-generators.ts` or `test-helpers.ts` in `__tests__/`

## Backend Test Patterns

### Property Tests (fast-check)

Property tests validate invariants over randomly generated inputs. Use them for:
- Repository query correctness (filtering, sorting contracts)
- Validation logic (boundary conditions, edge cases)
- Calculation functions (unit conversions, stats)

Pattern:
```typescript
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

describe('Property N: Descriptive Name', () => {
  test('invariant description', () => {
    fc.assert(
      fc.property(arbitraryGenerator, (input) => {
        const result = functionUnderTest(input);
        // Assert invariant holds for all generated inputs
        expect(result).toSatisfy(condition);
      }),
      { numRuns: 200 }
    );
  });
});
```

### Migration Tests

See `DatabaseMigrations.md` steering for the full pattern. Key points:
- Use in-memory SQLite (`new Database(':memory:')`)
- Always enable foreign keys: `db.run('PRAGMA foreign_keys = ON')`
- Use helpers from `migration-helpers.ts`: `loadMigrations`, `applyMigrationsUpTo`, `getTables`, `getColumnNames`, `seedCoreData`
- Test that seed data survives the migration

### Test Generators

For domains with complex data shapes, create a dedicated generator file:
```typescript
// __tests__/<domain>-test-generators.ts
import fc from 'fast-check';

export const validExpenseArb = fc.record({
  vehicleId: fc.constantFrom('vehicle-A', 'vehicle-B'),
  category: fc.constantFrom('fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'),
  expenseAmount: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  date: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
});
```

## Frontend Test Patterns

### Vitest Unit Tests

- Use `@testing-library/svelte` for component tests
- Use `happy-dom` or `jsdom` as the test environment
- Mock API calls — never hit the real backend
- Test user interactions, not implementation details

### Playwright E2E Tests

- Tests run against the built app, not dev server
- Use `@axe-core/playwright` for accessibility checks where appropriate
- Use page object patterns for complex flows
- Run specific projects: `npm run test:e2e:chromium`, `npm run test:e2e:mobile`

## Rules

- Test mocks must match current types. If the `Expense` type changes, update mocks. Don't use stale field names.
- Don't use `any` in test code — use proper types from the source modules.
- Property tests should use `{ numRuns: 200 }` as a baseline. Increase for critical invariants.
- Don't test implementation details (private methods, internal state). Test the public contract.
- Backend tests run with `bun test` — don't use Vitest for backend.
- Frontend tests run with `vitest --run` — don't use bun for frontend.
- Keep test files colocated with source in `__tests__/` directories, not in a separate top-level `tests/` folder (exception: Playwright e2e tests).
- Use descriptive test names that explain the invariant or behavior, not just "it works".
