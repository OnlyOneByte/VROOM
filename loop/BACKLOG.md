# BACKLOG — VROOM autonomous loop

> **Fresh reset 2026-06-26 (post-C350).** Only OPEN work is below. The full pre-reset queue (371+ done
> items, all grounding) is in `loop/archive/BACKLOG-C1-C350.md` (+ `-C1-C467`) — consult it for "was X
> already done / certified clean / what was the grounding for #N?" before re-doing work. Read `GUIDE.md`
> first (MODE → BUILD QUEUE → velocity rules → META-LOOP), then NORTH_STAR, then this file.

## How to pick (mirrors GUIDE)
- **BUILD MODE** (an unblocked build item exists — it does): pop the next slice of the in-flight BUILD
  QUEUE item below. WIP=1 — finish one feature before starting another. Maintenance fires only
  reactively (a real bug found while building) or on the slow infra cadence.
- **MAINTAIN MODE** (queue empty / everything gated): classic rotation — most-starved over-budget
  category from the LEDGER balance table; if that vein is SATURATED, record-verified + pivot.

## Categories & starvation budgets (MAINTAIN-mode rotation)
| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits. VERIFY findings firsthand against source. |
| **guard** | 6 | Merge-surviving regression prevention (committed HTTP-harness + source-scan tests). |
| **bug** | 3 | A concrete defect found in review/reported. Jump the queue when real. |
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, shared helpers, dead code. |
| **infra** | 6 | Loop tooling, harness, CI, docs, coverage re-measure + META-REVIEW cadence. |

### `arch` rules (refactors are the highest-risk work — READ before any arch increment)
1. ONE small reviewable refactor per cycle — never a sweeping rewrite.
2. Behavior-preserving: no observable API/UI/data change (else it's a bug/feature).
3. Test-anchored green→green; add the characterization test FIRST if coverage is missing.
4. Full verify gate; for UI-touching refactors, shot.sh before/after — must not move a pixel.
5. No churn-for-churn — name a concrete payoff, or record "no churn warranted" + pivot.
6. Big restructures (new layer, schema/money migration, tx-semantics) → `.kiro/specs/<refactor>/design.md`
   + `send_message` Angelo. Never self-authorize.
7. **FAST-DRY precondition (C286):** at cycle start, if `git log` over production-src (backend/src +
   frontend/src `*.ts`, EXCLUDING tests) shows NO commit since the last source-touching cycle, the dedup
   vein is structurally dry → record no-churn FAST + pivot; mark dormant, don't re-scout.

---

## BUILD QUEUE (the ordered build plan — pop the top unblocked slice; WIP=1)
> Greenlit 2026-06-24, ordered C349. Re-rank only when a slice finishes or a gate clears.

1. **money-cents-migration** — `.kiro/specs/money-cents-migration/tasks.md` (**1/8 done at reset**).
   FIRST: only greenlit feature with NO eyes-on tail (runs to DONE in-loop) + data-safety-critical.
   **HARD ORDER: T1+T2 (schema/migration + backup version-bump+shim) land TOGETHER before T3–T6.** Next = T1.
2. **trips-location** — `.kiro/specs/trips-location/tasks.md` (**backend T1–T5 + D2 DONE; FE list+create
   eyes-on DONE**). REMAINING: **T6b-3 edit/delete is GATED on the C214 ruling** (editing endOdometer /
   deleting a trip leaves a stale linked odometer entry — Angelo's lifecycle call). D3 business-rate
   persistence (userPreferences column + per-trip override) is a DEFERRED schema slice, not self-authored.
   → trips has no clean un-gated FE work until C214; backend is complete.
3. **theming-engine** — `.kiro/specs/theming-engine/tasks.md` (**engine T1–T9 + all 9 themes
   picker-verified**). REMAINING: Phase-4 picker polish GATED on the `instrument` palette (+ the 3 gated
   theme items below). Token-only swap; default ≡ today byte-for-byte (C185 identity contract).
4. **vehicle-sharing** — `.kiro/specs/vehicle-sharing/tasks.md` (**0/15, BLOCKED at T0**). Highest
   cross-tenant risk → waits for Angelo to ratify D1–D8. Do NOT build T1+ until the gate clears.

> NOTE/lesson (C166→C167): a parallel-agent Angelo greenlight lands as a committed T0 flip with NO
> in-session message — that IS legitimate authorization. Don't revert a committed greenlight as
> "fabricated"; ASK first.

---

## OPEN — Angelo-gated (parked; each changes a displayed $/visible-chrome or is a semantics call)
Full grounding for every item is in `loop/archive/BACKLOG-C1-C350.md` — these are the LIVE-actionable steers:
- **C214 — trips↔odometer edit/delete lifecycle.** Editing endOdometer / deleting a trip leaves a stale
  linked odometer entry. Blocks trips T6b-3. (recommend cascade-update the linked entry.)
- **C339(B) — theme reconcile "server wins" clobbers a local theme pick to `default` when the server
  value is UNSET.** Mirror the #129 ruling (sync only if non-empty, never overwrite with empty). Changes
  reconcile semantics → not auto-fixed. (Until ruled, theme eyes-on uses the picker-drive method, path A.)
- **C333 — PWA `<meta theme-color>` doesn't follow the selected theme** (hard-coded brand hex by mode).
  2 decisions: which token drives the tint + oklch→hex gamut clamp. ~3-line fix once ruled. LOW (chrome).
- **C343 — `default` palette chart colors below WCAG 3:1** (chart-4/5 light, chart-1 dark vs card).
  Pre-existing in app.css (C185-locked); all 9 non-default themes pass + are guarded. Re-tuning shipped
  tokens is a visual call + breaks the default≡app.css guard. LOW (legibility, not data).
- **The ~15 older pending-Angelo bug/product items** (#36/#37 Sheets backup HIGHs, #43/#44 backup-honesty,
  #69/#88/#94/#97/#100/#112/#127/#135/#148, #30 MPG-band, #24 CSV-decimal, CSV-apostrophe, …). Each
  changes a displayed figure or is a semantics decision — full text + recommended option in the archive.
  When a `bug`/`feature` cycle wants one, read its archive grounding FIRST (don't guess from the one-liner).

---

## OPEN — loop-buildable (no gate; fills a maintenance cycle when the build queue is between slices)
- **deep-review / guard / arch / bug** are at STEADY-STATE SATURATION across the swept surfaces (the
  C253–C349 arc certified ~12 subsystems CLEAN firsthand). A real new finding now comes from: (a) a
  fresh feature surface as the BUILD QUEUE lands code, or (b) a NOT-YET-AUDITED shipped subsystem. On a
  MAINTAIN pick of a saturated vein: record-verified + pivot (don't re-scout — fast-dry precondition).
- **infra** is the one always-productive maintenance vein: ~every 10 cycles re-measure coverage + untracked-
  test sweep + doc-freshness; ~every 25 cycles ALSO run the META-REVIEW (GUIDE §META-LOOP).

> The high-leverage work is the BUILD QUEUE (money-cents first) + clearing the gated steers above.
> Everything else is hardening that pays off only as new SOURCE lands.
