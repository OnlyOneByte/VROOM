# Requirements Document

## Introduction

This specification defines requirements for simplifying and consolidating the VROOM backend codebase. The backend has already undergone a consolidation phase where multiple files were merged, but now requires deeper simplification at the code level. The goal is to reduce complexity, improve readability, and make the codebase easier to maintain for a single-developer open source project.

## Glossary

- **Backend**: The Node.js/Bun server application located in the `backend/` directory
- **Repository**: A data access layer class that handles database operations for a specific entity
- **Route Handler**: An HTTP endpoint handler function that processes requests and returns responses
- **Service**: A business logic layer that orchestrates operations across multiple repositories
- **Middleware**: Functions that process requests before they reach route handlers
- **Drizzle ORM**: The database ORM library used for SQLite operations
- **Hono**: The web framework used for HTTP routing and middleware

## Requirements

### Requirement 1

**User Story:** As a developer, I want simplified repository classes with minimal abstraction, so that I can quickly understand and modify data access logic.

#### Acceptance Criteria

1. WHEN reviewing repository code THEN the BaseRepository SHALL provide only essential CRUD operations (findById, create, update, delete)
2. WHEN implementing custom queries THEN repositories SHALL use direct Drizzle queries without additional abstraction layers
3. WHEN a repository method is no longer used THEN it SHALL be removed from the codebase
4. WHEN repository methods duplicate functionality THEN they SHALL be consolidated into a single method with optional parameters
5. WHEN error handling is needed THEN repositories SHALL throw typed errors (NotFoundError, DatabaseError) and let the global error handler manage responses

### Requirement 2

**User Story:** As a developer, I want route handlers to focus on request/response logic, so that business logic is clearly separated and testable.

#### Acceptance Criteria

1. WHEN a route handler contains complex business logic THEN that logic SHALL be extracted to a service or utility function
2. WHEN validation logic is duplicated across routes THEN it SHALL be extracted to shared validation schemas or functions
3. WHEN route handlers perform database operations THEN they SHALL delegate to repository methods
4. WHEN multiple routes share similar patterns THEN common middleware SHALL be used to reduce duplication
5. WHEN a route handler exceeds 50 lines THEN it SHALL be refactored to extract helper functions or services

### Requirement 3

**User Story:** As a developer, I want minimal service layer abstraction, so that I can trace data flow without navigating through multiple abstraction layers.

#### Acceptance Criteria

1. WHEN a service class contains only one or two methods THEN those methods SHALL be converted to standalone utility functions
2. WHEN service methods simply delegate to repositories THEN they SHALL be removed and routes SHALL call repositories directly
3. WHEN business logic is complex enough to warrant a service THEN it SHALL remain as a class with clear responsibilities
4. WHEN services are removed THEN their functionality SHALL be moved to either repositories (data access) or utilities (pure functions)
5. WHEN a service orchestrates multiple operations THEN it SHALL use clear, sequential code without excessive abstraction

### Requirement 4

**User Story:** As a developer, I want consolidated utility functions organized by purpose, so that I can easily find and reuse common functionality.

#### Acceptance Criteria

1. WHEN utility functions serve similar purposes THEN they SHALL be grouped in the same file
2. WHEN a utility function is used in only one place THEN it SHALL be inlined or moved closer to its usage
3. WHEN utility functions are pure (no side effects) THEN they SHALL be clearly documented as such
4. WHEN utility functions have complex logic THEN they SHALL include JSDoc comments explaining their purpose and parameters
5. WHEN utility files exceed 300 lines THEN they SHALL be split by logical grouping

### Requirement 5

**User Story:** As a developer, I want simplified error handling with consistent patterns, so that I can quickly understand how errors flow through the application.

#### Acceptance Criteria

1. WHEN an error occurs in a repository THEN it SHALL throw a typed error (DatabaseError, NotFoundError, etc.)
2. WHEN an error occurs in a route handler THEN it SHALL either throw a typed error or use the handleSyncError helper for sync operations
3. WHEN validation fails THEN it SHALL throw a ValidationError with clear error messages
4. WHEN the global error handler receives an error THEN it SHALL format it consistently and return appropriate HTTP status codes
5. WHEN error handling code is duplicated THEN it SHALL be extracted to shared error handling utilities

### Requirement 6

**User Story:** As a developer, I want simplified middleware with clear single responsibilities, so that I can understand what each middleware does at a glance.

#### Acceptance Criteria

1. WHEN middleware performs multiple unrelated tasks THEN it SHALL be split into separate middleware functions
2. WHEN middleware is used in only one route THEN it SHALL be considered for inlining or removal
3. WHEN middleware has complex logic THEN it SHALL delegate to service functions or utilities
4. WHEN middleware modifies request context THEN it SHALL have clear TypeScript types for the context additions
5. WHEN middleware is no longer needed THEN it SHALL be removed along with its usage

### Requirement 7

**User Story:** As a developer, I want simplified configuration management, so that I can easily understand and modify application settings.

#### Acceptance Criteria

1. WHEN configuration values are accessed THEN they SHALL come from the centralized CONFIG object
2. WHEN configuration has nested objects THEN they SHALL be flattened if they only contain 1-2 properties
3. WHEN configuration includes helper functions THEN those functions SHALL be clearly separated from data
4. WHEN environment variables are parsed THEN validation SHALL happen once at startup with clear error messages
5. WHEN configuration is complex THEN it SHALL include comments explaining the purpose of each section

### Requirement 8

**User Story:** As a developer, I want simplified type definitions with minimal duplication, so that I can maintain type safety without excessive boilerplate.

#### Acceptance Criteria

1. WHEN types are duplicated across files THEN they SHALL be consolidated in a central types file
2. WHEN types are only used in one file THEN they SHALL be defined locally in that file
3. WHEN types can be inferred from Drizzle schemas THEN they SHALL use Drizzle's type inference instead of manual definitions
4. WHEN type guards are needed THEN they SHALL be simple functions that return boolean predicates
5. WHEN types become complex THEN they SHALL include JSDoc comments explaining their structure and usage

### Requirement 9

**User Story:** As a developer, I want simplified database schema and connection management, so that I can easily understand the data model and database configuration.

#### Acceptance Criteria

1. WHEN database tables are defined THEN they SHALL use Drizzle's schema definition with clear column types
2. WHEN database connections are needed THEN they SHALL use the centralized getDb() function
3. WHEN transactions are needed THEN they SHALL use the transaction helper function
4. WHEN database migrations are needed THEN they SHALL be managed through Drizzle's migration system
5. WHEN database configuration changes THEN it SHALL be updated in the centralized CONFIG object

### Requirement 10

**User Story:** As a developer, I want simplified sync and backup logic, so that I can understand and maintain Google Drive and Sheets integration.

#### Acceptance Criteria

1. WHEN sync operations are performed THEN they SHALL rely on rate limiting and idempotency middleware instead of lock management
2. WHEN backup data is created THEN it SHALL use straightforward CSV generation without excessive abstraction
3. WHEN restore operations are performed THEN they SHALL use clear, sequential steps with explicit error handling
4. WHEN Google API calls are made THEN they SHALL use the GoogleDriveService or GoogleSheetsService classes directly
5. WHEN sync state is tracked THEN it SHALL use simple in-memory maps or database fields without complex state machines
