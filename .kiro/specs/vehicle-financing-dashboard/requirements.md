# Requirements Document

## Introduction

The vehicle financing tab currently displays basic financing information in a simple card layout. This feature will transform it into a comprehensive financing dashboard that provides users with rich visualizations, payment tracking, amortization schedules, and actionable insights about their vehicle loans or leases. The dashboard will leverage shadcn/ui components to create an engaging, informative experience that helps users understand their financing status at a glance and make informed decisions about their vehicle payments.

## Requirements

### Requirement 1: Payment Progress Visualization

**User Story:** As a vehicle owner with financing, I want to see visual representations of my payment progress, so that I can quickly understand how much I've paid and how much remains.

#### Acceptance Criteria

1. WHEN the financing tab is loaded AND the vehicle has active financing THEN the system SHALL display a prominent progress bar showing the percentage of the loan/lease paid off
2. WHEN the progress bar is displayed THEN the system SHALL show the exact percentage paid, remaining balance, and original amount in a visually clear format
3. WHEN the vehicle has a loan THEN the system SHALL display a donut chart showing the breakdown of principal paid vs. remaining balance
4. WHEN the vehicle has a lease THEN the system SHALL display lease-specific progress indicators including time remaining and mileage usage (if applicable)
5. IF the user has paid more than 75% of the financing THEN the system SHALL display a congratulatory indicator or badge

### Requirement 2: Payment History Timeline

**User Story:** As a vehicle owner, I want to see my payment history in a timeline format, so that I can track my payment consistency and identify any missed or extra payments.

#### Acceptance Criteria

1. WHEN the financing tab is loaded AND payment records exist THEN the system SHALL display a scrollable payment history timeline
2. WHEN displaying payment history THEN the system SHALL show payment date, amount, principal, interest, and remaining balance for each payment
3. WHEN a payment is a standard scheduled payment THEN the system SHALL display it with a standard indicator
4. WHEN a payment is an extra payment THEN the system SHALL highlight it with a distinct visual indicator
5. WHEN no payment history exists THEN the system SHALL display an empty state encouraging the user to record their first payment
6. WHEN the timeline is displayed THEN the system SHALL show the most recent payments first with the ability to scroll through older payments

### Requirement 3: Amortization Schedule Visualization

**User Story:** As a vehicle owner with a loan, I want to see an amortization schedule with charts, so that I can understand how my payments are split between principal and interest over time.

#### Acceptance Criteria

1. WHEN the vehicle has a loan with APR greater than 0 THEN the system SHALL display an amortization chart showing principal vs. interest over the loan term
2. WHEN the amortization chart is displayed THEN the system SHALL use a stacked area chart or bar chart to visualize the payment breakdown
3. WHEN displaying the amortization schedule THEN the system SHALL show key milestones such as when interest paid equals principal paid
4. WHEN the user has made payments THEN the system SHALL highlight completed payments differently from future scheduled payments
5. IF the loan has no APR or is a lease THEN the system SHALL NOT display the amortization chart

### Requirement 4: Financial Metrics Cards

**User Story:** As a vehicle owner, I want to see key financial metrics about my financing, so that I can quickly assess my financial commitment and progress.

#### Acceptance Criteria

1. WHEN the financing tab is loaded THEN the system SHALL display metric cards showing total interest paid (for loans), total amount paid to date, monthly payment amount, and payoff date
2. WHEN displaying total interest paid THEN the system SHALL calculate it from actual payment records if available, otherwise estimate from the amortization schedule
3. WHEN displaying the payoff date THEN the system SHALL calculate it based on the current balance, payment amount, and payment frequency
4. WHEN the vehicle has a lease THEN the system SHALL display lease-specific metrics including total lease cost, lease end date, and mileage status
5. WHEN displaying mileage status for a lease THEN the system SHALL show current mileage, mileage limit, remaining mileage, and potential excess mileage fees

### Requirement 5: Payment Calculator and "What-If" Scenarios

**User Story:** As a vehicle owner, I want to calculate the impact of extra payments, so that I can make informed decisions about paying off my loan early.

#### Acceptance Criteria

1. WHEN the vehicle has an active loan THEN the system SHALL provide a payment calculator section
2. WHEN the calculator is displayed THEN the system SHALL allow users to input an extra payment amount
3. WHEN an extra payment amount is entered THEN the system SHALL calculate and display the new payoff date, total interest saved, and months saved
4. WHEN the calculator shows results THEN the system SHALL display them in an easy-to-understand format with clear labels
5. WHEN the vehicle has a lease THEN the system SHALL NOT display the payment calculator

### Requirement 6: Next Payment Information

**User Story:** As a vehicle owner, I want to see when my next payment is due, so that I can ensure I don't miss a payment.

#### Acceptance Criteria

1. WHEN the financing tab is loaded AND the vehicle has active financing THEN the system SHALL display a prominent card showing the next payment due date
2. WHEN the next payment is within 7 days THEN the system SHALL highlight it with a warning color
3. WHEN the next payment is overdue THEN the system SHALL display it with an alert indicator
4. WHEN displaying the next payment THEN the system SHALL show the payment amount, due date, and payment frequency
5. WHEN the payment frequency is monthly THEN the system SHALL calculate the due date based on the payment day of month

### Requirement 7: Financing Summary Statistics

**User Story:** As a vehicle owner, I want to see summary statistics about my financing, so that I can understand the overall cost and terms at a glance.

#### Acceptance Criteria

1. WHEN the financing tab is loaded THEN the system SHALL display a summary section with key financing details
2. WHEN displaying the summary THEN the system SHALL show financing type, provider, original amount, current balance, APR (if applicable), term length, and start date
3. WHEN the vehicle has a lease THEN the system SHALL additionally display residual value, mileage limit, and excess mileage fee
4. WHEN displaying financial amounts THEN the system SHALL format them according to the user's currency settings
5. WHEN the financing is completed (balance is $0) THEN the system SHALL display a completion badge and congratulatory message

### Requirement 8: Interactive Charts with Tooltips

**User Story:** As a vehicle owner, I want to interact with charts to see detailed information, so that I can explore my financing data in depth.

#### Acceptance Criteria

1. WHEN any chart is displayed THEN the system SHALL provide interactive tooltips on hover
2. WHEN hovering over a chart element THEN the system SHALL display detailed information about that data point
3. WHEN displaying tooltips THEN the system SHALL format numbers and dates in a user-friendly way
4. WHEN charts are displayed on mobile devices THEN the system SHALL ensure they are touch-friendly and responsive
5. WHEN a chart has no data THEN the system SHALL display an appropriate empty state message

### Requirement 9: Responsive Layout

**User Story:** As a vehicle owner using various devices, I want the financing dashboard to work well on all screen sizes, so that I can access my financing information anywhere.

#### Acceptance Criteria

1. WHEN the financing tab is viewed on desktop THEN the system SHALL display components in a multi-column grid layout
2. WHEN the financing tab is viewed on tablet THEN the system SHALL adjust to a 2-column layout where appropriate
3. WHEN the financing tab is viewed on mobile THEN the system SHALL stack components vertically in a single column
4. WHEN charts are displayed on small screens THEN the system SHALL ensure they remain readable and interactive
5. WHEN the layout changes based on screen size THEN the system SHALL maintain visual hierarchy and usability

### Requirement 10: Empty State for No Financing

**User Story:** As a vehicle owner without financing, I want to see a helpful empty state, so that I understand why the tab is empty and what I can do.

#### Acceptance Criteria

1. WHEN the vehicle has no active financing THEN the system SHALL display an empty state with an appropriate icon and message
2. WHEN the empty state is displayed THEN the system SHALL explain that the vehicle doesn't have active financing
3. WHEN the vehicle is owned outright THEN the system SHALL display a positive message acknowledging this
4. WHEN the empty state is displayed THEN the system SHALL provide a clear call-to-action to add financing information if needed
5. IF the vehicle previously had financing that was paid off THEN the system SHALL display a congratulatory message
