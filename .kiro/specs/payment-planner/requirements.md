# Requirements Document

## Introduction

The Payment Planner feature replaces the existing inline PaymentCalculator with a dialog-based planning tool. Users trigger the dialog from a "Change Payment" button on the NextPaymentCard, input a desired monthly payment amount (pre-filled with their current amount), see real-time impact comparisons against the minimum payment and their previously saved amount, and persist changes via the existing PATCH API. The goal is a clearer, more focused payment planning experience that answers "what if I pay X per month?" with concrete payoff date, time saved, and interest saved metrics.

## Glossary

- **PaymentPlannerDialog**: The new dialog component that provides the payment planning interface, replacing the removed PaymentCalculator.
- **NextPaymentCard**: The existing card component showing next payment info, modified to include a "Change Payment" trigger button and remove inline editing.
- **VehicleFinancing**: The data model representing a vehicle's financing details including loan amount, APR, balance, and payment configuration.
- **MinimumPayment**: The calculated minimum monthly payment derived from the amortization formula for a given loan (via `calculateMinimumPayment`).
- **PrimaryImpact**: The set of impact metrics (payoff date, months saved, interest saved) comparing the user's input amount against the minimum payment baseline.
- **SecondaryDelta**: The difference in impact metrics between the user's input amount and their previously saved payment amount, shown only when the two differ.
- **PlannerState**: One of four display states for the dialog: `below-minimum`, `at-minimum`, `normal`, or `with-delta`.
- **SavedAmount**: The `financing.paymentAmount` value captured when the dialog opens, used as the baseline for secondary delta comparisons.

## Requirements

### Requirement 1: Open Payment Planner Dialog

**User Story:** As a vehicle owner, I want to open a payment planning dialog from the NextPaymentCard, so that I can explore different payment amounts without inline editing.

#### Acceptance Criteria

1. WHEN the user clicks the "Change Payment" button on the NextPaymentCard, THE PaymentPlannerDialog SHALL open with the input pre-filled with the current `financing.paymentAmount`.
2. WHEN the PaymentPlannerDialog opens, THE PaymentPlannerDialog SHALL capture the current `financing.paymentAmount` as the SavedAmount for secondary delta comparisons.
3. WHEN the PaymentPlannerDialog opens, THE PaymentPlannerDialog SHALL display helper text showing the MinimumPayment and the current SavedAmount.

### Requirement 2: Remove Inline Editing from NextPaymentCard

**User Story:** As a developer, I want to remove the pencil icon and inline edit functionality from NextPaymentCard, so that payment editing is consolidated into the PaymentPlannerDialog.

#### Acceptance Criteria

1. THE NextPaymentCard SHALL display a "Change Payment" outline button next to the "Record Payment" button.
2. THE NextPaymentCard SHALL NOT render a pencil icon, inline input field, or check/cancel buttons for payment amount editing.
3. THE NextPaymentCard SHALL continue to display the current payment amount, minimum payment, countdown badge, progress bar, and balance statistics.

### Requirement 3: Compute and Display Impact Metrics

**User Story:** As a vehicle owner, I want to see how changing my payment amount affects my payoff timeline and interest costs, so that I can make informed financial decisions.

#### Acceptance Criteria

1. WHEN the user enters a payment amount greater than the MinimumPayment, THE PaymentPlannerDialog SHALL compute PrimaryImpact metrics (payoff date, months saved, interest saved) by comparing the input amount against the MinimumPayment baseline using `calculateExtraPaymentImpact`.
2. WHEN the user enters a payment amount greater than the MinimumPayment, THE PaymentPlannerDialog SHALL display three impact cards: Payoff Date, Time Saved, and Interest Saved.
3. WHILE the input amount differs from the SavedAmount by more than $0.01, THE PaymentPlannerDialog SHALL compute and display SecondaryDelta values showing the difference in months saved and interest saved compared to the SavedAmount.
4. WHILE the input amount equals the SavedAmount within $0.01, THE PaymentPlannerDialog SHALL hide the SecondaryDelta lines on the impact cards.
5. WHEN the SecondaryDelta direction is `better` (input > SavedAmount), THE PaymentPlannerDialog SHALL display the delta values with positive/green styling.
6. WHEN the SecondaryDelta direction is `worse` (input < SavedAmount), THE PaymentPlannerDialog SHALL display the delta values with negative/red styling.

### Requirement 4: Validate Payment Input

**User Story:** As a vehicle owner, I want clear feedback when my input is invalid, so that I only save valid payment amounts.

#### Acceptance Criteria

1. WHEN the user enters an amount below the MinimumPayment, THE PaymentPlannerDialog SHALL display a validation message stating the minimum allowed amount and disable the Save button.
2. WHEN the user enters a non-numeric, zero, or negative value, THE PaymentPlannerDialog SHALL disable the Save button and show impact cards in an empty/zero state.
3. WHEN the input amount equals the MinimumPayment, THE PaymentPlannerDialog SHALL display a message indicating this is the minimum payment with no extra savings, and show zero values on impact cards.
4. WHEN the input amount equals the SavedAmount within $0.01, THE PaymentPlannerDialog SHALL disable the Save button.

### Requirement 5: Persist Payment Amount Changes

**User Story:** As a vehicle owner, I want to save my chosen payment amount, so that it becomes my new scheduled payment.

#### Acceptance Criteria

1. WHEN the user clicks Save with a valid input amount that differs from the SavedAmount, THE PaymentPlannerDialog SHALL call the `onPaymentAmountSaved` callback with the new amount.
2. WHEN the save operation succeeds, THE PaymentPlannerDialog SHALL update the SavedAmount to the new input amount, cause SecondaryDelta lines to disappear, and close the dialog.
3. WHEN the save operation succeeds, THE NextPaymentCard SHALL reflect the updated payment amount.
4. IF the save API call fails, THEN THE PaymentPlannerDialog SHALL display an inline error message below the Save button and keep the input value unchanged.
5. IF the save API call fails, THEN THE PaymentPlannerDialog SHALL allow the user to retry by clicking Save again.

### Requirement 6: Debounce Impact Calculations

**User Story:** As a vehicle owner, I want smooth interaction while typing payment amounts, so that the dialog remains responsive during input.

#### Acceptance Criteria

1. WHEN the user types in the payment input field, THE PaymentPlannerDialog SHALL debounce the impact calculation by 300 milliseconds before recomputing PrimaryImpact and SecondaryDelta.
2. WHILE the user is actively typing, THE PaymentPlannerDialog SHALL continue displaying the previous calculation results until the debounce period elapses.

### Requirement 7: Display Adaptive Summary Sentence

**User Story:** As a vehicle owner, I want a plain-language summary of my payment plan impact, so that I can quickly understand the effect of my chosen amount.

#### Acceptance Criteria

1. WHEN the input amount equals the MinimumPayment, THE PaymentPlannerDialog SHALL display the summary: "This is the minimum payment. No extra savings."
2. WHEN the input amount is above the MinimumPayment and equals the SavedAmount, THE PaymentPlannerDialog SHALL display a summary stating the current payment saves a specific number of months and a specific dollar amount versus the minimum.
3. WHEN the input amount is above the MinimumPayment and differs from the SavedAmount, THE PaymentPlannerDialog SHALL display a summary stating savings versus the minimum and the delta versus the current saved amount.
4. THE PaymentPlannerDialog summary sentence SHALL always reflect the current PlannerState accurately.

### Requirement 8: Non-Loan Financing Guard

**User Story:** As a developer, I want the payment planner to only appear for loan-type financing, so that lease and owned vehicles do not show irrelevant controls.

#### Acceptance Criteria

1. WHILE the `financing.financingType` is not `loan`, THE NextPaymentCard SHALL NOT render the "Change Payment" button.

### Requirement 9: Delete PaymentCalculator Component

**User Story:** As a developer, I want to remove the deprecated PaymentCalculator component, so that the codebase has a single payment planning path through the PaymentPlannerDialog.

#### Acceptance Criteria

1. THE vehicle detail page SHALL NOT render the PaymentCalculator component.
2. THE PaymentCalculator component file SHALL be removed from the codebase.
3. THE vehicle detail page SHALL render the PaymentPlannerDialog component in place of the removed PaymentCalculator.
