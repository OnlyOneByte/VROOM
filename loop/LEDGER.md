# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.
>
> **Fresh reset 2026-06-26 (was C350; counter reset to C1).** The C1–C350 history was archived to
> `loop/archive/LEDGER-C1-C350.md` (+ `BACKLOG-C1-C350.md`); the earlier C1–C467 arc is in the
> `-C1-C467` files. Read-path was 9,731 lines → reset to keep the loop lean. Everything still-open
> carried into the fresh `BACKLOG.md`; everything done lives in the archive (and in git). Read
> `GUIDE.md` first, then NORTH_STAR, then BACKLOG. Skim THIS file's balance table + last ~3 entries
> only — never the whole log. **Cycle numbers below restart at C1; "C350" and earlier refer to the
> archived pre-reset arc.**

## Coverage + velocity conventions (tag EVERY cycle entry)
> **`cov:` tag** — `cov: be <pct>% / fe <pct>%`. Carry prior + mark `~` if not re-measured; re-measure
> (`bun test --coverage` / vitest `--coverage`) on guard/arch/bug cycles that touch a module.
> **MEASURED BASELINE at reset (archived C350): BE 89.30% line / 89.32% func (1949 pass) · FE 89.63%
> line / 90.07% func / 81.78% branch (1277 pass).** Structural ceiling ~89% both; BE gap is DI/OAuth/SQL
> + catch tails, FE gap is eyes-on components + DOM/timer + apiClient-wrapper theater. Goal 90% both is
> NOT loop-closable without new feature SOURCE — don't manufacture theater (C181/C229).
>
> **`yield:` tag (velocity signal)** — `yield: <product|test|doc|dry>` (product = changed prod source;
> test = guard/char test only; doc = loop/spec/docs only; dry = scouted-nothing-pivoted). The
> META-REVIEW (~every 25 cycles — see GUIDE "META-LOOP") reads the last ~25 `yield:` tags: >40% dry/doc
> = maintenance-spin → drop to MAINTAIN cadence or flag Angelo; a twice-recurring avoidable misstep = a
> PROCESS bug → fix it with ONE `loop(meta):` GUIDE edit.
>
> **MODE first (GUIDE top): BUILD vs MAINTAIN.** In BUILD mode pop the next BUILD QUEUE slice (WIP=1) —
> do NOT run the 6-budget recompute. The recompute is a MAINTAIN-mode tool only.

## Balance table
`starved-for = current cycle − last-touched`. MAINTAIN mode only: if `starved-for > budget` for any
category, the next increment MUST come from the most-starved over-budget category. In BUILD mode the
queue dictates the pick; still bump `last-touched` for whatever you touched.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 0 |
| deep-review | 5 | 0 |
| guard | 6 | 0 |
| bug | 3 | 0 |
| arch | 5 | 0 |
| infra | 6 | 0 |

Current cycle: **1**

> Reset to 0 (fresh start 2026-06-26). At C1 nothing is over budget; MODE picks the work — and there IS
> an unblocked build queue (money-cents → trips T6 → theming picker → …), so the loop starts in BUILD
> mode. The branch is ~243 commits deep and PR-ready; this reset is documentation hygiene, not a code reset.

## Cycle log
<!-- newest entry on top; one line per cycle; end each with cov: + yield: tags -->
_(fresh — first post-reset cycle appends here)_
