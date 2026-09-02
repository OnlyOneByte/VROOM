# Requirements Document

## Introduction

This feature adds an Insurance Management module to VROOM. It uses a single `insurance_policies` table where one row represents one relationship with an insurer that can cover one or more vehicles. The many-to-many relationship between policies and vehicles is managed via an `insurance_policy_vehicles` junction table with cascade deletes in both directions. Each policy stores a `terms` JSON array of PolicyTerm objects representing renewal periods, plus denormalized `currentTermStart`/`currentTermEnd` columns for fast SQL queries. Vehicles store a `currentInsurancePolicyId` for quick active-policy lookups. The module covers document storage via Google Drive, a dedicated insurance dashboard within the vehicle detail page, and automatic term-to-expense linking.

## Glossary

- **Policy_Manager**: The backend subsystem (API routes, repository, and services) responsible for creating, updating, deleting, and querying insurance policies and their terms. The many-to-many relationship between policies and vehicles is managed via an `insurance_policy_vehicles` junction table with cascade deletes. Vehicles store a `currentInsurancePolicyId` for quick active-policy lookups.
- **Document_Store**: The subsystem that uploads, retrieves, and deletes insurance-related files (proof-of-insurance cards, policy PDFs) using the existing polymorphic photo/file infrastructure backed by Google Drive. Documents reference the policy ID as the entity ID, and may optionally reference a specific term ID within the policy.
- **Cost_Comparator**: (Deferred to a future iteration.) The subsystem that computes premium deltas between consecutive terms within a single policy and across policies for the same vehicle.
- **Insurance_Dashboard**: The frontend tab within the vehicle detail page that displays policies associated with the selected vehicle (via the `insurance_policy_vehicles` junction table), grouped by active/inactive insurer relationship, current term details, renewal history from the terms array, expiring-soon alerts using `currentTermEnd`, document viewing, and notes.
- **Expense_Linker**: The subsystem that auto-generates an expense record (category `financial`, tag `insurance`) when a term is added to a policy, using the term's `financeDetails.totalCost` and the term's `startDate` as the expense date. The expense stores both an `insurancePolicyId` FK (referencing the policy row) and an `insuranceTermId` text field (matching the term's `id` within the `terms` JSON array).
- **PolicyTerm**: An object within the `terms` JSON array representing a single coverage period. Expected TypeScript shape:
  ```typescript
  interface PolicyTerm {
    id: string;           // unique term ID (cuid)
    startDate: string;    // ISO date
    endDate: string;      // ISO date
    policyDetails: {
      policyNumber?: string;
      coverageDescription?: string;
      deductibleAmount?: number;
      coverageLimit?: number;
      agentName?: string;
      agentPhone?: string;
      agentEmail?: string;
    };
    financeDetails: {
      totalCost?: number;
      monthlyCost?: number;
      premiumFrequency?: string;
      paymentAmount?: number;
    };
  }
  ```
- **PolicyDetails**: A nested object within each PolicyTerm containing coverage-related flexible fields (policyNumber, coverageDescription, deductibleAmount, coverageLimit, agentName, agentPhone, agentEmail).
- **FinanceDetails**: A nested object within each PolicyTerm containing cost/payment-related flexible fields (totalCost, monthlyCost, premiumFrequency, paymentAmount).

## Requirements

### Requirement 1: Single-Table Policy Schema with Terms JSON

**User Story:** As a vehicle owner, I want to record my insurance policy terms including cost, coverage, company, and timing within a single policy per insurer that can cover one or more vehicles, so that renewal history is preserved as an array of terms rather than separate rows.

#### Acceptance Criteria

1. THE Policy_Manager SHALL store the following columns per policy: `id` (text, primary key, cuid), `company` (text, required), `isActive` (integer as boolean, default true), `currentTermStart` (integer as timestamp, nullable), `currentTermEnd` (integer as timestamp, nullable), `terms` (text as JSON array of PolicyTerm objects), `notes` (text, nullable), `createdAt` (integer as timestamp), and `updatedAt` (integer as timestamp).
2. THE Policy_Manager SHALL create an `insurance_policy_vehicles` junction table with columns: `policyId` (text, FK to `insurance_policies.id` with cascade delete), `vehicleId` (text, FK to `vehicles.id` with cascade delete), and a composite primary key of (`policyId`, `vehicleId`).
3. THE Policy_Manager SHALL store the `terms` column using the established `text('terms', { mode: 'json' })` Drizzle pattern.
4. WHEN a policy is created, THE Policy_Manager SHALL require at least one vehicle ID and insert corresponding rows into the junction table.
5. WHEN a policy is created, THE Policy_Manager SHALL require at least one PolicyTerm object in the `terms` array.
6. WHEN a policy is created or updated with vehicle associations, THE Policy_Manager SHALL validate that all referenced vehicle IDs exist and belong to the authenticated user.
7. WHEN a term is added or updated within a policy, THE Policy_Manager SHALL validate that the term's `startDate` is before the term's `endDate`.
8. WHEN a term is added or updated with a `policyDetails` object, THE Policy_Manager SHALL validate that `deductibleAmount` (if present) is a positive number.
9. WHEN a term is added or updated with a `policyDetails` object, THE Policy_Manager SHALL validate that `coverageLimit` (if present) is a positive number.
10. WHEN a term is added or updated with a `financeDetails` object, THE Policy_Manager SHALL validate that `totalCost` (if present) is a non-negative number.
11. WHEN a term is added or updated with a `financeDetails` object, THE Policy_Manager SHALL validate that `monthlyCost` (if present) is a non-negative number.
12. WHEN a term is added to or updated within a policy, THE Policy_Manager SHALL sync `currentTermStart` and `currentTermEnd` to the `startDate` and `endDate` of the latest term (by `endDate`) in the `terms` array.
13. WHEN a policy is created or updated as active, THE Policy_Manager SHALL update the `currentInsurancePolicyId` field on each associated vehicle (via the junction table) to reference this policy.
14. THE Policy_Manager SHALL add a nullable `currentInsurancePolicyId` (text) column to the vehicles table for quick active-policy lookups.
15. WHEN a policy is deactivated or deleted, THE Policy_Manager SHALL clear the `currentInsurancePolicyId` on any vehicles that referenced it.
16. WHEN a policy is updated, THE Policy_Manager SHALL apply the same validation rules as creation to all provided fields and terms.

### Requirement 2: Document Storage

**User Story:** As a vehicle owner, I want to upload and retrieve proof-of-insurance cards and policy PDFs, so that I have quick access to my insurance documents when needed.

#### Acceptance Criteria

1. THE Document_Store SHALL accept file uploads for a policy using the existing polymorphic photo entity system with entity type `insurance_policy` and the policy ID as the entity ID.
2. WHEN a file is uploaded for a policy, THE Document_Store SHALL accept an optional `termId` metadata field to associate the document with a specific term within the policy.
3. WHEN a file is uploaded for a policy, THE Document_Store SHALL accept JPEG, PNG, WebP images and PDF files (MIME type `application/pdf`).
4. WHEN a file exceeding 10 MB is uploaded, THE Document_Store SHALL reject the upload with a descriptive error message.
5. WHEN a file is uploaded, THE Document_Store SHALL store the file in Google Drive under a flat folder structure: `VROOM/{userName}/Insurance Documents/`, not tied to a specific vehicle since policies can span multiple vehicles.
6. THE Document_Store SHALL return a list of all documents for a given policy, ordered by upload date.
7. WHEN a policy is deleted, THE Document_Store SHALL delete all associated documents from both the database and Google Drive.
8. THE Document_Store SHALL extend the `validateEntityOwnership` helper in the photo system to support the `insurance_policy` entity type, verifying that the authenticated user owns at least one vehicle associated with the policy via the junction table.
9. THE Document_Store SHALL extend the `resolveEntityDriveFolder` helper to create the insurance-specific flat folder structure.

### Requirement 3: Insurance Dashboard

**User Story:** As a vehicle owner, I want a dedicated insurance section within my vehicle detail page that shows all my policies grouped by insurer, current term details, renewal history, and expiring-soon alerts in one place, so that I can manage my insurance efficiently.

#### Acceptance Criteria

1. THE Insurance_Dashboard SHALL display a list of all policies associated with the selected vehicle (via the `insurance_policy_vehicles` junction table), grouped into active and inactive insurer relationship sections based on the policy's `isActive` field.
2. THE Insurance_Dashboard SHALL display the company name, current term's policy number (from the latest term's `policyDetails.policyNumber`), current term's total cost (from the latest term's `financeDetails.totalCost`), current term's monthly cost (from the latest term's `financeDetails.monthlyCost`), and current term dates (`currentTermStart` to `currentTermEnd`) for each policy.
3. THE Insurance_Dashboard SHALL display the `notes` field for each policy when present.
4. THE Insurance_Dashboard SHALL display expiring-soon alerts for active policies where `currentTermEnd` is within 30 days, showing the number of days remaining.
5. THE Insurance_Dashboard SHALL display the renewal history for each policy by listing all terms from the `terms` array in reverse chronological order.
6. THE Insurance_Dashboard SHALL provide a "Renew" action on active policies that pre-fills a new term form with the previous term's `policyDetails` and `financeDetails` data.
7. THE Insurance_Dashboard SHALL provide a document viewer that lists all uploaded documents for a selected policy with thumbnail previews for images and download links for PDFs.
8. THE Insurance_Dashboard SHALL provide a cost comparison view showing consecutive terms with premium deltas and coverage changes (deferred to a future iteration).
9. WHEN no policies exist for a vehicle, THE Insurance_Dashboard SHALL display an empty state with a prompt to add the first policy.
10. THE Insurance_Dashboard SHALL provide forms to create, edit, and delete policies, and to add or edit terms within a policy, with validation feedback.
11. THE Insurance_Dashboard SHALL be accessible as a tab within the existing vehicle detail page navigation, consistent with how other vehicle tabs (expenses, financing, etc.) are accessed.

### Requirement 4: Master Insurance Page

**User Story:** As a vehicle owner, I want a top-level insurance page in the main navigation that shows all my policies across all vehicles in one place, so that I can get a complete overview of my insurance coverage.

#### Acceptance Criteria

1. THE Insurance_Dashboard SHALL provide a master insurance page accessible via the main navigation bar, positioned between "Expenses" and "Analytics".
2. THE master insurance page SHALL display all policies for the authenticated user (queried via the user's vehicles through the junction table), grouped into active and inactive sections.
3. THE master insurance page SHALL display each policy's company name, associated vehicle names, current term summary (dates, cost), and expiring-soon alerts.
4. THE master insurance page SHALL allow the user to create a new policy, selecting one or more vehicles during creation.
5. THE master insurance page SHALL allow the user to click into a policy to view its full details, terms, and documents.
6. THE master insurance page SHALL be accessible at the `/insurance` route.

### Requirement 5: Term-to-Expense Linking

**User Story:** As a vehicle owner, I want insurance term costs to automatically appear in my expense tracking, so that my total cost of ownership is accurate without manual data entry.

#### Acceptance Criteria

1. WHEN a new term is added to a policy (including the initial term at policy creation) with a `financeDetails.totalCost` value, THE Expense_Linker SHALL auto-generate a single expense record with category `financial`, tag `insurance`, the term's `financeDetails.totalCost` as the expense amount, and the term's `startDate` as the expense date.
2. THE Expense_Linker SHALL include the term dates in the expense description for clarity (e.g., "Insurance: Company Name (2024-01-01 to 2025-01-01)").
3. THE Expense_Linker SHALL store both an `insurancePolicyId` foreign key (referencing the policy row) and an `insuranceTermId` text field (matching the term's `id` within the `terms` JSON array) on the expense record.
4. WHEN a policy is deleted, THE Expense_Linker SHALL nullify the `insurancePolicyId` and `insuranceTermId` on any linked expense records rather than deleting the expenses.
5. WHEN an expense is linked to a policy and term, THE Expense_Linker SHALL include both the policy and term references in expense query responses so the frontend can display the association.
6. WHEN a term is added to a policy without a `financeDetails.totalCost` value, THE Expense_Linker SHALL skip expense generation for that term.
