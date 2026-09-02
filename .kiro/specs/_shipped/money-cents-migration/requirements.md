# Money: float → integer cents — Requirements

> **STATUS: DRAFT — awaiting Angelo sign-off (D1–D5 below).** Per `loop/BACKLOG.md` arch rule 6, a
> money-type migration is a DIRECTION call: this spec is drafted, escalated, and BUILD-BLOCKED on T0
> until the open decisions are ratified. Drafted C146 from a 2-agent scoping fan-out (verified vs source).

## Why (the problem)

VROOM stores **every monetary value as a SQLite `real` (binary float)** — 14 columns across 6 tables
(see design §1). Binary floats can't represent most decimal cents exactly (`0.1 + 0.2 === 0.30000000000000004`),
so money silently drifts wherever amounts are **summed, divided, or compared**:

- **TCO + dashboard totals** reduce hundreds of `expenseAmount` rows (`analytics/repository.ts` ytdSpending,
  TCO category buckets) — accumulated float error shows as off-by-a-cent (or worse) headline figures.
- **Split allocations** must hit the group total exactly. `split-service.ts` ALREADY works around float by
  computing in cents internally (`Math.round(total*100)` → `/100`, lines 34/58/60) — then stores the result
  back as a float, re-introducing the very drift it just dodged. The code already *wants* cents storage.
- **Amortization + premium math** divide/accumulate balances over many months — float error compounds.

This is NORTH_STAR's named horizon item ("float→integer-cents money migration"). It is also the **one
horizon feature buildable WITHOUT Playwright** — a backend money-type migration is fully verifiable via
`validate:local` (tsc + bun test + migration test), so it breaks the loop's eyes-on logjam (all three
in-flight features are stuck at eyes-on-blocked frontend tails).

## What "good" looks like

1. **Cents are the storage + transport reality.** Money columns become `integer` minor units (cents). The
   amount-handling helpers think in integers; dollars exist only at the display edge (FE format) and the
   client-input edge (parse `12.34` → `1234` once, at the Zod boundary).
2. **No precision loss on the existing data.** The migration converts every stored float-dollar to its
   exact cent value (`ROUND(x*100)`, never a bare truncating `CAST`), preserving NULLs and zeros.
3. **DATA SAFETY IS SACRED (NORTH_STAR #1 — the load-bearing requirement).** A backup taken under the OLD
   float-dollars schema must NEVER silently corrupt when restored into the cents schema. Today a `12.34`
   would route through `coerceRow`'s `parseInt` → `12` cents ($0.12) — a silent **100× under-statement**,
   and `validateBackupData` would NOT catch it (it only compares an unchanged version string `'1.0.0'`).
   The migration MUST make this fail-closed (reject) or correctly version-coerce (×100 on restore).
   *(This aligns with the C144.5 ARCC SAX-04 grounding: fail-closed on ambiguous/unsafe input, never
   fail-open into a silent corruption.)*
4. **Behavior-preserving for the user.** Same displayed dollars before and after (modulo the *correction* of
   prior float drift). Every existing money-math test flips to exact-integer assertions and stays green.
5. **Regression-proof.** A migration test (mirroring `migration-0004.test.ts`) proves old rows convert
   correctly + a backup round-trips; the existing money-math suites become the behavior-preserving net.

## Open decisions (D1–D5) — need Angelo's call before T0 unblocks

- **D1 — Scope of "money."** The 14 `real` money columns (design §1). EXCLUDE `apr` (a %), `volume`
  (gallons/kWh), mileage/charge. **Recommend:** migrate exactly the 14; leave the rest. *(Confirm the
  list — esp. `excessMileageFee`, a per-mile fee, and `coverageLimit`, a dollar cap, are money.)*
- **D2 — Export representation.** After the flip, does the CSV/Sheets backup export money as **integer
  cents** (cleanest, no float ever) or as **human dollars** (`12.34`, converting on import)? **Recommend:**
  export **cents integers** + document it — keeps float out of the pipeline entirely; the human-readability
  cost on a raw CSV is low (this is a backup format, not a report).
- **D3 — Old-backup handling.** When a pre-cents (`1.0.0`) backup is restored into the cents schema:
  **(a)** reject it (fail-closed via the bumped `currentVersion`), or **(b)** version-gated coercion shim
  that ×100s the money columns on import so old backups round-trip. **Recommend:** ship **both** — bump
  `CONFIG.backup.currentVersion` to `'2.0.0'` (so a naive restore fails closed, never corrupts) AND add the
  shim (so a user's old backup still restores correctly). Fail-safe default + a real recovery path.
- **D4 — Migration shape.** In-place `UPDATE … SET col = CAST(ROUND(col*100) AS INTEGER)` per table
  (NO table rebuild — SQLite affinity means a `real`→`integer` type change needs no `__new_` rebuild, and a
  value conversion touches no FKs, so the 0004 cascade footgun does NOT apply). Hand-author the migration
  (Drizzle would generate a rebuild). **Recommend:** approve the in-place UPDATE shape.
- **D5 — Rollout.** Single big-bang migration of all 14 columns in one cycle, or staged table-by-table?
  **Recommend:** the schema change + migration + the conversion helpers land together (one coherent,
  atomic schema version); the per-call-site read/write conversions are the follow-on tasks (T-series),
  each independently `validate:local`-gated. (A half-migrated schema is incoherent — the DDL is atomic.)

## Non-goals
- A currency-conversion / multi-currency feature (VROOM stores one currency per user; that's separate).
- Touching `apr`, `volume`, mileage, or any non-money `real`.
- Any UI/display change beyond the FE format helper reading cents (eyes-on, deferred to its own task).
