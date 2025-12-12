# Requirements Document

## Introduction

This document outlines the requirements for refactoring the VROOM backend codebase to reduce code duplication, improve organization, and enhance maintainability. The backend currently contains significant duplication across repositories, services, middleware, and route handlers that can be consolidated without losing functionality.

## Glossary

- **Repository**: Data access layer classes that handle database operations for specific entities
- **Service**: Business logic layer classes that orchestrate operations across multiple repositories
- **Middleware**: Hono middleware functions that process requests before reaching route handlers
- **Route Handler**: HTTP endpoint handlers that process API requests
- **Error Handler**: Functions that process and format errors for API responses
- **Validation Schema**: Zod schemas used to validate request data
- **Query Builder**: Utility class for constructing database queries

## Requirements

### Requirement 1

**User Story:** As a developer, I want repository classes to share common patterns without duplication, so that I can maintain consistent data access logic across all entities.

#### Acceptance Criteria

1. WHEN a repository needs to find records by user ID THEN the system SHALL provide a reusable method that handles user ownership verification
2. WHEN a repository needs to find records with filters THEN the system SHALL provide a unified filtering interface that works across all entity types
3. WHEN a repository performs error handling THEN the system SHALL use consistent error transformation patterns across all repositories
4. WHEN a repository needs to validate foreign key relationships THEN the system SHALL provide reusable validation methods
5. THE system SHALL eliminate duplicate findByUserId, findByVehicleId, and similar methods across repositories

### Requirement 2

**User Story:** As a developer, I want route handlers to share common validation and response patterns, so that I can reduce boilerplate code and maintain API consistency.

#### Acceptance Criteria

1. WHEN a route handler validates request parameters THEN the system SHALL use shared validation schema builders
2. WHEN a route handler returns a success response THEN the system SHALL use a consistent response format across all endpoints
3. WHEN a route handler checks resource ownership THEN the system SHALL use a reusable ownership verification utility
4. WHEN a route handler processes query parameters THEN the system SHALL use shared query parameter parsing logic
5. THE system SHALL eliminate duplicate param schemas (vehicleParamsSchema, expenseParamsSchema, etc.) across route files

### Requirement 3

**User Story:** As a developer, I want error handling to be centralized and consistent, so that I can maintain uniform error responses across the API.

#### Acceptance Criteria

1. WHEN an error occurs in any layer THEN the system SHALL transform it using centralized error handling logic
2. WHEN a database error occurs THEN the system SHALL map SQLite errors to appropriate HTTP status codes consistently
3. WHEN a validation error occurs THEN the system SHALL format validation messages uniformly
4. THE system SHALL eliminate duplicate error handling patterns in middleware and route handlers
5. THE system SHALL provide a single source of truth for error-to-status-code mappings

### Requirement 4

**User Story:** As a developer, I want service classes to avoid duplicating calculation logic, so that I can maintain business rules in one place.

#### Acceptance Criteria

1. WHEN calculating fuel efficiency THEN the system SHALL use a single implementation across all services
2. WHEN calculating cost per mile THEN the system SHALL use a single implementation across all services
3. WHEN grouping data by time periods THEN the system SHALL use a shared date grouping utility
4. WHEN formatting currency or numbers THEN the system SHALL use shared formatting utilities
5. THE system SHALL eliminate duplicate calculation methods in ExpenseCalculator and analytics services

### Requirement 5

**User Story:** As a developer, I want middleware to be composable and reusable, so that I can apply common functionality without duplication.

#### Acceptance Criteria

1. WHEN applying authentication to routes THEN the system SHALL use a single auth middleware implementation
2. WHEN applying rate limiting to routes THEN the system SHALL use configurable rate limiter instances
3. WHEN tracking data changes THEN the system SHALL use a single change tracking middleware
4. WHEN handling errors THEN the system SHALL use a single error handler middleware
5. THE system SHALL eliminate duplicate middleware application patterns across route files

### Requirement 6

**User Story:** As a developer, I want the codebase to follow a clear organizational structure, so that I can easily locate and modify code.

#### Acceptance Criteria

1. WHEN organizing repositories THEN the system SHALL group related repositories in logical subdirectories
2. WHEN organizing services THEN the system SHALL separate domain services from infrastructure services
3. WHEN organizing utilities THEN the system SHALL group utilities by functional area (validation, formatting, calculations)
4. WHEN organizing routes THEN the system SHALL maintain consistent nesting and naming conventions
5. THE system SHALL provide clear separation between layers (data access, business logic, presentation)

### Requirement 7

**User Story:** As a developer, I want validation schemas to be reusable and composable, so that I can avoid duplicating validation logic.

#### Acceptance Criteria

1. WHEN validating common fields THEN the system SHALL provide reusable field validators (email, date, currency, etc.)
2. WHEN validating entity IDs THEN the system SHALL use a single ID validation schema
3. WHEN validating pagination parameters THEN the system SHALL use a shared pagination schema
4. WHEN validating date ranges THEN the system SHALL use a shared date range schema
5. THE system SHALL eliminate duplicate validation schemas across route files

### Requirement 8

**User Story:** As a developer, I want database query patterns to be abstracted, so that I can avoid writing repetitive query code.

#### Acceptance Criteria

1. WHEN querying with filters THEN the system SHALL use a query builder that handles common filter patterns
2. WHEN querying with pagination THEN the system SHALL use a query builder that handles offset/limit consistently
3. WHEN querying with sorting THEN the system SHALL use a query builder that handles order by clauses
4. WHEN querying with joins THEN the system SHALL use a query builder that handles common join patterns
5. THE system SHALL provide type-safe query building methods that work across all repositories

### Requirement 9

**User Story:** As a developer, I want model definitions to be centralized and automatically derived, so that I can avoid duplicating type definitions across the stack.

#### Acceptance Criteria

1. WHEN defining a database table schema THEN the system SHALL automatically generate TypeScript types for that entity
2. WHEN creating validation schemas THEN the system SHALL derive them from the database schema using drizzle-zod
3. WHEN defining API input types THEN the system SHALL derive them from the database schema with appropriate omissions
4. WHEN defining API output types THEN the system SHALL use the same base types as the database schema
5. THE system SHALL eliminate manual duplication of model properties across schema, types, and validation files
