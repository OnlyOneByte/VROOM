# Requirements Document

## Introduction

This document outlines the requirements for migrating the VROOM frontend application to align with the comprehensive backend rewrite. The backend has undergone significant simplification and refactoring, introducing breaking changes that require frontend updates. The primary goals are to ensure API compatibility, fix field name mismatches, implement missing analytics endpoints, and maintain feature parity while improving code quality.

## Glossary

- **Frontend**: The VROOM Car Tracker client application built with SvelteKit
- **Backend**: The VROOM Car Tracker API server built with Hono and Bun
- **API Contract**: The interface specification between frontend and backend including endpoints, request/response formats, and field names
- **Expense Entity**: A record of vehicle-related costs including fuel, maintenance, insurance, etc.
- **Financing Entity**: A record of vehicle loan or lease information
- **Analytics Service**: Backend service providing aggregated statistics and trends
- **Field Mapping**: The correspondence between frontend property names and backend database column names

## Requirements

### Requirement 1: API Field Name Compatibility

**User Story:** As a user, I want to create and edit expenses without errors, so that I can accurately track my vehicle costs.

#### Acceptance Criteria

1. WHEN the Frontend submits expense data to the Backend THEN the Frontend SHALL use field name `expenseAmount` instead of `amount`
2. WHEN the Frontend submits fuel expense data to the Backend THEN the Frontend SHALL use field name `fuelAmount` instead of `volume`
3. WHEN the Frontend receives expense data from the Backend THEN the Frontend SHALL map `expenseAmount` to `amount` for internal use
4. WHEN the Frontend receives expense data from the Backend THEN the Frontend SHALL map `fuelAmount` to `volume` for internal use
5. WHEN the Frontend handles electric vehicle charging expenses THEN the Frontend SHALL store charge data in the `fuelAmount` field with appropriate unit conversion

### Requirement 2: Analytics Endpoint Implementation

**User Story:** As a user, I want to view dashboard analytics and trends, so that I can understand my spending patterns across all vehicles.

#### Acceptance Criteria

1. WHEN the Frontend requests dashboard analytics THEN the Backend SHALL provide aggregated expense data grouped by time period
2. WHEN the Frontend requests vehicle-specific analytics THEN the Backend SHALL provide expense trends and category breakdowns for that vehicle
3. WHEN the Backend calculates analytics THEN the Backend SHALL support grouping by day, week, month, or year
4. WHEN the Backend returns analytics data THEN the Backend SHALL include monthly trends, category breakdowns, fuel efficiency metrics, and cost-per-mile calculations
5. WHEN the Frontend requests analytics with date range filters THEN the Backend SHALL filter data within the specified start and end dates

### Requirement 3: Expense Type System Migration

**User Story:** As a user, I want my expense categorization to work correctly, so that my historical data remains accessible and new expenses are properly categorized.

#### Acceptance Criteria

1. WHEN the Frontend displays expenses THEN the Frontend SHALL use the `tags` array field instead of the deprecated `type` field
2. WHEN the Frontend creates new expenses THEN the Frontend SHALL populate the `tags` array with user-selected tags
3. WHEN the Frontend reads legacy expenses with `type` field THEN the Frontend SHALL gracefully handle missing `tags` by treating it as an empty array
4. WHEN the Backend stores expenses THEN the Backend SHALL persist `tags` as a JSON array in the database
5. WHEN the Frontend filters expenses by tags THEN the Frontend SHALL match any tag in the array against the filter criteria

### Requirement 4: Financing Calculations Client-Side Implementation

**User Story:** As a user, I want to view amortization schedules and payment projections instantly, so that I can make informed financial decisions without waiting for server responses.

#### Acceptance Criteria

1. WHEN the Frontend needs to generate an amortization schedule THEN the Frontend SHALL calculate it locally using the `generateAmortizationSchedule` function
2. WHEN the Frontend validates loan terms THEN the Frontend SHALL use the `validateLoanTerms` function to check principal, APR, and term validity
3. WHEN the Frontend calculates payment breakdowns THEN the Frontend SHALL use the `calculatePaymentBreakdown` function for principal and interest amounts
4. WHEN the Frontend displays financing data THEN the Frontend SHALL NOT make API calls to `/api/financing/:financingId/schedule`
5. WHEN the Frontend performs financing calculations THEN the Frontend SHALL handle edge cases including zero APR, completed loans, and invalid input data

### Requirement 5: API Versioning Compliance

**User Story:** As a developer, I want all API calls to use versioned endpoints, so that the application remains compatible with future backend changes.

#### Acceptance Criteria

1. WHEN the Frontend makes any API request THEN the Frontend SHALL use the `/api/v1/` prefix for all endpoints
2. WHEN the Frontend encounters a redirect from unversioned to versioned endpoints THEN the Frontend SHALL follow the redirect transparently
3. WHEN the Backend receives requests to unversioned endpoints THEN the Backend SHALL redirect to `/api/v1/` equivalents with HTTP 308 status
4. WHEN the Frontend handles API errors THEN the Frontend SHALL log the full request URL including version prefix for debugging
5. WHEN new API versions are introduced THEN the Frontend SHALL continue using `/api/v1/` until explicitly migrated

### Requirement 6: Error Response Format Consistency

**User Story:** As a user, I want clear error messages when operations fail, so that I understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN the Backend returns an error response THEN the Backend SHALL use the format `{ success: false, error: { code, message, details } }`
2. WHEN the Frontend receives an error response THEN the Frontend SHALL extract the error message from the `error.message` field
3. WHEN the Frontend displays error notifications THEN the Frontend SHALL show user-friendly messages derived from error codes
4. WHEN validation errors occur THEN the Backend SHALL include field-specific details in the `error.details` object
5. WHEN the Frontend handles validation errors THEN the Frontend SHALL map error details to form field error messages

### Requirement 7: Sync and Backup Compatibility

**User Story:** As a user, I want to backup and restore my data reliably, so that I never lose my vehicle expense history.

#### Acceptance Criteria

1. WHEN the Frontend requests a backup download THEN the Backend SHALL generate a ZIP file containing all user data in CSV format
2. WHEN the Frontend uploads a backup for restore THEN the Backend SHALL validate the backup structure and user ID before processing
3. WHEN the Backend processes a restore operation THEN the Backend SHALL support preview, replace, and merge modes
4. WHEN the Frontend displays sync status THEN the Frontend SHALL show separate timestamps for Google Sheets sync and Google Drive backup
5. WHEN the Backend completes a sync operation THEN the Backend SHALL update the `lastSyncDate` or `lastBackupDate` in user settings

### Requirement 8: Vehicle Statistics Endpoint Compatibility

**User Story:** As a user, I want to see accurate vehicle statistics, so that I can monitor fuel efficiency and maintenance costs over time.

#### Acceptance Criteria

1. WHEN the Frontend requests vehicle statistics THEN the Backend SHALL return data including total mileage, current mileage, fuel consumed, average MPG, and cost per mile
2. WHEN the Backend calculates vehicle statistics THEN the Backend SHALL filter expenses by the requested time period (7d, 30d, 90d, 1y, all)
3. WHEN the Backend computes average MPG THEN the Backend SHALL use consecutive fuel expense mileage readings to calculate efficiency
4. WHEN the Frontend displays vehicle statistics THEN the Frontend SHALL handle null values gracefully for vehicles without sufficient data
5. WHEN the Backend returns statistics THEN the Backend SHALL include the requested period in the response for frontend validation

### Requirement 9: Insurance Policy Expiration Alerts

**User Story:** As a user, I want to be notified when insurance policies are expiring soon, so that I can renew them before they lapse.

#### Acceptance Criteria

1. WHEN the Frontend requests insurance policies for a vehicle THEN the Backend SHALL calculate days until expiration for each policy
2. WHEN a policy expires within 30 days THEN the Backend SHALL include an expiration alert with severity level
3. WHEN a policy expires within 7 days THEN the Backend SHALL mark the alert severity as high
4. WHEN the Frontend displays insurance policies THEN the Frontend SHALL show expiration warnings prominently for policies with alerts
5. WHEN the Backend calculates expiration dates THEN the Backend SHALL use the policy `endDate` field and current server time

### Requirement 10: Payment History Retrieval

**User Story:** As a user, I want to view my complete financing payment history, so that I can track my loan or lease progress over time.

#### Acceptance Criteria

1. WHEN the Frontend requests payment history for a vehicle THEN the Backend SHALL return all payments sorted by date descending
2. WHEN the Backend retrieves payment history THEN the Backend SHALL join financing and vehicle tables to verify user ownership
3. WHEN no financing exists for a vehicle THEN the Backend SHALL return an empty array with a descriptive message
4. WHEN the Frontend displays payment history THEN the Frontend SHALL show payment number, date, amount, principal, interest, and remaining balance
5. WHEN the Backend returns payment data THEN the Backend SHALL include the `isScheduled` flag to distinguish actual from projected payments

### Requirement 11: Settings Management Consistency

**User Story:** As a user, I want my preferences to persist correctly, so that my unit selections and sync configurations are always applied.

#### Acceptance Criteria

1. WHEN the Frontend updates user settings THEN the Frontend SHALL send only changed fields to minimize data transfer
2. WHEN the Backend receives settings updates THEN the Backend SHALL validate all numeric fields against configured limits
3. WHEN the Frontend loads settings THEN the Frontend SHALL create default settings if none exist for the user
4. WHEN the Backend updates sync configuration THEN the Backend SHALL use the dedicated `/api/v1/sync/configure` endpoint
5. WHEN settings include sync preferences THEN the Backend SHALL validate `syncInactivityMinutes` is between 1 and 30

### Requirement 12: Offline Expense Queue Synchronization

**User Story:** As a user, I want expenses created while offline to sync automatically when I reconnect, so that I never lose data due to connectivity issues.

#### Acceptance Criteria

1. WHEN the Frontend creates an expense while offline THEN the Frontend SHALL store it in local storage with a unique offline ID
2. WHEN the Frontend regains connectivity THEN the Frontend SHALL attempt to sync all unsynced offline expenses
3. WHEN the Frontend syncs an offline expense THEN the Frontend SHALL send the correct field names (`expenseAmount`, `fuelAmount`) to the Backend
4. WHEN the Backend receives a synced offline expense THEN the Backend SHALL validate it using the same rules as online expenses
5. WHEN an offline expense sync fails THEN the Frontend SHALL retain it in the queue and retry with exponential backoff

### Requirement 13: Vehicle Financing Endpoint Consistency

**User Story:** As a user, I want to add and update vehicle financing information, so that I can track loans and leases accurately.

#### Acceptance Criteria

1. WHEN the Frontend creates or updates financing THEN the Frontend SHALL use the endpoint `/api/v1/financing/vehicles/:vehicleId/financing`
2. WHEN the Backend receives financing data THEN the Backend SHALL validate loan terms if `financingType` is `loan` and `apr` is provided
3. WHEN financing already exists for a vehicle THEN the Backend SHALL update the existing record instead of creating a duplicate
4. WHEN the Frontend retrieves financing for a vehicle THEN the Backend SHALL return null if no financing exists
5. WHEN the Backend creates financing THEN the Backend SHALL set `currentBalance` equal to `originalAmount` initially

### Requirement 14: Expense Category Metadata Endpoint

**User Story:** As a user, I want to see descriptive labels for expense categories, so that I understand what each category represents.

#### Acceptance Criteria

1. WHEN the Frontend needs expense category information THEN the Frontend SHALL request it from `/api/v1/expenses/categories`
2. WHEN the Backend returns category data THEN the Backend SHALL include value, label, and description for each category
3. WHEN the Frontend displays category selectors THEN the Frontend SHALL use the label from the Backend response
4. WHEN the Frontend shows category descriptions THEN the Frontend SHALL use the description from the Backend response
5. WHEN the Backend defines new categories THEN the Frontend SHALL automatically display them without code changes

### Requirement 15: Authentication Session Refresh

**User Story:** As a user, I want my session to remain active during extended use, so that I don't get logged out unexpectedly.

#### Acceptance Criteria

1. WHEN a user session is within 24 hours of expiration THEN the Backend SHALL automatically create a new session
2. WHEN the Backend refreshes a session THEN the Backend SHALL invalidate the old session and set a new session cookie
3. WHEN the Frontend makes authenticated requests THEN the Backend SHALL validate and refresh sessions transparently
4. WHEN session refresh fails THEN the Backend SHALL return a 401 error and the Frontend SHALL redirect to login
5. WHEN the Frontend explicitly requests session refresh THEN the Backend SHALL use the `/api/v1/auth/refresh` endpoint

### Requirement 16: Data Validation Consistency

**User Story:** As a developer, I want validation rules to match between frontend and backend, so that users receive immediate feedback and server errors are prevented.

#### Acceptance Criteria

1. WHEN the Frontend validates vehicle data THEN the Frontend SHALL enforce the same limits as Backend CONFIG.validation.vehicle
2. WHEN the Frontend validates expense data THEN the Frontend SHALL enforce the same limits as Backend CONFIG.validation.expense
3. WHEN the Frontend validates financing data THEN the Frontend SHALL enforce the same limits as Backend CONFIG.validation.financing
4. WHEN fuel expenses are submitted THEN both Frontend and Backend SHALL require `mileage` and `fuelAmount` fields
5. WHEN validation fails on the Backend THEN the Frontend SHALL display field-specific error messages from the response

### Requirement 17: Type Definition Synchronization

**User Story:** As a developer, I want TypeScript types to match between frontend and backend, so that type errors are caught at compile time.

#### Acceptance Criteria

1. WHEN the Backend defines database schema types THEN the Frontend SHALL mirror those types in `lib/types/index.ts`
2. WHEN the Backend uses enum types THEN the Frontend SHALL define matching string literal union types
3. WHEN the Backend changes a field type THEN the Frontend SHALL update corresponding TypeScript interfaces
4. WHEN the Frontend makes API calls THEN TypeScript SHALL enforce correct request and response types
5. WHEN type mismatches exist THEN the TypeScript compiler SHALL report errors during build

### Requirement 18: Expense Query Parameter Compatibility

**User Story:** As a user, I want to filter expenses by vehicle, category, tags, and date range, so that I can find specific expenses quickly.

#### Acceptance Criteria

1. WHEN the Frontend filters expenses by vehicle THEN the Frontend SHALL use query parameter `vehicleId`
2. WHEN the Frontend filters expenses by category THEN the Frontend SHALL use query parameter `category`
3. WHEN the Frontend filters expenses by tags THEN the Frontend SHALL send comma-separated tags in query parameter `tags`
4. WHEN the Frontend filters expenses by date range THEN the Frontend SHALL use query parameters `startDate` and `endDate` as ISO date strings
5. WHEN the Backend receives expense query parameters THEN the Backend SHALL parse and apply all filters correctly

### Requirement 19: Financing Payment Recording

**User Story:** As a user, I want to record financing payments, so that I can track my loan or lease balance over time.

#### Acceptance Criteria

1. WHEN the Frontend records a payment THEN the Frontend SHALL use endpoint `/api/v1/financing/:financingId/payment`
2. WHEN the Backend receives a payment record THEN the Backend SHALL calculate principal amount, interest amount, and remaining balance
3. WHEN a payment reduces balance to zero THEN the Backend SHALL mark the financing as completed with `isActive` set to false
4. WHEN the Frontend retrieves payment history THEN the Backend SHALL return payments sorted by date descending
5. WHEN the Backend creates a payment record THEN the Backend SHALL increment the payment number based on existing payment count

### Requirement 20: Google Drive Integration Compatibility

**User Story:** As a user, I want to backup my data to Google Drive automatically, so that my information is safely stored in the cloud.

#### Acceptance Criteria

1. WHEN the Frontend initializes Google Drive THEN the Backend SHALL create a folder structure including Receipts, Maintenance Records, Vehicle Photos, and Backups
2. WHEN the Backend uploads a backup to Google Drive THEN the Backend SHALL place it in the Backups subfolder
3. WHEN the Frontend lists available backups THEN the Backend SHALL return files from the user's Google Drive Backups folder
4. WHEN the Frontend downloads a backup from Drive THEN the Backend SHALL stream the file with appropriate Content-Disposition headers
5. WHEN the Backend deletes old backups THEN the Backend SHALL respect the user's `googleDriveBackupRetentionCount` setting
