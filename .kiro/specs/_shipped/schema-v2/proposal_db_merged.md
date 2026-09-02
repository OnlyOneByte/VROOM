# Schema v2 — Merged Proposal (Hard Migration)

## Background

This proposal is the result of a structured analysis process:

1. **Access pattern audit** (`docs/db-access-patterns.md`) — every read and write use case across
   all 12 tables was catalogued with query shapes, indexes hit, frequency estimates, and Big-O.
2. **Independent proposals** — two agents independently designed clean-sheet schemas optimized
   against the same access patterns:
   - `docs/proposal_db_1.md` — conservative approach, focused on relational correctness and
     DB-enforced invariants while preserving existing hook patterns where they work.
   - `docs/proposal_db_2.md` — aggressive approach, focused on eliminating all cross-domain
     hooks by computing derived values on read and making implicit side effects explicit.
3. **Cross-review** — both agents reviewed each other's proposals and independently converged
   on the same merged outcome for 15 of 16 decisions, with the remaining 1 being an omission
   rather than a disagreement.

This document is the merged proposal — the definitive schema design intended for spec creation
and implementation.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Decision Log](#2-decision-log)
3. [Schema Definitions](#3-schema-definitions)
4. [Eliminated Hooks & Side Effects](#4-eliminated-hooks--side-effects)
5. [Changes from v1 Summary](#5-changes-from-v1-summary)
6. [Data Migration Plan](#6-data-migration-plan)
7. [Backup & Restore Format](#7-backup--restore-format)
8. [Impact on Backend Code](#8-impact-on-backend-code)
9. [Impact on Frontend](#9-impact-on-frontend)
10. [Risks & Mitigations](#10-risks--mitigations)

---

## 1. Design Principles

These principles emerged from both proposals and the access pattern analysis:

- **Compute over cache.** Derived values (financing balance, odometer history, current insurance
  policy) are computed on read instead of maintained via hooks. SQLite is fast enough for
  single-user workloads — a SUM over <100 rows is sub-millisecond.
- **No cross-domain hooks.** Every mutation touches exactly the tables it owns. No expense-create
  triggering odometer upserts, financing balance adjustments, or insurance expense generation.
- **Explicit over implicit.** Insurance expenses are created by the user (with pre-filled data
  from the term), not auto-generated as a side effect of term creation.
- **Real FKs everywhere.** No text columns referencing IDs inside JSON blobs. Junction tables
  have real foreign key constraints with appropriate CASCADE behavior.
- **DB-enforced invariants.** Unique constraints and partial indexes enforce business rules
  (one active financing per vehicle, unique license plates) at the database level rather than
  relying on application code.
- **Ownership on the row.** Tables that need user-scoped queries carry `userId` directly,
  avoiding multi-hop JOINs for ownership checks.
- **Split by access pattern.** Settings are split into 2 tables based on read/write frequency
  to eliminate write contention on hot-read rows.
- **Relational over JSON.** Insurance terms become a proper table instead of a JSON column,
  eliminating parse-mutate-serialize cycles inside transactions.
- **Name columns for what they represent.** `volume` not `fuelAmount`, since it's unit-agnostic
  and matches the frontend type contract.

---

## 2. Decision Log

Every decision below was independently reached by both proposals unless noted. The "Source"
column indicates which proposal's approach was selected when they differed.

| #   | Decision                                                                                                                                          | Source           | Rationale                                                                                                                                 |     |     |     |     |     |     |
| -----| ---------------------------------------------------------------------------------------------------------------------------------------------------| ------------------| -------------------------------------------------------------------------------------------------------------------------------------------| -----| -----| -----| -----| -----| -----|
| 1   | Extract surance terms from JSON to proper table                                                                                                   | Both (identical) | Eliminates ~500 lines of JSON parse/mutate/serialize code, enables SQL queries on terms, real FK integrity on junction table              |     |     |     |     |     |     |
| 2   | Drop `vehicles.current_insurance_policy_id`                                                                                                       | (identical)      | Denormalized cache requiring manual sync hooks. Derivable via JOIN through terms table.                                                   |     |     |     |     |     |     |
| 3   | Add `user_id` to `photos` table                                                                                                                   | Both (identical) | Eliminates 4-branch polymorphic ownersuser-scoped queries. Same pattern expenses already uses.                                            |     |     |     |     |     |     |
| 4   | Drop `vehicle_fincing.current_balance`, compute on read                                                                                           | Proposal 2       | Eliminates 3 financing hooks. SUM over <100 rows is sub-ms. Prevents balance drift bugs.                                                  |     |     |     |     |     |     |
| 5   | Eliminatedometer hooks, use UNION view                                                                                                            | Proposal 2       | Eliminates 3 odometer hooks. Expense mileage already exists on the row — duplicating it to odometer_entries is redundant.                 |     |     |     |     |     |     |
| 6   | Eliminate insurance auto-expense creati                                                                                                           | Proposal 2       | Eliminates 3 insurance→expense hooks. Most complex transactional code in the app. UI pre-fills expense form from term data instead.       |     |     |     |     |     |     |
| 7   | Renameexpenses.fuel_amount` → `volume`                                                                                                            | Proposal 1       | Eliminates frontend↔backend naming mismatch. The API transformer currently bridges `fuelAmount` ↔ `volume`. Unit-agnostic name.           |     |     |     |     |     |     |
| 8   | Add realK on `expenses.insurance_term_id`                                                                                                         | Proposal 1       | ON DELETE SET NULL — deleting a term doesn't delete the expense (user paid real money). Adds index for "find expenses for term" query.    |     |     |     |     |     |     |
| 9   | Drop `expenses.insuran_policy_id`                                                                                                                 | Proposal 1       | Redundant — policy is derivable from term via `insurance_terms.policy_id`. Carrying both is unnecessary.                                  |     |     |     |     |     |     |
| 10  | 2-table settings split (not 3)                                                                                                                    | Proposal 1       | `user_preferences` (everything user-facing) + `sync_state` (system timestamps). 3-way split creates unnecessary repository proliferation. |     |     |     |     |     |     |
| 11  | `user_id` as PK on`sync_state`                                                                                                                    | Proposal 2       | 1:1 with users — a separate surrogate `id` column is pointless.                                                                           |     |     |     |     |     |     |
| 12  | Partial uniqueindex on `vehicle_financing(vehicle_id) WHERE is_active = 1`                                                                        | Proposal 1       | DB-enforced "one active financing per vehicle" invariant. Prevents data corruption from concurrent requests.                              |     |     |     |     |     |     |
| 13  | Patial unique index on `vehicles(license_plate) WHERE license_plate IS NOT NULL`                                                                  | Proposal 1       | Fixes the full-scan noted in access patterns. Free O(1) lookup.                                                                           |     |     |     |     |     |     |
| 14  | artial index on `photo_refs` for sync worker                                                                                                      | Proposal 2       | Exact predicate match for the sync worker poll query. Smaller, more targeted index.                                                       |     |     |     |     |     |     |
| 15  | Backup format versioning with v1 restore compatibility                                                                                            | Proposal 2       | Version field in backup metadata. Restore service handles both v1 and v2 formats. No data loss for existing backups.                      |     |     |     |     |     |     |
| 16  | Transaction-wrapped migration                                        migrates or none. Explicit transaction wrapper vs implicit rename-then-drop. |                  |                                                                                                                                           |     |     |     |     |     |     |

---

## 3. Schema Definitions

### 3.1 `users` — unchanged

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

No changes. Tiny table, PK + unique email lookups, managed by Lucia.

---

### 3.2 `sessions` — unchanged

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
```

No changes. Managed by Lucia adapter.

---

### 3.3 `vehicles` — drop insurance ref, add license plate index

```sql
CREATE TABLE vehicles (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make              TEXT NOT NULL,
  model             TEXT NOT NULL,
  year              INTEGER NOT NULL,
  vehicle_type      TEXT NOT NULL DEFAULT 'gas',
  track_fuel        INTEGER NOT NULL DEFAULT 1,
  track_charging    INTEGER NOT NULL DEFAULT 0,
  license_plate     TEXT,
  nickname          TEXT,
  vin               TEXT,
  initial_mileage   INTEGER,
  purchase_price    REAL,
  purchase_date     INTEGER,
  unit_preferences  TEXT NOT NULL DEFAULT '{}',  -- JSON: UnitPreferences
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX vehicles_user_id_idx ON vehicles(user_id);
CREATE UNIQUE INDEX vehicles_license_plate_idx
  ON vehicles(license_plate) WHERE license_plate IS NOT NULL;
```

**Changes from v1:**
- **Removed** `current_insurance_policy_id` — denormalized cache maintained by insurance hooks.
  The active policy for a vehicle is now derived:
  ```sql
  SELECT ip.id FROM insurance_policies ip
  JOIN insurance_terms it ON it.policy_id = ip.id
  JOIN insurance_term_vehicles itv ON itv.term_id = it.id
  WHERE itv.vehicle_id = ? AND ip.is_active = 1
  ORDER BY it.end_date DESC LIMIT 1
  ```
  This runs only on vehicle detail pages (low frequency) and hits indexed columns.
- **Added** partial unique index on `license_plate` — the access patterns doc notes
  `findByLicensePlate` does a full scan (O(V)). This gives O(1) lookup and enforces
  uniqueness for non-null values.

---

### 3.4 `vehicle_financing` — drop `current_balance`, add uniqueness constraint

```sql
CREATE TABLE vehicle_financing (
  id                  TEXT PRIMARY KEY,
  vehicle_id          TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  financing_type      TEXT NOT NULL DEFAULT 'loan',
  provider            TEXT NOT NULL,
  original_amount     REAL NOT NULL,
  apr                 REAL,
  term_months         INTEGER NOT NULL,
  start_date          INTEGER NOT NULL,
  payment_amount      REAL NOT NULL,
  payment_frequency   TEXT NOT NULL DEFAULT 'monthly',
  payment_day_of_month INTEGER,
  payment_day_of_week  INTEGER,
  residual_value      REAL,
  mileage_limit       INTEGER,
  excess_mileage_fee  REAL,
  is_active           INTEGER NOT NULL DEFAULT 1,
  end_date            INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX vf_vehicle_id_idx ON vehicle_financing(vehicle_id);
CREATE UNIQUE INDEX vf_active_vehicle_idx
  ON vehicle_financing(vehicle_id) WHERE is_active = 1;
```

**Changes from v1:**
- **Removed** `current_balance` — computed on read:
  ```sql
  SELECT
    vf.original_amount - COALESCE(SUM(e.expense_amount), 0) AS current_balance
  FROM vehicle_financing vf
  LEFT JOIN expenses e
    ON e.vehicle_id = vf.vehicle_id
    AND e.is_financing_payment = 1
  WHERE vf.id = ?
  ```
  This eliminates all 3 financing hooks (`handleFinancingOnCreate`, `handleFinancingOnUpdate`,
  `handleFinancingOnDelete`). For <100 payment rows per vehicle, the SUM is sub-millisecond.
- **Removed** auto-complete behavior — marking `is_active = false` when balance hits zero was
  a silent background mutation. In v2, the financing detail page computes the balance and shows
  a "Mark as paid off" button when balance ≤ 0.01. The user confirms explicitly.
- **Added** partial unique index `vf_active_vehicle_idx` — enforces "one active financing per
  vehicle" at the DB level. Prevents data corruption from concurrent requests.

            | Proposal 2       | Atomic — either all data Pr  ce F `on oanhip JOINs. Direct  Both in-----                                                                  | -------- | ----------- |     |     |     |     |

---

### 3.5 `insurance_policies` — simplified, terms extracted

```sql
CREATE TABLE insurance_policies (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company     TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX insurance_policies_user_id_idx ON insurance_policies(user_id);
```

**Changes from v1:**
- **Removed** `terms` JSON column — extracted to `insurance_terms` table (section 3.6).
- **Removed** `current_term_start` and `current_term_end` — denormalized from the latest term
  in the JSON array. Now derivable:
  ```sql
  SELECT start_date, end_date FROM insurance_terms
  WHERE policy_id = ? ORDER BY end_date DESC LIMIT 1
  ```

This is the single biggest structural change. The current `terms` JSON column forces all term
operations through read-modify-write cycles on the entire JSON array, and the junction table
references `termId` values that only exist inside that JSON blob with zero referential integrity.

---

### 3.6 `insurance_terms` — NEW TABLE (extracted from JSON)

```sql
CREATE TABLE insurance_terms (
  id                    TEXT PRIMARY KEY,
  policy_id             TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  start_date            INTEGER NOT NULL,
  end_date              INTEGER NOT NULL,
  policy_number         TEXT,
  coverage_description  TEXT,
  deductible_amount     REAL,
  coverage_limit        REAL,
  agent_name            TEXT,
  agent_phone           TEXT,
  agent_email           TEXT,
  total_cost            REAL,
  monthly_cost          REAL,
  premium_frequency     TEXT,
  payment_amount        REAL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX it_policy_id_idx ON insurance_terms(policy_id);
CREATE INDEX it_policy_end_date_idx ON insurance_terms(policy_id, end_date);
```

**Why this exists:**
The current schema stores terms as a JSON array on `insurance_policies.terms`. Each term has
nested `policyDetails` and `financeDetails` objects. This proposal flattens both nested objects
into columns on a proper relational table.

**Benefits:**
- `findExpiringPolicies` becomes `WHERE end_date BETWEEN ? AND ?` instead of loading all
  policies and parsing JSON.
- The `(policy_id, end_date)` index supports "latest term for policy" lookups.
- Term CRUD is standard INSERT/UPDATE/DELETE — no read-modify-write of JSON arrays.
- The junction table gets a real FK to `insurance_terms.id`.
- Cuts the `InsurancePolicyRepository` from ~900 lines to ~400.

**Migration:** For each existing policy, iterate the `terms` JSON array and INSERT one row per
term. The `id` values are preserved (they already exist as strings in the JSON). This step
requires application code (Bun/JS) since SQLite cannot natively iterate JSON arrays with nested
object extraction.


---

### 3.7 `insurance_term_vehicles` — renamed, real FKs, simpler PK

```sql
CREATE TABLE insurance_term_vehicles (
  term_id     TEXT NOT NULL REFERENCES insurance_terms(id) ON DELETE CASCADE,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  PRIMARY KEY (term_id, vehicle_id)
);

CREATE INDEX itv_vehicle_idx ON insurance_term_vehicles(vehicle_id);
```

**Changes from v1 (`insurance_policy_vehicles`):**
- **Renamed** from `insurance_policy_vehicles` — the junction is between terms and vehicles,
  not policies and vehicles. The current name is misleading.
- **Removed** `policy_id` column — redundant since `term_id` → `insurance_terms.policy_id`.
  The current schema has `(policyId, termId, vehicleId)` as the composite PK, but `policyId`
  is derivable from `termId`.
- **Real FK** on `term_id` → `insurance_terms(id)` with CASCADE. Currently `termId` references
  a string inside a JSON array with zero referential integrity.
- Simpler composite PK: `(term_id, vehicle_id)` instead of `(policy_id, term_id, vehicle_id)`.

---

### 3.8 `expenses` — FK fix, column rename, drop redundant column

```sql
CREATE TABLE expenses (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id            TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  category              TEXT NOT NULL,
  tags                  TEXT,           -- JSON array of strings
  date                  INTEGER NOT NULL,
  mileage               INTEGER,
  description           TEXT,
  receipt_url           TEXT,
  expense_amount        REAL NOT NULL,
  volume                REAL,           -- renamed from fuel_amount
  fuel_type             TEXT,
  is_financing_payment  INTEGER NOT NULL DEFAULT 0,
  missed_fillup         INTEGER NOT NULL DEFAULT 0,
  insurance_term_id     TEXT REFERENCES insurance_terms(id) ON DELETE SET NULL,
  group_id              TEXT,
  group_total           REAL,
  split_method          TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX expenses_vehicle_date_idx ON expenses(vehicle_id, date);
CREATE INDEX expenses_vehicle_category_date_idx ON expenses(vehicle_id, category, date);
CREATE INDEX expenses_category_date_idx ON expenses(category, date);
CREATE INDEX expenses_user_date_idx ON expenses(user_id, date);
CREATE INDEX expenses_user_category_date_idx ON expenses(user_id, category, date);
CREATE INDEX expenses_group_idx ON expenses(group_id);
CREATE INDEX expenses_insurance_term_idx ON expenses(insurance_term_id);
```

**Changes from v1:**
- **Renamed** `fuel_amount` → `volume` — matches the frontend type (`Expense.volume`) and is
  unit-agnostic. Eliminates the naming mismatch that requires the `api-transformer` to bridge
  `fuelAmount` ↔ `volume`.
- **Replaced** `insurance_policy_id` + `insurance_term_id` (two plain text columns) with a
  single `insurance_term_id` FK → `insurance_terms(id)` ON DELETE SET NULL. The policy is
  derivable from the term. SET NULL means if a term is deleted, the expense survives but loses
  its insurance link (vs CASCADE which would delete the expense — undesirable since the user
  paid real money).
- **Added** index on `insurance_term_id` for the "delete term → find linked expenses" and
  "find expenses for insurance term" query paths.
- All other columns and indexes are identical to v1.

---

### 3.9 `odometer_entries` — manual-only, slimmed

```sql
CREATE TABLE odometer_entries (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  odometer    INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX odometer_vehicle_date_idx ON odometer_entries(vehicle_id, recorded_at);
```

**Changes from v1:**
- **Removed** `linked_entity_type` and `linked_entity_id` columns.
- **Removed** `odometer_linked_entity_idx` index.

This table now stores only manual odometer readings entered directly by the user. Expense-linked
mileage stays on the expense row (the `mileage` column). The full odometer history combines both
sources via a UNION query:

```sql
-- Odometer history for a vehicle (used by the history page)
SELECT mileage AS odometer, date AS recorded_at, 'expense' AS source,
       id AS source_id, NULL AS note
FROM expenses
WHERE vehicle_id = ? AND mileage IS NOT NULL
UNION ALL
SELECT odometer, recorded_at, 'manual' AS source,
       id AS source_id, note
FROM odometer_entries
WHERE vehicle_id = ?
ORDER BY recorded_at DESC
```

Both branches hit indexed columns (`expenses_vehicle_date_idx`, `odometer_vehicle_date_idx`).

**What this eliminates:**
- `handleOdometerOnExpenseCreate` — no linked entry to create
- `handleOdometerOnExpenseUpdate` — no linked entry to upsert/delete
- `handleOdometerOnExpenseDelete` — no linked entry to delete
- The `upsertFromLinkedEntity` and `deleteByLinkedEntity` repository methods
- ~6 DB round-trips per expense mutation removed

**Trade-off:** The odometer history page queries two tables via UNION instead of one. But that
page is low-frequency, and both tables have covering indexes. Net win.


---

### 3.10 `user_preferences` — split from `user_settings`

```sql
CREATE TABLE user_preferences (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  unit_preferences       TEXT NOT NULL DEFAULT '{}',  -- JSON: UnitPreferences
  currency_unit          TEXT NOT NULL DEFAULT 'USD',
  auto_backup_enabled    INTEGER NOT NULL DEFAULT 0,
  backup_frequency       TEXT NOT NULL DEFAULT 'weekly',
  sync_on_inactivity     INTEGER NOT NULL DEFAULT 1,
  sync_inactivity_minutes INTEGER NOT NULL DEFAULT 5,
  storage_config         TEXT DEFAULT '{}',  -- JSON: StorageConfig
  backup_config          TEXT DEFAULT '{}',  -- JSON: BackupConfig
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);
```

**Changes from v1 (`user_settings`):**
- **Renamed** from `user_settings` to `user_preferences` — clearer intent.
- **`user_id` as PK** — no separate surrogate `id` column. This is a 1:1 table with users;
  a separate ID is pointless.
- **Removed** `last_backup_date`, `last_sync_date`, `last_data_change_date` — moved to
  `sync_state` (section 3.11). These are system-managed timestamps with high write frequency
  (`lastDataChangeDate` updates on every data mutation via the activity tracker middleware).
  Separating them avoids write contention with the user-facing preferences row.

This table is read-heavy (every analytics call for unit prefs, every photo upload for storage
config) and write-rare (settings page save, provider config changes).

---

### 3.11 `sync_state` — NEW TABLE (split from `user_settings`)

```sql
CREATE TABLE sync_state (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sync_date         INTEGER,
  last_data_change_date  INTEGER,
  last_backup_date       INTEGER
);
```

**Why this exists:**
The activity tracker middleware updates `last_data_change_date` on every POST/PUT/DELETE request.
In the current schema, this writes to the same `user_settings` row that the settings UI reads
and the analytics layer queries for unit preferences.

In SQLite WAL mode this isn't a real concurrency problem today, but it's a separation of concerns
issue. System-managed timestamps that change on every mutation don't belong in the same row as
user-facing preferences that change once a month.

`user_id` is the PK — no separate `id` column needed for a 1:1 user table.

---

### 3.12 `user_providers` — unchanged

```sql
CREATE TABLE user_providers (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  credentials   TEXT NOT NULL,
  config        TEXT,  -- JSON
  status        TEXT NOT NULL DEFAULT 'active',
  last_sync_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX up_user_domain_idx ON user_providers(user_id, domain);
```

No changes. Tiny table (1-3 rows per user), clean design.

---

### 3.13 `photos` — add `user_id`

```sql
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  is_cover    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX photos_entity_idx ON photos(entity_type, entity_id);
CREATE INDEX photos_user_entity_type_idx ON photos(user_id, entity_type);
```

**Changes from v1:**
- **Added** `user_id` FK — photos are currently owned indirectly through their entity (a
  vehicle's photo is owned by the vehicle's owner). This means "count all photos for user X"
  or "find all photos by entity type for user X" requires JOINing through the entity tables —
  the current code has a 4-branch function (`countUserPhotos`) with different JOINs per entity
  type. Denormalizing `userId` onto photos (same pattern expenses already uses) makes user-scoped
  photo queries direct index lookups.
- **Added** `(user_id, entity_type)` index — supports provider stats queries and provider
  deletion cascade without any JOINs.

---

### 3.14 `photo_refs` — partial index for sync worker

```sql
CREATE TABLE photo_refs (
  id           TEXT PRIMARY KEY,
  photo_id     TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  provider_id  TEXT NOT NULL REFERENCES user_providers(id) ON DELETE CASCADE,
  storage_ref  TEXT NOT NULL,
  external_url TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  synced_at    INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX pr_photo_provider_idx ON photo_refs(photo_id, provider_id);
CREATE INDEX pr_pending_idx ON photo_refs(status, created_at)
  WHERE status IN ('pending', 'failed') AND retry_count < 3;
```

**Changes from v1:**
- **Changed** `pr_pending_idx` to a partial index matching the sync worker's exact query
  predicate. The sync worker polls `WHERE status IN ('pending', 'failed') AND retryCount < 3
  ORDER BY createdAt LIMIT ?`. The partial index is smaller and exactly covers this query.
  SQLite has supported partial indexes since 3.8.0 (2013). Bun bundles a modern SQLite.


---

## 4. Eliminated Hooks & Side Effects

The current codebase has 9 cross-domain hooks that fire on expense and insurance CRUD operations.
All 9 are eliminated in v2.

### 4.1 Odometer hooks (3) — eliminated

| v1 Hook | Trigger | v2 Replacement |
|---|---|---|
| `handleOdometerOnExpenseCreate` | Expense created with mileage ≠ null | Eliminated — mileage stays on expense row, no linked odometer entry created |
| `handleOdometerOnExpenseUpdate` | Expense mileage changed (4 transition cases) | Eliminated — mileage stays on expense row |
| `handleOdometerOnExpenseDelete` | Expense deleted with mileage ≠ null | Eliminated — mileage stays on expense row |

**Files deleted:** `backend/src/api/odometer/hooks.ts`

**Impact:** Every expense create/update/delete saves ~2 DB round-trips (find linked entry +
upsert/delete). The odometer history page uses a UNION query instead.

### 4.2 Financing hooks (3) — eliminated

| v1 Hook | Trigger | v2 Replacement |
|---|---|---|
| `handleFinancingOnCreate` | Financing expense created | Eliminated — balance computed on read via SUM |
| `handleFinancingOnUpdate` | Financing expense amount/flag changed | Eliminated — balance computed on read via SUM |
| `handleFinancingOnDelete` | Financing expense deleted | Eliminated — balance computed on read via SUM |

**Files deleted:** `backend/src/api/financing/hooks.ts`

**Impact:** Every financing expense create/update/delete saves ~2-3 DB round-trips
(find financing + update balance + optional mark-as-completed). Auto-complete becomes an
explicit user action.

### 4.3 Insurance → expense hooks (3) — eliminated

| v1 Hook | Trigger | v2 Replacement |
|---|---|---|
| `createExpensesForTerm` | Insurance term created with totalCost | Eliminated — user creates expense explicitly, UI pre-fills from term data |
| `syncExpensesForTerm` | Insurance term coverage updated | Eliminated — user edits expense explicitly |
| Term delete → expense delete | Insurance term deleted | Eliminated — expense has FK with SET NULL, survives term deletion |

**Files affected:** `backend/src/api/insurance/repository.ts` (major simplification — these
methods are removed, not moved to a hooks file)

**Impact:** Insurance term CRUD goes from complex multi-table transactions (policy JSON +
junction + expense splits + vehicle ref sync) to simple INSERT/UPDATE/DELETE on
`insurance_terms` + junction management.

### 4.4 Remaining activity tracker — kept but retargeted

| Hook | Trigger | v2 Change |
|---|---|---|
| Activity tracker (`changeTracker` middleware) | Any data mutation (POST/PUT/DELETE) | Writes to `sync_state.last_data_change_date` instead of `user_settings.last_data_change_date` |
| Auto-sync inactivity check | Timer fires after N minutes idle | Reads from `sync_state` instead of `user_settings` |
| Auto-backup user lookup | Auto-sync triggers backup | Unchanged — reads `users` table |

### 4.5 Net effect on expense CRUD

| Operation | v1 DB operations | v2 DB operations |
|---|---|---|
| Create expense | 1 (expense) + 2 (odometer hook) + 2-3 (financing hook) + 1 (activity tracker) = **6-7** | 1 (expense) + 1 (activity tracker) = **2** |
| Update expense | 1 (find) + 1 (update) + 2 (odometer hook) + 2-3 (financing hook) + 1 (activity tracker) = **7-8** | 1 (find) + 1 (update) + 1 (activity tracker) = **3** |
| Delete expense | 1 (find) + 1 (delete) + 1 (odometer hook) + 2-3 (financing hook) + 1 (activity tracker) = **6-7** | 1 (find) + 1 (delete) + 1 (activity tracker) = **3** |

---

## 5. Changes from v1 Summary

### Table count

| | v1 | v2 |
|---|---|---|
| Tables | 12 | 14 |
| Added | — | `insurance_terms`, `sync_state` |
| Removed | — | `user_settings` (replaced by `user_preferences` + `sync_state`) |
| Renamed | — | `insurance_policy_vehicles` → `insurance_term_vehicles`, `user_settings` → `user_preferences` |
| Net | — | +2 tables |

### Column changes

| Table | Column | Change |
|---|---|---|
| `vehicles` | `current_insurance_policy_id` | Removed — derived via JOIN |
| `vehicle_financing` | `current_balance` | Removed — computed on read |
| `expenses` | `fuel_amount` | Renamed → `volume` |
| `expenses` | `insurance_policy_id` | Removed — derivable from term |
| `expenses` | `insurance_term_id` | Changed from plain text to real FK with ON DELETE SET NULL |
| `odometer_entries` | `linked_entity_type` | Removed |
| `odometer_entries` | `linked_entity_id` | Removed |
| `insurance_policies` | `terms` (JSON) | Removed — extracted to `insurance_terms` table |
| `insurance_policies` | `current_term_start` | Removed — derivable from terms |
| `insurance_policies` | `current_term_end` | Removed — derivable from terms |
| `photos` | `user_id` | Added — direct ownership |

### Index changes

| Index | Change |
|---|---|
| `vehicles_license_plate_idx` | Added — partial unique on non-null license plates |
| `vf_active_vehicle_idx` | Added — partial unique enforcing one active financing per vehicle |
| `it_policy_id_idx` | Added — new table |
| `it_policy_end_date_idx` | Added — new table, supports "latest term" and "expiring policies" queries |
| `itv_vehicle_idx` | Added — replaces `ipv_vehicle_policy_idx` |
| `expenses_insurance_term_idx` | Added — supports "find expenses for term" queries |
| `photos_user_entity_type_idx` | Added — supports user-scoped photo queries without JOINs |
| `pr_pending_idx` | Changed — partial index matching sync worker predicate |
| `odometer_linked_entity_idx` | Removed — linked entity columns dropped |
| `ipv_vehicle_policy_idx` | Removed — table renamed and restructured |

### Complexity changes

| Area | v1 | v2 |
|---|---|---|
| Cross-domain hooks | 9 (3 odometer + 3 financing + 3 insurance) | 0 |
| Insurance repository | ~900 lines (JSON parse/mutate/serialize + transactions) | ~400 lines (standard CRUD) |
| Expense CRUD DB ops | 6-8 per operation | 2-3 per operation |
| Photo ownership queries | 4-branch JOIN function | Single `WHERE user_id = ?` |
| Financing balance | Cached column + 3 hooks to maintain | Computed SUM on read |
| Odometer history | Single table query | UNION of expenses + manual entries |


---

## 6. Data Migration Plan

This is a one-time hard migration. Not an incremental Drizzle migration — the schema changes are
too structural (table renames, column renames, JSON extraction to tables) for Drizzle's diff-based
generator to handle correctly.

### 6.1 Strategy

1. Detect v1 schema (check for `user_settings` table existence)
2. Run full backup using existing `createBackup()` pipeline as a safety net
3. Begin transaction (atomic — either all data migrates or none)
4. Create all v2 tables alongside existing v1 tables
5. Migrate data with transformations (see step-by-step below)
6. Drop v1-only tables
7. Commit transaction
8. Run `VACUUM` to reclaim space
9. Update `__drizzle_migrations` table to reflect the new schema state

### 6.2 Step-by-step data migration

The migration runs inside a single SQLite transaction. Steps are ordered to respect FK
constraints (parent tables before children).

```
Step 1: Create all v2 tables (new DDL from section 3)
       — These are created alongside the v1 tables, not replacing them yet.

Step 2: users → copy as-is
       — No changes to this table.

Step 3: sessions → copy as-is
       — No changes to this table.

Step 4: vehicles → copy all columns EXCEPT current_insurance_policy_id
       INSERT INTO vehicles_v2 (id, user_id, make, model, year, vehicle_type,
         track_fuel, track_charging, license_plate, nickname, vin,
         initial_mileage, purchase_price, purchase_date, unit_preferences,
         created_at, updated_at)
       SELECT id, user_id, make, model, year, vehicle_type,
         track_fuel, track_charging, license_plate, nickname, vin,
         initial_mileage, purchase_price, purchase_date, unit_preferences,
         created_at, updated_at
       FROM vehicles;

Step 5: vehicle_financing → copy all columns EXCEPT current_balance
       INSERT INTO vehicle_financing_v2 (id, vehicle_id, financing_type, provider,
         original_amount, apr, term_months, start_date, payment_amount,
         payment_frequency, payment_day_of_month, payment_day_of_week,
         residual_value, mileage_limit, excess_mileage_fee, is_active,
         end_date, created_at, updated_at)
       SELECT id, vehicle_id, financing_type, provider,
         original_amount, apr, term_months, start_date, payment_amount,
         payment_frequency, payment_day_of_month, payment_day_of_week,
         residual_value, mileage_limit, excess_mileage_fee, is_active,
         end_date, created_at, updated_at
       FROM vehicle_financing;

Step 6: insurance_policies → copy id, user_id, company, is_active, notes, timestamps
       — Drop terms JSON, current_term_start, current_term_end.
       INSERT INTO insurance_policies_v2 (id, user_id, company, is_active, notes,
         created_at, updated_at)
       SELECT id, user_id, company, is_active, notes, created_at, updated_at
       FROM insurance_policies;

Step 7: insurance_terms → extract from insurance_policies.terms JSON
       — THIS STEP REQUIRES APPLICATION CODE (Bun/JS).
       — SQLite cannot natively iterate JSON arrays with nested object extraction.
       — For each policy in the old insurance_policies table:
           Parse the terms JSON array.
           For each term object in the array:
             INSERT INTO insurance_terms (
               id, policy_id, start_date, end_date,
               policy_number, coverage_description, deductible_amount,
               coverage_limit, agent_name, agent_phone, agent_email,
               total_cost, monthly_cost, premium_frequency, payment_amount,
               created_at, updated_at
             ) VALUES (
               term.id, policy.id,
               parseTimestamp(term.startDate), parseTimestamp(term.endDate),
               term.policyDetails?.policyNumber,
               term.policyDetails?.coverageDescription,
               term.policyDetails?.deductibleAmount,
               term.policyDetails?.coverageLimit,
               term.policyDetails?.agentName,
               term.policyDetails?.agentPhone,
               term.policyDetails?.agentEmail,
               term.financeDetails?.totalCost,
               term.financeDetails?.monthlyCost,
               term.financeDetails?.premiumFrequency,
               term.financeDetails?.paymentAmount,
               now, now
             )
       — The term.id values are preserved (they already exist as strings in the JSON).

Step 8: insurance_term_vehicles → copy from insurance_policy_vehicles
       — Drop the policy_id column (derivable from term).
       INSERT INTO insurance_term_vehicles (term_id, vehicle_id)
       SELECT term_id, vehicle_id FROM insurance_policy_vehicles;

Step 9: expenses → copy with column rename and column drop
       INSERT INTO expenses_v2 (id, user_id, vehicle_id, category, tags, date,
         mileage, description, receipt_url, expense_amount,
         volume,  -- renamed from fuel_amount
         fuel_type, is_financing_payment, missed_fillup,
         insurance_term_id,  -- keep term ID, drop policy ID
         group_id, group_total, split_method, created_at, updated_at)
       SELECT id, user_id, vehicle_id, category, tags, date,
         mileage, description, receipt_url, expense_amount,
         fuel_amount,  -- old column name maps to new 'volume'
         fuel_type, is_financing_payment, missed_fillup,
         insurance_term_id,
         group_id, group_total, split_method, created_at, updated_at
       FROM expenses;

Step 10: odometer_entries → copy only manual entries (no linked entity columns)
        INSERT INTO odometer_entries_v2 (id, vehicle_id, user_id, odometer,
          recorded_at, note, created_at, updated_at)
        SELECT id, vehicle_id, user_id, odometer,
          recorded_at, note, created_at, updated_at
        FROM odometer_entries
        WHERE linked_entity_type IS NULL;
        — Expense-linked entries are dropped. Their data lives on expense.mileage.

Step 11: user_preferences → extract from user_settings
        INSERT INTO user_preferences (user_id, unit_preferences, currency_unit,
          auto_backup_enabled, backup_frequency, sync_on_inactivity,
          sync_inactivity_minutes, storage_config, backup_config,
          created_at, updated_at)
        SELECT user_id, unit_preferences, currency_unit,
          auto_backup_enabled, backup_frequency, sync_on_inactivity,
          sync_inactivity_minutes, storage_config, backup_config,
          created_at, updated_at
        FROM user_settings;

Step 12: sync_state → extract from user_settings
        INSERT INTO sync_state (user_id, last_sync_date,
          last_data_change_date, last_backup_date)
        SELECT user_id, last_sync_date, last_data_change_date, last_backup_date
        FROM user_settings;

Step 13: user_providers → copy as-is
        — No changes to this table.

Step 14: photos → copy + populate user_id from entity ownership
        — Vehicle photos:
        INSERT INTO photos_v2 (id, user_id, entity_type, entity_id, file_name,
          mime_type, file_size, is_cover, sort_order, created_at)
        SELECT p.id, v.user_id, p.entity_type, p.entity_id, p.file_name,
          p.mime_type, p.file_size, p.is_cover, p.sort_order, p.created_at
        FROM photos p
        JOIN vehicles v ON p.entity_id = v.id
        WHERE p.entity_type = 'vehicle';

        — Expense photos:
        INSERT INTO photos_v2 (...)
        SELECT p.id, e.user_id, ...
        FROM photos p
        JOIN expenses e ON p.entity_id = e.id
        WHERE p.entity_type = 'expense';

        — Insurance policy photos:
        INSERT INTO photos_v2 (...)
        SELECT p.id, ip.user_id, ...
        FROM photos p
        JOIN insurance_policies ip ON p.entity_id = ip.id
        WHERE p.entity_type = 'insurance_policy';

        — Odometer entry photos:
        INSERT INTO photos_v2 (...)
        SELECT p.id, oe.user_id, ...
        FROM photos p
        JOIN odometer_entries oe ON p.entity_id = oe.id
        WHERE p.entity_type = 'odometer_entry';

Step 15: photo_refs → copy as-is
        — No changes to this table.

Step 16: Drop v1 tables
        DROP TABLE photos;
        DROP TABLE photo_refs;  -- (will be recreated with new photos table)
        DROP TABLE expenses;
        DROP TABLE odometer_entries;
        DROP TABLE insurance_policy_vehicles;
        DROP TABLE insurance_policies;
        DROP TABLE vehicle_financing;
        DROP TABLE vehicles;
        DROP TABLE user_settings;

Step 17: Rename v2 tables to final names
        ALTER TABLE vehicles_v2 RENAME TO vehicles;
        ALTER TABLE vehicle_financing_v2 RENAME TO vehicle_financing;
        ALTER TABLE insurance_policies_v2 RENAME TO insurance_policies;
        ALTER TABLE expenses_v2 RENAME TO expenses;
        ALTER TABLE odometer_entries_v2 RENAME TO odometer_entries;
        ALTER TABLE photos_v2 RENAME TO photos;
        -- insurance_terms, insurance_term_vehicles, user_preferences,
        -- sync_state already have their final names.

Step 18: Create all indexes (from section 3 DDL)

Step 19: Validation queries
        — Verify row counts match expectations:
        SELECT COUNT(*) FROM vehicles;          -- should match v1
        SELECT COUNT(*) FROM expenses;          -- should match v1
        SELECT COUNT(*) FROM insurance_terms;   -- should match total terms across all policies
        SELECT COUNT(*) FROM photos WHERE user_id IS NULL;  -- should be 0
        SELECT COUNT(*) FROM sync_state;        -- should match user count with settings
```

### 6.3 Rollback strategy

If the migration fails at any step, the transaction rolls back and the v1 schema is untouched.
The pre-migration backup (step 2 in section 6.1) provides an additional safety net — if the
database is somehow corrupted, restore from the backup file.


---

## 7. Backup & Restore Format

### 7.1 Version field

The backup metadata gains a `schemaVersion` field:

```json
{
  "metadata": {
    "version": "1.0.0",
    "schemaVersion": 2,
    "timestamp": "2026-03-13T...",
    "userId": "..."
  }
}
```

- `schemaVersion: 1` — v1 format (current)
- `schemaVersion: 2` — v2 format (this proposal)

### 7.2 v2 backup contents

The `BackupData` interface changes to reflect the new table structure:

```typescript
interface BackupData {
  metadata: { version: string; schemaVersion: number; timestamp: string; userId: string };
  vehicles: Vehicle[];           // without current_insurance_policy_id
  expenses: Expense[];           // volume instead of fuelAmount, no insurancePolicyId
  financing: VehicleFinancing[]; // without currentBalance
  insurancePolicies: InsurancePolicy[];  // without terms JSON
  insuranceTerms: InsuranceTerm[];       // NEW — extracted terms
  insuranceTermVehicles: InsuranceTermVehicle[];  // renamed junction
  odometer: OdometerEntry[];     // manual-only, no linked entity columns
  preferences: UserPreferences;  // split from settings
  syncState: SyncState;          // split from settings
  photos: Photo[];               // with userId
  photoRefs: PhotoRef[];         // unchanged
}
```

### 7.3 v1 backup restore compatibility

The restore service detects `schemaVersion` (or its absence, which implies v1) and applies
the appropriate import path:

- **v2 backups:** Direct insert into v2 tables. No transformation needed.
- **v1 backups:** Apply the same transformations as the data migration (section 6.2):
  - Extract terms from `insurance_policies.terms` JSON → `insurance_terms` rows
  - Map `insurance_policy_vehicles` → `insurance_term_vehicles` (drop policy_id)
  - Rename `fuel_amount` → `volume` on expenses
  - Drop `insurance_policy_id` from expenses
  - Split `user_settings` → `user_preferences` + `sync_state`
  - Populate `photos.user_id` from entity ownership JOINs
  - Drop expense-linked odometer entries (keep manual only)
  - Drop `current_balance` from financing (computed on read)
  - Drop `current_insurance_policy_id` from vehicles

This ensures users can restore from backups created before the migration without data loss.

### 7.4 Google Sheets sync

The Sheets export/import updates to match:
- New sheet: `insurance_terms` (replaces the terms data that was embedded in the policies sheet)
- Renamed sheet: `insurance_term_vehicles` (was `insurance_policy_vehicles`)
- Column changes: `expenses` sheet uses `volume` header instead of `fuel_amount`, drops
  `insurance_policy_id` column
- Split sheets: `user_preferences` and `sync_state` replace `user_settings`
- `photos` sheet gains `user_id` column
- `odometer_entries` sheet drops `linked_entity_type` and `linked_entity_id` columns

---

## 8. Impact on Backend Code

### 8.1 Files to delete

| File | Reason |
|---|---|
| `backend/src/api/odometer/hooks.ts` | All 3 odometer hooks eliminated |
| `backend/src/api/financing/hooks.ts` | All 3 financing hooks eliminated |

### 8.2 Files with major changes

| File | Changes |
|---|---|
| `backend/src/db/schema.ts` | Full rewrite — new table definitions per section 3. New types for `InsuranceTerm`, `InsuranceTermVehicle`, `UserPreferences`, `SyncState`. Remove old types for `InsurancePolicyVehicle`, `UserSettings`. |
| `backend/src/api/insurance/repository.ts` | Major simplification — no JSON parse/mutate/serialize. Standard CRUD on `insurance_terms` table + junction management. Remove `createExpensesForTerm`, `syncExpensesForTerm`, `syncVehicleReferences`, `clearRemovedVehicleRefs`, `syncDenormalizedFields`, `stripVehicleCoverage`, `buildSplitConfig`. ~900 lines → ~400 lines. |
| `backend/src/api/insurance/routes.ts` | Update request/response shapes for term CRUD. Remove expense auto-creation from term endpoints. Add "current term" derivation query. |
| `backend/src/api/insurance/validation.ts` | Update Zod schemas for new term structure (flat fields instead of nested policyDetails/financeDetails). |
| `backend/src/api/financing/repository.ts` | Remove `updateBalance`, `markAsCompleted`. Add `computeBalance(vehicleId)` query method that returns `originalAmount - SUM(payments)`. |
| `backend/src/api/odometer/repository.ts` | Remove `upsertFromLinkedEntity`, `deleteByLinkedEntity`, `findByLinkedEntity`. Add `getHistory(vehicleId)` method that returns the UNION query result. |
| `backend/src/api/settings/repository.ts` | Split into `PreferencesRepository` (reads/writes `user_preferences`) and update activity tracker to write `sync_state`. The `SyncStateRepository` is minimal — just `markDataChanged` and `hasChangesSinceLastSync`. |
| `backend/src/api/expenses/repository.ts` | Column rename: `fuelAmount` → `volume` in all queries. Remove `insurancePolicyId` from inserts/selects. |
| `backend/src/api/expenses/routes.ts` | Remove all hook calls: `handleOdometerOnExpenseCreate/Update/Delete`, `handleFinancingOnCreate/Update/Delete`. Expense CRUD becomes self-contained. |
| `backend/src/api/analytics/repository.ts` | Insurance analytics: query `insurance_terms` table instead of parsing JSON. `computeFleetHealthScore`: derive active policy via JOIN instead of reading `current_insurance_policy_id`. Vehicle units: read from `vehicles.unit_preferences` (unchanged) and user units from `user_preferences` instead of `user_settings`. |
| `backend/src/api/sync/backup.ts` | Update `createBackup()` to export new tables (`insurance_terms`, `user_preferences`, `sync_state`). Update `exportAsZip()` CSV column lists. Update `validateBackupData()` and `validateReferentialIntegrity()` for new table structure. Add `schemaVersion` to metadata. |
| `backend/src/api/sync/restore.ts` | Update `insertBackupData()` for new tables. Update `deleteUserData()` cascade order. Add v1 backup compatibility transform. |
| `backend/src/api/sync/google-sheets.ts` | New sheet for `insurance_terms`. Rename junction sheet. Update column headers for expenses, photos, odometer. Split settings sheets. |
| `backend/src/api/sync/activity-tracker.ts` | Write to `sync_state` instead of `user_settings`. |
| `backend/src/middleware/activity.ts` | Same — target `sync_state`. |
| `backend/src/api/photos/photo-repository.ts` | Add `userId` to `create()` method. |
| `backend/src/api/photos/photo-service.ts` | Pass `userId` to `photoRepository.create()`. |
| `backend/src/api/providers/routes.ts` | Replace `countUserPhotos` / `findUserPhotoIds` 4-branch JOIN functions with simple `WHERE user_id = ?` queries. Major simplification. |
| `backend/src/types.ts` | Update `BackupData`, `ParsedBackupData` interfaces. Add `InsuranceTerm` type. Remove `PolicyTerm` interface. |
| `backend/src/config.ts` | Update `TABLE_SCHEMA_MAP` and `TABLE_FILENAME_MAP` for new/renamed tables. Add `insurance_terms` to `OPTIONAL_BACKUP_FILES` for v1 backup compat. |

### 8.3 Files with minor changes

| File | Changes |
|---|---|
| `backend/src/api/vehicles/repository.ts` | Drop `currentInsurancePolicyId` from select/update queries. |
| `backend/src/api/photos/helpers.ts` | Simplify `validateEntityOwnership` — can check `photos.user_id` directly for existing photos. |
| `backend/src/api/expenses/split-service.ts` | Column rename: `fuelAmount` → `volume` if referenced. |
| `backend/src/api/expenses/validation.ts` | Update Zod schema: `fuelAmount` → `volume`, remove `insurancePolicyId`. |
| `backend/src/api/providers/services/google-sheets-service.ts` | Update sheet headers and column mappings. |
| `backend/src/api/providers/backup-strategies/google-drive-strategy.ts` | No changes expected — operates on backup ZIP, not individual tables. |
| `backend/src/db/seed.ts` | Update seed data for new schema (new tables, renamed columns). |
| `backend/src/db/data-migration.ts` | Add v1→v2 migration logic (section 6.2). |

### 8.4 Test files affected

All property tests and unit tests in `__tests__/` directories for affected domains need updates:
- `insurance/__tests__/` — term structure changes, no auto-expense tests
- `financing/__tests__/hooks.property.test.ts` — DELETE (hooks eliminated)
- `odometer/__tests__/hooks.property.test.ts` — DELETE (hooks eliminated)
- `expenses/__tests__/` — column rename, remove hook-related assertions
- `analytics/__tests__/` — insurance analytics query changes
- `photos/__tests__/` — `userId` in create calls
- `sync/__tests__/backup.test.ts` — new tables, v1 compat transform tests
- `db/__tests__/migration-*.test.ts` — new migration test file for v2

---

## 9. Impact on Frontend

### 9.1 Insurance flow (biggest UX change)

Creating an insurance term no longer auto-creates expenses. The new flow:

1. User creates/renews a term (same form, same fields including cost data)
2. After saving, the UI shows a prompt: "Add expense for this term?" with cost pre-filled
3. User confirms → navigates to expense form with:
   - `category = 'financial'`
   - `tags = ['insurance']`
   - `amount = totalCost` (from term)
   - `insuranceTermId` pre-set
   - Split allocation pre-configured across covered vehicles
4. User can review/edit the split allocation before saving

This is more transparent and gives the user control over how the cost is allocated. The term
detail page also shows a "Create expense" action for terms that don't have a linked expense yet.

**Files affected:**
- `frontend/src/routes/vehicles/[id]/insurance/` — term CRUD forms
- `frontend/src/lib/services/insurance-api.ts` — request/response types
- `frontend/src/lib/types/` — `InsurancePolicy` type changes, new `InsuranceTerm` type

### 9.2 Financing flow

The financing detail page now shows a computed balance (returned by the API). When balance ≤ 0.01,
a "Mark as paid off" button appears instead of the balance silently reaching zero.

**Files affected:**
- Financing detail component — show computed balance, add "Mark as paid off" button
- `frontend/src/lib/services/` — financing API response includes computed balance

### 9.3 Odometer history

The odometer history page shows entries from both sources (expenses + manual) with a source
indicator label. The API returns the UNION query result with a `source` field (`'expense'` or
`'manual'`). No functional UX change — just a label showing where each reading came from.

**Files affected:**
- Odometer history component — display `source` indicator
- `frontend/src/lib/types/` — `OdometerEntry` gains `source` field

### 9.4 Settings page

No visible change. The 2 settings tables are an implementation detail — the API can still
return/accept a single settings object and split it across tables internally. The frontend
types may not need to change at all if the API response shape is preserved.

### 9.5 Expense form

- `fuelAmount` field renamed to `volume` in types (may already be `volume` on the frontend —
  the API transformer currently bridges this). After migration, the transformer simplification
  means the field name matches end-to-end.
- `insurancePolicyId` field removed from expense types. `insuranceTermId` remains.

### 9.6 API transformer

The `api-transformer.ts` file simplifies:
- Remove `fuelAmount` ↔ `volume` bridging (names now match)
- Remove `insurancePolicyId` from expense transforms
- Update insurance policy/term type transforms for the new structure

---

## 10. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Data loss during migration | High | Pre-migration backup (existing pipeline). Transaction-wrapped migration — atomic rollback on failure. Post-migration validation queries (section 6.2 step 19). |
| JSON term extraction bugs | Medium | Comprehensive round-trip tests: known policy data → extract → verify term count, field values, junction rows. Test with edge cases: empty terms array, terms with null nested fields, unicode in text fields. |
| Photo `user_id` population misses orphaned photos | Medium | Post-migration validation: `SELECT COUNT(*) FROM photos WHERE user_id IS NULL` must be 0. If not, investigate which entity types have unresolved ownership. |
| Computed financing balance is slower than cached | Low | SUM over <100 rows is sub-ms in SQLite. Benchmark with worst-case data (vehicle with 500 monthly payments over 40 years = still sub-ms). |
| UNION view for odometer is slower than single table | Low | Both branches hit indexes. Paginated with LIMIT. The history page is low-frequency. |
| Insurance expense creation is less discoverable | Medium | UI prompt after term save. "Create expense" action on term detail. Onboarding tooltip for first-time users. |
| Partial unique index compatibility | Low | SQLite has supported partial indexes since 3.8.0 (2013). Bun bundles a modern SQLite. Verify with `PRAGMA compile_options`. |
| Drizzle migration history | Medium | Hard migration requires resetting or updating `__drizzle_migrations`. Follow the production considerations in the Database Migration SOP: insert the new migration hash manually. |
| Backup format version bump | Medium | Version field in metadata. Restore handles both v1 and v2 formats. Old backups remain importable. |
| Concurrent migration attempts | Low | SQLite's write lock prevents concurrent migrations. The transaction ensures only one writer. |
| `current_insurance_policy_id` derivation query | Low | Hits `it_policy_end_date_idx`. Runs only on vehicle detail (low frequency). Can be cached in analytics if needed. |
| Column rename breaks API consumers | Medium | The `fuel_amount` → `volume` rename affects the API response shape. Frontend already uses `volume` internally (transformer bridges it). External API consumers (if any) need migration. Coordinate with backup format version. |
| Odometer entry count drops after migration | Low | Expected — expense-linked entries are intentionally dropped since the data lives on `expenses.mileage`. Document this in release notes. The total odometer reading count visible to the user stays the same (UNION query includes expense mileage). |

---

## Appendix: Reference Documents

- `docs/db-access-patterns.md` — full audit of every read/write use case, query shapes, indexes,
  frequency estimates, and Big-O for the current (v1) schema
- `docs/proposal_db_1.md` — independent proposal focused on relational correctness and
  DB-enforced invariants (conservative approach, preserves odometer/financing hooks)
- `docs/proposal_db_2.md` — independent proposal focused on eliminating all cross-domain hooks
  via compute-on-read and explicit user actions (aggressive approach)
- `backend/src/db/schema.ts` — current v1 Drizzle schema definitions
- `backend/drizzle/` — current migration files
