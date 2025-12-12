# Requirements Document

## Introduction

This specification defines the requirements for consolidating and simplifying the VROOM backend codebase. The backend is a Bun/Hono/Drizzle application that has grown organically and now contains unnecessary complexity, duplication, and over-engineering for a non-enterprise application.

**Current State Analysis:**
- 60+ TypeScript files across multiple nested directories
- Duplicate type definitions in 3 locations (src/types, lib/types, lib/services/*/types.ts)
- Merged service files (analytics.ts, sync.ts) that are 1000+ lines each
- Inconsistent error handling (lib/core/errors.ts exists but also has a non-existent errors/ subdirectory referenced in README)
- Complex sync orchestration with multiple layers of indirection
- Repository pattern with unnecessary abstractions
- Middleware that could be simplified or consolidated

**Goal:** Prioritize readability, simplicity, and best practices while maintaining all functionality. Create a structure that a single developer can easily understand and maintain.

## Glossary

- **Backend**: The VROOM Car Tracker backend API built with Bun, Hono, and Drizzle ORM
- **Repository**: Data access layer classes that interact with the database
- **Service**: Business logic layer classes that orchestrate operations
- **Middleware**: Request/response interceptors in the Hono framework
- **Route Handler**: HTTP endpoint handlers that process API requests
- **Drizzle ORM**: TypeScript ORM used for database operations
- **Hono**: Lightweight web framework used for the API
- **Bun**: JavaScript runtime used to execute the application

## Requirements

### Requirement 1

**User Story:** As a developer, I want a simplified and consolidated codebase structure, so that I can easily understand and maintain the application.

#### Acceptance Criteria

1. WHEN reviewing the codebase structure THEN the system SHALL organize code by feature/domain rather than technical layer
2. WHEN examining file organization THEN the system SHALL eliminate unnecessary nesting and abstraction layers
3. WHEN looking at imports THEN the system SHALL use clear, direct import paths without excessive indirection
4. WHEN counting files THEN the system SHALL have reduced the total number of files by consolidating related functionality
5. WHEN reading any module THEN the system SHALL have clear, single-responsibility modules with obvious purposes

### Requirement 2

**User Story:** As a developer, I want to eliminate over-engineering and unnecessary abstractions, so that the code is easier to read and modify.

#### Acceptance Criteria

1. WHEN examining the repository layer THEN the system SHALL use direct database access patterns without factory patterns or dependency injection
2. WHEN reviewing error handling THEN the system SHALL have a single, consolidated error handling approach
3. WHEN looking at services THEN the system SHALL eliminate service orchestrators that add no value
4. WHEN examining middleware THEN the system SHALL consolidate similar middleware into single, focused implementations
5. WHEN reviewing constants THEN the system SHALL have all configuration in one or two well-organized files

### Requirement 3

**User Story:** As a developer, I want consistent patterns throughout the codebase, so that I can predict how different parts work.

#### Acceptance Criteria

1. WHEN examining CRUD operations THEN the system SHALL use consistent patterns across all repositories
2. WHEN reviewing error handling THEN the system SHALL use the same error classes and handling approach everywhere
3. WHEN looking at validation THEN the system SHALL use Zod schemas consistently for all input validation
4. WHEN examining async operations THEN the system SHALL use consistent async/await patterns without mixing callbacks
5. WHEN reviewing logging THEN the system SHALL use the same logger instance and format throughout

### Requirement 4

**User Story:** As a developer, I want to remove duplicate code and consolidate similar functionality, so that changes only need to be made in one place.

#### Acceptance Criteria

1. WHEN examining repositories THEN the system SHALL have no duplicate CRUD methods across different repositories
2. WHEN reviewing services THEN the system SHALL consolidate services that perform similar operations
3. WHEN looking at utilities THEN the system SHALL have no duplicate helper functions
4. WHEN examining types THEN the system SHALL have a single source of truth for shared type definitions
5. WHEN reviewing constants THEN the system SHALL have no duplicate configuration values

### Requirement 5

**User Story:** As a developer, I want clear separation of concerns, so that I know where to find and modify specific functionality.

#### Acceptance Criteria

1. WHEN examining the codebase THEN the system SHALL separate database operations (repositories) from business logic (services)
2. WHEN reviewing route handlers THEN the system SHALL keep handlers thin, delegating to services for business logic
3. WHEN looking at services THEN the system SHALL keep services focused on single domains (vehicles, expenses, sync, etc.)
4. WHEN examining utilities THEN the system SHALL contain only pure functions with no side effects
5. WHEN reviewing middleware THEN the system SHALL have each middleware focused on a single concern

### Requirement 6

**User Story:** As a developer, I want simplified testing approaches, so that tests are easy to write and maintain.

#### Acceptance Criteria

1. WHEN writing repository tests THEN the system SHALL allow direct instantiation with a test database
2. WHEN testing services THEN the system SHALL allow easy mocking of repository dependencies
3. WHEN examining test utilities THEN the system SHALL provide simple test helpers without complex setup
4. WHEN reviewing test files THEN the system SHALL have tests co-located with source files when appropriate
5. WHEN running tests THEN the system SHALL have fast, isolated tests that don't require complex teardown

### Requirement 7

**User Story:** As a developer, I want improved code organization for sync and backup functionality, so that these complex features are easier to understand.

#### Acceptance Criteria

1. WHEN examining sync services THEN the system SHALL consolidate Google Drive and Sheets operations into focused modules
2. WHEN reviewing backup logic THEN the system SHALL have clear separation between backup creation, validation, and restoration
3. WHEN looking at tracking services THEN the system SHALL consolidate activity and change tracking into a single service
4. WHEN examining sync orchestration THEN the system SHALL simplify the orchestration layer to only coordinate necessary operations
5. WHEN reviewing sync types THEN the system SHALL have all sync-related types in a single, well-organized file

### Requirement 8

**User Story:** As a developer, I want to eliminate unused or redundant code, so that the codebase is lean and maintainable.

#### Acceptance Criteria

1. WHEN examining the codebase THEN the system SHALL have no unused imports or exports
2. WHEN reviewing services THEN the system SHALL have no unused methods or functions
3. WHEN looking at types THEN the system SHALL have no unused type definitions
4. WHEN examining middleware THEN the system SHALL have no unused or commented-out middleware
5. WHEN reviewing utilities THEN the system SHALL have no dead code or deprecated functions

### Requirement 9

**User Story:** As a developer, I want better naming conventions, so that the purpose of each module is immediately clear.

#### Acceptance Criteria

1. WHEN examining file names THEN the system SHALL use clear, descriptive names that indicate purpose
2. WHEN reviewing function names THEN the system SHALL use verb-noun patterns that describe actions
3. WHEN looking at variable names THEN the system SHALL use meaningful names that indicate content
4. WHEN examining type names THEN the system SHALL use clear, descriptive names without abbreviations
5. WHEN reviewing module exports THEN the system SHALL have clear, consistent export patterns

### Requirement 10

**User Story:** As a developer, I want simplified configuration management, so that environment and application settings are easy to understand and modify.

#### Acceptance Criteria

1. WHEN examining configuration THEN the system SHALL have all environment variables validated in a single config module
2. WHEN reviewing constants THEN the system SHALL have all application constants in one or two well-organized files
3. WHEN looking at rate limits THEN the system SHALL have all rate limit configuration in a single location
4. WHEN examining validation limits THEN the system SHALL have all validation rules centralized
5. WHEN reviewing database configuration THEN the system SHALL have all database settings in one place
