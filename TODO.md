# VROOM Car Tracker - TODO

## Big Milestone features
### Analytics Page (Gamification & Engagement)
- [x] Build out the analytics route with real content (currently a stub/placeholder)
- [x] Vehicle health score: composite score based on maintenance regularity, mileage intervals, insurance coverage status
- [x] Health score badge/indicator on vehicle cards and detail page
- [x] Year-end summary: annual report card with total spent, cost breakdown by category, MPG trends, biggest expense, year-over-year comparison
- [x] Integrate existing analytics components (EfficiencyAlerts, FuelEfficiencyMonitor, VehicleEfficiencySummary) into the analytics page
- [x] TCO (Total Cost of Ownership) calculator: aggregate purchase price + financing interest + insurance + fuel + maintenance into a single $/mile and $/month figure
- [x] TCO dashboard card on vehicle detail page
- [x] TCO trend over time (monthly/quarterly breakdown)
- [x] Cost forecasting: "at your current rate, this vehicle will cost $X over the next 12 months"
- [x] Fuel price tracking: log price-per-gallon with fill-ups, show price trends over time
- [x] Rename chart component
- [x] Standardize Monthly Trend Chart formatting


### Reminders & Scheduled/Recurring 
- [ ] Maintenance schedule engine: define service intervals by mileage and/or time (oil change, tire rotation, brake inspection, etc.)
- [ ] Reminders when a service is due based on current mileage + last service date
- [ ] Define recurring expenses (insurance premiums, loan payments, parking passes) with frequency
- [ ] Dashboard indicator for upcoming recurring expenses

### Sharing & Multi-Household
- [ ] Vehicle sharing: invite another user to view or edit a specific vehicle (schema, routes, UI — types already defined)
- [ ] Household view: aggregate costs across shared vehicles for a combined spending overview
- [ ] Shared expense log: expenses entered by any authorized user appear on the vehicle's timeline
- [ ] Permission levels: view-only vs. edit access per shared vehicle

### Insurance Tracking
- [x] Core insurance policy information
- [x] Document storage: upload & retrieve proof-of-insurance cards and policy PDFs per policy (integrate with existing photo/file infrastructure)
- [x] Insurance dashboard page: list active/expired policies per vehicle, quick-access document viewer, upcoming renewal alerts
- [x] Policy-to-expense linking: auto-generate or link expense records (category `insurance`) when a policy is created/renewed; foreign key from expense → policy
  - [x] How to split cost between multiple cars (?)
  - [x] Manage terms where covered cars are different
- [x] Insurance input autofill on renew click
- [x] Insurance input frequency dropdown rather than free text entry
- [x] Policy level edit and delete buttom move
- [ ] Claims tracking: date, claim type (collision/theft/weather/vandalism/other), description, status (filed/in-progress/settled/denied), payout amount, fault designation (at-fault/not-at-fault/shared), linked policy
- [ ] Claim document uploads: attach photos, police reports, repair estimates to a claim record

### Productionalization must haves
- [x] (Performance) Expenses table add keys
- [x] Unify expenses tables
- [x] Google Cloud Console created
- [x] Analytics page lazy load 
- [x] Unified pagination params for APIs 
- [x] Abstract out photo provider, allow users to choose backend
  - [x] Contain provider specific settings within each one.
    - [x] Set specific backup folders for each type of photo.
    - [x] Be able to backup certain photos to certain
    - [x] Google Drive
    - [x] Backup to more than one google account
- [x] Abstract out backup storage provider.
- [x] Decouple login auth from provider auth 
- [x] Abstract out OAuth Login (Login provider)
- [ ] Auth rate limiter: use Bun's `server.requestIP()` for real client IP; only trust `X-Forwarded-For` when `TRUSTED_PROXY_IPS` env is set
- [ ] Build out profile page
- [ ] Let users know on settings page that auto-backups do not include images
- [x] Global units from selections in profile (ensure its used app wide)
  - [x] Per car units (?)
- [ ] Admin/Management page.
  - [ ] Overall dashboard (number of expenses, users, cars)
  - [ ] Management - delete/remove/block user.
- [ ] Guided setup tour (setup storage/etc)
  - [ ] notify users that they must set up images for image storage in settings
- [ ] Unit test coverage on backend
- [ ] Unit test coverage on frontend
- [ ] E2E Playwright tests


### Importing from other sources.
- [ ] Import from other car cost trackers via CSV — Fuelly, Fuelio, Drivvo, Simply Auto, Road Trip, Spritmonitor, aCar, Car Expenses

### UI Polish
- [ ] Assets required
  - [ ] Create one high-quality source image (SVG preferred, or PNG ≥ 512×512, square)
  - [ ] Install `@vite-pwa/assets-generator` as devDep in `frontend/`
  - [ ] Add `pwa-assets.config.ts` in `frontend/` using `minimal2023Preset` — this auto-generates:
    - Transparent favicons: 64×64, 192×192, 512×512
    - Maskable icon: 512×512 (with safe-zone padding)
    - Apple touch icon: 180×180 (solid background)
  - [ ] Add `"generate-pwa-assets": "pwa-assets-generator"` script to `frontend/package.json`
  - [ ] Run `npm run generate-pwa-assets` — output goes to `frontend/static/`
  - [ ] Wire generated icons into `manifest.json` `icons` array (or use `@vite-pwa/sveltekit` for auto-injection)
  - [ ] Add `<link rel="apple-touch-icon">` in `app.html` pointing to the generated apple touch icon
  - [ ] Set `theme_color` and `background_color` in manifest to match VROOM branding
  - [ ] (Optional) Add install screenshots manually — not generated by the tool
    - Narrow: ~1080×1920 (`"form_factor": "narrow"`) → `frontend/static/screenshots/`
    - Wide: ~1920×1080 (`"form_factor": "wide"`) → `frontend/static/screenshots/`
  - [ ] First opening/loading - car zooming past screen animation (idea)

## Small Features, Bugs, UI, Misc
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
- [x] Photos API pagination
- [x] Expense API pagination (expense page slow with lots of expenses)
- [ ] Sync status time doesn't refresh in menu after enabling backup until page reload
- [x] Photos management for cars (set cover, delete)
- [x] Fix camera flip bug
- [x] Clean up routes and routing params
- [X] Fix issue where google sheets is creating a vroom/backup folder
  - [X] Creating Vroom/Backup with backups, maintanence records, receipts, vehicles folders. SHould not need these.
  - Photos going to root and not respecting provider root
- [ ] Backend model revamp to be more performant
- [ ] Backup versioning

## Long Term Considerations
- [ ] Receipt / invoice photo-based auto-fill (OCR → expense fields)
- [ ] Anonymous cost benchmarks: opt-in aggregated data to show how your costs compare to similar vehicles
- [ ] Shareable year-end summary (exportable image or link)
  - This is a big one, proably gonna spend a full day on just this.
- [ ] Abstract out SQLite backend entirely. Bring your own SQL 
- [ ] Quick-add widget: streamlined "just filled up" flow (gallons, price, mileage — three taps)
- [ ] Pre-built templates for common maintenance schedules by vehicle type (put under profile for management)
- [ ] Reminders with push notification support


### Scaling concerns
- [ ] Redis for rate-limiting / idempotency in multi-instance deployments
- [ ] Abstract out to other backend storage (postgresql, nosql?)
- [ ] Singleton repositories capture `getDb()` at module scope — tight coupling to initialization order. Consider lazy initialization or dependency injection if adding more singletons.
