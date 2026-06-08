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

## Deep UI review findings (2026-06-07, cycle 163) — camera capture flow (sound)
Closed the dialog-layer sweep on its highest-risk, least-tested surface: the **CameraTab**
(`MediaCaptureDialog` → `media/CameraTab.svelte`), the photo-capture path used by expense receipts,
vehicle photos, odometer, and claim docs. No E2E had ever touched it (it needs camera hardware), and
it carries a bug history (the cycle-"fix camera flip bug" entry). Exercised it END-TO-END headlessly
via a one-off Playwright driver launched with Chromium's fake-media flags
(`--use-fake-device-for-media-stream` = synthetic getUserMedia track, `--use-fake-ui-for-media-stream`
= auto-grant permission). **Verified sound, no product bug:**
- Live viewfinder comes ready (video plays, "Take photo" enables), renders the synthetic feed cleanly.
- Capture → still preview with Retake / Use Photo, no console errors, desktop layout correct.
- **The stream-leak safety invariant HOLDS:** after `capturePhoto`, `video.srcObject` has **0 live
  video tracks** (`liveAfterCapture: {hasStream:false, liveTracks:0}`) — the camera is stopped, not
  left running (the class behind "camera light stays on" / flip bugs). The code is genuinely careful:
  `cameraStartId` race-guard on rapid start/stop, cleanup on unmount, Overconstrained/NotReadable
  constraint fallback, facing-mode toggle with retry.
- Also re-confirmed (read): the only object-URL non-revoke (`uploadCapture` nulls `capturedPreview`
  without revoking) is covered by the unmount `$effect` cleanup that runs first on close — not a leak.
- Did NOT add fake-media flags to `playwright.meshclaw.config.ts` (governs all 50 regress specs);
  kept it a one-off driver. Saved a workspace lesson with the technique + the safety invariant to
  assert, so a future cycle can turn this into a committed spec without re-deriving it.
- Note: provider-create POST dedups on (user+domain+providerType) → a leftover `fake` storage
  provider on the shared dev DB returns 400 ConflictError (correct behavior; only matters because the
  dialog needs a provider configured to bypass the no-provider gate). Harmless dev-DB-only residue.

## Deep UI review findings (2026-06-07, cycle 162) — dialog/modal layer (round 2)
Continued the cycle-161 dialog-layer sweep (route-smoke never OPENS a dialog, so the modal layer
is the standing visual blind spot). Drove each remaining never-screenshotted dialog open at mobile
(393px) + desktop, looking for overflow / clipping / broken state / dead wiring.
- **PaymentPlannerDialog — verified sound.** Opened it on the seeded financed (loan) vehicle's
  Finance tab, bumped the payment to surface the 3-column impact grid + "vs current" delta. No
  horizontal overflow (mobile dialog 391≤393), 3 impact cards render with no content clipping, Save
  in view, no console errors, at BOTH viewports. Also confirmed the primary "Time Saved" equaling
  the "vs current" delta is CORRECT math, not a bug: the seed's paymentAmount == minimumPayment, so
  "saved vs minimum" and "saved vs current" coincide by definition (a user paying above minimum sees
  distinct numbers). The planner state machine is also already unit-tested.
- [x] **Removed dead component `SplitCostSheet.svelte` (orphaned modal).** The review found the
  split-cost bits-ui Dialog wrapper had **zero references** anywhere in `frontend/src` (by name, by
  path, or lazy/string). Git confirms why: commit 1b55b5c ("fix: inline expense split UX") moved the
  split UX INLINE into ExpenseForm (embedding `SplitConfigEditor` directly; TODO "splitting to move
  inline"), orphaning the wrapper — it's been dead since. The inner `SplitConfigEditor` stays live
  (ExpenseForm + InsuranceTermForm). Removed the wrapper: misleading to a reader (implies split uses
  a modal) + carried into the merge for nothing. Verified safe — FE type-check 0 (file count
  5894→5893), build clean, and the cycle-161 split-delete E2E (creates + manipulates a real split
  through the live inline path) still passes. Swept the other dialogs (Backup/Restore/MediaCapture/
  PaymentPlanner/ReminderForm/DocumentViewer) — all still referenced; SplitCostSheet was the ONLY
  orphan.

## Deep review findings (2026-06-07, cycle 155) — routing / dead-link audit (sound)
Audited every declared route (`routes` + `paramRoutes` in `lib/routes.ts`) against on-disk
`+page.svelte` files and live nav targets, to catch declared-but-pageless routes that would 404 at
runtime. **No live broken links.** Findings:
- Live `Navigation.svelte` links only to routes that have pages (Dashboard/Expenses/Insurance/
  Analytics/Reminders/Trips + Settings). Detail/edit links use `paramRoutes.vehicle` (→`/vehicles/[id]`,
  exists) and `paramRoutes.expenseEdit` (→`/expenses/[id]/edit`, exists).
- Three registry entries are **declared but unused & pageless** — `routes.vehicles` (`/vehicles`),
  `paramRoutes.expense` (`/expenses/[id]`), `paramRoutes.insurancePolicy` (`/insurance/[id]`). Harmless
  dead config (nothing navigates to them; edit pages are the "detail" view by design). Left as-is —
  removing them is churn with no behavior change; noted so a future cleanup can drop them.
- `'/vehicles'` in `auth.ts protectedRoutes` is **correct** — a deliberate prefix-guard for
  `/vehicles/new` and `/vehicles/[id]` (prefix match), not a link.
- [x] **Fixed a stale self-referential test** (`Navigation.test.ts` "provides correct navigation items"):
  it asserted a hardcoded array against itself (testing nothing) AND the array was wrong — listed a
  "Vehicles" nav item the live nav dropped and omitted Insurance/Reminders/Trips. Corrected it to mirror
  the real nav + added a real assertion (every href ∈ the declared-routes set). FE 269 unit pass; tsc 0.

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

## Deep review findings (2026-06-07, cycle 140) — money precision (float storage)
Audited the money-precision dimension (never reviewed before): every money column is SQLite `real`
(float) — `expense_amount`, `payment_amount`, `payout_amount`, `deductible_amount`, `purchase_price`,
etc. Float-for-money is a latent anti-pattern, but the question that matters is "does drift reach the
user as a wrong number today?" — and **it does not**:
- **Expense splitting is correct AND test-locked.** `split-service.ts` uses integer-cents +
  largest-remainder (even: `33.34+33.33+33.33=100.00`; percentage: floor each, remainder to last,
  clamped ≥0). `split-service.property.test.ts` proves the conservation invariant (Σ allocations =
  total within ±0.01) across 100 random runs each for even/absolute/percentage + a DB round-trip — so
  the most likely drift site is guarded against regression.
- **Display always rounds.** `formatCurrency` uses `Intl.NumberFormat({style:'currency'})` (defaults to
  2 fraction digits, rounds), so SQL `SUM(real)` drift like `1998.9999999` renders as `$1999.00`.
- **The one raw-float leak (CSV export `amount`) is acceptable** — a stored `19.99` round-trips through
  JSON/JS as `19.99`; multi-cent drift only accumulates under SUM, and the export emits per-row stored
  values, not sums.
- **VERDICT: verified sound, no bug.** A float→integer-cents migration is the "correct" long-term fix
  but is a foundational cross-column/repo/route change (NOT a single tractable increment, and not safe
  to start right before a merge). Documented here so a future cycle doesn't re-investigate from scratch;
  if ever undertaken, do it as its own spec'd milestone with a migration + per-column backfill.

## Deep UI review (2026-06-08, cycle 210) — settings + odometer eyes-on (SOUND); closed odometer E2E gap
Resumed the eyes-on sweep on the two surfaces flagged but not yet eyes-on'd this pass. Booted the harness
fresh (68 green) and reviewed screenshots.
- **Settings (mobile): SOUND.** Account card, theme segmented control, unit selects, Install App, Storage
  Providers (backup/restore/photo-source) all stack cleanly, no overflow. Re-read the page: four-states +
  the c73 error-gating (don't show defaults-seeded form on failed load → Save can't overwrite real prefs) +
  Save-FAB gating all correct.
- **Odometer: SOUND** — but the route-smoke only ever captured its EMPTY state (seed has no odometer rows),
  so the POPULATED surface (Mileage chart + Readings list) had ZERO visual/E2E coverage. Seeded 3 readings
  via a throwaway driver and eyes-on'd it: line chart climbs 25k→31.2k cleanly, Readings(3) list with
  per-entry mileage/`mi`/`manual` badge/date/note + edit-delete affordances. No bug. (Noted-not-fixed: the
  y-axis is zero-based so the data sits in the top third — a defensible honest-baseline design choice, not a
  bug; left alone.)
- **Closed the coverage gap (the durable artifact):** promoted the driver into a committed-pattern E2E
  `odometer-readings.meshclaw.e2e.ts` (untracked, per repo rules) — seeds 3 readings, asserts the chart +
  readings list + seeded values render, self-cleans in finally.
- **Two real selector lessons fixed before green** (not product bugs — the screenshot proved the page
  renders): (1) `getByText('Readings (3)')` was brittle to the shared dev DB's accumulated rows → assert
  `/Readings \(\d+\)/` + verify our seeded VALUES instead of an exact count; (2) `getByText('25,000')`
  resolved to a HIDDEN element — the Overview sibling tabpanel also renders odometer-like stat figures, so
  scoped all assertions to `getByRole('tabpanel', {name:'Odometer'})` + `.first()`. Stable across 3 reruns.
- **Verified:** full regress GREEN on clean DB (69 passed, +1 = the new spec; 2 insurance-claims flakes are
  the known cleanup-timing class, passed on retry). Throwaway driver removed. No product code changed — this
  cycle's outcome is "both surfaces sound" + a closed test-coverage gap.

## Backend deep review (2026-06-08, cycle 209) — RESTORE table coverage (SOUND) + symmetric drift guards
Followed c208's export-side review with its mirror: the RESTORE half. The risk is symmetric and arguably
worse — if a table is backed up but `restore.ts` never inserts it, the data round-trips into the archive and
back out to NOTHING (silent data loss on the restore side). Read `insertBackupData` line by line.
- **Verdict: restore coverage is SOUND.** All 15 backed-up tables get a FK-ordered `tx.insert(...)` and an
  `ImportSummary` count field. The round-trip is complete today.
- **Structural risk (now guarded), worse than export:** restore has THREE hand-maintained lists that must
  agree with the registry — `TABLE_SCHEMA_MAP`, `insertBackupData`'s inserts, AND the `ImportSummary`
  interface (populated by hand in BOTH restoreFromBackup and restoreFromSheets). Miss the insert → silent
  data loss; miss the summary field → silent undercount in the user's "imported N rows" confirmation.
- **Committed guard** `restore-table-coverage.test.ts` (pure source/shape introspection — no DB, dodges the
  c208 DB-singleton import trap): (1) scans restore.ts for a `.insert(<schemaExport>)` per registry table;
  (2) parses the `ImportSummary` interface body and asserts a field per registry key. Resolves each registry
  Drizzle table to its schema export name via identity match, so it's robust to filename/key naming.
- **Proved both BITE:** disabling the `reminderNotifications` insert → guard 1 fails ("round-trip to
  nothing"); removing its `ImportSummary` field → guard 2 fails ("silently undercount"). Both reverted;
  `git diff --stat restore.ts` confirms product code untouched.
- **Verified:** full backend suite 843 pass / 1 skip / 0 fail (108 files, +2/+1); tsc clean. Test-only.
  Backup AND restore halves of the round-trip are now both drift-guarded end to end (c208 + c209). Not an
  ARCC domain (internal data-completeness invariant).

## Backend deep review (2026-06-08, cycle 208) — backup table coverage (SOUND) + committed drift guards
Balanced 6 frontend cycles with a backend review of the highest-stakes data path: backup/restore. Reviewed
one concrete, high-consequence risk never checked before — **schema drift**: VROOM has grown entity types
over many cycles (claims, reminders, offline client_id); if the backup silently omits a table that exists in
the schema, a user's restore quietly loses that data.
- **Verdict: coverage is SOUND today.** Enumerated all 18 schema tables vs. what `createBackup` exports: 15
  are backed up; 3 are excluded BY DESIGN — `users` (account identity; restore stamps onto the requesting
  user), `user_providers` (encrypted storage creds; never exported), `sessions` (ephemeral auth). 15+3 = all 18.
- **Real STRUCTURAL risk found (and guarded):** the pipeline has TWO independent hand-maintained lists —
  `TABLE_SCHEMA_MAP`/`TABLE_FILENAME_MAP` (config; drive serialize/parse/validate) and `createBackup()`'s
  hand-written per-table queries (populate the export). Nothing tied them together or to the schema, so a
  future cycle adding a table to one but not the other → silent backup data loss (and new files are OPTIONAL
  on restore, so the round-trip wouldn't complain either). This is exactly a "prevent regression under
  autonomous development" gap on a data-loss path.
- **Committed guards (travel with the merge):** `backup-table-coverage.test.ts` (2 pure guards: every schema
  table is backed-up OR on an explicit EXCLUDED_BY_DESIGN allowlist — adding a table forces a deliberate
  decision; and TABLE_SCHEMA_MAP ⇄ TABLE_FILENAME_MAP key parity) + `backup-createbackup-keys.test.ts` (runs
  the real `createBackup` under createTestApp; asserts its emitted keys EXACTLY equal the registry keys).
- **Proved both BITE:** dropping `sessions` from the allowlist → guard A fails naming `sessions`; removing
  `reminderNotifications` from `createBackup`'s return → guard B fails. Both reverted.
- **Harness lesson (fixed before commit):** a static `import {TABLE_SCHEMA_MAP} from config` in the DB-backed
  file pulled the DB singleton BEFORE createTestApp rewrote DATABASE_URL=:memory:, binding the persistent dev
  DB → `users.email UNIQUE` seed failure (the #59 isolation gotcha). Fix: import config dynamically AFTER
  createTestApp, and split the pure guards into their own (DB-free) file.
- **Verified:** full backend suite 841 pass / 1 skip / 0 fail (107 files, +3/+2); tsc clean. Test-only; no
  product code touched. (Not an ARCC domain — internal data-completeness invariant, not creds/PII/network.)

## Deep UI review (2026-06-08, cycle 207) — fixed overlapping axis titles on the amortization chart
Resumed the eyes-on sweep (rather than add a 3rd scan-guard) — booted the harness fresh (70 green) and
eyes-on'd the under-reviewed vehicle-detail FINANCE tab. Found a real, eyes-on-only layout defect on the
**Amortization Schedule** chart: the x-axis TITLE "Payment Number" rendered in the same band as the centered
tick, colliding into "Payment Num#33ber"; the rotated y-axis title "Amount ($)" likewise overlapped the
left tick values. (axe/route-smoke can't see overlapping text — only an eyes-on pass catches it.)
- **Root cause + scope:** `FinancingCharts.svelte` was the ONLY chart in the app passing axis-title `label:`
  strings (`xAxis.label`/`yAxis.label`). layerchart draws the title in the tick band without reserving space,
  so it overlaps. Verified the convention: every other chart (`AppBarChart`/`AppLineChart`/`AppAreaChart` +
  all analytics charts) omits axis titles — the card Title/Description + legend already name the axes.
- **Fix (matches convention, zero new layout risk):** removed both axis `label` titles. The card header
  ("Amortization Schedule — Payment breakdown per month — principal vs interest"), the Principal/Interest
  legend, the `#N` x-ticks, and the currency-formatted y-ticks (`formatCurrencyAxis`, still currency-aware)
  convey everything. Also removed the now-unused `getCurrencySymbol` import + `currencySymbol` derived (the
  c202 y-label was its only consumer; note it was already dynamic `(${currencySymbol})`, so it never matched
  — and didn't need — the c205 hardcoded-currency scan).
- **Verified:** tsc 0 errors (no unused-var); re-ran the vehicle-detail route-smoke and re-shot the finance
  tab — the overlap is GONE, ticks read cleanly `#1…#57` / `$0–$400`. Harness green (70). Not an ARCC domain.

## Regression prevention (2026-06-08, cycle 206) — committed source-scan guard for the native-dialog class
Applied the c205 scan-guard pattern to a second proven class. Native `confirm()`/`alert()` are
UNDER-DISCLOSING (a confirm can show only one line, so it can't surface a destructive cascade like "this also
deletes 3 photos"); cycles 89–91 + 195 migrated every one to the kit's disclosing `ConfirmDialog`. First I
GROUNDED that the migration is actually complete: a strict scan found ZERO real `confirm(`/`alert(` calls —
all 7 textual hits are migration comments ("replaces native confirm()"). So this is a pin-at-zero guard, not
a fix.
- **Guard:** `frontend/src/lib/utils/__tests__/no-native-dialogs.test.ts` — committed Vitest source scan
  (travels with the merge; the e2e harness can't catch a native confirm() since it auto-dismisses headlessly).
  Scans every `.svelte`/`.ts` for a CALL-shaped `confirm(`/`alert(` (optionally `window.`-prefixed).
- **Low false-positive design (the hard part — these WORDS are everywhere):** the regex uses a negative
  lookbehind `(?<![\w.])` so the kit `<Alert>`/`<AlertDialog>` components, `role="alert"`, `confirmOpen`/
  `showDeleteConfirm` state, and "Review and confirm" copy never match — only a bare invocation does. Plus a
  comment-stripper that removes `/* */` blocks, JSDoc `* ` lines, AND `//` lines (URLs preserved), so doc
  mentions like ConfirmDialog's own header don't trip it. (Initial naive version flagged that JSDoc line —
  caught + fixed before commit.) `prompt()` is deliberately NOT scanned: its sole hit is a TS method signature
  on the PWA `BeforeInstallPromptEvent` interface (a real browser API), not the native dialog.
- **Proved it BITES:** temporarily added `if (!confirm('Delete this photo?')) return;` to
  `VehiclePhotoCarousel.requestDelete` → the scan FAILED naming `VehiclePhotoCarousel.svelte:31` + an
  actionable "use ConfirmDialog" message, while the JSDoc mention 6 lines above did NOT trip. Reverted;
  re-confirmed green.
- **Verified:** tsc 0 errors; full Vitest 339 pass / 31 files (+2); zero false positives against current code.
  Pure source scan, no browser/server. Two classes (currency, native-dialog) now have merge-surviving guards.

## Regression prevention (2026-06-08, cycle 205) — committed source-scan guard for the hardcoded-currency class
The nudge added "ways to prevent regression under autonomous development." The non-default-settings bug class
(c202 hardcoded `($)` labels, c203/204 cold-load fallbacks) has a STRUCTURAL hole: the harness only ever runs
as the seeded USD/imperial user, and the per-instance fixes are pinned by UNTRACKED `*.meshclaw.e2e.ts` guards
that DON'T travel with the merge. So when `feat/offline-entries` lands, those guards vanish and the class can
silently regress.
- **Built a committed, merge-surviving, class-level guard:** `frontend/src/lib/utils/__tests__/no-hardcoded-currency.test.ts`
  — a static source scan (Vitest, fast unit suite, runs on `npm test`, travels with the repo). It walks every
  `.svelte` under `src/` and fails on a currency symbol in a parenthesized label-suffix position — `($)` `(€)`
  `(£)` — which is exactly the c202 shape ("Deductible ($)"). The regex is deliberately narrow so JS template
  interpolation (`${x}`) never matches.
- **Allowlist:** only `UnitPreferencesCard.svelte` (the currency SELECTOR legitimately renders "USD ($)" /
  "EUR (€)" — it names the currency, isn't a money-field label). A separate test asserts that allowlisted path
  still exists, so the allowlist can't silently go stale. A third test asserts the scan found >20 files (so a
  broken path resolution can't make the guard a silent no-op).
- **Proved it BITES (a guard that can't fail is worthless):** temporarily reverted `InsurancePolicyForm`'s
  Deductible label to `($)` → the scan FAILED and named `InsurancePolicyForm.svelte:401` with the offending
  line + an actionable "route through getCurrencySymbol()" message. Reverted; re-confirmed green.
- **Verified:** tsc 0 errors; full Vitest suite 337 pass / 30 files (+3); zero false positives against current
  (post-c202) code. Pure source test — no browser/server, no ARCC domain.
- Follow-on idea (not done): the same pattern could guard other classes (e.g. raw `confirm(`/`alert(` calls now
  that ConfirmDialog exists, or hardcoded hex colors outside the token files) — a small committed scan per class.

## Cold-load follow-through (2026-06-08, cycle 204) — swept settingsStore readers; fixed VehicleForm unit defaults
The c203 layout hydration has broad blast radius, so I audited whether it FULLY closed the cold-load fallback
class or whether some readers snapshot the pre-hydration default NON-reactively (which would still show
imperial/USD even after the store hydrates — looking fixed while silently stale). Grepped all 20
`settingsStore` readers: 18 use `$derived` (reactive — correctly pick up hydration) and one — `VehicleForm`
— is the outlier.
- **VehicleForm** seeds `distanceUnit/volumeUnit/chargeUnit` via `$state(settingsStore.unitPreferences.…)`,
  whose initializer runs ONCE at mount. On a cold/direct `/vehicles/new` load the layout's ASYNC settings
  load hasn't resolved, so it captures the imperial DEFAULT and never updates. **Empirically confirmed** with
  a throwaway probe: under metric (km/L) settings the form showed "Miles · Gallons (US) · kWh" — a metric
  user adding a vehicle gets imperial unit defaults pre-selected (and silently saved if unnoticed).
- **Fix:** keep the three units mutable `$state` (the user edits them), add a create-mode, seed-until-touched
  `$effect` that re-syncs from the store once it hydrates — guarded by `isEditMode` (edit populates from the
  vehicle) and a `unitsTouched` flag (set by the 3 unit selectors + edit-mode populate) so it never clobbers
  an explicit choice or a loaded vehicle's saved units.
- **Verified:** tsc 0 errors. New guard `vehicle-form-unit-defaults.meshclaw.e2e.ts` (2 cases: metric defaults
  appear on cold load; an explicitly-picked unit is NOT reverted by a late hydration tick) — both pass. Full
  regress GREEN on a clean DB (**70 passed, 0 flaky**), incl. the vehicle-edit param-route smoke (edit-mode
  populate still correct) + all axe. The 18 `$derived` readers were left as-is (already correct). Not an ARCC
  domain (display/unit state).

## Guard + deeper fix (2026-06-07, cycle 203) — pinned the c202 currency fix E2E; it EXPOSED a real hydration bug
Set out to close c202 properly: pin the currency-aware insurance labels at the WIRING level (the c202 fix was
only unit-tested at the `getCurrencySymbol` helper; a refactor could revert a label to `($)` and stay green
since axe/smoke only ever see the seeded USD). Wrote `insurance-currency-label.meshclaw.e2e.ts` (set
currency=EUR via API → load /insurance/new → assert labels show €, not $).
- **The guard FAILED first run — surfacing a real, deeper bug.** Label read `Deductible ($)` under EUR.
  Root cause: `getCurrencySymbol()`/`formatCurrency()` read `settingsStore.settings?.currencyUnit` with a
  **USD fallback when the store is null** — and the store is hydrated only by `/settings`, `/expenses`, and
  `ExpenseForm` (each calls `settingsStore.load()`); the **root layout never did**. So a EUR/GBP user landing
  directly on (or refreshing) any page that doesn't self-load settings — the insurance forms, and latently
  any other `settingsStore`/`formatCurrency` reader — saw `$`. The c202 label fix was correct but couldn't
  win against an unhydrated store.
- **Fix (root cause, not symptom):** hydrate `settingsStore` app-wide in `+layout.svelte`, in the same
  auth-gated `$effect` that already loads vehicles (`loadUserSettings()`, idempotent via a `settingsLoaded`
  guard). currency + unit prefs are global display state; this makes the symbol correct EVERYWHERE on a
  cold/direct load, not just on the three pages that happened to self-load.
- **Verified the fix closes it:** the guard, rewritten to load /insurance/new DIRECTLY (no settings pre-visit
  — the true cold-load path), now PASSES. tsc 0 errors. Full regress GREEN on a clean DB (66 passed, incl. the
  new guard + all route-smoke/axe); the 2 insurance-claims flakes were cleanup-timing, passed on retry.
- The guard is an untracked `*.meshclaw.e2e.ts` (correct per repo rules); the durable code change is the
  layout hydration. (Not an ARCC domain — display/currency state, not creds/PII/infra.)

## Deep UI review (2026-06-07, cycle 202) — eyes-on insurance/vehicle forms; fixed hardcoded ($) currency labels
Continued the eyes-on sweep from c201 (covered ~4 of ~20 surfaces then). Reviewed the data-entry forms
not yet deep-reviewed — vehicle-new (clean) and **insurance-new (mobile)**, where eyes-on caught a real
i18n bug the green harness can't see: every money-field label hardcodes a literal **`($)`** — "Deductible
($)", "Coverage Limit ($)", "Total Cost ($)", "Monthly Cost ($)", "Payment Amount ($)". A user whose
`currencyUnit` is EUR/GBP sees the WRONG symbol on every insurance money field — the same class as cycles
74/75 (which fixed display + chart-tick `$`, but these form labels + one chart axis TITLE were missed).
- **Scope (evidence-backed): 11 sites fixed.** 5 labels in `InsurancePolicyForm`, 5 in `InsuranceTermForm`,
  and 1 chart-axis TITLE in `FinancingCharts` (`'Amount ($)'` — its tick *values* already used the
  currency-aware `formatCurrencyAxis` from #75, so the hardcoded `$` title contradicted €/£ ticks).
- **Left as-is (correct):** the 5 `UnitPreferencesCard` entries (`'USD ($)'`/`'CAD ($)'`/`'AUD ($)'`) — those
  are the currency-SELECTOR options; they legitimately name which dollar. Swept for sibling patterns (bare
  `$` prefixes in money labels) — none found.
- **Fix:** added `getCurrencySymbol(currency?)` to `formatters.ts` — resolves the user's unit exactly like
  `formatCurrency`, then extracts the `currency` part via `Intl…formatToParts` (returns "$"/"€"/"£", or the
  raw code like "CHF" when no glyph). Labels now read `({currencySymbol})` via a `$derived`.
- **Verified:** tsc 0 errors; new Vitest guard in `formatters.test.ts` (3 cases: USD→$, EUR→€/GBP→£/no-$,
  CHF→code fallback) — 11/11 pass; no E2E spec selects on these labels (can't break selectors); re-shot the
  insurance form (no console errors). (Not an ARCC domain — display/currency formatting, not creds/PII/infra.)

## Deep UI review (2026-06-07, cycle 201) — eyes-on full-route sweep; fixed a mobile label-wrap on the expense form
A UI review was due (cycles 198–200 were all backend; last fresh eyes-on was c196/profile, dark mode c197).
Booted the self-healing harness fresh (`RESET_DB=1 START_SERVERS=1`): **67 passed**, every route smoke- and
axe-clean (incl. dark mode + all four contrast guards). Then eyes-on'd the captured screenshots across
desktop + mobile — the floor (green tests) doesn't prove "looks right".
- **Triaged + dismissed two screenshot artifacts (the #65 over-reading trap):** (1) a dark "Add Expense"
  pill overlapping the vehicle-detail insurance card is the `FloatingActionButton` (`fixed bottom-4 …
  sm:bottom-8 sm:right-8`) rendered at its capture-time viewport offset inside a stitched full-page PNG —
  not a real overlap (the re-shoot shows it pinned correctly bottom-center). (2) "blank" Expense/Fuel trend
  charts: `ChartCard` has correct four-states + visibility-gating, and `getTrendLineProps` renders a lone
  point as a visible `r:6` dot, so single-month seed data is *expected* to show a dot/skeleton, not a bug.
  (Also confirmed `FuelEfficiencyTrendChart`'s `MIN_DATA_POINTS=1` is self-consistent: 0→empty state,
  1→dot, 2+→line; "add 2 fuel entries" copy is right since N fill-ups yield N−1 efficiency points.)
- **Found + fixed a REAL eyes-on-only bug** on the **mobile Add-Expense form** (the highest-traffic
  data-entry surface): in `CategorySelector`, the six category cards share a 2-col mobile grid with a
  `flex items-center gap-2 [icon][label]` row. Five labels are concise single words; **`misc` was the lone
  multi-word label `'Misc Operating Costs'`**, which wrapped to a second line and floated the icon mid-card,
  breaking the row rhythm. Shortened it to **`'Misc'`** — which *also* realigns the selector with the
  canonical `categoryLabels.misc = 'Misc'` used in every table/chart/dashboard; nothing is lost because the
  card's description (`'Tolls, parking, etc.'`) already carries the detail. Invisible to axe/route-smoke
  (it's pure label wrapping) — which is why 67 green tests never caught it.
- Updated the untracked `expense-create.meshclaw.e2e.ts` selector (`/Misc Operating Costs/` → `/Misc/`,
  still unique). tsc 0 errors; the expense-create spec passes (2/2); re-shot the mobile form to confirm the
  Misc card now matches its five siblings exactly. Backend `EXPENSE_CATEGORY_LABELS` (verbose API label,
  endpoint unconsumed by the frontend) left as-is — out of scope.

## Backend coverage gap closed (2026-06-07, cycle 200) — committed 2 orphaned offline-idempotency tests
While orienting (verifying the tree cycle 199 left clean), found TWO backend test files that had been
sitting **untracked for 2 days** and were NOT part of the by-design untracked set (`.meshclaw-tools/`,
`*.meshclaw.e2e.ts`, etc.): `backend/src/api/expenses/__tests__/idempotent-create.test.ts` and
`backend/src/db/__tests__/migration-0001.test.ts`. Both pass and exercise **committed, clean** source.
- **Why this is a real gap, not cruft:** `bun test` discovers by filesystem, so these have been running
  green every cycle (part of the 838/105 count) — but they're invisible to git. On a merge or fresh
  checkout they'd silently vanish, taking the coverage with them. And they cover the **offline-outbox
  idempotency contract** — the foundational money-write-dedup primitive of the very `feat/offline-entries`
  branch about to be merged: `createIdempotent`/`findByClientId` (same `(userId, clientId)` → one row,
  retry returns the original un-mutated, cross-user isolation, no-clientId → plain create) and the
  migration-0001 schema that backs it (`client_id` column + partial UNIQUE `(user_id, client_id)` index
  that allows many NULLs but rejects a dup non-NULL).
- **Conspicuous sequence gap:** committed db tests had `migration-0000` ✓ and `migration-0002` ✓ but
  **skipped 0001** — the offline-idempotency migration, the schema centerpiece of this branch. The
  orphaned 0001 test mirrors the committed 0002 test's convention exactly (same `migration-helpers`,
  same structure), slotting straight into the hole.
- **Faithfulness verified (not just "passes"):** re-read `createIdempotent` (repository.ts:186) — the
  tests pin the pre-check return, the no-overwrite-on-retry invariant, cross-user isolation, and the
  plain-create fallback. The catch-block TOCTOU race-recovery (re-read on unique-violation) isn't driven
  directly (would need a flaky interleave or the `mock.module` pattern task #43 deliberately removed),
  but its two sub-primitives are each pinned independently — the index throwing on dup (0001 test) and
  the re-read (`findByClientId` tests) — so it's covered by composition. Confirmed no committed test
  already covered these (the only other `0001` grep hits were coincidental `0.0001` tolerances).
- Test-only; no product code touched. Full backend suite green: 838 pass / 1 skip / 0 fail, 105 files.

## Backend deep review (2026-06-07, cycle 199) — reminder-trigger idempotency / CAS (SOUND, now pinned)
Continued the backend pass on the recurring-expense ENGINE (`trigger-service.ts`) — the runtime that
auto-creates expenses/notifications when reminders fire. Risk probed: does triggering twice (the "Run
due reminders" button is clickable repeatedly) double-create money rows? **Verdict: sound.**
- The trigger advances `nextDueDate` past `now` via `advanceNextDueDateTx`, which is a **compare-and-swap**
  (`UPDATE … WHERE nextDueDate = expectedCurrentDueDate`). Correctness is owned by the OUTER loop
  re-reading `nextDueDate` and passing that exact value as the CAS `expected`, so the expense INSERT and
  its matching advance are always consistent within one period; the CAS is belt-and-suspenders against a
  concurrent second advance.
- **Pinned the previously-untested CAS primitive** (`trigger-idempotency-cas.test.ts`, 2 cases): (1)
  three back-to-back POST /trigger calls write exactly ONE expense (the re-read finds the advanced date
  and processes nothing); (2) `advanceNextDueDate` with a STALE expected-date matches 0 rows and is a
  silent no-op (date unchanged, NOT clobbered), while the correct expected-date advances — proving the
  WHERE-guard actually rejects a lost-race overwrite. The existing trigger-expense.test only exercised
  the happy advance + sequential no-dup + endDate bounding; the CAS *mismatch-rejection* path was the gap.
- Test-only; no route/product code touched. BE 838 pass / 0 fail (+2).

## Backend deep review (2026-06-07, cycle 198) — split-expense money math (SOUND) + tightened penny-drift guard
Pivoted from the long UI/a11y arc to a BACKEND money-math review — the classic float failure is
split-expense distribution not summing to the total (penny drift across N vehicles). **Verdict: the
math is sound.** `split-service.ts`: `even` = integer-cents largest-remainder (exact by construction),
`percentage` = floor each non-last + assign remainder to last (exact, clamped ≥0), `absolute` = pass
through + validation enforces sum=total within <0.001. All three sum-invariants AND the DB round-trip
were already property-tested (`split-service.property.test.ts`). No distribution bug.
- [x] **Fixed a real test-PRECISION gap it exposed.** Property 3 (DB-backed sum) asserted the persisted
  siblings re-sum to groupTotal within `< 0.02` — but `computeAllocations` is penny-EXACT (Property 1
  asserts the pure sum `=== totalAmount`), so `< 0.02` was looser than the code's own guarantee: a true
  ±0.01 regression (one sibling off by a penny) would have passed silently. Tightened both the returned-
  sum and DB-read-sum assertions to **cent-equality** (`Math.round(sum*100) === Math.round(total*100)`).
  Proving it stays green is the real result: the split distribution is genuinely penny-exact end-to-end,
  **including the SQLite float round-trip** — the code was always right; the test was under-asserting.
  Now a genuine penny-drift regression fails. BE 836 pass / 0 fail (test-only change; no route touched).
- **Confirmed sound, left as-is:** percentage/absolute validation tolerance (<0.001); the summary
  `SUM()` over the float column is display-only aggregation (the float→integer-cents migration remains a
  deliberately-deferred milestone, not a per-cycle fix).

## Deep UI review (2026-06-07, cycle 197) — DARK MODE (never axe-scanned; verified SOUND + guarded)
Every prior screenshot and the route-smoke axe gate run in LIGHT mode only — so dark mode (the `.dark`
token block, toggled via `vroom-theme-preference` localStorage / ThemeCard) was a whole second theme
with its OWN colors that had never been holistically reviewed. Extra motivation: cycle 194 added
`--warning` DARK values I'd only verified COMPILED, never rendered.
- **Result: dark mode is sound.** Ran an axe color-contrast sweep across all 7 main routes
  (/dashboard, /expenses, /insurance, /analytics, /reminders, /settings, /profile) with dark forced via
  `addInitScript` localStorage → **0 violations on every route** (`dark=true` confirmed applied). The
  cycle-194 dark `--warning` is used as text and would have surfaced here — it's clean. Eyes-on the dark
  dashboard: cohesive slate surfaces, proper card separation, readable text, chart-color StatCard icons,
  amber "Due now" badges, FAB visible — no light-on-light bleed, invisible borders, or broken surfaces.
- [x] **Added a committed regression guard** (`e2e/dark-mode-a11y.meshclaw.e2e.ts`, untracked by design):
  forces dark via the real toggle mechanism and asserts axe color-contrast = 0 across the 7 routes.
  Closes the standing light-only blind spot so a future dark-token regression (new surface, or a token
  tweak) can't slip through. Deliberately a SEPARATE spec, not a branch in route-smoke — keeps the
  existing a11yClean ratchet untouched and can't destabilize it. regress **67/67 green** (was 65 +
  this guard; fully clean run, no flake).
- No product change this cycle — the review found nothing to fix; the value is the proven-clean finding
  + the permanent guard on a theme that had zero coverage.

## Deep UI review + fix (2026-06-07, cycle 196) — /profile (sound) + 3 latent text-on-chart-2 contrast cases
Holistic eyes-on of /profile — never reviewed since it was "built out" in cycle 4 (~190 cycles ago).
**The page is sound** (identity + inline display-name edit w/ keyboard save/escape; connected-accounts
link/unlink w/ last-method guard; live data export; coming-soon cards for sessions/sharing/notifications;
the delete-account row correctly uses full-opacity muted text + a "Coming soon" pill, not a contrast-
failing dim). **Found 1 latent contrast bug on it + 2 of the same class elsewhere** — all the cycle
187-189 text-on-chart-color family, all behind states the route-smoke axe scan never reaches:
- [x] **Profile "Account linked successfully" banner** (`+page` L309-311) — `text-sm text-chart-2` on
  `bg-chart-2/10` ≈ 3.26:1 (fails AA). Renders only on `?success=linked` after an OAuth link round-trip,
  so the a11yClean `/profile` scan never saw it. Fixed: icon keeps chart-2 (graphical/exempt) + tint bg;
  text → `text-foreground`.
- [x] **FuelFieldsSection efficiency box** (L271/283/288/298) — the "Calculated: X mpg" label + the
  ⚠️/✅ messages were `text-chart-2`/`text-chart-5` small text on a `bg-chart-2/10` tint (~3.1:1, fails;
  chart-5 amber worst). Behind the fuel-expense MPG path. Fixed the same way (icon keeps the hue, text →
  `text-foreground`; the ⚠️/✅ glyph carries the good/poor signal).
- **Left alone (verified sound):** FuelStatsTab L267 `text-xl bold text-chart-2` — large text → 3:1 bar →
  3.66:1 PASSES (confirmed c189). The profile ERROR banner uses `text-destructive` (darkened to clear AA
  earlier), fine.
- Verified with a targeted **axe color-contrast probe** of both previously-unreachable states
  (`/profile?success=linked` + the fuel form with volume+mileage filled → "Calculated" box shown): both
  went to **0 violations**. svelte-check 0; **regress 65/65 green** with `/profile` + `/expenses/new`
  still a11yClean. This is now the 4th surface where the text-on-chart-color class hid behind a
  tab/data/query state the standing scan can't reach — the per-state probe is the reliable catch.

## UI consistency (2026-06-07, cycle 195) — reusable ConfirmDialog; retired ALL native `confirm()` deletes
Closed the destructive-action-consistency gap flagged in cycle 194 — and did it at the right level. The
app had THREE delete-confirm styles (native `confirm()`, inline AlertDialog, inline Dialog); 6 deletes
still used the raw browser `confirm()` (unbranded, no disclosure, inconsistent).
- [x] **Built `common/ConfirmDialog.svelte`** — a reusable, disclosing confirm primitive on the
  AlertDialog kit (the semantically-correct role). Controlled `bind:open`; props `title`/`description`/
  `confirmLabel` (default "Delete")/`cancelLabel`/`destructive` (default true)/`onConfirm`. `onConfirm`
  may be async: shows a spinner + disables both buttons while it runs, and **closes only on success** —
  if it throws, the dialog stays open so the caller's error toast is visible (matches the ExpensesTable
  delete-dialog ergonomics).
- [x] **Converted all 6 native `confirm()` deletes** to it: ExpensePhotoSection, VehiclePhotoCarousel,
  DocumentViewer, ClaimsSection, PolicyTermCard (the 5 planned) **+ the `/reminders` reminder delete**
  (the grep caught it — it was the very gap that motivated this; leaving it would've been incoherent).
  Each now shows a branded modal with a disclosing, item-named description (e.g. "X will be permanently
  deleted. This cannot be undone."). **Zero native `confirm()` remain in `src/`.** Left the already-
  styled inline dialogs (OdometerTab Dialog, ExpensesTable AlertDialog) alone — they work and weren't
  the gap; a future cycle could fold them into the primitive too.
- Verified: svelte-check 0 (file count +1), build ok, **regress 65/65 green** incl. the
  `delete-confirmations` E2E (the `confirm()`→DOM-dialog change didn't break it), eyes-on the converted
  reminder-delete dialog desktop + mobile 393px (centered modal, named description, neutral Cancel + red
  Delete; mobile stacks full-width, no overflow).

## Deep UI review + fix (2026-06-07, cycle 194) — /reminders interactions + undefined `--warning` token (no-op color)
Holistic eyes-on of the interaction-dense `/reminders` page — it accreted over ~15 cycles (list,
due/upcoming/paused sections, create/edit dialog, pause/resume, delete, run-due, notification feed) but
never got a single unified review. **Found a real bug:** `text-warning` (reminders +page L225/297/358)
and `text-warning` + `bg-warning/10` (dashboard `DueRemindersCard` L55/66) reference a `--warning`
token that **was never defined** in `app.css`. In Tailwind v4 an undefined `--color-warning` means
`text-warning`/`bg-warning` emit **no rule at all** — so the "Due now" urgency cue (the `BellRing`
icons, the section-heading icon, the dashboard "Due now" badge) rendered in the **inherited/default
color, not amber**. Someone wired the class into two components but never declared the token.
- [x] **Defined the `warning` token properly** (not just patched the class): `--warning` in `:root`
  (dark amber `oklch(0.52 0.12 75)` — chosen DARK so `text-warning` clears WCAG AA 4.5:1 as text; the
  light chart-4/5 ambers L≈0.83/0.77 FAIL as text per cycle 189) + `.dark` (lighter `oklch(0.8 0.13 80)`
  to read on the near-black surface, mirroring how `--destructive` lightens in dark mode) + mapped
  `--color-warning` in the `@theme inline` block so Tailwind emits the utilities.
- **Verified 3 ways**: built CSS now contains `.text-warning{color:var(--warning)}` (absent before the
  fix); the live computed color of a `.text-warning` node resolved to `oklch(0.52 0.12 75)` (was the
  inherited default); eyes-on screenshots show the amber `BellRing` on Due-now cards + the dashboard
  "Due now" badge. svelte-check 0 / build ok / **regress 65/65 green** — and crucially `/dashboard` +
  `/reminders` stay a11yClean (the new amber-as-text passes AA, so this did NOT reintroduce the c189
  contrast class).
- **Rest of `/reminders` verified sound**: Due/Upcoming/Paused sections, per-card Pause/Resume/edit/
  delete, badges, the notification feed (read/unread + mark-all-read) all render and wire correctly; no
  overflow. **Noted, deferred (not this cycle):** `deleteReminder` uses native `confirm()` — but so do
  4 other deletes (photos/terms/docs/claims); it's broad consistency debt vs. the styled AlertDialog
  pattern (cycles 89–91 deliberately scoped that to high-disclosure deletes), functional not broken, so
  not worth a churny sweep now.

## Deep UI review + fix (2026-06-07, cycle 189) — analytics tabs: per-tab axe sweep (Per-Vehicle health-score contrast)
Extended the c187/188 a11y work to /analytics, which has the SAME tab-gated blind spot: 4 tabs (fuel-stats
default + 3 lazy — cross-vehicle, per-vehicle, year-end), and the route-smoke axe scan only ever sees the
default tab. Built a per-tab axe driver (read-only, clicks each tab, scrolls to render IO-gated charts) to
get ground truth instead of guessing thresholds.
- **Found 1 CONFIRMED failure** — PerVehicleTab overall health-score number: `text-3xl font-bold
  text-chart-5` (amber #fe9a00) on its own `bg-chart-5/10` tint (#fff5e5) = **1.97:1**, failing WCAG AA
  even at the relaxed large-text 3:1 bar (amber on a light tint is genuinely illegible). The score's color
  was ALSO the only signal of the health tier (color-only meaning — a second a11y problem).
- [x] **Fixed AND improved**: the number is now `text-foreground` (legible, >10:1); the tier is conveyed
  by the colored ring (graphical) PLUS an explicit text label — "Good / Fair / Needs attention · out of
  100" (added `getScoreLabel`, removed `getScoreColor`). So the rating is legible, not color-only, and
  clearer (a user no longer has to KNOW amber=fair). Eyes-on screenshot confirmed it reads well.
- [x] **Fixed 2 LATENT cases of the same class** (axe didn't flag them — the seed data didn't hit those
  branches, but they WILL fail when it does): YearEndTab YoY "spending down" delta (`text-lg medium
  text-chart-2`, 3.66:1) and FuelStatsTab `changeBadge` (`text-xs text-chart-2`, 3.66:1). Both fixed with
  the c187/188 principle — the direction hue stays on the TrendingUp/Down ICON (graphical, exempt), the
  TEXT is `text-foreground`.
- **Confirmed sound (left alone):** FuelStatsTab "Best efficiency" `text-xl bold text-chart-2` is large
  bold → 3:1 bar → 3.66:1 PASSES (a legitimate highlight; over-fixing would be churn). Cross-Vehicle and
  the rest of Year-End: 0 violations. Eyes-on: no overflow, good data/empty states across all four tabs.
- [x] **Deterministic committed guard** (`e2e/analytics-tabs-contrast`): clicks each of the 4 tabs, selects
  a vehicle on Per-Vehicle so the score badge renders, asserts axe color-contrast = 0 per tab. Closes the
  tab-gated blind spot for analytics the way c187/188 did for the dashboard + finance tab.
- Verified: per-tab sweep went 1 violation → **0 across all four tabs**; FE svelte-check 0; full regress
  **64/64 GREEN** (63 + the new guard); the c187 dashboard + c188 finance guards still green.

## Deep UI review + fix (2026-06-07, cycle 188) — finance tab: text-on-chart-color contrast (sweep of the cycle-187 class)
Followed up the cycle-187 finding's own note that PaymentHistory carried the same text-on-tint pattern.
Built a deterministic guard to PROVE it before fixing — and it surfaced that the defect was BROADER than
the one badge: the vehicle Finance tab had **THREE distinct text-on-chart-color WCAG AA failures**, none
catchable by the existing harness (the /vehicles/[id] axe scan is warn-only, runs on the Odometer tab,
and the worst offender only renders for an EXTRA payment).
- **PaymentHistory extra-payment number badge** — `bg-chart-2/10 text-chart-2`, 3.08:1. In BOTH the
  virtual-scroll AND standard-scroll render paths (a `replace_all` first missed the second copy because
  a comment insertion de-synced the blocks — caught by the guard rendering the standard path, the common
  case). Renders for any payment exceeding the scheduled paymentAmount (a normal action).
- **NextPaymentCard progress %** — `text-chart-1` (#f54900) on white = 3.59:1 (and chart-2 3.66:1 in the
  >75% branch). Removed the `progressColor` derived entirely → `text-foreground`; the colored Progress
  BAR below already carries the signal.
- **NextPaymentCard "Paid" amount** — `text-chart-2` (#009689) on white = 3.66:1 → `text-foreground`
  (the "Paid" label identifies it).
- [x] Fix principle (same as cycle 187): keep chart color on GRAPHICAL elements (the TrendingDown icon,
  the Calendar icon, the card border, the tint background, the progress bar) where it's axe-exempt and
  carries the affordance; make the TEXT `text-foreground` so it passes AA. Icons/borders untouched.
- [x] **Deterministic committed guard** (`e2e/finance-payment-history-contrast`): seeds a `financial`
  expense with `sourceType:'financing'` + `sourceId` (both required — the Finance tab filters payment
  history to financing-sourced expenses, and the create route validates the id) at 2× the scheduled
  payment so it's flagged `extra`, opens the Finance tab, asserts axe color-contrast = 0. Self-cleaning.
  Proven real: it FAILED on the broken code (all three violations) and PASSES now.
- Verified the THREE were the complete set on that tab (axe flagged exactly those elements, no others).
  FE svelte-check 0; full regress **63/63 GREEN** (62 + the new guard). The dashboard guard from c187
  still green. This closes the text-on-chart-color class across both the dashboard and the finance tab.

## Deep UI review + fix (2026-06-07, cycle 187) — dashboard category badge failed WCAG AA contrast (a11yClean regression)
A deep UI review of the /expenses sort/filter/export surface (heavily reworked in c178/180/186 but not
eyes-on since) started with a fresh `RESET_DB` regress as the baseline — which **surfaced a real,
reproducible a11y regression on `/dashboard`** (failed on run AND retry, not flaky). The project's own
`a11yClean` ratchet flagged it: a `data-slot="badge"` with `text-chart-2` (#009689 teal) on its own
`bg-chart-2/10` tint (#e5f5f3) = **3.26:1**, below WCAG AA's 4.5:1 text minimum (serious).
- **Root cause = a latent CLASS, not a one-off.** `RecentActivityCard` colored each expense's category
  *label TEXT* (`text-chart-N` on a same-hue 10% tint) for every category. The chart palette is tuned
  for chart FILLS, not small text on its own tint — chart-2 fails at 3.26; the lighter chart-4 (L≈0.83)
  and chart-5 (L≈0.77) fail WORSE; only the dark chart-3 would pass. The scan caught it
  NON-DETERMINISTICALLY: the seed's only `financial` expense is dated 2024-01-01 (oldest, never in the
  date-desc recent-5), so it only renders when a parallel spec's churn injects a chart-colored expense
  dated today. "Darken chart-2" would be wrong — the text-on-tint APPROACH is wrong.
- [x] **Fixed at the pattern level**: category now renders as a colored ICON chip + NEUTRAL
  `text-foreground` label (the canonical row already used in ExpensesTable). Color lives on the icon
  (graphical → axe-exempt) + the tint background; the label text is near-black/white (>10:1). Also
  IMPROVES a11y: category is no longer conveyed by color alone (icon + text). Removed the dead local
  `categoryColors` map + the now-unused `Badge` import; reused `getCategoryColor`/`getCategoryIcon`.
- [x] **Added a deterministic committed regression guard** (`e2e/dashboard-recent-activity-contrast`):
  seeds a `financial` (chart-2, worst offender) expense dated now so it lands in recent-5, then asserts
  axe finds 0 color-contrast violations. Self-cleaning. **A/B-proven**: reverting the label to the old
  text-on-tint makes the guard FAIL; the fix makes it PASS (not a vacuous green). The route-smoke
  `/dashboard` scan alone couldn't catch this reliably (seed-dependent) — this closes that blind spot.
- [x] **Bonus consistency fix on the reviewed surface**: `/expenses` page-level "Clear Filters" button
  visibility omitted `categoryFilter` while `hasActiveFilters` (passed to the table) and `clearFilters`
  both include it — so a category-only filter hid the page Clear affordance. Aligned the predicate.
- Eyes-on screenshot confirmed the badge still reads as a proper category affordance. Proof: FE
  svelte-check 0 errors; full regress **62/62 GREEN** (was 61 + the new guard); `/dashboard` a11yClean
  gate restored. The other `text-chart-N` usages are icons (exempt) or large/bold text on white (pass);
  `PaymentHistory`'s `text-chart-2` payment-number badge is the same text-on-tint pattern but lives
  behind the finance tab (not in the a11yClean set) — noted for a future sweep, low-risk.

## Fix + refactor (2026-06-07, cycle 186) — CSV export now matches the filtered table (search + tags + category)
Real "export doesn't match what I see" gap, more visible after sort/category went server-side (c178/180):
`GET /expenses/export` accepted vehicleId/category/dates but NOT search or tags, and the `/expenses`
page's export handler ALSO omitted category — so a user who searched / tag-filtered (or even
category-filtered) the table then clicked Export CSV silently got a BROADER file than they were viewing.
- [x] **Extracted a shared `buildExpenseConditions(filters)` helper** used by BOTH `findPaginated` and
  `findAll`, killing the duplicated WHERE-building logic (vehicleId/category/dates were copy-pasted in
  both; only findPaginated had tags+search). Now the list table and the export filter through the SAME
  code — a divergence (the root of this bug class) is structurally impossible. Moved `tags`+`search`
  onto the base `ExpenseFilters` so `findAll` accepts them. Tags keep AND semantics; search is the same
  case-insensitive description+category LIKE.
- [x] **Wired search + tags through the export route** (`exportQuerySchema` gained `search` + comma-split
  `tags`, same coercion as the list query) and the **frontend** (`downloadExpensesCsv` accepts/sends
  search+tags; the `/expenses` `handleExportCsv` now passes EVERY active filter — vehicle, category,
  date, search, tags — fixing the silent category omission too).
- **CSV-injection safety intact:** `neutralizeCsvRow` still wraps every row (untouched); the one-way
  export remains neutralized (cycle-139 class). The deferred backup-ZIP/Sheets round-trip sinks are
  unaffected — this only touched the one-way export path.
- Proof: 2 new HTTP tests (search-filtered export omits non-matching rows; tags AND-filter omits
  partial/none) + the refactor preserved all 82→**(now 84)** expense tests. BE 810 pass / 0 fail, FE
  svelte-check 0, regress 61/61 GREEN (export E2E specs pass with the wider wiring).

## Deep review findings (2026-06-07, cycle 185) — financing date helpers (sound, now pinned — module coverage complete)
The last two untested financing functions, both behind NextPaymentCard's user-facing "next payment
due": `calculateNextPaymentDate` + `calculateDaysUntil`. `calculateNextPaymentDate` has real edge
complexity — a `setMonth`-based monthly advance (the classic JS month-end rollover trap), a
`maxIterations` runaway guard, weekly/bi-weekly/monthly variants, a `lastPaymentDate` override, and
graceful fallbacks (returns a Date, never throws). Read it + **exercised the edges**: **sound, no bug.**
- [x] **Pinned the contract (test-only).** New `utils/__tests__/next-payment-date.test.ts` (13 cases):
  future-start returned as-is; each frequency advances to a future date (weekday preserved for weekly,
  14-day multiple for bi-weekly, day-of-month preserved for mid-month monthly); `lastPaymentDate`
  override; unknown frequency falls back to monthly; **month-end rollover characterized** — a 31st
  start yields a valid future date that's either the 31st (long months) or rolled to the 1st-3rd
  (short months), never Invalid Date or a wild value (benign + now documented so any change is
  deliberate); missing/invalid startDate returns a current Date (no throw). `calculateDaysUntil`: ceil
  day-diff for future (+10d+1min → 11), 0-or-1 at now, negative for past. FE 318→331 unit, tsc 0.
- This COMPLETES financing-calculations.ts coverage: every exported fn now has tests
  (derivePaymentEntries + amortization from earlier; minimum-payment + payoff-date c171; leaseMetrics
  c184; next-payment-date + days-until c185). The money-math test-pinning vein is now mined out — next
  cycles should lean feature/UI/product-decision, not more calc coverage.

## Deep review findings (2026-06-07, cycle 184) — lease mileage/excess-fee math (sound, now pinned)
Deliberately picked a NON-expenses area (5 prior cycles were expenses + harness): the financing/lease
subsystem. `LeaseMetricsCard` → `calculateLeaseMetrics` computes the lease burn-bar AND a real dollar
figure (`projectedExcessFee = projectedExcessMiles × excessMileageFee`), dividing `mileageUsed /
daysElapsed` for the burn-rate projection — the same money/ratio class that bit cost-per-mile and
financing 0%-APR. It had **ZERO test coverage**. Read it: **sound** — `Math.max(0,…)` guards on
mileageUsed / mileageRemaining / projectedExcessMiles, a `daysElapsed > 0` guard on milesPerDay, and
null/non-lease/invalid-date early returns. No product bug.
- [x] **Pinned the contract (test-only, no product change).** New `utils/__tests__/lease-metrics.test.ts`
  (12 cases): non-lease/missing-date/invalid-date → null (no throw, no NaN leak); over-limit lease →
  `mileageRemaining` clamps to 0 (never negative) + `isOverMileage` true; odometer-rollback (current <
  initial) → used clamps to 0; excess fee = excessMiles × per-mile rate exactly; missing
  `excessMileageFee` → fee 0 not NaN; brand-new lease starting TODAY (daysElapsed 0) → no divide-by-zero,
  projection finite; + a 200-run fast-check property proving EVERY numeric output (used/remaining/
  projectedFinal/excessMiles/excessFee/daysRemaining/monthsRemaining) is finite AND non-negative across
  random leases (over-limit, future-dated starts included). Guards the divide-by-zero + negative-leak +
  phantom-fee classes against a refactor. FE 306→318 unit, tsc 0. Verified the edges by exercising, not
  just reading.

## Deep UI review findings (2026-06-07, cycle 183) — settings storage-provider create form (sound) + closed a route-smoke gap
Eyes-on the most feature-dense UI never focus-reviewed: `/settings/providers/new` — provider-type
Select (Google Drive / S3 / OneDrive+Dropbox "Soon") → conditional S3Form / GoogleDriveForm sub-forms
+ BackupSection + PhotoFolderSection folder config + credential inputs. Reviewed desktop + mobile
(393px) across THREE states (initial, S3-selected, Google-Drive-selected) via the authenticated driver.
**Verified sound — no bug:**
- All 3 states × both viewports: **0px horizontal overflow, axe serious/critical = 0, zero console
  errors.** The S3Form `grid-cols-2` bucket/region pair holds at 393px; both credential inputs
  (`type=password`) and the endpoint/folder/backup fields fit cleanly.
- **Chased one apparent defect to ground (it's an artifact, not a bug).** The full-page mobile
  screenshot showed the fixed "Save Provider" bar painted over the Name input — the classic cycle-32
  `position:fixed` stitch artifact (full-page captures paint fixed elements over the stitched tall
  image). Confirmed via REAL in-viewport geometry, not the shot: the bar is a standard mobile
  full-width bottom action bar (`fixed bottom-4 left-4 right-4`), the form reserves `pb-32 sm:pb-24`
  clearance, and at max scroll the LAST control clears the bar by ~117px (nothing permanently
  obscured). On desktop the same bar floats in the right margin clear of the `max-w` form column.
- [x] **Closed the coverage gap:** added `/settings/providers/new` to route-smoke (static route, so
  it slots into the ROUTES loop). Marked `a11yClean: true` (enforced — proven clean across all states),
  with the fixed bar hidden for the capture so it reads real layout not the artifact. regress 61
  passed (was 60), exit 0, GREEN — the new case passed overflow + enforced-a11y + console gates.
- Note: the edit variant (`/settings/providers/[id]/edit`) shares the same `ProviderForm` component —
  same layout, just pre-filled — so the new-form coverage transitively guards it; a param-route smoke
  for it (needs a seeded provider id) is a possible future add but low marginal value.

## Docs (2026-06-07, cycle 182) — refreshed BRANCH_REVIEW.md merge digest to cycle-181 scope (136 → 143 commits)
The digest was 7 commits stale (last refreshed cycle 173 at 136 commits; branch is now 143, 0 behind).
Added §13 covering cycles 174–181, all from real `git log/diff origin/main..HEAD` + live suite output:
the auth-gate deny-by-default fix (d57c837), server-side expense sort (37db22b) and category filter
(69bfb61) — both closing page-local bugs — and the double-gated DISABLE_RATE_LIMIT harness fix
(e28666a). Refreshed the header scope (143 commits / 181 files / +17,883 / −1,639), the status block
(BE 808 pass / 1 skip, FE 306 unit + tsc 0, E2E 60/60), the env-var callout (noted ALLOW_FAKE_STORAGE
+ DISABLE_RATE_LIMIT are harness-only / production-refused), and the zero-divergence re-verification.
No new migration this arc (still the two additive ones). Docs-only.

## Harness fix (2026-06-07, cycle 181) — root-caused + fixed the recurring "cold-compile cluster" (it was the rate limiter)
For ~6 cycles a cluster of specs (route-smoke /vehicles/[id], vehicle-expense-export, settings-persist,
term/vehicle-clear-field) flaked every regress and I'd written it off as "cold-compile." Pulled the
actual failure contexts this cycle: TWO faces, ONE cause. (a) Most failed on their FIRST line —
`page.request.get('/api/v1/vehicles')` returning empty ("seeded user should have a vehicle"); (b) one
showed the smoking gun: `RATE_LIMIT_EXCEEDED, statusCode: 429`. The global limiter (1000 req / 15 min,
in-memory, keyed on IP) was exhausted by my own back-to-back regresses this session (~10 runs, each
firing hundreds of requests), and a 429 on /vehicles surfaces as empty data → the "no vehicle"
failures. Pure test-environment artifact of harness volume, NOT a product bug (the cycle-176 lesson,
now fully root-caused).
- [x] **Double-gated `DISABLE_RATE_LIMIT` bypass (the real fix).** New env flag, mirrored exactly on the
  existing `ALLOW_FAKE_STORAGE` pattern: `CONFIG.disableRateLimit = env.DISABLE_RATE_LIMIT && env !==
  'production'` — so it can NEVER weaken production abuse protection (the `&& !== production` term forces
  it false in prod regardless of the flag). The `rateLimiter` factory short-circuits to `next()` when
  set, so ALL limiters (global + auth + sync + backup + restore + trigger) respect it uniformly.
  regress.sh boots the backend with `DISABLE_RATE_LIMIT=1` alongside `ALLOW_FAKE_STORAGE=1`. Documented
  both harness-only flags in `.env.example` (production-refused). No test asserts limiter behavior, so
  the bypass is safe; backend tsc 0.
- [x] **Also added an auth+seed readiness gate to regress.sh** (`wait_for_authed_seed`): after minting,
  poll `GET /api/v1/vehicles` through the Vite proxy with the minted cookie until the seeded vehicle is
  servable, before running specs. Closes the residual startup race (the old `wait_for` accepted a 401
  "up" response, so specs could start before auth+seed were live) and fails fast with a clear message.
- **Result: regress GREEN for the first time this session — 60 passed / 0 failed / 1 known dialog flake
  (passes on retry), exit 0.** The cluster is gone; previously-flaking specs now pass on attempt 1
  (count rose 55→60). This also retroactively re-validates the cycle-178/180 expense-sort +
  category-filter features in a fully-clean suite. The regress floor is now trustworthy for the human
  merge review again. Lesson reinforced: when isolated/back-to-back runs fail on empty data or 429,
  suspect the in-memory limiter FIRST — and now the harness just bypasses it.

## Feature (2026-06-07, cycle 180) — server-side expense CATEGORY filter (closed the page-local filter bug)
Eyes-on review of the cycle-178/179 sort UI (desktop + mobile screenshots from the regress)
confirmed it renders clean — and surfaced the sibling bug I'd flagged: the ExpensesTable category
Select (`ExpensesTable.svelte`) filtered **client-side over the current page only** (`filtered.filter(
e => e.category === ...)`), so picking a category hid matching rows on other pages. Same page-local
class as sort; backend list query already supported `category`.
- [x] **Made the category control controlled-mode, mirroring sort exactly.** New `activeCategory` +
  `onCategoryChange` props; when the parent provides the handler the Select reports to it (parent
  re-fetches the page server-filtered across ALL rows) and the local client filter is SKIPPED; with no
  handler it stays client-local (the vehicle-detail tab keeps its in-page refine). `categoryFilter`
  became a `$derived` of active-vs-local; both desktop + mobile Select handlers route through a single
  `handleCategoryChange`. Wired `/expenses`: `categoryFilter` state → `buildListParams` `category` →
  `handleCategoryChange` (reset to page 0, re-fetch page only — the Expense Overview total stays
  all-category/vehicle-scoped, consistent with how search/date/tags already behave) → added to
  `clearFilters` + `hasActiveFilters`. `displayExpenses` is a bare passthrough, so no double-filter.
- [x] **Backend cross-page invariant pinned** (4 tests added to `sort-paginated.test.ts`, now 10):
  category filter finds a match buried on page 2 (the bug), no-filter returns all, composes with
  search (both applied), user-scoped. BE tsc 0, expenses suite 82/82 (was 78).
- [x] **E2E `expense-category-filter.meshclaw.e2e.ts`** (untracked): seed 22 misc + 1 regulatory on an
  old date, pick Category=Regulatory, assert the buried regulatory row shows + misc fillers gone.
  Green in regress. Selector lessons: the bits-ui Select.Trigger is a `button` (name = its visible
  "Category" text), NOT a `combobox` role; and a bare getByText('amount') hits BOTH the desktop table
  cell and the CSS-hidden mobile card → scope to `table tbody`.
- Note: same isolated-rerun auth friction as cycle 179 (RESET_DB wipes the session; only regress
  re-mints in the right order) — verified via the harness, not isolated `-g`. The 5 regress failures
  this run (route-smoke, settings-persist, term/vehicle-clear-field, vehicle-expense-export) are the
  known cold-compile cluster on heavy edit/detail routes (different specs flake each run, none mine) —
  amplified by my many back-to-back regresses this cycle. NEXT (same class, smaller): the table's
  VEHICLE filter on the vehicle-detail tab and any remaining in-page tag filter.

## Feature (2026-06-07, cycles 178-179) — server-side expense sort (fixed a DEAD sort + page-local sort bug)
The `/expenses` page and the vehicle-detail Expenses tab are server-paginated (20/page) but the
ExpensesTable sorted **client-side over the current page only** — so "sort by amount desc" surfaced
the biggest expense ON PAGE 1, not overall (the cycle-10 search class, re-applied to sort). Worse,
the grouped `tableRows` re-sorted by date **unconditionally**, so the Amount/Type headers were a
**no-op** (only direction toggled). Found by reading the table while looking for a tractable feature.
- [x] **Backend: `sortBy` (date|amount|category) + `sortDir` (asc|desc) on the list query.** Allowlist
  map (never a raw column name → no injection) + a stable `id` tiebreaker appended so paginated ties
  don't drop/duplicate rows across pages. Defaults to date desc when omitted — byte-identical to prior
  behavior. `findPaginated` orders the WHOLE filtered set before limit/offset. Route schema gained the
  two enums. Proof: `sort-paginated.test.ts` (6 cases incl. the headline cross-page property — global
  max floats to page 1 when sorting by amount even though it's the oldest row — + stable-tiebreaker
  pagination, category sort, default-date-desc, user-scoping). BE tsc 0, expenses suite 78/78.
- [x] **Frontend: threaded `sortBy/sortDir` through `buildExpenseQuery` + both pages; made
  ExpensesTable controlled-sort.** When `onSortChange` is provided the headers report intent to the
  parent (which re-fetches the page server-sorted across all rows) instead of sorting the visible
  slice; client sort stays as the uncontrolled fallback. Fixed the `tableRows` date-override so the
  active field is honored (group rows use total amount / group date). Dropped the dead first-tag "Tags"
  sort (no server equivalent, already broken). `buildExpenseQuery` test +2 (emits sort params / omits
  when default). FE svelte-check 0, FE unit 304+.
- [x] **E2E `expense-sort.meshclaw.e2e.ts`** (untracked): seeds 23 rows with a large amount on an OLD
  date so default date-desc buries it on page 2, then clicks Amount → asserts the global max is row 1
  (fails on the old page-local sort). Self-cleaning. Regress 57 passed with this + all 3 expense-search
  green.
- **Process notes (two self-inflicted test bugs, both caught + fixed):** (1) first seeded the rows as
  category `maintenance`, which pushed the expense-search spec's "Jiffy Lube" row off page 1 (shared
  dev DB, parallel workers); (2) switching to `fuel` then 400'd because fuel expenses require
  volume+mileage — surfaced only after I added a status-printing seed helper (a bare `res.ok()`
  hid it). Final fix: category `misc` (no fuel-field requirement, no search-spec collision). Also
  re-confirmed the cycle-177 friction the hard way: isolated `-g` reruns keep using a STALE auth-state
  after each `RESET_DB` regress wipes the Lucia session — only `regress.sh` self-heals (mint→seed
  order). Saved the shared-DB-category lesson via learn_add. The 3 regress failures
  (`/vehicles/[id]`, vehicle-expense-export, settings-persist) are the known cold-compile cluster,
  not mine (different specs flake each run).

## Deep review findings (2026-06-07, cycle 177) — FOUND + FIXED an auth-gate gap (4 routes leaked a broken authed shell to logged-out users) + legal pages sound
Finished the public-page sweep (the two pages footer-linked from the landing page I reviewed
cycle 176): `/privacypolicy` + `/termsofservice` — and, probing the auth gate while there, found
a real client-side route-protection gap.
- **Legal pages — verified sound (anon, desktop + mobile 393px).** `/privacypolicy` (h1 + 10
  sections) and `/termsofservice` (h1 + 11 sections) render with 0px horizontal overflow, axe
  serious/critical = 0, proper h1→h2 hierarchy, all external links carry `rel="noopener noreferrer"`,
  `max-w-3xl` reading width. Real, well-structured legal content — not stubs. Only the benign `/me`
  401 session-probe in the console (same expected line as cycle 176). No change needed.
- [x] **FOUND + FIXED: four authed routes were not auth-gated client-side (UX/correctness bug).**
  `frontend/src/lib/utils/auth.ts` `protectedRoutes` was a hand-maintained ALLOWLIST
  (`/dashboard,/vehicles,/expenses,/analytics,/settings`) that had silently drifted incomplete as
  routes were added — it OMITTED `/insurance`, `/reminders`, `/profile`, `/trips`. PROVEN via an
  anonymous (no-cookie) browser probe: hitting those four logged-out did NOT redirect to `/auth` —
  the browser stayed on the authed page shell, which then rendered "Authentication required" /
  "Failed to load" error states (header + nav + action buttons like "New Reminder"/"Run due
  reminders" all visible to a logged-out visitor; `/profile` showed "? Unknown Display Name"). The
  two listed controls (`/dashboard`, `/expenses`) correctly bounced. **NOT a data-exposure bug** —
  the backend correctly 401s every API call (cycle-138 IDOR audit holds), so no private data leaks;
  it's a broken-shell UX/correctness defect on a logged-out hit.
  - **Root-cause fix (not symptom): inverted to DENY-BY-DEFAULT.** Rewrote `auth.ts` to enumerate the
    small, stable PUBLIC set (`/`, `/auth`, `/privacypolicy`, `/termsofservice`) and protect
    EVERYTHING else — so a newly-added authed route is guarded automatically and the failure mode is
    safe-closed, instead of leaking until someone extends an allowlist (which is exactly how this
    drifted). Match is exact-or-segment (`pathname === route || startsWith(route + '/')`) so `/`
    doesn't match everything and a name-prefix can't accidentally make a route public. Split out
    `authRedirectRoutes` (only `/auth`) for the authed→dashboard bounce so an authed user can still
    READ the legal pages (they're public but not redirect-away).
  - **Live-verified failing→fixed:** re-ran the same anon probe — all four now redirect to `/auth`
    ("Welcome back"), matching the controls. Regress 57 passed on fresh servers (deny-by-default did
    NOT break authed navigation — `/dev/gallery`, `/profile`, `/insurance`, `/reminders`, `/trips`,
    vehicle-detail, the 3 edit routes all still reachable authed).
  - **Closed the cycle-155 self-referential test gap that ALLOWED this drift:** the existing
    `ProtectedRoute.test.ts` re-implements the redirect inline and never calls the real functions, so
    nothing pinned which routes are protected. New `utils/__tests__/auth.test.ts` (12 cases) tests the
    REAL `isProtectedRoute`/`isPublicRoute`/`handleRouteProtection`: every authed route (incl. the 4
    that leaked) is protected, every public route isn't, sub-paths inherit, `/` doesn't make
    everything public, logged-out hits on protected routes bounce to `/auth`, authed users get
    redirected off `/` and `/auth` but can READ the legal pages. FE 304 unit pass (was 292); tsc 0.
- Note (pre-existing flake, NOT mine — A/B proven): `vehicle-expense-export.meshclaw.e2e.ts` flaked
  (blank page — cold-compile/download race on the heavy `/vehicles/[id]` route); it was the lone
  failure in cycle-176's clean run too, and it fails IDENTICALLY with my `auth.ts` change stashed, so
  it's exonerated. Candidate harness hardening: the spec clicks the Expenses tab right after
  `networkidle` with no wait for the page heading to confirm hydration. Deferred (untracked spec,
  orthogonal).

## Deep UI review findings (2026-06-07, cycle 176) — PUBLIC (unauthenticated) pages + closed a structural harness blind spot
Reviewed the two pages the authenticated regress harness STRUCTURALLY can't cover — the landing
page (`/`) and the sign-in page (`/auth`). Both have an `$effect` that redirects an authenticated
session straight to `/dashboard`, AND route-smoke explicitly asserts pages do NOT sit on `/`, so an
auth-injected browser never sees them. They're the first impression every logged-out visitor gets,
recently rewritten (auth re-write + moved `/auth`→`/`), and never screenshotted. Reviewed via an
ANONYMOUS (no-cookie) Playwright driver — which is both the correct tool AND sidesteps the recurring
auth-injection friction (there's no cookie to be rejected). **Verified sound — no bug:**
- Landing `/` desktop + mobile (393px): hero ("Know your car. Own your data."), the open-source
  badge pill, both CTAs (stacked on mobile, inline on desktop), the 6-card feature grid (1-col
  mobile / 3-col desktop), CTA section, footer with Privacy/Terms links — all render with 0px
  horizontal overflow, no clipping, axe serious/critical = 0.
- Sign-in `/auth` desktop + mobile: "Back to home", logo tile, "Welcome back", both provider buttons
  (Google + GitHub, full-width in a max-w-md card), security microcopy, footer — clean, 0px overflow.
- **The real test — the error-banner state at mobile** (`?auth_error=email_exists`, the LONGEST of
  the 6 messages, a long string inside a max-w-md card): wraps cleanly across 3 lines in the
  destructive-tinted banner, the alert icon holds its place (`shrink-0`), no overflow, no clipping.
  This is exactly what an automated px-check can't confirm.
- **The single console 401 is EXPECTED, not a defect:** `+layout.svelte` → `authStore.initialize()`
  → `GET /api/v1/auth/me` is the "do I have a session?" probe; for a logged-out visitor it correctly
  401s and the store's `catch` handles it gracefully (`isAuthenticated=false`, `error=null`). The
  browser logs any failed request to the console regardless of app handling. It never appears in
  route-smoke because that harness is always authenticated (where `/me` is 200).
- Cosmetic note (NOT a product bug): the 🚗 emoji renders as a tofu box in this headless environment
  (missing emoji font); real browsers on macOS/Windows/Android/iOS ship emoji fonts.
- [x] **Closed the structural coverage gap (regression guard, untracked route-smoke addition).** The
  loop DoD says "add a route to route-smoke for every new page," but these two NEVER could — the
  sweep is auth-injected and asserts no-bounce-to-`/`. Added a `test.describe('public
  (unauthenticated) pages')` block that overrides `storageState` to anonymous (`{cookies:[],
  origins:[]}`) and applies the same floor to `/`, `/auth`, and `/auth?auth_error=email_exists`:
  renders the right page (heading visible, NOT bounced to `/dashboard`), axe serious/critical = 0
  (ENFORCED — a new public page must stay clean), no mobile horizontal overflow, and the ONLY
  tolerated failed request is the `/me` 401 probe (any other 4xx/5xx or non-401 console error fails
  loudly). Captures `landing{,-mobile}.png` + `auth{,-mobile}.png` + `auth-error{,-mobile}.png` for
  the UI-critic pass. Verified: the 3 anon tests pass inside the live suite; svelte-check 0 errors;
  regress 57 passed on a freshly-booted backend.
- **Honest process note (test-env artifact, not a regression):** repeated isolated `-g` reruns +
  mints against ONE long-lived backend tripped the in-memory GLOBAL rate limiter (`limit:1000`/15min,
  keyed on IP `127.0.0.1`) — once tripped, EVERY request 429s, so `/me` fails (bounce to `/auth`)
  AND the unauthenticated `/providers` fails ("Failed to load sign-in options"), collapsing a hot-
  backend regress to 5 passed. Proven environmental four ways: (a) the identical command passed 57 on
  a freshly-BOOTED backend (limiter counter reset); (b) the failure also hits the UNAUTHENTICATED
  `/providers`, ruling out any session/auth bug and fingerprinting a cross-cutting IP limiter; (c)
  curl to the backend stayed healthy 200; (d) bounce-to-`/auth` is the app's CORRECT graceful
  degradation when `/me` is non-200. Lesson: reboot the backend (or wait out the window) between
  heavy regress repeats; don't hammer one long-lived process. The clean re-verify is `RESET_DB=1
  START_SERVERS=1 regress.sh` (fresh limiter) run ONCE.

## Deep UI review findings (2026-06-07, cycle 175) — /insurance page (feature-dense, sound)
Eyes-on the most feature-dense page never focus-reviewed: `/insurance` — PolicyCard with the
nested Current-Term sub-card, the ClaimsSection (status/fault badges + payout + file/edit/delete),
collapsible Documents drawers, Expired/Renew affordances. Reviewed desktop + mobile (393px), with
the busiest state (a populated claim) visible in the capture. **Verified sound — no bug:**
- Desktop: PolicyCard header + term sub-card (Expires/Total Cost/Monthly/Vehicles label→value rows)
  + Documents + Claims + action row all laid out cleanly; Expired badge + edit/delete/Renew fit.
- Mobile 393px (the real test — a claim row packs two-or-three badges + date + payout + 3 action
  icons): the badges **wrap to a second line gracefully** rather than overflowing/clipping; the
  term sub-card, empty-states, and File-Claim/Upload buttons all fit. No horizontal overflow, no
  truncation, no badge collision. The automated harness already confirms `/insurance` is a11y-clean
  + 0px overflow + no console errors every regress run; this eyes-on adds what the px-check can't see
  (graceful badge wrap on the populated claim row).
- **No product change.** Observed only dev-DB test-data pollution (lingering `E2E …` policies from
  prior specs whose finally-cleanup didn't fully run) — harness residue (RESET_DB wipes it), not a
  product issue. Auth-injection friction on the standalone driver recurred (cycle-169 environment
  class); used the regress-booted authenticated `/insurance` captures instead.

## Deep UI review findings (2026-06-07, cycle 172) — edit param-routes (harness coverage gap, sound)
Extended the cycle-169 approach to the EDIT param-routes the harness never page-level-checked —
`/expenses/[id]/edit`, `/vehicles/[id]/edit`, `/insurance/[id]/edit`. They need a real entity id so
they couldn't ride the static route-smoke loop; existing edit-page E2E specs only test desktop
interactions (clear-field, duplicate), never **mobile overflow / a11y / console errors** at the page
level. These are high-traffic forms with a FIXED floating action bar (Delete/Duplicate/Cancel/Save) —
exactly the cycle-32 FAB-overlap / cycle-169 overflow class.
- [x] **Added a parametrized edit-route smoke to route-smoke** (untracked, regress-only): resolves a
  real id per page via the API, asserts no login-bounce + no console errors + a11y + **no mobile
  horizontal overflow** (393px), with desktop+mobile captures; a page with no seeded entity is
  skipped+logged (robust to seed contents).
- **Result: all 3 verified SOUND — no bug.** Unlike the vehicle-detail page (cycle 169), the edit
  forms have zero mobile overflow, zero console errors, and are a11y-clean. Eyes-on the expense-edit
  mobile capture confirmed real form content (vehicle select, 2-col category grid fitting cleanly,
  floating action bar within the viewport) — the "no overflow" assertion is meaningful, not vacuous.
  regress 56/56 (was 53). Now permanently guarded + captured for the UI-critic pass.

## Deep UI review findings (2026-06-07, cycle 169) — vehicle-detail tabs (FOUND + FIXED a mobile overflow)
Eyes-on review of the high-traffic multi-tab vehicle-detail page (Overview/Expenses/Finance/Odometer)
— the last primary route the harness never screenshotted or a11y-scanned (route-smoke covered
`/vehicles/new` but not `/vehicles/[id]`, which needs a real id). Closing that gap immediately paid off:
- [x] **FIXED: vehicle-detail page overflowed horizontally by 7px on mobile (393px).** Root cause in
  the shared **`StatCard` dual-metric layout** (used by `FuelEfficiencyStatsCard` with `columns={3}` →
  a 2-col grid at mobile): each cell packs two `text-2xl font-bold` money values (e.g. "Total Fuel
  Cost $97.80") + a divider, and the value spans had no `min-w-0`/`break-words`, so an unbreakable
  currency token set a min-content width wider than the grid track. Fixed at the kit level (helps every
  consumer — dashboard, analytics, vehicle detail): `min-w-0 break-words` on the dual-metric value
  spans + `min-w-0` on the StatCardGrid grid items (the canonical CSS-grid `min-width:auto` blowout
  guard). Verified: docScrollW 400→393; FE type-check 0, build ok, regress **53/53**.
- [x] **Closed the harness coverage gap:** added a `/vehicles/[id]` (all-tabs) case to route-smoke —
  resolves a seeded id, drives all 4 tabs (per-tab capture), asserts no console errors + a11y + **no
  mobile overflow**. This is the spec that caught the 7px bug and now permanently guards it.
- Honest process note: my first fix targeted the wrong (standard) StatCard layout, and a
  rate-limited finder run briefly *looked* fixed (stats failed to load → cards empty); I caught the
  confound, re-checked on a clean page, and traced it to the dual-metric layout. The other 3 tabs +
  desktop showed no overflow and no console errors.

## Deep review findings (2026-06-07, cycle 168) — analytics division math (zero denominators)
Reviewed the division-heavy analytics money math (TCO cost-per-mile / cost-per-month, year-end
cost-per-distance, fleet-health, per-vehicle stats), since the most common real state — a brand-new
vehicle with zero mileage / owned zero days — is exactly where `cost ÷ distance` and `cost ÷ months`
produce NaN / Infinity / garbage (the cycle-3/4 infinite-radius chart class). **Verified sound — every
denominator is guarded:**
- `vehicle-stats.ts costPerMile` only divides when `totalMileage > 0` (else null); MPG/efficiency
  gated the same way.
- analytics `getVehicleTCO`: `costPerDistance = totalDistance > 0 ? totalCost/totalDistance : null`;
  `ownershipMonths = Math.max(1, monthDiff)` so `costPerMonth` can never divide by zero (and a future/
  null `purchaseDate` can't make it negative or non-finite).
- year-end + per-vehicle `costPerDistance`, `avgEfficiency`, per-coverage premium splits — all guard
  the `> 0` denominator before dividing.
- [x] **Pinned the zero-state contract (cycle 168, test-only, no product change).** The math was
  correct but UNTESTED at its riskiest input — no TCO test existed. Added
  `analytics/__tests__/vehicle-tco-zero-state.test.ts` (real stack → `getVehicleTCO` → DB): a brand-new
  vehicle yields all-finite numbers (`costPerDistance` null not NaN/Infinity, `costPerMonth` 0 via the
  clamp); an expense-but-zero-distance keeps `costPerDistance` null (no x/0 Infinity); a future
  `purchaseDate` stays finite + non-negative. Guards the whole class against a refactor reintroducing
  an Infinity/NaN into the analytics UI. BE 789/0; tsc 0.

## Deep review findings (2026-06-07, cycle 171) — financing calc math (0% APR / divide-by-zero)
Continued the money-math sweep into `financing-calculations.ts` (minimum payment, payoff date,
amortization, extra-payment impact), since **0% promotional financing** is the natural edge where an
interest formula divides by the rate / by `(1+r)^n − 1` and yields NaN/Infinity (the cycle-168 class,
fresh module). **Verified sound — every function guards `apr <= 0` and falls back:** the amortization
+ payoff loops have an explicit 0%-APR branch (simple `balance/payment` division) and a
`principalAmount <= 0` "payment doesn't cover interest" break; `calculateMinimumPayment` returns
`null` at 0% APR so the `(factor − 1)` denominator is never zero; lease/missing-input paths return
null/empty. Reading found NO bug.
- [x] **Pinned the previously-untested calc primitives (cycle 171, test-only).** The existing
  `financing-calculations.property.test` covered only `derivePaymentEntries`; `calculateMinimumPayment`
  and `calculatePayoffDate` (the division-heavy ones) had no direct test. Added 10 cases:
  minimum-payment matches the closed-form amortization value (≈386.66 for 20k/6%/60mo) + returns null
  at 0% APR / lease / non-positive amount-or-term + is always positive-finite across 200 random runs;
  payoff date is always a VALID Date (never Invalid Date / NaN-time) across 0%-APR, with-APR,
  paid-off, and 200 random loan inputs. Guards the divide-by-zero class against a refactor. FE 292
  unit pass; tsc 0.

## Security review findings (2026-06-07, cycle 149) — restore zip-bomb (uncompressed-size cap)
Continued the restore-path hardening (145 userId-stamp, 146 junction-ref guard). The upload route
ALREADY had the basics — per-user rate limiter (10/10min), `bodyLimit({maxSize: 50MB})` on the
COMPRESSED upload, schema + referential validation (so the "add upload size limit" idea I kept listing
was already done; stop offering it). The residual was the **zip-bomb** class: `bodyLimit` caps
compressed bytes but `parseZipBackup`'s `entry.getData()` inflates each entry unbounded, so a ~50MB
highly-compressible ZIP could decompress to many GB and OOM the process.
- [x] **FIXED (cycle 149).** `parseZipBackup` now sums each entry's uncompressed `header.size` (read
  from the ZIP central directory — NO inflation) and throws a `ValidationError` before any `getData()`
  if the total exceeds `CONFIG.backup.maxUncompressedSize` (200MB — generous vs a real CSV-text backup,
  tiny vs a bomb). Guard runs FIRST in parseZipBackup, before the missing-files / metadata reads.
  Additive + no-op for legitimate backups.
- **Severity: low — defense-in-depth.** The route is authenticated + rate-limited + single-tenant (you'd
  only OOM your own instance), so not a public DoS; but bounding decompression on an untrusted upload is
  correct hygiene. **ARCC was not queried (MCP server unavailable); standard practice applied.**
- Proof: `restore-zip-bomb.test.ts` — a ZIP with one `Buffer.alloc(cap+1)` entry (trivially
  compressible, so the COMPRESSED bomb is < maxFileSize → proves bodyLimit wouldn't catch it) is rejected
  with a /decompress/i error; **failing-first confirmed** (disabling the guard → the bomb slips past the
  size check). Plus a control: a real exported backup parses fine under the cap. BE 773/0; tsc 0.

## Security review findings (2026-06-07, cycle 145) — restore trusts file-provided userId (cross-tenant write)
Reviewed the **restore/import path** (`sync/restore.ts`), which ingests an untrusted uploaded ZIP /
Sheet. Found: `insertBackupData` inserted every row with the **userId carried in the file**, and the
only ownership gate is `validateUserId(metadata.userId, importer)` — referential-integrity validation
checks per-row `userId` membership for expenses/reminders/notifications but **NOT** the root tables
(vehicles / insurance / photos / userPreferences / syncState). So a crafted backup
(`metadata.userId = me`, but `vehicles[].userId = victim`) would insert rows **owned by another user**.
- [x] **FIXED (cycle 145).** `insertBackupData` now `stampUserId(rows, importerId)` on all 9 owned
  tables (vehicles, expenses, insurancePolicies, reminders, reminderNotifications, odometer,
  userPreferences, syncState, photos) — forces ownership to the importer, never the file. Single
  chokepoint, holds regardless of which validators run. **No-op for legitimate backups** (`createBackup`
  only ever emits rows owned by the creator = importer), so zero behavior change for real users — which
  is why it's safe to land pre-merge. Both ZIP (`restoreFromBackup`) and Sheets (`restoreFromSheets`)
  paths pass `userId`.
- **Severity: defense-in-depth (low practical exploitability).** The foreign userId must satisfy the
  `users.id` FK and cuid2 ids aren't enumerable/leaked (cycle-138 IDOR audit confirmed endpoints don't
  expose other users' ids). But "never trust file-provided ownership on an upload path" is a real
  hardening guarantee. **ARCC was not queried (MCP server unavailable); applied standard authz practice.**
- Proof: `restore-userid-stamp.test.ts` — tampers a real export's `vehicles.csv` to carry a foreign
  `user_id`, restores as our user, asserts the row is owned by US (**failing-first confirmed**: reverting
  the vehicles stamp → row kept `victim-user-1`); plus an untampered round-trip guard. BE 769 / 0; tsc 0.
- **Re-evaluated the cycle-139 deferred backup-CSV-format fix and chose to KEEP deferring it** (see
  below): reversible neutralize-on-write + strip-on-read needs a backup-format version bump on the
  proven-green restore path for a low-severity self-only injection — does not clear the bar to touch a
  critical path right before a 107-commit merge. Stop listing it as a cheap increment.
- **[Cycle 146 follow-through — sibling vectors AUDITED, verified sound, now GUARDED.]** After the
  cycle-145 write fix, swept the rest of the restore path for related authz holes:
  (1) **Junction-table FK injection** (`reminder_vehicles`, `insurance_term_vehicles` — they carry no
  userId to stamp): can a crafted backup link the importer to a VICTIM's existing row? **No.**
  `validateReferentialIntegrity` constrains every junction `termId`/`vehicleId` to the backup's OWN
  in-backup id sets and **hard-fails** otherwise (`validateBackupData` returns valid only if
  errors.length===0; both ZIP + Sheets restore throw on invalid). A junction can't reference a row not
  present in the same backup, and (post-145) those parents are stamped to the importer.
  (2) **Photo `entity_id`** (free string, no FK — the cycle-128 concern): `validatePhotoRefs` **does**
  validate `entityId ∈` the matching in-backup id set per entityType on import, and userId is now stamped.
  (3) Confirmed `restore.ts insertBackupData` is the **only** untrusted-upload insert path (split-service
  / trigger-service / repos are all owner-session-scoped). **No new bug.** Locked in with
  `restore-junction-refs.test.ts` (tamper an exported `reminder_vehicles.csv` to an out-of-backup vehicle
  id → restore rejected, original data left intact since validation precedes the replace-mode txn).
  **ARCC was not queried (MCP server unavailable); standard authz practice applied.** BE 771/0; tsc 0.

## Security review findings (2026-06-07, cycle 139) — CSV formula injection (CWE-1236)
Audited every place user free-text reaches a spreadsheet. `csv-stringify`'s `quoted:true` is
RFC-4180 *correctness* only — it does NOT stop Excel/Sheets/LibreOffice from EVALUATING a cell
that begins with `= + - @` / TAB / CR. (Single-tenant app, so the primary victim is self; the real
escalation is a SHARED export or a multi-user self-host admin opening one.) Also checked the other
classic frontend XSS vectors while here: exactly ONE `{@html}` in the app (`+layout.svelte`
`webManifestLink`, a build-time `virtual:pwa-info` constant — not user data) and ZERO
`innerHTML`/`outerHTML`/`document.write`; dynamic `href`/`src` are all `resolve(routes.*)` or
API-photo URLs, no `javascript:`-scheme sinks. **ARCC was not queried (MCP server unavailable);
applied standard OWASP CSV-injection mitigation.**
- [x] **Expense export `GET /expenses/export` (one-way) — FIXED.** New `utils/csv-safety.ts`
  neutralizes dangerous string cells (`'`-prefix), numbers untouched; wired in + proven (see the
  Importing/Exporting entry above). Safe because nothing re-parses this file.
- [ ] **Backup ZIP CSV (`sync/backup.ts:convertToCSV`) — DEFERRED, do NOT naive-fix.** This is a
  ROUND-TRIP artifact: `parseZipBackup` re-reads it on restore (the cycle-133 claims round-trip proves
  restore works). A leading-`'` prefix on write would either corrupt restored values or require a
  symmetric strip on read. Fix correctly = neutralize on write AND strip on parse, behind a failing-first
  round-trip test. Lower urgency: the ZIP is downloaded by its owner, not casually shared.
- [ ] **Google Sheets sync (`google-sheets-service.ts`, `valueInputOption:'USER_ENTERED'`) — DEFERRED.**
  USER_ENTERED makes Sheets EVALUATE formulas on write (highest-severity in theory) BUT is gated behind a
  user's own configured OAuth provider, and the data round-trips back via `readSpreadsheetData`. Candidate
  fix: switch to `valueInputOption:'RAW'` — but that changes type coercion (dates/numbers), and the
  in-memory fake doesn't simulate USER_ENTERED parsing, so the round-trip can't be PROVEN safe with the
  current harness. Needs a fake-client upgrade first; don't flip blind on a proven-green path.

## Deep review findings (2026-06-07, cycles 129–130) — delete-confirmation disclosure
The confirmation dialogs didn't accurately tell users what a delete destroys.
- [x] Vehicle delete: said only "expenses" → now enumerates expenses/fuel-charging history/
  odometer/financing/photos (NOT insurance — policies are user-scoped). (commit c402d4e)
- [x] Policy delete: said only "terms" → now terms + filed claims + uploaded documents. (c402d4e)
- [x] Split-expense delete: generic "this expense" → now discloses it removes the whole
  multi-vehicle split. (c402d4e) — NOTE: that fix covered ONLY the ExpenseForm edit-page
  dialog; the ExpensesTable LIST-ROW delete was missed (see cycle 161 below).
- [x] **(cycle 161) Split delete ORPHANED siblings + under-disclosed — FIXED (data-integrity
  bug on a destructive path).** A deep UI review of the dialog layer (route-smoke never opens a
  dialog) opened the expense delete confirm on a split row and found two real defects, both proven:
  (1) **the ExpensesTable list-row delete** showed only the generic "delete this expense" copy (no
  split disclosure), and (2) BOTH the list-row delete AND the **non-insurance branch of
  ExpenseForm.handleDelete** called `deleteExpense(child.id)` → `DELETE /:id` (a single-row delete,
  NO group cascade), leaving the other vehicles' portions as an orphaned partial split whose rows
  no longer sum to the group total — while the edit dialog literally promised "removes the entire
  split — every vehicle's portion." The c402d4e disclosure was copy-only; the delete path under it
  was still wrong, and the list path had neither. **Fix:** route any split delete (`groupId != null`,
  which only split/insurance-group rows carry) through the existing correct `/split/:id` endpoint
  (cascades all siblings + cleans their photos) in BOTH ExpensesTable and ExpenseForm; and add the
  split disclosure to the ExpensesTable dialog. **Proof:** failing-first backend HTTP characterization
  (`delete-split-child.test.ts`: single-row delete leaves 1 orphan; group delete clears all) + E2E
  (`expense-split-delete`: create 2-vehicle split → list-row delete → dialog discloses "entire split"
  → confirm → group endpoint 404). BE 777/0, FE type-check 0, regress 50/50 (was 49). Frontend-only
  product change; no schema/migration. (Also fixed a latent svelte-check error my OWN cycle-160 test
  carried — `mock.calls[0]` possibly-undefined under noUncheckedIndexedAccess — that the merge type
  gate would have caught; FE type-check now 0.)
- [x] **Term delete (cycle 130): said expenses would be "preserved but unlinked" — FALSE; the
  route deleteBySource('insurance_term') DELETES the auto-created premium expenses + their
  photos. Copy now says they're permanently deleted.** (this cycle)
- Audited claim + odometer deletes: accurate (scoped to own data) — no change needed.
- [x] **(cycle 131) photo/document delete now confirms** — DocumentViewer,
  VehiclePhotoCarousel, ExpensePhotoSection each gate handleDelete on a window.confirm
  ("permanently removes it and cannot be undone"), consistent with the term/claim confirm
  pattern. No E2E deletes a photo through the UI, so nothing regressed. (this cycle)

## Deep review findings (2026-06-07, cycle 128) — delete/cascade orphans photos
The `photos` table links to entities by (entity_type, entity_id) STRINGS with NO foreign key
(only user_id is FK'd). So whenever a parent delete FK-cascades its children at the DB layer,
those children's photos were orphaned: dangling photo rows AND leaked external storage files
(Drive/S3), since the provider-file + photo_refs cleanup never ran for them. Five sites fixed
(each test-first, through the real route stack) — commit fd07ed0:
- [x] Vehicle delete → cleans its expenses' + odometer entries' photos (was: orphaned both).
- [x] Insurance policy delete → cleans policy-doc + all claim-doc photos (was: cleaned nothing).
- [x] Direct expense delete (`DELETE /expenses/:id`) → cleans own receipt photos.
- [x] Direct claim delete → cleans own document photos.
- [x] Split-expense delete → repo deleted photo ROWS but leaked provider files/refs; route now
  fully cleans siblings' photos first.
Mechanism: new `deletePhotosForEntities(type, ids[], userId)` (batched, no per-entity ownership
re-check) + batched repo `findByEntities`/`deleteByEntities` + `findIdsByVehicleId`/
`findIdsByGroupId`. Cleanup runs BEFORE the parent delete so children still exist to enumerate.

## Deep review findings (2026-06-07, cycles 124–125) — clear-optional-field data-loss class
A whole bug class: an edit form empties an optional field → sends `undefined` → JSON.stringify
drops the key → the repo skips it (`!== undefined` guard, or Drizzle dropping undefined) → the
column keeps its OLD value. The user literally cannot clear the field. Mechanism for each fix:
schema `.optional()`→`.nullish()`, input type widened to `| null`, form sends `null` on EDIT
(still omits on CREATE). Each fix is test-first (failing HTTP test, several with a UI E2E proven
to fail pre-fix).
- [x] **Insurance claims** — payout / description / fault (commit e6e77fc; cycle 124).
- [x] **Insurance terms** — deductible / coverageLimit / agent* / policyNumber / costs (cc633be).
- [x] **Insurance policy notes** (cb90a4a).
- [x] **Vehicles** — licensePlate / nickname / vin / initialMileage / purchasePrice / purchaseDate
  (commit 8877d6f; cycle 125). Note: BaseRepository.update relies on Drizzle dropping undefined,
  so the backend already cleared on null — the gate was the schema + form only.
- [x] **Reminders** — ALREADY CORRECT by design (`updateReminderSchema` uses `.nullish()` with an
  explicit comment explaining the merge-existing-row reason). No action; verified.
- [x] **Financing** — no general update route (targeted PATCH endpoints only). Unaffected.
- [x] **Expenses — `description` (cycle 167) — FIXED, closing the ENTIRE clear-field class.** The
  last open instance, deferred since cycle 124 because the shared `toBackendExpense` transformer
  (used by 5 call sites incl. the offline outbox + sync-manager, all CREATE-only in v1) dropped an
  empty/falsy description regardless of create-vs-edit, so making it edit-aware risked the offline
  path. The deferral's stated unblock condition — "fix later WITH offline regression coverage" — was
  satisfied at cycle 160 (`sync-offline-expenses.test.ts`). Fixed surgically with an explicit
  edit-aware opt-in so the offline path is untouched BY CONSTRUCTION: `toBackendExpense(expense,
  { isEdit })` sends `description: null` on an emptied edit (clears the column) but OMITS it on create
  (default — create/offline/sync payloads byte-identical); `updateExpense` passes `isEdit:true`;
  backend `description` `.optional()`→`.nullish()` so the route accepts null and `BaseRepository.update`
  writes it through. Proof: transformer unit (create omits / edit→null / non-empty identical), backend
  HTTP (`update-clear-description.test.ts`: PUT null clears, undefined leaves untouched, create
  persists), E2E (`expense-clear-description`: real edit form → clear → reload stays cleared). The
  offline/sync + api-transformer property tests still pass unchanged. BE 786/0, FE 281, tsc 0 (BE+FE),
  build ok, regress 52/52. The clear-optional-field data-loss class is now fully closed across claims,
  terms, policy notes, vehicles, reminders, AND expenses.

## Deep UI review findings (2026-06-06)
- [x] **"Fill-up Patterns by Day of Week" rendered a bare empty axis** (no bars, no empty
  state) for users with no fuel data — `buildDayOfWeekPatterns` always returns all 7 days
  (fillupCount 0), so the `length > 0` guard was always true. Fixed: gate on real data
  (`some(d => d.fillupCount > 0)`) and pass `[]` so AppBarChart shows its kit empty-state,
  matching sibling charts (commit 91b6368, verified on the analytics screenshot).
- [x] **(b) Audited all analytics charts for the fixed-length-zero-array empty-axis bug
  (cycle 7).** Only TWO backend builders return fixed-length rows regardless of data:
  `buildDayOfWeekPatterns` (7 days) and `buildSeasonalEfficiency` (4 seasons). Both are now
  fixed (gate on `some(fillupCount > 0)` → pass `[]` → kit empty-state); commits 91b6368 +
  18a32c5. All other chart data is Map-derived (empty when no data → guards work correctly),
  so the bug class is fully closed.
- [~] **(a) "Fleet Health 73" with N/A fuel KPIs — INVESTIGATED (cycle 8): WORKING AS
  DESIGNED, not a bug; product decision deferred to human.** Traced it:
  `computeFleetHealthScore` (repository.ts:1111) = `maintenanceRegularity*0.4 +
  mileageAdherence*0.35 + insuranceCoverage*0.25`. With NO maintenance data,
  `computeRegularityScore([])` and `computeMileageScore([])` both return a NEUTRAL **50**
  (deliberate — a new vehicle with no history isn't "unhealthy"=0), insuranceCoverage=0 if
  uninsured → ~38/vehicle; the seed's 2 vehicles (one with some maintenance/insurance)
  average to ~73. So the number is a legitimate weighted score, NOT fabricated. The only
  issue is presentational: a confident "73" beside N/A fuel KPIs *reads* as data-derived.
  NOT auto-fixing — forcing N/A would discard a reasonable neutral default; this is a
  product call. Options if pursued: (i) show "—/No data" only when a vehicle has zero
  maintenance AND no insurance, or (ii) add a tooltip explaining the neutral-50 baseline.
- [x] **Analytics review nit (c) — RESOLVED (cycle 136).** The Fuel & Stats tab now shows ONE
  `EmptyState` ("No fuel data yet" + a "Log a Fill-up" CTA deep-linking to the fuel expense form)
  when there's genuinely no fuel data, instead of ~10 zero/N-A stat cards + "No data available"
  chart cards. Gated on `hasFuelData = fillups.currentYear>0 || previousYear>0 ||
  distance.totalDistance>0` (conservative — any signal shows the full grid, so real data is never
  hidden); the populated grid is byte-for-byte unchanged. svelte-check 0 errors; regress 43/43
  (route-smoke /analytics now renders the empty state on the no-fuel-data seed, a11y-clean);
  verified eyes-on.
- [x] **Dashboard "Monthly Average" showed $0.00** (with real spend) + **monthly-trend
  chart had wrong/empty buckets** — root cause: `formatYearMonth`/`extractMonth` in
  `db/sql-helpers.ts` called SQLite `strftime` on the `expenses.date` integer (unix
  SECONDS) WITHOUT the `'unixepoch'` modifier, so distinct months collapsed into bogus
  buckets. Fixed (added `'unixepoch'`, matching `toDateTimeString`) + regression test
  `expenses/__tests__/summary-http.test.ts` (commit 7238b60). Monthly Average now correct.
- [x] **"Charts render blank" — RESOLVED: not a chart bug, a harness-blindness bug.**
  Verified (scroll-into-view + measuring the real `[data-slot="chart"]` plot SVG, NOT the
  card's 20×20 header icon): the dashboard trend chart paints at 506×300 with real plot
  paths, the gallery AppLineChart at 510×287 — charts work fine for a real user. The blank
  boxes were a screenshot artifact: `route-smoke` captured `fullPage` immediately after
  goto, and Playwright's `captureBeyondViewport` doesn't scroll, so `ChartCard`'s
  IntersectionObserver gate kept below-the-fold charts as Skeletons in every PNG. Fixed by
  adding `revealLazyContent(page)` (scroll the whole doc → trip every IO → return to top)
  before each capture. Dashboard PNG now shows both charts. Lesson saved: don't trust
  fullPage screenshots for chart presence; measure the exact plot SVG.
- [x] **Analytics radar chart infinite-radius paths — FIXED (cycle 4).** Replaced the fragile
  radial `LineChart` ("Vehicle Performance Comparison") with a grouped `AppBarChart` (x=metric,
  y=[vehicleIds], seriesLayout="group", yDomain [0,100]) — the kit renders it cleanly, conveys
  the same per-vehicle/per-metric comparison, and sidesteps layerchart@next.65's radial
  geometry entirely. Verified: `INFINITY_ERRS 0` across analytics, 15 bars (5 metrics × 3
  series) render, no console errors. Removed the now-unused radial imports
  (LineChart/curveLinearClosed/scaleBand/createVisibilityWatch/animateOnView + radarGate) and
  the route-smoke `[chart-debt]` warn-filter (the gate enforces cleanly again). 28/28 E2E green,
  tsc clean. Original (resolved) diagnosis kept below for history:
- [x] ~~Analytics radar chart emits infinite-radius paths (`M-Infinity,… aInfinity,Infinity`).~~
  ISOLATED (cycle 3): it's specifically the **"Vehicle Performance Comparison" radial radar**
  in `analytics/fuel/AdvancedCharts.svelte` (5 bad `<path>`s; all other analytics charts are
  clean). The bad paths are the radial **grid circles** rendered with `aInfinity,Infinity`
  radii → the radial scale's RADIUS RANGE is infinite, NOT a data problem. **Data is proven
  fine**: `normalizeScore()` (utils/analytics-charts.ts:511) clamps every radar metric to
  0–100 and guards `max===min`→50, so values are always finite. RULED OUT this cycle (none
  fixed it): (a) `radarHasData` positive-value guard, (b) `yDomain={[0,100]}` on the LineChart,
  (c) concrete square container `h-[300px] aspect-square` — so it's NOT data, NOT value-domain,
  NOT container CSS. It's layerchart radial geometry (`layerchart@2.0.0-next.65`, a pre-release;
  this is the ONLY `radial` chart in the app, no working reference). LIKELY FIX: the radial
  chart needs an explicit radius `range`/`outerRadius` (radial charts derive radius from the
  resolved chart context width/height; if that's 0 at measure time → Infinity). Next: read
  layerchart's radial LineChart docs/source for the required radius prop, OR replace the radar
  with a non-radial comparison (grouped bar) which the kit already renders cleanly. Currently
  warn-filtered in route-smoke (`[chart-debt]`) so it doesn't block; remove the filter once fixed.

## Performance (from deep review sweep, 2026-06-05)
- [x] Financing N+1 in `GET /api/v1/vehicles`: was 2 queries per financed vehicle
  (`computeBalance` = findById + SUM). Added `financingRepository.computeBalances(ids[])`
  (2 queries total: `inArray` fetch + `GROUP BY` sum); list route now batches. +3 equivalence tests.
- [x] Insurance `expiring-soon` unbounded query: added `limit` (default 100, clamped 1–200)
  to `findExpiringTerms` + the route.
- [x] Dashboard per-vehicle photo fetch (N calls) — batch endpoint `GET /api/v1/photos?entityType=vehicle`
  (one user-scoped query grouped by entityId); dashboard now makes one request. +4 tests.
- [x] Expenses client-side search after server pagination — moved search SERVER-SIDE (SQL LIKE on
  description+category across all pages); debounced searchTerm→server. +6 repo tests + e2e/expense-search spec.
- [ ] Settings page state-sync on store update (deferred — low impact).

### AI-testing gaps (from cycle-11 gap analysis — prioritized backlog)
- [x] E2E expense search interaction spec (drives UI, caught a real self-inflicted debounce bug)
- [x] Harness flake-hardening (Playwright workers:4 + retries:1 + 10s expect)
- [x] E2E create-expense form round-trip (fill → submit → persists across reload; + category-required guard)
- [x] E2E reminders pause/resume — CAUGHT A REAL BUG: PUT /reminders/:id 400'd on every update
  (isActive stripped from schema + merged-row nulls rejected by .optional()); fixed via isActive + .nullish().
- [x] E2E: expense pagination next/prev (seed 18 via API → 2 pages → Next/Prev + disabled states → clean up)
- [x] E2E: profile display-name edit (pencil → edit → save → persists across reload; + cancel keeps original)
- [x] E2E: settings persistence (currency Select → Save → persists; backup toggle needs OAuth provider, not headless-feasible)
- [x] Backend HTTP-level tests (vs repo-level): GET /expenses?search= (expenses-http), GET /photos?entityType= (photos-http, cycle 13), POST /reminders/trigger (reminders-http, cycle 23 — needed a harness fix: app.request() now sends Sec-Fetch-Site so csrf() doesn't 403 body-less POSTs)
- [x] **Backup→restore round-trip for insurance claims (cycle 133)** — claims were hand-threaded
  through the backup/restore pipeline across many files; coverage was only validation/ref-integrity
  + mocked orchestration. Added `sync/__tests__/claims-roundtrip.test.ts`: seed vehicle+policy+claim
  via the real API → `backupService.exportAsZip` → `restoreService.restoreFromBackup('replace')` →
  assert the claim row + every field (payout/fault/description/vehicle link) survives, plus
  ImportSummary count and a multi-claim case. PASSED — the pipeline is proven end-to-end (real CSV
  serialize→parse→FK-ordered insert), and it now guards against future backup-map regressions.
- [~] Frontend unit: **expense-filters DONE** (cycle 137 — `__tests__/expense-filters.test.ts`,
  17 tests: search across description/tags/category/amount-substring, case-insensitivity,
  category/tags-any-match/inclusive-date-range filters, the no-filters fast-path, hasActiveFilters,
  extractUniqueTags dedup+sort; characterized the subtle whitespace-search-isn't-fast-path boundary).
  **sync-manager conflict resolution ALREADY covered** (`__tests__/sync-manager.test.ts`: detect /
  keep_local / keep_server / retry). Remaining: debounced search effect (DOM-coupled).
- [x] **Frontend unit: `buildExpenseQuery` DONE (cycle 157)** — the pure params→query-string builder
  behind every expense list/search/pagination/export request (the cycle-10 correctness class depended
  on it) was only exercised indirectly via E2E. Exported it (test-only) + `__tests__/build-expense-
  query.test.ts` (9 cases): each param→key mapping, search `.trim()`, **whitespace-only search dropped**,
  **tags as REPEATED `tags=` params in order** (not comma-joined), **offset/limit 0 omitted** (falsy
  guard = default page, not a filter), vehicleId as the separate arg, full composition. FE 278 unit
  pass; tsc 0. (Surveyed the rest first: financing-calculations / payment-planner / units / formatters /
  chart-colors / api-transformer / sync-manager are ALL already tested — services are otherwise thin
  apiClient passthroughs covered by E2E. This was the one untested non-trivial pure unit left.)
- [x] **Frontend: `syncOfflineExpenses` orchestration DONE (cycle 160)** — deep-reviewed the OFFLINE
  subsystem (branch namesake, highest data-loss stakes). The CRUD primitives were tested but the
  queue→server sync wasn't. New `__tests__/sync-offline-expenses.test.ts` (mock fetch, real
  offline-storage round-tripping the stateful localStorage mock) pins the **data-safety contract**:
  happy path POSTs every pending entry **carrying its idempotency `clientId`** + drains the queue;
  **partial failure loses nothing** (already-sent entries marked synced so a retry can't duplicate;
  the failed + remaining stay pending; syncState→'error'); malformed fuel entries are skipped. **No
  product bug** — the sync logic is correct; a transient red was a single-use-`Response` trap in my
  own mock (shared `mockResolvedValue` → 2nd POST read a consumed body), fixed to a fresh Response per
  call. FE 281 unit pass.
- [x] **Backend: expense-reminder TRIGGER orchestration DONE (cycle 164)** — rebalanced off the
  dialog-layer UI thread to a fresh, high-stakes backend area: the runtime that AUTO-CREATES expenses
  when a recurring expense reminder comes due (`trigger-service.ts processOverdueReminders`). The form
  (158-159) + the pure date math (`compute-next-due-date.property.test`) were covered, but the
  orchestration that writes financial records was not — only a deliberately-loose NOTIFICATION trigger
  case existed. New `__tests__/trigger-expense.test.ts` (real HTTP stack → trigger service → insert →
  sqlite row read) pins three invariants: (1) an overdue expense reminder creates an expense carrying
  its template (category/amount/tags) + `source_type='reminder'`/`source_id`; (2) triggering AGAIN
  creates no duplicate for the already-processed period (the nextDueDate advancement prevents infinite
  re-fire); (3) **endDate bounds catch-up to exactly the in-window occurrences** then deactivates (a
  Jan15→Apr1 monthly window fires exactly 3 times — Jan/Feb/Mar 15 — NOT the ~12 catch-up cap nor a
  row per month to now). **No product bug** — the engine is correct. Honest self-correction: my first
  endDate assertion ("creates nothing") was wrong — validation forces endDate>startDate so the
  startDate occurrence is always in-window and fires once; rewrote it to the stronger
  exactly-3-in-window assertion. BE 780/0, tsc 0.
- [x] **Backend: odometer UPDATE-path invariants DONE (cycle 170)** — deep-reviewed the odometer
  subsystem (mileage readings feed the mileage-over-time chart + every mileage-derived stat). Field
  validation is sound (`odometer` int min 0, `recordedAt` rejects future dates, note capped) but the
  **PUT `/api/v1/odometer/:id` path had ZERO coverage**, and the existing `validation.property.test`
  re-declares its OWN copy of the schema rather than the real one (so it wouldn't catch a routes.ts
  regression — the cycle-155 self-referential class). New `__tests__/update-route.test.ts` drives the
  real stack and pins the update contract: a valid update persists; **a future `recordedAt` is still
  rejected on edit** (proving `updateSchema = createSchema.partial()` keeps the no-future refine on
  the present field — the main thing worth confirming); negative + non-integer odometer rejected; a
  note-only edit leaves the reading intact. **No product bug** — the update path is correct. Cross-
  tenant PUT/GET/DELETE denial is already covered by the cycle-138 IDOR suite, so not duplicated.
  BE 794/0, tsc 0. (Did NOT add a hard upper bound on `odometer` or a monotonicity check — both are
  defensible product calls, not clear bugs: odometer rollback/replacement is real.)
- [x] **Backend: insurance premium→expense HOOK lifecycle DONE (cycle 173)** — deep-reviewed
  `insurance/hooks.ts`, which auto-creates a split expense across covered vehicles from a term's
  `totalCost` (a financial-record write, same class as the reminder trigger cycle 164). `terms-http`
  only covered clear-field semantics; the auto-created-expense LIFECYCLE had no HTTP characterization.
  New `__tests__/premium-expense-hook.test.ts` (real stack → hook → createSplitExpense/deleteBySource
  → sqlite read) pins: policy-create with a costed 2-vehicle term → one even-split insurance expense
  per vehicle (600+600=1200), tagged `insurance`, `source_type='insurance_term'`/`source_id`; a term
  cost UPDATE regenerates (old deleted + new at the new amount — proven by a changed row id, the
  delete-by-source+recreate path); cost→0 removes them; term-delete removes them. **No product bug** —
  the hook is correct. BE 798/0, tsc 0.
- [ ] Harness: screenshot visual-diffing (currently captures but never compares)
- [x] **Cross-tenant authorization (IDOR) — audited + proven (cycle 138).** Read-only audit of every
  resource route (vehicles/expenses/insurance/terms/claims/financing/odometer/photos/reminders)
  found ALL endpoints enforce ownership before read/mutate/delete (explicit validateXOwnership or
  user-scoped WHERE; child resources defense-in-depth-scoped via parent). NO IDOR found. Proven with
  `test-helpers/__tests__/cross-tenant-idor.test.ts`: two REAL Lucia sessions on one DB — user B
  creates each resource type, user A (foreign session) is denied 4xx (404) on GET/PUT/DELETE and B's
  data stays intact. (Standard authz practices applied; ARCC MCP was unavailable this session.)
  Flake note: a fixed second-user id caused a rare shared-:memory:-DB collision in the full suite;
  fixed with a unique-per-test id → 5× clean full-suite runs (749 pass / 0 fail).

## Long Term Considerations
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
