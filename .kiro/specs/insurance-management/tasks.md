# Implementation Plan: Insurance Management

## Overview

Replace the existing single-row-per-policy insurance system with a multi-term, multi-vehicle insurance management module. Implementation proceeds bottom-up: schema migration → backend repository/routes → photo system extensions → frontend API service → frontend components → master page → navigation wiring → end-to-end verification.

## Tasks

- [x] 1. Database schema migration and config updates
  - [x] 1.1 Update Drizzle schema with new insurance tables and column additions
    - Replace existing `insurancePolicies` table definition in `backend/src/db/schema.ts` with the new schema (id, company, isActive, currentTermStart, currentTermEnd, terms JSON, notes, createdAt, updatedAt)
    - Add `insurancePolicyVehicles` junction table with composite PK and cascade deletes
    - Add `currentInsurancePolicyId` (text, nullable) column to `vehicles` table
    - Add `insurancePolicyId` and `insuranceTermId` (text, nullable) columns to `expenses` table
    - Add `missedFillup` (integer, boolean mode, NOT NULL, default false) column to `expenses` table — allows users to flag fill-ups where a previous fill-up was missed, so MPG calculations can skip that entry
    - Add `'insurance_policy'` to the `PhotoEntityType` union type
    - _Requirements: 1.1, 1.2, 1.14, 5.3_

  - [x] 1.2 Generate the Drizzle migration
    - Run `bun run db:generate` to create the migration SQL
    - Review the generated SQL file to confirm it matches intent
    - _Requirements: 1.1, 1.2, 1.14_

  - [x] 1.3 Update backend config and validation constants
    - Update `CONFIG.validation.insurance` in `backend/src/config.ts` with: `maxTerms: 50`, `notesMaxLength: 2000`, `coverageDescriptionMaxLength: 500`, `agentNameMaxLength: 100`, `agentPhoneMaxLength: 30`, `agentEmailMaxLength: 100`, `premiumFrequencyMaxLength: 50`
    - Update `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` for the new schema in `backend/src/config.ts`
    - _Requirements: 1.1_

  - [x] 1.4 Write migration test for the new schema
    - Add `backend/src/db/__tests__/migration-XXXX.test.ts` following existing pattern (determine XXXX from the generated migration file number)
    - Update expected tables list in `migration-general.test.ts` to include `insurance_policy_vehicles`
    - Verify `insurance_policies` table has correct columns and types
    - Verify `insurance_policy_vehicles` junction table exists with composite PK
    - Verify `vehicles` table has `current_insurance_policy_id` column
    - Verify `expenses` table has `insurance_policy_id` and `insurance_term_id` columns
    - Verify seed data survives the migration
    - _Requirements: 1.1, 1.2, 1.14_

  - [x] 1.5 Checkpoint — Run `bun run all:fix && bun run validate` in `backend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 2. Backend Zod validation schemas
  - [x] 2.1 Create Zod schemas for policy and term validation
    - Add `policyDetailsSchema`, `financeDetailsSchema`, `policyTermSchema` to `backend/src/utils/validation.ts` (or a new `backend/src/api/insurance/validation.ts`)
    - Add `createPolicySchema` with company, vehicleIds (min 1), terms (min 1), notes, isActive
    - Add `updatePolicySchema` for partial updates
    - Add `addTermSchema` for single term addition
    - Add `updateTermSchema` for term updates
    - Enforce: startDate < endDate (refine), deductibleAmount > 0, coverageLimit > 0, totalCost >= 0, monthlyCost >= 0
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.16_

  - [x] 2.2 Write property test: Term field validation (Property 4)
    - **Property 4: Term field validation**
    - Create `backend/src/api/insurance/__tests__/insurance-validation.property.test.ts`
    - Create shared generators in `backend/src/api/insurance/__tests__/insurance-test-generators.ts`
    - For any term with startDate >= endDate, or invalid numeric fields, the schema should reject; for valid terms, it should accept
    - **Validates: Requirements 1.7, 1.8, 1.9, 1.10, 1.11**

  - [x] 2.3 Checkpoint — Run `bun run all:fix && bun run validate` in `backend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Insurance repository implementation
  - [x] 3.1 Implement the insurance repository (`backend/src/api/insurance/repository.ts`)
    - Replace existing repository with new implementation
    - Implement `create(data, userId)` — insert policy + junction rows + sync denormalized fields + create expense (all in transaction)
    - Implement `findById(id)` — single policy with parsed terms and vehicleIds from junction
    - Implement `findByVehicleId(vehicleId)` — policies via junction join
    - Implement `findByUserId(userId)` — all policies for user via vehicle → junction join
    - Implement `update(id, data, userId)` — update policy, re-sync vehicle associations, re-sync denormalized fields
    - Implement `addTerm(policyId, term, userId)` — append term to JSON, sync denormalized columns, create expense if totalCost present
    - Implement `updateTerm(policyId, termId, termData, userId)` — update specific term in JSON, re-sync denormalized columns
    - Implement `delete(id, userId)` — delete policy, clear `currentInsurancePolicyId` on vehicles, nullify expense FKs
    - Implement `findExpiringPolicies(userId, daysFromNow)` — active policies where currentTermEnd within N days
    - Helper: `syncDenormalizedFields(policy)` — set currentTermStart/currentTermEnd from latest term by endDate
    - Helper: `syncVehicleReferences(policyId, vehicleIds, isActive)` — update currentInsurancePolicyId on vehicles
    - Helper: `createExpenseForTerm(policy, term, userId)` — create expense if financeDetails.totalCost is defined
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.12, 1.13, 1.15, 5.1, 5.2, 5.3, 5.4, 5.6_

  - [x] 3.2 Write property test: Policy creation round-trip (Property 1)
    - **Property 1: Policy creation round-trip**
    - For any valid policy input, creating and retrieving by ID returns matching fields and deserialized terms
    - **Validates: Requirements 1.1, 1.3**

  - [x] 3.3 Write property test: Junction table integrity (Property 2)
    - **Property 2: Junction table integrity**
    - For any policy created with N vehicle IDs, junction table has exactly N rows with matching set
    - **Validates: Requirements 1.2**

  - [x] 3.4 Write property test: Vehicle ownership validation (Property 3)
    - **Property 3: Vehicle ownership validation**
    - For any request with a vehicleId not belonging to the user, the system rejects and DB is unchanged
    - **Validates: Requirements 1.6**

  - [x] 3.5 Write property test: Denormalized field sync invariant (Property 5)
    - **Property 5: Denormalized field sync invariant**
    - After any term addition/update, currentTermEnd equals max endDate across terms, currentTermStart equals startDate of that term
    - **Validates: Requirements 1.12**

  - [x] 3.6 Write property test: Active policy sets vehicle reference (Property 6)
    - **Property 6: Active policy sets vehicle reference**
    - After creating/updating an active policy, each associated vehicle's currentInsurancePolicyId equals the policy ID
    - **Validates: Requirements 1.13**

  - [x] 3.7 Write property test: Deactivation clears vehicle reference (Property 7)
    - **Property 7: Deactivation clears vehicle reference**
    - After deactivating/deleting a policy, vehicles that referenced it have currentInsurancePolicyId set to null
    - **Validates: Requirements 1.15**

  - [x] 3.8 Write property test: Expense auto-generation on term addition (Property 15)
    - **Property 15: Expense auto-generation on term addition**
    - For any term with financeDetails.totalCost defined, exactly one expense is created with correct category, tags, amount, date, and FK references
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

  - [x] 3.9 Write property test: Expense preservation on policy deletion (Property 16)
    - **Property 16: Expense preservation on policy deletion**
    - Deleting a policy preserves linked expenses but nullifies insurancePolicyId and insuranceTermId
    - **Validates: Requirements 5.4**

  - [x] 3.10 Write property test: No expense for terms without totalCost (Property 17)
    - **Property 17: No expense for terms without totalCost**
    - For any term without financeDetails.totalCost, no expense record is created
    - **Validates: Requirements 5.6**

  - [x] 3.11 Checkpoint — Run `bun run all:fix && bun run validate` in `backend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Insurance routes and photo system extensions
  - [x] 4.1 Implement insurance routes (`backend/src/api/insurance/routes.ts`)
    - Replace existing routes with new Hono route handlers
    - `GET /api/v1/insurance` — all policies for authenticated user
    - `POST /api/v1/insurance` — create policy (zValidator with createPolicySchema)
    - `GET /api/v1/insurance/:id` — single policy
    - `PUT /api/v1/insurance/:id` — update policy
    - `DELETE /api/v1/insurance/:id` — delete policy
    - `POST /api/v1/insurance/:id/terms` — add term
    - `PUT /api/v1/insurance/:id/terms/:termId` — update term
    - `GET /api/v1/insurance/vehicles/:vehicleId/policies` — policies for a vehicle
    - `GET /api/v1/insurance/expiring-soon` — expiring policies
    - Wire auth middleware on all routes
    - _Requirements: 1.1–1.16, 5.1–5.6_

  - [x] 4.2 Extend photo system for insurance documents
    - Add `insurance_policy` case to `validateEntityOwnership` in `backend/src/api/photos/helpers.ts` — look up policy via junction, verify user owns a linked vehicle
    - Add `insurance_policy` case to `resolveEntityDriveFolder` — create/find `VROOM/{userName}/Insurance Documents/` folder
    - Add `application/pdf` to `ALLOWED_MIME_TYPES` in `backend/src/api/photos/photo-service.ts`
    - _Requirements: 2.1, 2.3, 2.5, 2.8, 2.9_

  - [x] 4.3 Update `validateInsuranceOwnership` in `backend/src/utils/validation.ts`
    - Rewrite to use junction table instead of direct vehicleId FK
    - Query policy → junction → vehicles → check userId
    - _Requirements: 1.6_

  - [x] 4.4 Write property test: Document MIME type validation (Property 8)
    - **Property 8: Document MIME type validation**
    - System accepts jpeg/png/webp/pdf, rejects all other MIME types
    - **Validates: Requirements 2.3**

  - [x] 4.5 Checkpoint — Run `bun run all:fix && bun run validate` in `backend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend types, API service, and utility functions
  - [x] 5.1 Update frontend TypeScript types
    - Replace existing `InsurancePolicy` interface in `frontend/src/lib/types.ts` with new interfaces: `PolicyDetails`, `FinanceDetails`, `PolicyTerm`, `InsurancePolicy`
    - Add `CreatePolicyRequest`, `UpdatePolicyRequest`, `CreateTermRequest`, `UpdateTermRequest` types
    - _Requirements: 1.1, 1.3_

  - [x] 5.2 Create insurance API service (`frontend/src/lib/services/insurance-api.ts`)
    - Implement `insuranceApi` object following `vehicleApi`/`expenseApi` pattern using `apiClient`
    - Methods: `getAllPolicies`, `getPoliciesForVehicle`, `getPolicy`, `createPolicy`, `updatePolicy`, `deletePolicy`, `addTerm`, `updateTerm`, `getExpiringPolicies`
    - Document methods: `getDocuments`, `uploadDocument`, `deleteDocument`, `getDocumentThumbnailUrl`
    - _Requirements: 1.1–1.16, 2.1–2.9, 5.1–5.6_

  - [x] 5.3 Add insurance utility functions
    - Add helper functions for expiration alert computation (days remaining calculation) and term sorting (by endDate descending) in `frontend/src/lib/utils/insurance.ts`
    - _Requirements: 3.4, 3.5_

  - [x] 5.4 Write property test: Policy active/inactive grouping (Property 11)
    - **Property 11: Policy active/inactive grouping**
    - Create `frontend/src/lib/components/__tests__/InsuranceLogic.property.test.ts`
    - Partitioning policies by isActive produces correct groups with no missing policies
    - **Validates: Requirements 3.1**

  - [x] 5.5 Write property test: Expiration alert computation (Property 12)
    - **Property 12: Expiration alert computation**
    - Alert appears iff currentTermEnd within 30 days; daysRemaining equals ceil((currentTermEnd - now) / day)
    - **Validates: Requirements 3.4**

  - [x] 5.6 Write property test: Term history ordering (Property 13)
    - **Property 13: Term history ordering**
    - Terms displayed in reverse chronological order by endDate
    - **Validates: Requirements 3.5**

  - [x] 5.7 Write property test: Renew pre-fill from previous term (Property 14)
    - **Property 14: Renew pre-fill from previous term**
    - Renew action produces a form pre-filled with latest term's policyDetails and financeDetails (deep equal)
    - **Validates: Requirements 3.6**

  - [x] 5.8 Checkpoint — Run `npm run all:fix && npm run validate` in `frontend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Insurance tab components for vehicle detail page
  - [x] 6.1 Create `InsuranceTab.svelte` component
    - Create `frontend/src/lib/components/insurance/InsuranceTab.svelte`
    - Accept `vehicleId` prop, load policies via `insuranceApi.getPoliciesForVehicle(vehicleId)`
    - Manage loading/error/empty states
    - Render `PolicyList` with loaded policies
    - Provide "Add Policy" button that opens `PolicyForm`
    - _Requirements: 3.1, 3.9_

  - [x] 6.2 Create `PolicyCard.svelte` and `PolicyList.svelte` components
    - `PolicyCard.svelte`: display company, current term dates, cost summary, policy number, expiration alert badge
    - `PolicyList.svelte`: group policies into active/inactive sections, render `PolicyCard` for each
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.3 Create `ExpirationAlert.svelte` component
    - Show badge with days remaining for policies expiring within 30 days
    - Use `text-destructive` for urgent (≤7 days), `text-chart-5` for warning (≤30 days)
    - _Requirements: 3.4_

  - [x] 6.4 Create `PolicyForm.svelte` component
    - Dialog form for creating/editing policies
    - Fields: company (required), vehicle multi-select, notes, isActive toggle
    - Initial term fields: startDate, endDate, policyDetails (policyNumber, coverageDescription, deductibleAmount, coverageLimit, agent fields), financeDetails (totalCost, monthlyCost, premiumFrequency, paymentAmount)
    - Inline validation with `border-destructive` on invalid fields
    - Submit via `insuranceApi.createPolicy` or `insuranceApi.updatePolicy`
    - _Requirements: 3.10, 1.4, 1.5, 1.7–1.11_

  - [x] 6.5 Create `TermForm.svelte` component
    - Dialog form for adding/editing terms
    - Pre-fill from previous term on "Renew" action (deep copy policyDetails + financeDetails)
    - Validate startDate < endDate, numeric constraints
    - Submit via `insuranceApi.addTerm` or `insuranceApi.updateTerm`
    - _Requirements: 3.6, 3.10_

  - [x] 6.6 Create `TermHistory.svelte` component
    - List all terms for a policy in reverse chronological order (by endDate descending)
    - Show term dates, cost, coverage summary for each term
    - Provide "Edit" action on each term, "Renew" action on the latest term
    - _Requirements: 3.5, 3.6_

  - [x] 6.7 Create `DocumentViewer.svelte` component
    - List documents for a policy ordered by upload date
    - Show image thumbnails for JPEG/PNG/WebP, download links for PDFs
    - Upload button that accepts images and PDFs
    - Delete button per document
    - Uses `insuranceApi.getDocuments`, `uploadDocument`, `deleteDocument`, `getDocumentThumbnailUrl`
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 3.7_

  - [x] 6.8 Wire InsuranceTab into vehicle detail page
    - Add "Insurance" tab to `TabsList` in `frontend/src/routes/vehicles/[id]/+page.svelte`
    - Update grid-cols from 5 to 6
    - Add `TabsContent` for `insurance` value rendering `InsuranceTab` with vehicleId
    - Import `InsuranceTab` component
    - _Requirements: 3.11_

  - [x] 6.9 UI verification — Take Chrome DevTools snapshot/screenshot of vehicle detail insurance tab
    - Use `mcp_chrome_devtools_take_snapshot` and `mcp_chrome_devtools_take_screenshot` to verify the insurance tab renders correctly on the vehicle detail page
    - Verify empty state, policy list, and form dialogs render as expected

  - [x] 6.10 Checkpoint — Run `npm run all:fix && npm run validate` in `frontend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Master insurance page and navigation
  - [x] 7.1 Create master insurance page (`frontend/src/routes/insurance/+page.svelte`)
    - Create route at `frontend/src/routes/insurance/+page.svelte`
    - Load all policies via `insuranceApi.getAllPolicies()`
    - Display policies grouped into active/inactive sections using `PolicyList`
    - Show vehicle names on each policy card (fetch vehicle data or include in API response)
    - "New Policy" button opens `PolicyForm` with vehicle multi-select
    - Click policy to expand details (terms, documents)
    - Handle loading/error/empty states
    - _Requirements: 4.1–4.6_

  - [x] 7.2 Add Insurance nav item to Navigation.svelte
    - Add `{ name: 'Insurance', href: '/insurance', icon: Shield }` to `navItems` array in `frontend/src/lib/components/layout/Navigation.svelte`
    - Import `Shield` from `lucide-svelte`
    - Position between "Expenses" and "Analytics"
    - _Requirements: 4.1_

  - [x] 7.3 UI verification — Take Chrome DevTools snapshot/screenshot of master insurance page and navigation
    - Use `mcp_chrome_devtools_take_snapshot` and `mcp_chrome_devtools_take_screenshot` to verify:
    - Insurance link appears in navigation between Expenses and Analytics
    - Master insurance page renders with correct layout, grouping, and empty state

  - [x] 7.4 Checkpoint — Run `npm run all:fix && npm run validate` in `frontend/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 8. End-to-end flow verification with Chrome DevTools MCP
  - [x] 8.1 Verify full policy creation flow
    - Use `mcp_chrome_devtools_take_snapshot` / `mcp_chrome_devtools_take_screenshot` to navigate to the insurance page, create a new policy with vehicle selection and initial term, and verify the policy appears in the list

  - [x] 8.2 Verify term renewal flow
    - Use Chrome DevTools MCP to open an existing policy, click "Renew", verify the form pre-fills from the previous term, submit the new term, and verify it appears in the term history

  - [x] 8.3 Verify document upload flow
    - Use Chrome DevTools MCP to upload a document to a policy, verify the thumbnail (for images) or download link (for PDFs) appears in the document viewer

  - [x] 8.4 Verify expense linking flow
    - Use Chrome DevTools MCP to create a policy with a term that has `totalCost`, then navigate to expenses and verify the auto-generated expense appears with correct category, amount, and description

  - [x] 8.5 Verify navigation flow
    - Use Chrome DevTools MCP to verify the Insurance link appears in the main navigation between Expenses and Analytics, and clicking it navigates to `/insurance`

  - [x] 8.6 Verify vehicle detail insurance tab flow
    - Use Chrome DevTools MCP to navigate to a vehicle detail page, switch to the Insurance tab, and verify policies for that vehicle load correctly

  - [x] 8.7 Final checkpoint — Run both backend and frontend validation
    - Run `bun run all:fix && bun run validate` in `backend/`
    - Run `npm run all:fix && npm run validate` in `frontend/`
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major phase
- Property tests validate universal correctness properties from the design document
- The existing `backend/src/api/insurance/` files will be replaced in-place
- Chrome DevTools MCP snapshots/screenshots are used at component milestones and for end-to-end flow verification
