# VROOM Car Tracker - TODO

## P0 — Must Have

### Analytics Page (Gamification & Engagement)
- [ ] Build out the analytics route with real content (currently a stub/placeholder)
- [ ] Vehicle health score: composite score based on maintenance regularity, mileage intervals, insurance coverage status
- [ ] Health score badge/indicator on vehicle cards and detail page
- [ ] Year-end summary: annual report card with total spent, cost breakdown by category, MPG trends, biggest expense, year-over-year comparison
- [ ] Integrate existing analytics components (EfficiencyAlerts, FuelEfficiencyMonitor, VehicleEfficiencySummary) into the analytics page
- [ ] TCO (Total Cost of Ownership) calculator: aggregate purchase price + financing interest + insurance + fuel + maintenance into a single $/mile and $/month figure
- [ ] TCO dashboard card on vehicle detail page
- [ ] TCO trend over time (monthly/quarterly breakdown)
- [x] Fuel price tracking: log price-per-gallon with fill-ups, show price trends over time

- [ ] Shareable year-end summary (exportable image or link)
  - This is a big one, proably gonna spend a full day on just this.

### Insurance — Core Policy Management

- [x] Core insurance policy information
- [x] Document storage: upload & retrieve proof-of-insurance cards and policy PDFs per policy (integrate with existing photo/file infrastructure)
- [x] Insurance dashboard page: list active/expired policies per vehicle, quick-access document viewer, upcoming renewal alerts
- [x] Policy-to-expense linking: auto-generate or link expense records (category `insurance`) when a policy is created/renewed; foreign key from expense → policy
  - [x] How to split cost between multiple cars (?)
  - [x] Manage terms where covered cars are different
- [x] Insurance input autofill on renew click
- [x] Insurance input frequency dropdown rather than free text entry
- [x] Policy level edit and delete buttom move

### UI Misc & bugs
- [x] Force sync (ignore if changed)
- [X] Insurance add popup - maybe should be page instead of popup? qq
- [x] Verify backup max count is deleting old backups
- [x] Verify sheets sync is cahnging when schema changes (and working)
- [x] Dark mode toggle
- [x] Skip MPG calculation for missed fill-ups
- [x] Multi-vehicle expenses (expense splitting WF)
- [x] Common upload/take picture dialog popup. use props
- [X] Expense level photos
- [x] Move car photos into overview tab (remove photos only tab)
- [x] Remove Reminders tab from car
- [X] EV and PHEV charging tracking
- [x] Custom folder names
- [x] Auth/login page re-write
  - [ ] New logo/icon assets to use
  - [x] Change to be / instead of /auth
- [x] Odometer log on the vehicle detail page (track readings over time, show mileage-over-time chart)
- [x] Split expense show better
- [x] Expenses table to concat details col first
- [x] Policy term level delete
- [x] Policy Term card
- [x] Chart card padding on left against axis (dashboard page)
- [x] Photos refs not restoring on backup/restore
  - [x] Backup photos with ZIP option toggle (placeholder)
  - [ ] Backup photos with ZIP (functionality)
- [x] Better option for the expense table in mobile
- [x] Remove financing payments from restore preview
- [x] Combine the restore dialogs into a single one
- [x] Google drive restore dialog too tall (how to cut off)
- [x] Clean up UI (components/ui has custom components) -> moved to components/common
- [x] Photos not showing in prod env (CORS?)
- [ ] First opening/loading - car zooming past screen animation (idea)
- [x] Expense API pagination (expense page slow with lots of expenses)
- [ ] Generalize categories (?) user selectable?


## P1 — Should Have

### Insurance — Claims & Bundling

- [ ] Claims tracking: date, claim type (collision/theft/weather/vandalism/other), description, status (filed/in-progress/settled/denied), payout amount, fault designation (at-fault/not-at-fault/shared), linked policy
- [ ] Claim document uploads: attach photos, police reports, repair estimates to a claim record
- [ ] Multi-vehicle bundle support: group policies under a shared bundle with discount percentage, reflect per-vehicle adjusted cost

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

### Misc P1
- [ ] Playwright E2E Tests


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
