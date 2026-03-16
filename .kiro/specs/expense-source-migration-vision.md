# Future: Expense Source System Migration

## Context

The reminders feature introduces `source_type` / `source_id` columns on the `expenses` table as a generic provenance system. This document captures the vision for migrating existing one-off linkage patterns to use this unified system.

## Current State

The `expenses` table has two domain-specific linkage fields:

1. `isFinancingPayment` (boolean) — marks an expense as a financing payment, but doesn't link to *which* financing record. The link is inferred by matching the vehicle and hoping there's one active financing.
2. `insurance_term_id` (FK → insurance_terms, ON DELETE SET NULL) — directly links to an insurance term. Uses a real FK with cascade.

## Target State

Both replaced by the generic source system:

| Current | Target |
|---|---|
| `isFinancingPayment = true` | `source_type = 'financing'`, `source_id = <financing_id>` |
| `insurance_term_id = 'term_abc'` | `source_type = 'insurance_term'`, `source_id = 'term_abc'` |

## Why Migrate

- `isFinancingPayment` is fragile — it's a boolean with no link to the actual financing record. Can't answer "show all payments for this specific loan" without guessing.
- `insurance_term_id` is a dedicated FK that does the same job `source_type`/`source_id` would do, but as a one-off column. Every new domain relationship would need another dedicated FK column.
- Unified source system means one query pattern for all provenance: `WHERE source_type = ? AND source_id = ?`
- One index `(source_type, source_id)` covers all source types.

## Cascade Behavior

`source_id` can't have a real FK constraint because it's polymorphic (points to different tables depending on `source_type`). Cascade behavior is handled in application code via hooks files:

| Source Type | On Source Deletion | Rationale |
|---|---|---|
| `reminder` | No cleanup — expenses survive | Auto-created expenses are real financial records |
| `insurance_term` | Delete expenses OR null-out source fields | User is removing the term, associated expenses may not make sense standalone |
| `financing` | Null-out source fields (keep expenses) | Financing paid off/removed, but payment history should persist |

Each source type's cleanup logic lives in its domain's `hooks.ts` file. The cleanup query is fast thanks to the `(source_type, source_id)` index:

```sql
-- Example: insurance term deletion cleanup
DELETE FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?;
-- OR: keep expenses but remove link
UPDATE expenses SET source_type = NULL, source_id = NULL WHERE source_type = 'insurance_term' AND source_id = ?;
```

## Migration Steps

### Step 1: Ship source_type / source_id (done with reminders feature)
- Columns added to expenses table (nullable, no default)
- Index on `(source_type, source_id)`
- Reminder trigger sets `source_type = 'reminder'`, `source_id = reminder.id`

### Step 2: Backfill financing expenses
- For each expense where `isFinancingPayment = true`:
  - Look up the vehicle's active financing record at the expense's date
  - Set `source_type = 'financing'`, `source_id = <financing_id>`
- Add financing hooks: on financing deletion, null-out source fields on linked expenses
- Deprecate `isFinancingPayment` (keep column for backward compat, stop reading it in new code)

### Step 3: Backfill insurance term expenses
- For each expense where `insurance_term_id IS NOT NULL`:
  - Set `source_type = 'insurance_term'`, `source_id = insurance_term_id`
- Add insurance term hooks: on term deletion, delete or null-out linked expenses
- Deprecate `insurance_term_id` FK (keep column for backward compat, stop reading it in new code)

### Step 4: Cleanup (optional, future)
- Remove `isFinancingPayment` column
- Remove `insurance_term_id` column
- Update backup/restore to stop exporting deprecated columns

## Notes

- Steps 2-4 are separate specs/features — not part of the reminders feature
- Backward compatibility: keep deprecated columns until all consumers are migrated
- The source system is extensible: future integrations (CSV import, API sync, etc.) just use their own `source_type` value
