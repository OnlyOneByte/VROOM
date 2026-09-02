# Tasks

## Task 1: Backend — Shared Pagination Types & Helper

- [x] 1.1 Create `backend/src/utils/pagination.ts` with `PaginatedResult<T>`, `PaginationMeta`, `PaginatedApiResponse<T>` types and `buildPaginatedResponse()` function
- [x] 1.2 Export `clampPagination()` helper that applies min/max/default clamping logic
- [x] 1.3 Verify `buildPaginatedResponse` returns `{ success: true, data, pagination: { totalCount, limit, offset, hasMore } }` shape

> **Requirements:** 4, 9

## Task 2: Backend — PhotoRepository.findByEntityPaginated

- [x] 2.1 Add `findByEntityPaginated(entityType, entityId, limit, offset)` method to the photo repository
- [x] 2.2 Execute parallel count + data queries filtered by entityType and entityId
- [x] 2.3 Apply sort order: sortOrder ASC, createdAt ASC
- [x] 2.4 Return `PaginatedResult<Photo>` with `{ data, totalCount }`

> **Requirements:** 1

## Task 3: Backend — PhotoService Pagination Support

- [x] 3.1 Update `listPhotosForEntity` to accept optional `{ limit?, offset? }` parameter
- [x] 3.2 Apply `clampPagination()` to the incoming params before passing to repository
- [x] 3.3 Delegate to `findByEntityPaginated` and return `PaginatedResult<Photo>`

> **Requirements:** 1, 3, 8

## Task 4: Backend — Photo Routes Pagination

- [x] 4.1 Add Zod query validation for `limit` and `offset` on generic photo list route (`GET /api/v1/photos/:entityType/:entityId`)
- [x] 4.2 Add Zod query validation for `limit` and `offset` on vehicle photo list route (`GET /api/v1/vehicles/:vehicleId/photos`)
- [x] 4.3 Use `buildPaginatedResponse()` to construct the response envelope in both routes

> **Requirements:** 2, 4, 6

## Task 5: Backend — Refactor Expense Routes to Nested Pagination

- [x] 5.1 Import `buildPaginatedResponse` in expense routes
- [x] 5.2 Replace flat `{ success, data, totalCount, limit, offset, hasMore }` response with `buildPaginatedResponse(data, totalCount, limit, offset)`

> **Requirements:** 4, 9, 10

## Task 6: Backend — Refactor Odometer Routes to Nested Pagination

- [x] 6.1 Import `buildPaginatedResponse` in odometer routes
- [x] 6.2 Replace flat `{ success, data, totalCount, limit, offset, hasMore }` response with `buildPaginatedResponse(data, totalCount, limit, offset)`

> **Requirements:** 4, 9, 10

## Task 7: Frontend — Update PaginatedResponse Type

- [x] 7.1 Add `PaginationMeta` interface with `totalCount`, `limit`, `offset`, `hasMore` to `frontend/src/lib/types.ts`
- [x] 7.2 Update `PaginatedResponse<T>` to use `pagination: PaginationMeta` instead of flat fields
- [x] 7.3 Remove or update `PaginatedOdometerResponse` to use `PaginatedResponse<OdometerEntry>`

> **Requirements:** 11

## Task 8: Frontend — Update expense-api.ts

- [x] 8.1 Update expense list method to read `result.pagination` instead of flat `result.totalCount`, `result.limit`, etc.
- [x] 8.2 Return `PaginatedResponse<Expense>` with nested pagination shape

> **Requirements:** 7, 10

## Task 9: Frontend — Update odometer-api.ts

- [x] 9.1 Update odometer list method to read `result.pagination` instead of flat fields
- [x] 9.2 Update return type to `PaginatedResponse<OdometerEntry>`

> **Requirements:** 7, 10

## Task 10: Frontend — Add Photo Pagination to API Services

- [x] 10.1 Update `vehicleApi.getPhotos` to accept optional `{ limit?, offset? }` and return `PaginatedResponse<Photo>`
- [x] 10.2 Update any other photo-fetching API methods (expenseApi.getPhotos, insuranceApi.getDocuments, odometerApi.getPhotos) to accept pagination params and return `PaginatedResponse<Photo>`

> **Requirements:** 7

## Task 11: Frontend — Update Consuming Components

- [x] 11.1 Update `vehicles/[id]/+page.svelte` to read `result.pagination.totalCount` instead of `result.totalCount`
- [x] 11.2 Update `expenses/+page.svelte` to read `pageResult.pagination.totalCount` etc.
- [x] 11.3 Update `OdometerTab.svelte` to read `response.pagination.totalCount`, `response.pagination.offset` etc.
- [x] 11.4 Update any other components that read flat pagination fields from expense or odometer responses

> **Requirements:** 10, 11

## Task 12: Property-Based Tests for Pagination Correctness

- [x] 12.1 [PBT] Write fast-check property test: `buildPaginatedResponse` always produces valid nested shape with correct `hasMore` computation
- [x] 12.2 [PBT] Write fast-check property test: iterating pages by incrementing offset yields exactly `totalCount` items with no duplicates
- [x] 12.3 [PBT] Write fast-check property test: `clampPagination` output always satisfies `minPageSize <= limit <= maxPageSize` and `offset >= 0`

> **Requirements:** 4, 5, 9

## Task 13: Integration Validation

- [x] 13.1 Run backend validation (`bun run all:fix && bun run validate`) and fix any errors
- [x] 13.2 Run frontend validation (`npm run all:fix && npm run validate`) and fix any errors
- [x] 13.3 Verify all three endpoint groups (photos, expenses, odometer) return nested `pagination` object and no flat pagination fields

> **Requirements:** 4, 10
