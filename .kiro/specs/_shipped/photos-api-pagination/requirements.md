# Requirements Document

## Introduction

This document defines the requirements for unified pagination across all paginated API endpoints. The photos API gains new `limit`/`offset` pagination. The expenses and odometer endpoints already support pagination but use a flat response shape — they migrate to a nested `pagination` object. A shared backend helper `buildPaginatedResponse()` ensures all paginated endpoints produce an identical envelope: `{ success, data, pagination: { totalCount, limit, offset, hasMore } }`.

## Glossary

- **Photo_Route**: The backend HTTP route handlers that serve photo list requests — both the generic route (`/api/v1/photos/:entityType/:entityId`) and the vehicle-specific route (`/api/v1/vehicles/:vehicleId/photos`)
- **Expense_Route**: The backend HTTP route handler for paginated expense listing (`/api/v1/expenses`)
- **Odometer_Route**: The backend HTTP route handler for paginated odometer listing (`/api/v1/vehicles/:vehicleId/odometer`)
- **Photo_Service**: The `listPhotosForEntity` function in `photo-service.ts` that validates ownership and delegates to the repository
- **Photo_Repository**: The data access layer that queries the SQLite `photos` table via Drizzle ORM
- **Pagination_Helper**: The shared `buildPaginatedResponse()` function that constructs the nested pagination envelope
- **Pagination_Envelope**: The JSON response shape containing `success`, `data`, and a nested `pagination` object with `totalCount`, `limit`, `offset`, and `hasMore`
- **Frontend_API_Service**: The frontend TypeScript service functions that call paginated backend endpoints (`expense-api.ts`, `odometer-api.ts`, vehicle/photo API methods)
- **Frontend_PaginatedResponse**: The generic `PaginatedResponse<T>` TypeScript interface in `frontend/src/lib/types.ts`
- **Limit**: The maximum number of records to return in a single page (integer, 1–100)
- **Offset**: The zero-based index of the first record to return (non-negative integer)
- **TotalCount**: The total number of records matching the query filter, independent of pagination
- **HasMore**: A boolean indicating whether additional pages exist beyond the current page

## Requirements

### Requirement 1: Paginated Photo Queries

**User Story:** As a developer, I want the photo repository to support paginated queries, so that only a bounded number of rows are fetched per request.

#### Acceptance Criteria

1. WHEN the Photo_Repository receives a paginated query with a given limit and offset, THE Photo_Repository SHALL return at most `limit` photo records starting from the `offset` position
2. WHEN the Photo_Repository executes a paginated query, THE Photo_Repository SHALL return a `totalCount` equal to the total number of photos matching the entity filter regardless of limit and offset values
3. WHEN the Photo_Repository returns paginated results, THE Photo_Repository SHALL order the records by sortOrder ascending then createdAt ascending
4. WHEN the offset is greater than or equal to the totalCount, THE Photo_Repository SHALL return an empty data array with the accurate totalCount

### Requirement 2: Pagination Parameter Validation

**User Story:** As a developer, I want pagination parameters to be validated at the route level, so that invalid inputs are rejected before reaching the service layer.

#### Acceptance Criteria

1. WHEN a request includes a `limit` query parameter, THE Photo_Route SHALL validate that limit is a positive integer not exceeding the configured maximum page size (100)
2. WHEN a request includes an `offset` query parameter, THE Photo_Route SHALL validate that offset is a non-negative integer
3. IF a request includes an invalid limit or offset value, THEN THE Photo_Route SHALL respond with HTTP 400 and a descriptive validation error
4. WHEN a request omits the `limit` parameter, THE Photo_Service SHALL apply the configured default page size (20)
5. WHEN a request omits the `offset` parameter, THE Photo_Service SHALL default offset to 0

### Requirement 3: Limit Clamping

**User Story:** As a developer, I want the service layer to clamp pagination limits to configured bounds, so that no request can fetch an unbounded number of records.

#### Acceptance Criteria

1. WHEN a requested limit exceeds the configured maximum page size, THE Photo_Service SHALL clamp the limit to the maximum page size (100)
2. WHEN a requested limit is below the configured minimum page size, THE Photo_Service SHALL clamp the limit to the minimum page size (1)
3. THE Photo_Service SHALL compute the effective limit as `min(max(requested_limit, minPageSize), maxPageSize)`

### Requirement 4: Unified Paginated Response Envelope

**User Story:** As a frontend developer, I want all paginated endpoints to return a consistent nested pagination envelope, so that I can use a single response type and parsing logic across the entire app.

#### Acceptance Criteria

1. WHEN any paginated endpoint returns a successful response, THE endpoint SHALL return a JSON body with `success` (boolean), `data` (array), and `pagination` (object) at the top level
2. THE `pagination` object SHALL contain exactly four fields: `totalCount` (number), `limit` (number), `offset` (number), and `hasMore` (boolean)
3. WHEN constructing the response, THE endpoint SHALL set `hasMore` to true if and only if `offset + data.length < totalCount`
4. WHEN constructing the response, THE endpoint SHALL include the effective (clamped) limit and the resolved offset in the `pagination` object
5. NO paginated endpoint SHALL include `totalCount`, `limit`, `offset`, or `hasMore` as flat top-level fields outside the `pagination` object

### Requirement 5: Pagination Completeness

**User Story:** As a developer, I want to be confident that iterating through all pages returns every record exactly once, so that no data is lost or duplicated during pagination.

#### Acceptance Criteria

1. WHEN a client iterates all pages by incrementing offset by limit, THE repository SHALL return exactly `totalCount` unique records across all pages with no duplicates and no gaps
2. WHEN records are not modified between paginated requests, THE repository SHALL return a consistent and complete result set across sequential page fetches

### Requirement 6: Backward Compatibility

**User Story:** As a frontend developer, I want existing API consumers that don't pass pagination parameters to continue working, so that the migration to paginated responses is non-breaking for the data payload.

#### Acceptance Criteria

1. WHEN a request omits both limit and offset query parameters, THE route SHALL return the first page using the default page size and include the full Pagination_Envelope
2. WHEN a frontend consumer reads only the `data` field from the response, THE route SHALL ensure the `data` field contains the same array structure as the previous response

### Requirement 7: Frontend API Service Updates

**User Story:** As a frontend developer, I want the frontend API services to accept optional pagination parameters and return the nested paginated response type, so that I can implement paginated views consistently.

#### Acceptance Criteria

1. WHEN calling a frontend API method with pagination parameters, THE Frontend_API_Service SHALL pass `limit` and `offset` as query parameters to the backend endpoint
2. WHEN calling a frontend API method without pagination parameters, THE Frontend_API_Service SHALL omit pagination query parameters and rely on backend defaults
3. THE Frontend_API_Service SHALL return a typed `PaginatedResponse<T>` containing `data` and a nested `pagination` object with `totalCount`, `limit`, `offset`, and `hasMore`

### Requirement 8: Entity Ownership Validation

**User Story:** As a user, I want the system to verify I own the entity before returning its photos, so that I cannot access other users' photos through pagination.

#### Acceptance Criteria

1. WHEN a photo list request is received, THE Photo_Service SHALL validate that the requesting user owns the specified entity before executing the paginated query
2. IF the entity does not exist or is not owned by the requesting user, THEN THE Photo_Service SHALL respond with HTTP 404

### Requirement 9: Shared Pagination Helper

**User Story:** As a backend developer, I want a single shared helper function that constructs the pagination envelope, so that all endpoints produce an identical response structure without duplicating logic.

#### Acceptance Criteria

1. THE Pagination_Helper SHALL accept `data`, `totalCount`, `limit`, and `offset` as inputs and return the complete `{ success: true, data, pagination: { totalCount, limit, offset, hasMore } }` object
2. THE Pagination_Helper SHALL compute `hasMore` as `offset + data.length < totalCount`
3. ALL paginated routes (photos, expenses, odometer) SHALL use the Pagination_Helper to construct their response

### Requirement 10: Migrate Existing Endpoints to Nested Pagination

**User Story:** As a frontend developer, I want the expenses and odometer endpoints to use the same nested pagination format as the new photos endpoint, so that I don't need different parsing logic per endpoint.

#### Acceptance Criteria

1. THE Expense_Route SHALL replace its flat pagination fields (`totalCount`, `limit`, `offset`, `hasMore` at top level) with the nested `pagination` object by using the Pagination_Helper
2. THE Odometer_Route SHALL replace its flat pagination fields with the nested `pagination` object by using the Pagination_Helper
3. THE Frontend_API_Service for expenses SHALL read pagination metadata from `response.pagination.*` instead of flat `response.totalCount`, `response.limit`, etc.
4. THE Frontend_API_Service for odometer SHALL read pagination metadata from `response.pagination.*` instead of flat fields
5. ALL frontend components consuming expense or odometer paginated responses SHALL read from the `pagination` nested object

### Requirement 11: Frontend Type Updates

**User Story:** As a frontend developer, I want the `PaginatedResponse<T>` type to reflect the nested pagination shape, so that TypeScript catches any code still reading flat fields.

#### Acceptance Criteria

1. THE Frontend_PaginatedResponse type SHALL define `data: T[]` and `pagination: PaginationMeta` where `PaginationMeta` contains `totalCount`, `limit`, `offset`, and `hasMore`
2. THE `PaginatedOdometerResponse` type SHALL be removed or updated to use the generic `PaginatedResponse<OdometerEntry>` type
3. ALL frontend code that previously accessed `response.totalCount`, `response.limit`, `response.offset`, or `response.hasMore` SHALL be updated to access `response.pagination.totalCount`, etc.
