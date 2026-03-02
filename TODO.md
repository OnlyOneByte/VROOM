# VROOM Car Tracker - TODO

## P0 — Must Have

### Analytics Page

- [ ] Build out the analytics route with real content (currently a stub/placeholder)
- [ ] Integrate existing analytics components (EfficiencyAlerts, FuelEfficiencyMonitor, VehicleEfficiencySummary) into the analytics page
- [ ] Cross-vehicle cost comparison and trends
- [ ] Fuel price tracking: log price-per-gallon with fill-ups, show price trends over time

### Dark Mode

- [x] Dark mode toggle

### Fuel Tracking

- [ ] Skip MPG calculation for missed fill-ups

### Mileage / Odometer

- [ ] Odometer log on the vehicle detail page (track readings over time, show mileage-over-time chart)

### Insurance — Core Policy Management

- [ ] Enrich policy schema: coverage type (liability/collision/comprehensive/full), deductible amount, coverage limit, premium frequency (monthly/quarterly/semi-annual/annual)
- [ ] Document storage: upload & retrieve proof-of-insurance cards and policy PDFs per policy (integrate with existing photo/file infrastructure)
- [ ] Renewal tracking: link renewal policies to their predecessor, surface cost-over-time trends
- [ ] Insurance dashboard page: list active/expired policies per vehicle, quick-access document viewer, upcoming renewal alerts
- [ ] Policy-to-expense linking: auto-generate or link expense records (category `insurance`) when a policy is created/renewed; foreign key from expense → policy
  - [ ] How to split cost between multiple cars (?)

### UI Misc & bugs
- [ ] Common upload/take picture dialog popup. use props
- [ ] Verify backup max count is deleting old backups
- [ ] Verify sheets sync is cahnging when schema changes (and working)


### Total Cost of Ownership (TCO)

- [ ] TCO calculator: aggregate purchase price + financing interest + insurance + fuel + maintenance into a single $/mile and $/month figure
- [ ] TCO dashboard card on vehicle detail page
- [ ] TCO trend over time (monthly/quarterly breakdown)

### Gamification & Engagement

- [ ] Vehicle health score: composite score based on maintenance regularity, mileage intervals, insurance coverage status
- [ ] Health score badge/indicator on vehicle cards and detail page
- [ ] Year-end summary: annual report card with total spent, cost breakdown by category, MPG trends, biggest expense, year-over-year comparison
- [ ] Shareable year-end summary (exportable image or link)

## P1 — Should Have

### Insurance — Claims & Bundling

- [ ] Claims tracking: date, claim type (collision/theft/weather/vandalism/other), description, status (filed/in-progress/settled/denied), payout amount, fault designation (at-fault/not-at-fault/shared), linked policy
- [ ] Claim document uploads: attach photos, police reports, repair estimates to a claim record
- [ ] Multi-vehicle bundle support: group policies under a shared bundle with discount percentage, reflect per-vehicle adjusted cost
- [ ] Provider/agent contacts: agent name, phone, email, claims hotline stored per policy

### Insurance — Extra

- [ ] Coverage gap detection: flag date ranges where a vehicle had no active policy
- [ ] Rate comparison notes: free-text field per policy for jotting down competing quotes during renewal shopping
- [ ] Payment schedule tracking: map individual premium payments against a policy term (or link to expense records by date range)

### Maintenance Schedule

- [ ] Maintenance schedule engine: define service intervals by mileage and/or time (oil change, tire rotation, brake inspection, etc.)
- [ ] Reminders when a service is due based on current mileage + last service date
- [ ] Pre-built templates for common maintenance schedules by vehicle type

### Sharing & Multi-Household

- [ ] Vehicle sharing: invite another user to view or edit a specific vehicle (schema, routes, UI — types already defined)
- [ ] Household view: aggregate costs across shared vehicles for a combined spending overview
- [ ] Shared expense log: expenses entered by any authorized user appear on the vehicle's timeline
- [ ] Permission levels: view-only vs. edit access per shared vehicle

### Recurring Expense Templates

- [ ] Define recurring expenses (insurance premiums, loan payments, parking passes) with frequency
- [ ] Auto-create expense records each period based on templates
- [ ] Dashboard indicator for upcoming recurring expenses

## P2 — Nice to Have

### UI / UX

- [ ] Sync status time doesn't refresh in menu after enabling backup until page reload
- [ ] Quick-add widget: streamlined "just filled up" flow (gallons, price, mileage — three taps)

### Features

- [ ] Split expenses across multiple vehicles
- [ ] Import from other car cost trackers via CSV — Fuelly, Fuelio, Drivvo, Simply Auto, Road Trip, Spritmonitor, aCar, Car Expenses
- [ ] Vehicle comparison: side-by-side cost comparison between your vehicles
- [ ] Cost forecasting: "at your current rate, this vehicle will cost $X over the next 12 months"

### Infrastructure

- [ ] Redis for rate-limiting / idempotency in multi-instance deployments

### Long Term Considerations

- [ ] Receipt / invoice photo-based auto-fill (OCR → expense fields)
- [ ] Anonymous cost benchmarks: opt-in aggregated data to show how your costs compare to similar vehicles
- [ ] Service shop directory: save mechanic/dealer/tire shop contacts, link expenses to shops, track spend per shop
