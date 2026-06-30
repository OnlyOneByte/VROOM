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
- [ ] **T2 — Create + update validation + the round-trip read (honors none directly; fork-free).** Add the
      optional length-capped `location` to `baseExpenseSchema` (create) — a plain `.nullish()` field that
      survives `.partial()`, so the update path needs no override. GUARD (expenses route HTTP test): a create
      WITH location persists + reads back; an edit clearing it → NULL; a create WITHOUT it → NULL. PERSISTS
      via the unchanged create path; the generic select returns it. Backend validate:local green.

## Phase 2 — backup / CSV round-trip (R4)
- [ ] **T3 — CSV export/import + backup round-trip (fork-free).** Add `'location'` to `EXPORT_COLUMNS`
      (after `'description'`) + `location: e.location ?? ''` to the export record map. GUARD: an HTTP test —
      create-with-location → export CSV contains it → native re-import round-trips it EXACTLY. The
      backup/restore + Sheets-sync paths are schema-derived (`getTableColumns`) → auto-covered; re-run the
      expense column-coverage round-trip guard + the `sheets-header-coverage` test and assert GREEN (they
      FAIL if schema and backup/header diverge — so they PROVE the round-trip with no new code, or need
      `location` added to a pinned header list). Backend validate:local green.

## Phase 3 — frontend (honors D2/D4 — eyes-on tail)
- [ ] **T4 — FE type + transformer (honors none directly; fork-free).** Add `Expense.location?: string`
      (expense.ts) + `BackendExpenseResponse.location?: string | null` + the toBackendExpense block (set when
      present; explicit `null` on isEdit to clear; omit on create) + the fromBackendExpense passthrough
      (api-transformer.ts), each mirroring `description`. GUARD: the api-transformer test gains a location
      both-ways case (incl. the isEdit-null clear). FE validate:local green.
- [ ] **T5 — The expense-form Location input + display (honors D2/D4).** Add `formData.location` (init '')
      + a single-line `Input` labeled "Location (Optional)" beside Description (Description stays the
      Textarea, D2); load `expense.location ?? ''` on edit; include `location: formData.location || undefined`
      in each create/edit payload site. Show the value on the expense detail/expanded row where description
      shows (D4); add it to the CSV export (done T3). Eyes-on (boot + shot the form showing the Location
      input + a created expense's detail showing the value; Read the PNG; zero console errors).
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
