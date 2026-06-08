# `feat/offline-entries` — review & merge digest

A PR-ready summary of everything on this branch so a reviewer can merge quickly.
Generated from the real git history (`git log main..HEAD`), not from memory.

**Scope:** **154 commits · 191 files, +19,496 / −1,729** · branch `feat/offline-entries` off `main`
(**0 behind** — clean fast-forward).
_(Updated cycle 192 from real `git log/diff origin/main..HEAD`. The digest grew in layers: original at
~48 commits; §8 covers cycles ~13–24; §9 covers cycles 26–133; §10 covers cycles 134–149; §11 covers
cycles 150–165; §12 covers cycles 166–173; §13 covers cycles 174–181; **§14 covers cycles 182–192** —
a new CSV-import feature (round-trip pair to the export), a swept-and-guarded WCAG-AA text-contrast bug
class, an export-correctness fix, and money-math test pinning. Read §14 first if you last reviewed at
the 143-commit mark.)_

**Status (full suite re-verified cycle 192 — all layers green):**
- Backend: **836 tests pass**, 0 fail (1 skip) — `cd backend && mise exec -- bun test`
- Frontend: `tsc` 0 errors (7 benign warnings); **331 unit tests** pass — `cd frontend && mise exec -- npm test`
- E2E: **65/65** green via `RESET_DB=1 START_SERVERS=1 .meshclaw-tools/regress.sh`
  (route-smoke + axe a11y enforced on all routes + mobile-overflow + interaction specs). The harness
  boots with `DISABLE_RATE_LIMIT=1` (double-gated, never active in production) so its own request
  volume no longer 429-flakes late specs — see §13.
- Production server boots cleanly (the harness starts the real backend).
- **Two migrations** on the branch (0001 offline client_id, 0002 insurance_claims) — both
  additive (CREATE TABLE / ADD COLUMN + indexes), no DROPs. No new migration since §10.

> Note: the `.meshclaw-tools/` harness, `frontend/e2e/*.meshclaw.e2e.ts` specs, and
> screenshots are **untracked by design** (local verification kit, not shipped). Everything
> below is tracked/committed.

---

## What's in it, by theme

### 1. Offline entries foundation (the branch's namesake)
- `client_id` idempotency column + **migration `0001_blushing_juggernaut.sql`** (the one
  schema migration on this branch) + partial unique index.
- `createIdempotent` path; `clientId` threaded through both sync POST paths; outbox sync
  rewrite; dead `sw.js` removed. Create-only in v1 (offline edit/delete deferred).
- Files: `backend/src/db/`, `backend/drizzle/`, `frontend/static/sw.js`, sync utils.

### 2. Features shipped
- **Reminders `/reminders` route** — list with due/upcoming/paused, pause/resume, delete,
  "run due reminders" trigger; wired into nav.
- **Editable profile** — inline display-name edit + `PATCH /api/v1/auth/me`; live "Export
  all data" (ZIP) in Data & Privacy.
- **Google Photos storage provider (backend + FE wiring)** — new `GooglePhotosProvider` +
  `GooglePhotosService` behind the `StorageProvider` interface, with optional `capabilities`
  flags (delete/list/arbitraryFiles) so its append-only/photos-only API degrades cleanly.
  Settings shows it with an icon/label; PDFs are capability-gated to Drive/S3.
  **⚠️ NOT yet wired: the OAuth connect flow** (needs the Photos scope + live Google creds
  to verify) — see `.kiro/specs/google-photos-provider/` and TODO #10.
- **PWA**: brand theme color; settings notice that auto-backups exclude images.

### 3. Bug fixes (correctness)
- **Expense summary month bucketing** (`db/sql-helpers.ts`): `strftime` was missing
  `'unixepoch'` on the seconds-epoch `date` column → dashboard "Monthly Average" showed
  $0.00 and the trend chart mis-bucketed. Fixed + regression test.
- **Reminders pause/resume 400** — `isActive` was stripped + nullable cols rejected by
  `.optional()`; fixed with `isActive` + `.nullish()`.
- **Expenses search** moved server-side (was client-side per-page → missed matches).
- **Analytics charts**: replaced a radial radar that emitted infinite-radius SVG paths with
  a grouped bar; added real-data empty-states to the day-of-week + seasonal charts (they
  rendered bare axes on no data).

### 4. Performance
- Killed N+1s: financing balances (batch `computeBalances`), dashboard vehicle photos
  (one batched request), `ExpensesTable` O(1) vehicle lookup map.
- Bounded the insurance "expiring-soon" query (limit, clamped).

### 5. Security hardening
- **Rate-limit client IP** (`utils/client-ip.ts`): both limiters keyed on the spoofable
  `X-Forwarded-For` → brute-force-limiter bypass. Now uses the real socket IP and only
  trusts `X-Forwarded-For` when the socket is in **`TRUSTED_PROXY_IPS`** (new env, default
  empty = trust nothing). +6 unit tests. **Action for deployers behind a proxy:** set
  `TRUSTED_PROXY_IPS` (documented in `backend/.env.example`).

### 6. UI quality system
- `.kiro/steering/UIQuality.md` (Four-States/mobile/a11y rubric), `DesignSystem.md`
  (compose-don't-invent + tokens), `TestingExternalAPIs.md` (inject-don't-mock.module).
- `/dev/gallery` dev-only route (kit in all states); axe a11y gate enforced on all routes;
  token contrast fixes (`--muted-foreground`, `--destructive` to WCAG AA); nested-interactive
  + icon-button-label a11y fixes across forms/popover/profile/settings.

### 7. Test infrastructure (additive; mostly tracked test files)
- In-process HTTP harness: `app.ts` split out of `index.ts` (side-effect-free) +
  `test-helpers/http-client.ts` (`createTestApp()` over `:memory:` + real Lucia session) +
  typed `json<T>()` helper.
- Injectable-client seam + in-memory fakes for Google Drive/Sheets/Photos; converted the
  leaky `mock.module` tests to injection.
- Schema-contract + route-boundary query/validation tests.

### 8. Added since the initial digest (cycles ~13–24; the +19 commits / ~660 lines)
All verified (713 BE tests, 32/32 E2E, tsc 0). Themed:
- **Correctness / bug fixes (real, user-visible):**
  - **Profile "Member Since" showed "—"** — `createdAt` was dropped in `/me` + `/refresh`
    serialization (the column + frontend type existed; only the wire payload omitted it).
    Fixed in `lucia.ts` + `auth/routes.ts`; +HTTP regression test. (a3f3c4f)
  - **Dashboard load failure masqueraded as the empty "add your first vehicle" state** — a
    failed fetch only toasted, then rendered the new-account view (a returning user would
    think their data vanished). Now shows a persistent error + Retry. (b4f1ae1)
  - **Expenses page hung on the skeleton forever** if the initial load failed (unguarded
    `onMount` awaits). Now guarded with error + Retry, matching insurance/analytics. (530de15)
- **Test-infra / correctness of the harness:**
  - **`sync-worker.test.ts` `mock.module` leak** replaced a real `photoRepository` process-wide,
    500-ing later photos-route tests in the full suite. Converted to dependency injection
    (`SyncWorkerDeps`); re-enabled the photos-http route test. (4677551)
  - **HTTP harness now sends `Sec-Fetch-Site: same-origin`** so `app.request()` mirrors a real
    browser through the `csrf()` middleware; unblocked **`POST /reminders/trigger` HTTP tests**,
    closing the last AI-testing-gap backlog item (#278). (30f46e6)
- **Regression guards added (untracked E2E, run in `regress.sh`):** dashboard-error,
  expenses-error, dashboard-donut-mobile (proved the mobile-donut "blank" is a screenshot
  artifact, not a bug), keyboard-a11y (Escape-closes + focus-return on the bits-ui Select).
- **Reviews that correctly shipped NO change** (documented in STATUS.md): the 7 svelte-check
  warnings are benign one-time `$state` seeds + vendored carousel; keyboard/focus a11y is sound;
  Fleet-Health 73 is a working-as-designed neutral baseline (presentation deferred to you).

### 9. Added since the cycle-25 digest (cycles 26–133; +31 commits, the largest new arc)
The 67→98 growth. If you reviewed at the 67-commit mark, this is what's new.

**New feature: Insurance claims tracking + claim documents** (the one schema change here —
**migration `0002_medical_the_phantom.sql`**, additive CREATE TABLE `insurance_claims` + indexes):
- Full vertical: `insurance_claims` table (policy FK cascade; optional term/vehicle FK set-null) →
  repository + 4 routes (`/api/v1/insurance/:id/claims[/:claimId]`) + zod enums → threaded through
  the **backup/restore + Google Sheets** pipeline (config maps, referential-integrity, FK-ordered
  restore insert, ImportSummary) → FE `ClaimsSection` in PolicyCard (file/edit/delete, status+fault
  badges, per-claim vehicle link, collapsible documents drawer).
- **Claim documents**: `insurance_claim` is now a first-class photo entity (validateEntityOwnership
  case + owner-join + `insurance_docs` storage routing); the `DocumentViewer` was generalized to an
  `entityType` prop. (commits 92e880d→163d4aa, 005f7d0, 4aa0d56, efd2e0e)

**New features (smaller):**
- **Dashboard "Log Fill-up"** quick-action — header button deep-links to the expense form pre-set
  to fuel (preselects the vehicle when the user owns one). (1497569)
- **Export expenses to CSV** — `GET /api/v1/expenses/export` (unpaginated, reuses the csv-stringify
  dep; honours vehicle/category/date filters) + "Export CSV" button on /expenses. (42e6d1f)
- **Dashboard "Upcoming Reminders" card** — surfaces reminders due now / within 14 days. (170bb70)

**Correctness bug class — clear-optional-field data loss (4 fixes, each test-first):** an edit form
that emptied an optional field sent `undefined`, which JSON dropped, so the column kept its OLD
value — the field couldn't be cleared. Fixed across **claims, insurance terms, policy notes, and
vehicles** (schema `.optional()`→`.nullish()`, input type `| null`, form sends `null` on edit).
Reminders were already correct; financing has no general update. (4bde305, cc633be, cb90a4a, 8877d6f)

**Data-safety — delete cascade + disclosure arc:**
- **Deletes orphaned dependent photos** (DB rows + external storage files): the photos table links
  by (entity_type,entity_id) strings with no FK, so FK-cascaded children leaked their photos. Fixed
  vehicle/policy/expense/claim/split deletes to clean dependent photos first. (fd07ed0)
- **Delete confirmations under-disclosed / mis-stated the cascade**: vehicle/policy dialogs now
  enumerate what's destroyed; the **term dialog previously claimed expenses were "preserved" when
  the route DELETES them** — corrected; photo/document deletes now confirm (were one-click). (c402d4e, 7c2beba, 0b31e7c)

**Test depth added:** backup→restore **round-trip** proof for insurance claims (real export→import,
not mocked); CSV-export HTTP tests; per-fix HTTP + E2E guards. Backend grew 713→742 tests; E2E 32→43.

**Earlier review wins (cycles 14–24, already in §8 but worth the one-liner):** Member-Since
serialization fix; dashboard/expenses/reminders/settings error-state+retry; currency-symbol class
(EUR/GBP) + chart-axis USD; date-only timezone (midnight-UTC previous-day) fix.

### 10. Added since the cycle-133 digest (cycles 134–149; +14 commits)
The 98→112 growth — a security-hardening arc plus two features and two proof/review passes. If you
reviewed at the 98-commit mark, this is what's new. No schema/migration change in this arc (still the
same two migrations); all additive.

**Security hardening (the headline of this arc — five fixes, each test-first, each low-to-moderate
severity and honestly scoped):**
- **CSV formula injection / CWE-1236 in the expense export** — `quoted:true` is RFC-correct but a
  spreadsheet still EVALUATES a cell starting with `= + - @`/TAB/CR. New `utils/csv-safety.ts`
  neutralizes dangerous string cells (numbers untouched); wired into the export. The two round-trip
  CSV sinks (backup ZIP, Sheets) were deliberately left alone (documented — a naive prefix corrupts
  restore). (dfab4df)
- **Restore trusted file-provided `userId` (cross-tenant write)** — `insertBackupData` inserted backup
  rows with the userId carried in the (untrusted) uploaded file; only `metadata.userId` was checked.
  Now stamps `userId = importer` on all 9 owned tables. No-op for legitimate backups. (9e4cfdc)
- **Restore junction-ref integrity** — verified (and locked with a test) that junction/photo rows
  can't reference an out-of-backup id (validators hard-fail), so they can't link to a victim's
  rows. (e77bfd0)
- **Restore zip-bomb** — `bodyLimit` caps the compressed upload; added an uncompressed-size cap
  (sum of entry `header.size`, no inflation) so a compressible bomb can't OOM on decompress. (4cac1bb)
- **Cross-tenant authorization (IDOR) proof** — a read-only audit found all resource routes enforce
  ownership; converted to a two-real-session test proving user A is denied B's vehicle/expense/
  insurance/claim/financing/odometer/reminder/photo. (f433d03)

**Correctness fix:** the CSV export **hardcoded `currency:'USD'`** regardless of the user's
preference — a EUR/GBP user's export mislabeled every amount. Now reads `currencyUnit` (read-only,
USD fallback). Same hardcoded-USD class as the cycle 74–75 UI fixes. (fd2bcef)

**New features (smaller, all compose existing infra; frontend-only):**
- **Duplicate expense** — a Duplicate action on the expense edit form deep-links to a new expense
  pre-filled with the recurring fields (date left at today). (250903d)
- **Tag suggestions from history** — the tag input now also suggests the user's previously-used tags
  (derived from already-loaded expenses, zero new network). (183556d)
- **Per-vehicle CSV export** — the vehicle-detail Expenses tab gained the Export CSV button the global
  page already had (reuses the vehicleId-filtered export endpoint). (0d99674)

**Review passes (no code change; recorded in STATUS/TODO so they aren't re-run):** full-route eyes-on
(135); money-precision verified sound — float storage, but split is integer-cents + display rounds
(140); **dark-mode** verified across 5 high-risk surfaces (148). Also a Fuel-tab single-empty-state
polish (e7d2b1b) and an expense-filters unit-test backlog item (f5a5a6f).

**Test depth added:** backend 742→**773**; E2E 43→**46** (duplicate, tag-suggestions, per-vehicle
export); new security tests (csv-safety, cross-tenant IDOR, restore userId-stamp, junction-ref,
zip-bomb).

### 11. Added since the cycle-149 digest (cycles 150–165; +16 commits)
The 112→128 growth. If you reviewed at the 112-commit mark, this is what's new. **No schema/migration
change in this arc** (still the same two migrations); everything additive. The headline is a real
data-integrity fix on a destructive path; the rest completes the reminders feature surface and pins
several previously-untested high-stakes paths.

**Feature: reminders are now fully create/edit-able from the UI (closed a write-only feature).** Before
this arc the `/reminders` page could list/pause/delete/run-due, but `reminderApi.create` was called
from NOWHERE and there was no edit affordance — a user could not create or edit a reminder at all,
though the backend POST/PUT routes existed. Built across cycles 152–165:
- **`ReminderForm` dialog** (bits-ui, create + edit) wired into the page (New Reminder button +
  per-row Edit + empty-state CTA): name / frequency (weekly|monthly|yearly|custom→interval+unit) /
  start+end date / vehicle multi-select / notes. (8c28c41)
- **Expense-type reminders** — a Type select (Notification | Recurring expense) reveals category +
  amount (required) + tags, so a reminder can auto-create an expense when due; sends the template only
  for expense type, explicit `null` on notification so switching type on edit clears stale values. The
  no-split case is fully supported; `expenseSplitConfig` (split across vehicles) stays deferred. (7f1a045)
- **Notification feed surfaced** — the trigger writes `reminder_notifications` rows when a
  notification reminder fires, and the GET/PUT endpoints + API-client methods existed but were called
  from nowhere, so a fired reminder was invisible beyond a transient toast. Added a Notifications
  section on `/reminders` (per-row + mark-all-read, unread badge, reminder name joined client-side);
  also bounded the previously unordered/unbounded `findNotifications` (ORDER BY dueDate DESC + LIMIT
  100, new config). (c58f890)

**Data-integrity fix (the most important commit in this arc): deleting a split expense orphaned its
siblings.** Both the ExpensesTable list-row delete and the non-insurance branch of
`ExpenseForm.handleDelete` called `deleteExpense(child.id)` → single-row `DELETE /:id` (no group
cascade), leaving the other vehicles' portions as a broken partial split whose rows no longer sum to
the group total — while the dialog promised "removes the entire split." The cycle-130 disclosure was
copy-only; the delete under it was still wrong, and the list path had neither. Fixed: route any
`groupId`-bearing delete through `/split/:id` in both components + add the split disclosure to the
list dialog. Proven failing-first (backend HTTP characterization + an E2E that creates a real split,
deletes it from the list, and asserts the group 404s). (4f8e176)

**Dead-code removal:** `SplitCostSheet.svelte` (a bits-ui Dialog wrapper) had zero references since the
split UX moved inline into `ExpenseForm` — removed (the inner `SplitConfigEditor` stays, still used by
ExpenseForm + InsuranceTermForm). (785feb1)

**Deep-review test-pins (no product bug found; each closes a coverage gap on a high-stakes path):**
- **Expense-reminder trigger orchestration** — that `processOverdueReminders` actually creates an
  expense carrying its template + `source_type='reminder'`, doesn't duplicate on re-trigger, and
  bounds catch-up to the in-window occurrences before deactivating on endDate. (3f48c62)
- **`syncOfflineExpenses`** (offline branch namesake, highest data-loss stakes) — happy path POSTs
  every queued entry with its idempotency `clientId` + drains; partial mid-batch failure loses nothing
  (succeeded marked synced, failed+remaining stay pending); malformed fuel skipped. (4b7f5c4)
- **Reminder type-switch clears the expense template** (the clear-optional-field class, newly reachable
  on the reminder fields) — expense→notification with null fields NULLs the columns. (dfaa11f)
- **`buildExpenseQuery`** pure builder (the cycle-10 search/pagination correctness class). (c84db6f)
- **Camera capture flow** (`CameraTab`) — exercised headlessly via Chromium fake-media flags;
  verified the stream-stop safety invariant (no leaked camera after capture). No commit (review +
  workspace lesson; the spec stays a one-off, not in the shared config). (a707301 records it)
- **Routing/dead-link audit** — every declared route maps to a page; fixed a stale self-referential
  nav test. (77923ed)

**Test depth added:** backend 773→**783**; frontend unit 269→**281**; E2E 46→**50** (reminder
create/edit, custom-frequency, expense-type, split-delete, notification-feed). All green.

### 12. Added since the cycle-165 digest (cycles 166–173; +8 commits)
The 128→136 growth. If you reviewed at the 128-commit mark, this is what's new. **No schema/migration
change** (still the same two migrations); everything additive. Two genuine product fixes plus a
money-math + subsystem test-hardening sweep.

**Product fixes (2):**
- **Expense `description` could not be cleared on edit (last clear-optional-field instance).** The
  shared `toBackendExpense` transformer dropped a falsy description regardless of create-vs-edit, and
  the update schema was `.optional()` (rejects null), so an emptied description kept its old value.
  Fixed with an explicit edit-aware opt-in (`toBackendExpense(expense, { isEdit })`) — edit sends
  `description: null` to clear; create + the offline/sync paths omit it, so their payloads are
  byte-identical (the deferral's offline-safety concern, satisfied by construction) — plus backend
  `.optional()`→`.nullish()`. This CLOSES the clear-optional-field data-loss class across claims,
  terms, policy notes, vehicles, reminders, and expenses. (a4984d3)
- **StatCard mobile overflow on the vehicle-detail page (7px at 393px).** The shared dual-metric
  `StatCard` (used by `FuelEfficiencyStatsCard`, columns=3 → 2-col mobile grid) packed two
  `text-2xl` money values per cell whose spans lacked `min-w-0`/`break-words`, so an unbreakable
  currency token blew out the grid track. Fixed at the kit level (`min-w-0 break-words` on the value
  spans + `min-w-0` on the grid items — the canonical CSS-grid blowout guard); benefits dashboard +
  analytics + vehicle detail. (75e5052)

**Deep-review test-hardening (no product bug found; each closes a coverage gap on a high-stakes path):**
- **TCO money-math zero-state** — a brand-new vehicle (no mileage / owned 0 days) yields all-finite
  numbers (`costPerDistance` null not NaN/Infinity; `costPerMonth` 0 via a `Math.max(1,…)` clamp).
  Guards the analytics divide-by-zero class. (6c24003)
- **Financing calc at 0% APR** — `calculateMinimumPayment` matches the closed-form value + returns
  null at 0% APR (no `factor−1=0` divide); `calculatePayoffDate` always returns a valid Date. (ab20213)
- **Odometer update path** — `PUT /:id` had no coverage; pinned that a future `recordedAt` / negative
  / non-integer reading is still rejected on edit (partial schema keeps the refine). (fb90fae)
- **Insurance premium→expense hook lifecycle** — policy-create auto-creates an even-split insurance
  expense per vehicle; a term cost update regenerates them; cost→0 / term-delete removes them. (484c128)
- **Edit param-routes smoke** (untracked, regress-only) — `/expenses/[id]/edit`, `/vehicles/[id]/edit`,
  `/insurance/[id]/edit` now have page-level mobile-overflow + a11y + console-error coverage (they
  needed a real id, so the static route-smoke loop never reached them). All verified sound. (d7973c1)

**Test depth added:** backend 783→**798**; frontend unit 281→**292**; E2E 50→**56** (vehicle-detail
all-tabs + the three edit param-routes). All green.

### 13. Added since the cycle-173 digest (cycles 174–181; +7 commits)
The 136→143 growth. **No schema/migration change** (still the same two migrations); all additive.
Two docs-only review records (cycles 175–176, no product change), one auth-correctness fix, two
expense-list features that each closed a real page-local bug, and a test-harness reliability fix.

**Product / correctness fixes (3):**
- **Auth gate was an incomplete allowlist → 4 routes leaked a broken authed shell to logged-out users
  (`d57c837`).** `utils/auth.ts` listed only `/dashboard,/vehicles,/expenses,/analytics,/settings` as
  protected, silently omitting `/insurance,/reminders,/profile,/trips` as those routes were added — so
  a logged-out visit rendered the authed shell (which then 401s) instead of redirecting to `/auth`.
  Proven with an anonymous browser probe. **Not a data leak** (the backend 401s every API call; the
  cycle-138 IDOR audit holds) — a UX/correctness defect. Fixed by inverting to **deny-by-default**:
  enumerate the small public set (`/`, `/auth`, `/privacypolicy`, `/termsofservice`) and protect
  everything else, so a new authed route is guarded automatically. The self-referential
  `ProtectedRoute.test.ts` was replaced with `auth.test.ts` (12 cases on the real functions).
- **Expense list sort was page-local AND partly dead (`37db22b`).** The table sorted client-side over
  the current 20-row page only, so "sort by amount" surfaced the biggest expense on page 1, not
  overall; worse, the grouped row builder re-sorted by date unconditionally, making the Amount/Tags
  headers a no-op. Moved sort server-side (allowlisted column + stable id tiebreaker for paginated
  ties; default date-desc preserved). Table gained a controlled-sort opt-in; client sort kept as
  fallback. +6 cross-page backend tests.
- **Expense category filter was page-local (`69bfb61`).** Same class — picking a category only
  filtered the visible slice. Made the category Select controlled (parent re-fetches server-filtered
  across all rows); +4 backend tests.

**Test-harness reliability (1):**
- **Double-gated `DISABLE_RATE_LIMIT` (`e28666a`).** The local E2E harness's own request volume
  exhausted the in-memory global rate limiter (1000/15min) across repeated runs, intermittently 429ing
  late specs (surfacing as empty `/vehicles` → false "no vehicle" failures). New flag, gated exactly
  like `ALLOW_FAKE_STORAGE` (`env.DISABLE_RATE_LIMIT && env !== 'production'`) so it can never weaken
  production abuse protection; the harness boots with it on. **Not a product change** — no route
  behavior changes when the flag is unset (i.e. always, in prod). This made the regress floor reliably
  green again (the previously-flaky vehicle-detail / settings-persist / clear-field cluster was this
  limiter, not a product bug).

**Test depth added:** backend 798→**808**; frontend unit 292→**306**; E2E 56→**60** (expense-sort +
expense-category-filter, both proven failing-first). All green.

---

### 14. Added since the cycle-181 digest (cycles 182–192; +11 commits)
The 143→154 growth. **No schema/migration change** (still the same two migrations); all additive. A
new **CSV import** feature (the round-trip pair to the existing export), a swept-and-guarded
**WCAG-AA text-contrast bug class**, one export-correctness fix, and money-math test pinning. Every
item is an independent, individually-verified increment.

**Feature — CSV import (the VROOM-CSV round-trip; 3 commits):**
- **Backend `POST /api/v1/expenses/import` (`77d1697`).** The paired half of the cycle-132 export,
  whose column contract was always the round-trip target. Pure `import-csv.ts` (parse/validate/match/
  summarize) + a thin route. Security: per-row schema bounds mirror the create path; each row's vehicle
  is resolved **by name within the importing user's own fleet** (never a file-provided id — the
  cross-tenant class hardened in §10), a row cap + 5MB body cap bound resource use, and **`dryRun`
  previews** (validate + report, write nothing) vs commit. +9 HTTP tests.
- **Import UI (`0403cc8`).** `ImportExpensesDialog.svelte` (bits-ui Dialog): file picker + paste
  fallback → auto dry-run **preview** ("N ready" / "M rows need attention" with per-row messages) →
  "Import N rows" commits. "Import CSV" button in the `/expenses` header (shown always; Export still
  gated to `totalCount > 0`). +1 E2E (open → paste → preview → commit → persist).
- **Round-trip fidelity fix (`5fa9949`).** Adversarial review of the just-shipped import caught that
  the export neutralizes CWE-1236 cells with a leading `'` but the importer didn't strip it — so
  `export → re-import` corrupted a `=formula` description to `'=…`. Added `denormalizeCsvCell` (the
  documented symmetric inverse; strips `'` only before a formula trigger, so a real leading apostrophe
  survives). +11 round-trip/unit cases.

**a11y — text-on-chart-color contrast (WCAG AA) bug class, swept across 3 tab/data-gated surfaces:**
- **Dashboard category badge (`a1e88db`)**, **finance tab (`3b64de2`)**, **analytics per-vehicle
  health score (`12ad827`)** — each rendered a chart color as small/medium TEXT on its own light tint
  (e.g. chart-2 `#009689` = 3.26:1; chart-5 amber = 1.97:1), failing the 4.5:1 (or large-text 3:1) bar.
  Root cause was structural: these live behind tabs/data states the route-smoke axe scan never reaches,
  so the gate couldn't catch them. Fixed by keeping color on **graphical** elements (icons, tint
  backgrounds, progress bars — exempt) and making the TEXT `text-foreground`; the health badge also
  gained an explicit "Good/Fair/Needs attention" label (no longer color-only). Each fix shipped with a
  **deterministic committed guard** that seeds the exact failing state and asserts axe-clean — closing
  the tab/data-gated blind spot the standing scan had.

**Export correctness (1):**
- **CSV export now matches the filtered table (`250c498`).** Export accepted vehicle/category/date but
  ignored search + tags (and the page handler dropped category), so a filtered table + Export gave a
  broader file than shown. Extracted a shared `buildExpenseConditions()` used by both the list and the
  export, so a divergence is structurally impossible; +2 HTTP tests.

**Test pinning (money-math, 2):** `calculateLeaseMetrics` (`9c041b1`) and `calculateNextPaymentDate` /
`calculateDaysUntil` (`b3e3392`) — the last untested financing/lease helpers, now contract-pinned
(incl. over-limit clamps, month-end rollover, divide-by-zero guards). Closes financing-calc coverage.

**Test depth added:** backend 808→**836**; frontend unit 306→**331**; E2E 60→**65** (import round-trip
+ the 3 a11y-contrast guards). All green.

---

## Reviewer checklist / call-outs
- [ ] **Two migrations** to apply, in order: `0001_blushing_juggernaut.sql` (client_id) and
  `0002_medical_the_phantom.sql` (insurance_claims). Both additive; they auto-run on startup via
  `runMigrations()`.
- [ ] **One new deployer-facing env var**: `TRUSTED_PROXY_IPS` (safe default empty; set behind a
  proxy). _(Two other env flags — `ALLOW_FAKE_STORAGE`, `DISABLE_RATE_LIMIT` — are local-E2E-harness
  only, double-gated to refuse in production; do NOT set them in a real deployment.)_
- [ ] **Google Photos** is backend-complete but its **OAuth connect path is unfinished** —
  decide whether to merge as-is (provider unreachable until connect is wired) or hold.
- [x] **Clear-optional-field data-loss class is now fully closed** (was a deferred gap): the last
  instance — expense `description` couldn't be cleared on edit — was fixed in §12 (a4984d3) with an
  offline-safe edit-aware transformer opt-in. No remaining instances across claims/terms/notes/
  vehicles/reminders/expenses.
- [ ] No `main` history rewrite; branch is a clean fast-forwardable stack off `main`.
  _(Re-verified cycle 192: `git rev-list --count HEAD..origin/main` = 0 — no divergence, no conflict;
  working tree clean. Diff scope: 191 files, +19,496 / −1,729.)_

## Suggested merge
Branch is green and self-contained. The breadth comes from ~192 autonomous build/review cycles;
commits are small and themed, so it reviews well commit-by-commit or squashed by the sections
above. **Strong recommendation to merge soon**: at 154 commits / 191 files the branch is long-lived,
and every additional cycle of all-green work compounds the review surface of an eventual first
merge. Each post-#278 cycle has been an independent, individually-verified increment (feature or
deep-review fix), so there is no "unfinished epic" blocking a merge — the branch is mergeable at any
commit. Many commits are `Log/docs cycle-N …` audit-trail updates — a squash-merge collapses these
cleanly. (Merging is human-owned per the repo rules; this digest exists to make that review fast.)
