# Store Location with Expenses — Design

> DRAFT (C548), paired with `requirements.md`. Backend-first per CLAUDE.md (schema → validation → response
> → frontend). **Nothing that depends on a fork (D1–D4) builds until Angelo rules T0;** the SPEC is
> greenlit-to-spec (decision 23). This is the SIMPLEST class of feature — ONE additive nullable column that
> auto-flows through Drizzle's generic selects + the schema-derived backup; only ~7 explicit threading
> points, each mirroring the existing `description` field.
>
> Grounded against the live code (C548, scout-verified):
> - `backend/src/db/schema.ts:209-281` — the `expenses` table; `description: text('description')` (222) is
>   the optional-free-text precedent. `trips.startLocation/endLocation` (schema.ts:416-417) is the
>   "free-text label, optional, no GPS" precedent this mirrors.
> - latest migration is `0011_quick_red_hulk.sql` (`ALTER TABLE expenses ADD created_by text …`) — the
>   additive-column pattern. The new one is `0012`.
> - `backend/src/api/expenses/routes.ts` — `baseExpenseSchema` (the create Zod, ~59-98) declares
>   `description` length-capped + `.nullish()`; the update schema (~140-163) re-declares overrides after
>   `.partial()`. `EXPORT_COLUMNS` (~593-606) + the export record map (~661-678) list columns explicitly.
> - `backend/src/api/expenses/repository.ts` — all reads are generic `.select().from(expenses)` → a new
>   column auto-flows; NO repo change.
> - `backend/src/api/sync/backup.ts:374` — `getColumnNames` = `Object.keys(getTableColumns(table))`
>   (schema-derived) → backup/restore auto-covers `location`; the round-trip coverage guard enforces it.
> - `frontend/src/lib/types/expense.ts:55` (`description?`) + `api-transformer.ts` (toBackendExpense ~108,
>   fromBackendExpense ~162) — the FE field + both-way mapping precedent.
> - `frontend/.../form/ExpenseForm.svelte` — `formData.description` state + the Textarea input + the
>   create/edit payload sites + the edit-load + the preselect prop.

## §0 — The one-line architecture
Add ONE nullable `expenses.location` TEXT column (additive migration), thread it through the Zod schemas +
the FE type/transformer/form mirroring `description` exactly, add it to the explicit CSV `EXPORT_COLUMNS`,
and let the schema-derived backup pick it up for free. No new table, no new endpoint, no money/fuel/split
change. **The whole feature is "another `description`, but a short label."**

## §1 — Schema + migration (R1)
```ts
// expenses table (schema.ts), after description:
location: text('location'),   // D1/D5: free-text label, optional — NO GPS in v1 (mirrors trips.startLocation)
```
Migration `0012_*.sql` (additive, the 0011 class — NOT a 0004-style rebuild):
```sql
ALTER TABLE `expenses` ADD `location` text;
```
Existing rows backfill NULL. No index (no v1 query filters on location; add later if per-location analytics
lands). Drizzle `getTableColumns(expenses)` now includes `location` → the backup column enumeration
auto-covers it (§4).

## §2 — Validation (R2)
In `baseExpenseSchema` (create), mirror `description`:
```ts
location: z.string().max(CONFIG.validation.expense.locationMaxLength, '… characters or less').nullish(),
```
- Add `locationMaxLength` to CONFIG (reuse the description bound, e.g. 200) — one config constant, no magic
  number. The update schema re-declares it after `.partial()` only if a default/refine is needed; a plain
  `.nullish()` field survives `.partial()`, so the update path needs NO override (unlike tags). An emptied
  value on edit → `null` (the description clear-on-edit contract, handled by the FE transformer's isEdit
  branch — §3), persisted as NULL.
- The SPLIT schema (`validation.ts`) is UNCHANGED — location is single-expense-only (out-of-scope cut).

## §3 — Response + FE thread (R3)
- **Backend response:** the repository reads are generic `.select()` → `location` auto-flows in every read
  (findByIdAndUserId, findBySource, list, summary rows). NO repo or response-shaper change.
- **FE type:** `Expense.location?: string` (expense.ts, after description) + `BackendExpenseResponse
  .location?: string | null` (api-transformer.ts).
- **toBackendExpense:** mirror the description block — set `backendExpense.location` when present; on
  `isEdit` send explicit `null` to clear; omit on create.
- **fromBackendExpense:** mirror — copy `location` through when present.
- **ExpenseForm:** add `formData.location` (init ''), a single-line `Input` labeled "Location (Optional)"
  beside Description (D2/D4 — Description stays the Textarea), load `expense.location ?? ''` on edit, and
  include `location: formData.location || undefined` in each create/edit payload site. A `preselectedLocation`
  prop mirrors `preselectedDescription` for the (rare) deep-link prefill — OPTIONAL, can defer.

## §4 — Backup / restore / sync + CSV (R4)
- **Backup/restore (auto):** `backup.ts:getColumnNames` is schema-derived (`getTableColumns`), so `location`
  flows into the backup payload + restore insert with ZERO code change. The existing expense round-trip
  coverage guard (the schema-vs-backup column-set assertion) will FAIL until `location` is in both — which
  it is, by construction — so the guard PROVES the round-trip without new test code (re-run it; if a
  carve-out list exists, add `location`).
- **CSV export:** add `'location'` to `EXPORT_COLUMNS` (after `'description'`) + `location: e.location ?? ''`
  to the export record map. CSV import: the native VROOM round-trip coerces all columns generically →
  `location` flows in if present; a foreign-tracker import simply omits it (NULL). 
- **Sheets sync:** the header set is pinned by `sheets-header-coverage.test.ts` (schema-derived) — adding the
  column updates the pinned header; re-run to confirm the round-trip.

## §5 — Testing
- **Backend:** extend the expenses create/update route test — a create WITH location persists + reads back;
  an edit clearing location → NULL; a create WITHOUT location → NULL (the optional path). A CSV
  export-includes-location + native re-import-round-trips-location HTTP case. The backup round-trip guard
  auto-covers the column (re-run; assert green).
- **Frontend:** the api-transformer test gains a location both-ways case (toBackend incl. the isEdit-null
  clear; fromBackend passthrough). The form is eyes-on (boot + shot the expense form showing the Location
  input + a created expense's detail showing the value).
- **No new e2e needed** beyond the form eyes-on — the field rides the existing expense create/read paths.

## §6 — Risk register
1. **Migration rebuild footgun.** Mitigated: this is a pure additive `ADD COLUMN` (the 0011 class), NOT a
   nullable-rebuild (the 0004 footgun the money-cents spec flagged). Zero data movement.
2. **A backup silently dropping the new column.** Mitigated: the schema-derived `getTableColumns` includes
   it automatically AND the column-coverage round-trip guard fails CI if schema and backup diverge — so a
   regression is caught, not silent (the #C404/#127 data-safety discipline).
3. **Scope creep into GPS/maps.** Mitigated: D1 rules free-text-only in v1; the spec names GPS as a
   separate later feature, not a deferred v1 cut.
4. **Split-leg ambiguity.** Mitigated: location is single-expense-only (the split schema is untouched); a
   split's legs share no per-leg location — explicit out-of-scope cut.

## §7 — Governance (ARCC)
NOT an ARCC trigger: no new credential, no new network egress, no new third-party scope, no PII beyond
what the user voluntarily types into a free-text field (no geolocation permission, no geocoding call).
This is a plain additive column on the user's own data, fully within the existing backup/encryption
envelope. (Contrast the Photos/LLM features, which DID touch credential/scope/GenAI surfaces and were
ARCC-grounded.) No search_arcc precondition.
