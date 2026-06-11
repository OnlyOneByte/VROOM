# Money: float → integer cents — Tasks

> **T0 is a SIGN-OFF GATE — BUILD BLOCKED until Angelo ratifies D1–D5 (requirements.md).** A money-type
> migration is an arch-rule-6 direction call. Drafted + escalated C146. One task per loop cycle once
> unblocked; each independently verified via `bun run validate:local`. T1+T2 are the data-safety core and
> MUST land before any read/write conversion (else the schema is cents but the pipeline still writes floats).

- [ ] **T0 — Sign-off gate.** Angelo ratifies D1 (the 14-column scope), D2 (export cents vs dollars), D3
      (old-backup reject + shim), D4 (in-place UPDATE migration shape), D5 (atomic schema version + staged
      call-site follow-ons). BUILD UNBLOCKS on approval. *(Escalated C146.)*

### Data-safety core (land together, before any call-site conversion)

- [ ] **T1 — Schema + hand-authored migration + migration test.** Flip the 14 `real` money columns to
      `integer` in schema.ts; hand-author the migration (per-table `UPDATE … CAST(ROUND(col*100) AS INTEGER)
      WHERE col IS NOT NULL`, NO rebuild — design §3). NEW `migration-00NN.test.ts` (mirror
      migration-0004.test.ts): exact-cents conversion incl. binary-float edges (12.34→1234), NULL/zero
      preserved, row-counts unchanged (no cascade), double-apply guard. `validate:local` green.
- [ ] **T2 — Backup version bump + restore shim + round-trip test.** Bump `CONFIG.backup.currentVersion`
      → `'2.0.0'` (config.ts:183) so a naive old-backup restore fails closed. Add the version-gated money
      coercion shim (×100 ROUND on a money-column allowlist) to the restore path (backup.ts coerceRow +
      the Sheets parse). NEW `restore-money-version.test.ts`: old `1.0.0` backup → rejected OR shim-coerced
      to cents; new `2.0.0` cents backup → full round-trip equality. **This is the NORTH_STAR #1 gate.**

### Call-site conversions (each independently gated; order flexible)

- [ ] **T3 — Input edge (dollars→cents).** Add a shared `dollarsToCents` Zod transform at every money input
      validator (design §2 list). Pin: `12.34` in → `1234` stored; a route HTTP test per surface.
- [ ] **T4 — Internal math: repositories + analytics.** Make the SUM/reduce/accumulate sites integer-cents
      (expenses/repository, analytics/repository TCO+financing+insurance+quick-stats). Division results
      (costPerMile, amortization, premium÷months) are computed/display numbers — round only at display.
      FLIP the existing money-math + analytics property suites to exact-integer assertions (the
      behavior-preserving net). `validate:local` green.
- [ ] **T5 — split-service native cents.** `computeAllocations` already rounds to cents internally
      (:34/58/60) — drop the `/100`, store integer cents directly; siblings sum EXACTLY to groupTotal (no
      float remainder). Flip split-service.property.test.ts assertions.
- [ ] **T6 — Display edge (cents→dollars).** Convert at the API response boundary (route assembly /
      api-transformer) so the FE `Expense.amount` dollar contract is UNCHANGED — keeps this feature
      backend-only / no eyes-on. Pin the boundary with a contract test (the C55/C80 hand-assembled-response
      guard pattern). *(A later eyes-on task may push cents to the FE formatter — out of scope here.)*

### Done-when

- [ ] **T7 — Full-suite green sweep + cov.** All money-math suites exact-integer + green; sweep
      `toBeCloseTo`/`toFixed(2)` residue; backup round-trip proven both versions; re-measure coverage.
      Feature DONE when the migration + both data-safety tests + the flipped suites are green (this feature
      has NO eyes-on tail — it's the rare horizon item fully verifiable via validate:local).

> NOTE: this is the ONLY signed-off-horizon feature buildable without Playwright — every other in-flight
> feature (maintenance T9, import-trackers T4-6, recurring-expenses T4-8) is eyes-on-blocked. So once T0
> clears, this feature can run to DONE entirely in the autonomous loop, unlike the others.
