# Database Access Patterns (Updated Post-OAuth)

Comprehensive map of every read and write use case against the SQLite database, organized by domain.
Frequency estimates assume a single-user self-hosted app with 1–5 vehicles.

**Baseline:** This document reflects the current schema state after:
- The expense_groups → unified expenses table redesign (COMPLETE)
- The multi-provider OAuth spec (COMPLETE) — `user_providers` now has `providerAccountId`, `up_auth_identity_idx`, and auth-domain rows

---

## Table of Contents

1. [Users](#1-users)
2. [Sessions](#2-sessions)
3. [Vehicles](#3-vehicles)
4. [Expenses](#4-expenses)
5. [Vehicle Financing](#5-vehicle-financing)
6. [Insurance Policies](#6-insurance-policies)
7. [Insurance Policy Vehicles (Junction)](#7-insurance-policy-vehicles-junction)
8. [Odometer Entries](#8-odometer-entries)
9. [User Settings](#9-user-settings)
10. [User Providers](#10-user-providers)
11. [Photos](#11-photos)
12. [Photo Refs](#12-photo-refs)
13. [Analytics (Read-Only Aggregations)](#13-analytics-read-only-aggregations)
14. [Backup & Restore](#14-backup--restore)
15. [Cross-Domain Hooks](#15-cross-domain-hooks)
16. [Summary Matrix](#16-summary-matrix)

---

## 1. Users

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by email (OAuth callback — legacy user check) | READ | `users` | `WHERE email = ?` LIMIT 1 | `users.email` (unique) | Low — on login when no auth row found | O(1) |
| Create user (first OAuth login) | WRITE | `users` | `INSERT` (inside transaction with auth provider row) | — | Very low — once per user | O(1) |
| Find by ID (session validation) | READ | `users` | `WHERE id = ?` LIMIT 1 | PK | High — every authenticated request (via Lucia) | O(1) |
| Update profile on login | WRITE | `users` | `UPDATE SET email, display_name, updated_at WHERE id = ?` | PK | Low — on each OAuth login (updates from provider) | O(1) |


## 2. Sessions

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Validate session | READ | `sessions` + `users` | Lucia adapter: `WHERE id = ?` + user lookup | PK on both | High — every authenticated request | O(1) |
| Create session (OAuth login) | WRITE | `sessions` | `INSERT` | — | Low — on login | O(1) |
| Invalidate session (logout/refresh) | WRITE | `sessions` | `DELETE WHERE id = ?` | PK | Low — on logout or session refresh | O(1) |
| Invalidate all user sessions | WRITE | `sessions` | `DELETE WHERE user_id = ?` | FK index | Very low — account action | O(S) S=active sessions |

---

## 3. Vehicles

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| List user vehicles (with financing) | READ | `vehicles` LEFT JOIN `vehicle_financing` | `WHERE userId = ?` ORDER BY createdAt | `vehicles_user_id_idx` | Medium — dashboard, dropdowns | O(V) V=vehicles |
| Find by ID + user (ownership check) | READ | `vehicles` LEFT JOIN `vehicle_financing` | `WHERE id = ? AND userId = ?` LIMIT 1 | PK + `vehicles_user_id_idx` | Medium — detail views, pre-mutation checks | O(1) |
| Find by ID only | READ | `vehicles` | `WHERE id = ?` LIMIT 1 | PK | Medium — internal lookups | O(1) |
| Find by license plate | READ | `vehicles` | `WHERE license_plate = ?` LIMIT 1 | Full scan (no index) | Very low — uniqueness check on create | O(V) |
| Create vehicle | WRITE | `vehicles` | `INSERT ... RETURNING` | — | Low — a few per user lifetime | O(1) |
| Update vehicle | WRITE | `vehicles` | `UPDATE WHERE id = ? RETURNING` | PK | Low — occasional edits | O(1) |
| Update mileage | WRITE | `vehicles` | `UPDATE SET initial_mileage WHERE id = ?` | PK | Low — manual mileage correction | O(1) |
| Delete vehicle | WRITE | `vehicles` | `DELETE WHERE id = ? RETURNING` | PK | Very low — rare | O(1) + cascades |
| Update currentInsurancePolicyId | WRITE | `vehicles` | `UPDATE SET current_insurance_policy_id WHERE id = ?` | PK | Low — insurance policy create/update | O(1) |

---

## 4. Expenses

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by ID + userId | READ | `expenses` | `WHERE id = ? AND userId = ?` LIMIT 1 | PK | High — detail view, pre-mutation | O(1) |
| List paginated (filtered) | READ | `expenses` | `WHERE userId = ? [AND vehicleId/category/date/tags] ORDER BY date DESC LIMIT/OFFSET` + `COUNT(*)` | `expenses_user_date_idx`, `expenses_user_category_date_idx` | High — expense list page | O(log E + P) E=total expenses, P=page size |
| List all (filtered, no pagination) | READ | `expenses` | `WHERE userId = ? [AND vehicleId] [AND date range]` | `expenses_user_date_idx` | Medium — analytics data fetch | O(E_filtered) |
| Total by category | READ | `expenses` | `SUM(expense_amount) GROUP BY category WHERE vehicleId = ? [AND date range]` | `expenses_vehicle_category_date_idx` | Medium — vehicle detail charts | O(E_vehicle) |
| Monthly totals | READ | `expenses` | `SUM(expense_amount) GROUP BY month WHERE vehicleId = ? AND year` | `expenses_vehicle_date_idx` | Medium — monthly chart | O(E_vehicle_year) |
| Per-vehicle stats | READ | `expenses` | `SUM, MAX GROUP BY vehicleId WHERE userId = ?` | `expenses_user_date_idx` | Medium — dashboard cards | O(E_user) |
| Summary (4 parallel queries) | READ | `expenses` | `SUM + COUNT`, `GROUP BY category`, `GROUP BY month`, `SUM (recent 30d)` | `expenses_user_date_idx`, `expenses_user_category_date_idx` | Medium — expense summary page | O(E_filtered) per query |
| Find financing expenses by vehicle | READ | `expenses` | `WHERE vehicleId = ? AND isFinancingPayment = true` | `expenses_vehicle_date_idx` | Low — financing detail | O(E_vehicle) |
| Find split siblings by groupId | READ | `expenses` | `WHERE groupId = ? AND userId = ?` | `expenses_group_idx` | Low — split expense view/edit | O(S) S=siblings (2-5) |
| Create single expense | WRITE | `expenses` | `INSERT ... RETURNING` | — | High — primary user action | O(1) |
| Batch create (split siblings) | WRITE | `expenses` | N × `INSERT ... RETURNING` inside transaction | — | Low — split expense creation | O(N) N=vehicles in split |
| Create split expense | WRITE | `expenses` + `vehicles` | Transaction: validate ownership + N inserts | — | Low — split creation | O(N) |
| Update expense | WRITE | `expenses` | `UPDATE WHERE id = ? RETURNING` | PK | Medium — edits | O(1) |
| Update split expense | WRITE | `expenses` + `photos` | Transaction: SELECT siblings → SELECT photos → DELETE old → INSERT new → UPDATE photo entityId | `expenses_group_idx`, PK | Low — split re-allocation | O(N) |
| Delete expense | WRITE | `expenses` | `DELETE WHERE id = ? RETURNING` | PK | Low | O(1) + hook cascades |
| Delete split expense | WRITE | `expenses` + `photos` + `odometer_entries` | Transaction: find siblings → delete photos → delete odometer → delete expenses | `expenses_group_idx` | Very low | O(N) |

**Note:** The expenses table now has `userId` directly (from the expense_groups unification), `groupId`/`groupTotal`/`splitMethod` for split expenses, and still uses `fuel_amount` (to be renamed to `volume` in v2). The `insurancePolicyId` and `insuranceTermId` columns are both plain text with no FK constraints (to be fixed in v2).

---

## 5. Vehicle Financing

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by vehicle ID | READ | `vehicle_financing` | `WHERE vehicleId = ?` LIMIT 1 | `vf_vehicle_id_idx` | Medium — vehicle detail, financing hooks | O(1) |
| Find by ID | READ | `vehicle_financing` | `WHERE id = ?` LIMIT 1 | PK | Low — detail view | O(1) |
| Find all active | READ | `vehicle_financing` | `WHERE isActive = true ORDER BY startDate` | Full scan (small table) | Low — financing overview | O(F) F=financing rows |
| Create financing | WRITE | `vehicle_financing` | `INSERT ... RETURNING` | — | Very low — once per vehicle loan/lease | O(1) |
| Update financing | WRITE | `vehicle_financing` | `UPDATE WHERE id = ? RETURNING` | PK | Low — manual edits | O(1) |
| Update balance (hook) | WRITE | `vehicle_financing` | `UPDATE SET currentBalance WHERE id = ?` | PK | Medium — triggered on every financing expense create/update/delete | O(1) |
| Mark as completed (hook) | WRITE | `vehicle_financing` | `UPDATE SET isActive=false, currentBalance=0, endDate WHERE id = ?` | PK | Very low — loan payoff | O(1) |
| Delete financing | WRITE | `vehicle_financing` | `DELETE WHERE id = ? RETURNING` | PK | Very low | O(1) |

---

## 6. Insurance Policies

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by ID (with vehicle IDs) | READ | `insurance_policies` + `insurance_policy_vehicles` | `WHERE id = ?` LIMIT 1 + junction query | PK, `ipv_vehicle_policy_idx` | Low — detail view | O(1 + J) J=junction rows |
| Find by user ID | READ | `insurance_policies` + `insurance_policy_vehicles` | `WHERE userId = ?` + junction per policy | `insurance_policies_user_id_idx` | Low — insurance list | O(P + J) P=policies |
| Find by vehicle ID | READ | `insurance_policies` + `insurance_policy_vehicles` | Junction `WHERE vehicleId = ?` → policy lookups | `ipv_vehicle_policy_idx` | Low — vehicle detail | O(J + P_matched) |
| Find expiring policies | READ | `insurance_policies` | `WHERE isActive AND currentTermEnd BETWEEN ? AND ?` | Full scan (small table) | Very low — background check | O(P) |
| Create policy | WRITE | `insurance_policies` + `insurance_policy_vehicles` + `expenses` + `vehicles` | Transaction: validate ownership → insert policy → insert junction rows → create expense splits → sync vehicle refs | — | Very low — 1-3 policies per user | O(T × V) T=terms, V=vehicles per term |
| Update policy | WRITE | `insurance_policies` + `vehicles` | Transaction: fetch → update → sync vehicle refs if isActive changed | PK | Very low | O(V) |
| Add term | WRITE | `insurance_policies` + `insurance_policy_vehicles` + `expenses` + `vehicles` | Transaction: fetch → validate → append term JSON → insert junction → create expenses → sync refs | PK | Very low — 1-2 renewals/year | O(V) |
| Update term | WRITE | `insurance_policies` + `insurance_policy_vehicles` + `expenses` + `vehicles` | Transaction: fetch → update term JSON → handle coverage changes → sync expenses → clear removed refs | PK | Very low | O(V) |
| Delete term | WRITE | `insurance_policies` + `insurance_policy_vehicles` + `expenses` + `vehicles` | Transaction: fetch → remove term → delete junction rows → delete linked expenses → clear refs | PK | Very low | O(V + E_term) |
| Delete policy | WRITE | `insurance_policies` + `vehicles` | Transaction: clear vehicle refs → delete policy (junction cascades via FK) | PK | Very low | O(V) |

---

## 7. Insurance Policy Vehicles (Junction)

This table is never accessed directly by routes — it's managed within `InsurancePolicyRepository` transactions and read by analytics.

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Get vehicle IDs for policy | READ | `insurance_policy_vehicles` | `WHERE policyId = ?` | PK composite | Low — within insurance repo | O(J) |
| Get term-vehicle coverage | READ | `insurance_policy_vehicles` | `WHERE policyId = ?` | PK composite | Low — within insurance repo | O(J) |
| Insert junction rows | WRITE | `insurance_policy_vehicles` | N × `INSERT` | — | Very low — term create/update | O(V) |
| Delete by policy+term | WRITE | `insurance_policy_vehicles` | `DELETE WHERE policyId = ? AND termId = ?` | PK composite | Very low — term update/delete | O(J_term) |

---

## 8. Odometer Entries

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| List by vehicle (paginated) | READ | `odometer_entries` | `WHERE vehicleId = ? ORDER BY recordedAt DESC LIMIT/OFFSET` + `COUNT(*)` | `odometer_vehicle_date_idx` | Medium — odometer history page | O(log O + P) |
| Find by ID | READ | `odometer_entries` | `WHERE id = ?` LIMIT 1 | PK | Low — detail/pre-mutation | O(1) |
| Find by linked entity | READ | `odometer_entries` | `WHERE linkedEntityType = ? AND linkedEntityId = ?` LIMIT 1 | `odometer_linked_entity_idx` | Medium — expense hooks (upsert check) | O(1) |
| Create entry | WRITE | `odometer_entries` | `INSERT ... RETURNING` | — | Medium — manual entry or expense hook | O(1) |
| Upsert from linked entity | WRITE | `odometer_entries` | Find by linked entity → INSERT or UPDATE | `odometer_linked_entity_idx`, PK | Medium — expense create/update hook | O(1) |
| Update entry | WRITE | `odometer_entries` | `UPDATE WHERE id = ? RETURNING` | PK | Low — manual edit | O(1) |
| Delete entry | WRITE | `odometer_entries` | `DELETE WHERE id = ? RETURNING` | PK | Low — manual delete | O(1) |
| Delete by linked entity | WRITE | `odometer_entries` | `DELETE WHERE linkedEntityType = ? AND linkedEntityId = ?` | `odometer_linked_entity_idx` | Medium — expense delete hook | O(1) |

---

## 9. User Settings

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Get by user ID | READ | `user_settings` | `WHERE userId = ?` LIMIT 1 | `user_settings.userId` (unique) | High — settings page, analytics (unit prefs), sync checks | O(1) |
| Get or create (upsert) | READ+WRITE | `user_settings` | SELECT → conditional INSERT | unique index | Medium — first access creates defaults | O(1) |
| Update settings | WRITE | `user_settings` | `UPDATE SET ... WHERE userId = ?` | unique index | Low — settings page save | O(1) |
| Update sync date | WRITE | `user_settings` | `UPDATE SET lastSyncDate WHERE userId = ?` | unique index | Low — after backup completes | O(1) |
| Update backup config | WRITE | `user_settings` | `UPDATE SET backupConfig WHERE userId = ?` | unique index | Very low — provider config changes | O(1) |
| Mark data changed | WRITE | `user_settings` | `UPDATE SET lastDataChangeDate WHERE userId = ?` | unique index | High — activity tracker on every data mutation | O(1) |
| Check changes since last sync | READ | `user_settings` | `WHERE userId = ?` LIMIT 1, compare dates | unique index | Low — auto-sync inactivity check | O(1) |
| Read storage config | READ | `user_settings` | `SELECT storageConfig WHERE userId = ?` LIMIT 1 | unique index | Medium — every photo upload/download (provider resolution) | O(1) |
| Update storage config | WRITE | `user_settings` | `UPDATE SET storageConfig WHERE userId = ?` | unique index | Very low — provider deletion cleanup | O(1) |


---

## 10. User Providers

The `user_providers` table now serves two domains: **auth** (OAuth identity links) and **storage** (Google Drive, S3 connections). The multi-provider OAuth spec added `provider_account_id` and a partial unique index `up_auth_identity_idx` on `(provider_type, provider_account_id) WHERE domain = 'auth'`.

### Auth Domain (`domain = 'auth'`)

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by provider identity (login) | READ | `user_providers` | `WHERE domain = 'auth' AND providerType = ? AND providerAccountId = ?` LIMIT 1 | `up_auth_identity_idx` (partial unique) | Low — on each OAuth login | O(1) |
| Find auth providers by userId | READ | `user_providers` | `WHERE userId = ? AND domain = 'auth'` ORDER BY createdAt | `up_user_domain_idx` | Low — profile settings page | O(A) A=auth providers (1-3) |
| Count auth providers by userId | READ | `user_providers` | `COUNT(*) WHERE userId = ? AND domain = 'auth'` | `up_user_domain_idx` | Low — unlink safety guard | O(A) |
| Create auth provider row | WRITE | `user_providers` | `INSERT ... RETURNING` (credentials='', config={email, avatarUrl}) | — | Very low — first login or account link | O(1) |
| Update auth profile on login | WRITE | `user_providers` | `UPDATE SET config, displayName, updatedAt WHERE id = ? AND userId = ? AND domain = 'auth'` | PK | Low — on each OAuth login | O(1) |
| Delete auth provider (unlink) | WRITE | `user_providers` | `DELETE WHERE id = ? AND userId = ? AND domain = 'auth'` (inside transaction with count check) | PK | Very low — manual unlink | O(1) |

### Storage Domain (`domain = 'storage'`)

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by ID + userId | READ | `user_providers` | `WHERE id = ? AND userId = ?` LIMIT 1 | PK + `up_user_domain_idx` | Medium — provider resolution for photo ops | O(1) |
| Find by ID (internal, no ownership) | READ | `user_providers` | `WHERE id = ?` LIMIT 1 | PK | Low — sync worker | O(1) |
| List by user + domain | READ | `user_providers` | `WHERE userId = ? AND domain = 'storage'` | `up_user_domain_idx` | Low — settings UI, provider list | O(Pr) Pr=storage providers (1-3) |
| Create storage provider | WRITE | `user_providers` | `INSERT ... RETURNING` | — | Very low — initial setup | O(1) |
| Update storage provider | WRITE | `user_providers` | `UPDATE WHERE id = ? RETURNING` | PK | Very low — credential refresh | O(1) |
| Delete storage provider | WRITE | `user_providers` | `DELETE WHERE id = ? RETURNING` (with domain guard: rejects auth rows) | PK | Very low — provider removal | O(1) |

### Domain Guard

The existing provider CRUD routes (`DELETE /api/v1/providers/:id`, `PUT /api/v1/providers/:id`) check `domain !== 'auth'` before proceeding. Auth-domain rows can only be modified through the auth routes (`DELETE /auth/accounts/:id`).

---

## 11. Photos

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find by entity (ordered) | READ | `photos` | `WHERE entityType = ? AND entityId = ? ORDER BY sortOrder, createdAt` | `photos_entity_idx` | Medium — entity detail pages | O(Ph) Ph=photos per entity |
| Find by entity (paginated) | READ | `photos` | Same + `COUNT(*)` + `LIMIT/OFFSET` | `photos_entity_idx` | Medium — photo gallery | O(log Ph + P) |
| Find by ID | READ | `photos` | `WHERE id = ?` LIMIT 1 | PK | Medium — download, cover set, delete | O(1) |
| Find cover photo | READ | `photos` | `WHERE entityType = ? AND entityId = ? AND isCover = true` LIMIT 1 | `photos_entity_idx` | Medium — entity cards | O(Ph) |
| Count user photos (by entity type) | READ | `photos` JOIN entity tables | `COUNT(*)` with 4-branch ownership join (vehicle→user, expense→user, policy→junction→vehicle→user, odometer→vehicle→user) | `photos_entity_idx` + entity indexes | Low — provider stats | O(Ph_type) |
| Find user photo IDs (by entity type) | READ | `photos` JOIN entity tables | `SELECT id` with same 4-branch ownership join | `photos_entity_idx` + entity indexes | Very low — provider deletion cascade | O(Ph_type) |
| Create photo | WRITE | `photos` | `INSERT ... RETURNING` | — | Medium — photo upload | O(1) |
| Set cover photo | WRITE | `photos` | Transaction: `UPDATE SET isCover=false WHERE entity` → `UPDATE SET isCover=true WHERE id` | `photos_entity_idx`, PK | Low — user action | O(Ph) |
| Delete photo | WRITE | `photos` | `DELETE WHERE id = ?` | PK | Low | O(1) |
| Delete by entity | WRITE | `photos` | `DELETE WHERE entityType = ? AND entityId = ?` | `photos_entity_idx` | Low — entity cascade delete | O(Ph) |
| Migrate photos (split update) | WRITE | `photos` | `UPDATE SET entityId WHERE id IN (...)` | PK | Very low — split expense re-allocation | O(Ph) |

**Note:** The `photos` table currently has NO `user_id` column. User-scoped queries require multi-branch JOINs through entity tables (4 branches: vehicle, expense, insurance_policy, odometer_entry). This is the primary motivation for adding `user_id` in v2.

---

## 12. Photo Refs

| Operation | Type | Tables | Query Shape | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|---|
| Find active by photo + provider | READ | `photo_refs` | `WHERE photoId = ? AND providerId = ? AND status = 'active'` LIMIT 1 | `pr_photo_provider_idx` (unique) | Medium — photo download (default provider) | O(1) |
| Find active by photo (fallback) | READ | `photo_refs` | `WHERE photoId = ? AND status = 'active' ORDER BY syncedAt DESC` LIMIT 1 | `pr_photo_provider_idx` partial | Medium — photo download fallback | O(R) R=refs per photo (1-3) |
| Find all by photo | READ | `photo_refs` | `WHERE photoId = ?` | `pr_photo_provider_idx` partial | Low — photo delete (cleanup) | O(R) |
| Find all by photos (batch) | READ | `photo_refs` | `WHERE photoId IN (...)` batched 500 | `pr_photo_provider_idx` partial | Low — entity cascade delete | O(Ph × R) |
| Find pending or failed | READ | `photo_refs` | `WHERE status IN ('pending','failed') AND retryCount < 3 ORDER BY createdAt LIMIT ?` | `pr_pending_idx` | Low — sync worker poll | O(min(limit, pending)) |
| Count by provider + category | READ | `photo_refs` JOIN `photos` | `COUNT(*) WHERE providerId = ? AND status = 'active' AND entityType IN (...)` | `pr_photo_provider_idx`, `photos_entity_idx` | Very low — provider stats | O(R_provider) |
| Create ref | WRITE | `photo_refs` | `INSERT ... RETURNING` | — | Medium — photo upload (1 active + N pending for backups) | O(1) |
| Update status | WRITE | `photo_refs` | `UPDATE SET status, storageRef, ... WHERE id = ?` | PK | Low — sync worker completion | O(1) |
| Delete by provider | WRITE | `photo_refs` | `DELETE WHERE providerId = ?` | index on providerId (via unique composite) | Very low — provider deletion | O(R_provider) |
| Delete by photo | WRITE | `photo_refs` | `DELETE WHERE photoId = ?` | `pr_photo_provider_idx` partial | Low — photo deletion | O(R) |
| Delete by photos (batch) | WRITE | `photo_refs` | `DELETE WHERE photoId IN (...)` batched 500 | `pr_photo_provider_idx` partial | Low — entity cascade | O(Ph × R) |

**Note:** The `pr_pending_idx` is currently a standard index on `status` only. In v2, it becomes a partial index on `(status, created_at) WHERE status IN ('pending', 'failed') AND retry_count < 3` to exactly match the sync worker's poll query predicate.

---

## 13. Analytics (Read-Only Aggregations)

All analytics operations are reads. They compose the private query helpers (`queryFuelExpenses`, `queryAllExpenses`, `queryFuelAggregates`, `queryVehicleNameMap`, `queryTotalSpending`, `queryActivePolicyIds`) and do in-memory computation on the results.

| Endpoint | Tables Read | Query Pattern | Index Used | Frequency | Big-O |
|---|---|---|---|---|---|
| Quick Stats | `vehicles`, `expenses`, `user_settings` | Vehicle count + all expenses in range + fuel expenses in range + user units + vehicle units | `vehicles_user_id_idx`, `expenses_user_date_idx`, `user_settings.userId` | Medium — dashboard load | O(V + E_range) |
| Fuel Stats | `expenses`, `vehicles`, `user_settings` | Fuel expenses in range + fuel aggregates (COUNT, SUM) for current and previous period + vehicle names | `expenses_user_category_date_idx` | Low — analytics tab | O(E_fuel_range) |
| Fuel Advanced | `expenses`, `vehicles`, `user_settings` | Fuel expenses + all expenses in range + vehicle names | `expenses_user_date_idx`, `expenses_user_category_date_idx` | Low — analytics tab | O(E_range) |
| Cross-Vehicle | `expenses`, `vehicles`, `user_settings` | All expenses + fuel expenses in range + vehicle names + unit prefs | `expenses_user_date_idx` | Low — analytics tab | O(E_range + V) |
| Fuel Efficiency Trend | `expenses`, `vehicles`, `user_settings` | Fuel expenses (all time or range) + vehicle units | `expenses_user_category_date_idx` | Low — chart data | O(E_fuel) |
| Financing | `vehicle_financing`, `vehicles` | All financing rows for user's vehicles + vehicle names | `vf_vehicle_id_idx`, `vehicles_user_id_idx` | Low — financing tab | O(V + F) |
| Insurance | `insurance_policies`, `insurance_policy_vehicles`, `vehicles` | Policies by userId + junction rows for those policies + vehicle names. Terms parsed from JSON in-memory. | `insurance_policies_user_id_idx`, PK composite | Low — insurance tab | O(P + J + V) |
| Vehicle Health | `vehicles`, `expenses`, `insurance_policies` | Vehicle lookup + maintenance expenses for vehicle + active policy check via `current_insurance_policy_id` | PK, `expenses_vehicle_category_date_idx` | Low — vehicle detail | O(E_maintenance) |
| Vehicle TCO | `vehicles`, `expenses` | Vehicle lookup + all expenses for vehicle optionally filtered by year | PK, `expenses_vehicle_date_idx` | Low — vehicle detail | O(E_vehicle) |
| Vehicle Expenses | `expenses` | All expenses for vehicle in range (reuses queryAllExpenses) | `expenses_user_date_idx` | Low — vehicle detail | O(E_vehicle_range) |
| Year-End | `expenses`, `vehicles`, `user_settings` | All expenses for year + fuel expenses for year + previous year total spending + vehicle names + units | `expenses_user_date_idx` | Very low — once per year | O(E_year + V) |
| Summary (composite) | `vehicles`, `expenses`, `user_settings` | Combines Quick Stats + Fuel Stats + Fuel Advanced in one call (7 parallel queries) | All expense/vehicle indexes | Medium — analytics page initial load | O(V + E_range) |

### Analytics Caching

The `AnalyticsRepository` maintains an in-memory LRU cache for vehicle name maps (`Map<vehicleId, displayName>`). Cache entries expire after a configurable TTL. Single-vehicle lookups can be satisfied from the all-vehicles cache without a DB round-trip.

---

## 14. Backup & Restore

### Backup (Read-Heavy)

| Operation | Type | Tables | Query Shape | Frequency | Big-O |
|---|---|---|---|---|---|
| Create backup | READ | `vehicles`, `expenses`, `vehicle_financing` JOIN `vehicles`, `insurance_policies`, `odometer_entries` JOIN `vehicles`, `insurance_policy_vehicles`, `photos`, `photo_refs` | 5 parallel full-table scans scoped by userId, then junction + photo queries | Low — manual or auto-sync (inactivity timer) | O(V + E + F + P + O + J + Ph + R) |
| Export as ZIP | READ | Same as above + CSV serialization | Same queries + in-memory CSV conversion | Very low — manual export | Same |
| Load backup config | READ | `user_settings` | `WHERE userId = ?` | Low — before backup | O(1) |

### Restore (Write-Heavy)

| Operation | Type | Tables | Query Shape | Frequency | Big-O |
|---|---|---|---|---|---|
| Delete user data | WRITE | `expenses`, `vehicles`, `vehicle_financing`, `insurance_policies`, `odometer_entries`, `photos` | Collect IDs → cascade delete photos by entity type → delete expenses → delete odometer → delete financing → delete insurance → delete vehicles | Very low — restore operation | O(E + V + F + P + O + Ph) |
| Insert backup data | WRITE | `vehicles`, `expenses`, `odometer_entries`, `vehicle_financing`, `insurance_policies`, `insurance_policy_vehicles`, `photos`, `photo_refs` | Ordered bulk inserts respecting FK constraints. Photo refs filtered against existing providers. | Very low — restore operation | O(V + E + O + F + P + J + Ph + R) |
| Detect conflicts | READ | `vehicles` | `WHERE userId = ?` to check existing data | Very low — pre-restore check | O(V) |

**Note:** `user_providers` is intentionally NOT included in backup/restore. Storage provider rows contain instance-specific encrypted credentials. Auth provider rows are recreated automatically on next OAuth login.

---

## 15. Cross-Domain Hooks

These are side-effect chains triggered by expense CRUD operations. They don't introduce new query patterns but compose existing repository methods.

### Expense → Odometer (odometer hooks)

| Trigger | Effect | DB Operations |
|---|---|---|
| Expense created (mileage ≠ null) | Create linked odometer entry | `odometerRepository.upsertFromLinkedEntity` → find by linked entity + insert/update |
| Expense updated (mileage transitions: null→value, value→null, value→value) | Create, update, or delete linked entry | `upsertFromLinkedEntity` or `deleteByLinkedEntity` |
| Expense deleted (mileage ≠ null) | Delete linked odometer entry | `odometerRepository.deleteByLinkedEntity` |

### Expense → Financing (financing hooks)

| Trigger | Effect | DB Operations |
|---|---|---|
| Financing expense created | Subtract from balance, auto-complete if ≤ 0.01 (loans only, not leases) | `financingRepository.findByVehicleId` → `updateBalance` → optional `markAsCompleted` |
| Financing expense deleted | Add back to balance, reactivate if was auto-completed | `findByVehicleId` → `updateBalance` → optional `update(isActive=true)` |
| Financing expense updated (amount/flag change) | Compute delta based on was-financing/is-financing transition, adjust balance | `findByVehicleId` → `updateBalance` → `syncFinancingStatus` |

### Insurance → Expenses (within insurance repository)

| Trigger | Effect | DB Operations |
|---|---|---|
| Policy term created with totalCost | Create split expense siblings across covered vehicles | `expenseSplitService.createSiblings` (N inserts in transaction) |
| Policy term updated with coverage changes | Sync expenses: delete old siblings + create new splits | Delete old expenses → create new siblings |
| Policy term deleted | Delete linked expense siblings | `DELETE FROM expenses WHERE insurancePolicyId = ? AND insuranceTermId = ?` |

### Activity Tracking (middleware)

| Trigger | Effect | DB Operations |
|---|---|---|
| Any data mutation (POST/PUT/DELETE) | Mark data changed | `UPDATE user_settings SET lastDataChangeDate, updatedAt WHERE userId = ?` |
| Inactivity timeout | Check if sync needed | `SELECT lastDataChangeDate, lastSyncDate FROM user_settings WHERE userId = ?` |
| Auto-backup triggered | Look up user for backup | `SELECT FROM users WHERE id = ?` |

---

## 16. Summary Matrix

Frequency legend: **VL** = Very Low (setup/rare), **L** = Low (weekly), **M** = Medium (daily), **H** = High (every page load / every request)

| Table | Read Freq | Write Freq | Hot Indexes | Notes |
|---|---|---|---|---|
| `users` | H (session validation) | VL (first login) + L (profile update on OAuth login) | PK, `email` unique | Tiny table, always cached by Lucia. Profile updated on each OAuth login. |
| `sessions` | H (every request) | L (login/refresh) | PK | Managed by Lucia adapter |
| `vehicles` | M-H (dashboard, dropdowns, analytics) | VL (create/edit) | PK, `vehicles_user_id_idx` | Small table (1-5 rows per user). Still has `current_insurance_policy_id` (to be removed in v2). |
| `expenses` | H (list, analytics, summaries) | M-H (primary user action) | `expenses_user_date_idx`, `expenses_user_category_date_idx`, `expenses_vehicle_date_idx`, `expenses_group_idx` | Largest table, most indexed. Has `userId` directly (post expense_groups unification). Still uses `fuel_amount` (to be renamed `volume` in v2). |
| `vehicle_financing` | M (vehicle detail, hooks) | L (balance updates via hooks) | PK, `vf_vehicle_id_idx` | Small table (0-5 rows). `currentBalance` updated on every financing expense via hooks. No partial unique index yet (to be added in v2). |
| `insurance_policies` | L (insurance tab, analytics) | VL (create/renew) | PK, `insurance_policies_user_id_idx` | Small table. Terms stored as JSON column. Complex transactional writes with junction + expense side effects. |
| `insurance_policy_vehicles` | L (insurance reads, analytics) | VL (term create/update) | PK composite, `ipv_vehicle_policy_idx` | Junction table with triple PK (policyId, termId, vehicleId). `termId` references JSON blob with no FK integrity. |
| `odometer_entries` | M (history page) | M (expense hooks + manual) | `odometer_vehicle_date_idx`, `odometer_linked_entity_idx` | Grows with expenses due to hooks. `linked_entity_type`/`linked_entity_id` used by hooks only. |
| `user_settings` | H (unit prefs, storage config, sync checks) | M (data change tracking) | `userId` unique | Single row per user. `lastDataChangeDate` updated on every mutation via activity tracker. Mixed read-heavy (prefs) and write-heavy (sync timestamps) concerns. |
| `user_providers` | M (photo upload/download provider resolution) + L (auth login/link) | VL (setup) + L (auth profile updates on login) | PK, `up_user_domain_idx`, `up_auth_identity_idx` (partial unique) | Dual-domain table: auth rows (OAuth identities, 1-3 per user) + storage rows (Drive/S3, 1-3 per user). Auth rows have `providerAccountId`; storage rows have NULL. Domain guard prevents cross-domain mutations. |
| `photos` | M (entity detail pages, galleries) | M (photo uploads) | `photos_entity_idx` | Polymorphic via entityType + entityId. No `user_id` column — ownership requires multi-branch JOINs (to be fixed in v2). |
| `photo_refs` | M (photo download, sync worker) | M (upload creates refs, sync worker updates) | `pr_photo_provider_idx` (unique), `pr_pending_idx` | 1-3 refs per photo (one per provider). `pr_pending_idx` is a standard index on `status` only (to become partial index in v2). |
