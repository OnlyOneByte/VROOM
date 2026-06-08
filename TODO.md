# VROOM Car Tracker - TODO

## Ranked Priority Queue (Angelo)

The active, ordered work queue. The agent works top-to-bottom: spec → implement →
verify (lint/type-check/build/E2E + screenshot) → tick → advance to the next item.
Verified status (audited 2026-06-05) is noted in parentheses where it differs from
a bare checkbox.

1. [x] OAuth abstraction (login provider) — ✅ wired (`backend/src/api/auth/providers/`)
2. [x] PWA asset generator (with placeholder assets) — ✅ wired (`frontend/pwa-assets.config.ts`)
3. [x] Update DB schema to be more performant — ✅ wired (`backend/src/db/schema.ts` source_id/source_type + indexes)
   - [x] what should be migrated?
4. [x] Reminders/Recurring feature (backend) — ✅ wired (`backend/src/api/reminders/`)
5. [x] Reminders/recurring feature (frontend) — ✅ `/reminders` route now built (list w/ due/upcoming/paused
   sections, pause/resume, delete, "Run due reminders" trigger), wired into Navigation
6. [x] Move insurance, financepayments to source_id/source_type system — ✅ wired (`insurance/hooks.ts`, `financing/hooks.ts`)
7. [x] Odometer entry photos — ✅ wired (`odometer/new/+page.svelte` → photo provider)
8. [x] **Offline entries** — ✅ idempotency closed end-to-end (`client_id` column + partial
   unique index, `createIdempotent`, clientId on both sync POST paths), dead `sw.js` removed,
   E2E offline round-trip green (15/15). Create-only in v1; offline edit/delete + IndexedDB
   outbox + offline app-shell caching deferred (see `.kiro/specs/offline-entries/tasks.md`).
9. [ ] Sharing between people feature (BIGGGG) ← NEXT (greenfield, 10–15d, needs design
   sign-off — deferred per the loop DoD: not a single tractable increment. Spec it first.)
10. [~] Google Photos storage provider — ✅ **backend + FE wired** (`google-photos-provider.ts`
   + `google-photos-service.ts` + injectable fake; `StorageProvider` gained optional
   `capabilities` flags so the append-only/photos-only/no-folders API degrades predictably:
   delete=no-op, list=[], PDFs gated to Drive/S3; +27 tests, all zero-network). REMAINING
   (needs live Google creds, can't verify headlessly): the OAuth **connect** path — add the
   Photos scope to the provider-connect flow + recognize `providerType:'google-photos'`.
   Spec: `.kiro/specs/google-photos-provider/`.
11. [ ] VLM Provider (receipt parsing)
12. [ ] LLM Provider (assistant)
13. [ ] Location integration
14. [ ] Push Notifications?
15. [ ] Calendar integration
16. [ ] Pull from Google Photos and auto-add expenses?

### Known Gaps (found during audit)
- [x] Reminders frontend route — RESOLVED: `frontend/src/routes/reminders/+page.svelte` built
  and wired into Navigation; route-smoke E2E covers it (16/16 green).

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
- [x] **BUILT (cycle 152): reminder create/edit UI.** New `components/reminders/ReminderForm.svelte`
  (bits-ui Dialog, serves both create + edit) wired into `/reminders`: a "New Reminder" button in the
  PageHeader actions + the empty-state CTA, and a per-row ✏️ Edit button. Fields: name / frequency
  (weekly|monthly|yearly|custom→intervalValue+unit reveal) / startDate / optional endDate / vehicles
  multi-select / optional notes — `type:'notification'`, calling `reminderApi.create`/`update` (which
  existed but were never called from the UI). Reuses the form-field kit + ExpenseForm idioms
  (`dateOnlyToISO`, Select/Checkbox/DatePicker). **Scoped: `type:'expense'` deferred** (split-config
  complexity; those are hook-created). type-check 0 / build ok / E2E `reminder-create-edit`
  (create→reload-persist→rename) + regress 47/47 green; dialog screenshot reviewed clean.
  - [x] **(cycle 153) Custom-frequency + edit-frequency branches verified.** The 152 E2E only hit the
    default monthly+name path; added `reminder-custom-frequency` E2E exercising the real-logic branches —
    select Custom → interval value+unit reveal → submit (card shows "Every 3 weeks") → reload-persist →
    edit → change to Monthly (proves edit pre-fills the frequency + the change round-trips). All green,
    no bug; regress 48/48. (E2E untracked by design.)
  - [x] **(cycle 154) Mobile (393px) eyes-on verified.** The regress mobile-overflow check runs on page
    routes but never OPENS a dialog, so the form's mobile rendering + the now-two-button PageHeader were
    unverified. Measured + shot at 393px: page no horizontal overflow (scrollW 393==393) despite two
    header buttons; dialog no horizontal overflow (359==359); tall dialog scrolls cleanly and the footer
    is reachable (Create button bottom y=621 < 727 viewport) with buttons stacking vertically (full-width
    Create over Cancel). Clean, no bug.
  _(Original gap, cycle 151: the page could list/pause/delete/run-due but `reminderApi.create` was
  called from NOWHERE and there was no edit affordance — a user could not create or edit a reminder
  from the UI at all, though the backend POST/PUT routes + schemas existed.)_
- [x] **(cycle 158) expense-type reminder create/edit UI — BUILT.** Re-grounded the cycle-152 deferral:
  the backend trigger fully supports a NO-split expense reminder (category + amount → one expense), and
  `expenseSplitConfig` is `.nullish()` (optional), so this was a modest add, not the complex thing the
  deferral assumed. `ReminderForm` gained a **Type** select (Notification | Recurring expense); when
  expense, it reveals **category** (the 6 expense categories) + **amount** (required, >0) + reuses the
  shared `TagInput`. Payload sends `expenseCategory`/`expenseAmount`/`expenseTags` only for expense type
  (explicit `null` on notification so switching type on edit clears stale values). The reminder card
  already rendered the Expense badge + amount. **Still deferred: `expenseSplitConfig`** (split across
  vehicles — genuinely hook-territory; a no-split expense reminder applies to the selected vehicle[s]).
  type-check 0 / build ok / E2E `reminder-expense-type` (toggle→reveal→create→badge+amount→reload-persist)
  + regress 49/49. **Also fixed a latent loose-selector flake the new spec exposed** in the cycle-153
  `reminder-custom-frequency` E2E (`getByRole('option',{name:'week'})` also matched "Weekly" → made it
  `exact:true`).
  - [x] **(cycle 165) Surfaced the NOTIFICATION FEED — closed a write-only gap.** The trigger writes
    `reminder_notifications` rows when a notification-type reminder fires (verified cycle 164), and the
    backend `GET /reminders/notifications` + `PUT /notifications/:id/read` + the `reminderApi`
    client methods all EXISTED — but were **called from nowhere** in `frontend/src`, so a fired
    reminder ("rotate tires") was invisible beyond a transient toast on manual trigger (same shape as
    the cycle-108 create-UI gap). Added a **Notifications** section to `/reminders`: loads the feed in
    the page's `Promise.all`, lists each row with its reminder NAME (joined client-side via a
    reminderId→name map, since the row carries only reminderId) + due date, unread rows highlighted
    (bell-ring + muted bg), per-row + "Mark all read" actions (optimistic, reload-on-failure),
    `unreadNotifications` "N new" badge. Shown whenever any exist, independent of the reminders list.
    **Also fixed a latent backend issue the UI exposed:** `findNotifications` returned rows
    **unordered + unbounded** — now `ORDER BY dueDate DESC` + `LIMIT notificationsHistoryLimit` (new
    config, 100) so a long-lapsed reminder can't return an unbounded list (cycle-9 bound-the-query
    class). Proof: `notifications-feed.test.ts` (newest-first; mark-read flips is_read + unreadOnly
    hides it; foreign/unknown id → 404 ownership-safe). type-check 0 (BE+FE) / build ok / BE 783/0;
    eyes-on /reminders desktop+mobile (feed renders, names joined, no overflow, no console errors).
  - [x] **(cycle 159) Proved the type-switch CLEARS the expense template (clear-field data-loss class).**
    The cycle-158 commit claimed switching expense→notification (form sends `expenseAmount`/
    `expenseCategory`/`expenseTags` = null) clears the stale values — the exact class that bit claims/
    terms/policy-notes/vehicles (82-85). Verified via backend HTTP round-trip
    (`reminder-type-switch-clear.test.ts`): create expense reminder w/ template → PUT to notification
    w/ null fields → the sqlite row's `expense_category`/`expense_amount`/`expense_tags` are NULL (not
    stale); reverse direction sets them. The `.nullish()` schema + route merge + repo `.set()` handle
    `null` correctly. Claim true, now guarded. BE 775/0.
  `/reminders` page lists, pauses/resumes, deletes, and runs-due, but **`reminderApi.create` is
  called from NOWHERE in `frontend/src`**, there is no edit affordance, and the empty-state says
  "Create reminders…" while only offering a **Back to Dashboard** button. So a user **cannot create
  or edit a reminder from the UI at all** — yet the backend is complete: `POST /api/v1/reminders` +
  `PUT /:id`, `createReminderSchema`/`updateReminderSchema`, and `reminderApi.create/update/getById`
  all exist and are tested. (Reminders today only enter the DB via insurance/financing auto-create
  hooks.) **Proposed scope (needs human sign-off — net-new UI surface w/ real UX choices):** one
  `ReminderForm` component serving **create + edit**, opened from a "New Reminder" button (PageHeader
  actions) + a per-row Edit button, as a **bits-ui Dialog** on the existing page (no new route),
  reusing the form-field kit. **Slice it: `type:'notification'` first** (name / frequency [weekly|
  monthly|yearly|custom→intervalValue+unit] / startDate / vehicleIds / optional endDate+
  notificationDays); **defer `type:'expense'`** (carries the expenseSplitConfig complexity and is
  usually hook-created). Verify: svelte-check + build + a create→edit E2E + regress.
- [ ] Maintenance schedule engine: define service intervals by mileage and/or time (oil change, tire rotation, brake inspection, etc.)
- [ ] Reminders when a service is due based on current mileage + last service date
- [ ] Define recurring expenses (insurance premiums, loan payments, parking passes) with frequency
- [x] Dashboard indicator for upcoming recurring expenses — ✅ `DueRemindersCard` on
  the dashboard surfaces active reminders due now / within 14 days (overdue flagged
  "Due now"), links to `/reminders`; failure-tolerant load. E2E `dashboard-reminders`.

### Sharing & Multi-Household
- [ ] Vehicle sharing: invite another user to view or edit a specific vehicle (schema, routes, UI — types already defined)
- [ ] Household view: aggregate costs across shared vehicles for a combined spending overview
- [ ] Shared expense log: expenses entered by any authorized user appear on the vehicle's timeline
- [ ] Permission levels: view-only vs. edit access per shared vehicle

### Location
- [ ] Store location with expenses
- [ ] Road trip! Trips tracking

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
- [x] Claims tracking: date, claim type (collision/theft/weather/vandalism/other), description, status (filed/in-progress/settled/denied), payout amount, fault designation (at-fault/not-at-fault/shared), linked policy — ✅ full stack: `insurance_claims` table + migration 0002, repo/routes (`/api/v1/insurance/:id/claims`), zod enums, backup/restore + sheets sync (round-trip tested), and `ClaimsSection` UI in PolicyCard (file/edit/delete, status+fault badges). 724 BE tests, E2E `insurance-claims`. (commits 92e880d→163d4aa)
- [x] Claim document uploads: attach photos, police reports, repair estimates to a claim record — ✅ `insurance_claim` is now a first-class photo entity (validateEntityOwnership case + claims-repo owner join + insurance_docs storage routing, +3 HTTP tests); FE: generalized DocumentViewer (entityType prop) in a per-claim collapsible drawer in ClaimsSection. (commits 4aa0d56, efd2e0e)

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
- [x] Auth rate limiter: use Bun's `server.requestIP()` for real client IP; only trust `X-Forwarded-For` when `TRUSTED_PROXY_IPS` env is set — DONE (cycle 5). New `utils/client-ip.ts` `getClientIp(c)`: real socket IP via hono/bun `getConnInfo`, honors X-Forwarded-For ONLY when the socket is in `TRUSTED_PROXY_IPS` (new env, default empty = nothing trusted). Both global + auth limiters rewired off the raw spoofable header (closed a brute-force-limiter bypass). +6 unit tests (trust matrix), `.env.example` documented. 705 BE tests, prod boots, 28/28 E2E.
- [x] Build out profile page (Identity card now editable: inline display-name edit wired to new
  `PATCH /api/v1/auth/me` backend route + `authStore.updateDisplayName`; real email shown; removed
  "Coming Soon" stub. Sessions/Data&Privacy/Sharing/Notifications remain intentional Coming-Soon cards.)
- [x] Let users know on settings page that auto-backups do not include images (notice in BackupSection form + ProviderInfoCard, shown when ZIP backup is enabled)
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


### Importing / Exporting
- [x] **Export expenses to CSV** (cycle 132) — `GET /api/v1/expenses/export` (unpaginated `findAll`
  + the existing csv-stringify dep; honours core vehicle/category/date filters), "Export CSV" button
  in the expenses PageHeader actions → blob download. Defines the canonical CSV column shape a future
  import can round-trip against. BE HTTP tests + E2E `expense-export-csv`. (commit pending)
  - [x] **Hardened against CSV formula injection / CWE-1236 (cycle 139).** `quoted:true` gives RFC-4180
    correctness but does NOT stop a spreadsheet from EVALUATING a cell that starts with `= + - @` /
    TAB / CR — user free-text (description / tags / vehicle nickname) could carry `=HYPERLINK(...)` or a
    DDE payload that runs when the export is opened/shared. New `utils/csv-safety.ts`
    (`neutralizeCsvCell`/`neutralizeCsvRow`) prefixes only dangerous STRING cells with `'` (numbers like
    amount untouched → export stays faithful); wired into the export `records` map. Proof: unit test
    (`csv-safety.test.ts`) + 2 new export-csv HTTP cases (payload escaped end-to-end; numeric amount not
    quoted). BE 765 pass / 0 fail; tsc clean.
  - [x] **Currency column was hardcoded `'USD'` — FIXED (cycle 140).** A EUR/GBP user's export
    mislabeled every amount as USD (the cycle 74–75 hardcoded-USD class, in the feature shipped cycle
    132). Now reads `preferencesRepository.getByUserId(user.id)?.currencyUnit` (read-only — an export
    must not create a prefs row; falls back to USD). +2 HTTP cases (EUR preference → "EUR" in the CSV;
    no-prefs → USD default). BE 767 pass / 0 fail; tsc clean.
- [x] **Per-vehicle CSV export (cycle 147)** — the global `/expenses` page had Export CSV (132) but the
  vehicle-detail **Expenses tab** didn't. Added an "Export CSV" button to that tab's list-card header
  (shown when `totalCount > 0`) calling the SAME `expenseApi.downloadExpensesCsv({ vehicleId })` — the
  export endpoint already supports `vehicleId`, so zero backend work; pure compose of the cycle-132
  pattern. Frontend-only. type-check 0 / build ok / E2E `vehicle-expense-export` (open vehicle → Expenses
  tab → Export → capture download, assert the seeded expense is in the vehicle-scoped CSV) + regress 46/46.
- [~] Import from other car cost trackers via CSV — Fuelly, Fuelio, Drivvo, Simply Auto, Road Trip,
  Spritmonitor, aCar, Car Expenses. (Large: per-app column mapping + validation + dedup + import UI.
  The export columns above — date,vehicle,category,amount,currency,mileage,volume,fuelType,
  description,tags,missedFillup,createdAt — are the round-trip target for a "VROOM CSV" importer.)
  - [x] **VROOM-CSV importer — BACKEND (cycle 190).** The tractable first slice: round-trip VROOM's
    OWN export. `POST /api/v1/expenses/import` ({ csv, dryRun }) → parses with the existing
    `csv-parse/sync`, validates every row, and resolves each row's vehicle by NAME within the importing
    user's OWN fleet (nickname OR "year make model", case-insensitive) — never a file-provided id, so it
    cannot attach cross-tenant (the cycle-145 restore class). Pure `import-csv.ts` (parse/validate/match/
    summarize — unit-testable, no DB/Hono) + a thin route. Safety rails: per-row schema bounds mirror the
    create path (amount>0 & ≤max, int mileage, category allowlist, tag/desc/fuelType lengths), fuel rows
    require volume+mileage (mirrors the POST rule), row cap (`config…maxImportRows=5000`) + 5MB body cap
    so a huge/malicious file can't exhaust memory, and **`dryRun` previews (validates + reports per-row,
    writes NOTHING)** vs commit. Errors are collected per-row (every bad row reported, not just the
    first) so the UI can show a full preview. FE: `expenseApi.importExpensesCsv(csv, dryRun)` +
    `ExpenseImportResult` types. Proof: 9 HTTP tests (export→import round-trip recreates rows; dryRun
    writes nothing; per-row bad category/amount/date reported + good rows still import; unknown/foreign
    vehicle name rejected with 0 writes; fuel-needs-volume+mileage; "year make model" match; empty CSV
    400; no-vehicles 400). BE 819 pass / 0 fail; FE svelte-check 0; regress 64/64 green. ARCC was not
    queried (MCP server unavailable) — applied standard secure-input practices (validate-all, own-fleet
    resolution, size caps, dry-run-by-preview).
    - [x] **Import UI (cycle 191).** `ImportExpensesDialog.svelte` (bits-ui Dialog, kit idioms from
      ReminderForm): a dashed-dropzone **file picker** (.csv) + a **paste textarea** fallback → on
      select/blur auto-runs `importExpensesCsv(dryRun:true)` → a **preview card** shows "N ready" (green
      check) + "M rows need attention" (red alert) with a scrollable per-row error list (e.g. "Row 3 — No
      vehicle named X in your garage") → **"Import N rows"** commits with dryRun:false → success toast +
      `onImported()` reloads the list from page 0. Wired an **"Import CSV"** button into the `/expenses`
      PageHeader actions next to Export — Import shows ALWAYS (a user with zero expenses is exactly who
      imports), Export still gated to `totalCount > 0`. `$effect` resets dialog state on close.
      svelte-check 0 / build ok / E2E `expense-import-csv` (open dialog → paste → preview "1 ready" →
      commit → row persists, found via server-side search since it sorts off page 1 by date) + regress
      65/65 green. Eyes-on desktop+mobile (393px): dialog fits, no overflow, footer stacks; preview shows
      both ready + error states. **VROOM-CSV round-trip import is now complete end-to-end** (export →
      edit in a spreadsheet → re-import). The broad multi-app importer (Fuelly/Drivvo column mapping)
      remains the deferred larger scope.
    - [x] **Round-trip fidelity fix (cycle 192) — adversarial review of my OWN 190/191 work.** The
      export neutralizes CWE-1236 cells by prefixing a leading `'` (a description starting with `=`/`+`/
      `-`/`@`/TAB/CR), and `csv-safety.ts`'s own doc warns the READ side must strip it symmetrically for
      round-trip use — but the cycle-190 importer did NOT, so `export → re-import` silently corrupted
      such a description to `'=...`. Added `denormalizeCsvCell` (inverse of `neutralizeCsvCell`: strips a
      leading `'` ONLY when the next char is a formula trigger, so a user-typed `'24 road trip` is never
      eaten) and applied it to EVERY cell as the importer reads it (+ the preview `raw` echo). Proof:
      HTTP round-trip test (`=SUM(A1:A2)` description → export → import → description IDENTICAL, not
      `'=...`) + apostrophe-preserved case; 11 new unit/HTTP cases incl. inverse-of-neutralize + no-over-
      strip + idempotent. BE 836 pass / 0 fail; regress 65/65 green.

### UI Polish
- [ ] Assets required
  - [ ] Create one high-quality source image (SVG preferred, or PNG ≥ 512×512, square)
  - [x] Install `@vite-pwa/assets-generator` as devDep in `frontend/`
  - [x] Add `pwa-assets.config.ts` in `frontend/` using `minimal2023Preset` — this auto-generates:
    - Transparent favicons: 64×64, 192×192, 512×512
    - Maskable icon: 512×512 (with safe-zone padding)
    - Apple touch icon: 180×180 (solid background)
  - [x] Add `"generate-pwa-assets": "pwa-assets-generator"` script to `frontend/package.json`
  - [x] Run `npm run generate-pwa-assets` — output goes to `frontend/static/`
  - [x] Wire generated icons into `manifest.json` `icons` array (or use `@vite-pwa/sveltekit` for auto-injection)
  - [x] Add `<link rel="apple-touch-icon">` in `app.html` pointing to the generated apple touch icon
  - [x] Set `theme_color` and `background_color` in manifest to match VROOM branding (theme_color → `#1f2937` brand slate from favicon; background stays `#ffffff` = light-mode `--background`; also updated `app.html` meta theme-color)
  - [ ] (Optional) Add install screenshots manually — not generated by the tool
    - Narrow: ~1080×1920 (`"form_factor": "narrow"`) → `frontend/static/screenshots/`
    - Wide: ~1920×1080 (`"form_factor": "wide"`) → `frontend/static/screenshots/`
  - [ ] First opening/loading - car zooming past screen animation (idea)



## Small Features, Bugs, UI, Misc
- [x] **Tag suggestions from the user's previous tags (cycle 143)** — closes the long-standing
  in-code TODO (`ExpenseForm.svelte`: "Tag suggestions will be populated from user's previous tags").
  The tag input dropdown used to offer only the static `COMMON_EXPENSE_TAGS`; it now also surfaces the
  user's own previously-used tags. `TagInput` gained an optional `suggestions?: readonly string[]` prop
  (defaults to `COMMON_EXPENSE_TAGS`, so its only other behavior is unchanged); `ExpenseForm` passes
  `[...COMMON_EXPENSE_TAGS, ...historical-not-already-common]`, deriving history from the
  ALREADY-LOADED `allVehicleExpenses` via `extractUniqueTags` (zero new network). Common tags keep their
  order; custom tags are appended. **v1 limitation (documented):** history is the selected vehicle's
  expenses (capped at the 100 the form loads for MPG), not a global tag universe — fine for
  autocomplete, and free. type-check 0 / build ok / E2E `expense-tag-suggestions` + full regress 45/45.
- [x] **Duplicate expense (cycle 141)** — recurring manual expenses (parking, tolls, registration)
  no longer need re-keying. A "Duplicate" action on the expense EDIT form deep-links to
  `/expenses/new` with the recurring fields pre-filled (vehicle / category / amount / description /
  tags) and **date left at today** (a duplicate is the NEXT occurrence, not a byte copy). Composes the
  cycle-127 deep-link prefill pattern: `new/+page.svelte` now also reads `description` + `tags`
  (comma-joined) query params → new `preselected*` props on `ExpenseForm`. Gated to single,
  non-insurance expenses (`canDuplicate`) — split groups / insurance-managed expenses are owned by
  other flows. Frontend-only, no backend/migration. type-check 0 / build ok / E2E `expense-duplicate`
  + full regress 44/44 green.
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
- [x] Sync status time doesn't refresh in menu after enabling backup until page reload (handlers now call `fetchLastSyncTime()` after persisting the toggle, so the menu's backup state/time updates immediately instead of waiting for the 30s poll or a reload)
- [x] Photos management for cars (set cover, delete)
- [x] Fix camera flip bug
- [x] Clean up routes and routing params
- [X] Fix issue where google sheets is creating a vroom/backup folder
  - [X] Creating Vroom/Backup with backups, maintanence records, receipts, vehicles folders. SHould not need these.
  - Photos going to root and not respecting provider root
- [x] Backend model revamp to be more performant
- [ ] Backup versioning
- [x]xExpense splitting to move inline
  - [x] cost splitting to happen after cost is entered
  - [x] odometer entry hidden (or per vehicle)


## Others
- [ ] Receipt / invoice photo-based auto-fill (OCR → expense fields)
- [ ] Anonymous cost benchmarks: opt-in aggregated data to show how your costs compare to similar vehicles
- [ ] Shareable year-end summary (exportable image or link)
  - This is a big one, proably gonna spend a full day on just this.
- [ ] Abstract out SQLite backend entirely. Bring your own SQL 
- [x] Quick-add widget: streamlined "just filled up" flow (gallons, price, mileage — three taps) — ✅
  dashboard "Log Fill-up" header action deep-links to the expense form pre-set to fuel (vehicle
  preselected when the user owns exactly one), returnTo=/dashboard. Composes PageHeader actions +
  gotoWithQuery + existing form preselection; no new route. E2E `dashboard-log-fillup`. (commit 1497569)
- [ ] Pre-built templates for common maintenance schedules by vehicle type (put under profile for management)
- [ ] Reminders with push notification support
- [ ] i18n internationalization

### Scaling concerns
- [ ] Redis for rate-limiting / idempotency in multi-instance deployments
- [ ] Abstract out to other backend storage (postgresql, nosql?)
- [ ] Singleton repositories capture `getDb()` at module scope — tight coupling to initialization order. Consider lazy initialization or dependency injection if adding more singletons.
