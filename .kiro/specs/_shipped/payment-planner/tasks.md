# Implementation Plan: Payment Planner

## Overview

Replace the collapsible PaymentCalculator with a dialog-based PaymentPlannerDialog triggered from NextPaymentCard. Remove inline editing from NextPaymentCard, add a "Change Payment" button, and wire the new dialog into the vehicle detail page. Existing backend PATCH endpoint, `vehicleApi.updatePaymentAmount()`, `calculateMinimumPayment()`, and `calculateExtraPaymentImpact()` are already in place — no backend changes needed.

## Tasks

- [x] 1. Modify NextPaymentCard to remove inline editing and add "Change Payment" button
  - [x] 1.1 Remove inline edit state, functions, and pencil/check/cancel UI from NextPaymentCard
    - Remove `isEditing`, `editValue`, `isSaving`, `editError` state variables
    - Remove `startEditing`, `cancelEditing`, `savePaymentAmount`, `handleEditKeydown` functions
    - Remove `onPaymentAmountChange` from Props interface
    - Remove `Pencil`, `Check`, `X`, `Input`, `LoaderCircle` imports that are only used by inline edit
    - Remove the entire `{#if isEditing}` block and the pencil icon button
    - Keep the `{:else}` display block (payment amount, min payment label, due date, frequency)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.2 Add `onChangePayment` prop and "Change Payment" button to NextPaymentCard
    - Add optional `onChangePayment?: () => void` to Props interface
    - Render a `Button variant="outline"` labeled "Change Payment" next to the existing "Record Payment" button
    - Only render the "Change Payment" button when `onChangePayment` is provided AND `financing.financingType === 'loan'`
    - _Requirements: 2.1, 8.1_

- [x] 2. Create PaymentPlannerDialog component
  - [x] 2.1 Create `PaymentPlannerDialog.svelte` with dialog shell, input, and reactive state
    - Create `frontend/src/lib/components/financing/PaymentPlannerDialog.svelte`
    - Accept props: `financing: VehicleFinancing`, `open: boolean` (bindable), `onPaymentAmountSaved: (newAmount: number) => Promise<void>`
    - Use shadcn `Dialog` component with `bind:open`
    - Add payment input field pre-filled with `financing.paymentAmount` when dialog opens
    - Show helper text: "Min: $X · Current: $Y"
    - Implement `computePlannerState()` logic inline or as a local function
    - Use `$derived` for `minimumPayment` via `calculateMinimumPayment(financing)`
    - Debounce input by 300ms before recomputing impact
    - Derive `canSave`: input ≥ minimum AND |input - saved| > 0.01 AND not saving
    - Reset input/state via `$effect` when `open` transitions to true
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2_

  - [x] 2.2 Implement impact cards and secondary delta display
    - Compute `primaryImpact` via `calculateExtraPaymentImpact(financingAtMinimum, input - minimum)`
    - Compute `secondaryDelta` when |input - saved| > 0.01 by comparing primary impacts
    - Render three impact cards: Payoff Date, Time Saved, Interest Saved using semantic chart tokens
    - Show secondary "vs current" delta lines with green (`text-chart-2`) for `better`, red (`text-destructive`) for `worse`
    - Handle `at-minimum` state: show "This is the minimum payment. No extra savings."
    - Handle `below-minimum` state: show validation message with minimum amount
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.3 Implement adaptive summary sentence
    - Build summary sentence based on planner state
    - At-minimum: "This is the minimum payment. No extra savings."
    - Normal (input = saved): "Your current payment of $X/mo saves N months and $Y vs the minimum."
    - With-delta (input ≠ saved): Include delta comparison vs current saved amount
    - Render in a `rounded-lg bg-muted p-3` container
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.4 Implement Save flow with error handling
    - Save button calls `onPaymentAmountSaved(inputAmount)`, shows `LoaderCircle` spinner while saving
    - On success: update `savedAmount` to input, close dialog
    - On failure: show inline error below Save button, keep input unchanged, allow retry
    - Disable Save button when `!canSave`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.5 Write property test for planner state classification (Property 1)
    - **Property 1: Planner State Classification**
    - For any valid financing, minimum, input, and saved amounts: the four states (below-minimum, at-minimum, normal, with-delta) are exhaustive and mutually exclusive
    - Extract `computePlannerState` as a testable function
    - Use fast-check to generate random financing parameters
    - **Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3**

  - [x] 2.6 Write property test for impact monotonicity (Property 2)
    - **Property 2: Impact Monotonicity**
    - For any two amounts a > b > minimum against the same financing, monthsSaved(a) ≥ monthsSaved(b) and interestSaved(a) ≥ interestSaved(b)
    - **Validates: Requirement 3.1**

  - [x] 2.7 Write property test for secondary delta correctness (Property 3)
    - **Property 3: Secondary Delta Correctness and Direction**
    - secondaryDelta.monthsDelta = primaryImpact(input).monthsSaved - primaryImpact(saved).monthsSaved
    - direction is 'better' when input > saved, 'worse' when input < saved
    - **Validates: Requirements 3.3, 3.5, 3.6**

  - [x] 2.8 Write property test for save guard correctness (Property 4)
    - **Property 4: Save Guard Correctness**
    - Save enabled iff: input ≥ minimum AND |input - saved| > 0.01 AND not saving
    - **Validates: Requirements 4.1, 4.4, 5.1**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3.1 Visual verification: NextPaymentCard changes
    - Start the dev server and navigate to a vehicle with active loan financing in the browser using Chrome DevTools MCP
    - Take a screenshot of the Finance tab showing the NextPaymentCard
    - Verify: "Change Payment" outline button is visible next to "Record Payment"
    - Verify: No pencil icon or inline edit UI is present
    - Verify: Payment amount and "Min: $X" label still display correctly
    - Navigate to a vehicle with lease financing and verify the "Change Payment" button is NOT shown
    - _Requirements: 2.1, 2.2, 2.3, 8.1_

- [x] 3.2 Visual verification: PaymentPlannerDialog UI states
    - Click the "Change Payment" button to open the dialog
    - Take a screenshot of the dialog in its default state (input = saved amount)
    - Verify: Input is pre-filled with current payment amount
    - Verify: Helper text shows "Min: $X · Current: $Y"
    - Verify: Impact cards (Payoff Date, Time Saved, Interest Saved) are visible with values vs minimum
    - Verify: No secondary delta lines are shown (input = saved)
    - Verify: Save button is disabled (no change)
    - Verify: Summary sentence shows "Your current payment of $X/mo saves..."
    - _Requirements: 1.1, 1.2, 1.3, 3.2, 4.4, 7.2_

- [x] 3.3 Visual verification: PaymentPlannerDialog input changes
    - Change the input to a higher amount than the saved value
    - Take a screenshot showing the updated impact cards with secondary delta lines
    - Verify: Secondary "vs current" delta lines appear with green/positive styling
    - Verify: Summary sentence updates to include delta comparison
    - Verify: Save button is now enabled
    - Change the input to a lower amount (but above minimum)
    - Verify: Secondary delta lines show red/negative styling
    - Set input to the minimum payment amount
    - Verify: "This is the minimum payment. No extra savings." message appears
    - Set input below minimum
    - Verify: Validation error message appears, Save button disabled
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 4.1, 4.3, 7.1, 7.3_

- [x] 4. Wire PaymentPlannerDialog into vehicle detail page and remove PaymentCalculator
  - [x] 4.1 Update `+page.svelte` to use PaymentPlannerDialog instead of PaymentCalculator
    - Remove `PaymentCalculator` import
    - Add `PaymentPlannerDialog` import from `$lib/components/financing/PaymentPlannerDialog.svelte`
    - Add `let showPaymentPlanner = $state(false)` dialog state
    - Replace `<PaymentCalculator financing={vehicle.financing} />` block with `<PaymentPlannerDialog financing={vehicle.financing} bind:open={showPaymentPlanner} onPaymentAmountSaved={handlePaymentAmountChange} />`
    - Remove `onPaymentAmountChange` prop from `<NextPaymentCard>`, add `onChangePayment={() => (showPaymentPlanner = true)}`
    - _Requirements: 9.1, 9.3, 1.1_

  - [x] 4.2 Delete `PaymentCalculator.svelte`
    - Remove `frontend/src/lib/components/financing/PaymentCalculator.svelte`
    - _Requirements: 9.2_

  - [x] 4.3 Write property test for save idempotency (Property 5)
    - **Property 5: Save Idempotency**
    - After a successful save, savedAmount = inputAmount, state transitions from with-delta to normal, Save button becomes disabled
    - **Validates: Requirements 5.2, 5.3**

  - [x] 4.4 Write property test for summary sentence consistency (Property 6)
    - **Property 6: Summary Sentence Consistency**
    - Summary sentence matches the current planner state: at-minimum → minimum message, normal → savings vs minimum, with-delta → savings + delta
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 4.5 Write property test for non-loan financing guard (Property 7)
    - **Property 7: Non-Loan Financing Guard**
    - For any financing where financingType ≠ 'loan', the "Change Payment" button is not rendered
    - **Validates: Requirement 8.1**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5.1 Visual verification: E2E save flow
    - Navigate to a vehicle with active loan financing using Chrome DevTools MCP
    - Click "Change Payment" to open the dialog
    - Enter a new payment amount higher than the current saved value
    - Click Save and wait for the dialog to close
    - Take a screenshot of the NextPaymentCard after save
    - Verify: NextPaymentCard now shows the updated payment amount
    - Verify: The "Record Payment" link href includes the new amount
    - Reopen the dialog and verify: input is pre-filled with the newly saved amount, no secondary deltas shown, Save button disabled
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 5.2 Visual verification: E2E PaymentCalculator removal
    - Scroll through the entire Finance tab using Chrome DevTools MCP
    - Take a screenshot of the full Finance tab layout
    - Verify: No collapsible "Payment Calculator" section exists anywhere on the page
    - Verify: PaymentPlannerDialog is accessible only via the "Change Payment" button on NextPaymentCard
    - Verify: All other Finance tab components (PaymentMetricsGrid, FinancingCharts, PaymentHistory) still render correctly
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 5.3 Visual verification: Mobile responsiveness
    - Resize the browser to mobile viewport (375px width) using Chrome DevTools MCP
    - Navigate to the Finance tab and take a screenshot
    - Verify: "Record Payment" and "Change Payment" buttons stack or fit properly on mobile
    - Open the PaymentPlannerDialog and take a screenshot
    - Verify: Dialog renders properly on mobile (input, impact cards, summary, Save button all visible and usable)
    - Verify: Impact cards stack vertically on narrow screens

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Existing utilities (`calculateMinimumPayment`, `calculateExtraPaymentImpact`, `debounce`, `formatCurrency`) are reused — no new utility files needed
- No backend changes required; the PATCH endpoint and `vehicleApi.updatePaymentAmount()` already exist
- Property tests use fast-check and validate correctness properties from the design document
