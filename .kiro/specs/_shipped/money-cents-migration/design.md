# Money: float → integer cents — Design

> DRAFT — awaiting sign-off. Grounded against source by a 2-agent scoping fan-out (C146) + first-hand reads.

## §1 — The money columns (14, all currently `real` → become `integer` cents)

| Table.column | schema.ts | null? | notes |
|---|---|---|---|
| `vehicles.purchasePrice` | :47 | yes | |
| `vehicleFinancing.originalAmount` | :73 | no | |
| `vehicleFinancing.paymentAmount` | :78 | no | |
| `vehicleFinancing.residualValue` | :83 | yes | |
| `vehicleFinancing.excessMileageFee` | :85 | yes | per-mile fee, still money |
| `insuranceTerms.deductibleAmount` | :132 | yes | |
| `insuranceTerms.coverageLimit` | :133 | yes | a dollar cap, not a % |
| `insuranceTerms.totalCost` | :137 | yes | |
| `insuranceTerms.monthlyCost` | :138 | yes | |
| `insuranceTerms.paymentAmount` | :140 | yes | |
| `insuranceClaims.payoutAmount` | :186 | yes | |
| `expenses.expenseAmount` | :218 | no | **highest traffic** |
| `expenses.groupTotal` | :229 | yes | split parent total |
| `reminders.expenseAmount` | :455 | yes | materialization template |

EXCLUDED `real` columns (NOT money): `vehicleFinancing.apr` (:74, a %), `expenses.volume` (:219,
gallons/kWh). Split-allocation `percentage` + `ReminderSplitConfig` live in JSON `text`, not `real`.

## §2 — Conversion boundaries (where cents↔dollars crosses)

Money is cents EVERYWHERE internally; conversion happens at exactly two edges + the backup edge:

- **Client input edge (dollars→cents, once):** the Zod validators currently `z.number()` fractional
  dollars. Add a `.transform((d) => Math.round(d * 100))` (or a shared `dollarsToCents` refinement) at each
  money input: expenses/routes.ts:67, expenses/validation.ts:14/83/102, vehicles/routes.ts:79,
  financing/routes.ts:29/47/60/62, insurance/validation.ts:27/28/32/33/35/62/63/67/68/70.
- **Display edge (cents→dollars):** the API response boundary. Two options — convert in the route/transformer
  (so the FE contract stays dollars, smallest blast radius), OR send cents + convert in the FE formatter.
  **Recommend: convert at the API boundary** (cents→dollars in the response assembly / api-transformer) so
  the FE `Expense.amount` contract is unchanged and NO eyes-on FE work is required — keeping this feature
  fully backend + verifiable without Playwright. (A later eyes-on task can push cents to the FE if desired.)
- **Internal math now integer:** all the SUM/reduce/divide sites become integer-safe:
  - `expenses/repository.ts`: SUM(expenseAmount) (:395/457/467/478/489/495), computeMonthlyAverage (:145).
  - `analytics/repository.ts`: ytdSpending reduce (:1100/2010), TCO buckets (:1010-1032), financing
    (:744/793/805/863/1621), insurance amortization (:913-944/1699-1707), per-vehicle TCO (:1771-1847).
    NOTE: division results (costPerMile, costPerMonth, amortization, premium÷months) yield FRACTIONAL cents
    — these are computed/display values, NOT stored money, so they stay numbers; only round at the display
    edge. Keep them as integer-cents-in → number-out.
  - `split-service.ts`: becomes NATIVE cents — `computeAllocations` already rounds to cents internally
    (:34/58/60); drop the `/100` and store integer cents directly. This is the cleanest win.

## §3 — Migration mechanics (the safe pattern)

- **No table rebuild.** SQLite has dynamic typing + affinity; a `real`→`integer` declared-type change needs
  no `__new_` rebuild, and a value conversion touches no FKs — so the **0004 cascade footgun does NOT apply**
  (0004 needed a rebuild only because a NOT NULL→nullable change genuinely can't be ALTERed). This is the
  0003-style ADD/UPDATE class, not the 0004 rebuild class.
- **Hand-author the migration** (Drizzle would generate a rebuild from the schema type change). Per money
  column, in-place:
  ```sql
  UPDATE expenses SET expense_amount = CAST(ROUND(expense_amount * 100) AS INTEGER)
    WHERE expense_amount IS NOT NULL;
  ```
  `ROUND` BEFORE `CAST` is MANDATORY — `CAST(12.34*100 AS INTEGER)` = `1233` (binary float `1233.9999…`
  truncates). `WHERE … IS NOT NULL` preserves NULLs. The migrator wraps the file in one BEGIN…COMMIT
  (connection.ts:84), so partial conversion can't commit — all-or-nothing.
- **Idempotency hazard:** `UPDATE …*100` is NOT idempotent (re-running re-scales). The
  `__drizzle_migrations` ledger guards the normal path; the migration must never be hand-replayed. The
  migration test asserts a double-apply guard / documents this.
- Keep the Drizzle schema (`real`→`integer`) and a fresh-DB `CREATE` consistent with the live converted DB.

## §4 — THE data-safety hazard + mitigation (NORTH_STAR #1)

**Hazard:** an OLD float-dollars backup (CSV/Sheets, `metadata.version: '1.0.0'`, money written as `12.34`)
restored into the NEW cents schema → `coerceRow` (backup.ts:111) routes the now-`integer` column through
`Number.parseInt('12.34')` = `12` cents = **$0.12, a silent 100× corruption + fraction loss**.
`validateBackupData` (backup.ts:530) only checks `version === CONFIG.backup.currentVersion`; since both are
`'1.0.0'` today (config.ts:183), the old backup passes validation cleanly into corruption.

**Mitigation (ship BOTH — fail-safe default + recovery path):**
1. **Bump `CONFIG.backup.currentVersion`** `'1.0.0'` → `'2.0.0'` (config.ts:183) the moment the cents schema
   ships. A naive restore of a `1.0.0` backup now FAILS the version check (fail-closed) instead of
   corrupting — the safe default.
2. **Version-gated coercion shim** in the restore path: if `metadata.version` is pre-cents, multiply the
   money columns by 100 (ROUND) during restore so old backups round-trip CORRECTLY. Needs a **money-column
   allowlist** (the §1 list) because `coerceRow` is generic/dialect-driven — it can't tell a money `real`
   from `volume`/`apr`. The shim runs before/within coerceRow for those columns only.
3. **D2 export:** store + export cents integers; the cents schema's `coerceRow` `parseInt` path is then
   correct for a NEW (`2.0.0`) backup with no float in the pipeline.

## §5 — Test story

- **NEW `migration-00NN.test.ts`** (mirror migration-0004.test.ts harness — loadMigrations /
  applyMigrationsUpTo / seedCoreData / countRows, in-memory `foreign_keys=ON`): seed float-dollar rows
  (`12.34`, `0.01`, `999999.99`, `0`, NULL) → apply → assert exact cents (`1234`, `1`, `99999999`, `0`,
  NULL); pin the binary-float edges (`12.34`/`19.99`/`0.07`) to prove ROUND-before-CAST; assert
  row counts unchanged (proves no DROP/cascade — the explicit contrast with 0004); double-apply guard.
- **NEW `restore-money-version.test.ts`**: a `1.0.0` backup into cents schema → rejected by
  validateBackupData (or, with the shim, lands as cents); a `2.0.0` cents backup → full round-trip equality.
- **Existing money-math suites flip** to exact-integer assertions (they become the behavior-preserving net):
  calculations / amortization-schedule / effective-monthly-premium; analytics (per-vehicle, cross-vehicle,
  year-end, quick-stats, tco-*, fuel-stats, insurance-details, cross-cutting); financing-balance,
  premium-expense-hook; reminder-cost / recurring-cost-route / trigger-expense; backup / unified-restore.
  **Sweep `toBeCloseTo`/`toFixed(2)`** — under cents, exact assertions are now correct.

## §6 — Task sketch (full list in tasks.md)
T0 sign-off · T1 schema + hand-authored migration + migration test · T2 backup version bump + restore
shim + round-trip test · T3 input-edge Zod cents transform · T4 internal-math/repository/analytics cents
+ flip their tests · T5 split-service native-cents · T6 display-edge (API boundary cents→dollars) · T7
full-suite green sweep. Each T independently `validate:local`-gated; T1+T2 are the data-safety core.
