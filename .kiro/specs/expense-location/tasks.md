# Store Location with Expenses — Tasks

> Backend-first per CLAUDE.md (schema/migration → validation → response auto-flows → frontend → backup/CSV).
> **The SPEC is greenlit-to-spec (Angelo decision 23).** This is the SIMPLEST feature class — ONE additive
> nullable column mirroring `description` end to end; most layers auto-flow (Drizzle generic selects +
> schema-derived backup). One task per `feature` cycle, each independently verified via `bun run
> validate:local` both sides; never commit red.
>
> KEY GROUNDING (do not re-derive): this is the UNSHIPPED half of TODO #13 ("Store location with expenses");
> the OTHER half ("Road trip! Trips tracking") already SHIPPED (trips-location, DONE pre-C11) — do NOT
> touch trips. v1 is a FREE-TEXT label, NO GPS (the trips D5 precedent). Additive `ALTER TABLE ADD COLUMN`
> (the 0011 class, NOT a 0004 rebuild). NOT an ARCC trigger (design §7 — no credential/scope/PII/GenAI).

## Phase 0 — sign-off (gates the dependent slices)
- [ ] **T0 — Angelo ACK the D1–D4 forks (requirements.md).** D1 = free-text string (no GPS, length-capped,
      mirrors trips.startLocation); D2 = a single-line "Location (Optional)" Input beside Description in the
      expense form; D3 = leave VLM `vendor`→`description` AS-IS, location is user-entered only (NO change to
      the shipped VLM contract — do NOT repurpose vendor as location); D4 = show location on the expense
      detail/expanded row + CSV export, NOT a dense-table column. Each has a RECOMMENDED option; ACK takes
      all. **T1 (schema/migration) does NOT depend on T0 and MAY build first** (the column is additive
      regardless of the UX forks); T2+ (the form placement / VLM-mapping / display calls) honor the ruling.

## Phase 1 — backend (the column + validation; fork-free plumbing)
- [x] **T1 — Schema + additive migration (C549, fork-free).** Added `location: text('location')` to the
      `expenses` table (schema.ts, after `description`) + `0012_expense_location.sql` (`ALTER TABLE expenses
      ADD location text;`, the 0011 additive class — NOT a rebuild) + the journal entry (idx 12; the runtime
      `migrate()` reads `_journal.json`). Added `CONFIG.validation.expense.locationMaxLength = 200`. The
      in-memory harness runs `runMigrations()` on every createTestApp, so the full suite PROVES 0012 applies
      (2298 pass). Two ripples handled: 3 full-row test fixtures (repository.property + calculations[.property])
      needed `location: null` (Drizzle infers the column required in the row type); and the
      `sheets-header-coverage` drift guard correctly FORCED adding `location` to the expenses `SHEET_HEADERS`
      (the schema-vs-Sheets column-coverage assertion — part of R4, pulled in early by the guard). Backend
      validate:local GREEN (2298, +0 net — the column auto-flows through every generic `.select()`; no repo
      change). NEXT: T2 (the create/update Zod field + the round-trip read test).
- [x] **T2 — Create + update validation + the round-trip read (C550, fork-free).** Added an explicit
      `location` override to `baseExpenseSchema` (createInsertSchema already infers the column; the override
      adds the `locationMaxLength` cap + the `.nullish()` clear-on-edit contract, mirroring `description`).
      The POST/PUT handlers spread the validated body (`createIdempotent({ ...expenseData, … })`), so
      `location` auto-flows into the insert; `clearFuelFieldsIfNotFuel` leaves it untouched; the generic
      select returns it. GUARD `expense-location-roundtrip.test.ts` (5 cases, HTTP harness): a provided
      location persists + reads back through the API; a create WITHOUT location → NULL (fully optional); a
      PUT location:null CLEARS it (the clear-optional-field class); a PUT without location leaves it
      untouched; an over-cap (201-char) location → 400. Backend validate:local GREEN (2303, +5). NEXT: T3
      (CSV export/import round-trip — the backup + Sheets paths already auto-covered by T1).

## Phase 2 — backup / CSV round-trip (R4)
- [x] **T3 — CSV export/import + backup round-trip (C551, fork-free).** Added `'location'` to
      `EXPORT_COLUMNS` (after `'description'`) + `location: e.location ?? ''` to the export record map; on the
      IMPORT side (native VROOM CSV), the importer lists columns by hand, so threaded `location` through the
      `ImportableExpense` interface + `parseRow` (a `parseBoundedString` at locationMaxLength) + the
      `deriveImportClientId` content hash (so two rows differing only by location get distinct dedup keys).
      `importExpenses` spreads the row generically → the column auto-inserts. GUARD
      `expense-location-csv.test.ts` (3 cases): export CSV header+body carries location; a native CSV with a
      location column persists it; a re-import is an idempotent no-op (the new column in the hash does not
      break dedup). + a `location` case added to `import-client-id-field-sensitivity.test.ts` (proves the
      key flips on a location-only diff — no silent collision). The backup/restore + Sheets paths were
      already auto-covered (T1: schema-derived getTableColumns + the SHEET_HEADERS thread). Backend
      validate:local GREEN (2307, +4). **★ ALL THREE FORK-FREE BACKEND SLICES (T1-T3) DONE; the remaining
      T4-T6 are the FE tail, honoring the T0 D2/D4 ruling.**

## Phase 3 — frontend (honors D2/D4 — eyes-on tail)
- [x] **T4 — FE type + transformer (C552, fork-free).** Added `Expense.location?: string` (expense.ts) +
      `BackendExpenseRequest.location?: string | null` + `BackendExpenseResponse.location?: string | null` +
      the toBackendExpense block (set when present; explicit `null` on isEdit to clear; omit on create) + the
      fromBackendExpense passthrough — each mirroring `description` exactly. GUARD
      `api-transformer-location.test.ts` (6 cases, drives the REAL transformer): toBackend sends a provided
      location / omits on create-no-value / sends null on isEdit-empty / absent on non-edit-empty; fromBackend
      copies a present location / leaves it undefined on null. FE validate:local GREEN (1439 vitest, +6).
      NEXT: T5 (the expense-form Location Input + the detail-row display, honors D2/D4).
- [x] **T5 — The expense-form Location input + display (C553, honors D2/D4).** ExpenseForm: added
      `formData.location` (init '') + a single-line `Input` labeled "Location (Optional)" placed after the
      Description Textarea (D2 — Description stays a Textarea, location is a short label); load
      `expense.location ?? ''` on edit; `location: formData.location || undefined` added to the regular
      create + edit payload sites (the split-create site is left without location — single-expense-only, the
      spec cut). D4 display: a small muted "📍 location" line inside the EXISTING Description table cell for
      standalone expenses (NO new dense-table column; the split GroupRow has no location). EYES-ON (boot +
      shot /expenses/new + Read): the Location input renders with the "e.g. Shell, Main St" placeholder
      between Description and Tags, zero console errors. FE validate:local GREEN (1439 vitest). NEXT: T6
      (e2e + DoD — a create-with-location round-trip through the form + the backend HTTP guard from T2/T3,
      tick the feature DONE).
- [ ] **T6 — Round-trip e2e + DoD.** A create-with-location → read-back assertion (the committed backend
      HTTP test from T2/T3 is the merge-surviving guard) + the FE eyes-on (T5). Feature-DoD: both sides
      validate:local green, the CSV + backup round-trip green, eyes-on the form + the detail display, the
      column in the backup payload. Tick the feature done.

## Notes
- **NO new table, NO new endpoint, NO money/fuel/split change** — a single additive nullable column.
- **Most layers auto-flow:** Drizzle generic `.select()` (reads), `getTableColumns` (backup) — only the Zod
  schemas, the FE type/transformer/form, and the explicit `EXPORT_COLUMNS` need hand-threading (~7 points).
- **NOT ARCC-gated** (design §7) — no credential/scope/PII/GenAI surface; a plain user-data column.
- WIP=1: this is the only in-flight feature; finish it before starting push/calendar (the other
  greenlit-to-spec integrations).
