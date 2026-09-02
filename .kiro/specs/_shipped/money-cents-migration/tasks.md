# Money: float → integer cents — Tasks

> **✅ SHIPPED C19 (commit 705b794, pushed) — built ATOMIC T1–T7 in ONE branch-green commit.**
> Angelo ratified D1–D5 (2026-06-24). The original "one task per loop cycle" plan below was INFEASIBLE and
> was superseded by the ATOMIC ruling (Angelo-confirmed, saved lesson 2026-06-26): T1 flips 14 money columns
> `real→integer`, so the branch CANNOT re-green until the read/write/analytics paths + money-math suites are
> all converted end-to-end — a per-cycle slice would leave the branch RED mid-migration (NORTH_STAR #1
> data-corruption risk). So T1–T7 landed as ONE atomic, end-to-end-green commit, NOT one-task-per-cycle. This
> is the deliberate exception to WIP=1 / one-slice-per-cycle. Spec DONE; retained for grounding.

- [x] **T0 — Sign-off gate — ✅ GREENLIT by Angelo 2026-06-24.** D1 (the 14-column scope), D2 (export cents
      vs dollars), D3 (old-backup reject + shim), D4 (in-place UPDATE migration shape), D5 (atomic schema
      version + staged call-site follow-ons) all ratified at the spec's recommended option. ⚠️ HARD ORDER
      (HONORED): T1+T2 (the data-safety core — schema/migration + backup version-bump/shim) landed together
      and BEFORE any T3–T6 call-site conversion. Built ATOMIC T1–T7 in ONE branch-green commit — NOT
      one-task-per-cycle (that was infeasible: T1 alone leaves the branch red). *(Escalated C146; greenlit
      2026-06-24; shipped C19.)*

### Data-safety core (landed together, before any call-site conversion)

- [x] **T1 — Schema + hand-authored migration + migration test.** ✅ SHIPPED C19. Flipped the 14 `real` money
      columns to `integer` in schema.ts; hand-authored the migration (per-table `UPDATE … CAST(ROUND(col*100)
      AS INTEGER) WHERE col IS NOT NULL`, NO rebuild — design §3). NEW `migration-00NN.test.ts` (mirror
      migration-0004.test.ts): exact-cents conversion incl. binary-float edges (12.34→1234), NULL/zero
      preserved, row-counts unchanged (no cascade), double-apply guard. `validate:local` green.
- [x] **T2 — Backup version bump + restore shim + round-trip test.** ✅ SHIPPED C19. Bumped
      `CONFIG.backup.currentVersion` → `'2.0.0'` (config.ts:183) so a naive old-backup restore fails closed.
      Added the version-gated money coercion shim (×100 ROUND on a money-column allowlist) to the restore path
      (backup.ts coerceRow + the Sheets parse). NEW `restore-money-version.test.ts`: old `1.0.0` backup →
      rejected OR shim-coerced to cents; new `2.0.0` cents backup → full round-trip equality. **This is the
      NORTH_STAR #1 gate.** (The Sheets x100 data-corruption edge — Sheets format has no version, so it must
      NOT apply the version-gated shim — was caught by the C20 adversarial scout and fixed immediately.)

### Call-site conversions (each independently gated; order flexible)

- [x] **T3 — Input edge (dollars→cents).** ✅ SHIPPED C19. Added a shared `dollarsToCents` Zod transform at
      every money input validator (design §2 list). Pin: `12.34` in → `1234` stored; a route HTTP test per
      surface.
- [x] **T4 — Internal math: repositories + analytics.** ✅ SHIPPED C19. Made the SUM/reduce/accumulate sites
      integer-cents (expenses/repository, analytics/repository TCO+financing+insurance+quick-stats). Division
      results (costPerMile, amortization, premium÷months) are computed/display numbers — round only at display.
      FLIPPED the existing money-math + analytics property suites to exact-integer assertions (the
      behavior-preserving net). `validate:local` green.
- [x] **T5 — split-service native cents.** ✅ SHIPPED C19. `computeAllocations` already rounded to cents
      internally (:34/58/60) — dropped the `/100`, store integer cents directly; siblings sum EXACTLY to
      groupTotal (no float remainder). Flipped split-service.property.test.ts assertions.
- [x] **T6 — Display edge (cents→dollars).** ✅ SHIPPED C19. Convert at the API response boundary (route
      assembly / api-transformer) so the FE `Expense.amount` dollar contract is UNCHANGED — keeps this feature
      backend-only / no eyes-on. Pinned the boundary with a contract test (the C55/C80 hand-assembled-response
      guard pattern). *(A later eyes-on task may push cents to the FE formatter — out of scope here.)*

### Done-when

- [x] **T7 — Full-suite green sweep + cov.** ✅ SHIPPED C19. All money-math suites exact-integer + green; swept
      `toBeCloseTo`/`toFixed(2)` residue; backup round-trip proven both versions; re-measured coverage. Feature
      DONE: the migration + both data-safety tests + the flipped suites are green (this feature has NO eyes-on
      tail — the rare horizon item fully verifiable via validate:local). 36 files; money is integer CENTS
      end-to-end, dollars only at the input edge (Zod dollarsToCents) + response edge.

> NOTE: this WAS the only signed-off-horizon feature buildable without Playwright — it ran to DONE entirely in
> the autonomous loop (C11–C19), unlike the eyes-on-blocked features. The C20 adversarial scout then caught +
> fixed the Sheets x100 shim edge; veins re-certified C22/C25/C26.
