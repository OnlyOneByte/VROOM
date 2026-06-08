# BACKLOG — VROOM autonomous loop

> Re-ranked every cycle. Pick the top unblocked item in the most-starved over-budget
> category (see LEDGER balance check); else the highest-leverage item overall.
> Keep this lean — prune done items, promote what the last cycle surfaced.

## Categories & starvation budgets
A category may go at most **N cycles** untouched before it MUST be picked next.

| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (often needs a spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits of already-shipped work. |
| **guard** | 6 | Merge-surviving regression prevention (committed tests, source-scans). |
| **bug** | 3 | A concrete defect found in review or reported. Always jump the queue when real. |
| **infra** | 6 | Loop tooling, harness, CI, docs that keep the machine running. |

`bug` has the tightest budget on purpose: a known defect should never sit.

---

## Ranked queue (top = next)

### feature
1. **Maintenance-schedule reminders** — define service intervals by mileage and/or time
   (oil, tires, brakes…), surface "due" based on current odometer + last service. Needs a
   spec (`.kiro/specs/maintenance-schedule/`) + design sign-off before build. *(highest
   user value of the open features; builds on the shipped reminders + odometer engines.)*
2. **Import from other trackers** — CSV import from Fuelly/Fuelio/Drivvo/etc. (VROOM-native
   CSV round-trip already ships; this is mapping foreign schemas). Needs per-source column
   mapping design.
3. **Recurring expenses** beyond reminders — first-class recurring (insurance premium, loan
   payment, parking pass) with frequency + dashboard surfacing.

### deep-review
1. **Eyes-on sweep: vehicle Overview tab + ExpensesTable populated states** (mobile +
   desktop) — not eyes-on'd this round; dense composite surfaces.
2. **Backend: Sheets restore path** — column-order / header drift vs the CSV path (CSV side
   is guarded by c208/209; Sheets is the untested sibling).
3. **Analytics route eyes-on** (per-vehicle + cross-vehicle + year-end), states + a11y.

### guard
1. **EUR/unit visual guard in the harness** — set currency=EUR, assert insurance form labels
   render € (pins the c202/203 cold-load fix end-to-end in regress, not just unit tests).
2. **Category-grid no-wrap guard** — assert the expense CategorySelector labels don't wrap
   (pins the c201 fix).

### bug
- *(none known — populated as reviews surface them)*

### infra
1. **CLAUDE.md stale refs** — it points at `STATUS.md` / `.meshclaw-autopilot/LOOP.md`, now
   gitignored/removed; and says "Biome can't run" (the musl binary works). Reconcile so a
   fresh clone orients correctly.
2. **`loop/` scaffold + push.sh** — *DONE cycle 1.*
