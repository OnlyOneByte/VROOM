# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.
>
> **Fresh start 2026-06-16.** The C1–C467 history was archived to
> `loop/archive/LEDGER-C1-C467.md` (+ `BACKLOG-C1-C467.md`) to keep the loop's read-path lean.
> Everything still-open carried into the fresh `BACKLOG.md`; everything done lives in the archive
> (and in git). Read `GUIDE.md` first, then NORTH_STAR, then BACKLOG. Skim THIS file's balance
> table + the last ~3 entries only — never the whole log.
>
> **COVERAGE TREND (loop-improvement #4): end every cycle-log entry with a `cov:` tag** —
> `cov: be <pct>% / fe <pct>%`. Carry the prior numbers forward + mark `~` if you didn't
> re-measure this cycle; re-measure (`bun test --coverage` / vitest `--coverage`) on guard/arch/bug
> cycles that touch a module. Goal 90% both (structural ceiling ~87% BE / ~86% FE — the remaining gap
> is OAuth/DI-bound BE [auth routes, provider services, backup-orchestrator, db connection] + eyes-on FE
> components). **RE-MEASURED C97 (infra cadence): BE 87.47% line / 87.20% func (file-mean, 1703 pass); FE
> 86.35% line / 87.68% func / 78.78% branch (v8, 735 pass) — BE line UNCHANGED vs C90, func +0.01 (the C94 CORS/CSRF
> source-scan guard added a couple covered helper lines); FE FULLY UNCHANGED (no FE source touched since C52; C93/C96
> were eyes-on shots only, C95 a dry scout). The C90 branch 78.88 was v8 rounding noise — back to 78.78.**
> Both still at the ~87 BE / ~86 FE structural ceiling; treat as the floor.
> **C104 (infra cadence MEASURED): BE 87.47% line / 87.19% func (1707 pass) — UNCHANGED vs C97; FE 87.6% line /
> 88.56% func / 79.84% branch (739 pass) — +1.25/+0.88/+1.06 vs C97's 86.35/87.68/78.78, the cumulative C100
> (settings reload) + C101 (theme listener) + C102 (#148 anchor) FE-logic guard arc. FE is now meaningfully off its
> old plateau; the residual gap is structural (effect/DOM-bound + DI/OAuth-bound). Both still under the 90% goal but
> the FE structural ceiling proved ~1.25pts higher than the long-assumed ~86% once the store/util logic was pinned.**
> **C161 (infra cadence MEASURED): BE 88.39% line / 87.99% func (1788 pass) — +0.06 vs C154; FE 88.44% line /
> 88.92% func / 80.57% branch / 86.36% stmts (757 pass) — +0.20 line vs C154. Both UP — the auth-guard arc
> (C155 email-fix / C157 resolveNewUser / C158 unlink-route) + the C159 offline needs-attention helpers
> (pure+covered) added covered lines; FE crossed 88.4 line (a fresh high). Structural ceiling holds (DI/OAuth/SQL
> BE + effect/DOM FE). NEXT ~C171.**
> **C224 (infra cadence MEASURED): BE 88.92% line / 88.13% func (1903 pass) — FLAT vs C217 (BE untouched since;
> C218–C223 were FE + LEDGER). FE 88.85% line / 89.15% func / 80.78% branch / 86.75% stmts (826 pass) — UP +0.12
> line / +0.24 func / +0.10 branch vs C217, from the C218 trip-api/types (unit-tested) + the C220–C223 trips
> list page (the FE's first real movement in the trips arc). Both hold/up at the structural ceiling, both green.
> Untracked-test sweep CLEAN both sides; tree clean; no orphan dev servers; branch 78 ahead / 0 behind
> origin/main, PR-ready. NEXT cadence ~C234.**
> **C217 (infra cadence MEASURED): BE 88.92% line / 88.14% func (1903 pass) — UP +0.39 line / +0.08 func vs
> C209, the C210–C216 trips arc (trips routes/repository/validation + trip-summary all 100% line; odometer
> repository 100% line incl. createFromTrip). FE 88.73% line / 88.91% func / 80.68% branch / 86.62% stmts (813
> pass) — FLAT vs C209 (trips is BACKEND-only; the FE eyes-on tail is T6). Both hold/up at the structural
> ceiling, both green. trips/validation.ts shows 66.67% FUNC but 100% LINE — a bun-coverage quirk counting the
> .refine() arrow predicates, NOT a logic gap (the C211 partial-PUT tests exercise them behaviorally). Untracked-
> test sweep CLEAN both sides; tree clean; branch 71 ahead / 0 behind origin/main, PR-ready. NEXT cadence ~C227.**
> **C209 (infra cadence MEASURED): BE 88.53% line / 88.06% func (1855 pass) — UP +0.14 line / +0.07 func vs
> C200, the C202–C208 trips arc (TripRepository fully covered + the new validators/guards add covered lines on
> real modules); FE 88.73% line / 88.91% func / 80.68% branch / 86.62% stmts (813 pass) — FLAT vs C200 (the
> trips arc is BACKEND-only so far; the FE eyes-on is T6, still ahead). Both hold at the structural ceiling, both
> green. Untracked-test sweep CLEAN both sides; tree clean; branch 63 ahead / 0 behind origin/main, PR-ready.
> NEXT cadence ~C219.**
> **C200 (infra cadence MEASURED — milestone cycle): BE 88.39% line / 87.99% func (1823 pass) — FLAT vs C192
> (+1 test, the C193 sheets cert); FE 88.73% line / 88.91% func / 80.77% branch / 86.68% stmts (810 pass) — UP
> +0.08 line / +8 tests vs C192 (the C195 server-sync + C196 load-reconcile-wiring store tests). Both hold/up at
> the structural ceiling. Untracked-test sweep CLEAN both sides; branch 54 ahead / 0 behind origin/main, PR-ready.
> BROADER STATE @ C200: the loop's three SELF-DIRECTED veins are now exhausted/saturated — arch seedVehicle
> convergence COMPLETE (C199, 46 files), bug cold-scout provably-dry 19 consecutive (no prod-logic change since
> C183), deep-review data-safety comprehensively certified (C198/C199/C200 scouts all found saturated). theming
> Phases 1–3 are engine-complete. The genuinely high-leverage work left is Angelo-GATED (the `instrument` palette
> → theming picker T10; vehicle-sharing greenlight). Productive un-gated veins now: guard (fresh cross-file
> contracts as they arise) + infra (this cadence). NEXT cadence ~C210.**
> **C192 (infra cadence MEASURED): BE 88.39% line / 87.99% func (1822 pass) — FLAT vs C184 (BE untouched since
> C188); FE 88.65% line / 88.82% func / 80.77% branch / 86.57% stmts (802 pass) — UP +0.20 line / +37 tests vs
> C184. The C185–C191 theming Phase-2/3 arc added 5 new FE modules WELL-COVERED (resolve-theme 100% line,
> theme.svelte 100% func, theme-registry/types/themes-css all guarded) — so FE moved UP (genuine new covered
> surface, not flat). themes-css.ts 85.71% (the uncovered lines = the empty-registry placeholder + the
> non-default-block path, exercised once `instrument` ships). Untracked-test sweep CLEAN both sides; branch 46
> ahead / 0 behind origin/main, PR-ready. NEXT ~C202.**
> **C184 (infra cadence MEASURED): BE 88.39% line / 87.99% func (1822 pass) — FLAT vs C176/C169 (line identical);
> FE 88.45% line / 88.92% func / 80.57% branch / 86.37% stmts (765 pass) — FLAT vs C176 (+0.01 line). Both hold at
> the structural ceiling. The C177–C183 arc added +14 BE / +5 FE tests (C178 reminder-split-config guard, C179
> themePreference HTTP, C180 theme round-trip, C181 theme-token-keys, C182 financing seedVehicle converge, C183
> coalesce-completeness) — ALL guards/test-helpers/types in already-covered modules, so the covered-line ratio held
> (the expected guard/fix-cycle signature). Untracked-test sweep CLEAN both sides; branch 38 ahead / 0 behind
> origin/main, PR-ready. NEXT ~C194.**
> **C176 (infra cadence MEASURED): BE 88.39% line / 87.99% func (1808 pass) — FLAT vs C169 (line identical);
> FE 88.44% line / 88.92% func / 80.66% branch / 86.43% stmts (760 pass) — FLAT vs C169 (+0.09 branch / +0.07
> stmts). Both hold at the structural ceiling. The C170–C175 arc added +16 BE tests (C170 RMW drift guard +
> C172 source-link validate-before-persist + C174 migration-0006 + C175 coerceRow restore-safety) + 1 FE test
> (C173 needs-attention copy source-scan) — all in ALREADY-covered modules or a repo branch now covered, so
> coverage stayed flat (more tests, same covered-line ratio = the expected signature of guard/fix cycles).
> Untracked-test sweep CLEAN both sides; branch 30 ahead / 0 behind origin/main, PR-ready. NEXT ~C186.**
> **C169 (infra cadence MEASURED): BE 88.39% line / 87.99% func (1792 pass) — +0.06 vs C154; FE 88.44% line /
> 88.92% func / 80.57% branch / 86.36% stmts (759 pass) — +0.20 line / +7 tests vs C154. Both UP off the C154
> reading (BE: C155 auth-email + C168 json_patch guards; FE: C165 #79 needs-attention partition + C162/C163
> guards). Both hold above 88% line at the structural ceiling. Feature now UNBLOCKED (3 specs greenlit C167) —
> next feature-over-budget cycle builds (theming T1). NEXT ~C179.**
> **C154 (infra cadence MEASURED): BE 88.33% line / 87.91% func (1776 pass) — +0.12 vs C136; FE 88.24% line /
> 88.72% func / 80.25% branch / 86.09% stmts (752 pass) — +0.01 vs C136. Both UP slightly off the C136 plateau
> (the C148/C151/C152 import-mapping guards + C149 lease-gate + C153 buildPresetMapping extraction added covered
> lines). Both hold above 88% line at the structural ceiling (residual DI/OAuth/SQL BE + effect/DOM FE). The
> import-trackers feature completing (C153) added no new uncovered surface — its slices were already pinned. NEXT ~C164.**
> **C136 (infra cadence MEASURED): BE 88.21% line / 87.79% func (1770 pass) — +0.08 vs C130 (the C133/C134 arc);
> FE 88.23% line / 88.69% func / 80.32% branch / 86.14% stmts (749 pass) — matches C134 (C135 doc-only). Both
> holding above 88% line. All self-authorizable coverage veins CLOSED; the loop is at steady-state maintenance.**
> **C134 (guard MEASURED): FE 88.23% line / 88.69% func / 80.23% branch / 86.07% stmts (749 pass), +0.15 line vs
> C130, from pinning apiClient.raw (api-client.ts 95.23→100% line). BE unchanged 88.13% (frontend-only). The FE
> service/util layer is now at its structural ceiling — self-authorizable coverage is complete both sides.**
> **C130 (infra cadence MEASURED): BOTH suites crossed 88% line for the first time. BE 88.13% line / 87.79% func
> (1769 pass) — +0.35 vs C123, the C126/C127 photo-coverage arc; FE 88.08% line / 88.4% func / 79.94% branch /
> 85.94% stmts (746 pass) — +0.48 vs C123, the C128/C129 store arc. The C126–C129 guard arc moved BOTH suites off
> the long ~87.7 plateau. All four self-authorizable coverage veins (FE-logic C100–C102, route-IDOR C108–C116,
> analytics-builder C119–C122, store/repo C126–C129) now CLOSED; residual sub-90% is structural.**
> **C129 (guard MEASURED): FE moved UP again — 88.08% line / 88.4% func / 79.94% branch / 85.94% stmts (746 pass),
> +0.34 line vs C128, from pinning auth-store updateDisplayName + logout-failure (auth.svelte.ts 90.47→100% line,
> 50→83.33% branch). BE unchanged 88.02% (frontend-only). Third consecutive real coverage gain off the plateau
> (C126 BE +0.24, C128 FE +0.14, C129 FE +0.34). Residual FE is structural (DOM/timer/SSR-guard/pass-through).**
> **C128 (guard MEASURED): FE moved UP — 87.74% line / 88.56% func / 79.74% branch / 85.63% stmts (743 pass),
> +0.14 line vs C123, from pinning settings-store `restoreFromProvider` mode-gated reload + error path
> (settings.svelte.ts 67.5→70% line). BE unchanged 88.02% (frontend-only cycle). Both coverage frontiers (BE
> C126/C127, FE C128) have now each yielded a real gain off the long plateau — the clean store-logic/constructed-repo
> picks are nearly worked through; residual is DOM/timer/OAuth/DI/SQL-structural.**
> **C126 (guard MEASURED): BE moved UP off the long-flat ~87.78% ceiling — 88.02% line / 87.64% func (1766 pass),
> +0.24/+0.10 vs C123, from pinning 3 uncovered PhotoRepository finders (photo-repository.ts 72.90→97.28% line).
> FIRST non-flat BE coverage gain in many cycles — proof the file was a REAL gap, not theater. FE 87.6% unchanged
> (backend-only). The other <75% backend files are structural (OAuth/network/orchestrator/DI-bound).**
> **C123 (infra cadence MEASURED): BE 87.78% line / 87.54% func (1757 pass) — line FLAT vs C117 but
> `analytics-charts.ts` jumped 95→99.63% line / 99.01% func from the C119–C122 analytics-builder sweep (the module
> was already near the file-mean, so overall is flat; residual ceiling is DI/SQL/OAuth-bound). FE 87.6% line /
> 88.56% func / 79.84% branch / 85.57% stmts (739 pass) — FULLY UNCHANGED vs C117 (no FE source since: C119/C120/C122
> backend, C121 eyes-on). The analytics-builder coverage frontier (C119–C122) now joins FE-logic (C100–C102) +
> route-IDOR (C108–C116) as a CLOSED self-authorizable vein. Both at the ~87.8 BE / ~87.6 FE structural ceiling.**
> **C117 (infra cadence MEASURED): BE 87.78% line / 87.53% func (1717 pass) — +0.01 line vs C111, the C113–C116
> IDOR assertions hit mostly-already-covered ownership-gate branches (they're +expect in existing files, not new
> route code); FE 87.6%/88.56%/79.74% UNCHANGED (C112–C116 backend/docs). Both at the ~87.8 BE / ~87.6 FE structural
> ceiling. The route-coverage audit (C108–C116) is COMPLETE; both self-authorizable coverage frontiers (FE-logic
> C100–C102, route-IDOR C108–C116) are now closed.**
> **C111 (infra cadence MEASURED): BE moved UP off its long-assumed ~87.47% ceiling — 87.77% line / 87.53% func
> (1717 pass), +0.30/+0.34 vs C104, from the C108 (sync-status) + C109 (vehicle-expenses) + C110
> (quick-stats/cross-vehicle/year-end) route-coverage arc (analytics/routes.ts 95.65→97% line). PROOF the
> route-coverage audit found REAL untested code, not theater. FE 87.6%/88.56%/79.74% UNCHANGED (C105–C110 all
> backend/eyes-on/docs). The BE structural ceiling is ~87.8% once route-layer handlers are HTTP-harnessed; residual
> is DI/OAuth-bound.**
> **C101 (guard): FE moved UP again — 87.6% line / 88.56% func / 79.74% branch (+0.74/+0.59/+0.67 vs C100) from
> the +1 themeStore.initialize() test (theme.svelte.ts 60.52→92.1% line, 100% func — the C336-skipped one-shot +
> its live OS-preference listener). BE unchanged 87.47/87.20. The FE store/util layer is the live coverage
> frontier — real behavioral logic, not markup.**
> **C100 (guard): FE moved UP for the first time since C52 — 86.86% line / 87.97% func / 79.07% branch (+0.51/+0.29/
> +0.29) from the +2 settings-store uploadBackup mode-gated-reload tests (a real behavioral gap, not markup). BE
> unchanged 87.47/87.20.**
> (C97: BE 87.47/87.20, FE 86.35/87.68/78.78. C90: BE 87.47/87.19, FE 86.35/87.68/78.88[noise]. C84: BE 87.47/87.19, FE 86.35/87.68/78.78. C77: BE 87.46/87.18, FE 86.35/87.68/78.78. C70: BE 87.46/87.18, FE 86.35/87.68/78.78. C63: BE 87.46/87.17, FE 86.35/87.68/78.78. C56: BE 87.46/87.18, FE 86.35/87.68/78.78. C49: BE 87.47/87.17, FE 86.35/87.68/78.88. C42: BE 87.33/86.97, FE 86.35/87.68/78.78. C35: BE 87.29/86.97, FE 86.14/87.31/78.70.
> C28: BE 87.22/86.97, FE 86.14/87.31/78.70. C21: BE 87.22/86.96, FE
> 86.07/87.19/78.53. C14: BE 87.22/86.96, FE 86.07/87.19/78.53. C7: FE 85.95/87.15/78.38.)

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category. Recompute ALL 6 every
cycle (slow-budget categories mis-forecast otherwise).

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 220 |
| deep-review | 5 | 223 |
| guard | 6 | 225 |
| bug | 3 | 221 |
| arch | 5 | 222 |
| infra | 6 | 224 |

Current cycle: **225**

> **NOTE (C204): bug has now been the over-budget driver for 4 consecutive cycles (C201–C204) but produced
> a fix only when a fresh surface existed (C202's trips pipeline). C201/C203/C204 all recorded the scout +
> pivoted to a guard (the scout's value is the firsthand certification, the guard is the durable artifact).
> The pure-logic bug surface remains exhausted; bug fixes now come ONLY from a freshly-added feature surface
> (the trips T2/T3/T5 arc will add more) or an Angelo-unblocked product call. Bug's last-touched stays 173
> because no DEFECT was fixed — but the scouts ARE happening every cycle bug is over budget, as required.**

> **NOTE (C174): feature is UNBLOCKED and now BUILDING. 3 specs greenlit by Angelo 2026-06-24 (theming/
> money-cents/trips, restored C167). C174 began the theming-engine build at T1 (the additive
> userPreferences.themePreference column + migration 0006). Each feature-over-budget cycle now BUILDS the
> next task of the most-starved greenlit spec; vehicle-sharing stays gated (Angelo greenlit 3, not it).
> (Historical C158/C159: feature was BLOCKED then — re-recorded + pivoted — until the C167 greenlights.)**

> Reset to 0 (true fresh start, 2026-06-16). Nothing is over budget yet at C1, so the first few
> cycles take the highest-leverage open item; prefer spreading across categories. The branch is
> already ~150 commits deep and PR-ready — this reset is documentation hygiene, not a code reset.

- **C225 (bug-scout on the C223 403-vehicle-delete lead [FALSE ALARM — CSRF working as designed] → guard: pin the CSRF state-change boundary)** —
  Balance recompute (cycle 225): bug most-starved + over budget (4/3 = 1.33×), with a CONCRETE fresh lead — the
  C223-filed `DELETE /api/v1/vehicles/:id` → 403. Scouted it firsthand: reproduced the 403 (`{code:HTTPException,
  message:""}` — a bare empty-message 403, Hono's csrf() signature), traced it to `csrf({origin:
  CONFIG.cors.origins})` (app.ts:117), then PROVED the diagnosis: the SAME DELETE with a valid `Origin:
  http://localhost:5173` returns 200 "Vehicle deleted successfully". **FALSE ALARM — no defect:** the C223 403 was
  my own raw `curl` DELETE sending NO Origin header; CSRF correctly rejects a cross-origin state-change. The real
  FE (same-origin) deletes fine. Resolving a filed phantom IS value (removes it from the backlog). Per the GUIDE
  (clean scout → record + pivot to guard), pinned the boundary: the CSRF↔CORS origin COUPLING had a source-scan
  guard (cors-csrf-origin-coupling.test.ts) but NO behavioral test of an actual rejection. +3 in
  csrf-state-change-protection.test.ts: a same-origin DELETE succeeds (200), an IDENTICAL cross-site DELETE
  (foreign Origin + Sec-Fetch-Site: cross-site) is 403'd + the vehicle SURVIVES, a cross-site GET is unaffected
  (reads not guarded). Non-vacuous (loosen csrf to origin:()=>true → ONLY the cross-site-403 case RED; verified
  firsthand). A NORTH_STAR #2 forgery-isolation boundary, now behaviorally pinned. validate:local GREEN (tsc 0,
  musl 21 warn baseline, 1906 pass / 0 fail, +3, build bundled). Test-only → no shot. cov: be 88.92% (~) / fe
  88.85% (~). (Bug stays 221 — scout clean, no fix; guard→225. The C223 403 item is CLOSED as not-a-bug in BACKLOG.)
- **C224 (infra: cadence sweep + coverage re-measure)** —
  Balance recompute (cycle 224): infra most-starved + the ONLY strictly over-budget category (7/6 = 1.17×; feature
  4/4 + bug 3/3 at threshold, not over). Coverage was last MEASURED C217, and the FE moved materially across the 4
  cycles since (C220 trips list page, C221 truncation fix, C222 dedup, C223 unit-label fix) — all carried as
  estimated `fe ~88.7% (~)`, so a real re-measure was due. (1) UNTRACKED-TEST SWEEP: CLEAN both sides; tree clean;
  no orphan dev servers (the C223 cleanup held). (2) COVERAGE RE-MEASURED: **BE 88.92% line / 88.13% func (1903
  pass) — FLAT vs C217** (BE untouched since; C218–C223 were FE + LEDGER); **FE 88.85% line / 89.15% func / 80.78%
  branch / 86.75% stmts (826 pass) — UP +0.12 line / +0.24 func / +0.10 branch vs C217**, the C218 trip-api/types +
  the C220–C223 trips list page (the FE's first real coverage movement of the trips arc). (3) BOTH-SIDES GREEN: BE
  1903 / FE 826, 0 fail. (4) BRANCH: 78 ahead / 0 behind origin/main, PR-ready. Doc-only (coverage runs exercised
  the full suites; no source touched → no build/shot). STATE: the trips backend (T1–T5 + D2) + the read-only list
  UI (T6b-1) are complete + hardened (correctness C221, cleanliness C222, unit-correctness C223). REMAINING
  loop-buildable: trips T6b-2 (the create/edit form, eyes-on/shootable) + the C223-filed 403-on-vehicle-delete
  scout; everything else is Angelo-gated (C214 lifecycle / instrument palette / vehicle-sharing T0). cov: be
  88.92% / fe 88.85% (MEASURED). NEXT cadence ~C234.
- **C223 (deep-review: certify trips unit-correctness → FIX a REAL mixed-fleet mislabel on the per-trip cards [NORTH_STAR #2])** —
  Balance recompute (cycle 223): deep-review most-starved + over budget (10/5 = 2.0×). Scouted the freshest
  uncertified surface (the C220–C222 trips FE) for a load-bearing invariant: UNIT-CORRECTNESS (NORTH_STAR #2,
  metric users). FINDING (real defect, not ceremony): the C220 trips list labeled EVERY trip's distance via the
  GLOBAL `settingsStore.unitPreferences.distanceUnit`, but trip odometers are stored same-unit-as-the-vehicle (R2)
  and each vehicle carries its OWN unitPreferences (the per-vehicle pattern OdometerTab/LeaseMetricsCard already
  follow). So a mixed-fleet user (km vehicle + mi vehicle, global=mi) saw the km vehicle's trips mislabeled "mi" —
  the #94/C353 mixed-units class on the trips surface. SCOPE split cleanly: (a) per-trip CARDS each know their
  vehicleId → loop-fixable (label by the vehicle's own unit); (b) the SUMMARY card pools all vehicles' miles via
  getSummary() → a single label there is the product-gated/escalated #94 pooling class (out of scope). FIX (a):
  added a vehicleId→label map (vehicle.unitPreferences ?? global, the graceful-default idiom), routed the per-trip
  card distance through it; the summary keeps the global label (commented as the #94 limitation). EYES-ON VERIFIED
  (the GUIDE gate): seeded a km vehicle (Renault Zoe, distanceUnit=kilometers) + a trip, shot /trips, Read — the km
  trip reads "250 km" while the mi vehicle's trips read "75 mi"/"135 mi" (fix works); the summary correctly still
  shows the pooled "460 mi" (the escalated #94 boundary, visible + correctly untouched). svelte-check 0, no console
  errors. FE validate:local GREEN (826 pass / 0 fail). NOTE: the km test vehicle's API delete hit a 403 (a separate
  vehicle-delete quirk worth a future scout) — left in the gitignored dev DB (RESET_DB wipes it next boot), no
  committed-state impact. cov: be 88.92% (~) / fe ~88.7% (~). REMAINING: trips T6b-2 (form). (Bug stays 221.)
- **C222 (arch: converge the C220 inline `purposeLabel` onto the shared `capitalize` util — NORTH_STAR #4 "one way")** —
  Balance recompute (cycle 222): arch most-starved + over budget (10/5 = 2.0×). Scouted the trips FE for a CLEAN
  fresh dedup (not the Angelo-gated createLoadState rewrite — the 6-page four-states triad is arch #2, a per-page
  reactivity REWRITE, NOT loop-authorizable). Found a genuine one: my C220 trips page RE-IMPLEMENTED capitalize
  inline as `purposeLabel(p) = p.charAt(0).toUpperCase()+p.slice(1)` — byte-identical to the EXISTING shared
  `capitalize(s)` in formatters.ts (line 50). A needless re-implementation of a shared helper (NORTH_STAR #4 "one
  way to do a thing"). Converged: dropped `purposeLabel`, imported + called `capitalize(trip.purpose)`. Behavior-
  preserving (the badge renders identically). Eyes-on: re-shot /trips — "Personal"/"Business" badges render
  identical to C220/C221, no regression, no console errors. svelte-check 0; FE validate:local GREEN (826 pass /
  0 fail). Net −3 LOC. (The expenses *test files* also hand-roll the same charAt-toUpperCase, but they're TEST
  fixtures, not prod — out of scope; the only prod re-impl was the trips one.) cov: be 88.92% (~) / fe ~88.7% (~).
  The arch convergence vein is exhausted again (next needs a fresh rule-of-three or no-churn + pivot). (Bug stays 221.)
- **C221 (bug: FIX a REAL silent-truncation defect on the C220 trips list page — self-introduced, caught same-arc)** —
  Balance recompute (cycle 221): bug most-starved (10/3 = 3.33×). **Cold-vein LIFTED — C220 added a fresh prod
  surface (the trips list page) no scout had touched** → a real scout. Probed it firsthand: the page calls
  `tripApi.list()` (route default limit=20, paginated) but read only `tripPage.data` + rendered NO paginator,
  while the Mileage Summary card reads `getSummary()` = ALL trips. **REAL DEFECT (I introduced it C220): a user
  with >20 trips sees the summary count ALL (e.g. "Trips: 25 / Total: <all-mi>") but only 20 cards below, with
  NO signal — silent truncation + a visible count mismatch (the dashboard/expenses page-1-masquerades-as-all
  class).** FE-only UX correctness, NOT a product-semantics call → fixed: request the MAX page (limit:100) +
  capture `pagination.totalCount` + render a "Showing N of M trips" footer when `trips.length < totalCount` (a
  full paginator lands with the T6b-2 form cycle; 100 covers virtually every real fleet without it). Eyes-on:
  re-shot /trips (the 2-trip seed) — no regression, summary intact, footer correctly ABSENT at 2-of-2 (not
  truncated); svelte-check 0, no console errors. The triggered footer (>100 trips) is a trivial conditional
  verified by type-check + the no-regression render (impractical to seed 100 rows). FE validate:local GREEN
  (826 pass / 0 fail). cov: be 88.92% (~) / fe ~88.7% (~). **This is the loop as designed again: C220's fresh
  UI surface made the bug vein live, and the very next scout caught a self-introduced data-visibility defect
  before a many-trip user hit it.** REMAINING T6b-2: the create/edit form + e2e. (Bug last-touched advances to
  221 — a real fix.)
- **C220 (bug-scout SATURATED → highest-leverage open item: trips T6b-1 — the EYES-ON trips list page + summary card)** —
  Balance recompute (cycle 220): bug most-starved (9/3 = 3.0×) but C219 was test-only + the C218 trip-api surface was
  scouted clean (C219) → no fresh prod logic, a 6th trips-surface guard is ceremony → dry, recorded. arch (8/5) +
  deep-review (7/5) also over BUT both dry on the saturated trips backend (arch's only candidates are the
  INTENTIONAL BE↔FE tripDistance/TRIP_PURPOSES cross-runtime mirrors — no shared module to converge). Per the GUIDE
  ("else the highest-leverage open item"), took the unambiguous winner: **trips T6b** (greenlit, the last trips task,
  explicitly shootable now). Built T6b-1 — replaced the `/trips` "Coming Soon" stub with a REAL read-only list page:
  drives tripApi.list() + tripApi.getSummary(), full FOUR-STATES (loading Skeleton / error+Retry / EmptyState /
  data), the R4 Mileage Summary card (Total/Trips/Business/Avg), per-trip cards (purpose Badge + derived distance via
  tripDistance + odometer range + date + vehicle name + locations + note). **EYES-ON VERIFIED (the GUIDE gate):
  booted servers, seeded 2 trips via the real API, shot /trips DESKTOP + MOBILE, Read both PNGs** — summary math
  correct (135+75=210 total / 2 trips / 135 business / 105 avg), newest-first order, NO mobile horizontal overflow
  (NORTH_STAR #3), no console errors, no auth bounce, kit-consistent (PageHeader/Card/Badge/Skeleton/EmptyState). FE
  validate:local GREEN (svelte-check 0 errors, build, 826 pass / 0 fail). Servers killed after (no orphans).
  REMAINING T6b-2: the create/edit FORM (ReminderForm-style → tripApi.create/update + R2 client guard) + the e2e;
  the list is read-only until the form lands. cov: be 88.92% (~) / fe ~88.7% (~, route component — eyes-on + route-
  smoke covered, not a unit add). This is the first SHOT-VERIFIED UI increment of the trips arc. (Bug stays 211.)
- **C219 (bug-scout on the C218 trip-api [CLEAN — rate=0 query survival verified] → guard: pin the explicit-zero rate)** —
  Balance recompute (cycle 219): bug most-starved + over budget (8/3 = 2.67×). Cold-vein LIFTED — C218 added a
  FRESH FE surface (trip-api.ts + trip types) the prior scouts never touched → a real scout. Probed the
  highest-risk spot in that thin wrapper: the query-string construction's falsy-handling (the
  reminder-api isActive:false truthy-drop class). Specifically `rate=0` — a MEANINGFUL business value (explicit
  free reimbursement / "no rate"), not an absent param. Verified firsthand: `getSummary({rate:0})` produces
  `rate=0` in the URL — buildQueryString drops only null/undefined (`value != null`, keeps a numeric 0), and
  trip-api passes `rate: params.rate` RAW (no `|| undefined` coercion that would nuke a 0). **CLEAN — no
  defect.** Per the GUIDE (clean scout → record + pivot to guard; bug drove, the artifact is a guard), closed
  the gap: the C218 tests only covered rate=0.67 (and one test was MISLABELED "rate=0 survives" while testing
  0.67 — fixed the label). +1 dedicated guard pinning rate=0 survival + corrected the mislabeled test. Non-vacuous
  (introduce `rate || undefined` → ONLY the rate=0 guard RED, the URL collapses to the bare path; verified
  firsthand). FE validate:local GREEN (svelte-check 0, build, 826 pass / 0 fail, +1). Test-only (data-layer
  guard, no UI) → no shot. cov: be 88.92% (~) / fe ~88.7%+ (~). (Bug stays 211 — scout clean, no fix; guard→219.)
- **C218 (bug-scout DRY [saturated] → feature: trips T6a — the FE data layer [trip types + trip-api.ts])** —
  Balance recompute (cycle 218): bug most-starved (7/3 = 2.33×) but the trips surface is scout-saturated (5
  consecutive, no prod change since C213) → dry, recorded. Next over-budget = FEATURE (5/4 = 1.25×, edging arch's
  6/5 = 1.2×). Built the FIRST slice of trips T6 (the only remaining trips task) that needs NO eyes-on — the FE
  DATA LAYER: `src/lib/types/trip.ts` (Trip / TripPurpose [identical to the backend TRIP_PURPOSES] / TripSummary
  [== buildTripSummary output] / MilesByPurpose + a `tripDistance` clamp mirror), barrel-exported; and
  `src/lib/services/trip-api.ts` (the C149/C163 service pattern over the C210/C212 routes: list [paginated +
  vehicleId/purpose filter-drop], getSummary [vehicleId+rate], getByVehicle/getById/create/update/delete). This
  is the foundation the eyes-on T6 components build on, fully unit-testable WITHOUT Playwright. +14 tests
  (trip-api.test.ts: exact URL/payload per method via mocked apiClient — guards a wrong-segment typo — + the
  filter-drop on empty vehicleId, the summary rate param, + the tripDistance clamp). FE validate:local GREEN
  (svelte-check 0, build, 825 pass / 0 fail, +12) — the FIRST FE-coverage movement since the trips arc began
  (it had been backend-only). Data layer (no UI component) → no shot. cov: be 88.92% (~, untouched) / fe ~88.7%+
  (~, new service+types module unit-covered; re-measure next cadence ~C227). REMAINING T6b: the eyes-on
  COMPONENTS (list page + trip form + summary card, four-states/a11y/mobile, then the e2e — Playwright-gated,
  lands code-complete-eyes-on-pending). (Bug stays 211 — scout dry.)
- **C217 (bug-scout SATURATED [trips surface, 5 consecutive] → record dry → infra: cadence sweep + coverage re-measure)** —
  Balance recompute (cycle 217): bug most-starved + over budget (6/3 = 2.0×). Cold-vein: C214/C215/C216 were all
  test-only, so the last prod change is C213 — and the trips/D2 surface has now been scouted FIVE consecutive
  cycles (C211 fixed the PUT asymmetry, C213 built the linkage, C214 escalated the lifecycle, C215 dedup edges,
  C216 mileage-fires) → genuinely SATURATED; a 6th scout is ceremony. Recorded dry, pivoted to INFRA (next
  over-budget at 8/6 = 1.33×, AND coverage was last MEASURED C209 — BEFORE the substantial T3/T5/D2 backend code
  landed, so the number was stale). (1) UNTRACKED-TEST SWEEP: CLEAN both sides; tree clean. (2) COVERAGE
  RE-MEASURED: **BE 88.92% line / 88.14% func (1903 pass) — UP +0.39 line / +0.08 func vs C209** (the trips arc:
  trips routes/repository + trip-summary all 100% line, odometer repository 100% incl. createFromTrip); **FE
  88.73% line / 88.91% func / 80.68% branch / 86.62% stmts (813 pass) — FLAT vs C209** (trips backend-only; FE
  tail is T6). trips/validation.ts 66.67% func / 100% line = a bun-coverage .refine()-arrow quirk, not a gap (the
  C211 partial-PUT tests cover it behaviorally). (3) BOTH-SIDES GREEN: BE 1903 / FE 813, 0 fail. (4) BRANCH: 71
  ahead / 0 behind origin/main, PR-ready. Doc-only (coverage runs exercised the full suites; no source touched →
  no build/shot). STATE: the trips backend (T1–T5 + D2) is COMPLETE + comprehensively certified/guarded across
  C202–C216; the surface is saturated. The high-leverage remainder is Angelo-GATED — most directly the C214
  trips↔odometer lifecycle call, plus the instrument palette (theming T10) + vehicle-sharing T0 + trips T6
  eyes-on + the D3 rate-persistence slice. cov: be 88.92% / fe 88.73% (MEASURED). NEXT cadence ~C227.
- **C216 (bug-scout on D2's "drives mileage reminders" claim [CLEAN — fires end-to-end] → guard: pin trip→milestone notification)** —
  Balance recompute (cycle 216): bug most-starved + over budget (5/3 = 1.67×). Cold-vein: C214/C215 were test-only,
  so the last prod-logic change is C213 (createFromTrip + the trip-POST recheck wiring) — a real scout target.
  C215 certified the DEDUP half of D2; this scouted the OTHER half — my C213 commit CLAIMED the linkage "drives
  maintenance mileage reminders" (I wired recheckMileageReminders into the POST) but I NEVER tested end-to-end that
  a trip crossing a mileage milestone actually FIRES the reminder. Probed firsthand: seeded a mileage reminder due
  at 10000, POSTed a trip end=10500 → exactly ONE notification fired (POST → createFromTrip → getCurrentOdometer
  reflects 10500 → recheck → processMileageReminder emits the milestone). **CLEAN — the full D2 promise (both
  halves) works.** Per the GUIDE (clean scout → record + pivot to guard; bug drove, the artifact is the guard),
  closed the gap: the end-to-end "a trip fires a maintenance mileage reminder" claim was UNPINNED (C213 only
  asserted getCurrentOdometer reflects the reading, never that the reminder fires). +2 in trips-http.test.ts: a
  trip reaching the milestone fires exactly one notification; a BELOW-milestone trip fires nothing (no false
  positive). Non-vacuous (remove the recheck call from the POST → ONLY the fires-one case RED, the control stays
  green; verified firsthand). Test-only → no shot. validate:local GREEN (tsc 0, musl 21 warn baseline, 1903 pass /
  0 fail, +2, build bundled). **D2 is now certified end-to-end on BOTH halves: feeds currentOdometer (C213/C215) +
  drives the mileage-reminder axis (C216).** cov: be ~88.5%+ (~) / fe 88.73% (~). (Bug stays 211 — scout clean, no fix; guard→216.)
- **C215 (bug-scout on the C213 D2 dedup edges [CLEAN — manual-entry + tz-boundary verified] → guard: pin the manual-dedup + local-day window)** —
  Balance recompute (cycle 215): bug most-starved + over budget (4/3 = 1.33×). Cold-vein LIFTED — C212/C213 added
  fresh prod logic (trip-summary + createFromTrip) since the C211 fix → a real scout. Probed the two adversarial D2
  dedup edges my C213 tests DIDN'T cover: (1) does a trip dedup against a MANUALLY-logged odometer entry (D2's
  actual "user also logged it manually" double-count scenario, not just trip→trip)? (2) the dedup window — is it a
  genuine LOCAL-calendar-day (R5) or a UTC slice with a midnight off-by-one (the gold tz seam #87/#106)? **Both
  CLEAN firsthand:** manual-entry dedup works (createFromTrip returns null against a manual same-day-same-reading
  row), and the window uses getFullYear/Month/Date (local day) — two readings straddling UTC-midnight correctly
  resolve to distinct local days. No defect. Per the GUIDE (clean scout → record + pivot to guard; bug drove but
  the artifact is a guard), closed the gap: D2's RAISON D'ÊTRE (dedup vs a manual log) + the local-day window were
  UNPINNED (C213 only tested trip→trip). +2 in create-from-trip.test.ts: manual-entry same-day-same-reading dedups
  (via repo.create note=null then createFromTrip → null, count stays 1); local-day window (same-local-day dedups,
  next-local-day inserts — host-TZ-relative so it holds in any runner zone). Non-vacuous (neuter the dedup → all 3
  dedup tests RED incl. the manual case; verified firsthand). Test-only → no shot. validate:local GREEN (tsc 0,
  musl 21 warn baseline, 1901 pass / 0 fail, +2, build bundled). cov: be ~88.5%+ (~) / fe 88.73% (~). (Bug stays
  211 — scout clean, no fix; guard→215.)
- **C214 (guard: characterization-pin the trips↔odometer EDIT/DELETE lifecycle + ESCALATE the semantics call to Angelo)** —
  Balance recompute (cycle 214): guard most-starved + the ONLY strictly over-budget category (7/6 = 1.17×; bug
  3/3 at threshold, rest under). Took guard — but probed for a GENUINE invariant first (not ceremony). The C213 D2
  linkage (trip CREATE writes an odometer entry) opened a fresh cross-feature lifecycle surface; probed trip
  EDIT/DELETE firsthand: **the linked odometer entry has NO lifecycle tie back to its trip** — correcting a
  fat-fingered endOdometer 5000→500, or deleting the trip, leaves the original 5000 entry → getCurrentOdometer
  stays 5000, poisoning the maintenance-reminder + lease-overage axes (the #76/#244 stray-reading class), with no
  user signal. This is a SEMANTICS call, not a clear bug: independent-observation (current; consistent with D2's
  dedup-by-observation; simple, no schema) vs owned-child (edit updates / delete cascades; needs an
  odometer_entries source-link schema+migration+backup slice). ESCALATED to Angelo via send_message (filed the
  two models + a hybrid; recommended owned-child for data-quality but it's his product call — did NOT auto-fix).
  GUARD: +2 characterization tests in trips-http.test.ts pinning TODAY's independent-observation behavior (edit
  endOdometer→entry+getCurrentOdometer unchanged at 5000; delete trip→entry survives) so it's explicit, can't
  silently drift, and the chosen fix flips a RED assertion (the #148/C102 escalation-anchor pattern). Test-only
  (no prod change) → no shot. validate:local GREEN (tsc 0, musl 21 warn baseline, 1899 pass / 0 fail, +2, build
  bundled). cov: be ~88.5%+ (~) / fe 88.73% (~). NEW open Angelo item: trips↔odometer lifecycle (filed below).
- **C213 (deep-review of trips↔odometer → caught a RATIFIED-BUT-UNBUILT requirement [D2] → built it: trip→odometer linkage)** —
  Balance recompute (cycle 213): deep-review + guard tied most-starved (both 5/5, 6/6 at threshold; nothing strictly
  over). Took DEEP-REVIEW + scouted the freshly-completed trips backend's interaction with the odometer subsystem
  (a genuinely-uncertified seam). FINDING (real, not ceremony): `getCurrentOdometer` UNIONs expenses.mileage +
  odometer_entries but NOT trips.end_odometer — and **D2 was RATIFIED at T0 ("reuse odometer linkage": a trip writes
  an odometerEntries row so it feeds currentOdometer + the mileage-reminder axis), yet NONE of T1–T5 implemented it.**
  I wrongly called the backend "complete" at C212. Probe confirmed firsthand: POST trip end=5000 → 0 odometer_entries,
  getCurrentOdometer null. This is NOT a self-authored product call — D2 is APPROVED; it's an unbuilt approved
  requirement (loop-buildable), distinct from the still-deferred D3 rate-persistence. BUILT IT:
  `OdometerRepository.createFromTrip` writes an entry at endOdometer/tripDate DEDUPED by (vehicleId, local
  calendar-day, odometer value) → null on a same-day-same-reading dup (the user's manual log; D2's
  avoid-double-count); the trip POST calls it + rechecks mileage reminders (mirrors the odometer route). Tests:
  create-from-trip.test.ts (+6: creates/dedups-same-day-reading/allows-diff-reading/allows-diff-day/userId-scoped-
  dedup/provenance-note) + 2 HTTP (POST trip → getCurrentOdometer reflects endOdometer; same-day-same-reading 2nd
  trip doesn't double-log). The existing trips-roundtrip/cascade tests stay green (they SQL-seed trips, bypassing the
  route — no behavior change there). validate:local GREEN (tsc 0, musl 21 warn baseline, 1897 pass / 0 fail, +8,
  build bundled). Backend-only → no shot. **NOW the trips backend is GENUINELY complete (T1–T5 + the D2 linkage);
  only T6 (eyes-on FE) remains.** LESSON: "feature complete" must check the spec's RATIFIED decisions, not just the
  numbered tasks — a decision (D2) had no task and was silently skipped. cov: be ~88.5%+ (~) / fe 88.73% (~).
- **C212 (arch scout → NO churn warranted [rule-of-two only] → feature: trips-location T5 — mileage-summary analytics; trips BACKEND COMPLETE)** —
  Balance recompute (cycle 212): arch most-starved over-budget (7/5 = 1.4×; nothing else over). Ran a fresh arch
  dedup scout firsthand on the C210 trips routes: the `listQuerySchema` {limit/offset + CONFIG.maxPageSize +
  clampPagination} form is a rule-of-TWO (odometer + trips ONLY — expenses/analytics use richer, different query
  schemas), and the pre-existing `commonSchemas.pagination` is SEMANTICALLY DIVERGENT (.default(50)/.default(0) +
  hardcoded max(100) vs the no-default CONFIG.maxPageSize form) so converging onto it would CHANGE clamp/default
  behavior — the manufactured-churn trap the GUIDE forbids. clampPagination + validateVehicleOwnership are already
  shared. **A rule-of-two needing a newly-authored shared schema is below the rule-of-three bar → recorded "no churn
  warranted" + pivoted** to the highest-leverage open item = trips T5. Built `buildTripSummary(trips, rate)` as a
  PURE builder in src/utils/trip-summary.ts (DB-free — sidesteps the C77 analytics-repo singleton trap; the route
  fetches via tripRepository then calls it): tripCount, totalMiles, milesByPurpose (all 4 D4 keys present),
  averageTripMiles (div-guarded), businessMiles + businessMileageValue (=miles×rate), + buildTripSummaryByMonth (R5
  toMonthKey buckets). Wired GET /api/v1/trips/summary?vehicleId&rate (registered BEFORE /:id; optional vehicleId
  scopes+ownership-checks, else cross-fleet). **SCOPE NOTE (D3): the business rate is a QUERY PARAM (default 0), NOT
  a stored field — D3 ratified a userPreferences rate column + per-trip override, but C202 added none (the §7 note
  flagged it). Adding userPreferences.businessMileageRate is its own schema/migration+backup-coverage slice (the
  T1↔T4 coupling) — DEFERRED so T5 ships the correct math now; the rate's STORAGE is the clean follow-on. NOT
  self-authored.** Tests: trip-summary.test.ts (+9, incl. a fast-check property Σ-by-purpose==total +
  businessMileageValue==miles×rate + empty→zeros-not-NaN + inverted→0 + unknown-purpose→other) + 4 HTTP
  (cross-fleet/vehicle-scoped/unowned-404/empty-zeros). validate:local GREEN (tsc 0, musl 21 warn baseline, 1889
  pass / 0 fail, +13, build bundled). Backend-only (UI is T6) → no shot. **THE TRIPS BACKEND ARC (T1–T5) IS
  COMPLETE; only T6 (eyes-on FE) remains.** cov: be ~88.5%+ (~, new builder+route fully covered) / fe 88.73% (~).
- **C211 (bug: FIX a REAL write-path validation-asymmetry defect on the C210 trips PUT — the cold vein is LIVE again)** —
  Balance recompute (cycle 211): bug most-starved (38/3 = 12.67×). **The cold-vein precondition NO LONGER holds —
  C210 added fresh prod logic (trips routes + validation), so a scout on that surface is a REAL scout.** Scouted
  exactly the GUIDE's gold seam (write-path validation ASYMMETRY) on the new PUT path, with a throwaway probe:
  `PUT {endOdometer:500}` on a trip stored start=1000/end=1080 → **200 + persisted start=1000/end=500, an INVERTED
  pair.** REAL DEFECT (I introduced it C210): updateTripSchema's R2 refine fires only when BOTH odometers are in
  the body, so a PARTIAL PUT touching one odometer bypasses R2 against the STORED value (#109 "refine doesn't
  survive partial" + #130 "validate the merged state, not the request" class). Impact: tripDistance=max(0,end−start)
  clamps the inverted pair to 0 → a phantom 0-mile trip in T5 analytics + a nonsensical record the create path
  rejects. FIX: the PUT handler re-checks the EFFECTIVE merged pair (request value ?? stored value) against R2
  before writing, using the row validateTripOwnership already returns → 400 on an inverted merge. GUARD: +3 in
  trips-http.test.ts — only-endOdometer-below-stored-start → 400 + stored pair untouched; only-startOdometer-
  above-stored-end → 400; a VALID only-endOdometer-above-start → 200 (no false reject). Non-vacuous (neuter the
  merged-pair check → exactly those 2 invert cases RED, the valid case stays green; verified firsthand). Backend
  validate:local GREEN (tsc 0, musl 21 warn baseline, 1876 pass / 0 fail, +3, build bundled). Backend-only → no
  shot. **This is the loop as designed: C210's fresh feature surface made the bug vein LIVE, and the scout caught a
  self-introduced defect before any user hit it — bug's last-touched genuinely advances to 211 (a real fix).** cov:
  be ~88.5%+ (~) / fe 88.73% (~). REMAINING trips: T5 analytics, then T6 eyes-on.
- **C210 (bug-scout DRY → feature: trips-location T3 — routes + Zod validation, 6 endpoints)** —
  Balance recompute (cycle 210): bug most-starved (37/3 = 12.33×) but the trips surfaces are certified
  (C203/C204/C207/C208) + no fresh non-trips prod logic → scout dry, recorded. NOTHING strictly over budget
  (feature 4/4 + arch 5/5 both AT threshold, not over) → highest-leverage open item = trips T3 (advances the
  active arc + adds genuinely new prod logic). Built `src/api/trips/{routes,validation}.ts`, registered at
  `/api/v1/trips`. validation.ts: createTripSchema (R2 endOdometer>=startOdometer cross-field refine + D4
  purpose z.enum [TRIP_PURPOSES exported for T5/T6] + R5 tripDate z.coerce.date() future-guard + D5 optional
  bounded locations/note) + updateTripSchema (partial, KEEPS the R2 refine so a both-odometer PUT can't
  invert). 6 endpoints mirroring the odometer-route idiom: POST / (vehicleId in body → validateVehicleOwnership
  pre-insert), GET / (paginated + vehicleId/purpose filters), GET /:id + PUT /:id (validateTripOwnership),
  DELETE /:id (tenant-safe deleteByIdAndUserId → 404 on foreign/absent), GET /vehicle/:vehicleId. DEVIATION
  (noted in spec): vehicle-scoped list is /api/v1/trips/vehicle/:vehicleId not /api/v1/vehicles/:id/trips
  (self-contained module boundary vs a cross-router add). HTTP tests (+18, trips-http.test.ts via createTestApp):
  create happy + R2/future/bad-purpose/unowned-vehicle-404; list paginated/filter/tenant-scope; get
  own/foreign-404; vehicle-list/unowned-404; update happy/R2-on-PUT/foreign-404-no-write; delete
  happy/foreign-404-removes-nothing(#52)/anon-401 — every ownership miss is 404 not 403 (#80). validate:local
  GREEN (tsc 0, musl 21 warn baseline, 1873 pass / 0 fail, +18, build bundled). Backend-only (UI is T6) → no
  shot. cov: be ~88.5%+ (~, new routes+validation fully covered by the HTTP suite; re-measure next cadence ~C219)
  / fe 88.73% (~). REMAINING trips: T5 analytics (getTripSummary), then T6 eyes-on FE. (Bug stays 173 — scout dry.)
- **C209 (bug-scout DRY → infra: cadence sweep + coverage re-measure)** —
  Balance recompute (cycle 209): bug most-starved (36/3 = 12×) but the trips surfaces are certified
  (C203/C204/C207/C208) and no fresh non-trips prod logic landed → scout dry, recorded. Next over-budget = INFRA
  (9/6 = 1.5×) AND the cadence sweep is overdue (last MEASURED C200, +9 commits / the GUIDE's ~10-cycle cadence).
  (1) UNTRACKED-TEST SWEEP: CLEAN both sides (no orphan *.test.ts); tree clean. (2) COVERAGE RE-MEASURED:
  **BE 88.53% line / 88.06% func (1855 pass) — UP +0.14 line / +0.07 func vs C200** (the C202–C208 trips arc:
  TripRepository fully covered + the new validateTripOwnership/validateVehicleFkRefs + the migration/round-trip/
  cascade/populate guards all add covered lines on REAL modules); **FE 88.73% line / 88.91% func / 80.68% branch /
  86.62% stmts (813 pass) — FLAT vs C200** (the trips arc is BACKEND-only so far; the FE eyes-on tail is T6, still
  ahead). (3) BOTH-SIDES GREEN: BE 1855 / FE 813, 0 fail. (4) BRANCH: claude-loop-dev = 63 ahead / 0 behind
  origin/main, PR-ready. Doc-only (coverage runs exercised the full suites; no source touched → no build/shot).
  STATE: the trips arc (T1+T4 C202, T2 C206) + its data-safety certs (C203/C204/C207/C208) is the loop's active
  productive vein; bug stays provably-dry (fixes only from a fresh feature surface or an Angelo product call), the
  two arch/deep-review veins re-exhaust after each trips increment opens a new rule-of-three / invariant. NEXT
  feature = trips T3 (routes + Zod). cov: be 88.53% / fe 88.73% (MEASURED). NEXT cadence ~C219.
- **C208 (deep-review: certify + guard the Sheets backup POPULATE-step coverage — the 3rd hand-maintained list)** —
  Balance recompute (cycle 208): bug most-starved (35/3 = 11.67×) but the trips surfaces are certified
  (C203/C204/C207) and no fresh non-trips prod logic landed → scout dry, recorded. Next over-budget = DEEP-REVIEW
  (7/5 = 1.4×; infra 8/6 = 1.33× but cadence isn't due till ~C210). Scouted the Google Sheets backup write path
  firsthand (a surface I TOUCHED in C204 without fully certifying). FOUND a real, un-pinned load-bearing invariant:
  `updateSpreadsheetWithUserData` builds a hand-maintained local `tables` array (one {title,rows,headers} per table)
  that drives the atomic swap — a THIRD hand list beyond SHEET_HEADERS (guard A/B) + SHEET_NAMES (C30), and the
  Sheets analog of the ZIP-side createBackup() populate step (pinned by backup-createbackup-keys). Certified firsthand
  it's CORRECT + in-order today (incl. the C204 Trips append). But it was UNGUARDED, and — critically — NOT caught by
  the existing round-trip/tab-order tests: createSpreadsheet builds the (empty) canonical tab from SHEET_NAMES anyway,
  and the Phase-2 delete+rename loop iterates `tables`, so a table OMITTED from the populate array leaves its stale/
  empty canonical tab in place → `titles === SHEET_NAMES` still passes while that table's real data is silently never
  written (NORTH_STAR #1 data-loss). No defect, but a genuine guard gap. GUARD: +2 in sheets-header-coverage.test.ts
  (C208 block) — source-scan the populate array's `title:` literals (scoped to the method body, ending at the
  writeAllSheetsAtomically call) + assert they equal SHEET_NAMES in order, + a non-vacuity floor. Non-vacuous (drop
  the Trips populate entry → RED, the diff shows `- "Trips"` missing while it stays in SHEET_NAMES; reverted). The
  C172 cross-file-list idiom. Test-only → no shot. validate:local GREEN (1855 pass / 0 fail, +2). cov: be ~88.4% (~)
  / fe 88.73% (~). The Sheets backup path is now drift-protected on ALL THREE hand lists (headers + tab-roster +
  populate). (Bug stays 173 — scout dry.)
- **C207 (bug-scout on the trips vehicle-delete cascade [CLEAN — no trip-photo orphan + already drift-guarded] → guard: pin the trips cascade end-to-end)** —
  Balance recompute (cycle 207): bug most-starved (34/3 = 11.33×). C206 added genuinely fresh prod logic
  (TripRepository) so a scout isn't ceremony — but I already tested that surface comprehensively (12 tests). Scouted
  the higher-value uncertified question: is the new `trips` table correctly handled by every cross-cutting
  table-enumerating system? Traced the VEHICLE-DELETE route firsthand — it explicitly reaps photos for `expense` +
  `odometer_entry` children BEFORE the FK-cascade (photos have NO FK → a pure cascade would orphan photo rows + leak
  provider bytes, the #C404/#34 class). Key scout question: CAN a trip have photos? **Verified CLEAN: `trip` is NOT a
  photo-upload entity type** (the validateEntityOwnership allowlist = vehicle/insurance_policy/insurance_claim/
  expense/odometer_entry; trips are free-text-only v1, D5) — so the photo-cleanup block correctly needs no trips leg,
  and the **C452 symmetry guard already keeps that drift-proof** (if `trip` is ever added to ENTITY_TO_CATEGORY
  without a cleanup call, C452 goes RED automatically). No defect. Per the GUIDE (clean scout → record + pivot to
  guard, bug drives but the artifact is a guard), closed the ONE genuine gap: the live invariant "deleting a vehicle
  FK-cascades its trips away" was unit-pinned at the raw-SQL level (migration-0007) but NOT through the real HTTP
  vehicle-delete ROUTE. +1 in vehicle-delete-cascade.test.ts (the natural home, alongside the expense/odometer
  cascade tests): seed a trip → DELETE the vehicle via the real route → assert zero trip rows survive (no orphan
  leaking into analytics/mileage-summary, NORTH_STAR #2). validate:local GREEN (1853 pass / 0 fail, +1). Test-only →
  no shot. cov: be ~88.4% (~) / fe 88.73% (~). (Bug stays 173 — scout clean, no fix; guard→207.)
- **C206 (bug-scout DRY → feature: trips-location T2 — TripRepository + validateTripOwnership)** —
  Balance recompute (cycle 206): bug most-starved (33/3 = 11×) but the trips surfaces are certified (C203 ZIP +
  C204 Sheets) and no fresh prod logic landed since C202 → scout dry, recorded. NOTHING else strictly over budget
  (feature/deep-review/infra all exactly AT budget: 4/4, 5/5, 6/6) → took the highest-leverage open item = trips T2
  (advances the only actively-building greenlit arc + adds genuinely new prod logic, which breaks the C201–C205
  bug-dry→guard/arch loop by giving future scouts a real surface). Built `TripRepository` (src/api/trips/
  repository.ts): extends BaseRepository (create/findById/update/delete) + userId-scoped finders
  (findByIdAndUserId / findByUserId(filters?) / findByVehicle / findByUserIdPaginated / findIdsByVehicleId) + a
  tenant-safe `deleteByIdAndUserId` keying on BOTH id AND userId (the #52 lesson — an id-only delete lets one user
  delete another's row) + an exported pure `tripDistance(start,end)` = max(0, end−start) clamp (R2/#46; distance
  DERIVED not stored, one source of truth for T3/T5). Added `validateTripOwnership` to the validateXOwnership family
  (validation.ts, C160 pattern; NotFound never 403 — #80 enumeration discipline; backed by the repo's userId-scoped
  read). Tests (+14): repository.test.ts (12 — CRUD, every finder userId-scoped, filter combos, pagination, and the
  REQUIRED #52 cross-tenant DELETE-scope regression: a foreign delete is a no-op→false) + tripDistance clamp (2,
  incl. the negative-guard). Behavior-additive (new table+module, zero existing behavior touched): backend
  validate:local GREEN (tsc 0, musl 21 warn baseline, 1852 pass / 0 fail, +12 net, build bundled). Backend-only →
  no shot. cov: be ~88.4% (~, new module fully covered) / fe 88.73% (~). REMAINING trips: T3 routes (consumes
  validateTripOwnership + the repo — likely surfaces the next arch rule-of-three) + T5 analytics, then T6 eyes-on.
  (Bug stays 173 — scout dry.)
- **C205 (bug-scout DRY → arch: converge the 3 byte-identical vehicleId-FK referential validators, +convergence guard)** —
  Balance recompute (cycle 205): bug most-starved (32/3 = 10.67×) but the trips surfaces are now BOTH certified (ZIP
  C203 + Sheets C204) and C203/C204 were test-only → no fresh prod logic since → scout dry, recorded. Next over-budget
  = ARCH (6/5 = 1.2×). **Arch's convergence vein was declared exhausted at C199 — but C202 genuinely added a THIRD
  copy of an existing pattern (validateTripRefs alongside the pre-existing validateFinancingRefs + validateOdometerRefs
  in backup.ts), tipping a real rule-of-three. NOT manufactured churn — the duplication predated me; trips tipped
  it.** The three were byte-identical save the entity label: iterate rows, `if (!vehicleIds.has(String(row.vehicleId)))
  push `${Label} ${row.id} references non-existent vehicle``. (validateExpenseRefs has an extra userId check, claim/
  junction have optional/second FKs — genuinely different, correctly LEFT alone; the clean boundary is exactly these
  3.) Converged onto one shared private `validateVehicleFkRefs(rows, vehicleIds, label)`; the 3 callers became
  one-line delegations preserving each message VERBATIM (behavior-preserving — no test asserts the strings, but a
  restore-UI/log consumer could). ARCH-RULE GUARD: +3 convergence cases in backup.test.ts drive all 3 through the
  PUBLIC validateBackupData with a bogus vehicleId + assert each emits its EXACT per-entity label, so a future
  "simplify the label" edit to the shared helper can't silently change one entity's text. Non-vacuous (rename the
  Trip label to 'Journey' → ONLY the Trip case RED, 2 pass/1 fail, verified firsthand; reverted). Behavior-preserving
  green→green: backend validate:local GREEN (tsc 0, musl 21 warn baseline, 1840 pass / 0 fail, +3 convergence cases,
  build bundled). Net LOC down (3 method bodies → 3 delegations + 1 helper). Backend-only refactor → no shot. cov: be
  ~88.4% (~) / fe 88.73% (~). **The arch convergence vein is exhausted AGAIN — next arch needs a fresh rule-of-three
  (likely surfaced by the trips T2/T3 repo+route build) or record no-churn-warranted + pivot.** (Bug stays 173 — scout dry.)
- **C204 (bug-scout on the trips GOOGLE SHEETS path [CLEAN — distinct serializer verified firsthand] → guard: pin the trips Sheets round-trip)** —
  Balance recompute (cycle 204): bug most-starved (31/3 = 10.33×, the ONLY strictly over-budget category). Cold-vein
  still doesn't apply (C202's trips pipeline is fresh prod logic; C203 was test-only). C203 certified the trips ZIP/CSV
  path's tripDate + merge-conflict — but the GOOGLE SHEETS path is a DISTINCT serializer (the explicit C193 lesson:
  formatValue → grid → parseValue, with its own hazards — parseValue re-coerces every cell: numeric-looking→Number,
  ISO-shaped→new Date()), and C202 wired trips into it (export tab + readback) WITHOUT a firsthand round-trip. Scouted
  that surface firsthand with a throwaway fake-Sheets probe: a trip with a non-midnight tripDate (2024-06-20T13:30:00Z)
  exports all 12 columns, tripDate serializes as the full ISO instant, reads back EXACTLY (parseValue's ISO regex →
  new Date()), odometers come back as numbers, the empty endLocation → null, text verbatim. **Bug scout CLEAN — no
  defect** (the Sheets serializer handles trips correctly). Per the GUIDE (verified clean → record + pivot), recorded
  the scout + pivoted to GUARD to close the gap: the Sheets trips round-trip had NO committed test (C193's lesson is
  the Sheets path needs its OWN guard, distinct from the ZIP path's trips-roundtrip.test.ts). Added to
  google-sheets-service.test.ts (+1, in the readSpreadsheetData describe, mirroring the C193 themePreference cert): a
  vehicle+trip seeded via the real DB → createOrUpdateVroomSpreadsheet → assert the Trips grid carries the ISO tripDate
  + the readback preserves vehicleId/odometers/purpose/tripDate-to-the-instant/locations(null)/note. Stable 14 pass ×3
  runs (an early single UNIQUE-users.email fail was the documented createTestApp DB-reset transient, not my test).
  Backend validate:local GREEN (1837 pass / 0 fail, +1). Test-only → no shot. The trips data-safety surface is now
  certified on BOTH backup serializers (ZIP C202/C203 + Sheets C204). cov: be ~88.4% (~, test-only) / fe 88.73% (~).
  (Bug stays 173 — scout clean, no fix; guard→204.)
- **C203 (bug-scout on the FRESH C202 trips pipeline [CLEAN — date/tz seam verified firsthand] → pivot to guard: pin the tripDate timestamp round-trip)** —
  Balance recompute (cycle 203): bug most-starved (30/3 = 10.0×). **The cold-vein precondition NO LONGER holds — C202
  added genuinely new backend prod logic (the trips table + the entire backup/restore/sheets pipeline) since the C183
  scout — so this is a REAL scout, not ceremony.** Scouted the highest-risk element I introduced: the `tripDate`
  **timestamp-mode** column surviving CSV + Sheets serialization (date/tz is the loop's richest bug vein — #87/#106/
  #131). Verified BOTH serializers firsthand (backup.ts convertToCSV + sheets formatValue both `Date→toISOString()`,
  structurally identical to odometer's certified `recordedAt`), then PROVED it with a throwaway probe: a non-midnight
  UTC instant (2024-06-20T13:30:00Z = 1718890200) round-trips EXACTLY through the real exportAsZip→restoreFromBackup
  stack. Also probed MERGE mode firsthand: a colliding trip id reports a CLEAN conflict `{table:'trips',id:...}` (the
  #93-class probe I wired works — no raw UNIQUE throw); the "clean-merge" no-op is the established always-collide-on-
  prefs/syncState behavior, not a trips defect. **Bug scout CLEAN — no defect** (the new pipeline mirrors the
  certified odometer path). Per the GUIDE (verified clean → record + pivot), recorded the scout and pivoted to GUARD
  (7/6 = 1.17× over, the next-most-starved) to close the gap the scout exposed: the C202 round-trip test asserted
  every trip field EXCEPT `tripDate`'s value, so a future serialization regression on the timestamp column wouldn't go
  red. STRENGTHENED trips-roundtrip.test.ts: the fully-populated case now seeds a non-midnight `trip_date` + asserts
  it survives to the exact second. Non-vacuous (temporarily truncating the serializer to `.toISOString().slice(0,10)`
  → RED with Expected 1718890200 / Received 1718841600, the exact 48600s midnight-shift; reverted). Test-only (no prod
  source) → no shot. Backend validate:local GREEN (1836 pass / 0 fail, unchanged count — a stronger expect in an
  existing test). cov: be ~88.4% (~, test-only) / fe 88.73% (~). (Bug stays 173 — scout clean, no fix; guard→203.)
- **C202 (feature: trips-location T1+T4 — `trips` table + migration 0007 + the FULL backup round-trip)** —
  Balance recompute (cycle 202): bug most-starved (29/3 = 9.67×) but provably-dry cold-vein (C199/C200/C201 were
  test/doc/FE-only — no backend prod logic changed since the C183 scout) → recorded DRY. Next over-budget = FEATURE
  (7/4 = 1.75×). CORRECTED a C200/C201 framing error: "feature is gated" was only true of theming PHASE 4 (the picker,
  gated on the `instrument` palette) — but THREE specs are greenlit (Angelo 2026-06-24), and TWO are UNSTARTED &
  fully loop-buildable: money-cents-migration + trips-location. Picked **trips-location** over money-cents on RISK:
  money-cents T1+T2 are a "land-together" data-safety core (schema-flip + backup shim) that doesn't fit one-task-per-
  starvation-cycle cleanly; trips T1 is purely additive (new table, no backfill, no call-site conversion — the spec
  itself names it the better unblock). **What landed: T1** — `trips` table (mirrors odometerEntries; distance derived
  not stored R2; no float-money column §7) + Trip types + migration `0007_previous_ikaris.sql` (additive CREATE TABLE
  + index, the 0003 class) via drizzle-kit + migration-0007.test.ts (+8: shape, cascade both FKs, pre-data survival,
  double-apply reject). **T1 forced T4** — the backup-table-coverage drift guard FAILS the moment a schema table
  isn't backed up (BY DESIGN, spec §4), so a persisted-but-un-backed-up table is NOT a coherent half-state; landed T4
  WITH T1 (the same data-safety "land-together" discipline money-cents mandates — NORTH_STAR #1: no silent loss). T4
  wired `trips` end-to-end: config (3 maps incl. OPTIONAL), ZIP export query+return, validateReferentialIntegrity
  (new validateTripRefs), restore FK-ordered insert + delete + ImportSummary + the merge-conflict PROBE
  (detectConflicts — userId-owned own-id-PK, the reminders/#93 precedent → clean conflict not raw UNIQUE throw),
  BackupData/ParsedBackupData types, AND the Google Sheets path (SHEET_HEADERS + SHEET_NAMES + export tab + readback,
  tolerating a missing tab in older backups). ALL THREE drift guards (backup-/restore-table-coverage +
  sheets-header-coverage) green; +4 trips-roundtrip.test.ts (field-for-field ZIP round-trip, null optionals, 3
  purposes, absent-vehicle REJECTED pre-wipe). Backend validate:local GREEN (tsc 0, musl 21 warn baseline / 0 error,
  **1836 pass / 0 fail** +13 vs C199, build bundled). Backend-only (route is T3, UI is T6) → NO eyes-on this cycle.
  NOTE: the C188–C199 seedVehicle waves left pre-existing warn-level `noUnusedImports` drift on HEAD (not CI-failing —
  `check:musl` exits 0; the "1 error" in a truncated run was a FORMAT violation in my own new file, fixed via
  check:musl:fix). cov: be ~88.4% (re-measure deferred to the next infra cadence; +13 tests, new table+pipeline
  covered) / fe 88.73% (~, untouched). REMAINING trips: T2 repo + T3 routes + T5 analytics (loop-buildable), T6
  eyes-on. (Bug stays 173 — provably-dry cold vein.)
- **C201 (bug-scout DRY → deep-review: certify the theming engine's FOUC contract, FIX the latent theme-id pre-paint gap)** —
  Balance recompute (cycle 201): bug most-starved (28/3 = 9.33×) but provably dry (C199/C200 were test/doc-only — no
  prod logic changed since the C183 scout, 20th consecutive) → recorded DRY. feature next (6/4 = 1.50× over) but its
  picker tail (T10) is Angelo-gated on the `instrument` palette → blocked, pivot. Most-starved ACTIONABLE over-budget =
  DEEP-REVIEW (8/5 = 1.60×). Opened it on the just-built theming engine (the freshest un-certified surface per the
  C200 milestone). Certified firsthand CLEAN: the token-contract chain (C181/C185/C186 — app.css 32 keys ≡
  THEME_TOKEN_KEYS ≡ default registry ≡ @theme aliases), the registry≡app.css value guard, the generated-CSS freshness
  guard, and the `.dark`/`data-theme` co-location on `<html>` (applyTheme sets both on documentElement). Found ONE real
  latent gap: theme.svelte.ts promises the `vroom-theme-id` mirror exists "so the anti-FOUC head-script + the store
  agree", but T8 wired ONLY the dark-class axis into app.html's pre-paint script — the theme-id axis was never
  pre-painted. NO-OP today (default-only → data-theme never set), so invisible + nothing red; but once `instrument`
  ships + is selected, every load would paint DEFAULT then FLASH to the chosen theme (the FOUC NORTH_STAR #3 forbids,
  on a 2nd axis the C190 guard can't see). FIX: app.html now reads `vroom-theme-id` + sets `data-theme` pre-paint,
  mirroring applyTheme (default/absent → no attribute). GUARD: extended theme-fouc-contract.test.ts (+3, C201 block) —
  pins the mirror key (THEME_ID_KEY parsed from store), the set-data-theme action, + the DEFAULT_THEME_ID sentinel
  (imported from registry) against app.html; a rename trips it unless app.html updates in lockstep. Non-vacuous
  (strip the data-theme setter → 3 RED, dark-axis 4 stay green — verified firsthand). Behavior-preserving today; closes
  the latent seam BEFORE the gated palette exposes it. FE validate:local GREEN (type-check + build + 813 pass, +3 vs
  C200). BE untouched. Pre-paint head-script is a no-op today (default-only) → nothing new to render → no shot (the
  eyes-on payoff materializes when `instrument` ships, Angelo-gated). cov: be 88.39% / fe 88.73% (~ — guard+html, no
  new prod-logic line; +3 tests). (Bug stays 173 — provably-dry cold vein.)
- **C200 (bug-scout DRY → deep-review scout [SATURATED] → pivot to infra: cadence sweep + coverage re-measure; milestone state-of-the-loop)** —
  Balance recompute (cycle 200): bug most-starved (27/3 = 9.0×) but provably dry (only theming code changed since
  the C183 scout, 19th consecutive — C199 test-only) → scout ceremony, recorded DRY. Highest over-budget after bug =
  deep-review (7/5 = 1.40×); scouted a fresh non-theming surface (the backup-orchestrator auto-backup / #43/#44
  fail-open family) firsthand — found CLEAN + already-saturated (5 test files incl. backup-orchestrator-execute; the
  anySuccess-gated persistence is sound + C144/#42-commented; the #43/#44 honest-HTTP-status piece is the
  product-gated ROUTE-layer escalation, not an orchestrator-internal defect). 3rd consecutive deep-review confirming
  the data-safety surface is comprehensively certified → recorded the deep-review as a no-fresh-target scout (NOT
  bumped) and pivoted to INFRA (over budget 8/6 = 1.33× AND cadence due, last MEASURED C192, +8 commits since).
  (1) UNTRACKED-TEST SWEEP: CLEAN both sides; tree clean. (2) COVERAGE RE-MEASURED: **BE 88.39% line / 87.99% func
  (1823 pass) — FLAT vs C192 (+1 test, C193 sheets cert); FE 88.73% line / 88.91% func / 80.77% branch / 86.68%
  stmts (810 pass) — UP +0.08 line / +8 tests vs C192 (C195 server-sync + C196 wiring store tests).** Both
  hold/up at the structural ceiling. (3) BOTH-SIDES GREEN: BE 1823 / FE 810, 0 fail. (4) BRANCH: claude-loop-dev =
  54 ahead / 0 behind, PR-ready. **MILESTONE STATE @ C200:** the loop's three self-directed veins are
  exhausted/saturated (arch convergence COMPLETE C199; bug cold-vein provably-dry 19×; deep-review data-safety
  certified) + theming Phases 1–3 engine-complete; the high-leverage remainder is Angelo-gated (instrument palette →
  picker T10; vehicle-sharing). Un-gated productive veins: guard (emergent cross-file contracts) + infra (cadence).
  Doc-only (coverage runs exercised the full suites; no source touched → no build/shot). cov: be 88.39% / fe 88.73%
  (MEASURED). NEXT cadence ~C210.
- **C199 (bug-scout DRY → deep-review scout [SATURATED] → pivot to arch: converge the LAST HTTP-route `seedVehicle` — CONVERGENCE PROJECT COMPLETE)** —
  Balance recompute (cycle 199): bug most-starved (26/3 = 8.67×) but provably dry (only theming code changed since
  the C183 scout, 18th consecutive — C198 test-only) → scout ceremony, recorded DRY. Most-starved over-budget after
  bug = DEEP-REVIEW (6/5 = 1.2×). Opened it on a fresh non-theming surface — the offline sync-manager
  conflict-resolution tree (determineConflictType / checkForExistingExpense / the retry path). **Scouted firsthand,
  found CLEAN + already-saturated:** amount uses cents-tolerant `Math.abs<0.01` (not exact float eq), tags use
  intentional `.some()` overlap with a `?.` null-guard, date `===` on the ISO string; the #133 NaN bug is fixed +
  commented, and #121/C424 retry-resurrection + C426 pending-recheck are guarded. No fresh defect (the data-safety
  veins are comprehensively certified after ~25 cycles). Per the GUIDE (no clean pick → record + pivot), recorded
  the deep-review as a no-fresh-target scout (NOT bumped) and pivoted the substantive work to ARCH. **Wave 12
  (FINAL) = the last HTTP-route seedVehicle:** expense-source-traceability (no-arg Honda Civic 2021, 21 call sites
  + a seedVehicleWithFinancing that calls it) converged onto the shared test-helpers/seed via a thin wrapper. **THE
  seedVehicle CONVERGENCE PROJECT IS COMPLETE: all 46 HTTP-route copies now use the ONE shared helper.** The lone
  remaining `seedVehicle` (google-sheets-service.test.ts) is correctly OUT of scope — a raw `db.insert` void seeder
  (no route POST, returns void), a DIFFERENT mechanism the route-based shared helper doesn't model. Behavior-
  preserving (green→green): the suite 21/21 pass; full backend validate:local GREEN (tsc 0, musl-biome clean, 1823
  pass / 0 fail — UNCHANGED count, pure test-helper refactor, build bundled). Net −4 LOC. Test-only → no shot. **The
  arch convergence vein is now EXHAUSTED — next arch cycles need a fresh dedup target or record "no churn warranted"
  + pivot.** cov: be 88.39% / fe 88.65% (~ — test-helper refactor, no prod line). (Bug stays 173 — provably-dry cold vein.)
- **C198 (bug-scout DRY → deep-review scout [SATURATED, caught a near-miss] → pivot to arch: converge `seedVehicle` wave 11, the make-param pair)** —
  Balance recompute (cycle 198): bug most-starved (25/3 = 8.33×) but provably dry (only theming code changed since
  the C183 scout, 17th consecutive — C197 test-only) → scout ceremony, recorded DRY. deep-review + infra both AT
  budget; infra cadence isn't due (C192, ~C202), so opened a DEEP-REVIEW on a NON-theming surface (deep-reviews had
  gone theming-heavy). **Scouted firsthand + found the surface SATURATED:** restore FK-ordering (guarded C13),
  split-amount cents-exactness (property-tested), themePreference round-trips (C180/C193) all already certified.
  Probed the #94 fleet-pooling class on `buildMonthlyConsumption` and **NEARLY committed a characterization
  asserting it pools unit-blind — then CAUGHT THE ERROR firsthand:** BACKLOG says #94 monthlyConsumption was CLOSED
  at C65, and the source confirms it (repository.ts:636 `buildMonthlyConsumptionConverted` converts per-vehicle
  volume before pooling for a mixed fleet; the pure builder is unit-blind BY DESIGN because conversion happens
  upstream), with the invariant ALREADY guarded (fuel-stats-fleet-distance-pooling.test.ts:349 "volume is converted
  to the user unit before pooling on a MIXED gal+L fleet"). My isolated-builder probe mischaracterized
  closed-and-correct code as broken — REVERTED the test before commit (verified the file is byte-identical to HEAD).
  Per the GUIDE "don't manufacture churn; verify firsthand, no clean pick → record + pivot," recorded the
  deep-review as a no-fresh-target sweep (deep-review NOT bumped — it produced no artifact) and pivoted the
  substantive work to ARCH (the Angelo-approved seedVehicle convergence). **Wave 11 = the remaining make-param
  pair** (odometer/update-route make-default Honda Civic 2021 + insurance/premium-expense-hook make-param model
  'Test' 2022): both converged onto the shared test-helpers/seed via a thin make wrapper preserving the exact prior
  payload. Behavior-preserving (green→green): both suites 15/15 pass; full backend validate:local GREEN (tsc 0,
  musl-biome clean, 1823 pass / 0 fail — UNCHANGED count, pure test-helper refactor, build bundled). Net −6 LOC.
  Test-only → no shot. **Progress: 45 of ~51 files converged**; REMAINING (2 + the distinct helper):
  expenses-source-traceability (+ its seedVehicleWithFinancing), google-sheets-service. cov: be 88.39% / fe 88.65%
  (~ — test-helper refactor, no prod line). LESSON (re-affirmed): a "HIGH"/escalation a deep-review surfaces can be
  ALREADY-CLOSED — check the BACKLOG closed-notes + the real call path before pinning a "characterization." (Bug
  stays 173 — provably-dry cold vein.)
- **C197 (bug-scout DRY [precondition] → pivot to arch: converge `seedVehicle` wave 10, the analytics pair — completes the analytics domain)** —
  Balance recompute (cycle 197): bug most-starved (24/3 = 8.0×) but provably dry (only theming UI plumbing + store
  wiring changed since the C183 scout, 16th consecutive — C196 test-only) → scout is ceremony. Recorded the
  bug-scout DRY; nothing else over budget → per GUIDE took the highest-leverage open item = the Angelo-approved
  seedVehicle convergence (arch). **Wave 10 = the analytics pair** (analytics-routes-http nickname-required Honda
  Civic 2021 + vehicle-tco-zero-state extra-bag Honda Civic 2021): converged both onto the shared test-helpers/seed
  — a nickname wrapper + an extra-bag wrapper (the shared SeedVehicleOptions already supports both `nickname` +
  `extra`), make/model/year explicit (shared default is a Camry). Both keep their other json/DataEnvelope refs so
  imports survive (caught + restored a wrongly-dropped import on the tco file before validating). **This COMPLETES
  the analytics domain.** Behavior-preserving (green→green): both suites 22/22 pass; full backend validate:local
  GREEN (tsc 0, musl-biome clean, 1823 pass / 0 fail — UNCHANGED count, pure test-helper refactor, build bundled).
  Net −9 LOC. Test-only → no shot. **Progress: 43 of ~51 files converged**; REMAINING (4): expenses-source-traceability
  (+ its distinct seedVehicleWithFinancing helper), insurance premium-expense-hook, odometer update-route,
  google-sheets-service. cov: be 88.39% / fe 88.65% (~ — test-helper refactor, no prod line). (Bug stays 173 —
  provably-dry cold vein.)
- **C196 (bug-scout DRY [precondition] → pivot to guard: pin the T9 settingsStore.load() → reconcileServerTheme wiring)** —
  Balance recompute (cycle 196): bug most-starved (23/3 = 7.67×) but provably dry (only theming UI plumbing + store
  wiring changed since the C183 scout, 15th consecutive — C195 store-logic/test-only) → scout is ceremony. Recorded
  the bug-scout DRY and pivoted to the co-over-budget GUARD (6/6, the only other category at/over). **The gap C195
  left:** theme-server-sync.test.ts (C195) pins `reconcileServerTheme` in ISOLATION (calling it directly), but
  NOTHING drove `settingsStore.load()` + asserted it actually invokes the reconcile with the fetched
  `settings.themePreference`. A refactor dropping that one line from load() would silently break cross-device theme
  sync (NORTH_STAR #2) with every existing test green — the classic unit-covered-but-wiring-unguarded seam. **GUARD:**
  +2 in settings-state-contract.test.ts (the store→settings-api→fetch[mocked] harness that owns load() contracts) —
  drives the REAL load() with a mocked GET returning a non-default themePreference + asserts the THEME store adopted
  it end-to-end (themeId + data-theme = 'instrument'); + a no-op case (absent server value → local mirror wins).
  NON-VACUITY PROVEN: dropping the reconcileServerTheme call from load() turns the adopt test RED; settings.svelte.ts
  restored byte-identical. VERIFY: frontend validate:local GREEN (svelte-check 0, build OK, 810 pass / 0 fail [+2]).
  Test-only → no shot. cov: be 88.39% / fe 88.65% (~ — store-wiring integration pin, no prod line). The theming
  engine's server-sync seam is now guarded end-to-end (unit C195 + wiring C196). (Bug stays 173 — provably-dry cold vein.)
- **C195 (bug-scout DRY [precondition] → pivot to feature: theming-engine T9 — server sync + hydrate reconcile; Phase 3 COMPLETE)** —
  Balance recompute (cycle 195): bug most-starved (22/3 = 7.33×) but provably dry (only theming UI plumbing changed
  since the C183 scout, 14th consecutive — C194 test-only) → scout is ceremony. Recorded the bug-scout DRY and took
  the highest-leverage open item = feature T9 (AT budget 4/4, the active greenlit theming build, unblocked: it
  wires the C179 settings field to the C191 store). **Built theming-engine T9:** (1) added `themePreference?` to the
  `UserSettings` FE type (mirrors the C174/C179 server field). (2) `setTheme` now pushes `themePreference` to the
  settings PUT via `persistThemeToServer` — FAIL-SOFT (not awaited + rejection swallowed, so a network/auth error
  can NEVER revert/blank the just-picked theme; the local mirror is the session source of truth, the server is
  best-effort durability). (3) new `themeStore.reconcileServerTheme(serverThemeId)` — the server-wins hydrate:
  `settingsStore.load()` calls it after the settings fetch; a server value differing from the mirror is adopted
  (mirror + data-theme updated) and NOT re-pushed (server already has it), equal/absent is a no-op. The store→
  settings-api dep is a service import (no store↔store cycle); settings store→theme store is a clean one-way edge.
  +tests (theme-server-sync.test.ts, +8): setTheme pushes, fail-soft rejection doesn't revert, reconcile adopts a
  differing server value / doesn't re-push / no-ops on equal+absent. VERIFY: frontend validate:local GREEN
  (svelte-check 0 errors, build OK, 808 pass / 0 fail [+8]). Store-logic wiring (unit-tested vs mocked settingsApi),
  no rendered surface (setTheme isn't UI-bound until the picker T10) → no shot. Ticked tasks.md T9. **theming Phase 3
  (store generalization + wiring, T8–T9) is COMPLETE — the engine is fully built + server-synced; Phase 4 is the
  picker UI (T10), GATED on the `instrument` palette (Angelo design call) since a picker needs a 2nd theme to pick.**
  cov: be 88.39% / fe 88.65% (~ — store wiring, fully unit-covered). (Bug stays 173 — provably-dry cold vein.)
- **C194 (bug-scout DRY [precondition] → pivot to arch: converge `seedVehicle` wave 9, the vehicles nickname pair — completes the vehicles domain)** —
  Balance recompute (cycle 194): bug most-starved (21/3 = 7.0×) but provably dry (only theming UI plumbing changed
  since the C183 scout, 13th consecutive — C193 test-only) → scout is ceremony. Recorded the bug-scout DRY and
  pivoted to the co-over-budget ARCH (6/5 = 1.2×) with the Angelo-approved seedVehicle convergence. **Wave 9 = the
  vehicles-domain NICKNAME pair** (vehicle-photo-routes-http Subaru Outback 2021 + vehicles-list-financing-contract
  Honda Civic 2022): both hand-redeclared a local `seedVehicle(nickname)`, converged onto the shared
  test-helpers/seed via a thin nickname wrapper (make/model/year explicit — the shared default is a Camry). Both
  keep their other json/DataEnvelope refs so imports survive. **This COMPLETES the vehicles domain** (no-arg pair
  C188 + nickname pair C194). Behavior-preserving (green→green): both suites 10/10 pass; full backend validate:local
  GREEN (tsc 0, musl-biome clean, 1823 pass / 0 fail — UNCHANGED count, pure test-helper refactor, build bundled).
  Net −10 LOC. Test-only → no shot. **Progress: 41 of ~51 files converged**; REMAINING (6): analytics
  (analytics-routes-http, vehicle-tco-zero-state), expenses-source-traceability (+ its seedVehicleWithFinancing),
  insurance premium-expense-hook, odometer update-route, google-sheets-service. cov: be 88.39% / fe 88.65% (~ —
  test-helper refactor, no prod line). (Bug stays 173 — provably-dry cold vein.)
- **C193 (bug-scout DRY [precondition] → pivot to deep-review: certify the themePreference GOOGLE SHEETS round-trip)** —
  Balance recompute (cycle 193): bug most-starved (20/3 = 6.67×) but provably dry (only theming UI plumbing changed
  since the C183 scout, 12th consecutive — C192 doc-only) → scout is ceremony. Recorded the bug-scout DRY and
  pivoted to the co-over-budget DEEP-REVIEW (7/5 = 1.4×, highest over-budget after the dry bug). **Fresh target the
  C174–C180 arc left:** C180 certified themePreference survives the ZIP/CSV backup round-trip, but the GOOGLE SHEETS
  path is a DISTINCT serializer (formatValue → grid → parseValue → coerceRow) with its own hazards (parseValue('')
  →null, numeric-looking ids) and was NEVER certified for the C174 column. **Verified firsthand:** the Sheets export
  includes themePreference via SHEET_HEADERS (C174) + the restore coerces it via TABLE_SCHEMA_MAP (so the C175
  NOT-NULL-default fix protects it too); drove the REAL fake-Sheets create→read chain — a non-default `instrument`
  theme survives intact (export grid carries the header+value; readSpreadsheetData reads it back as 'instrument').
  CLEAN, no defect. **GUARD:** +1 in google-sheets-service.test.ts (the existing fake-seam round-trip harness) —
  seeds a userPreferences row with a non-default theme, asserts the export grid carries it AND readSpreadsheetData
  round-trips it. Complementary to the C211 sheets-header-coverage guard (that pins the header EXISTS; this pins the
  VALUE survives read-back). NON-VACUITY PROVEN: dropping themePreference from SHEET_HEADERS turns the cert RED;
  restored byte-identical. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1823 pass / 0 fail [+1],
  build bundled). Test-only → no shot. cov: be 88.39% / fe 88.65% (~ — fake-seam round-trip cert, no prod line).
  The themePreference persistence arc is now certified on BOTH backup paths (CSV C180 + Sheets C193). (Bug stays
  173 — provably-dry cold vein.)
- **C192 (infra — branch-hygiene sweep + coverage re-measure; cadence, last MEASURED C184)** —
  Balance recompute (cycle 192): bug most-starved (19/3 = 6.33×) but provably dry (only theming UI plumbing changed
  since the C183 scout, 11th consecutive — no backend write-path/money/date gold seam) → scout is ceremony. Among
  the other over-budget cats, infra (8/6 = 1.33×) edged deep-review (6/5 = 1.2×) AND — unlike C191 — was NOT
  ceremony: the C185–C191 arc added 5 new FE theming modules + ~6 test files, real new surface worth re-measuring
  (cadence ~due). (1) UNTRACKED-TEST SWEEP: CLEAN both sides; working tree clean. (2) COVERAGE RE-MEASURED: **BE
  88.39% line / 87.99% func (1822 pass) — FLAT vs C184 (BE untouched since C188); FE 88.65% line / 88.82% func /
  80.77% branch / 86.57% stmts (802 pass) — UP +0.20 line / +37 tests vs C184.** FE moved UP because the theming
  modules landed WELL-COVERED (resolve-theme 100% line, theme.svelte 100% func, theme-registry/types all guarded;
  themes-css 85.71% — the uncovered = the empty-registry placeholder + non-default-block path, exercised once
  `instrument` ships) — genuine new covered surface, not flat. Both above the structural ceiling. (3) BOTH-SIDES
  GREEN: BE 1822 / FE 802, 0 fail. (4) BRANCH STATE: claude-loop-dev = 46 commits ahead of fresh origin/main, 0
  behind, PR-ready. NOTE: feature is BUILDING — theming Phase 3 T9 (server sync + hydrate reconcile) is the next
  feature increment; the picker T10 + theme-color migration await the `instrument` palette (Angelo design call).
  Doc-only (coverage runs exercised the full suites; no source touched → no build/shot). cov: be 88.39% / fe 88.65%
  (MEASURED). NEXT cadence ~C202.
- **C191 (bug-scout DRY [precondition] → pivot to feature: theming-engine T8 — the store themeId axis)** —
  Balance recompute (cycle 191): bug most-starved (18/3 = 6.0×) but provably dry (only theming-engine
  pure/build-time code changed since the C183 scout, 10th consecutive) → scout is ceremony; infra over (7/6) but
  its cadence isn't due (C184 measured ~C194, nothing changed coverage materially → an early re-measure is also
  ceremony). Recorded the bug-scout DRY and took the highest-leverage open item = the active greenlit theming build
  (Phase 3). **Built theming-engine T8 (core):** extended `theme.svelte.ts` with the `themeId` axis ORTHOGONAL to
  the light/dark mode (D3): a `vroom-theme-id` localStorage mirror, `themeId` getter, `setTheme(id)`, and
  `applyTheme(preference, themeId)` now sets `<html>` `data-theme` (non-default id → the attribute that selects a
  themes.css block; `default` → attribute REMOVED so app.css's bare :root serves the identity) alongside `.dark`.
  `initialize()` applies BOTH axes; `setPreference`/`setTheme` each preserve the OTHER axis; the matchMedia OS
  listener preserves the active id. The existing `setPreference`/`current`/`initialize` API + its consumers
  (ThemeCard, +layout) are untouched (verified: those tests + theme-fouc-contract all stay green). +unit tests
  (theme-id-axis.test.ts, +6): setTheme persists+sets data-theme, default removes it, mode↔id orthogonality BOTH
  directions, unknown id degrades gracefully (R8, never throws). **DELIBERATELY deferred (flagged to Angelo, NOT
  self-authorized): the theme-color meta still uses the hard-coded brand hex by mode** — migrating it to the
  RESOLVED theme's brand token is a VISIBLE browser-chrome change (PWA status-bar tint; uncapturable by shot.sh +
  an oklch-in-`<meta>` compat question), a design sub-part deferred until a non-default theme ships; likewise the
  app.html head-script `data-theme` set (id-axis anti-FOUC leg) is moot until a non-default theme exists. VERIFY:
  frontend validate:local GREEN (svelte-check 0 errors, build OK, 802 pass / 0 fail [+6]). Store-logic (jsdom-tested),
  no new rendered surface (the picker is T10) → no shot. Ticked tasks.md T8 [~]. **NEXT: T9** (server sync + hydrate
  reconcile — setTheme pushes themePreference to the settings PUT [the C179 field]; on settingsStore.load() server
  wins if it differs from the mirror). cov: be 88.39% / fe 88.45% (~ — store axis, fully unit-covered).
- **C190 (bug-scout DRY [precondition] → pivot to guard: pin the app.html anti-FOUC head-script ↔ theme-store contract)** —
  Balance recompute (cycle 190): bug most-starved (17/3 = 5.67×) but the only prod change since the last real scout
  (C183) is theming-engine pure/build-time code (registry data, resolver, themes.css generator + a zero-rule css
  import) — no reachable user-facing write-path defect surface, 9th consecutive provably-dry cold vein → scout is
  ceremony. Recorded the bug-scout DRY and pivoted to the co-over-budget GUARD (7/6 = 1.17×). The theming work
  surfaced a real UNGUARDED cross-file contract: app.html runs an inline anti-FOUC `<script>` BEFORE first paint
  that reads `localStorage.getItem('vroom-theme-preference')` + sets the `dark` class on <html> — duplicating FOUR
  load-bearing constants the theme store owns (the STORAGE_KEY, the `dark` class, the `system` sentinel, the
  `(prefers-color-scheme: dark)` query). app.html is RAW HTML outside the type system + the store's tests, so a
  store-side rename of any of them would silently flash light-on-dark every load (NORTH_STAR #3) with NOTHING going
  red. **GUARD:** theme-fouc-contract.test.ts (+4) source-scans BOTH files and asserts they agree on all four (the
  store's STORAGE_KEY literal is parsed from source + asserted present in app.html's getItem; the dark class, the
  media query, and the `system` default likewise). NON-VACUITY PROVEN: renaming STORAGE_KEY → 'vroom-theme-pref-v2'
  (the exact FOUC-breaking drift) turns the key-mirror test RED; store restored byte-identical. VERIFY: frontend
  validate:local GREEN (svelte-check 0, build OK, 796 pass / 0 fail [+4]). Test-only → no shot. cov: be 88.39% / fe
  88.45% (~ — cross-file source-scan, no runtime line). (Bug stays 173 — provably-dry cold vein. Feature: theming
  Phase 3 T8 is the next feature increment.)
- **C189 (bug-scout DRY [precondition] → pivot to feature: theming-engine T7 — themes.css generator + load seam, eyes-on)** —
  Balance recompute (cycle 189): bug most-starved (16/3 = 5.33×) but the only prod change since the last real scout
  (C183) is theme data + the uncalled C187 resolver → 8th consecutive provably-dry cold vein, scout is ceremony.
  Recorded the bug-scout DRY and pivoted to the highest-leverage open item = the active greenlit theming build.
  **Built theming-engine T7:** `themes-css.ts` — a PURE generator (`generateThemesCss`/`themeBlocks`/
  `nonDefaultThemeIds`) emitting one `:root[data-theme="<id>"]` (light) + `:root[data-theme="<id>"].dark` (dark)
  block per NON-default registry theme. **Design call: `default` is EXCLUDED** — app.css already owns its bare
  `:root`/`.dark` (data-theme absent = default), so generating a default block would duplicate + risk drift, and
  the C185 guard already pins default≡app.css. Checked-in `themes.css` generated from THEME_REGISTRY (a placeholder
  today — only `default` registered) + imported in `+layout.svelte` right after app.css (Vite bundles it into the
  head stylesheet → zero-FOUC non-default paint, zero JS token duplication). **GUARD:** themes-css.test.ts (+7) —
  generator emits both selectors with ALL tokens (synthetic theme), excludes default, AND the committed themes.css
  == generateThemesCss(THEME_REGISTRY) BYTE-FOR-BYTE (adding a registry theme without regenerating trips it — the
  C25/C170 source-scan idiom applied to a codegen artifact). **EYES-ON (GUIDE UI gate — touches +layout.svelte):**
  booted (START_SERVERS+RESET_DB), regress.sh GREEN (91 pass), shot /dashboard + Read the PNG → renders
  BYTE-IDENTICAL to the default look (the zero-rule themes.css import is a clean no-op; no FOUC, no console errors,
  no visual regression). VERIFY: frontend validate:local GREEN (svelte-check 0, build OK, 792 pass / 0 fail [+7]).
  Ticked tasks.md T7. **NEXT: Phase 3 T8** (extend theme.svelte.ts — the `themeId` axis: `vroom-theme-id` mirror,
  `setTheme(id)`, `applyTheme()` sets `data-theme` + the theme-color meta; the head-script `data-theme` set lands
  here too). cov: be 88.39% / fe 88.45% (~ — pure generator + a zero-rule css import + guards). **theming Phase 2
  (T4–T7, the model+registry+resolver+css engine) is COMPLETE; Phase 3 wires it to the store/UI.**
- **C188 (bug-scout DRY [precondition] → pivot to arch: converge `seedVehicle` wave 8, the vehicles no-arg pair)** —
  Balance recompute (cycle 188): bug most-starved (15/3 = 5.0×) but the only prod change since the last real scout
  (C183) is theme DATA + the pure UNCALLED C187 resolver (no reachable runtime/logic surface) → 7th consecutive
  provably-dry cold vein, scout is ceremony. Recorded the bug-scout DRY and pivoted to the co-over-budget ARCH
  (6/5 = 1.2×) with the concrete Angelo-approved pick: the seedVehicle convergence. **Wave 8 = the vehicles-domain
  no-arg pair** (vehicle-delete-cascade + vehicle-stats-current-odometer): delete-cascade's fixture IS the shared
  default (Toyota Camry 2022) → a no-arg `seedVehicleShared(ctx)` wrapper, zero opts; stats-current-odometer is a
  Honda Civic 2021 + initialMileage 10000 → make/model/year explicit + initialMileage via `extra` (preserving the
  cross-source-MAX baseline the tests assert). Both keep their other json/DataEnvelope refs so imports survive.
  Behavior-preserving (green→green): both suites 19/19 pass; full backend validate:local GREEN (tsc 0, musl-biome
  clean, 1822 pass / 0 fail — UNCHANGED count, pure test-helper refactor, build bundled). Net −4 LOC. Test-only →
  no shot. **Progress: 39 of ~51 files converged**; REMAINING (~10): the 2 vehicles nickname files
  (photo-routes-http Subaru Outback, list-financing-contract Honda Civic), analytics (analytics-routes-http,
  vehicle-tco-zero-state), expenses-source-traceability (+ its seedVehicleWithFinancing), insurance
  premium-expense-hook, odometer update-route, photos entity-ownership-gate, google-sheets-service. cov: be 88.39%
  / fe 88.45% (~ — test-helper refactor, no prod line). (Bug stays 173 — provably-dry cold vein.)
- **C187 (bug-scout DRY [precondition] → pivot to feature: theming-engine T6 — the pure total theme resolver)** —
  Balance recompute (cycle 187): bug most-starved (14/3 = 4.67×) but the only prod change since the last real scout
  (C183) is theme DATA (theme-registry.ts), no logic surface → 6th consecutive provably-dry cold vein, scout is
  ceremony. Recorded the bug-scout DRY and pivoted to the highest-leverage OPEN item = the active greenlit theming
  build (feature not over budget but the most leverage + fully unblocked). **Built theming-engine T6:**
  `resolve-theme.ts` — `resolveTheme(themeId, mode, systemPref)`, a PURE TOTAL resolver: `resolveThemeDefinition`
  (id→def, `default` fallback R8 via `Object.hasOwn` so Object.prototype keys can't false-hit) + `resolveVariant`
  (mode→light/dark; `system`→systemPref, garbage→light) + the composed `resolveTheme` returning the token map.
  Never throws — any malformed input degrades to default's light variant (a corrupted persisted theme can't blank
  the UI). Fully deterministic from `default` + the type model (both present) — NO design call. +unit tests
  (resolve-theme.test.ts, +12): every built-in × {light,dark}; `system` follows OS pref; explicit mode ignores
  pref; unknown id→default; empty/null/garbage never throws + yields a COMPLETE token map (no partial-leak);
  prototype-pollution (`constructor`/`toString`→default). VERIFY: frontend validate:local GREEN (svelte-check 0
  errors, build OK, 785 pass / 0 fail [+12]). Pure module + unit tests, no UI render → no shot. Ticked tasks.md T6.
  **NEXT: T7** (themes.css generation + the anti-FOUC `data-theme` head seam — emits one block per registry theme;
  still unblocked on `default` alone). cov: be 88.39% / fe 88.45% (~ — pure resolver, fully unit-covered).
- **C186 (bug-scout DRY [precondition] → pivot to deep-review: certify the theming token-contract chain + pin the @theme-alias↔managed-set link)** —
  Balance recompute (cycle 186): bug most-starved (13/3 = 4.33×) but the only prod change since the last real scout
  (C183) is `theme-registry.ts` — pure token DATA, no runtime consumer/logic surface, so a scout there is ceremony.
  Recorded the bug-scout DRY and pivoted to the co-over-budget DEEP-REVIEW (6/5 = 1.2×) with the freshest target:
  the T4/T5 theming arc I just built. **Certified the token-contract chain firsthand:** app.css `:root`/`.dark` (32
  keys) ≡ THEME_TOKEN_KEYS (32, C181 guard) ≡ `default` registry (C185 guard) ≡ the `@theme inline` Tailwind
  `--color-*` aliases (32). The LAST link — every `--color-<x>: var(--<raw>)` alias references an engine-MANAGED raw
  token — was the one UN-pinned invariant: a `--color-foo: var(--foo)` alias whose raw token isn't in
  THEME_TOKEN_KEYS would resolve STALE when T7 swaps `data-theme` (a visual leak the registry/token guards can't
  see). Verified firsthand: all 32 aliases map 1:1 onto the 32 managed keys — CLEAN, no leak. **GUARD:** extended
  theme-token-keys.test.ts (+2) — parses the `@theme inline` block, extracts every `--color-*`→`var(--raw)`
  reference, asserts each raw token is in THEME_TOKEN_KEYS (so a NEW Tailwind color alias — a routine app.css edit —
  can't land without adding its token to the engine). NON-VACUITY PROVEN: injecting a rogue `--color-rogue:
  var(--rogue-unmanaged)` turns it RED naming the exact token; app.css restored byte-identical. VERIFY: frontend
  validate:local GREEN (svelte-check 0 errors, build OK, 773 pass / 0 fail [+2]). Test-only → no shot. cov: be
  88.39% / fe 88.45% (~ — source-scan guard, no runtime line). The theming token contract is now drift-protected
  end-to-end (the C181+C185+C186 guard triad). (Bug stays 173 — provably-dry cold vein.)
- **C185 (bug-scout DRY [precondition] → pivot to feature: theming-engine T5 — the `default` theme registry + identity guard; `instrument` design-gated)** —
  Balance recompute (cycle 185): bug most-starved (12/3 = 4.0×) but the precondition holds — `git diff
  ac5f7e1(C184)..HEAD -- src` is EMPTY (C184 was doc-only), 5th consecutive provably-dry cold vein; re-scanning is
  ceremony. Recorded the bug-scout DRY and pivoted to FEATURE (AT budget 4/4, edging deep-review on
  buildability) = the active greenlit theming build. **Built theming-engine T5 (the `default` half):**
  `theme-registry.ts` — `THEME_REGISTRY` + `DEFAULT_THEME_ID`, with `default`'s light+dark token maps transcribed
  VERBATIM from app.css `:root`/`.dark` (all 32 keys × 2 variants). **GUARD:** theme-registry.test.ts (+6) — the
  registry-integrity contract: `default` ≡ app.css VALUE-FOR-VALUE (parses the live app.css at test time → proves
  zero visual change for existing users + catches baseline drift), every definition declares ALL THEME_TOKEN_KEYS
  in BOTH variants (no missing-key leak), + NO stray keys. The value-for-value test passing also PROVES the 64
  transcribed oklch values are byte-exact. **DELIBERATELY did NOT build the first non-default theme `instrument`**
  (the spec's other T5 half): its 32-token oklch palette must be distilled from the design-language mock + AA-tuned
  (A3/R10/D4) — a product/DESIGN call, not loop-self-authorizable (NORTH_STAR: never self-invent a feature's design;
  the mock dir is a gitignored working file, absent). The registry + guard accept it with zero structural change
  (add one ThemeDefinition). FLAGGED to Angelo via the tasks.md T5 note. VERIFY: frontend validate:local GREEN
  (svelte-check 0 errors, build OK, 771 pass / 0 fail [+6]). Pure data + source-scan guard, no UI render → no shot.
  Ticked tasks.md T5 as [~] (default done, instrument gated). **NEXT: T6** (resolveTheme — total resolver, pure,
  unblocked: it only needs `default` + the type model, both present). cov: be 88.39% / fe 88.45% (~ — token data +
  a guard, no runtime branch).
- **C184 (infra — branch-hygiene sweep + coverage re-measure; the ~10-cycle cadence, last MEASURED C176)** —
  Balance recompute (cycle 184): bug most-starved (11/3 = 3.67×) but the precondition holds — `git diff
  649c854(C183)..HEAD -- src` is EMPTY (C183 was test-only) + four consecutive verified-clean firsthand scouts
  (C178/C180/C182/C183), so re-scanning a provably-unchanged cold vein is ceremony (C99/C103/C107). Recorded the
  bug-scout DRY and took the next over-budget category = INFRA (7/6 = 1.33×), whose cadence was genuinely DUE
  (flagged C183, last measured C176). (1) UNTRACKED-TEST SWEEP: CLEAN both sides — zero untracked
  `.test.ts`/`.spec.ts`; working tree clean. (2) COVERAGE RE-MEASURED: **BE 88.39% line / 87.99% func (1822 pass);
  FE 88.45% line / 88.92% func / 80.57% branch / 86.37% stmts (765 pass).** Both FLAT vs C176 (BE line identical;
  FE +0.01 line) — the C177–C183 arc added +14 BE / +5 FE tests (C178 reminder-split-config guard, C179
  themePreference HTTP, C180 theme round-trip, C181 theme-token-keys, C182 financing converge, C183
  coalesce-completeness), ALL guards/test-helpers/types in already-covered modules, so the covered-line ratio held
  (the expected guard/fix-cycle signature, not a stall). Both at the structural ceiling (DI/OAuth/SQL BE +
  effect/DOM FE). (3) BOTH-SIDES GREEN: BE 1822 / FE 765, 0 fail. (4) BRANCH STATE: claude-loop-dev = 38 commits
  ahead of fresh origin/main, 0 behind, PR-ready. NOTE: feature is BUILDING — theming Phase 1 (T1–T3) done +
  certified, T4 (FE types) done; T5 (theme-registry) is the next feature increment. Doc-only (coverage runs
  exercised the full suites; no source touched → no build/shot). cov: be 88.39% / fe 88.45% (MEASURED). NEXT cadence ~C194.
- **C183 (bug-scout DRY [verified firsthand] → pivot to guard: pin the #293 financing coalesce-list completeness)** —
  Balance recompute (cycle 183): bug most-starved + extreme (10/3 = 3.33×); infra also over (7/6 = 1.17×). C182 was
  test-only, but at 3.33× (+ the C137 lesson: the cold precondition rules out REGRESSIONS, not PRE-EXISTING debt)
  did a GENUINE firsthand scout of an un-recently-audited money-facing write path: the **financing** create/update
  routes (#27/#90/#91/#92/#99 family). **VERIFIED CLEAN firsthand:** all writes ownership-gated (POST→
  validateVehicleOwnership, PATCH/payoff/DELETE→validateFinancingOwnership); the PATCH is narrowly scoped (paymentAmount
  only, can't switch type); the create-or-replace path's #67 re-activate + #293 cross-type coalesce-to-null + #92
  loan-terms validation are all intact; and I CENSUSED the coalesce list against the live schema — it covers EXACTLY
  the nullable cross-type/schedule columns (apr, paymentDayOfMonth/Week, residualValue, mileageLimit, excessMileageFee
  + endDate:null), every other column .notNull(). No fresh defect. Per C122/C163 (verified-dry bug → pivot the
  substantive work to a co-productive vein), pinned the merge-survival GAP the scout surfaced: the #293 coalesce-list
  completeness is load-bearing but UNGUARDED — the existing behavioral test (refinance-cross-type-field-reset)
  enumerates today's fields by hand, so a FUTURE nullable financing column would leave the replace path silently
  merging it stale (reopening #293) while every test stays green. **GUARD:** refinance-coalesce-completeness.test.ts
  (+3) — censuses the live `vehicleFinancing` nullable columns via getTableColumns, subtracts the system-managed
  timestamps, and asserts EACH remaining one is explicitly handled in the replace-path SET object (source-scan, the
  C25/C170/C172 idiom). NON-VACUITY PROVEN: dropping `mileageLimit` from the SET turns it RED naming the exact field;
  restored byte-identical. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1823 pass / 0 fail [+3],
  build bundled). Test-only → no shot. cov: be 88.39% / fe 88.44% (~ — schema-reflection source-scan, no prod line).
  (Bug stays 173 — verified-dry cold vein. Infra cadence is due ~C186; deferred this cycle to close the scout's gap.)
- **C182 (bug-scout DRY [verified firsthand] → pivot to arch: converge `seedVehicle` wave 7, the financing domain pair)** —
  Balance recompute (cycle 182): bug most-starved + heavily forcing (9/3 = 3.0×); arch + infra AT budget (5/5, 6/6).
  C181 changed prod source but it was a types-only file (theme-types.ts, no runtime defect surface), so rather than
  auto-dry at 3.0× I did a GENUINE firsthand scout on an un-recently-audited write path (GUIDE validation-asymmetry
  seam): the **odometer** routes (the #68/#76/#180 getCurrentOdometer family). **VERIFIED CLEAN firsthand:** every
  path is ownership-gated (validateVehicleOwnership / validateOdometerOwnership); POST+PUT both recheck mileage
  reminders; the repo UNION-ALL legs are userId-scoped (vehicleScope = `vehicle_id AND user_id`, #48); and the PUT's
  `BaseRepository.update(id)` is id-only BUT guarded by a preceding `validateOdometerOwnership(id,user.id)` that
  404s a cross-tenant id before any write. No asymmetry, no leak, no fresh defect. Per C122/C163 (verified-dry bug →
  pivot the substantive work), pivoted to ARCH (AT budget; infra cadence not due till ~C186) with a concrete
  Angelo-approved pick: the seedVehicle convergence. **Wave 7 = the financing domain pair** (financing-deactivate-hook
  + financing-get-contract): both hand-redeclared a byte-identical local `seedVehicle(nickname)` → Honda Civic 2022,
  so one mechanical rule converges both onto the shared test-helpers/seed via a thin nickname wrapper (make/model/year
  explicit — the shared default is a Camry). Behavior-preserving (green→green): both suites 9/9 pass; full backend
  validate:local GREEN (tsc 0, musl-biome clean, 1820 pass / 0 fail — UNCHANGED count, pure test-helper refactor,
  build bundled). Net −10 LOC. Test-only → no shot. **Progress: 37 of ~51 files converged**; REMAINING (~11): analytics
  (analytics-routes-http, vehicle-tco-zero-state), expenses (expense-source-traceability + its seedVehicleWithFinancing),
  insurance premium-expense-hook, odometer update-route, photos entity-ownership-gate, google-sheets-service, vehicles
  (delete-cascade no-arg, photo-routes-http, list-financing-contract, stats-current-odometer). cov: be 88.39% / fe
  88.44% (~ — test-helper refactor, no prod line). (Bug stays at 173 — a provably/verified-dry cold vein.)
- **C181 (bug-scout DRY [precondition] → pivot to feature: theming-engine T4 — the FE theme type model + token-key census guard)** —
  Balance recompute (cycle 181): bug most-starved (8/3 = 2.67×) but the precondition holds — `git diff
  50b78a8(C180)..HEAD -- src` is EMPTY (C180 was test-only), so the cold vein is provably dry; re-scanning is
  ceremony (C99/C103/C107). Recorded the bug-scout DRY and pivoted to the highest-leverage open item = the active
  greenlit theming build, now in Phase 2 (pure FE, no UI). **Built theming-engine T4:** `frontend/src/lib/theme/
  theme-types.ts` — the type model. **Load-bearing census done firsthand:** scanned app.css and found `:root`
  (light) + `.dark` (dark) declare an IDENTICAL 32-key color-token set; `--radius` is the lone `:root`-only
  (variant-invariant layout) token → excluded from the per-variant `ThemeTokenKey`. Types: `ThemeId`, `ThemeMode`
  (RE-EXPORTED from the existing store's `ThemePreference` — single source of truth, not a competing redeclaration),
  `ThemeTokenKey` (the 32 keys), `ThemeTokens` (full Record), `ThemeVariant`, `ThemeSource`, `ThemeDefinition`
  (id/label/description/swatch/light/dark/source) + a frozen `THEME_TOKEN_KEYS` tuple (`satisfies readonly
  ThemeTokenKey[]`). Types only — no values (T5), no registry, no runtime. **GUARD:** theme-token-keys.test.ts (+5)
  source-scans app.css `:root`/`.dark` and pins light/dark parity + `THEME_TOKEN_KEYS` == the live `.dark` set
  EXACTLY + `--radius` excluded — so a future token add/remove forces a matching types update (can't silently
  desync the engine). The guard passing also PROVES the 32 keys were transcribed correctly. VERIFY: frontend
  validate:local GREEN (svelte-check 0 errors, build OK, 765 pass / 0 fail [+5]). Pure types + source-scan, no UI
  render → no shot (spec: T4 is types-only). Ticked tasks.md T4. **NEXT: T5** (theme-registry.ts — `default`'s
  light+dark maps extracted verbatim from app.css + the first non-default theme `instrument`; the T5 integrity test
  uses `THEME_TOKEN_KEYS`). cov: be 88.39% / fe 88.44% (~ — types + a source-scan guard, no runtime line).
- **C180 (bug-scout DRY [verified firsthand] → pivot to deep-review: certify the theming-persistence backup round-trip = theming-engine T3)** —
  Balance recompute (cycle 180): bug most-starved (7/3 = 2.33×). The precondition flipped vs C179 — C179 CHANGED
  production source (settings/routes.ts), so a scout is non-ceremonial this time. Scouted a genuinely fresh write-path
  surface firsthand (GUIDE validation-asymmetry seam): the **insurance claims** create/update path (#84/#125 class —
  PUT skipping a POST-enforced validation). **VERIFIED CLEAN firsthand:** both POST (288) + PUT (305) call
  `validateClaimRefs` (owned-vehicleId + term-on-THIS-policy); the repo update/delete are doubly-scoped
  (`findById(policyId,claimId)` precheck + `WHERE id AND policy_id` on the write) — no cross-policy/cross-tenant leak;
  and the #84/#125 surface is ALREADY fully guarded (C247/C369 cover POST+PUT vehicleId+termId rejection). No fresh
  defect, and no guard gap to fill there. Per C122/C163 (forced-but-dry bug → pivot the substantive work to a
  co-productive vein), pivoted to DEEP-REVIEW (next over-budget-adjacent, AT budget 5/5) with a genuinely fresh,
  uncertified target: the C174+C175+C179 theming-PERSISTENCE arc's backup→restore round-trip. **Certified firsthand:**
  themePreference rides the schema-derived CSV column set + the C174 Sheets header + the C175 coerceRow
  NOT-NULL-default safety; a non-default theme survives the TRUE `exportAsZip → restoreFromBackup('replace')` stack.
  This certification IS theming-engine **T3's** deliverable, so ticked T3. **GUARD:** +theme-preference-roundtrip.test.ts
  (+3): non-default theme survives the real round-trip, default round-trips as `'default'` (control), a paired sibling
  pref (currencyUnit) survives alongside (no field dropped). NON-VACUITY PROVEN: dropping themePreference on coerce →
  the two non-default tests RED; restored. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1820 pass /
  0 fail [+3], build bundled). Test-only → no shot. (Bug stays at 173 — a provably-dry cold vein; it'll keep being
  scouted+pivoted until prod source changes meaningfully.) cov: be 88.39% / fe 88.44% (~ — round-trip guard, no prod
  line). theming T1+T2+T3 (the whole backend-persistence phase) now DONE + certified; NEXT is T4 (FE theme-types, pure).
- **C179 (bug-scout DRY [precondition] → pivot to feature: theming-engine T2 — the settings PUT themePreference field)** —
  Balance recompute (cycle 179): bug most-starved (6/3 = 2.0×), feature next over (5/4 = 1.25×). Took bug first, but
  the anti-ceremony precondition is decisive: `git diff 877a26f(C178)..HEAD -- src` is EMPTY — ZERO production source
  changed since the last (C178) scout, and C177/C178 were both verified-clean firsthand scouts. Per C99/C103/C107,
  re-scanning provably-unchanged surfaces is pure ceremony → recorded the bug-scout DRY immediately and PIVOTED to
  the co-over-budget FEATURE vein (genuinely buildable — theming is greenlit + building). **Built theming-engine
  T2:** the settings PUT `themePreference` field. **Probed firsthand first:** the C174 column was ALREADY accepted +
  persisted (createInsertSchema auto-derived it) and the partial PUT ALREADY merges siblings correctly — BUT it was
  an UNBOUNDED string (a 5000-char id persisted; an empty '' persisted). FIX: added an EXPLICIT
  `themePreference: z.string().min(1).max(64).optional()` to `updateSettingsSchema.extend()` (a storage/abuse bound;
  not an allow-list — the T6 resolver treats an unknown id as `default`, so any <=64-char value is safe). Routed
  through the existing row-level `repository.update` merge (the #82 per-field discipline — a field not sent is left
  untouched). +HTTP tests (theme-preference.test.ts, +7): fresh user defaults to `'default'`, PUT persists + GET
  round-trips, per-field merge BOTH directions (theme survives a currency PUT + vice-versa), >64 + empty rejected
  (400, stored value unchanged), omitted is a no-op. NON-VACUITY PROVEN: dropping the bound turns exactly the
  length+empty guards RED; restored. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1817 pass / 0
  fail [+7], build bundled). Backend route/schema only, no UI render → no shot. Ticked tasks.md T2. **NEXT: T3**
  (backup round-trip — SHEET_HEADERS already has themePreference [C174]; T3 = the round-trip guard test + restore
  re-applies the theme). cov: be 88.39% / fe 88.44% (~ — one bounded schema field + HTTP guards).
- **C178 (bug-scout DRY [verified firsthand] → pivot to guard: pin the reminder split-config cross-tenant defense end-to-end)** —
  Balance recompute (cycle 178): bug the ONLY category strictly over budget (5/3 = 1.67×). Owed a GENUINE fresh
  scout (last cycle was dry-then-pivot), so scouted the GUIDE write-path validation-asymmetry gold seam on an
  un-recently-certified surface: the **reminder split-config vehicleId** path (#88 family — an FK in a JSON blob
  that can bypass the junction ownership check). Hypothesis: a PUT could smuggle a foreign vehicle via
  `expenseSplitConfig.vehicleIds` while omitting top-level `vehicleIds` (which alone is ownership-checked).
  **VERIFIED FIRSTHAND via a real createTestApp HTTP probe** (created an expense reminder on an owned vehicle +
  a second user's vehicle seeded directly): the path is **CLEAN** — defended in DEPTH by two layers: (a) the PUT's
  merge+re-parse runs `createReminderSchema` on `{existing.vehicleIds, ...partial}`, so the split-vs-vehicleIds
  MATCH invariant rejects a foreign blob when vehicleIds is omitted (400 "Split config vehicle IDs must match
  vehicleIds"); (b) when vehicleIds IS sent, `validateVehicleIdsOwned` rejects it (400 "Vehicles not found or not
  owned"). Nothing leaked. NO fresh defect → recorded DRY (a verified-clean scout, not assumed). **Per the
  C122/C163 discipline (bug forced but dry → pivot the substantive work to the co-productive guard vein, AT budget
  6/6), pinned the real gap the scout surfaced:** the HTTP-level COMPOSITION of these two layers had no test —
  existing coverage is (b) standalone (reminders-http.test.ts:106) + the match invariant at the schema-UNIT level
  (reminder-refinements.test.ts:146), but nothing drove a foreign id reachable ONLY through the split blob at the
  route boundary. +1 in reminders-http.test.ts: a PUT with a foreign vehicle in the split config (vehicleIds
  omitted) → 4xx, the explicit-both variant → 4xx, and the junction still holds ONLY the owned vehicle (no leak).
  NON-VACUITY PROVEN: neutering the `refineSplitConfig` match-check (the #88-class defense) turns exactly this
  guard RED; restored validation.ts byte-identical. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean,
  1810 pass / 0 fail [+1], build bundled). Test-only → no shot. cov: be 88.39% / fe 88.44% (~ — HTTP-harness guard,
  no prod line). The #88-family split-config cross-tenant surface on the reminder PUT path is now drift-protected.
- **C177 (bug-scout DRY → pivot to arch: converge `seedVehicle` wave 6, the expenses make-param + nickname-optional pair — completes the expenses domain)** —
  Balance recompute (cycle 177): bug most-starved over budget (4/3 = 1.33×), arch next (6/5 = 1.20×). Took bug
  first: checked #140 (the queue's standing "clean one-edit, eyes-on-deferred" candidate) — it's ALREADY FIXED +
  merged (BACKLOG C68 eyes-on confirmed it; removed-stale C1), NOT open. The cold pure-logic vein is dry, so per
  the C163 discipline scoped the production source changed since the last bug scout (C173): ONLY the C174/C175
  backup-path surface (themePreference column, coerceRow restore-safety) — and C175 was itself a deep-review that
  CERTIFIED that surface firsthand. Also confirmed the new themePreference write path is clean: the settings PUT
  schema is a closed `.partial()` z.object, so it strips (doesn't persist) themePreference until T2 adds it — no
  injection. Re-scouting an already-certified surface is ceremony (C99/C103/C107), so recorded the bug-scout DRY
  and PIVOTED the substantive work to the co-over-budget arch vein. **ARCH (Angelo-approved seedVehicle
  convergence, wave 6):** converged the last two expenses-domain locals — delete-split-child.test.ts (make-param,
  Honda/Toyota model 'Test' year 2021 → thin make wrapper) + export-csv.test.ts (nickname-optional, Honda Civic
  2021 → seedCivic wrapper). Both keep make/model/year explicit (shared default is a Camry) so behavior is
  preserved; export-csv dropped its now-unused json+DataEnvelope imports, delete-split-child dropped DataEnvelope.
  **This COMPLETES the expenses domain** (no-arg subset C164 + import pair C171 + this pair). Behavior-preserving
  (green→green): the 2 suites 12/12 pass; full backend validate:local GREEN (tsc 0, musl-biome clean, 1808 pass /
  0 fail — UNCHANGED count, pure test-helper refactor, build bundled). Net −10 LOC. Test-only → no shot. **Progress:
  35 of ~51 files converged**; REMAINING (~13): analytics (analytics-routes-http, vehicle-tco-zero-state),
  financing (deactivate-hook, get-contract), insurance premium-expense-hook, odometer update-route, photos
  entity-ownership-gate, google-sheets-service, vehicles (delete-cascade, photo-routes-http,
  list-financing-contract, stats-current-odometer) + the distinct seedVehicleWithFinancing helper. cov: be 88.39%
  / fe 88.44% (~ — test-helper refactor, no prod line).
- **C176 (infra — branch-hygiene sweep + coverage re-measure; the ~10-cycle cadence, last MEASURED C169)** —
  Balance recompute (cycle 176): infra the ONLY category strictly over budget (7/6 = 1.17×); bug + arch sat AT
  budget (3/3, 5/5). Took infra — the cadence was due (~7 cycles since C169) and the C168–C175 arc added real
  production surface (json_patch primitive, the themePreference column + migration 0006, the coerceRow
  restore-safety fix) worth re-measuring. (1) UNTRACKED-TEST SWEEP: CLEAN both sides — zero untracked
  `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` are by-design); working tree clean. (2) COVERAGE
  RE-MEASURED: **BE 88.39% line / 87.99% func (1808 pass); FE 88.44% line / 88.92% func / 80.66% branch / 86.43%
  stmts (760 pass).** Both FLAT vs C169 (BE line identical; FE +0.09 branch / +0.07 stmts) — the C170–C175 arc
  added +16 BE / +1 FE tests, but ALL in already-covered modules (RMW drift guard C170, source-link
  validate-before-persist C172, migration-0006 C174, coerceRow restore-safety C175) or a repo branch now covered,
  so the covered-line ratio held (more tests at the same ratio = the expected guard/fix-cycle signature, not a
  stall). Both at the structural ceiling (DI/OAuth/SQL BE + effect/DOM FE, unchanged in character). (3) BOTH-SIDES
  GREEN: BE 1808 / FE 760, 0 fail. (4) BRANCH STATE: claude-loop-dev = 30 commits ahead of fresh origin/main, 0
  behind, PR-ready. NOTE: feature is BUILDING (theming-engine T1 done C174; T2 = settings PUT field is next). Doc-only
  (coverage runs exercised the full suites; no source touched → no build/shot). cov: be 88.39% / fe 88.44% (MEASURED).
  NEXT cadence ~C186.
- **C175 (deep-review — certify the C174 NOT NULL column survives backup-restore; found+fixed a REAL restore-abort class)** —
  Balance recompute (cycle 175): nothing strictly OVER budget; deep-review + infra both AT budget (5/5, 6/6). Infra's
  cadence isn't due (C169 measured, next ~C179), so took deep-review on the freshest, highest-leverage target: C174
  just added a NOT NULL column, whose top data-safety risk (NORTH_STAR #1) is whether an old/partial backup still
  RESTORES. The DatabaseMigrations.md steering doc explicitly flags the `coerceRow` footgun for NOT-NULL-with-default
  columns. **VERIFIED FIRSTHAND (scratch probe driving the REAL coerceRow + a real insert into the migrated table):**
  - column ABSENT (old backup predating it) → key stays absent → SQLite applies DEFAULT 'default' → SAFE.
  - present-but-EMPTY ('' / 'null' / 'NULL') → coerceRow blindly nulled it → **INSERT THREW `NOT NULL constraint
    failed` → the WHOLE replace-mode restore aborts** (the user recovers NOTHING from their own valid backup). REAL
    defect, NOT a false HIGH. Reachable via the Sheets path (parseValue('') → null) + the CSV/ZIP path on a blank cell;
    and NOT C174-specific — `currencyUnit`/`backupFrequency`/`unitPreferences`/`syncInactivityMinutes` shared the
    latent gap (C174 widened the surface, surfacing the pre-existing class).
  **FIX (one place, principled generalization):** in `coerceRow`, an empty/null value for a NOT NULL column carrying
  a STATIC default now resolves to that default instead of null — exactly what the code already did for booleans
  (`col.default ?? false`), generalized to all types via `col.notNull && col.hasDefault && col.default !== undefined`.
  Re-probed: all empties (theme/currency/freq/units/mins) now fall back to their defaults; real values preserved; JSON
  default round-trips. **GUARD:** +5 in backup.test.ts (the non-boolean sibling of the existing empty-NOT-NULL-boolean
  block) — pins each NOT-NULL-text-default column coerces empty→its column `default` (driven off the REAL schema
  metadata so it can't drift), a full row-of-empties stays insert-schema-valid, the absent-key case stays safe, and a
  real value isn't over-coerced. NON-VACUITY PROVEN: reverting the fix turned exactly the 4 new guards RED with the
  precise diagnostics; restored byte-identical. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1808
  pass / 0 fail [+5], build bundled). Repo-layer fix + test-only, no UI → no shot. cov: be 88.39% / fe 88.44% (~ — a
  branch in coerceRow + guards; the restore-safety contract is now pinned class-wide). This both certifies C174's
  column is restore-safe AND closes a pre-existing restore-abort class for every NOT-NULL-default column.
- **C174 (feature — theming-engine T1: the additive `userPreferences.themePreference` column + migration 0006)** —
  Balance recompute (cycle 174): feature most-starved (7/4 = 1.75×) and now genuinely UNBLOCKED (3 greenlit specs),
  so this is the cycle feature STOPS recording-and-pivoting and BUILDS. Took the loop's standing recommendation:
  theming-engine T1, the cleanest entry (additive schema leg, no eyes-on). **Did:** added `theme_preference text
  NOT NULL DEFAULT 'default'` to userPreferences (schema.ts) — fully additive, `'default'` reproduces today's look
  byte-for-byte so existing rows backfill with zero visual change (D2: only the theme ID persists here; light/dark
  mode stays device-local). Generated the migration via `db:generate` → `0006_mixed_zarek.sql` (`ALTER TABLE
  user_preferences ADD theme_preference text DEFAULT 'default' NOT NULL`) + snapshot + journal (NOT db:push — the
  steering-doc-correct path; drizzle-kit generate works fine on this host, only push is bun-broken). **Caught by a
  guard (the loop working as designed):** the sheets-header-coverage drift guard (cycle-211) went RED — a schema
  column missing from `SHEET_HEADERS` is silently dropped on a Google Sheets backup. Added `themePreference` to
  `SHEET_HEADERS.userPreferences` in schema-order (the full backup round-trip + its OWN guard test is the tracked T3;
  this header addition is the minimum to keep the column from silently dropping + the tree green). **Verify:**
  migration-0006.test.ts (+4) — column exists, NOT NULL + dflt `'default'`, a pre-0006 prefs row backfills
  `'default'`, a new insert omitting it takes the default; migration-general applies all 7 in sequence. Confirmed on
  the REAL path: a fresh `DATABASE_URL=… db:init` produces `theme_preference TEXT NOT NULL dflt 'default'` (cid 11).
  Backend validate:local GREEN (tsc 0, musl-biome clean, 1803 pass / 0 fail [+4], build bundled). Backend schema/
  migration only, no UI render → no shot. Ticked tasks.md T1. **NEXT: T2** (settings PUT Zod field +
  per-field-merge #82 discipline + GET round-trip + HTTP tests). cov: be 88.39% / fe 88.44% (~ — schema + migration
  + config header; migration tests + header guard cover the new surface).
- **C173 (bug — the #79 "Needs attention" card misdirected the user to the WRONG missing field; fix + source-scan guard)** —
  Balance recompute (cycle 173): bug most-starved (5/3 = 1.67×), over with feature (6/4 = 1.50×, unblocked but lower
  ratio). Took bug. The cold pure-logic vein is dry, so per the C163 discipline scouted the production source CHANGED
  since the last bug scout (C163): the C165 FE offline partition (OfflineExpenseCards.svelte + expenses/+page.svelte),
  not yet bug-scouted. **REAL DEFECT FOUND (eyes-on/surfacing-accuracy, NORTH_STAR #1):** the "Needs attention" card
  description told the user "a fuel entry needs its AMOUNT and mileage" — but the parking GATE is
  `isIncompleteFuelExpense` = `(!volume && !charge) || !mileage`, which NEVER checks amount. So the card named a field
  that is ALWAYS present on a parked row (formatCurrency(amount) renders right below it) while OMITTING the real
  culprit (fuel volume/charge). #79/C165's entire purpose is a FIXABLE surfacing of a permanently-unsyncable row — a
  message pointing at the wrong field defeats it. The sync-manager's own permanent-error text already says the right
  thing ("require volume/charge and mileage"); the card had drifted. **FIX:** corrected the copy to "a fuel entry needs
  its fuel amount — volume or charge — and mileage", matching the codified gate + the sync-manager message (a bounded
  copy fix, NOT a semantics change — the gate was already decided/codified, so loop-fixable, not Angelo-gated).
  **GUARD:** +1 source-scan in offline-storage.test.ts (the #79 parking describe) — pins the card copy names the gate's
  real fields (volume/charge + mileage) AND must NOT revert to "needs its amount and mileage" (no .svelte render
  harness exists in the project → source-scan is the merge-surviving net, the GUIDE idiom). NON-VACUITY PROVEN:
  reverted the copy → the guard went RED with the exact line; restored. EYES-ON (GUIDE UI gate): booted
  (START_SERVERS+RESET_DB), seeded a parked malformed fuel row + a pending row via localStorage (addInitScript), shot
  /expenses + Read the PNG — three sections render correctly, the amber "Needs attention" card shows the corrected
  description, no overflow, theme-consistent. VERIFY: frontend validate:local GREEN (tsc 0, build OK, 760 pass / 0 fail
  [+1]). cov: be 88.39% / fe 88.44% (~ — a .svelte copy line + a source-scan guard; component-render coverage is the
  eyes-on FE tail, not unit-countable). The C165 offline-partition surface is now bug-scouted + the fix guarded.
- **C172 (guard — tree-wide validate-before-persist source-scan for the #62/#109/#125/#145 financing-source-link class)** —
  Balance recompute (cycle 172): guard most-starved (9/6 = 1.50×), over with bug (4/3 = 1.33×) + feature (5/4 = 1.25×,
  unblocked but lowest ratio). Took guard. The guard queue is empty + pure-logic coverage is saturated, so picked the
  GUIDE's merge-survival idiom (C25/C271/C170): a structural source-scan pinning a load-bearing invariant tree-wide.
  **The invariant:** the within-tenant financing-source-link integrity class (#62/#109/#125/#145, just closed C465) is
  enforced across all FOUR expense-write paths (POST / · PUT /:id · POST /split · PUT /split/:id) by
  `assertFinancingSourceValid`/`assertSplitFinancingSourceValid` — a forged `{sourceType:'financing', sourceId}` link
  is the exact predicate `computeBalance` sums, so an unvalidated one understates the displayed loan balance
  (NORTH_STAR #1). But every existing test is BEHAVIORAL (per-path HTTP) — a behavioral test for path N can't protect a
  FUTURE path N+1. **Verified firsthand FIRST (no defect):** all 4 paths validate; the 5th persist method
  (`importExpenses`) is source-link-free BY CONSTRUCTION (CSV has no sourceType column — import-csv.ts/import-mapping.ts
  never set sourceType/sourceId). New `expense-source-validation-coverage.test.ts` (+3): (1) pins the write surface =
  exactly 4 persist calls (a 5th forces a guard update) + importExpenses present; (2) asserts every persist call is
  preceded WITHIN ITS HANDLER by a source-link validator (slices routes.ts from the enclosing `routes.post/put(` to the
  persist offset, requires an `await assert(Split)?FinancingSourceValid(` in between); (3) pins the import path stays
  source-link-free. **NON-VACUITY PROVEN:** temporarily removed the POST / validator → the per-handler test went RED with
  the precise diagnostic; restored routes.ts byte-identical to HEAD (verified `git diff` empty). VERIFY: backend
  validate:local GREEN (tsc 0, musl-biome clean / 20 baseline warnings, 1799 pass / 0 fail [+3], build bundled).
  Test-only; no production source → no shot. A new unguarded expense-write path now trips the guard (forces
  validate-or-pin). cov: be 88.39% / fe 88.44% (~ — source-scan guard, no new covered prod lines).
- **C171 (arch — converge the `seedVehicle` test helper, wave 5: the expenses nickname-import pair; Angelo-approved vein)** —
  Balance recompute (cycle 171): arch most-starved by RATIO (7/5 = 1.40×), edging guard (8/6 = 1.33×); feature
  is UNBLOCKED but only AT budget (4/4 = 1.0×), deep-review/bug/infra under. Per the C169 ratio-tiebreak, took
  arch — and it had a genuine clean pick (NOT manufactured churn, arch rule 5): the Angelo-approved seedVehicle
  convergence, the wave C164 explicitly deferred. **Wave 5 = the expenses nickname-required IMPORT pair**
  (import-csv + import-mapping-route): both hand-redeclared a byte-identical local `seedVehicle(nickname: string)`
  → Honda Civic 2021, so a single mechanical rule converges both onto the shared `test-helpers/seed` seedVehicle.
  make/model/year passed EXPLICITLY (the shared default is a Toyota Camry) to preserve each fixture exactly — the
  import-csv suite depends on the literal "2021 Honda Civic" name-match + the #102 same-year/make/model ambiguity
  cases, so the model identity is load-bearing. import-csv wraps it in a thin `seedCivic(nickname)` (24 call sites
  with 3 nicknames); import-mapping-route inlines `seedVehicle(ctx, {…})` (10 sites, one nickname). Net −12 LOC,
  two more local copies gone. Behavior-preserving (green→green): full backend validate:local GREEN (tsc 0,
  musl-biome clean / 20 warnings baseline, 1796 pass / 0 fail — UNCHANGED count, a pure test-helper refactor adds
  no test, build bundled). Test-only → no shot. **Progress: 33 of ~51 files converged** (insurance 5 + reminders
  15 + sync 5 + expenses-no-arg 6 + expenses-nickname-import 2). REMAINING (~18): the expenses make-param/nickname
  one-offs (delete-split-child make-param, export-csv nickname-optional, expense-source-traceability +
  its distinct seedVehicleWithFinancing) + the scattered analytics/financing/photo/odometer/vehicles one-offs.
  cov: be 88.39% / fe 88.44% (~ — test-helper refactor, no prod line touched).
- **C170 (deep-review — certify the C168 `json_patch` primitive + census the remaining #100 RMW sites; +drift guard)** —
  Balance recompute (cycle 170): deep-review most-starved (8/5 = 1.6×), over with arch (6/5) + guard (7/6).
  Took deep-review with a FRESH invariant from the C168 arc: does the new atomic `mergeJsonField` compose
  safely with the userPreferences write sites that still read-modify-write, and did C168 leave a regression?
  Censused every `preferencesRepository.update` touching a JSON config column (storageConfig/backupConfig)
  firsthand: exactly **4 RMW sites remain** — settings-PUT merge (validation-coupled, tracked #100 follow-up),
  providers create-auto-populate + cleanupStorageConfig (the latter read-DEPENDENT — can't be a static patch),
  and backup-orchestrator's wholesale auto-backup write. **Finding (CLEAN, no new defect):** C168 is sound —
  it converted the CLEANEST site (cleanupBackupConfig) to atomic and the primitive is correct (pinned C168).
  The orchestrator↔provider-delete interleave is a REAL but PRE-EXISTING #100 instance (the wholesale write
  from a stale read could clobber a concurrent atomic delete) — NOT a C168 regression, and the backup mutex
  serializes backup RUNS but not provider-deletes; it's already in the tracked #100 follow-up surface. Left a
  merge-surviving SOURCE-SCAN drift guard: prefs-rmw-inventory.test.ts (+4) pins the exact RMW-call count per
  file (settings 1 / providers 2 / orchestrator 1) + asserts cleanupBackupConfig uses the atomic path — so a
  NEW unguarded RMW write trips it (forces atomic-or-track). VERIFY: backend validate:local GREEN (tsc 0,
  musl-biome clean, 1796 pass / 0 fail [+4], build bundled). Test-only; no production source, no render → no
  shot. cov: be 88.39% / fe 88.44% (~ — source-scan guard, no new covered lines). The #100 follow-up scope is
  now precisely bounded + drift-protected; converting the orchestrator/settings-PUT sites stays a tracked
  arch/bug item.
- **C169 (infra — branch-hygiene sweep + coverage re-measure; the ~10-cycle cadence, last MEASURED C154)** —
  Balance recompute (cycle 169): infra (8/6 = 1.33×) + deep-review (7/5 = 1.4×) over budget. deep-review edged
  by ratio, but its frontiers are freshly-certified (C162 #79, C157 resolveNewUser, C168's own guard) while
  infra had a CONCRETE overdue task — the cadence sweep, ~15 cycles since C154, and the C155–C168 arc added
  real production modules (auth email-preservation, the json_patch primitive) worth re-measuring. Took infra.
  (1) UNTRACKED-TEST SWEEP: CLEAN both sides — zero untracked `.test.ts`/`.spec.ts` (the gitignored
  `.meshclaw.e2e.ts` are by-design). (2) COVERAGE RE-MEASURED: **BE 88.39% line / 87.99% func (1792 pass); FE
  88.44% line / 88.92% func / 80.57% branch / 86.36% stmts (759 pass).** Both UP vs C154 (BE 88.33/87.91; FE
  88.24/88.72/80.25, 752 pass) — BE +0.06 line (C155 auth + C168 json_patch guards), FE +0.20 line / +7 tests
  (the C165 #79-surfacing FE partition + C162/C163 guards). Both hold above 88% line at the structural ceiling
  (residual DI/OAuth/SQL BE + effect/DOM FE, unchanged in character). (3) BOTH-SIDES GREEN: BE 1792 / FE 759,
  0 fail. (4) BRANCH STATE: claude-loop-dev = 23 commits ahead of fresh origin/main, 0 behind, PR-ready
  (recorded here since BRANCH_REVIEW.md is gitignored). NOTE: feature is now UNBLOCKED — 3 specs greenlit
  (theming/money-cents/trips, restored C167); the next feature-over-budget cycle BUILDS (theming T1 recommended).
  Doc-only (coverage runs exercised the full suites; no source touched → no build/shot). cov: be 88.39% / fe
  88.44% (MEASURED). NEXT cadence ~C179.
- **C168 (bug #100 — atomic `json_patch` userPreferences merge; first write site; Angelo-decided)** —
  Balance recompute (cycle 168): bug most-starved (5/3 = 1.67×), over with infra (7/6) + deep-review (6/5).
  Took bug — and rather than a (dry) cold-scout, executed the Angelo-DECIDED #100 (SQL-atomic prefs merge),
  the last loop-fixable decided bug (the rest of the queue is product/semantics-gated). **The defect:** the
  userPreferences write pattern (`getOrCreate` → JS-merge → `update`) is a read-modify-write with a
  lost-update race — two concurrent requests merge their deltas onto the same stale snapshot, last-writer
  clobbers the other (the #82 per-provider fix closed the within-request wipe but not the across-request
  interleave). **Fix (Angelo-decided: SQL-atomic `json_patch` in one UPDATE, no migration):** added
  `PreferencesRepository.mergeJsonField(userId, column, patch)` — a single `UPDATE … SET col =
  json_patch(coalesce(col,'{}'), ?)` that deep-merges (RFC-7386) inside the DB engine with no JS
  read-then-write gap. Verified the semantics firsthand first (deep-merge recurses; scalar/array replaces;
  `null` deletes a key). Applied it to the cleanest race site — **`cleanupBackupConfig`** (provider-delete):
  the old read→JS-delete→write became one atomic `{ providers: { [id]: null } }` patch (null-delete removes
  just that provider, siblings survive even under a concurrent write). Per Angelo's "one write site at a
  time" — the settings-PUT merge site is LEFT for a follow-up because it validates the MERGED result
  (`validateStorageConfig`/`validateBackupConfig`) between read and write + uses the bespoke #82
  per-provider merge, so an atomic-patch swap there needs care (validation ordering + null-delete vs
  intentional category-clearing); flagged in BACKLOG. **Guards:** the existing C245 delete-cleanup HTTP test
  stays green (behavior-preserving on the changed site); NEW prefs-atomic-merge.test.ts (+3) pins the
  primitive — deep-merge, null-delete, and THE RACE PROPERTY (two concurrent delta-patches both survive),
  with a non-vacuity assertion modelling the old RMW losing the first writer. VERIFY: backend validate:local
  GREEN (tsc 0, musl-biome clean, 1792 pass / 0 fail [+3], build bundled). Backend-only → no shot. #100 is
  PARTIALLY closed (the cleanup site + the reusable atomic primitive); the settings-PUT site is the tracked
  follow-up. cov: be 88.39% / fe 88.44% (~ — repo method + one route site, guarded).
- **C167 (feature — CORRECTION: restore Angelo's parallel-agent greenlights that C166 wrongly reverted)** —
  **C166 was WRONG.** Angelo greenlit theming-engine + money-cents-migration + trips-location on 2026-06-24
  via a PARALLEL agent (deliberately, so the loop wouldn't block) — those approvals landed as committed T0
  flips with NO in-session message to the loop. C166 misread the absence of an in-session record as
  "fabricated" and reverted money-cents + trips to BLOCKED (and a follow-on partial cycle had also drafted a
  reversal of theming). Angelo corrected this directly in-session. C167 RESTORED all three greenlights:
  money-cents + trips T0 restored from the authoritative `2a3303e` (Angelo's agent's commit); theming-engine
  kept APPROVED (discarded the bad uncommitted reverts). **vehicle-sharing stays BLOCKED** — Angelo greenlit 3,
  not it (asked him to confirm whether it should be greenlit too; holding until he says). Corrected the
  committed BACKLOG feature intro + theming entry to "GREENLIT & BUILD-UNBLOCKED" and recorded the durable
  lesson (workspace mem): a committed Angelo greenlight WITHOUT an in-session message is LEGITIMATE — never
  revert one as fabricated; ASK first. Docs-only → no build/shot. **Feature is now UNBLOCKED**: next feature
  cycle builds the most-starved of the 3 greenlit specs (theming T1 = the `userPreferences.themePreference`
  column is the recommended start — additive, no eyes-on for the schema leg). cov: be 88.39% / fe 88.44% (~).
- **C166 (feature — draft + commit the theming-engine + vehicle-sharing specs; flag Angelo; clean up a prior errored cycle's drift)** —
  Balance recompute (cycle 166): feature most-starved (12/4 = 3.0×) and BLOCKED — but a prior cycle (errored
  mid-task on a Bedrock API failure) had drafted NEW spec artifacts under `.kiro/specs/`, so the
  self-authorizable feature action ("draft a spec + flag Angelo, don't build") was already in flight. This
  cycle RECOVERED + completed that work. **Found uncommitted:** (1) a complete `theming-engine` spec
  (requirements+design+tasks) — a first-class theme-token-swap engine on the existing app.css custom-property
  system, ZERO component rewrites (R1); (2) an INCOMPLETE `vehicle-sharing` spec (req+design, no tasks.md) —
  finished it by writing the gating tasks.md (T0 sign-off + phased backend-first, IDOR-disciplined per
  C108–C116); (3) accurate import-trackers tasks.md housekeeping (T4/T5 → [x] reflecting the landed
  C148/C153); (4) ⚠️ **two FABRICATED greenlights** — the errored cycle flipped money-cents-migration T0 AND
  trips-location T0 to "✅ GREENLIT by Angelo 2026-06-24" with NO record of any such approval. **REVERTED both**
  (`git checkout` — never propagate an unverified product greenlight; both are back to BLOCKED at T0). Net:
  committed the two complete-and-BLOCKED new specs + the BACKLOG feature-section rewrite (4 specs now drafted &
  awaiting sign-off: theming-engine D1–D7, vehicle-sharing D1–D8, trips-location D1–D6, money-cents D1–D5 —
  NONE greenlit) + the import-trackers housekeeping. Docs-only (specs + loop docs; no source touched) → no
  build/shot. Escalated all four specs' sign-off gates to Angelo (the feature category cannot advance until he
  ratifies at least one). cov: be 88.39% / fe 88.44% (~ — docs-only). NEXT feature cycle: still blocked until a
  T0 clears; record + pivot.
- **C165 (feature — surface the #79 "needs-attention" parked offline entries on /expenses; eyes-on; the C159 follow-on)** —
  Balance recompute (cycle 165): feature most-starved by far (12/4 = 3.0×, blocked ~6 cycles) but the deep-review
  /guard frontiers are worked through (broadly certified/saturated). Rather than another record-and-pivot, took
  the ONE genuinely-unblocked feature-ish increment: the C159 #79 FOLLOW-ON. This is NOT a net-new capability
  needing a fresh product decision — it surfaces an ALREADY-decided (Angelo #79), already-built + certified
  (C159 data path, C162 composition) data-safety mechanism. A parked malformed entry that's invisible to the
  user is itself a NORTH_STAR #1 gap (can't fix what you can't see). **Did:** added a "Needs attention" section
  to OfflineExpenseCards.svelte (warning-amber, TriangleAlert, "can't sync as-is — edit to add the missing
  info, or discard"), wired a `needsAttentionExpenses` prop + discard handler from /expenses/+page.svelte.
  **Also fixed a latent bug found in the wiring:** the parent derived `pendingExpenses` as
  `queue.filter(!synced)` — which INCLUDED parked rows, so a parked entry was mislabeled in "Pending Sync"
  (waiting-to-sync) when it's actually permanently stuck. Re-partitioned three ways (pending = !synced &&
  !needsAttention; needsAttention = !synced && needsAttention; synced) mirroring getPendingExpenses/
  getNeedsAttentionExpenses over the reactive queue. **EYES-ON (GUIDE gate for UI work):** booted
  (START_SERVERS+RESET_DB), seeded a parked + a pending + a synced row via localStorage, shot /expenses + Read
  the PNG — three distinct sections render correctly (Pending Sync = the oil-change; Needs attention = the
  malformed fuel "missing volume + mileage" in amber w/ alert icon; Recently Synced = parking), no overflow,
  theme-consistent (text-warning/bg-warning, the app's attention token — NOT the widget-skill --warn vars).
  VERIFY: frontend validate:local GREEN (tsc 0, build 0 PARSE_ERROR, 759 pass). FE-only. Styling uses the app's
  real `--color-warning` Tailwind utility (verified in app.css). cov: be 88.39% / fe 88.44% (~ — a .svelte
  render section + a parent partition; component-render coverage is the eyes-on FE tail, not unit-countable).
  **#79 is now COMPLETE end-to-end** (decide C-Angelo → park-logic C159 → composition-cert C162 → surface C165).
- **C164 (arch — converge the `seedVehicle` test helper, wave 4: expenses domain (no-arg subset); Angelo-approved vein)** —
  Balance recompute (cycle 164): feature BLOCKED (re-recorded + pivoted); NOTHING else over budget → per GUIDE
  took the highest-leverage open item = the seedVehicle convergence (arch, Angelo-approved standing, 25/51
  done). **Wave 4 = the expenses domain's no-arg subset** (6 of the 11 expenses files): summary-http (Toyota
  Camry 2021), split-financing-balance-roundtrip / non-fuel-clears-fuel-fields / update-clear-description /
  expenses-http (Honda Civic 2021), update-preserves-tags (Honda Fit 2019) — each migrated call passes its OWN
  make/model/year to `seedVehicle(ctx, {...})`. Scripted transform; all 6 still use json</DataEnvelope beyond
  the removed decl, so no import cleanup needed (unlike the C160 sync pair). Net −60 LOC. **Deliberately
  scoped to the no-arg subset** (arch rule 1, reviewability): the expenses domain's heterogeneous variants —
  make-param (delete-split-child), nickname-required (import-csv, import-mapping-route), nickname-optional
  (export-csv), + the distinct seedVehicleWithFinancing helper — are LEFT for a dedicated later wave. Behavior-
  preserving (green→green): all 28 expenses suites 277/277 pass; full backend validate:local GREEN (tsc 0,
  musl-biome clean / 20 warnings baseline, 1790 pass / 0 fail, build bundled). Test-only → no shot. **Progress:
  31 of ~51 files converged** (insurance 5 + reminders 15 + sync 5 + expenses-no-arg 6). REMAINING (~20):
  the expenses nickname/make variants (5 files) + the scattered one-offs (analytics-routes, vehicle-photo-routes,
  financing-*, odometer/update-route, premium-expense-hook, google-sheets-service, vehicle-tco-zero-state's
  extra bag). cov: be 88.39% / fe 88.44% (~ — test-helper refactor, no prod line).
- **C163 (bug-scout DRY → pivot to guard: pin the import-route unowned-targetVehicle cross-tenant path)** —
  Balance recompute (cycle 163): feature BLOCKED (re-recorded + pivoted); bug the only over-budget (4/3 = 1.33×).
  The Angelo-decided bug queue is fully drained (#148/#129/#79 closed, #100 arch-gated), so this was a cold
  write-path scout. Precondition: production source HAS changed (C153 dialog + C159 offline-storage/sync-manager),
  so the scout is non-ceremonial. SCOUTED the freshly-changed surfaces firsthand, ALL CLEAN: (1) the C159
  `needsAttention` flag round-trips cleanly through load/save/add/migrate (plain persisted boolean, preserved by
  the `...expense` spread — no asymmetry); (2) the import route's vehicle resolution — both resolveTargetUnits
  AND buildImportPlan scope `targetVehicle` to `vehicleRepository.findByUserId(user.id)`, no cross-tenant leak.
  No fresh defect → recorded DRY. Per the C122 discipline (bug forced but dry → pivot the substantive work to
  the co-productive guard vein), pinned a real 0-coverage data-safety path the scout surfaced: a mapping whose
  `targetVehicle` the user does NOT own. Verified firsthand (scratch probe, then deleted): unowned target →
  readyCount 0, errorCount 1, "No vehicle named X in your garage", no leak, no insert (resolveTargetUnits
  returns {} skip-conversion + buildImportPlan rejects by name — both legs cross-tenant safe, NORTH_STAR #2).
  The route-level cross-tenant path had no test (existing cases all target an OWNED vehicle). Guard (+1) in
  import-mapping-route.test.ts, non-vacuous. VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean / 20
  warnings baseline, 1790 pass / 0 fail [+1], build bundled). Backend-test-only → no shot. cov: be 88.39% / fe
  88.44% (~ — route already covered for owned paths; this pins the unowned cross-tenant leg). NEXT bug cycle:
  cold vein dry again unless new prod source lands → record + pivot.
- **C162 (deep-review — certify the C159 #79 needs-attention parking COMPOSES safely across the offline flows; +guard)** —
  Balance recompute (cycle 162): feature BLOCKED (re-recorded + pivoted); deep-review + bug both at budget
  (1.0×), deep-review longer-absolute-starved (5 vs 3) + higher-leverage → picked. Certified a FRESH invariant:
  the C159 #79 parking (needsAttention) was guarded in ISOLATION (park-not-retry + the helpers) but its
  COMPOSITION with the existing offline flows was uncertified. Traced + verified FIRSTHAND (scratch probes,
  then deleted), all CLEAN: (1) **clearSyncedExpenses KEEPS a parked row** — it's unsynced, so it survives for
  the user to fix; only synced rows are cleared. CRITICAL because the legacy syncOfflineExpenses calls
  clearSyncedExpenses() right after parking — a regression dropping parked rows would DELETE the malformed
  entry (data loss, NORTH_STAR #1). (2) **partition is exact** — a parked row is in getNeedsAttentionExpenses,
  NOT getPendingExpenses (no double-count, no strand). (3) **an already-parked row is a full no-op for a later
  syncAll** — excluded from getPendingExpenses → never POSTed/re-checked/re-counted/re-parked (this is what
  makes "park" actually STOP the infinite re-attempt). (4) source-confirmed the orphaned-retry re-check
  (sync-manager:281) + the auto-sync online-trigger (:366) both route through getPendingExpenses, so a parked
  row no-ops both. No defect. Guard (+2): offline-storage.test.ts (clearSyncedExpenses keeps parked) +
  sync-manager.test.ts (a later syncAll over a parked row = no POST / no re-count / clean success). Non-vacuous.
  VERIFY: frontend validate:local GREEN (tsc 0, build 0 PARSE_ERROR, 759 pass [+2]). Test-only, no production
  source → no shot. cov: be 88.39% / fe 88.44% (~ — composition guards, the modules were already covered). The
  #79 mechanism is now certified end-to-end across park/retry/clear/auto-sync.
- **C161 (infra — branch-hygiene sweep + coverage re-measure; the ~10-cycle cadence, due since C154)** —
  Balance recompute (cycle 161): feature highest ratio (8/4) but BLOCKED (re-recorded + pivoted); infra now
  genuinely over budget (7/6 = 1.17×) AND substantively due — 6 cycles since C154 with real coverage adds
  (C155 auth email-fix+guard, C157/C158 auth guards, C159 offline-parking +guards, + C156/C160 arch). (1)
  UNTRACKED-TEST SWEEP: CLEAN both sides — zero untracked `.test.ts`/`.spec.ts`. (2) COVERAGE RE-MEASURED:
  **BE 88.39% line / 87.99% func (1788 pass); FE 88.44% line / 88.92% func / 80.57% branch / 86.36% stmts
  (757 pass).** Both UP vs C154 (BE 88.33/87.91, FE 88.24/88.72/80.25) — the auth-guard arc (C155/C157/C158)
  + the C159 offline-storage/sync-manager additions added covered lines; FE gained more (+0.20 line). Both
  hold above 88% line at the structural ceiling (residual DI/OAuth/SQL BE + effect/DOM FE, unchanged in
  character). FE crossed 88.4 line — a fresh high, from the #79 needs-attention helpers being pure+covered.
  (3) BOTH-SIDES GREEN: BE 1788 / FE 757, 0 fail. (4) BRANCH STATE: claude-loop-dev = 14 commits ahead of
  fresh origin/main (C147–C160), 0 behind, PR-ready. Doc-only (coverage runs exercised the full suites; no
  source touched → no build/shot). cov: be 88.39% / fe 88.44% (MEASURED). NEXT cadence ~C171.
- **C160 (arch — converge the `seedVehicle` test helper, wave 3: sync domain; Angelo-approved standing vein)** —
  Balance recompute (cycle 160): feature highest ratio (7/4) but BLOCKED (re-recorded + pivoted); excluding it,
  infra was most-starved (6/6 = at budget) but had NO fresh substantive work — untracked-test sweep CLEAN both
  sides + the coverage cadence isn't due until ~C164, so a sweep would be ceremony. Per GUIDE ("most-starved
  over-budget, ELSE highest-leverage open item"), took the highest-leverage open vein: the seedVehicle
  convergence (arch, Angelo-approved standing). **Wave 3 = the sync domain** (5 files): 3 no-arg (each its own
  make/model/year — claims-roundtrip Toyota Camry 2022, restore-junction-refs Honda Civic 2021,
  maintenance-fields-roundtrip Subaru Forester 2021) + 2 make-param (`seedVehicle(make)` with constant
  model/year — restore-empty-replace-guard model 'X'/2021, reminder-split-config model 'M'/2022). Each migrated
  call passes its EXACT prior values to the shared `seedVehicle(ctx, {...})` so behavior is preserved; the
  make-param call sites (`seedVehicle('Honda')`) were rewritten to inject the file's model/year. Scripted
  transform; cleaned 2 now-unused json/DataEnvelope imports the decl-removal left behind (caught via the +2
  warning delta — fixed back to baseline 20). Net −52 LOC. Behavior-preserving (green→green): the 27 sync
  suites 227/227 pass; full backend validate:local GREEN (tsc 0, musl-biome clean / 20 warnings = baseline,
  1789 pass / 0 fail, build bundled). Test-only → no shot. **Progress: 25 of ~51 files converged** (insurance 5
  C150 + reminders 15 C156 + sync 5 C160). REMAINING (~26 files): the **expenses** domain (the largest, mixes
  no-arg/nickname/make — ~13 files, a good next wave) + the scattered nickname/make one-offs (analytics-routes,
  vehicle-photo-routes, financing-*, odometer/update-route, premium-expense-hook, google-sheets-service,
  vehicle-tco-zero-state's extra bag). cov: be 88.33% / fe 88.24% (~ — test-helper refactor, no prod line).
- **C159 (bug #79 — a malformed offline fuel entry retried/re-skipped forever; Angelo-decided: park + surface)** —
  Balance recompute (cycle 159): feature highest ratio (6/4) but BLOCKED (no spec work; re-recorded + pivoted);
  next over-budget = bug (4/3 = 1.33×). Executed the last remaining Angelo-DECIDED bug, **#79**. **The defect:**
  an offline fuel row missing volume/charge or mileage (isIncompleteFuelExpense) is PERMANENTLY unsyncable —
  it fails identically on every attempt. In sync-manager's syncExpenses that failure scheduled backoff retries
  (burned them pointlessly) then sat pending forever, silently re-attempted on every future syncAll; the legacy
  syncOfflineExpenses just `continue`-skipped it every run. Either way it never surfaced as needing user action.
  **Fix (Angelo-decided 2026-06-23: park + surface, don't retry forever):** added a `needsAttention` flag to
  OfflineExpense + helpers (markExpenseNeedsAttention / clearNeedsAttention / getNeedsAttentionExpenses);
  getPendingExpenses now EXCLUDES parked rows (so syncAll stops re-attempting them). syncSingleExpense flags an
  incomplete-fuel failure as `permanent`; syncExpenses parks it (markExpenseNeedsAttention, NO retry scheduled,
  counted as result.needsAttention not result.failed) so it doesn't drag result.success false (nothing to
  retry). The legacy syncOfflineExpenses parks instead of silent-skip. **Guard (+5):** offline-storage.test.ts
  (+4: getPendingExpenses excludes parked; getNeedsAttentionExpenses surfaces only unsynced+flagged; synced
  wins; mark/clear round-trip) + sync-manager.test.ts (+1: a malformed row is parked, NOT retried — asserts
  markExpenseNeedsAttention called + retryCount 0 + no retry-backoff timer scheduled). Non-vacuous. VERIFY:
  frontend validate:local GREEN (tsc 0, build 0 PARSE_ERROR, 757 pass [+5]); existing 49 offline/sync tests
  still green (behavior-preserving for the healthy paths). FE sync/storage LOGIC change, no markup → no shot;
  the user-facing "needs attention" SURFACING (a component reading getNeedsAttentionExpenses) is a documented
  follow-on FE increment. #79 CLOSED — **all 4 Angelo-decided bugs (#148/#129/#79 + #100 arch-gated) now
  resolved or queued**; #100 stays arch-design-gated. cov: be 88.33% / fe 88.24% (~ — added behavior + guards
  on offline-storage/sync-manager).
- **C158 (guard — pin the auth-account UNLINK route: last-account lockout + cross-tenant ownership, end-to-end)** —
  Balance recompute (cycle 158): feature most-starved (5/4 = 1.25×) but BLOCKED (all 3 spec features done C153,
  no self-authorizable feature work — needs Angelo sign-off); recorded that + pivoted to the co-starved guard
  (tied with bug at budget 1.0×; guard longer-starved absolutely, 6 vs 3). Picked the freshest high-stakes
  UNCOVERED surface (the C155/C157 cycles put me in auth/routes.ts): **DELETE /api/v1/auth/accounts/:id**, the
  auth-provider unlink — which enforces two load-bearing account-security invariants but had ZERO coverage.
  Certified firsthand (no defect, the route is well-built): (1) LAST-ACCOUNT LOCKOUT — unlinking the ONLY
  sign-in method is refused (400 LAST_ACCOUNT) so a user can't lock themselves out; the count runs INSIDE the
  delete transaction (concurrency-safe); (2) CROSS-TENANT OWNERSHIP — the row must belong to the requester AND
  be domain='auth', so another user's account id OR a non-auth (storage) provider row → 404, no deletion
  (NORTH_STAR #2). Guard: unlink-account-http.test.ts (+4 via createTestApp, seeding auth providers through
  ctx.sqlite since the harness seeds only the users row) — last-account 400+preserved, 2→unlink-one 204+other
  survives, foreign-user 404+untouched, storage-domain row 404+survives. Non-vacuous (each asserts the DB
  side-effect, not just the status). VERIFY: backend validate:local GREEN (tsc 0, musl-biome clean, 1789 pass
  / 0 fail [+4], build bundled). Backend-test-only; no render → no shot. cov: be 88.33% / fe 88.24% (~ — the
  unlink route handler is now HTTP-harness covered; it was a real 0-coverage gap on an account-security path).
- **C157 (deep-review — certify `resolveNewUser`'s email-collision + race-retry invariant CLEAN; +guard)** —
  Balance recompute (cycle 157): deep-review most-starved (last-touched 151 → starved 6, budget 5 = 1.2×, the
  only one over; feature at budget 1.0× but no open spec work → needs Angelo). Picked a FRESH load-bearing
  invariant adjacent to the C155 auth change: `resolveNewUser` (auth/routes.ts) — the new-account creation path
  on an OAuth login — whose collision handling is a NORTH_STAR #2 contract (VROOM NEVER implicitly merges two
  accounts) but was only STRUCTURALLY tested (route order / delegation / rate-limiter), never behaviorally.
  Certified firsthand (scratch probes, then deleted): (1) PRE-CHECK — an existing email → `email_exists`
  redirect, no merge; (2) TRANSACTIONAL CATCH (concurrency-only) — re-queries findByProviderIdentity: a
  same-provider-identity race-winner → idempotent userId; a different-account-same-email → `email_exists`
  (never a cross-account login). **Corrected my own schema understanding mid-review:** initially mis-read
  schema.ts as having NO unique index on the provider tuple (concluding users.email was the sole tx UNIQUE);
  a firsthand index dump revealed `up_auth_identity_idx` — a PARTIAL UNIQUE on (provider_type,
  provider_account_id) WHERE domain='auth' (added by migration, not the table def). This makes the invariant
  STRONGER: the provider-identity UNIQUE guarantees the race-winner row is unambiguous. No defect — the logic
  is CLEAN. Left a merge-surviving guard: resolve-new-user-collision.test.ts (+5) modeling both layers against
  the REAL migrated schema (pre-check no-merge; catch race-winner-vs-collision; + a schema-fact test pinning
  the partial-UNIQUE auth-identity index so a migration dropping it trips RED). Non-vacuous. VERIFY: backend
  validate:local GREEN (tsc 0, musl-biome clean, 1785 pass / 0 fail [+5], build bundled). Backend-test-only;
  no render → no shot. cov: be 88.33% / fe 88.24% (~ — the private handler stays integration-bound; this pins
  the logic+schema contract). The auth-callback resolution seam is now behaviorally certified (was a gap).
- **C156 (arch — converge the `seedVehicle` test helper, wave 2: reminders domain; Angelo-approved standing vein)** —
  Balance recompute (cycle 156): arch most-starved (last-touched 150 → starved 6, budget 5 = 1.2×, the only
  one over; deep-review at budget 1.0×). Continued the C150 seedVehicle convergence vein (one domain per arch
  cycle). **Wave 2 = the reminders domain** (15 files, the largest no-arg cluster). Unlike insurance (wave 1,
  byte-identical), each reminders file used its OWN make/model/year (Honda Civic 2021, Kia Soul 2019, Mazda
  CX-5 2020, Subaru Outback 2020, Toyota Camry/RAV4 2022, Honda CR-V, Mazda 3 …), so each migrated call passes
  its exact values via the options bag — `seedVehicle(ctx, { make, model, year })` — to preserve behavior, NOT
  the shared default. Did via a scripted mechanical transform (per file: add the shared import, delete the
  local decl, rewrite every `seedVehicle()` call); 2 files needed a tolerant pass (reminders-http had an extra
  comment line inside the decl; trigger-mileage trailed the first script's abort). Verified: 0 leftover local
  decls / 0 bare calls / all 15 import the shared seeder. Net −151 LOC. Behavior-preserving (green→green): the
  reminders suites 129/129 pass; full backend validate:local GREEN (tsc 0, musl-biome clean with NO format
  fixes needed, 1780 pass / 0 fail, build bundled). Test-only, no production source → no shot. **Progress: 20
  of ~51 files converged (insurance 5 C150 + reminders 15 C156).** REMAINING waves (one domain per arch cycle):
  the make-param variant (`seedVehicle(make)` — premium-expense-hook, delete-split-child, odometer/update-route,
  restore-*, google-sheets-service), the nickname variant (export-csv, import-csv, import-mapping-route,
  analytics-routes-http, vehicle-photo-routes, vehicles-list-financing-contract, financing-*), + the expenses/sync
  no-arg cluster + vehicle-tco-zero-state's `extra` bag. The analytics-test-generators direct-DB seeders stay OUT
  (different contract). cov: be 88.33% / fe 88.24% (~ — test-helper refactor, no production line touched).
- **C155 (bug #129 — OAuth login silently overwrote the VROOM login email; Angelo-decided: sync-only-if-unset)** —
  Balance recompute (cycle 155): bug most-starved (last-touched 149 → starved 6, budget 3 = 2.0×). Took the
  now-unblocked Angelo-DECIDED #129 (over a cold scout) — a real MED data-integrity defect with the fix already
  specified. **The defect:** `updateExistingUserProfile` (auth/routes.ts) runs on EVERY OAuth login and did
  `users.set({ email: userInfo.email, ... })` — OVERWRITING the VROOM login identity with the provider's
  currently-reported email each time. So a user who changed their Google/GitHub PRIMARY email had their VROOM
  login email silently swapped on the next login (a within-account drift, no notice). The cross-account
  UNIQUE-collision branch was already correct (no hijack). **Fix (Angelo-decided 2026-06-23):** read the
  current row; sync `email` ONLY as a first-link BACKFILL (when the stored email is empty/unset — users.email
  is NOT NULL so "unset" = ''); otherwise update displayName/updatedAt only and PRESERVE the email. Kept the
  UNIQUE try/catch (still reachable on the backfill write); left the per-provider authProviderRepository
  .updateProfile + the separate new-account email_exists flow untouched (per the decision). **Guard
  (committed, 2-way so a regression to unconditional overwrite breaks it):**
  login-email-preservation.test.ts — (A) a behavioral model of the exact decision logic vs a real in-memory
  users table (non-empty email PRESERVED across a re-login with a different provider email; empty email
  BACKFILLED) + (B) a source-scan asserting routes.ts gates the email write on `!current?.email` (so a future
  edit can't silently restore the blind `set({ email })`). +3 tests, non-vacuous. VERIFY: backend
  validate:local GREEN (tsc 0, musl-biome clean after check:musl:fix reflowed the new file, 1780 pass / 0
  fail [+3], build bundled). Backend-only; no render → no shot. #129 CLOSED. cov: be 88.33% / fe 88.24% (~ —
  auth/routes.ts gained a few covered lines via the model; the private handler stays integration-bound).
  REMAINING decided bug: #79 (offline-outbox hygiene, LOW) — next bug cycle.
- **C154 (infra — branch-hygiene sweep + coverage re-measure; the ~10-cycle cadence, last MEASURED C136)** —
  Balance recompute (cycle 154): bug (1.67×) + infra (1.17×) both over budget; bug edged by ratio but its
  cold-vein is provably dry (the C148/C149 prod changes are fixed+pinned, C150–C152 test-only, C153 just
  shipped+guarded), so per the record-dry-fast discipline took the productive over-budget pick: the infra
  cadence sweep (overdue — the last true coverage re-measure was C136, ~18 cycles back; C147 was the
  branch-reconcile, not a measurement). (1) UNTRACKED-TEST SWEEP: CLEAN both sides — zero untracked
  `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` are by-design). (2) COVERAGE RE-MEASURED:
  **BE 88.33% line / 87.91% func (1776 pass); FE 88.24% line / 88.72% func / 80.25% branch / 86.09% stmts
  (752 pass).** Both UP slightly vs C136 (BE 88.21/87.79, FE 88.23/88.69/80.32) — the C148/C151/C152 import
  guards + C149 lease-gate + the C153 buildPresetMapping extraction added covered lines; both hold above 88%
  line at the documented structural ceiling (residual is DI/OAuth/SQL-bound BE + effect/DOM-bound FE, both
  unchanged in character). (3) BOTH-SIDES GREEN: BE 1776 / FE 752, 0 fail. (4) BRANCH STATE: claude-loop-dev =
  7 commits ahead of fresh origin/main (C147 reconcile + C148 feature + C149 bug + C150 arch + C151 deep-review
  + C152 guard + C153 feature), 0 behind, PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only
  (coverage runs exercised the full suites; no source touched → no build/shot). cov: be 88.33% / fe 88.24%
  (MEASURED). NEXT cadence ~C164.
- **C153 (feature — import-trackers (c): the auto-detect→preview→COMMIT round-trip, eyes-on; closes the feature)** —
  Balance recompute (cycle 153): bug (1.33×) + feature (1.25×) both over budget; bug edged by ratio but its
  cold-vein is provably dry (only recent prod changes are C148/C149, both fixed+pinned), so per the
  record-dry-fast discipline pivoted to the productive over-budget pick: import-trackers (c), the increment I
  queued at C148. **Found a real defect:** the C148 backend `defaultCategory:'fuel'` fix was INERT through the
  UI — `ImportExpensesDialog.buildMapping()` constructed the preset mapping but did NOT forward
  `detectedPreset.defaultCategory`, so a detected Fuelly/Fuelio/Drivvo log STILL previewed 0-ready "Unknown
  category" in the actual dialog (the backend route accepted defaultCategory, but the FE never sent it). Fixed
  by carrying it through; extracted the preset→mapping construction to a pure `buildPresetMapping` helper
  (import-mapping-helpers.ts) so the passthrough is COMMITTED-test-pinned (+3 guards; the e2e is gitignored).
  **EYES-ON (the GUIDE gate for UI work):** booted (START_SERVERS+RESET_DB), drove the full round-trip via the
  detect e2e spec → Read the PNGs: the dialog shows "Detected a Fuelly fuel log" + "2 ready" + an enabled
  "Import 2 rows" (was 0-ready/disabled) → commit → the 2 fuel expenses render on /expenses (FE→BE→DB→render,
  the import-trackers feature-DoD). **Eyes-on was itself blocked + fixed:** the branch's reset-to-main pulled
  Playwright 1.61 (wants chromium build 1228) but the host only caches 1223 → "Executable doesn't exist". Added
  a cached-build executablePath fallback to shot.mjs + playwright.meshclaw.config.ts (gitignored harness, 1223
  launches fine under 1.61) — eyes-on unblocked without a network install. **Also caught a cross-fix
  regression in eyes-on:** the gitignored lease-mileage-whole-allowance e2e pinned the PRE-C149 null-initial
  behavior (mileageUsed 0 → "36,000 left"); C149 (null initial → 0) correctly makes it 24,000 used → "12,000
  left" — updated the spec to the post-C149 + #140 combined semantics (also fixed a latent mi-vs-km label bug
  in it). VERIFY: frontend validate:local GREEN (tsc 0, build 0 PARSE_ERROR, 752 pass [+3]); both e2e specs
  pass (gitignored, local proof). Tracked diff: 3 files (dialog delegates to buildPresetMapping + the helper +
  3 committed guards). **import-trackers is now feature-COMPLETE** (maintenance C1 + recurring-expenses C27 +
  import-trackers C153 — all 3 spec features done). cov: be 88.21% / fe 88.23% (~ — new guards pin a behavior,
  the helper was already exercised).
- **C152 (guard — pin the C148 `defaultCategory` fuel-tracker commit at the ROUTE layer, end-to-end)** —
  Balance recompute (cycle 152): guard most-starved (last-touched 134 → starved 18, budget 6 = 3.0×, frozen
  since C134 by the override); feature + bug sit exactly AT budget (1.0×, not over). The guard vein is largely
  saturated (pure-logic + FE store/util at structural ceilings), so pinned the FRESHEST uncovered production
  surface: the C148 `defaultCategory` flow at the HTTP ROUTE layer. C151 certified the PURE
  applyMapping/buildImportPlan path, but the actual user flow Angelo's fix enables — a DETECTED fuel tracker
  (NO category column) sent to `POST /import` with a preset mapping carrying `defaultCategory:'fuel'`,
  translated + COMMITTED through the real stack — had ZERO route-level coverage (import-mapping-route.test.ts's
  cases all used files WITH a category column). The risk: `columnMappingSchema` must ACCEPT `defaultCategory`
  (a regression dropping it from the schema would silently strip it before applyMapping → back to 0-ready
  "Unknown category", the exact bug C148 fixed) — and that wiring was untested. Verified firsthand (scratch
  probe through ctx.authed, then deleted): a Fuelly-shaped no-category CSV + defaultCategory:fuel → 200,
  imported 1, a real `fuel` expense with mileage/volume preserved. Added 2 durable guards to
  import-mapping-route.test.ts: the commit round-trip (200, imported 1, GET shows category fuel + mileage
  30000 + volume 9) + the dry-run preview (readyCount 1, writes nothing). Non-vacuous (drop defaultCategory
  from columnMappingSchema → both RED, back to 0-ready). VERIFY: backend validate:local GREEN (tsc 0,
  musl-biome clean after check:musl:fix reflowed the new block, 1777 pass / 0 fail [+2], build bundled).
  Backend-test-only; no production source, no render → no shot. cov: be 88.21% / fe 88.23% (~ — route guard,
  the route was already covered for other paths; this pins the defaultCategory wiring). The C148 import-tracker
  fix is now pinned at BOTH the pure layer (C151) and the route layer (C152).
- **C151 (deep-review — certify the C148 `defaultCategory` change composes safely with the import write-path; +guard)** —
  Balance recompute (cycle 151): deep-review most-starved (last-touched 135 → starved 16, budget 5 = 3.2×,
  the override froze it since C135), edging guard (2.8×). The eyes-on vein is exhausted (C132 milestone) +
  backend data-safety broadly certified (C135), so picked a FRESH invariant: the just-landed C148
  `defaultCategory` change introduced new behavior into `applyMapping`/`mapCategory` that intersects the import
  write-path's fuel-field hygiene (#137/C448 clearImportedFuelFields + parseRow's fuel-completeness gate) — and
  the C148 tests only covered fuel rows WITH complete volume+mileage. Traced + verified FIRSTHAND (scratch
  probe, then deleted) two previously-untested edges, BOTH CLEAN: (1) a blank-category row defaulted to `fuel`
  but LACKING volume/mileage does NOT slip through — parseRow's line-252 fuel-completeness gate still fires →
  clean per-row error, readyCount 0, no bad insert (the default fills the category cell, doesn't bypass
  validation); (2) `defaultCategory` is schema-typed as ANY ExpenseCategory, so a non-fuel default (e.g.
  'maintenance') on a row carrying a stray odometer/volume has those fuel-only fields NULLED by
  clearImportedFuelFields — exactly as a named-non-fuel row does → no getCurrentOdometer cross-category MAX
  poison, no fuel-field-leak path. No defect (the C148 fix is sound). Left a merge-surviving guard:
  `import-mapping-presets.test.ts` +2 (the C151 describe) pinning both edges, non-vacuous (drop the line-252
  gate → case 1 RED; drop clearImportedFuelFields → case 2 RED). VERIFY: backend validate:local GREEN (tsc 0,
  musl-biome clean, 1775 pass / 0 fail [+2], build bundled). Backend-test-only; no production source, no render
  → no shot. cov: be 88.21% / fe 88.23% (~ — guard-only, the import modules were already covered; this pins a
  behavior intersection, not new lines). NEXT deep-review: the C149 lease-metrics gate change is unit-pinned
  already (C102 anchor flipped); fresh invariants now come from feature/bug-surfaced seams.
- **C150 (arch — converge the `seedVehicle` test helper, wave 1: insurance domain; Angelo-approved 2026-06-23)** —
  Balance recompute (cycle 150): arch most-starved (last-touched 131 → starved 19, budget 5 = 3.8×, the
  override froze it since C131). Both design-gated arch convergence candidates were APPROVED by Angelo
  2026-06-23: `createLoadState` adoption (needs a `.kiro/specs/load-state-migration/design.md` FIRST + touches
  render) and **`seedVehicle` converge** (test-only, direct approval, no design-doc gate, "ONE domain per arch
  cycle, NEVER a 51-file big-bang"). Picked seedVehicle as the lower-risk first vein (test-only, arch rules
  1/2 satisfied trivially; createLoadState's render-touching design-doc cycle waits). **Did:** added the ONE
  shared seeder `backend/src/test-helpers/seed.ts` — `seedVehicle(ctx, opts?)` with an options bag
  (make/model/year/nickname/extra) defaulting to the most common inlined shape (Toyota Camry 2022), driving the
  REAL `POST /vehicles` route + the identical `<300` status-with-body assertion every inlined copy used. Then
  migrated **wave 1 = the insurance domain** (5 files: terms-http, claims-http, claim-photos-http,
  policy-delete-cascade, expiring-soon-http) — all had a BYTE-IDENTICAL no-arg decl (Toyota Camry 2022), so the
  shared defaults reproduce each exactly: removed the 5 local decls, imported the shared one, rewrote every
  call to `seedVehicle(ctx)`. Net −50 LOC. Behavior-preserving (green→green): the 5 suites 27/27 pass, full
  backend validate:local GREEN (tsc 0, musl-biome clean, 1773 pass / 0 fail, build bundled). Test-only, no
  production source, no render → no shot. **LEFT for later waves** (the standing vein, one domain per arch
  cycle): the make-param variant (`seedVehicle(make)` — premium-expense-hook, delete-split-child, etc.), the
  nickname variant (export-csv, import-csv, analytics-routes-http, …), and the remaining no-arg cluster
  (reminders ×12 incl. make/model/year VARIATION → each migrated call passes its exact values, expenses,
  sync). ~46 files remain across ~6 domains. NEXT arch cycle: migrate ONE more domain (recommend the reminders
  no-arg cluster — largest single batch, each call passes its own make/model/year). cov: be 88.21% / fe 88.23%
  (~ — test-helper refactor, no production line touched).
- **C149 (bug #148 — null `initialMileage` lease burn bar reads 0-used; Angelo-decided 2026-06-23: treat null/zero initial as 0)** —
  Balance recompute (cycle 149): the override froze rotation C138–147, so 4 categories are over budget; bug
  was most-starved-relative-to-budget (last-touched 137 → starved 12, budget 3 = 4.0×, also the lowest budget).
  The cold pure-logic vein is provably dry (no production source pre-C148; the C89–C122 dry-scout chain), so
  instead took the now-UNBLOCKED Angelo-decided bug: **#148** (LeaseMetricsCard mileage burn bar). The defect
  (found C68 eyes-on, characterization-pinned C102): `calculateLeaseMetrics` (financing-calculations.ts:498)
  gated `mileageUsed = max(0, current − initial)` on `initialMileage !== null`, so a lease with NO recorded
  starting odometer (the COMMON case) left mileageUsed=0 / remaining=full → the burn bar read "0 / 36,000 ·
  36,000 left" at a real 30k odometer, WHILE the sibling PaymentMetricsGrid Overage card coalesces
  `initialMileage ?? 0` (FinanceTab.svelte:163) and showed the true driven miles — the SAME vehicle
  contradicted itself on one screen (the #140 class on the null-initial axis, money/UX). **Fix (Angelo-decided
  2026-06-23):** coalesce `const startMileage = initialMileage ?? 0` inside calculateLeaseMetrics + drop the
  `initialMileage !== null` clause from the gate (keeping `currentMileage !== null && financing.mileageLimit`);
  route the projected-driven-miles space-correction (#91) through `startMileage` too. Now the burn bar matches
  the Overage card by construction. **Flipped the C102 red→green anchor** (lease-metrics.test.ts): was "null
  initial → mileageUsed 0" (pinned defect); now "null initial treated as 0 → mileageUsed = currentMileage =
  the initial=0 result" (asserts the contradiction is resolved: m.mileageUsed === withZeroInitial.mileageUsed
  && same remaining). VERIFY: frontend validate:local GREEN (tsc 0, build 0 PARSE_ERROR, 749/749; the targeted
  lease-metrics suite 35/35). FE-pure-util fix; the consuming render (LeaseMetricsCard `mileageUsed
  .toLocaleString()`) is unchanged + the fix is fully asserted against the REAL function, so no fixture-only
  shot manufactured (the seeded leases have non-null initialMileage 25000/15000 → they exercise the
  already-correct path; a null-initial shot would need a fabricated fixture, lower-value than the unit proof
  per the GUIDE source-proof>untracked-e2e principle). cov: be 88.21% / fe 88.23% (~ — lease-metrics.ts was
  already covered; this flips a gate + the anchor test, no new uncovered lines). #148 is CLOSED.
- **C148 (feature — import-trackers (b): fuel-tracker presets get `defaultCategory:'fuel'`, Angelo-approved 2026-06-23)** —
  First normal cycle post-override-lift. Balance recompute (cycle 148): the override froze rotation since
  C138, so feature was the most-starved (last-touched 121 → starved 27, budget 4) AND its sole open item
  was just UNBLOCKED — Angelo decided import-trackers (b) on 2026-06-23 with the note "EXECUTE when the
  PR-green override lifts" (it lifted C147). Clear pick. **The gap (C31/C32 finding):** Fuelly/Fuelio/Drivvo
  refuel exports have NO category column (definitionally all fuel), so a DETECTED log mapped a BLANK category
  cell → `mapCategory('')` returned `''` → buildImportPlan errored every row "Unknown category" → 0-ready.
  A perfectly-detected fuel log imported NOTHING. **Fix (minimal, opt-in):** added an optional
  `defaultCategory` to `ColumnMapping` (+ the zod schema, bounded to a real ExpenseCategory) that fills ONLY
  a blank category cell; set `defaultCategory:'fuel'` on all 3 fuel presets + carried it through
  `presetToMapping`; mirrored the field on the FE `ImportColumnMapping`/`ImportMappingPreset` types. The
  NAMED-but-unknown→misc path (D2/C47 remap) is deliberately untouched — verified by a new test that a row
  WITH a category column holding an unrecognized word still falls back to misc + reports unmapped (NOT
  coerced to fuel). **Flipped the C32 characterization** (was: every preset 0-ready "Unknown category"; now:
  every preset yields 1 ready `fuel` row end-to-end through buildImportPlan, native category cell == 'fuel',
  committed expense.category == 'fuel'). VERIFY (both sides, full local gate): backend validate:local GREEN
  (tsc 0, musl-biome clean after check:musl:fix wrapped the mapCategory call, 1772 pass / 1 skip / 0 fail,
  build bundled); frontend validate:local GREEN on the reset npm-ci tree (tsc 0, build 0 PARSE_ERROR — also
  re-confirms the C146 fix, 749/749). Backend-logic + FE-type only → no shot this cycle. **(c) the
  auto-detect-preset round-trip THROUGH COMMIT + the populated-detect 4-state shot is now UNBLOCKED** (it
  gated on (b)) → that's the next feature increment (eyes-on, boot+shot.sh+Read). cov: be 88.21% / fe 88.23%
  (~ — import-mapping modules were already covered; this added behavior-flip tests, not new uncovered lines).
- **C147 (infra — POST-SQUASH-MERGE BRANCH RECONCILE + lift the PR-green override)** — The PR
  (claude-loop-dev → main) was **squash-merged** by Angelo; origin/main moved fb35c17 → `116fcd8`
  ("Merge Monday (#114)" + dependabot #116/#117). The squash captured ALL loop work incl. the C146
  `npm ci` CI fix, the override block, and Angelo's 2026-06-23 BACKLOG decisions. Per the documented
  squash-merge precedent (the original branch tip is NOT an ancestor of the squash), the correct
  "rebase" = **reset the branch onto fresh origin/main**, not replay the 152 already-squashed commits.
  Angelo authorized the one-time force-push (the branch is the loop's own; PR already merged; nothing
  else builds on it). Did: verified 3 preconditions firsthand (local HEAD == origin/claude-loop-dev
  `2644fc0`; origin/main BACKLOG == 2644fc0's parent BACKLOG, i.e. a clean superset; gitignore deltas
  vs main are additions-only) → `git reset --hard origin/main` → re-applied the two keeper deltas from
  2644fc0 (the agent-harness `.gitignore`/`frontend/.gitignore` rules + the 2026-06-23 BACKLOG
  decisions) → **lifted the PR-green override** from GUIDE.md + BACKLOG.md (the removal condition Angelo
  set — "PR merged" — is met) → recorded this entry. Verified post-reset: all dep files + ci-cd.yml +
  LEDGER == origin/main byte-for-byte (the C146 npm-ci fix is present; no lockfile churn — the
  rolldown-WASM footgun is moot since the lockfiles are main's exact bytes). Then force-push. Normal
  6-category balance-table rotation resumes next cycle. Doc/gitignore-only — no app source touched
  → no validate:local / shot needed (the tree == a main that already passed CI on merge). cov: be
  88.21% / fe 88.23% (~ — carried, nothing measured this reconcile cycle).
- **C1 (feature)** — Maintenance-schedule **T9 / eyes-on closeout**. Picked the highest-leverage open
  item (balance all-0, nothing over budget; feature has the lowest budget + eyes-on is now unblocked per
  GUIDE). Booted a fresh stack (RESET_DB reseed + START_SERVERS) and ran the untracked
  `reminder-mileage.meshclaw.e2e.ts` green: it drives the real ReminderForm → backend → DB → /reminders
  render round-trip, then clicks "Serviced" (mark-serviced 200 re-arm). **Read both captured PNGs**:
  the mileage form reveals Service-interval `5000 mi` + "Last serviced at" (unit suffix + help text) and
  hides the time fields ✓; the created reminder renders `Next: 30,850 (odometer)` (milestone, no false
  frequency badge) with a working "Serviced" button ✓. Ticked spec T7/T8/T9 → `[x]` (the ~200-cycle
  "Playwright-blocked" tail was the resolved misdiagnosis). No code changed (markup already merged via
  "Merge Monday (#112)"); doc-only — frontend type-check 0 errors. Also pruned the **stale #140**
  BACKLOG/CLAUDE.md entry: verified firsthand the LeaseMetricsCard annual-vs-total fix is ALREADY merged
  (all 3 display sites route through `leaseTotalMileageAllowance`, `#140` fix-comment present) — it was
  post-reset squash-merge doc-drift, not open work. cov: be 87.09% / fe 85.89% (~, carried from C460 —
  no module touched this cycle).
- **C2 (bug #147)** — **PUT /split/:id financing-source not re-validated against the NEW vehicle set.**
  Bug-vein scout: verified firsthand that insurance/claims/vehicles/odometer/financing/regular-expense
  write paths are all hardened (debunked an initial term-coverage-ownership hypothesis — the repo DOES
  call assertVehiclesOwned in all 3 term writes). Found the real gap in `updateSplitExpense`
  (repository.ts:792-793): it REGENERATES siblings carrying the group's existing sourceType/sourceId
  forward (the update schema doesn't expose them), but the NEW splitConfig can land them on a DIFFERENT
  vehicle set — and computeBalance sums financing payments by (sourceType,sourceId) with NO vehicle
  scope, so reallocating a financing-sourced split onto a vehicle whose active financing isn't that
  sourceId mis-attributes a loan payment → understates the displayed balance (NORTH_STAR #1). The
  #125(PUT)/#145(create-split) within-tenant financing-source class on the ONE path the per-vehicle
  check missed. FIX: extracted `assertSplitFinancingSourceValid` (DRYs the per-vehicle loop), shared by
  POST /split (new config) + PUT /split (re-checks the carried link against the new vehicles via the
  userId-scoped getSplitExpense read). GUARD: +3 HTTP-harness tests in expense-source-traceability.test.ts
  (reallocate-onto-unfinanced→400 [was 200 pre-fix]; same-financed-vehicle→200; source-less→200 free
  reallocation). Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1561 pass / 0 fail (+3),
  build bundled. Backend-only (no UI → no shot). cov: be ~87.1% / fe 85.89% (~ — BE suite +3 tests; not
  re-measured, expense routes already well-covered).
- **C3 (deep-review)** — **Certified the photo-entity-type allowlist sync CLEAN + left a C404 drift guard.**
  The set of "photographable" entity types (vehicle / expense / insurance_policy / insurance_claim /
  odometer_entry) is duplicated across THREE independent paths, held together only by code comments:
  (1) `validateEntityOwnership` switch (photos/helpers.ts, the upload gate), (2) `validatePhotoRefs`
  entityTypeToIds map (sync/backup.ts, the RESTORE validator), (3) `ENTITY_TO_CATEGORY` (storage-provider.ts,
  exported, provider routing). VERIFIED FIRSTHAND all three list the same 5 types today. The C404 failure
  was exactly this drift: insurance_claim added to the upload gate but missed in the backup map →
  a valid backup with a claim photo hit "unknown entity type" → valid:false → the WHOLE restore aborted
  (NORTH_STAR #1 crown-jewel). No existing test pinned the cross-allowlist match. GUARD: new
  `photo-entity-type-allowlist-sync.test.ts` (+12) treats ENTITY_TO_CATEGORY as the canonical source and
  asserts BOTH other sites accept exactly its keys — driving the REAL validateBackupData +
  validateEntityOwnership (not a re-impl). NON-VACUOUS: confirmed by temporarily removing insurance_claim
  from the backup map → guard goes RED with the precise "would abort the WHOLE restore" diagnostic; restored
  → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1573 pass / 0 fail (+12), build
  bundled. Backend-only (no UI → no shot). cov: be ~87.2% / fe 85.89% (~ — sync module already well-covered;
  +12 tests broaden the restore-safety net).
- **C4 (arch-scout → no-churn → guard)** — Ran a genuine ARCH dedup scout across the likely veins:
  FE date helpers (toDateInputValue/dateOnlyToISO already single-sourced in formatters.ts; the
  expense-filters local-date parse uses a DIFFERENT time anchor — midnight vs noon — so convergence is
  PROHIBITED per the calculatePayoffDateFromStart lesson), backend ownership validators (the
  validate*Ownership family is deliberately per-entity by ownership topology — not a clean merge), FE
  query builders (buildQueryString already deduped C337), the offline→backend mapper + reminder
  computeNextDueDate (both already saturated with completeness/property guards). **Recorded: no churn
  warranted** (arch is reliably DRY per the GUIDE; don't manufacture). PIVOTED to the most-starved next
  category (guard, 4/6). Found a real guard gap: the financing-balance property test drives
  `repo.computeBalance` DIRECTLY, and the C2 #147 tests assert only route STATUS — nothing pinned the
  end-to-end MONEY round-trip that a financing-sourced split actually moves the vehicle's DISPLAYED
  `computedBalance` (NORTH_STAR #1). GUARD: new `split-financing-balance-roundtrip.test.ts` (+3) drives
  POST/PUT /split → DB → GET /vehicles/:id and asserts EXACT balances (20000→19600 on a 400 split;
  →19500 after reallocating to 500, proving no double-count/orphan; source-less split leaves 20000).
  Inherently non-vacuous (exact-number assertions). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1576 pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be
  ~87.2% / fe 85.89% (~ — financing/expense routes already covered; +3 pins the observable money seam).
- **C5 (feature)** — **Recurring-expenses T7: dashboard recurring-cost widget (eyes-on DONE).** Balance:
  feature/bug/arch all sat AT budget; feature (4/4, lowest budget) had the most genuine open work →
  picked it. T7's backend (reminder-cost.ts C111 + GET /recurring-cost C116) + FE client method
  (getRecurringCost C134) were all done; only the dashboard MARKUP remained. Built `RecurringCostCard.svelte`
  (composed from the kit — Card/Button/Skeleton/EmptyState; four-states: loading/data/zero), wired into
  the dashboard page via a parallel `getRecurringCost()` fetch that degrades to {0,0} on failure (a
  reminders-service hiccup must never blank the dashboard, mirroring the reminders list's catch). Booted a
  fresh stack, seeded two monthly expense reminders ($120 insurance + $400 loan), and **Read the PNG**: the
  card renders **$520.00 / month · across 2 recurring expenses**, matching the live endpoint
  `{count:2, monthlyTotal:520}` — full FE→BE→DB→render round-trip confirmed. Ticked spec T7 → `[x]`.
  Verify: frontend validate:local GREEN — type-check 0, build OK, 715 tests pass. cov: be ~87.2% / fe
  85.89% (~ — UI-markup cycle, no vitest module touched; the widget's data path is backend-covered).
- **C6 (arch-scout → no-churn + bug-scout → dry → guard)** — Two categories were over budget (arch 6/5,
  bug 4/3). Scouted ARCH on fresh modules (C4 said "try a module the loop hasn't touched"): analytics
  builders (the `isFillup` predicate is ALREADY single-sourced — #108/#113/#146 each route through it, not
  a dup), FE chart components, and the `mean`/`groupBy` accumulation idioms (trivial idioms with DIVERGING
  empty-guards — converging risks behavior change, arch rule 2; REJECTED as churn). **Recorded: no churn
  warranted.** Scouted BUG on date/tz math (the productive vein after C2 swept write paths): analytics
  date helpers (monthsOwnedInYear, calendarYearRange, toDate, the month-iteration loop, season map) are
  all correct + well-tested; the `setMonth` overflow trap is avoided (cursor built at day 1). No fresh
  defect — **recorded dry, did NOT manufacture a finding.** DELIVERED a guard for the one real gap the
  scout surfaced: `monthsBetween` — the signed whole-calendar-months helper behind TWO money divisors
  (financing months-elapsed `Math.max(0,…)`; all-time TCO cost-per-month `Math.max(1,…)`) — was only
  IMPORTED + name-checked in a comment (per-vehicle.property.test.ts:574), never directly asserted (the
  C181/C229 "helper tested only in isolation" gap). GUARD: +6 cases in tco-months-owned.test.ts pinning
  the year×12+delta math, same-month=0, cross-year, multi-year, and the documented SIGNED negative
  contract. NON-VACUOUS: dropping `*12` from monthsBetween turns 3 cases RED; restored → green. Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1582 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.2% / fe 85.89% (~ — analytics helper now directly pinned).
- **C7 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; infra was the sole
  over-budget category, 7/6).** (1) UNTRACKED-TEST SWEEP: `git status` shows ZERO untracked `.test.ts`/
  `.spec.ts` files — every committed-extension test is in git (the 45 `.meshclaw.e2e.ts` specs are
  gitignored-by-design agent-harness files, correctly excluded; the committed regression net is the
  unit + HTTP-harness suites). No specs at risk of vanishing on merge. (2) COVERAGE RE-MEASURE (replaces
  the carried `~`): **BE 87.22% line / 86.96% func** (bun --coverage file-mean across 103 src files);
  **FE 85.95% line / 87.15% func / 78.38% branch** (vitest v8 aggregate, 1138/1324 lines). Both at the
  ~87/~86 structural ceiling — flat-to-up vs the C460 baseline (BE 87.09/86.60, FE 85.89/87.15/78.35). BE
  low spots remain DI/OAuth-bound (auth/routes 18.6%, provider services, backup-orchestrator, db
  connection) — NOT clean unit picks. (3) BOTH-SIDES GREEN confirmed: BE 1582 pass / 0 fail, FE 715 pass /
  0 fail. (4) BRANCH STATE: claude-loop-dev = 6 commits ahead of fresh origin/main (C1 feature, C2 bug,
  C3 deep-review, C4 guard, C5 feature, C6 guard), PR-ready; recorded here since BRANCH_REVIEW.md is
  gitignored. Doc-only cycle — no source touched. cov: be 87.22% / fe 85.95% (MEASURED, not carried).
- **C8 (deep-review)** — **Certified the restore `stampUserId` cross-tenant-write chokepoint + broadened
  its guard.** stampUserId (restore.ts) forces the importer's userId onto every directly-owned row of an
  UNTRUSTED backup — "the single chokepoint that holds regardless of which validators run," applied to 9
  tables (vehicles/insurance/reminders/reminderNotifications/expenses/odometer/userPreferences/syncState/
  photos). VERIFIED FIRSTHAND: the only existing stamp test tampered `vehicles.csv` ONLY — a dropped stamp
  on any other insert (the C3-class structural-invariant drift) would plant a cross-tenant row with NO
  test red. KEY FINDING from doing it firsthand: validateBackupData REJECTS a foreign userId on LEAF
  tables (expenses/reminders user-check against the metadata set → belt-and-suspenders), but
  `validateInsuranceRefs` checks only `id` presence — so `insurance_policies` is a genuine STAMP-ONLY
  root table (exactly as the docstring flags; my first attempt tampering expenses.csv was REJECTED at
  validation, which is what surfaced this). GUARD: +1 case in restore-userid-stamp.test.ts tampering
  insurance_policies.csv to a victim id → asserts the restored policy is owned by the importer.
  NON-VACUOUS: dropping the insurance stamp turns ONLY the new case RED (vehicles + untampered stay
  green); restored → 3 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1583 pass /
  0 fail, build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 85.95% (~ — sync module
  already well-covered; +1 broadens the cross-tenant security net to a stamp-only root table).
- **C9 (feature)** — **Recurring-expenses T6: "Recurring" badge on expense rows (eyes-on DONE).** feature
  + bug both sat AT budget; feature (lowest budget, shippable eyes-on tails) is higher-leverage than a
  bug re-scout. T6's backend seam (GET /reminders/:id/expenses C122) + FE client method
  (getMaterializedExpenses C134) were done; the badge's read data (sourceType on the expense list) landed
  T1/C96 — only the badge MARKUP remained. Built `RecurringExpenseBadge.svelte` (Repeat-icon inline pill
  mirroring SplitExpenseBadge + the C5 RecurringCostCard icon), rendered on standalone expense rows where
  `sourceType==='reminder'` in BOTH the desktop ExpensesTable (next to the category label) and the mobile
  card (meta row). Booted a fresh stack, created an OVERDUE monthly expense reminder ($125.50 insurance),
  triggered materialization (10 catch-up rows), and **Read the PNG**: the Feb–Dec 2024 materialized rows
  each render the "Recurring" pill next to "Financial", while non-reminder expenses (Maintenance) show NO
  badge — full FE→BE→DB→render round-trip confirmed. Ticked spec T6 → `[~]` (badge done; the
  "materialized N expenses" reminder-side view remains as a future sub-task). Verify: frontend
  validate:local GREEN — type-check 0, build OK, 715 tests pass. cov: be 87.22% / fe 85.95% (~ —
  UI-markup cycle, no vitest module touched; the badge's sourceType read is backend-covered at T1/C96).
- **C10 (bug-scout → DRY, false-positive correctly debunked)** — bug was the sole over-budget category
  (4/3). Scouted the FE store/state layer (the C6-flagged "FE store race/stale-state" vein, untouched
  this run): app/offline/sync-state/theme stores are clean immutable getter-setter holders with no logic
  to harbor a defect; app.svelte.ts notifications use UUID ids + immutable updates. Dug into sync-manager
  (the data-safety-dense module). HYPOTHESIS RAISED + DEBUNKED FIRSTHAND (the GUIDE's "agent HIGH findings
  are often false" — proven again): `checkForExistingExpense` GETs `?date=&amount=` params the backend
  SILENTLY IGNORES (not in expenseQuerySchema → Zod strips), so the finder matches on vehicle+shared-tag
  only. I drafted a fix narrowing to date+amount — but the EXISTING tests (lines 676-689) explicitly
  assert a different-date/different-amount tag-sharing row MUST classify as `'modified'`. The design is a
  DELIBERATE two-stage: broad finder (candidate) → determineConflictType classifies duplicate-vs-modified.
  Narrowing the finder would silently DROP all `'modified'` conflict detection — a regression, not a fix.
  REVERTED both files (git checkout); no bug exists. The `?date=&amount=` params are dead/misleading but
  HARMLESS (ignored) — removing them is an arch-risk not worth taking against the working two-stage flow.
  Recorded so it's not re-chased. No code shipped this cycle by design (shipping a false fix is the worst
  outcome). Verify: sync-manager suite 22/22 green on the untouched tree. cov: be 87.22% / fe 85.95% (~).
- **C11 (guard)** — **Extended the restore cross-tenant-write stamp guard to `photos` (the C8 follow-on).**
  Nothing strictly over budget (arch sat AT 5/5 but was recorded no-churn twice, C4/C6 — "don't force a
  4th scout"); took the highest-leverage open item: the concrete guard target C8 flagged
  (photos/userPreferences/syncState remain stamp-only-unguarded). VERIFIED FIRSTHAND: validatePhotoRefs
  (backup.ts) checks only entityType + entityId membership, NOT the photo's userId against the metadata
  set — so, like insurance (C8) and unlike the leaf expenses/reminders (which validation user-checks),
  `photos` is a STAMP-ONLY-defended root table; a tampered foreign userId on a photo row passes validation
  and reaches the insert where stampUserId is the sole defense (a real cross-tenant write — receipts/
  vehicle/claim docs — NORTH_STAR #2). GUARD: +1 case in restore-userid-stamp.test.ts (now covers
  vehicles + insurance + photos) — seed a photo row directly (no storage provider needed for the restore
  path, mirroring claims-roundtrip.test.ts), tamper photos.csv to a victim id, assert the restored photo
  is owned by the importer. NON-VACUOUS: dropping the photos stamp turns ONLY the new case RED; restored →
  4 pass. Remaining stamp-only-unguarded: userPreferences/syncState (PK'd by userId, so a foreign-id row
  is a PK collision not a silent cross-tenant write — lower priority; left for a future cycle). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1585 pass / 0 fail, build bundled. Backend-only
  (no UI → no shot). cov: be 87.22% / fe 85.95% (~ — sync module already well-covered; +1 security net).
- **C12 (arch-scout → no-churn → feature)** — arch was over budget (6/5; forced). Scouted FRESH modules
  (C4/C6 had cleared the rest): the FE service layer (insurance/odometer/vehicle-api etc. all delegate to
  the shared apiClient.get/post/getPaginated — thin per-domain wrappers, not dup) + api-transformer.ts
  (the to/fromBackendExpense mappers are deliberately asymmetric — create-vs-edit description, volume↔charge
  routing — no extraction). **Recorded: no churn warranted** (arch at its structural floor, 3rd confirm).
  PIVOTED to the highest-leverage open item: **recurring-expenses T5** (app-init trigger hook). The pure
  gate (shouldTriggerRecurringExpenses C128) was done; built the orchestration helper
  `maybeTriggerRecurringExpenses` (localStorage debounce around the gate, injected trigger, stamp-on-success
  only, fail-soft, corrupt-ts→never-run) + wired it into +layout.svelte's authed-init `$effect`. +5 unit
  tests. EYES-ON CONFIRMED: seeded an overdue expense reminder, loaded /dashboard WITHOUT a manual trigger
  → the backend log shows exactly ONE app-fired POST /reminders/trigger → 200 → 12 expenses materialized
  (0→12) → dashboard Recurring Costs widget shows $99/mo·1 + Upcoming Reminders shows it (Read the PNG).
  Ticked spec T5 → `[x]`. Verify: frontend validate:local GREEN — type-check 0, build OK, 721 tests pass
  (+5). cov: be 87.22% / fe 85.95% (~ — the new helper is unit-covered; eyes-on path is backend-covered).
- **C13 (deep-review)** — **Certified the replace-mode restore wipe+reinsert FK-ordering CLEAN + left a
  full-dataset guard.** deep-review was at budget (5/5, highest-leverage of the at-budget three). Audited
  `deleteUserData` + `insertBackupData` (restore.ts) against the schema FK graph — the data-safety path a
  replace-restore runs (wipe-then-reinsert; FKs enforced via PRAGMA foreign_keys=ON; bun async-tx doesn't
  roll back a throw, the C151/#127 footgun → an FK violation mid-restore corrupts the account, NORTH_STAR
  #1). Existing tests each seed ONE entity family + unified-restore replace-restores an EMPTY backup — NONE
  exercise the ordering under a complete FK-linked dataset. GUARD: new
  `restore-replace-delete-ordering.test.ts` (+2) seeds a full graph (vehicle+financing+odometer+expense+
  insurance policy/term/junction/claim+reminder/junction/notification+photo+prefs/syncState), replace-
  restores, asserts every table round-trips to its exact pre-restore count (no loss/dup) + a double-replace
  idempotency case. KEY FIRSTHAND FINDING (verified by mutation): the DELETE order is cascade-REDUNDANT
  (child FKs are onDelete:cascade → deleting a parent first just cascades, no throw) — the real load-bearing
  constraint is the INSERT order in insertBackupData (parent-before-child); relocating the financing insert
  before the vehicles insert turns the guard RED (FK violation), so it's non-vacuous on the actual
  constraint. Also surfaced: a costed insurance term auto-materializes a premium expense (so expenses=2 not
  1 — asserted against a snapshot, not a hardcoded count). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1587 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22%
  / fe 85.95% (~ — restore module already well-covered; +2 broaden the crown-jewel round-trip net).
- **C14 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; infra was the
  most-starved of two over-budget cats: infra 7/6 > bug 4/3).** (1) UNTRACKED-TEST SWEEP: CLEAN — zero
  untracked `.test.ts`/`.spec.ts` (the 45 `.meshclaw.e2e.ts` are gitignored-by-design). (2) COVERAGE
  RE-MEASURED (6 commits since the C7 sweep): **BE 87.22% line / 86.96% func** (file-mean, 103 src files —
  UNCHANGED vs C7; C8/C11/C13 added sync tests on already-covered modules); **FE 86.07% line / 87.19% func
  / 78.53% branch** (v8, 1150/1336 lines — UP vs C7's 85.95/87.15/78.38, from the C12
  maybeTriggerRecurringExpenses unit tests). Both at/above the ~87 BE / ~86 FE structural ceiling. BE low
  spots unchanged (auth/routes 18.6%, provider services, backup-orchestrator, db connection — all
  DI/OAuth-bound). (3) BOTH-SIDES GREEN: BE 1587 / FE 721. (4) BRANCH STATE: claude-loop-dev = 7 commits
  ahead of fresh origin/main (C1-C13: 3 feature, 2 bug[1 dry], 2 deep-review, 2 guard, 1 infra, +the C7
  infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.22% / fe 86.07% (MEASURED, not carried). NEXT cadence ~C24.
- **C15 (bug-scout → DRY, 3rd consecutive)** — bug was the sole over-budget category (5/3). Scouted FOUR
  fresh money/unit/date surfaces firsthand (the productive vein): (1) unit-conversions.ts — convertDistance/
  Volume/Efficiency math correct (efficiency scales by distFactor/volFactor; verified 30 mi/gal_US→12.75
  km/L) + property-tested + all 3 callers gas-isolated via gasEfficiencyPoint (#119/#126 class closed);
  (2) calculations.ts calculateAverageMPG/MilesPerKwh — nearly flagged the `previous.missedFillup`
  exclusion as over-aggressive, but the existing unit test (:106) + property-test reference impl both
  ENCODE it as intended → documented, not a bug (firsthand debunk #2); (3) vehicle-stats.ts
  calculateMileageStats/calculateAverageMpg — clamp-at-0 (#46) + defensive sort (#75) correct + pinned;
  (4) getPeriodStartDate/parseClampedInt/maxOf — all correct + #70/#81-guarded. NO fresh defect — recorded
  dry, did NOT manufacture a finding (GUIDE: agent HIGH findings often false; the pure-logic bug surface is
  exhausted this run, remaining real defects are the parked product-gated #94/#30). SURFACED for a FUTURE
  ARCH cycle (not done here — arch isn't over budget, category discipline): calculateAverageMPG
  (calculations.ts) and calculateAverageMpg (vehicle-stats.ts) are near-identical pairing loops (same
  missedFillup skip + mpg>0&&<150 band) — a real C161-class drift vector; seeded the arch queue. No code
  shipped by design. Verify: targeted suites green on the untouched tree (calculations + unit-conversions).
  cov: be 87.22% / fe 86.07% (~).
- **C16 (feature)** — **Recurring-expenses T6-view: "materialized N expenses" dialog (eyes-on DONE → T6
  COMPLETE).** feature sat AT budget (4/4, highest-leverage). T6's badge shipped C9; the view sub-part
  remained, with the backend seam (GET /reminders/:id/expenses C122) + FE client method
  (getMaterializedExpenses C134) already done. Built `MaterializedExpensesDialog.svelte` (Dialog +
  four-states loading/data/empty/error-retry, composed from the kit), opened from a Receipt "View
  materialized expenses" button on every expense-type reminder card on /reminders; lists each materialized
  row (category · date · vehicle · amount) + an "N expenses · $total" summary. Booted a fresh stack, ran
  an untracked spec that creates an overdue $75 monthly reminder, triggers it (12 catch-up rows), opens the
  dialog, and screenshots it. **Read the PNG**: dialog renders "12 expenses · $900.00 total" with each
  Financial · {date} · Daily Driver · $75.00 row; backend log confirms the dialog-open fired
  GET /reminders/:id/expenses → 200. Full FE→BE→DB→render round-trip. Ticked spec T6 → `[x]` (badge+view
  both done). Verify: frontend validate:local GREEN — type-check 0, build OK, 721 tests pass. cov: be
  87.22% / fe 86.07% (~ — UI-markup cycle; the dialog's data path is backend-covered by the C122 HTTP tests).
- **C17 (arch)** — **MPG-pairing dedup (the C15-seeded pick — a real C161-class drift vector).** arch sat
  AT budget (5/5); took it because — unlike the prior 3 no-churn scouts — there was a GENUINE pre-surfaced
  pick. `calculateAverageMPG` (calculations.ts) and `calculateAverageMpg` (vehicle-stats.ts) hand-copied
  the same consecutive-fill-up loop (missedFillup skip + both-odometers-and-volume guard + mpg=miles/vol +
  the (0,150) band + mean). Extracted ONE pure `averageConsecutiveMpg(sortedExpenses)` in calculations.ts
  over a minimal structural row type; both callers now sort (each keeping its OWN contract —
  calculations via sortExpensesByDate, vehicle-stats via its defensive #75 inline date sort) then delegate.
  BEHAVIOR-PRESERVING: takes PRE-SORTED input so no sort-policy change; the (0,150) band preserved EXACTLY
  (do NOT unify with analytics' [5,100] — that's the product-gated #30 call, explicitly NOT touched);
  routed both through calculateMPG (the fuel>0-guarded form) — identical given the existing volume truthy
  guard. Arch rule 3 satisfied: both functions are property-tested (calculations.property +
  vehicle-stats.property's referenceMpg), green→green (58 pass / 1898 assertions across the 4 MPG suites).
  Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1587 pass / 0 fail (unchanged — pure
  dedup), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — same modules,
  same tests; LOC down, one source of truth for the C161-vulnerable loop).
- **C18 (guard)** — **Direct unit net for `averageConsecutiveMpg` (the C17-extracted shared MPG loop).**
  guard was over budget (7/6). The C17 dedup created a load-bearing shared helper that was only tested
  INDIRECTLY through its two callers (calculateAverageMPG + calculateVehicleStats) — the C181/C229
  "helper tested only in isolation" gap (same class as monthsBetween/C6). GUARD: +6 cases in
  calculations.test.ts pinning the helper's OWN cells: mean over consecutive pairs (miles/current.volume),
  <2-rows/empty→null, missedFillup-skip (current OR previous), both-odometer-AND-current-volume guard,
  outlier drop (negative-delta + ≥150), and the half-open band edge (149.9 kept / exactly 150 dropped).
  Surfaced + pinned a real footgun while writing it: the loop guard is `current.mileage && previous.mileage`
  (TRUTHY) so a 0-odometer reading is falsy and drops the pair — documented in the test so a future reader
  doesn't anchor a case at mileage 0. The (0,150) band is the #30-escalated divergence point — pinned
  EXACTLY, NOT unified (product call). Inherently non-vacuous (exact-number/null per branch). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1593 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — calculations module already covered;
  +6 pin the newly-shared helper directly).
- **C19 (deep-review)** — **Audited the foreign-import money/date path firsthand (all CLEAN) + eyes-on
  certified the C16 dialog's EMPTY state.** deep-review was over budget (6/5, most-starved; bug also over
  at 4 but less-starved). Scouted four fresh surfaces: Google Sheets service (header-coverage + service
  tests already saturated), csv-safety (neutralize/denormalize + round-trip tests saturated), and
  import-mapping's `normalizeDecimal` + `normalizeForeignDate`. DEBUNKED a candidate firsthand: comma-only
  `normalizeDecimal` (e.g. "1,234"→"1.234") LOOKS like a thousands bug, but the tests + #124 lesson
  establish comma-only = EU decimal BY DESIGN (the both-separator US case is the #124 fix; comma-only-
  thousands is a known single-value ambiguity resolved toward EU) — intended, not a bug. normalizeForeignDate
  is comprehensively pinned (local-time discipline / mdy-dmy swap / epoch sec-millis / 2-digit-year pivot /
  out-of-range #23 guard). No fresh defect. DELIVERED the eyes-on half of deep-review: certified the C16
  MaterializedExpensesDialog EMPTY state (shipped C16 but only its DATA state was shot) — a future-dated
  reminder (Next: Jan 2099, 0 materialized) opens the dialog → renders the "No expenses yet" Receipt
  EmptyState cleanly (Read the PNG; backend GET /reminders/:id/expenses→200 returned []), NOT a blank/broken
  panel. The dialog's data + empty four-states are now both eyes-on confirmed. Verify: frontend
  validate:local was GREEN at C16 (no FE source changed this cycle; the spec is gitignored). cov: be 87.22%
  / fe 86.07% (~ — audit + eyes-on cert, no module touched).
- **C20 (bug)** — **#30 efficiency-band unification (Angelo-APPROVED 2026-06-17).** bug was over budget
  (5/3). DISCOVERED mid-cycle that Angelo ratified the entire pending-Angelo backlog as actionable-with-
  agreed-fixes (a new BACKLOG block) — so the bug surface is NOT exhausted; there's a severity-ranked queue
  of real approved fixes. Picked the highest-leverage approved BUG that my own C17/C18 work made a near-one-
  edit: the #30/#94-adjacent (C419) divergence — per-vehicle stats used the `(0,150)`/`(0,10)` band while
  analytics charts used `[5,100]`/`[1,10]`, so the SAME car showed two different MPG/mi-kWh averages on the
  stats card vs the Analytics Fuel Stats card. FIX (Angelo's agreed approach): unify on the documented
  `[5,100]` gas / `[1,10]` electric band. Moved the 4 band constants (MIN/MAX_VALID_MPG, MIN/MAX_VALID_MI_KWH)
  into calculations.ts as ONE source of truth (the lower-level module; analytics-charts now imports them —
  correct dependency direction, no cycle), and switched `averageConsecutiveMpg` (gas) +
  `calculateAverageMilesPerKwh` (electric) to the inclusive shared bounds. Updated the band-dependent tests
  + both property-test reference impls + the analytics boundary describe (now pins INCLUSIVE 100 kept / <5
  dropped / the new MIN floor) + stale divergence comments. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1594 pass / 0 fail, build bundled. Backend-only (per-vehicle stats come from /stats →
  this band; FE has no own MPG band → no divergence). cov: be 87.22% / fe 86.07% (~ — bands unified, same
  modules). NOTE the C19 financing/TCO audit (buildAmortizationSchedule/computeTCOTotal/categorizeTCOExpenses)
  was done first this cycle + all CLEAN — folded into this entry; that vein stays dry.
- **C21 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence).** Two cats over
  budget (infra 7/6 > feature 5/4); infra is the most-starved → forced. (1) UNTRACKED-TEST SWEEP: CLEAN —
  zero untracked `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` are by-design). (2) COVERAGE
  RE-MEASURED (6 commits since C14): **BE 87.22% line / 86.96% func; FE 86.07% line / 87.19% func / 78.53%
  branch** — BOTH UNCHANGED vs C14 (the C15-C20 arc was tests/dedups on already-covered modules + the C16
  eyes-on dialog; the C20 band-unification swapped literals, no new lines). At the ~87 BE / ~86 FE
  structural ceiling. (3) BOTH-SIDES GREEN: BE 1594 / FE 721. (4) BRANCH STATE: claude-loop-dev = 20
  commits ahead of fresh origin/main (C1-C20: 4 feature, 2 bug[1 dry]+1 dry-scout, 3 deep-review, 2 guard,
  1 arch, 2 infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source
  touched. cov: be 87.22% / fe 86.07% (MEASURED). NEXT cadence ~C31.
- **C146 (PR-GREEN override — FIXED the frontend CI failure: it was CI's destructive `rm lock && npm install`, NOT an upstream parser bug)** —
  Override active; main unchanged (fb35c17); HEAD was 0d96620 (C145). Re-checked upstream FIRST (the only thing that
  moves without Angelo): byte-identical to C145 — vite@latest still 8.0.16, beta still 8.1.0-beta.0, vite-plugin-svelte
  still 7.1.2, NO new rolldown 1.0.4+ patch. So the "await an upstream patch" path was still closed. THEN re-derived the
  blocker from scratch instead of re-confirming the C141.5–C145 conclusion — and the conclusion was **WRONG**. Those
  cycles tested version *bumps* (downgrade / plugin-bump / rolldown-override / 8.1-beta) and never tested the install
  *method*. The real divergence: **`npm ci` (committed lockfile) builds CLEAN** (0 PARSE_ERROR, full bundle, 749/749
  FE tests) but **CI's `rm -rf node_modules package-lock.json && npm install`** (its "workaround for the npm
  optional-dependencies bug") regenerates a DIFFERENT lockfile that fails with 5× `[PARSE_ERROR] Expected ',' or ')'
  but found '?'` on TS optional params (`event?`, `lastSyncAt?`, `jump?`) — on the SAME vite@8.0.16 / rolldown@1.0.3.
  Proof matrix run firsthand THIS cycle (clean node_modules each time): committed-lock build → exit 0 / 0 errors (×2,
  incl. a full `npm ci` from scratch); `rm lock && npm install` build → exit 1 / 5 errors. The lockfile diff confirms
  the mechanism — the destructive re-resolve shifts rolldown's platform-binding/`@emnapi/runtime` resolution onto the
  buggy WASM-fallback parser path. The committed `package-lock.json` is **cross-platform-complete** (verified all 15
  `@rolldown/binding-*` entries incl. `linux-x64-gnu` for the x64 CI runner, each `os`/`cpu`-scoped), so `npm ci` on
  CI installs the correct native binding → build passes. FIX (infra, one CI step): replaced the FE job's
  `rm -rf node_modules package-lock.json && npm install && npm install --frozen-lockfile` with `npm ci` + a comment
  documenting the failure mode and the local proof. This is squarely the override's mandate (a CI build-break fix, not
  a $/semantics product call). VERIFY (both sides, full local gate): backend validate:local GREEN (tsc 0, musl-biome
  clean, 1771 pass, build bundled); frontend validate:local GREEN on a from-scratch `npm ci` tree (tsc 0, build 0
  PARSE_ERROR, 749/749 tests). Working tree clean of lockfile churn (restored). Infra cycle (CI yaml only; no app
  source touched → no shot needed). cov: be 88.21% / fe 88.23% (~ — no test/source change). The PR's only red check
  should now go green on the next CI run — pushing so CI re-runs; if green, the PR is merge-ready and the override can
  lift. NEXT: confirm CI conclusion next cycle; if Frontend Tests flips to success, ping Angelo merge-ready.
  **[C30 CONFIRMED]** CI re-ran on 5d89397 → **Frontend Tests: success**. ALL PR-gating checks now GREEN (Backend
  Tests ✓ · Frontend Tests ✓ · update-release-draft ✓; the only skipped jobs are deploy-only, not PR-gating). The
  C146 `npm ci` fix is validated end-to-end IN CI — the FE blocker that gated this PR since C141 is closed. **PHASE
  BOUNDARY: the PR is merge-ready.** Pinged Angelo. The PR-green override has done its job; awaiting his merge / lift
  of the override block (after which normal balance-table rotation resumes — current starvation: feature most-starved
  at last-touched 121).
- **C145 (PR-GREEN override — VERIFIED the `vite@8.1.0-beta.0` forward path is blocked too; ALL levers exhausted)** —
  Override active; main unchanged; Angelo not ruled. Backend GREEN / Frontend RED. Last cycle I'd offered to test
  vite@8.1.0-beta.0 (the next Vite, which pins a coordinated rolldown 1.1.1 — so it'd dodge the C144 export-mismatch).
  Tested LOCAL + fully reverted: read-only confirmed 8.1.0-beta.0 pins rolldown 1.1.1 (and there are NO stable
  1.0.4+ patches between 1.0.3 and 1.1.0 — the beta is the only newer-rolldown path). Tried installing it → **npm
  ERESOLVE**: `@sveltejs/vite-plugin-svelte@7.1.2` peers `vite ^8.0.0-beta.7 || ^8.0.0`, which EXCLUDES `8.1.0-beta.0`
  (a pre-release of the next minor). So the 8.1-beta needs `--force`/`--legacy-peer-deps` + a coordinated
  vite-plugin-svelte bump = migration surgery, NOT a loop-safe step. Reverted (npm ci → vite 8.0.16 / rolldown
  1.0.3, tree clean). LEVERS NOW FULLY EXHAUSTED (every avenue firsthand-disproven across C141.5–C145):
  Vite-downgrade (reverts his migration), plugin-bump (already latest+vite8-only-peer), lockfile-respect (lock pins
  1.0.3), rolldown-override→1.1.2 (incompatible-export, C144), vite@8.1-beta (peer-blocked, this cycle). The PR is
  a pure upstream Vite-8/rolldown-1.0.3 parser bug needing Angelo's migration-level decision (force-install the
  coordinated 8.1-beta+plugin set, await an upstream rolldown patch, or pause the migration to 7.x). Reported to
  Angelo (closes the "test 8.1-beta?" question). ZERO remaining loop-safe actions on this PR. No code committed.
  cov: be 88.21% / fe 88.23% (~). NEXT: genuinely nothing autonomous left here — resume only on Angelo's decision
  / override lift.
- **C144 (PR-GREEN override — VERIFIED the rolldown-override fix candidate fails; the last untested lever is now
  disproven → fully gated on Angelo)** — Override active; main unchanged (fb35c17); Angelo not ruled. Backend GREEN
  / Frontend RED. Last cycle I'd offered to verify the `overrides: { rolldown: 1.1.2 }` candidate before applying —
  did that this cycle (LOCAL + fully reverted, never committed/pushed): added the override, fresh `npm install`
  (resolved rolldown→1.1.2), ran the full FE gate. RESULT: **WORSE, not fixed** — `vite build` still EXIT 1 with a
  NEW harder error `SyntaxError: module 'rolldown/experimental' does not provide an export named
  'viteWasmFallbackPlugin'` (Vite 8.0.16 imports a rolldown API that 1.1.2 removed/renamed), AND type-check + test
  regressed to EXIT 1 (they passed on 1.0.3). So rolldown is WELDED to its exact Vite-pinned version (1.0.3); a
  newer rolldown breaks the Vite↔rolldown contract harder. Fully reverted (npm ci → rolldown back to 1.0.3,
  overrides back to just serialize-javascript, working tree clean). This DISPROVES the last untested lever —
  combined with C141.5/C142/C143 the full autonomous fix-space is now exhausted: Vite-downgrade (reverts his
  migration), plugin-bump (already latest+vite8-compat), lockfile-respect (lock also pins 1.0.3), rolldown-override
  (verified incompatible). The blocker is unambiguously an upstream Vite-8/rolldown 1.0.3 parser bug needing
  Angelo's migration-level call (8.1.0-beta / await upstream / pause the migration). Reported the verification
  result to Angelo (the promised follow-up, not a new ping). No code committed. cov: be 88.21% / fe 88.23% (~).
  NEXT: resume on Angelo's decision / override lift; no remaining loop-safe action on this PR.
- **C143 (PR-GREEN override — FE blocker investigation EXHAUSTED; no loop-safe fix exists → HOLDING for Angelo)** —
  Override active; main unchanged (fb35c17); Angelo not ruled in-repo; Backend GREEN / Frontend RED (rolldown
  TS-optional-param parse, C141.5). This cycle RULED OUT every remaining loop-safe fix firsthand, so I'm not
  guessing or re-theorising further: (1) downgrade Vite → reverts Angelo's DELIBERATE Vite-8 migration (C142, wrong);
  (2) bump `@sveltejs/vite-plugin-svelte` → 7.1.2 is ALREADY latest AND peer-declares `vite ^8.0.0` support (npm
  view confirmed) — no newer version to fix it; (3) make CI honor the lockfile (`npm ci` vs the workflow's `rm lock
  && npm install`) → the COMMITTED lock ALSO pins rolldown 1.0.3, so the lock isn't the float source — no help; (4)
  edit rolldown/svelte-config internals → guessing inside his migration (forbidden). CONCLUSION: the failure is a
  genuine bug in the CURRENT-latest toolchain matrix (Vite 8.0.16 + vite-plugin-svelte 7.1.2 + rolldown 1.0.3, all
  current), which is exactly why main itself is red (#274) — NOT a version-lag the loop can patch. It needs Angelo's
  call (downgrade-and-pause-the-migration, or a rolldown/upstream fix). Already escalated TWICE (C141.5 + C142, the
  2nd with the corrected forward-not-downgrade framing); re-pinging a 3rd time with no new actionable info would be
  noise, so HOLDING quietly per the override (a blocked check needing a decision → escalate, then wait). No code
  changed. cov: be 88.21% / fe 88.23% (~). NEXT: resume on Angelo's toolchain decision OR if he lifts the override.
- **C142 (PR-GREEN override — FE blocker still gated on Angelo; CORRECTED the fix direction: it's his in-progress
  Vite-8 migration, NOT a downgrade)** — Override still active; main unchanged (fb35c17); Angelo hasn't ruled
  in-repo yet. CI unchanged: Backend GREEN, Frontend RED (the C141.5 rolldown TS-optional-param parse failure).
  HYGIENE: discarded an unintended `M frontend/package-lock.json` drift left by last cycle's CI-repro fresh
  `npm install` (newer transitive deps — @adobe/css-tools/@babel/runtime etc.); restored the committed lock so the
  PR isn't polluted with a churned lockfile (which could itself break CI's --frozen-lockfile). KEY CORRECTION to the
  C141.5 escalation: traced the git history of frontend/package.json's vite line → Vite 8 was NOT a stray dependabot
  bump; `251d3fb` bumped 7.3.2→8.0.16 followed by DELIBERATE human compat work (`4f87a64 fix(build): use
  @tailwindcss/vite plugin for Vite 8 compat`, `22ecb68 fix(charts): upgrade chart registry + layerchart to
  next.65`). So this is Angelo's IN-PROGRESS Vite-8 migration — option-1 "pin Vite back to 7.x" would REVERT his
  work and is the WRONG fix (don't undo deliberate migration). Also confirmed `svelte.config.js` already sets
  `vitePreprocess()` (TS transpile IS configured) and `@sveltejs/vite-plugin-svelte` is 7.1.2 — so the failure is a
  vite-plugin-svelte 7.1.2 ↔ Vite 8 ↔ rolldown 1.0.3 INTEGRATION gap (the preprocessor's TS output isn't reaching
  rolldown before it parses), i.e. the forward fix is a vite-plugin-svelte / rolldown version bump, NOT a Vite
  downgrade. This is firmly a dependency decision inside his migration → re-escalated with the corrected, sharper
  diagnosis; HOLDING (the only mechanically-safe action — reverting Vite — is actively wrong). No code changed.
  cov: be 88.21% / fe 88.23% (~). NEXT: await Angelo's toolchain decision; apply + re-verify the FRESH-install build.
- **C141 (PR-GREEN override — fix the LAST red check: bump CI Node 20→22 so Vite 8's `vite build` step passes)** —
  After C140, CI run #293: **Backend Tests = SUCCESS** (both backend fixes landed), Frontend Tests still failing
  with only a bare workflow exit-1 (no file annotation; job logs admin-gated). Pinpointed the step via the public
  `/actions/runs/<id>/jobs` API (step conclusions ARE public even though logs aren't): install/prepare/type-check/
  lint/test ALL ✅, **"Build application" ❌** — `npm run build` (`vite build`) is the only red step. ROOT CAUSE:
  Vite 8.0.16's declared engine is `node ^20.19.0 || >=22.12.0`; the frontend CI job pinned `node-version: '20'`,
  which the runner resolved to a Node 20.x the Vite-8 build hard-failed on. KEY: `git diff origin/main...HEAD` over
  frontend/ is EMPTY + vite is 8.0.16 on BOTH branch and main → this is a PRE-EXISTING CI toolchain mismatch, NOT a
  branch-introduced regression (locally the build passes on node22). FIX: bumped the frontend job's Node 20→22 in
  ci-cd.yml (matches CLAUDE.md's documented node22+bun toolchain + Vite 8's preferred engine). This edits the CI
  workflow that gates all PRs/main — flagged to Angelo as a config change (send_message), but applied because it's
  the evidence-backed blocker the override exists to clear, low-risk, and reversible. **OUTCOME: Node 22 did NOT
  fix the build (run #294 still red) — the version-floor was a wrong guess** (Node-20.x-latest already met
  `^20.19.0`). Kept the bump (correct hygiene vs the project's node22 standard), but it's not the cause.
  **REAL ROOT CAUSE** (found by reproducing CI's FRESH `npm install` + `vite build` — my earlier local builds reused
  a stale node_modules so they passed): `vite build` fails with 11 `[PARSE_ERROR] Expected ',' or ')' but found
  '?'` from **rolldown@1.0.3** (Vite 8's bundler) choking on TypeScript **optional-parameter** syntax in `.svelte`
  scripts — `handleSubmit(event?)`, `formatLastSync(lastSyncAt?)`, `scrollTo(index, jump?)`, carousel.svelte, AND
  inside the dependency `node_modules/layerchart/.../TooltipContext.svelte`. rolldown parses the Svelte
  `<script lang="ts">` as plain JS → `param?` is a syntax error. PRE-EXISTING PROJECT-WIDE toolchain regression:
  main's own CI run #274 (3ff50fa) is ALSO `failure`, frontend/ is byte-identical to main, vite 8.0.16 on both →
  NOT branch-caused + NOT loop-fixable with a one-liner. Needs a DEPENDENCY/BUILD decision (pin Vite→7.x
  [rollup-based, parses TS fine] / pin-or-upgrade rolldown / fix the svelte-vite TS preprocessor). Per override
  step 5 (red check needing a version/semantics decision → send_message Angelo, don't guess) → ESCALATED, not
  auto-fixed. STATUS: Backend Tests GREEN (C139+C140); Frontend Tests BLOCKED on the toolchain call. cov: be
  88.21% / fe 88.23% (~). NEXT: await Angelo's toolchain decision; apply + re-verify the FRESH-install build.
- **C140 (PR-GREEN override — fix the 2nd RED CI failure: registry.test.ts's leaking `mock.module('encryption')`
  corrupted the providers-routes-http credential-encryption assertion)** — After C139 (the 0005-snapshot fix), CI
  run #292 dropped backend annotations 10→2: the migration cascade was GONE, leaving an ISOLATED failure
  `providers-routes-http.test.ts:268 expect(received).not.toContain('rotated-secret-9999')` — the stored credentials
  column held `encrypted:{"secretAccessKey":"rotated-secret-9999",...}` (plaintext under a fake prefix) instead of
  real AES ciphertext. ROOT CAUSE (traced firsthand): `registry.test.ts:12` does
  `mock.module('../../../utils/encryption', { encrypt: p => \`encrypted:${p}\` })` and NEVER restores it — Bun's
  mock.module is PROCESS-GLOBAL + non-restorable (sync-worker.test.ts:17 documents this; .kiro steering says
  inject-don't-mock.module). When CI's file order ran registry before providers-routes-http, the stub `encrypt`
  leaked into the REAL PUT-credentials route → it stored the plaintext-prefixed blob → the "encrypted at rest,
  never echo the secret" SECURITY assertion failed. It passed locally only because local file ordering avoided the
  collision. FIX (per the steering doc, matching the sync-worker precedent): DROP the mock.module; set a
  deterministic `PROVIDER_ENCRYPTION_KEY` (mirrors test-helpers/http-client.ts) + build fixtures with the REAL
  `encrypt()` via an `enc()` helper (7 credential literals converted; the garbage-creds fake-gate test keeps its
  intent via `enc('not-valid-json{{{')`). VERIFY: ran registry + providers-routes-http together in the CI-FAILING
  order → 48 pass / 0 fail (leak gone); full CI backend sequence green — db:generate no-op, type-check OK, biome 0
  errors, bun test 1770 pass / 0 fail, build OK. Both confirmed backend failures (C139 migration + C140 mock-leak)
  are now fixed. FRONTEND: still a bare workflow exit-1 (no readable detail; logs admin-gated; all FE CI steps green
  firsthand locally) — pushing so the fresh run gives a clean, backend-noise-free FE signal. cov: be 88.21% / fe
  88.23% (~ — test-only). NEXT: read the post-push CI run; if backend green + FE still red, the FE failure is now
  isolated for the next cycle to drill.
- **C139 (PR-GREEN override — fix RED CI: missing `0005_snapshot.json` made `db:generate` emit a spurious 0006
  that re-created an existing index → Backend Tests failed)** — PRIORITY OVERRIDE active (Angelo): only job is a
  green PR (C138 recorded the override + merged latest main). Read the LIVE CI via the public GitHub API (no `gh` on
  host): PR #114 "Merge Monday", HEAD 380a35e, mergeable_state=unstable — BOTH `Backend Tests` + `Frontend Tests` =
  failure (run #291). Pulled failure detail from the check-run ANNOTATIONS endpoint (job logs are admin-gated 403).
  BACKEND ROOT CAUSE (confirmed + FIXED): annotation `Migration 0006_careful_vance_astro failed: index
  vehicles_user_license_plate_idx already exists` → cascading `testDb.sqlite undefined` in sql-helpers.test.ts.
  Traced firsthand: `drizzle/meta/` had committed snapshots 0000–0004 but **0005_snapshot.json was NEVER committed**
  (when 0005_license_plate_per_user.sql landed Jun 11), though _journal lists 0005. So CI's `db:generate` diffs
  schema.ts against the stale 0004 snapshot → re-emits the 0005 license-plate index as a spurious 0006 (its
  prevId=0004's id, proving it skipped 0005) → the migration test harness applies BOTH 0005 (creates index) + 0006
  (re-creates) → "already exists" → fail. FIX: committed the missing `0005_snapshot.json` (the just-generated 0006
  snapshot IS the correct post-0005 serialization → saved as 0005; restored _journal to its committed 6 entries;
  deleted the spurious 0006). VERIFY: the EXACT CI sequence now passes — `db:generate` → "No schema changes, nothing
  to migrate 😴" (no 0006) → `bun test` 1770 pass / 0 fail; type-check + biome check clean. FRONTEND failure:
  annotation is only a bare workflow exit-1 (no file detail; logs admin-gated); all FE CI steps
  (install/type-check/eslint/test 749/build) pass firsthand locally — can't repro. Per the override ("fix ONE red
  check per cycle, push so CI re-runs"): shipping the confirmed backend fix; the fresh run gives a clean FE signal
  (next cycle reads new annotations with the backend noise gone). cov: be 88.21% / fe 88.23% (~ — migration-meta
  only, no src). NEXT: read run #292; if Backend green + FE still red, drill the now-isolated FE failure.
- **C137 (bug — REAL a11y defect fixed: 2 odometer forms' icon back-button had no accessible name; FRESH vein)** —
  Balance at C137 (HEAD was C136): feature (16/4) + bug (15/3) most-starved over budget. Feature Angelo-gated. Bug's
  COLD-scout vein is dry (no prod source since C85) — BUT that precondition only rules out REGRESSIONS in changed
  code, not PRE-EXISTING quality debt. Scouted a genuinely fresh self-authorizable bug source per NORTH_STAR #3
  ("passes axe"): the route-smoke axe sweep enforces a11yClean on the 13 STATIC routes but CANNOT reach the
  DYNAMIC/param routes (it can't hardcode an entity id) — and axe (programmatic labels/contrast/ARIA) catches a
  CLASS visual eyes-on (C124/C125/C131/C132) misses. Wrote a scout spec running AxeBuilder (wcag2a/2aa,
  serious+critical) against the 7 un-swept dynamic forms using seeded ids. FOUND A REAL DEFECT: `button-name`
  (critical) on `/vehicles/[id]/odometer/new` — the icon-only ArrowLeft back-button (variant=ghost size=icon) has
  NO discernible text + NO aria-label, so a screen-reader user can't identify it. Traced firsthand: the odometer
  EDIT page (`[entryId]/edit:150`) shares the IDENTICAL unlabeled back-button (2 instances of one defect; the EDIT
  page wasn't in my first scout pass). FIX: added `aria-label="Back"` to BOTH (the canonical convention — TagInput/
  ExpenseSearchFilters label their icon controls the same way). The other 5 dynamic forms (term-new/term-edit/
  insurance-edit/vehicle-edit/vehicle-detail) scanned CLEAN — their headers use text back-links, not icon buttons.
  VERIFY: re-ran the axe scout → all 7 dynamic routes now PASS (both odometer routes fixed). FE validate:local exit
  0 (type-check + build + vitest), 749 pass. FE-only → BE validate not required. NOTE: this is the FIRST production
  source change since C85 — the bug/arch cold-scout precondition (`git diff C85..HEAD` empty) is now RESET; the new
  baseline for future cold scouts is this commit. The scout spec (dynamic-routes-a11y.meshclaw.e2e.ts) is
  gitignored-by-design; the merge-surviving net is the source fix + the route-smoke a11yClean ratchet (which the
  static routes already enforce). cov: be 88.21% / fe 88.23% (~ — markup-only a11y attr, no logic lines). NEXT bug:
  the a11y dynamic-route vein is now swept + clean; re-running it is the recheck. The cold pure-logic vein resets to
  this commit as baseline.
- **C136 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C130)** — Balance at
  C136 (HEAD was C135): feature (15/4) + bug (14/3) most-starved but PERPETUALLY BLOCKED (feature detect-commit
  Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified); infra (6/6) + arch (5/5) at budget. Picked
  infra: it's AT its cadence budget (the budget IS the ~10-cycle cadence signal; last ran C130) AND the substantive
  non-dry pick (captures the C133/C134 coverage arc), whereas arch is a guaranteed no-churn (no prod source since
  C85). (1) UNTRACKED-TEST SWEEP: CLEAN — the C133/C134 test files are tracked/committed; only the intentional
  `M .gitignore` / `M frontend/.gitignore` overrides remain. (2) COVERAGE RE-MEASURED: BE 88.21% line / 87.79% func
  (1770 pass) — +0.08 vs C130's 88.13, the C133 (pending-credentials eviction → 100%) + C134 contributions; FE
  88.23% line / 88.69% func / 80.32% branch / 86.14% stmts (749 pass) — matches C134 (C135 was a doc-only cert, no
  FE source). Both holding above 88% line. (3) BOTH-SIDES GREEN: BE validate:local exit 0 (1770) / FE 749, 0 fail.
  (4) BRANCH STATE: claude-loop-dev = 136 commits ahead of fresh origin/main, PR-ready (category spread guard 28 /
  bug 28 / deep-review 23 / feature 21 / infra 19 / arch 16 — guard tied bug atop the C126–C134 coverage arc;
  healthy balance across all six). Doc-only — no source touched. cov: be 88.21% / fe 88.23% (MEASURED). NEXT cadence
  ~C146. STANDING SIGNAL: all self-authorizable veins are CLOSED — coverage both sides (C126–C134), eyes-on every
  surface (C132 milestone), route-IDOR (C108–C116), analytics-builders (C119–C122), backend data-safety certs
  (C135 + the C3/C8/C13/C39/C74/C81/C92 set). The loop is at steady-state maintenance: bug dry / arch no-churn /
  guard+deep-review re-scanning certified ground / infra cadence. Highest-leverage work GATED on Angelo (#148 READY
  / import defaultCategory / createLoadState + seedVehicle arch designs / #100/#79/#129).
- **C135 (deep-review — CERTIFIED the merge-restore `detectConflicts` insert-vs-probe symmetry CLEAN; a
  raw-UNIQUE-throw gap hypothesis DEBUNKED firsthand)** — Balance at C135 (HEAD was C134): NOTHING actionable over
  budget — feature (14/4) + bug (13/3) most-starved but PERPETUALLY BLOCKED (feature detect-commit Angelo-gated;
  bug `git diff C85..HEAD` over prod src EMPTY — verified). Per "nothing actionable over → highest-leverage open
  item"; with the coverage frontier closed (C134), took the deep-review BACKEND-CORRECTNESS cert vein (distinct
  from coverage-chasing). SCOUT: `restore.ts` `detectConflicts` (NORTH_STAR #1 merge-restore data-safety, subject
  of the #93/#132/#441 reactive fixes) had no single "CERTIFIED" ledger entry. Traced firsthand a plausible gap:
  the INSERT path touches 15 tables but detectConflicts PROBES only 9 → the 6 inserted-but-unprobed
  (insuranceTerms/insuranceTermVehicles/insuranceClaims/odometerEntries/reminderNotifications/reminderVehicles all
  carry client-supplied text PKs that survive export→import) looked like a raw-UNIQUE-throw-aborts-whole-restore
  risk on a colliding merge. DEBUNKED: `restore-table-coverage.test.ts` (C209/C302/C441) ALREADY guards this exact
  insert-vs-probe symmetry — its test 2 documents all 6 in CHILD_OF_PROBED_PARENT with the load-bearing reasoning
  that a colliding merge ABORTS on the probed PARENT's conflict first (detectConflicts returns BEFORE the
  transaction runs), so the child insert is unreachable on a collision. Confirmed firsthand the guard PASSES (3/3)
  + the #93/#132 collision tests pass (2/2). So detectConflicts + its drift symmetry is genuinely CERTIFIED CLEAN
  and COMPREHENSIVELY GUARDED — the parent-collides-first invariant closes the class. Recorded the cert + the
  debunked hypothesis; did NOT manufacture a redundant guard (the C86/C16 verify-firsthand-find-already-guarded
  discipline). VERIFY: no source touched (cert + debunk). cov: be 88.13% / fe 88.23% (~). NEXT deep-review: the
  backend data-safety surfaces are now broadly certified (backup-export C81, restore-stamp C8/C11, restore-ordering
  C13, restore-conflict-symmetry C135, idempotency-key C74, OAuth-state C39, rate-limit C92, photo-allowlist C3) —
  remaining audits would re-scan certified ground; real new findings now come only from an Angelo steer or a
  feature/bug-surfaced concrete invariant.
- **C134 (guard — pin `apiClient.raw` URL-build + credentials; the file-download/data-export path was uncovered)** —
  Balance at C134 (HEAD was C133): NOTHING actionable over budget — feature (13/4) + bug (12/3) most-starved but
  PERPETUALLY BLOCKED (feature detect-commit Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified).
  Per "nothing actionable over → highest-leverage open item." SCOUT (re-checking C133's "frontier exhausted" claim
  honestly): re-ran FE coverage. FIRST tried `offline.svelte.ts` (88% line / 50% branch, the online/offline window
  LISTENERS 18-23) but PROVED it structurally hard firsthand — wrote the test, `window.dispatchEvent(new
  Event('offline'))` did NOT flip the status (import-time listener on a global window happy-dom doesn't reliably
  re-target), 3 RED → DELETED the brittle test (the documented DOM/effect-bound FE residual, the C101 listener-
  harness class — not a clean pick). PIVOTED to `api-client.ts` (95.23% line) — lines 131-132 = `apiClient.raw`, the
  raw-Response fetch used for FILE DOWNLOADS (the backup-ZIP export, NORTH_STAR #1 data portability); unlike
  request() it returns the Response un-unwrapped, and the sibling tests never drove it. GUARD: extended the tracked
  api-client.test.ts (+3): a relative url is base-prefixed + `credentials: 'include'` ALWAYS sent (a dropped
  credentials = a 401 on every download); an absolute http url passes through unchanged; method+headers options
  forward (credentials still forced). NON-VACUOUS proven firsthand: dropped `credentials: 'include'` from raw() → 2
  tests RED. (Also caught + fixed a strict-TS issue: bare `mock.calls[0]` indexing → the file's `?? []` safe-destructure
  idiom, so svelte-check stays green.) VERIFY GATE GREEN: FE validate:local exit 0 (type-check + build + vitest),
  749 pass (+3 vs C133's 746). Frontend-only → BE validate not required. COVERAGE: api-client.ts 95.23→**100% line /
  100% func** (residual 41/65/68 are branch-only absolute-url ternary alts, structural); OVERALL FE 88.08→**88.23%
  line / 88.69% func / 80.23% branch**. Modifies a TRACKED test file (committed regression net). cov: be 88.13% /
  fe 88.23% (MEASURED). NEXT guard: the FE service/util layer is now at its structural ceiling (api-client +
  expense-api pass-throughs + sync-manager DOM/timer + the offline/theme listeners are all effect/DOM-bound) — the
  self-authorizable coverage work is genuinely complete both sides.
- **C133 (guard — pin the pending-OAuth-credentials MAX_SIZE eviction; the DoS-prevention branch was uncovered)** —
  Balance at C133 (HEAD was C132): NOTHING actionable over budget — feature (12/4) + bug (11/3) most-starved but
  PERPETUALLY BLOCKED (feature detect-commit Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified);
  guard/infra/arch/deep-review under. Per "nothing actionable over → highest-leverage open item." SCOUT: with the
  eyes-on vein exhausted (C132) + the four coverage veins closed, scanned the analytics SQL layer (DB-bound, not
  clean) + the private analytics-repo helpers (computeAverageEfficiency/resolveUnitsOrDefault — PRIVATE, not
  exported, only class-reachable → would need an API change or DB scaffolding, skipped) and the sub-100% exported
  utils. Lowest was `pending-credentials.ts` (92% line) — a CREDENTIALS/security module (stages a provider OAuth
  refresh token between callback + provider-create). The uncovered lines 53-56 are the MAX_SIZE (1000) oldest-
  eviction branch in storePending — a DoS-prevention contract (abandoned OAuth flows must not grow the in-memory
  store unbounded). The existing test (C83) conceded a "light functional check" that stored ONE entry, never
  reaching MAX_SIZE → the eviction never executed. GUARD: extended the tracked pending-credentials.test.ts (+1):
  fill to MAX_SIZE → store one more → assert the cap HOLDS (size stays 1000), the OLDEST (insertion-order) entry is
  evicted, the newest is retained, and only ONE eviction per over-cap insert (second-oldest survives). NON-VACUOUS
  proven firsthand: removed the eviction delete → size grew to 1001 (the unbounded-growth regression) → test RED.
  VERIFY GATE GREEN: BE validate:local exit 0, 1771 pass, build bundled. COVERAGE: pending-credentials.ts
  92→**100% line / 100% func** (the security module is now fully pinned). Backend-only → FE validate not required.
  Modifies a TRACKED test file (committed regression net). cov: be ~88.15% / fe 88.08%. NEXT guard: the
  exported-pure-util coverage frontier is now essentially exhausted (calculations 98.94/validation 99.20/
  analytics-charts 99.63 are at their structural ceilings; logger is log-string noise) — residual is DB/DI/OAuth/
  network/private-method bound. The self-authorizable coverage work is genuinely complete.
- **C132 (deep-review — eyes-on cert of the last 2 never-shot EDIT forms → MILESTONE: every real surface eyes-on)** —
  Balance at C132 (HEAD was C131): NOTHING actionable over budget — feature (11/4) + bug (10/3) most-starved but
  PERPETUALLY BLOCKED (feature detect-commit Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified);
  guard/infra/arch/deep-review all under. Per "nothing actionable over → highest-leverage open item." SCOUTED a
  reminders/repository.ts coverage pick first (findByVehicleId, 262-284 uncovered) but REJECTED it: the method has
  NO live route caller (only a dead import in vehicles/routes.ts) + no reminder test builds a constructed-repo over
  a migrated in-memory DB, so covering it = heavy scaffolding OR the C181/C229 coverage-theater trap — confirming
  C130's "clean store/repo picks worked through" claim firsthand. PIVOTED to the eyes-on never-shot-surface vein
  and CLOSED it: shot the last 2 never-shot real surfaces — `/vehicles/[id]/odometer/[entryId]/edit` +
  `/insurance/[id]/terms/[termId]/edit` (the EDIT twins of the C125/C124 /new forms; the differentiator is the
  value-HYDRATION path — a blank/never-rendered edit form is the C68 data-loss footgun). Read both PNGs. CLEAN,
  both correctly HYDRATED: odometer-edit → Reading "31200", Date "07/15/2024" (the seeded recordedAt, correct LOCAL
  date no UTC off-by-one), Note "Summer road trip" + accurate 16/500 counter, +Delete CTA (the edit-only affordance);
  term-edit → Start "January 1, 2024" / End "June 30, 2024" (seeded dates, correct local — the #138 round-trip
  verified on the load path), Total 1200 / Monthly 200, "Daily Driver" checkbox CHECKED (the term's linked vehicle
  — junction hydrated), Policy# "SF123456789". ZERO console errors both, status 200, no auth bounce. No defect.
  **MILESTONE: every real surface is now eyes-on** — pages (dashboard/analytics/insurance/financing/maintenance/
  recurring/settings/profile/expenses/reminders/vehicle-detail) + ALL create+edit forms (expense/vehicle/insurance/
  term ×2/odometer ×2/provider ×2), desktop + mobile sampled. The #138 date-only round-trip is confirmed correct on
  every edit-load path. VERIFY: no source touched (eyes-on cert). cov: be 88.13% / fe 88.08% (~). NEXT deep-review:
  the eyes-on vein is now EXHAUSTED (no never-shot surface left) — deep-review returns to backend correctness audits
  of genuinely unaudited invariants, or awaits an Angelo steer / a feature/bug-surfaced concrete finding.
- **C131 (arch no-churn → pivot to deep-review: eyes-on cert of the never-shot `/settings/providers/[id]/edit`
  form)** — Balance at C131 (HEAD was C130): FOUR over budget — feature (10/4) + bug (9/3) most-starved but
  PERPETUALLY BLOCKED (feature detect-commit Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified),
  arch (7/5, +2) + deep-review (6/5, +1). Among the ACTIONABLE pair, arch is most-starved (+2) → checked its
  precondition first: `git diff C118(043b84b)..HEAD` over backend/src + frontend/src (excl. tests) is EMPTY (only
  the C119–C129 test files changed since the last arch scout) → arch at its structural floor → recorded no-churn
  IMMEDIATELY (12th confirm: C4/C6/C12/C36/C85/C91/C98/C105/C112/C118/C124/C131; both real dedups createLoadState +
  seedVehicle stay design-gated awaiting Angelo) + pivoted the substantive work to the co-starved deep-review (the
  C124/C125 combined-cycle pattern). DEEP-REVIEW: the four self-authorizable coverage veins are closed (C130), so
  took the eyes-on never-shot-surface vein. Scouted routes vs captured shots → `/settings/providers/[id]/edit` was
  NEVER shot (only provider-NEW). It's the storage-credential EDIT surface — the #103/#123 fail-fast
  config-validation subject, NORTH_STAR #1 data-safety (a bricked provider config breaks backups). Shot DESKTOP +
  MOBILE (Pixel 5) against the seeded fake storage provider + Read both PNGs. CLEAN: all sections render
  PRE-POPULATED from the existing row (confirms the edit-load path) — Display Name ("e2e fake provider …"),
  Connection Settings (Provider root path "VROOM" + help), Photo Folder Settings (Root Path "VROOM/photos" +
  collapsible category paths), Backup Settings (folder "VROOM/Backups" + ZIP toggle), Danger Zone (red-bordered
  Delete Provider = destructive-action disclosure), Update Provider CTA. Mobile (393px): all cards full-width
  stacked, help text wraps cleanly, NO horizontal overflow (NORTH_STAR #3), Update FAB pins bottom. ZERO console
  errors both viewports, status 200, no auth bounce. No defect — recorded CLEAN, don't re-shoot. VERIFY: no source
  touched (eyes-on cert). cov: be 88.13% / fe 88.08% (~ — no source). NEXT deep-review: the remaining never-shot
  real surfaces are the term/odometer EDIT forms (likely identical to their /new siblings shot C124/C125 — low
  marginal value); after a quick confirm the surface set is fully eyes-on and deep-review returns to backend audits.
- **C130 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C123)** — Balance at
  C130 (HEAD was C129): FOUR over budget — feature (9/4, +5) + bug (8/3, +5) most-starved but PERPETUALLY BLOCKED
  (feature detect-commit Angelo-gated, manual half fully eyes-on; bug `git diff C85..HEAD` over prod src EMPTY —
  verified) — and infra (7/6, +1) + arch (6/5, +1). Among the ACTIONABLE over-budget pair, picked infra: it's the
  substantive non-dry pick (its cadence is due AND it captures the C126–C129 coverage arc), whereas arch is a
  no-churn record (no production source since C85). (1) UNTRACKED-TEST SWEEP: CLEAN — the C126/C127/C128/C129 test
  files are all tracked/committed; only the intentional `M .gitignore` / `M frontend/.gitignore` overrides remain.
  (2) COVERAGE RE-MEASURED — BOTH suites crossed 88% line for the first time: BE 88.13% line / 87.79% func (1769
  pass) — UP from C123's 87.78 via the C126 (PhotoRepository finders) + C127 (photoThumbnailResponse behavioral)
  arc; FE 88.08% line / 88.4% func / 79.94% branch / 85.94% stmts (746 pass) — UP from C123's 87.6 via the C128
  (settings restoreFromProvider) + C129 (auth updateDisplayName/logout) store arc. The C126–C129 guard arc was the
  productive vein that finally moved BOTH suites off the long ~87.7 plateau (+0.35 BE, +0.48 FE). (3) BOTH-SIDES
  GREEN: BE validate:local exit 0 (1769) / FE 746, 0 fail. (4) BRANCH STATE: claude-loop-dev = 130 commits ahead of
  fresh origin/main, PR-ready (category spread bug 28 / guard 26 / feature 21 / deep-review 21 / infra 18 / arch 15
  — guard surged on the coverage arc; healthy balance across all six). Doc-only — no source touched. cov: be 88.13%
  / fe 88.08% (MEASURED). NEXT cadence ~C140. STANDING SIGNAL: the clean store-logic + constructed-repo + pure-fn
  coverage picks (C126–C129) are now worked through — residual sub-90% is structural (OAuth/network/orchestrator/DI/
  SQL/DOM/timer/SSR-guard). All four self-authorizable veins (FE-logic C100–C102, route-IDOR C108–C116,
  analytics-builder C119–C122, store/repo-coverage C126–C129) are CLOSED; highest-leverage work GATED on Angelo.
- **C129 (guard — pin auth-store `updateDisplayName` merge + `logout` failure path; auth.svelte.ts → 100% line)** —
  Balance at C129 (HEAD was C128): feature (8/4, +4) + bug (7/3, +4) co-most-starved, both BLOCKED (feature
  detect-commit Angelo-gated; bug `git diff C85..HEAD` over prod src EMPTY — verified); infra (6/6) + arch (5/5)
  at budget (infra cadence not due till ~C133, arch would be no-churn). Per don't-force-a-blocked-pick, continued
  the FE coverage vein (C128). SCOUT: `auth.svelte.ts` was 90.47% line / 50% BRANCH — the low branch flagged real
  untested logic: `updateDisplayName` (74-81, ENTIRELY untested — the profile-edit method) + the `logout` catch
  (117, the existing test only covered logout success). GUARD: extended the tracked `auth.test.ts` (+3): (1)
  updateDisplayName merges the returned displayName into the existing user while PRESERVING other fields (the
  `if (user)` spread-merge, not a clobber) + returns the updated user; (2) it's a no-op on local state when there's
  no current user (the guard); (3) a failed logout SETS error + does NOT throw (the 117 catch — pinned as
  does-not-force-clear-session so a future change there is deliberate). NON-VACUOUS proven firsthand: neutered the
  displayName merge → the merge test went RED. VERIFY GATE GREEN: FE validate:local exit 0 (type-check + build +
  vitest), 746 pass (+3 vs C128's 743). Frontend-only → BE validate not required. COVERAGE: auth.svelte.ts
  90.47→**100% line / 50→83.33% branch / 100% func** (only line 84 left = the loginWith `browser` SSR-guard, needs
  env sim); OVERALL FE 87.74→**88.08% line / 85.94% stmts** (third consecutive real coverage gain: C126 BE, C128 FE,
  C129 FE). This modifies a TRACKED test file (committed regression net, not a gitignored spec). cov: be 88.02% /
  fe 88.08% (MEASURED). NEXT guard: the residual FE gaps (sync-manager DOM/timer, expense-api pass-throughs,
  loginWith SSR-guard) are all structural — the clean store-logic FE picks are now genuinely worked through.
- **C128 (guard — pin settings-store `restoreFromProvider` mode-gated reload + error path, a NORTH_STAR #1
  data-safety invariant; pivoted FE this cycle)** — Balance at C128 (HEAD was C127): feature (7/4, +3) + bug (6/3,
  +3) co-most-starved over budget, both BLOCKED (feature detect-commit Angelo-gated, manual half fully eyes-on;
  bug `git diff C85..HEAD` over prod src EMPTY — verified). Per don't-force-a-blocked-pick, continued the coverage
  vein — but pivoted to the FRONTEND (C126/C127 swept backend). SCOUT: ran `vitest --coverage`, the lowest real-logic
  FE file was `settings.svelte.ts` (67.5% line); its uncovered lines 142-148/162-163 are `restoreFromProvider` (the
  PROVIDER-path restore) + `loadRestoreProviders` catch blocks. FINDING: settings-api.test.ts pins only the WIRE
  contract; settings-error-clearing.test.ts (C308) pins error-CLEAR-on-entry + one error-SET case (listAllBackups) —
  but `restoreFromProvider`'s mode-gated post-restore reload (the C319/C100 invariant `uploadBackup` got pinned at
  C100, the provider twin did NOT) + its error-set path were both unpinned in the STORE. GUARD: new
  `settings-restore-from-provider.test.ts` (+4) drives the store through the mocked fetch (C308 pattern): a
  non-preview (replace) restore reloads (2 fetches: restore + GET /settings); a preview restore does NOT (1 fetch —
  the dry-run view must survive); merge also reloads (the non-preview branch covers replace AND merge); a failed
  restore SETS store.error + re-throws. The reload is observed via the EXTRA GET the non-preview path issues. WHY IT
  MATTERS: a dropped reload after a replace/merge restore leaves STALE pre-restore settings on screen — a silent
  NORTH_STAR #1 footgun. NON-VACUOUS proven firsthand: neutered the gate to `if (false)` → the replace + merge
  reload tests went RED (only 1 fetch), preview + error stayed green (isolates the exact invariant). VERIFY GATE
  GREEN: FE validate:local exit 0 (type-check + build + vitest), 743 pass (+4 vs C127's 739). Frontend-only → BE
  validate not required. COVERAGE: settings.svelte.ts 67.5→70% line; OVERALL FE 87.6→87.74% line / 85.63% stmts (a
  genuine FE gain). cov: be 88.02% / fe 87.74% (MEASURED). NEXT guard: settings.svelte.ts 162-163
  (loadRestoreProviders catch) + the sync-manager/expense-api tails are DOM/timer/pass-through-bound (C103/C107
  structural) — the clean FE store-logic picks are nearly worked through.
- **C127 (guard — BEHAVIORAL pin of `photoThumbnailResponse`; the security headers had a SOURCE-scan but no
  executing test)** — Balance at C127 (HEAD was C126): bug (5/3, +2) + feature (6/4, +2) co-most-starved over
  budget, both BLOCKED (bug `git diff C85..HEAD` over prod src EMPTY — verified; feature detect-commit Angelo-gated,
  manual half fully eyes-on). Per don't-force-a-blocked-pick, continued the C126 coverage vein. SCOUT: re-ran
  coverage, scanned the 60–88% band; `photos/helpers.ts` (75.38% line) had two uncovered slices —
  `validatePhotoOwnership` (17-24, getDb-SINGLETON-bound → NOT cleanly unit-testable, the C229 trap, correctly
  skipped) and `photoThumbnailResponse` (110-117, a PURE fn). FINDING: photoThumbnailResponse already has a guard
  (photo-serve-headers.test.ts) but it's a SOURCE SCAN (reads helpers.ts as text via readFileSync + .toContain) —
  it NEVER calls the function, so the fn showed 0% line coverage and a header object mis-wired to the Response (wrong
  arg, body/headers swapped) would pass the scan. GUARD: new `photo-thumbnail-response.test.ts` (+4, +8 expect)
  drives the REAL function + asserts the constructed Response's actual headers + body: all four serve headers
  including the MANDATORY `X-Content-Type-Options: nosniff` (#77/#35 — the serve uses the client-asserted,
  never-sniffed mimeType, so dropping nosniff reopens the stored-content MIME-sniff vector), Content-Type echoes
  mimeType verbatim, Cache-Control `private` (shared proxy must not cache another user's photo), CORP cross-origin,
  + the buffer round-trips byte-for-byte as the body. NON-VACUOUS proven firsthand: removed the nosniff header line
  → 2 tests RED (got null) while the source-scan would've stayed green — exactly the behavioral gap it can't catch.
  VERIFY GATE GREEN: BE validate:local exit 0, 1770 pass (+4 vs C126's 1766), build bundled. COVERAGE: photos/
  helpers.ts 75.38→**87.88% line / 83.33% func** (only 17-24 left = the getDb-bound validatePhotoOwnership, as
  predicted). Backend-only → FE validate not required. cov: be ~88.05% / fe 87.6% (helpers slice; overall ~flat —
  re-measure next infra cadence). NEXT guard: the remaining <88% backend files are structural (OAuth/network/
  orchestrator/getDb-singleton) — the clean constructed-repo + pure-fn coverage picks are now worked through.
- **C126 (guard — pin 3 uncovered PhotoRepository finders; first real coverage MOVEMENT in many cycles +0.24 BE)** —
  Balance at C126 (HEAD was C125): feature (5/4, +1) + bug (4/3, +1) both over budget but BLOCKED (feature
  import-trackers detect-commit Angelo-gated, manual half fully eyes-on; bug `git diff C85..HEAD` over prod src
  EMPTY — verified). Per don't-force-a-blocked-pick, scouted for the highest-leverage ACTIONABLE increment instead
  of another eyes-on. SCOUT: ran `bun test --coverage`, listed every backend src file <75% line. The OAuth
  routes/providers + photo/google-photos services + backup-orchestrator + db/connection + sync routes are all the
  documented DI/OAuth/network STRUCTURAL ceiling (not clean unit picks) — BUT `photo-repository.ts` (72.90% line)
  stood out: its uncovered methods (`findIdsByUser` 47-69, `findById`/`findCoverPhoto` 134-148) are pure
  constructor-injected DB queries, and the file's own comment (C229) confirms it switched off the getDb singleton
  to `this.db` — so a `new PhotoRepository(testDb)` drives REAL code (NOT the C229 coverage-theater trap). GUARD:
  new `photo-repository-finders.test.ts` (+9, +11 expect) over a migrated in-memory DB (the batch-by-entity-type
  pattern): findIdsByUser USER-scoped + entityType-narrowed + extraConditions-AND-merged + empty (it's the
  bulk-delete id finder → a dropped userId scope = cross-tenant leak, the #48/#72/#180 class); findById row/null;
  findCoverPhoto isCover-only/null-when-none/null-when-empty. NON-VACUOUS proven firsthand: removed the userId base
  condition from findIdsByUser → the tenant-scope test went RED (returned USER_B's id). VERIFY GATE GREEN: BE
  validate:local exit 0, 1766 pass (+9 vs C125's 1757), build bundled. COVERAGE MOVED (re-measured): photo-
  repository.ts 72.90→**97.28% line / 96.15% func** (only 200-203 left, the setCoverPhoto tx tail already covered by
  set-cover-entity-scope.test.ts — a tool-attribution artifact); OVERALL BE **87.78→88.02% line / 87.64% func**, a
  genuine +0.24 line — the FIRST non-flat coverage gain in many cycles, proving this was a REAL gap not theater.
  Backend-only → FE validate not required. cov: be 88.02% / fe 87.6% (MEASURED). NEXT guard: the other <75% backend
  files are genuinely structural (OAuth/network/orchestrator/DI-bound) — photo-repository was the last clean
  HTTP-harness-or-constructed-repo coverage pick. Future guard cycles thin again; highest-leverage work GATED on Angelo.
- **C125 (deep-review — eyes-on cert of the never-shot `/vehicles/[id]/odometer/new` form, the getCurrentOdometer
  entry path)** — Balance at C125 (HEAD was C124): NOTHING over budget; TWO at budget — feature (4/4, most-starved
  by raw count) + bug (3/3). Both BLOCKED: feature import-trackers manual half is fully eyes-on desktop+mobile
  (C121) and the detect-commit is Angelo-gated on defaultCategory; bug is structurally dry (`git diff C85..HEAD`
  over production src EMPTY, verified). Per don't-force-a-blocked-pick + "nothing over → highest-leverage open
  item", continued the productive C124 never-shot-surface eyes-on vein (the one deep-review vein that still pays —
  "E2E can't catch never-rendered fields", C68). PICK RATIONALE: the odometer entry form is the data-entry path
  feeding `getCurrentOdometer`, which drives lease-overage MONEY + reminder firing + MPG (the #76/#130/#244 bug
  family lives on this exact value) — a never-rendered field here is high-severity, so it's the highest-leverage
  unshot surface. Shot DESKTOP + MOBILE (Pixel 5) against the seeded Toyota Camry (miles/gallons) + Read both PNGs.
  CLEAN: Odometer Reading input (placeholder "e.g. 45000"), Date defaulted to TODAY 06/22/2026 (correct LOCAL date,
  not a UTC off-by-one — the #87/#106/#138 date-family seam), Note (optional) with a live 0/500 char counter, Photos
  & Receipts uploader + empty-state copy ("They'll upload when you save"), Cancel / Save Reading CTAs. Mobile
  (393px): all fields full-width stacked, Cancel/Save side-by-side in-card, NO horizontal overflow (NORTH_STAR #3).
  ZERO console errors both viewports, status 200, no auth bounce. No defect — recorded CLEAN, don't re-shoot.
  VERIFY: no source touched (eyes-on cert). cov: be 87.78% / fe 87.6% (~ — no source). NEXT deep-review: the only
  remaining never-shot real surfaces are the insurance term EDIT + odometer EDIT forms (likely identical to their
  /new siblings just shot/C124 — low marginal value); after a quick confirm the surface set is fully eyes-on and
  deep-review returns to backend correctness audits or awaits an Angelo steer.
- **C124 (arch no-churn → pivot to deep-review: eyes-on cert of the never-shot `/insurance/[id]/terms/new` form)** —
  Balance at C124 (HEAD was C123): arch (6/5, +1) most-starved over budget; deep-review (5/5) at budget. ARCH
  PRECONDITION (the C112/C118 discipline): `git diff C118(043b84b)..HEAD` over backend/src + frontend/src (excl.
  tests) is EMPTY — the only changes since the last arch scout are the C119/C120/C122 characterization TEST files
  (not new production code to converge). So arch is at its structural floor → recorded no-churn IMMEDIATELY (11th
  confirm: C4/C6/C12/C36/C85/C91/C98/C105/C112/C118/C124; both real dedups createLoadState + seedVehicle stay
  design-gated awaiting Angelo) + pivoted the substantive work to the co-starved deep-review. DEEP-REVIEW: the
  analytics-builder + financing-calc surfaces are now SATURATED (C119–C122 + the financing module's property suites
  / month-overflow-clamp / minimum-payment tests all confirmed comprehensive firsthand this cycle — did NOT
  manufacture a redundant cert per the C86 discipline), so picked the one deep-review vein that still pays: an
  EYES-ON of a never-shot real surface (the GUIDE "E2E can't catch never-rendered fields" lesson). Scouted captured
  shots vs routes → `/insurance/[id]/terms/new` (the InsuranceTermForm, a 572-line money+date form, the bug-#138
  UTC-date subject) was NEVER shot. Shot DESKTOP + MOBILE (Pixel 5) against a seeded State Farm policy + Read both
  PNGs. CLEAN: desktop renders all 4 sections — Coverage Period (Start/End Date * pickers, the #138 fields), Finance
  Details (Total/Monthly Cost + Payment Amount + Premium Frequency), Covered Vehicles (all 4 seeded vehicles as
  checkboxes = the multi-vehicle term link), Policy Details (number/deductible/coverage desc/limit/agent ×3); the
  "State Farm" sub-header interpolates from the policy; Save Term / Cancel CTAs present; ZERO console errors. Mobile
  (393px): the 2-col field pairs reflow to single-column stacked, full-width pickers/inputs, NO horizontal overflow
  (NORTH_STAR #3), Save FAB pins bottom. No defect — recorded CLEAN, don't re-shoot. VERIFY: status 200 both
  viewports, 0 console errors; no source touched (eyes-on cert). cov: be 87.78% / fe 87.6% (~ — no source). NEXT
  deep-review: remaining never-shot real surfaces are the odometer entry forms (/vehicles/[id]/odometer/new) + the
  insurance term EDIT form; else the surface set is fully eyes-on and deep-review returns to backend audits.
- **C123 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C117)** — Balance at
  C123 (HEAD was C122): NOTHING strictly over budget; TWO at budget — infra (6/6) + arch (5/5). Picked infra: it's
  the more-starved at-budget one (6 vs 5) AND the substantive non-dry pick (its re-measure captures the C119–C122
  analytics-coverage arc), whereas arch is a no-churn record (no production source since C85). (1) UNTRACKED-TEST
  SWEEP: CLEAN — the C119/C120/C122 test files are all tracked/committed; only the intentional `M .gitignore` / `M
  frontend/.gitignore` overrides remain uncommitted (by design). (2) COVERAGE RE-MEASURED: BE 87.78% line / 87.54%
  func (1757 pass; 1756 under the --coverage run's timing) — line FLAT vs C117 but `analytics-charts.ts` jumped
  95→**99.63% line / 99.01% func** from the C119 (expense-summary) + C120 (maintenance/gas-price) + C122 (date/group
  roots) sweep (the module is now near-fully pinned; its only "uncovered" rows — 275, 1025-1026 — are the bun
  ternary-in-`new Date()` line-attribution artifact [C100 lesson], NOT real gaps: the C122 mutant proved line 275's
  seconds branch IS exercised). The overall line is flat because the module was already near the file-mean; the
  residual ceiling is DI/SQL/OAuth-bound (repository.ts, auth, provider services). FE 87.6% line / 88.56% func /
  79.84% branch / 85.57% stmts (739 pass) — FULLY UNCHANGED vs C117 (no FE source touched since: C119/C120/C122
  backend, C121 eyes-on-only). (3) BOTH-SIDES GREEN: BE 1757 / FE 739, 0 fail. (4) BRANCH STATE: claude-loop-dev =
  123 commits ahead of fresh origin/main, PR-ready (category spread bug 28 / guard 22 / feature 21 / deep-review 20
  / infra 17 / arch 14 — healthy balance across all six). Doc-only — no source touched. cov: be 87.78% / fe 87.6%
  (MEASURED). NEXT cadence ~C133. STANDING SIGNAL: the analytics-builder coverage vein (C119–C122) is now
  essentially exhausted — `analytics-charts.ts` at 99.6%. The self-authorizable frontiers (FE-logic C100–C102,
  route-IDOR C108–C116, analytics-builder C119–C122) are all closed; highest-leverage work is GATED on Angelo (#148
  READY / import defaultCategory / createLoadState + seedVehicle arch designs / #100/#79/#129).
- **C122 (bug→guard pivot — bug forced + provably dry; pinned 2 foundational zero-coverage analytics primitives)** —
  Balance at C122 (HEAD was C121): bug (8/3, +5) most-starved by far. BUG PRECONDITION (the C99/C103/C107
  discipline): `git diff C85..HEAD` over backend/src + frontend/src (excl. tests) is EMPTY — no production source
  has changed since the cold vein was last swept, so a regression is STRUCTURALLY IMPOSSIBLE and a scout produces
  nothing. Recorded dry IMMEDIATELY (10th consecutive dry bug cycle: C6/C10/C15/C83/C89/C95/C99/C103/C107/C122) +
  pivoted to the highest-leverage ACTIONABLE increment — the zero-coverage analytics-primitive vein (C119/C120
  certified the LEAF builders; this pins the two ROOT primitives every builder calls). SCOUT: re-grepped → the two
  remaining zero-coverage helpers are FOUNDATIONAL, not thin: `normalizeDate` (the SECONDS-vs-MS epoch heuristic,
  `< 1e12` → ×1000) is the exact boundary where date corruption hides — the DB stores timestamps in SECONDS (the
  recurring mode:'timestamp' footgun the loop re-finds at C46/C34/C209), so a drifted threshold shifts every chart's
  dates by 1000×, and NOTHING asserted it; `groupByVehicle` is the #54 cross-vehicle-pooling guard (never pairs two
  cars' consecutive rows). Read both against source firsthand — CORRECT (clean cert). GUARD: new
  `normalize-date-group-by-vehicle.test.ts` (+9, +16 expect): normalizeDate null→null / Date→identity / seconds×1000
  (1.7e9→2023) / ms-verbatim / the 1e12 boundary→ms (2001 not year-33658) / epoch-0→1970; groupByVehicle empty→empty
  + per-vehicle order preserved + single-group. NON-VACUOUS proven firsthand: dropped the `×1000` seconds-scaling →
  the seconds-epoch test went RED (received 1700000000 not …000, the exact 1000× corruption). Full verify gate
  GREEN: BE validate:local exit 0, 1757 pass (+9 vs C121's 1748), build bundled. Backend-only → FE validate not
  required. The analytics-builder coverage sweep (C119 expense-summary, C120 maintenance/gas-price, C122
  date/group roots) is now essentially complete — remaining sub-100% analytics files are DI/SQL-bound (repository.ts)
  or transitively-covered. cov: be ~87.78% / fe 87.6% (~ — new tests drive already-covered lines; re-measure next
  infra cadence ~C127). NEXT bug cycle: precondition still holds (no source changed) → record dry + pivot; real
  defects now come only from a deep-review/feature-surfaced invariant or an Angelo steer.
- **C121 (feature — import-trackers T5: the manual-mapping editor eyes-on at MOBILE, the last untested viewport)** —
  Balance at C121 (HEAD was C120): feature (8/4, +4) most-starved + bug (7/3, +4), both OVER. Bug is structurally
  dry (git diff C85..HEAD over production src EMPTY). Feature has been recorded "blocked" the last several cycles
  on the Angelo-gated detect-commit (defaultCategory) — but this cycle I VERIFIED the block firsthand by reading
  .kiro/specs/import-trackers/tasks.md and found a REAL unblocked slice: T5 (four-states + a11y + MOBILE-first) for
  the committable MANUAL-mapping editor, which was only ever shot at DESKTOP (C37/C41/C47/C61). The mobile render
  of that editor — the most control-dense VROOM dialog section (a per-field flex row [w-28 label + flex-1 Select]
  for every MAPPABLE_FIELD + date-format + conditional Odometer/Volume unit pickers + target-vehicle picker, inside
  a sm:max-w-lg Dialog.Content) — is a genuine NORTH_STAR #3 (no-mobile-overflow) gap, NOT the parked decision.
  INCREMENT: wrote import-manual-mapping-mobile.meshclaw.e2e.ts (Pixel 5, 393px) — pastes a foreign CSV crafted to
  match NO preset signature (avoids odometer/fillamount/odo/litres/totalprice/typeoffuel; uses Mileage+Gallons so
  the conditional unit pickers render = the WIDEST editor state), opens the manual editor, maps mileage+volume,
  asserts BOTH unit pickers visible AND scrollWidth ≤ clientWidth+1 (no horizontal overflow), captures the PNG.
  FIRSTHAND DISCOVERY along the way: my first CSV used Odo/Litres headers → tripped Fuelio auto-detect (substring
  signature match), proving the detect path also renders cleanly at mobile (banner + vehicle picker, no overflow) —
  but I wanted the manual editor, so switched to non-signature headers. EYES-ON: Read /tmp/c121-manual-mapping-
  mobile.png — every field row + date-format + Odometer-unit + Volume-unit (Gallons US) reflow cleanly at 393px,
  zero horizontal overflow, the /expenses page behind it intact. VERIFY: the mobile spec passes (no-overflow
  assertion green); no product source touched (the .meshclaw.e2e.ts spec is gitignored-by-design — the
  merge-surviving net is the backend HTTP/unit tests per GUIDE "source-scan > untracked e2e"; FE validate not
  required as no FE source changed). The manual-mapping editor is now eyes-on across BOTH viewports; the only
  remaining import-trackers tail (auto-detect-preset commit + populated-detect four-state) stays Angelo-gated on
  defaultCategory. cov: be 87.78% / fe 87.6% (~ — no source touched, eyes-on only). NEXT feature: import-trackers
  has NO unblocked increment left (manual half fully eyes-on desktop+mobile; detect-commit Angelo-gated) — next
  feature over-budget cycle records that + pivots to the co-starved category.
- **C120 (guard — certify + pin the MAINTENANCE + GAS-PRICE chart builder family, 3 zero-coverage builders)** —
  Balance at C120 (HEAD was C119): feature (7/4, +3) most-starved, bug (6/3, +3), both OVER but BLOCKED — feature
  import-trackers defaultCategory Angelo-gated (manual half fully eyes-on), bug structurally dry (git diff
  C85..HEAD over production src EMPTY, verified). Don't-force-a-blocked-pick → recorded both fast, pivoted to the
  highest-leverage ACTIONABLE increment: the zero-coverage analytics-builder vein C119 opened (NORTH_STAR #5,
  committed regression-prevention on never-tested code). SCOUT: re-grepped every analytics-charts.ts builder vs
  test references → 3 more zero-coverage CHART builders the C67 (fuel/date) + C119 (expense-summary) audits never
  reached — `buildGasPriceHistory`, `buildVehicleMaintenanceCosts`, `buildMaintenanceTimeline` (the last drives the
  private buildTimelineEntry / estimateServiceInterval / assignTimelineStatus trio). Read each against source
  firsthand — all CORRECT (clean cert, no defect, no manufacture). GUARD: new `maintenance-gasprice-builders.test.ts`
  (+15, +27 expect): buildGasPriceHistory keeps only priced fillups (volume>0 ∧ amount>0 ∧ date) + price=amount/vol
  + fuelType ?? 'Regular' + slice(-100); buildVehicleMaintenanceCosts category==='maintenance' ONLY (fuel/financial
  excluded) + month-bucket sum + ascending sort + dateless-drop; buildMaintenanceTimeline groups by description
  (case-insensitive; null→'general maintenance') + assignTimelineStatus thresholds (<0 overdue / <30 warning / else
  good) + single-occurrence interval default 180 + sorted by daysRemaining ascending. NON-VACUOUS proven firsthand:
  shrank the warning band <30→<5 → the 10-day warning-status test went RED ('good' not 'warning'), then reverted.
  Full verify gate GREEN: BE validate:local exit 0, 1748 pass (+16 vs C119's 1732), build bundled. Backend-only (no
  FE source) → FE validate not required. cov: be ~87.78% / fe 87.6% (~ — new tests drive already-covered builder
  lines; re-measure next infra cadence ~C127). Remaining zero-coverage analytics builders: groupByVehicle +
  normalizeDate (thin primitives, lower-leverage). NEXT actionable: those two if a guard cycle recurs, else an
  eyes-on populated surface — the productive vein is the analytics-builder coverage sweep.
- **C119 (deep-review — certify + guard the dashboard EXPENSE-SUMMARY builder family, 4 zero-coverage builders)** —
  Balance at C119 (HEAD was C118): THREE over budget — feature (6/4, +2) + deep-review (6/5, +1) co-most-starved
  by raw starvation, bug (5/3, +2). Feature is BLOCKED (import-trackers defaultCategory Angelo-gated; manual half
  fully eyes-on — don't-force-a-blocked-pick) and bug is structurally dry (git diff C85..HEAD over production src
  EMPTY). Deep-review is the most-starved NON-blocked category that can produce a genuine increment on unchanged
  code — picked it. SCOUT: grepped every analytics-charts.ts builder vs its test references; found FOUR with ZERO
  test files — `buildExpenseByCategory`, `buildVehicleExpenseBreakdown`, `buildMonthlyExpenseTrends`,
  `findBiggestExpense` (all GeneralExpenseRow[] → dashboard chart data; the C67 unpinned-builder audit certified the
  fuel/date siblings but never reached this expense-summary set). Read each against source firsthand — all CORRECT
  (no defect; recorded a CLEAN cert, did NOT manufacture a fix). GUARD: new `expense-summary-builders.test.ts` (+16,
  +32 expect) pinning the load-bearing invariants: buildExpenseByCategory percentages SUM to 100 + total===0→[]
  (divide-by-zero guard) + unknown-category→misc fold; buildVehicleExpenseBreakdown same fold WITHOUT percentages;
  buildMonthlyExpenseTrends localeCompare+slice(-24) keeps the NEWEST 24 months (the C11 oldest-slice direction
  class) + same-month co-accumulate + dateless dropped; findBiggestExpense strict-greater max (first-wins tie) +
  []→null + null-desc fallback + ISO date. NON-VACUOUS proven firsthand: flipped slice(-24)→slice(0,24) (the C11
  regression) → the slice-direction test went RED (newest 2023-12 not 2024-06), then reverted. Full verify gate
  GREEN: BE validate:local exit 0, 1732 pass (+15 vs C117's 1717), build bundled. Backend-only (no FE source) → FE
  validate not required. The C67 "never-pinned analytics builder" deep-review vein still pays — this expense-summary
  family was the set that audit missed. cov: be ~87.78% / fe 87.6% (~ — new tests drive already-covered builder
  lines; re-measure on the next infra cadence ~C127). NEXT deep-review: the remaining zero-coverage analytics
  builders if any (buildFuelEfficiencyAndCost, buildVehicleMaintenanceCosts), else an eyes-on of a populated surface.
- **C118 (arch — no churn warranted; recorded fast per the C91/C112 discipline, nothing threaded since C112)** —
  Balance at C118 (HEAD was C117; nudge label lags): THREE over budget at +1 — arch (118−112=6/5, +1, most-starved),
  feature (5/4), bug (4/3); arch wins on raw starvation (6). PRECONDITION (the C91/C98/C105/C112 discipline):
  `git diff 3b98df8(C112)..HEAD` shows the ONLY code change since the last arch scout is the C113–C116 IDOR
  additions, all consolidated INSIDE one file (cross-tenant-idor.test.ts, the systematic sweep — the correct single
  source, not a new duplication); production source remains unchanged since C85. So nothing fresh to converge.
  Recorded no-churn IMMEDIATELY without re-scouting (the GUIDE "Don't manufacture churn" + the C112 recommendation).
  The two REAL dedups stay design-gated awaiting Angelo: createLoadState adoption (C105, 13 pages) + seedVehicle
  convergence (C112, 51 test files). 10th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105/C112/C118). Doc-only — no
  source touched. cov: be 87.78% / fe 87.6% (~ — nothing changed). NEXT arch: absent an Angelo steer on the two
  design-gated migrations, arch stays at its structural floor — record no-churn fast (check the git diff since the
  last arch scout first; if no new dup threaded, it's an immediate no-churn).
- **C117 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C111)** — Balance at
  C117 (HEAD was C116; nudge label lags): NOTHING strictly over budget; FOUR at budget (feature 4/4, bug 3/3, arch
  5/5, infra 6/6); infra most-starved (6) AND the substantive non-dry pick (its re-measure captures the C113–C116
  IDOR test additions; arch is no-churn, bug is dry, feature is exhausted+gated). Ran ~6 cycles since C111 (a touch
  early but the at-budget tie + non-dry value justify it). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked
  `.test`/`.spec.ts`/`.svelte.test.ts` specs (only the intentional `M .gitignore` + `M frontend/.gitignore`
  overrides). (2) COVERAGE RE-MEASURED: **BE 87.78% line / 87.53% func** (1717 pass) — +0.01 line vs C111 (the
  C113–C116 cross-tenant-idor.test.ts additions are +expect assertions in an existing file driving ownership-gate
  branches mostly already covered — they pin SECURITY behavior, not new lines, exactly as expected for IDOR guards);
  **FE 87.6% line / 88.56% func / 79.74% branch** (739 pass) — UNCHANGED (C112–C116 all backend/docs). Both at the
  ~87.8 BE / ~87.6 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1717 / FE 739, 0 fail. (4) BRANCH STATE:
  claude-loop-dev = **117 commits ahead** of fresh origin/main, PR-ready (category spread bug 27 / guard 21 /
  feature 20 / deep-review 19 / infra 16 / arch 13; the 117th is the C1 loop-doc reset). Recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.78% / fe 87.6% (MEASURED). NEXT cadence
  ~C127. STANDING SIGNAL: both self-authorizable coverage frontiers are now CLOSED — the FE-logic guard arc
  (C100–C102, FE +1.25) and the route-IDOR audit (C108–C116, 7 gaps + BE +0.31 since C104). The loop has done deep,
  genuine work across C100–C116; with both veins exhausted it returns to dry/no-churn/cadence records. The
  highest-leverage remaining work is GATED on Angelo (#148 READY w/ anchor / import defaultCategory / createLoadState
  + seedVehicle arch designs / #100/#79/#129) — a steer is the only thing that opens fresh work.
- **C116 (guard — closed the LAST IDOR-sweep gap [PUT /notifications/:id/read]; route-coverage audit COMPLETE for
  state-changing routes, 7th + final route gap)** — Balance at C116 (HEAD was C115; nudge label lags): NOTHING
  strictly over budget; infra (5) + arch (4) most-starved, but the highest-leverage OPEN item is the C115-queued
  last IDOR gap (completing the C108–C116 route-audit vein beats an early infra re-measure [ran C111] or an arch
  no-churn). Took it. `PUT /notifications/:id/read` is state-changing + gated on markNotificationRead's (id, userId)
  scope (throws NotFoundError when no row matches, repository.ts:565) — so it 4xx-denies a foreign id today, but the
  cross-tenant-idor.test.ts sweep never covered it. GUARD: +2 in the reminders IDOR case — raw-seed a notification
  owned by B (the API only mints these via the trigger), assert A is denied PUT-read + B's notification stays unread
  (is_read=0). NON-VACUOUS proved firsthand: dropped the userId scope from markNotificationRead → reminder IDOR test
  RED (A marks B's notification read, 200 not 404, is_read flips); restored → 7 pass. Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1716 pass / 0 fail (+2 expect in an existing
  test), build bundled. Backend-only (no UI → no shot). cov: be 87.77% / fe 87.6% (~). **MILESTONE — the
  route-coverage audit (C108–C116) is COMPLETE: 7 real route gaps found + closed in 9 cycles, 6 cross-tenant IDOR
  (sync-status read, vehicle-expenses read, financing payoff, insurance terms, expense split, notification read) + 3
  analytics auth/validation routes. cross-tenant-idor.test.ts now covers EVERY state-changing route across all
  domains; the analytics domain is fully HTTP-harnessed. This vein is now EXHAUSTED — it found genuine security
  gaps for 9 cycles but is done.** NEXT: the self-authorizable veins are all swept again (the route-audit was the
  last productive one); record dry/no-churn fast + the highest-leverage work is GATED on Angelo (#148 READY w/
  anchor / import defaultCategory / createLoadState + seedVehicle arch designs / #100/#79/#129) — a steer is the
  only thing that opens fresh work.
- **C115 (guard — closed the expense SPLIT routes' cross-tenant IDOR gap [PUT/DELETE /split/:id]; 6th route gap via
  the audit method)** — Balance at C115 (HEAD was C114; nudge label lags): NOTHING strictly over budget; guard
  most-starved (115−110=5) → picked (the live IDOR route-audit is guard's productive vein). Took the C114 pointer's
  top target. VERIFIED firsthand both split routes throw NotFoundError when the group isn't `(groupId, userId)`-owned
  (updateSplitExpense:757 / deleteSplitExpense:714 via groupOwnedBy) — so they correctly 4xx-deny a foreign id today,
  but the cross-tenant-idor.test.ts sweep never covered them. They're DESTRUCTIVE (regenerate/delete sibling expense
  rows + their photos) and money-bearing (the C2 #147 financing-source-traceability class), so a regression to an
  un-scoped group write lets A rewrite/delete B's split expenses. GUARD: +2 expectDenied in the expense IDOR case —
  seed B's split group (POST /split, B's vehicle), assert A is denied PUT + DELETE on it. NON-VACUOUS proved
  firsthand: weakened groupOwnedBy to drop the userId scope (eq(groupId) only) → the expense IDOR test RED
  (cross-tenant split mutate no longer denied); restored → 7 pass. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1716 pass / 0 fail (+2 expect in an existing test), build
  bundled. Backend-only (no UI → no shot). cov: be 87.77% / fe 87.6% (~). PATTERN (C108–C115): the route-coverage
  audit method has now found 6 real route gaps in 7 cycles — 5 cross-tenant IDOR (sync-status read, vehicle-expenses
  read, financing payoff, insurance terms, expense split). The IDOR sweep is now near-complete for destructive
  routes. REMAINING: `PUT /notifications/:id/read` (reminders — verified IDOR-safe (id,userId)-scoped + throws, but
  not in the sweep; LOW-stakes read-flag, queue it). NEXT guard/deep-review: pin the notification-read IDOR (last
  known sweep gap), then the audit is exhausted for state-changing routes — pivot to a fresh vein or record the IDOR
  sweep COMPLETE.
- **C114 (bug — closed the insurance TERM routes' cross-tenant IDOR gap [PUT/DELETE /:id/terms/:termId]; 5th route
  gap via the audit method, an actual cross-tenant defect)** — Balance at C114 (HEAD was C113; nudge label lags):
  bug (114−107=7/3, +4) the LONE over-budget category (most-neglected since C107) → forced. The cold pure-logic vein
  is provably dry (no production source changed since C85), but the C108–C113 route-audit method finds REAL defects
  on a different axis — an unguarded IDOR IS a bug — so applied the bug lens to the C113 pointer (audit the remaining
  domains' state-changing routes vs the cross-tenant-idor.test.ts sweep). SYSTEMATIC COMPARISON of every PUT/DELETE/
  PATCH route vs the sweep's covered targets surfaced the gap: the insurance TERM routes (PUT/DELETE
  /:id/terms/:termId, routes.ts:221/253) are state-changing + gated on the SAME validateInsuranceOwnership(id) as the
  policy, but the IDOR sweep SKIPPED them. CRITICAL DISTINCTION verified firsthand: terms-http.test.ts (C272) pins
  the INNER FK defense (rejecting a foreign vehicleId in the coverage payload) — but ALWAYS as the policy OWNER, so
  the policy-level cross-tenant gate on the term routes was never tested. A cross-tenant term edit/delete lets user A
  mutate user B's insurance terms + their auto-materialized premium expenses (updateTermExpenses / deleteBySource) —
  a real destructive cross-tenant write (NORTH_STAR #2). GUARD: +2 expectDenied in cross-tenant-idor.test.ts's
  insurance case (captured B's term id from the policy-create response; added PUT + DELETE term denials alongside the
  existing policy/claim ones). NON-VACUOUS proved firsthand: dropped the term PUT ownership gate → the insurance IDOR
  test RED (cross-tenant term edit no longer denied); restored → 7 pass. Verify: backend validate:local GREEN — tsc
  0, musl-biome clean (20 pre-existing warnings, none new; 1 file auto-formatted), 1716 pass / 0 fail (+2 expect in
  an existing test), build bundled. Backend-only (no UI → no shot). cov: be 87.77% / fe 87.6% (~). PATTERN
  (C108/C109/C110/C113/C114): the route-coverage audit method has now found 5 real route gaps in 6 cycles — 4 of them
  cross-tenant IDOR (sync-status read, vehicle-expenses read, financing payoff, insurance terms). DEFINITIVELY the
  productive vein. REMAINING IDOR-sweep gaps to check next: `PUT /notifications/:id/read` (reminders) +
  `PUT/DELETE /split/:id` (expenses) — both state-changing, neither in the sweep. NEXT bug/deep-review cycle:
  continue the IDOR audit on those.
- **C113 (feature parked → deep-review: closed the financing PUT /payoff cross-tenant IDOR gap; 3rd route-ownership
  gap found by the C108–C111 audit method)** — Balance at C113 (HEAD was C112; nudge label lags): TWO over budget at
  +3 — feature (113−106=7/4, +3) and bug (113−107=6/3, +3); feature most-starved → but feature is EXHAUSTED of
  self-authorizable work (every surface eyes-on C96/C106, import-trackers gated) → recorded PARKED + pivoted to the
  highest-leverage open item = the live route-coverage audit vein (the GUIDE park-and-pivot rule; the C108–C111
  precedent, 3 gaps found + BE coverage +0.30). Recorded under DEEP-REVIEW (a security-audit finding). Applied the
  C110 pointer — scouted the next domains (financing/odometer/insurance) — and discovered the systematic
  `cross-tenant-idor.test.ts` (the per-domain IDOR sweep) covers financing's DELETE + PATCH/payment-amount but
  SKIPS **PUT /:financingId/payoff**, a state-changing route on the SAME `validateFinancingOwnership` gate
  (routes.ts:219). A cross-tenant payoff lets user A mark user B's financing paid-off (deactivateFinancing →
  isActive=0 + severs the source link) — a destructive write on B's data, the C108/C109 class on a route the IDOR
  sweep missed. The payoff route is exercised FUNCTIONALLY (deactivate-hook test, as the owner) but its ownership
  gate was never cross-tenant-tested. GUARD: +1 expectDenied in cross-tenant-idor.test.ts's financing case (it
  already seeds B's financing fid — just added the PUT payoff denial alongside DELETE/PATCH). NON-VACUOUS proved
  firsthand: dropped the payoff ownership gate → the financing IDOR test RED (cross-tenant payoff no longer denied —
  deactivateFinancing is user-scoped so it no-ops with a non-4xx instead of the proper 404); restored → 7 pass.
  Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1716 pass / 0
  fail (+1 expect in an existing test), build bundled. Backend-only (no UI → no shot). cov: be 87.77% / fe 87.6%
  (~). PATTERN (C108/C109/C110/C113): the route-coverage audit method has now found 4 real route-ownership/coverage
  gaps across 4 cycles (sync-status, vehicle-expenses, 3 analytics routes, financing payoff) — DEFINITIVELY a
  productive vein, not a fixed point. The IDOR sweep is now complete for financing's destructive routes. NEXT: audit
  the remaining domains' state-changing routes against the IDOR sweep (odometer PUT, insurance term/claim PUT/DELETE
  — check each is in cross-tenant-idor.test.ts).
- **C112 (arch — no churn warranted for a self-authorizable increment; surfaced the seedVehicle test-helper
  convergence as a 2nd design-gated arch item, recorded + pivot)** — Balance at C112 (HEAD was C111; nudge label
  lags): THREE over budget at +2 — arch (112−105=7/5, +2, most-starved), feature (6/4), bug (5/3); arch wins on raw
  starvation (7). PRECONDITION: `git diff 5766239(C85)..HEAD` over production source is EMPTY — no fresh PRODUCTION
  dedup since the last source change (the C91/C98/C105 discipline). Checked whether the only new code since (the
  C108–C110 route TESTS) threaded a convergence candidate: YES, a real one — `seedVehicle` is re-declared in 51
  HTTP-harness test files with 7 distinct signatures (32× no-arg, 7× nickname, 4× make, + 4 one-offs), and the
  C108–C110 work added more call sites. BUT converging it is a SWEEPING 51-file refactor with an options-bag helper
  — categorically NOT a self-authorizable arch increment (arch rule 1: ONE small reviewable; rule 2: behavior-change
  risk across 51 test files; it's test-only, lower-leverage than the unchanged production code). Same shape as the
  C105 createLoadState finding: a REAL, design-gated arch item, not a no-churn cop-out. Recorded no-churn for the
  cycle + SURFACED the seedVehicle convergence as a 2nd design-gated arch-queue candidate (filed in BACKLOG with the
  recommended incremental approach: add ONE shared `test-helpers` seeder, migrate one domain per arch cycle once
  approved — never a 51-file big-bang). Did NOT force the churn (the GUIDE "Don't manufacture churn" + arch rule 6).
  9th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105/C112) — INFORMATIVE again (names a concrete dedup). Doc-only —
  no source touched. cov: be 87.77% / fe 87.6% (~ — nothing changed). NEXT arch: both real dedups (createLoadState
  C105, seedVehicle C112) are design-gated multi-file migrations awaiting Angelo; absent a steer, arch stays at its
  structural floor — record no-churn fast.
- **C111 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C104)** — Balance at
  C111 (HEAD was C110; nudge label lags): FOUR over budget — infra (111−104=7/6, +1), arch (111−105=6/5, +1), feature
  (111−106=5/4, +1), bug (111−107=4/3, +1); infra wins on raw starvation (7, the C84 tie-break) AND its re-measure
  actually MOVED this time (the C108–C110 route tests). Ran right in the ~10-cycle window. (1) UNTRACKED-TEST SWEEP:
  CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte.test.ts` specs (only the intentional `M .gitignore` + `M
  frontend/.gitignore` overrides). (2) COVERAGE RE-MEASURED: **BE 87.77% line / 87.53% func** (1717 pass) —
  **+0.30/+0.34 vs C104**, moving UP OFF the long-assumed ~87.47% ceiling, from the C108 (sync-status) + C109
  (vehicle-expenses) + C110 (quick-stats/cross-vehicle/year-end) route-coverage arc (analytics/routes.ts 95.65→97%
  line) — PROOF the route-coverage audit found REAL untested route-layer code, not theater; **FE 87.6% line / 88.56%
  func / 79.74% branch** (739 pass) — UNCHANGED (C105–C110 all backend/eyes-on/docs; no FE source touched). The BE
  structural ceiling is ~87.8% once route handlers are HTTP-harnessed; residual is DI/OAuth-bound. (3) BOTH-SIDES
  GREEN: BE 1717 / FE 739, 0 fail. (4) BRANCH STATE: claude-loop-dev = **111 commits ahead** of fresh origin/main,
  PR-ready (category spread bug 26 / feature 20 / guard 19 / deep-review 18 / infra 15 / arch 12; the 111th is the
  C1 loop-doc reset). Recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be
  87.77% / fe 87.6% (MEASURED). NEXT cadence ~C121. STANDING NOTE: the C108–C110 route-coverage audit is the live
  productive vein (3 route gaps found + BE coverage +0.30); the analytics domain is fully mapped — apply the same
  method to the next-thinnest domain. The product-advancing work stays GATED on Angelo (#148 READY w/ anchor /
  import defaultCategory / createLoadState design / #100/#79/#129).
- **C110 (guard — completed analytics-domain route coverage: pinned the 3 remaining untested routes [quick-stats /
  cross-vehicle / year-end]; the C108/C109 audit-method increment)** — Balance at C110 (HEAD was C109; nudge label
  lags): NOTHING strictly over budget (feature 4/4, bug 3/3, arch 5/5, infra 6/6 all AT). Took the highest-leverage
  OPEN item = completing the C108/C109 route-coverage vein (proven productive: 2 cross-tenant gaps in 2 cycles).
  Recorded under GUARD (the honest category for route HTTP-harness work; nothing was over budget so category-label
  follows the work). Inventoried the analytics domain's 13 route handlers vs HTTP-harness coverage → the LAST 3
  with ZERO route-level coverage were /quick-stats, /cross-vehicle, /year-end. Unlike the C109 vehicle-expenses
  gap these are USER-scoped in the repo (no per-vehicle ownership gate), so the route-layer invariants pinned are:
  (a) per-route AUTH-gating — every analytics route is behind requireAuth but the C185 net asserted 401 on only ONE
  representative route, so a mis-mount skipping the middleware on one would've gone unnoticed; (b) the REQUIRED
  startDate+endDate validation on the two dateRange routes (omit → 400 via zValidator BEFORE any repo work); (c)
  year-end's OPTIONAL year (omitted → defaults to current year → 200, not 400). GUARD: +3 in
  analytics-routes-http.test.ts. NON-VACUOUS proved firsthand: dropped the quick-stats zValidator → its 400
  assertion flips RED (route no longer rejects the missing range); restored → 19 pass. The analytics route domain
  now has COMPLETE HTTP-harness coverage (all 13 endpoints). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1716 pass / 0 fail (+3), build bundled. Backend-only (no UI
  → no shot). cov: be ~87.5% (+ the 3 route paths) / fe 87.6% (~). PATTERN (C108/C109/C110): the route-coverage
  audit method — inventory a domain's handlers vs HTTP-harness hits, pin the uncovered ones (ownership-gated first,
  then auth/validation) — is the productive guard/deep-review vein. ONE domain (analytics) now fully mapped + closed.
  NEXT: apply the same method to the next thinnest domain (auth/photos are OAuth/upload-bound; check
  financing/insurance/odometer GET-by-id + list routes for any unharnessed ownership-gated handler).
- **C109 (deep-review — pinned the untested /vehicle-expenses analytics route's cross-tenant ownership gate; 2nd
  route-ownership gap in 2 cycles, vein confirmed productive)** — Balance at C109 (HEAD was C108; nudge label lags):
  deep-review (109−102=7/5, +2) the most-starved over-budget category → picked. Applied the C108 lesson (map
  route-endpoint coverage, don't assert saturation): mapped the analytics domain's 13 route handlers vs HTTP-harness
  coverage — found 4 endpoints with ZERO route-level coverage (/quick-stats, /cross-vehicle, /year-end,
  /vehicle-expenses), and the highest-leverage is /vehicle-expenses: it's the only one of the 4 carrying a
  `validateVehicleOwnership(vehicleId)` cross-tenant gate (routes.ts:147), the SAME guard analytics-routes-http.test.ts
  already pins for its siblings vehicle-tco/vehicle-health/fuel-stats/fuel-advanced (C185/C290) — but
  /vehicle-expenses was the one vehicle-scoped analytics route the net never covered. The repo method
  getVehicleExpenses is unit-tested, but a route-layer guard-drop serves another tenant's per-vehicle expense
  analytics by guessing an id (the C109/#52 cross-tenant class — namesake). GUARD: +3 in analytics-routes-http.test.ts
  (next to its siblings) — owned → 200 envelope; foreign id → 404 (no leak); missing-required-vehicleId → 400 (the
  dateRangeRequiredVehicleQuerySchema validation, before the guard). NON-VACUOUS proved firsthand: dropped the
  ownership gate → ONLY the foreign-id test RED (the leak opens), owned + missing-param stay green; restored → 16
  pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1713
  pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be ~87.5% (+ the vehicle-expenses route
  lines) / fe 87.6% (~). PATTERN CONFIRMED: C108 (sync-status) + C109 (vehicle-expenses) are TWO route-ownership
  gaps found in 2 cycles by mapping endpoint coverage — the HTTP-harness guard/deep-review vein is genuinely
  productive, NOT the "fixed point" the C103/C107 claims asserted. NEXT deep-review/guard: the remaining 3 untested
  analytics routes (/quick-stats, /cross-vehicle, /year-end) are user-scoped in the repo (no per-vehicle ownership
  gate) so thinner, but check the other route domains' unmapped endpoints first (the audit method, not the
  saturation assumption).
- **C108 (guard — pinned the untested GET /:id/sync-status route's tenant-isolation chokepoint; corrected the
  premature C103 "frontier worked out" claim)** — Balance at C108 (HEAD was C107; nudge label lags): TWO over
  budget — guard (108−101=7/6, +1) and deep-review (108−102=6/5, +1); guard most-starved (7 > 6, the C84 tie-break)
  → picked. Rather than assert the guard vein saturated (the C103 claim), did a genuine scout of the OTHER guard
  vein (HTTP-harness, not source-scan): mapped all 12 route domains' createTestApp coverage (77 files) → found the
  provider domain's lowest, and within it the GET /:id/sync-status endpoint has ZERO coverage (no test file
  references "sync-status"). VERIFIED it carries a load-bearing invariant: it gates on `findOwnedProviderOrThrow`
  (routes.ts:602) — the SAME tenant-isolation chokepoint the PUT/DELETE tests pin (#63), but on a READ path that
  leaks another tenant's per-category photo-sync counts (total/synced/failed) if the guard drops (NORTH_STAR #2),
  invisible to every existing test. GUARD: +4 in providers-routes-http.test.ts — owned → 200 with the 4-category
  {total,synced,failed} shape; foreign id → 404 (no leak); non-existent → 404; anon → 401. NON-VACUOUS proved
  firsthand: removed the ownership check → BOTH the foreign-id + non-existent-id tests RED (the leak path opens),
  owned + anon stay green; restored → 26 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20
  pre-existing warnings, none new), 1710 pass / 0 fail (+3 net), build bundled. Backend-only (no UI → no shot).
  cov: be ~87.5% (+ the sync-status route lines now covered) / fe 87.6% (~). CORRECTION recorded: the C103/C107
  "FE-logic frontier worked out / guard saturated" claim was PREMATURE — a real untested route with a cross-tenant
  guard gap existed. LESSON: the HTTP-harness guard vein isn't exhausted just because source-scan + FE-logic are;
  map route-domain coverage for the lowest-covered endpoints before asserting saturation. NEXT guard: re-scan the
  remaining low-coverage route endpoints (sync/auth/analytics harness files are thin but mostly DI/OAuth-bound —
  verify which are genuinely testable vs structural before picking).
- **C107 (bug — precondition-recorded dry [9th consecutive]; no source changed since C85)** — Balance at C107
  (HEAD was C106; nudge label lags): bug (107−103=4/3, +1) the LONE over-budget category → forced. PRECONDITION
  (the C99/C103 rule): `git diff 5766239(C85)..HEAD` over production source is EMPTY — nothing has changed since the
  cold vein was last swept (C6/C10/C15/C83/C89/C95/C99/C103 + every surface certified + the FE-logic guards
  C100–C102 are tests, not source), so a regression is structurally impossible → recorded dry IMMEDIATELY without
  re-scanning provably-unchanged code (re-scanning is pure ceremony, the C95/C103 lesson). The productive bug
  surface remains ONLY the parked Angelo-gated queue (#148 READY w/ its C102 red→green anchor, #100/#79/#129 +
  import defaultCategory). Doc-only — no source/test touched. cov: be 87.47% / fe 87.6% (~ — nothing touched).
  PATTERN NOTE (C83–C107, 25 cycles): the loop is at a stable fixed point — every self-authorizable vein swept
  (net production change = 6 test files: 3 BE guards C87/C94/C98 + 3 FE-logic C100/C101/C102), the cold bug vein
  9× dry, every real + populated surface eyes-on, the only remaining work GATED on Angelo (4 product calls + 1
  design-gated arch migration). The branch stays healthy + PR-ready; a steer is the only thing that opens fresh work.
- **C106 (feature — eyes-on the full POPULATED dashboard, desktop + mobile; CLEAN [the primary landing surface,
  only ever partially-shot])** — Balance at C106 (HEAD was C105; nudge label lags): feature (106−101=5/4, +1) the
  lone over-budget category → picked. Import-trackers stays Angelo-gated (defaultCategory), so per the
  C68/C75/C82/C88/C93/C96 precedent took the shootable eyes-on increment. The shot history had /dashboard only
  twice (C5 shot just the recurring-cost-card REGION; C12 the app-init trigger) — the FULL populated dashboard (the
  primary landing surface, NORTH_STAR mobile-first) in a multi-vehicle state was never Read end-to-end. Shot DESKTOP
  + MOBILE (Pixel 5) + Read both PNGs (+ a zoomed KPI crop). CERTIFIED CLEAN: desktop renders all sections — 4 KPI
  stat cards (Total Vehicles 4 / Total Expenses $21,677.87 / Monthly Average $277.92 / Active Financing 2, the
  subtitle "Overview of your 4 vehicles" matching the vehicle count = internally consistent), Your Fleet (3 vehicle
  cards w/ Financed badges + per-vehicle Last-30/Total/Last-Activity + Add-Expense, a 4th slot + Add-Vehicle FAB),
  Monthly Expense Trends + Expense by Category (chart canvas blank = the C26 IO-gated-chart headless-capture limit,
  NOT a defect — frame/legend render), Recent Activity (correct expense rows incl. the $900 split payment),
  Upcoming Reminders (e2e mileage/recurring w/ due dates), Recurring Costs ($460.50/mo across 4). MOBILE (393px):
  NO horizontal overflow (NORTH_STAR #3) — the 4 KPI cards reflow desktop-4-across → a clean 2×2 grid (values fit,
  labels wrap), the "Log Fill-up" mobile-first pump CTA is present, Your Fleet + Add-Vehicle FAB pin full-width;
  figures consistent with desktop. Zero console errors; no /auth bounce. No defect; no fix (the GUIDE
  agent-HIGH-findings-often-false discipline). The dashboard is sound — DON'T re-audit. Read-only shots, no fixtures
  created. Doc-only — no committable source (shot.mjs is gitignored harness). cov: be 87.47% / fe 87.6% (~ — no
  test/code touched). With this, the dashboard joins the fully-eyes-on set; every real surface + the primary
  landing in its populated state is now Read. NEXT feature cycle: feature is fully exhausted of self-authorizable
  work (every surface shot, import-trackers gated) → record parked + pivot UNLESS Angelo steers.
- **C105 (arch — no churn warranted; the createLoadState scaffold has ZERO adopters but its migration is a
  design-gated multi-page refactor, NOT a self-authorizable increment — surfaced for Angelo, recorded + pivot)** —
  Balance at C105 (HEAD was C104; nudge label lags): arch (105−98=7/5, +2) the most-starved over-budget category →
  picked. Instead of the reflexive backend no-churn (backend unchanged since C85, confirmed again — no fresh dedup),
  scouted a genuinely FRESH surface the backend-focused scouts C85/C91/C98 never touched: the FE LOAD TRIAD.
  FINDING: `createLoadState<T>` (load-state.svelte.ts) was extracted (arch #2) as a migration SCAFFOLD — its
  docstring says "~14 pages hand-repeat the triad; pages migrate onto it one per later cycle" — but it has ZERO
  adopters; all 13 load-bearing pages still hand-roll `isLoading`/`loadError`/`load()`. THAT is a real dedup with a
  concrete payoff (the "load failure masquerades as empty state" bug class the scaffold was built to structurally
  prevent). BUT verified firsthand it is NOT a behavior-preserving arch increment: every candidate page
  (reminders/insurance/expenses/vehicle-detail/provider-edit) loads MULTIPLE values via Promise.all into SEPARATE
  $state vars, while createLoadState holds ONE `data` — so migrating any page is a reactivity REWRITE (composite
  type or N load-states + every template binding rewired from `isLoading` to `loadState.isLoading`), touching
  observable render paths + requiring shot-before/after (arch rules 1+2+4). A multi-page migration of this scope is
  arch-rule-6 DESIGN-GATED (`.kiro/specs/<refactor>/design.md` + Angelo sign-off), NOT a self-authorizable cycle.
  Recorded no-churn for the cycle + SURFACED the scaffold-adoption gap as a design-gated arch item (filed in
  BACKLOG). Did NOT force a risky rewrite (the GUIDE "Don't manufacture churn" + arch rule 6 "never self-authorize a
  big restructure"). 8th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105) — but this one is INFORMATIVE: it names a
  concrete, real, design-gated dedup rather than just "DRY". Doc-only — no source touched. cov: be 87.47% / fe
  87.6% (~ — nothing changed). NEXT arch: the createLoadState migration needs an Angelo design call; absent that,
  arch stays at its structural floor — record no-churn fast.
- **C104 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C97)** — Balance at
  C104 (HEAD was C103; nudge label lags): TWO over budget — infra (104−97=7/6, +1) and arch (104−98=6/5, +1); infra
  wins on raw starvation (7 > 6, the C84 tie-break) AND is the substantive pick (arch is reliably no-churn at its
  structural floor C91/C98; infra's re-measure actually MOVED this time, capturing the C100–C102 FE gains). Ran
  right in the ~10-cycle window. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte.test.ts`
  specs (only the intentional `M .gitignore` + `M frontend/.gitignore` overrides). (2) COVERAGE RE-MEASURED: **BE
  87.47% line / 87.19% func** (1707 pass) — UNCHANGED vs C97 (C98 was the only BE add, a source-scan that line-covers
  nothing; C99/C103 dry, C100–C102 FE-only); **FE 87.6% line / 88.56% func / 79.84% branch** (739 pass) —
  **+1.25/+0.88/+1.06 vs C97's 86.35/87.68/78.78**, the cumulative C100 (settings-store reload) + C101 (theme
  listener) + C102 (#148 lease anchor) FE-logic guard arc. FE is now meaningfully OFF its long-assumed ~86%
  plateau — the real FE structural ceiling is ~87.6% once the store/util behavioral logic is pinned; the residual
  gap is structural (effect/DOM-bound FE + DI/OAuth-bound BE, neither a clean unit pick). (3) BOTH-SIDES GREEN: BE
  1707 / FE 739, 0 fail. (4) BRANCH STATE: claude-loop-dev = **104 commits ahead** of fresh origin/main, PR-ready
  (category spread bug 25 / feature 19 / guard 17 / deep-review 17 / infra 14 / arch 11; the 104th is the C1
  loop-doc reset). Recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47%
  / fe 87.6% (MEASURED). NEXT cadence ~C114. STANDING SIGNAL (C83–C104, 22 cycles): every self-authorizable vein is
  swept — net production change is 3 guard tests (C87/C94/C98) + 3 FE-logic guard/cert tests (C100/C101/C102, which
  moved FE coverage +1.25). The branch is healthy + PR-ready; the highest-leverage remaining work is GATED on Angelo
  (#148 READY w/ its C102 red→green anchor, import defaultCategory, #100/#79/#129) — a steer is the only thing that
  opens a fresh vein.
- **C103 (bug — recorded dry FAST [8th consecutive]; + confirmed the C100–C102 FE-logic guard frontier is now
  worked out)** — Balance at C103 (HEAD was C102; nudge label lags): bug (103−99=4/3, +1) the LONE over-budget
  category → forced. PRECONDITION (per C99): `git diff 5766239(C85)..HEAD` over production source is EMPTY — nothing
  has changed since the cold vein was last swept, so a bug scout produces nothing → recorded dry immediately. ALSO
  scouted whether the C100/C101/C102 FE-logic guard frontier (which produced 3 real coverage gains) still has clean
  picks: RE-MEASURED FE coverage — the only remaining <90% files are expense-api.ts (73% — dominated by thin
  apiClient pass-through wrappers: getPhotos/uploadPhoto/deletePhoto/split-CRUD, where a test would just assert
  "calls apiClient.X with this URL" = the C181/C229 coverage-theater) and sync-manager.ts (66% — the uncovered lines
  are `setupAutoSync`'s `window.addEventListener('online', …)` DOM-effect wiring [Playwright territory] + the
  already-fully-covered resolveConflict switch). The genuinely load-bearing FE-logic gaps are now CLOSED (settings
  reload C100, theme listener C101, #148 anchor C102); the residual FE under-coverage is STRUCTURAL (effect/DOM-bound
  + thin delegation), the FE mirror of the BE DI/OAuth-bound tail — not clean unit pins. No fresh bug, no
  non-theater guard → recorded dry, did NOT manufacture. The productive surfaces are now: (a) the parked
  Angelo-gated queue (#148 READY w/ its C102 anchor, #100/#79/#129 + import defaultCategory), (b) genuinely
  STRUCTURAL coverage (needs Playwright for the FE effect tail / DI harness for the BE tail — neither a normal cycle
  pick). NEXT bug cycle: precondition-check + record dry immediately. Doc-only — no source/test touched. cov: be
  87.47% / fe 87.6% (~ — nothing touched).
- **C102 (deep-review — CHARACTERIZED the #148 escalation [null-initialMileage lease burn bar] as a red→green
  anchor, NOT a fix; the parked product call now pinned)** — Balance at C102 (HEAD was C101; nudge label lags):
  NOTHING strictly over budget; bug (102−99=3/3) AT budget but provably dry (no source changed since C85, 7× dry —
  a scout produces nothing), guard just ran C100/C101. Took the highest-leverage open item = deep-review (starved 4)
  auditing the C100/C101-proven FE-logic frontier. RE-MEASURED FE coverage first (the C101 stale-row lesson): the
  lowest-coverage money-facing file is financing-calculations.ts (75% line). Audited `calculateLeaseMetrics`
  firsthand — it's EXTRAORDINARILY well-tested (30+ cases incl. the #64/#91/#110 money-bug classes + 2 fast-check
  properties), so most of it is saturated. Found the ONE genuinely unguarded load-bearing branch — and it's the
  #148 ESCALATION itself: the mileage gate (financing-calculations.ts:497) requires `initialMileage !== null` for
  mileageUsed to compute; there's a test for null currentMileage but NONE for null INITIAL — the exact #148 case
  where the LeaseMetricsCard burn bar reads 0-driven while the sibling PaymentMetricsGrid (which coalesces
  `initialMileage ?? 0`) shows real miles, so the same vehicle contradicts itself. Since #148 is a PARKED product
  call (a displayed-$ semantics decision awaiting Angelo), I did NOT fix it — I CHARACTERIZED the current behavior
  as a red→green anchor (the textbook deep-review move for a parked call): +1 in lease-metrics.test.ts pinning that
  null-initial → mileageUsed 0 / remaining full TODAY, plus the contrast that initial=0 drives used=30000 (documents
  the contradiction). NON-VACUOUS proved firsthand: applied the #148-FIX direction (`initialMileage ?? 0` in the
  gate) → the characterization FLIPS RED (used becomes 30000), proving it precisely pins the current null-gate
  behavior + is the documented update target when Angelo rules; restored (no auto-fix). Verify: frontend
  validate:local GREEN — type-check 0, build OK, 739 pass / 0 fail (+1). FE-only (no markup change → no shot). cov:
  be 87.47% / fe ~87.6% (+ the lease-metrics null-initial branch). The #148 escalation is now pinned so it can't
  silently change AND has a ready red→green test for the eventual fix. NEXT deep-review: the FE-logic surface is
  largely certified now; prefer a feature/bug-surfaced invariant or an Angelo steer (#148 is READY — the anchor
  test means the fix is a 1-line gate change + flipping this test's expectations).
- **C101 (feature parked → guard: pinned themeStore.initialize() + its live OS-preference listener, the C336-skipped
  one-shot)** — Balance at C101 (HEAD was C100; nudge label lags): feature (101−96=5/4, +1) the lone over-budget
  category, but feature is FULLY EXHAUSTED (every real surface eyes-on C96, import-trackers Angelo-gated) → recorded
  parked + pivoted to the highest-leverage open item (the GUIDE "over-budget but no unblocked increment → park +
  pivot" rule; the C100-seeded FE-logic guard frontier). GUARD: theme.svelte.ts was 60.52% line / 55% branch —
  C336 pinned setPreference but DELIBERATELY skipped initialize() ("a one-shot guarded by an internal flag").
  initialize() carries a load-bearing untested invariant: it registers a prefers-color-scheme `change` listener
  that re-applies the theme LIVE when the OS flips, but ONLY when the stored preference is 'system' — the
  `if (stored === 'system')` guard is what makes "System" track the OS in real time WITHOUT yanking an explicit
  light/dark user's theme when their OS enters night mode. Zero coverage → a regression there silently jumps a
  'light' user to dark on an OS change, invisible to setPreference's tests. GUARD: new theme-initialize.test.ts
  (+1, a single ordered test since themeStore is a latching singleton — only the first initialize() runs the body):
  asserts mount applies the stored pref + registers exactly ONE listener, a 2nd initialize() is idempotent (no
  duplicate), then fires the captured listener under stored 'system' (→ tracks OS dark, live) vs stored 'light'
  (→ NOT touched). NON-VACUOUS proved firsthand: made the listener apply `'system'` UNCONDITIONALLY (the real
  regression) → RED at the explicit-light assertion (user yanked to OS dark); restored → green. Verify: frontend
  validate:local GREEN — type-check 0, build OK, 738 pass / 0 fail (+1). FE-only (a store unit test; no markup
  change → no shot). cov: be 87.47% / **fe 87.6% line / 88.56% func / 79.74% branch — UP +0.74/+0.59/+0.67 vs C100;
  theme.svelte.ts 60.52→92.1% line, 100% func.** Two consecutive real FE coverage gains (C100 settings-store +
  C101 theme) confirm the FE store/util layer is the productive guard frontier. NEXT guard: remaining FE behavioral
  gaps — but RE-MEASURE first (the earlier "load-state.svelte.ts 35%" reading was a coverage-tool artifact; that
  primitive is already fully tested at load-state.svelte.test.ts). Check actual <100% util/store files before
  picking; prefer genuine logic over a backend source-scan on code unchanged since C85.
- **C100 (guard — pinned the FE settings-store `uploadBackup` mode-gated reload [the C319 twin], the first FE
  coverage movement since C52)** — Balance at C100 (HEAD was C99; nudge label lags): NOTHING strictly over budget;
  feature (100−96=4/4) + guard (100−94=6/6) both AT budget. Feature is fully exhausted (every surface eyes-on,
  import-trackers Angelo-gated) → guard is the higher-leverage pick. Rather than ANOTHER backend source-scan on
  provably-unchanged code (the C94/C98 seam is fenced + `git diff C85..HEAD` is empty), went looking for GENUINE new
  value in the FE's real ~13% untested surface. Found it: the settings store (settings.svelte.ts, 57% line / 33%
  branch) mediates the backup/restore crown-jewel (NORTH_STAR #1), and while C319 pinned `restoreFromProvider`'s
  preview-vs-non-preview reload + C308 pinned error-clearing, NOTHING pinned the PARALLEL `uploadBackup` path's
  mode-gated reload — the FILE-upload restore (the more common one: drag a .zip), which gates `this.load()` on
  `mode !== 'preview'` exactly like restoreFromProvider. A regression dropping its reload leaves the UI showing
  STALE pre-restore settings after a replace/merge (NORTH_STAR #1 data-correctness), invisible to every test
  (settings-api.test.ts pins only uploadBackup's wire/FormData contract, not the store's reload). GUARD: +2 in
  settings-state-contract.test.ts (next to the C319 restoreFromProvider twin) — non-preview uploadBackup → 2 fetches
  (upload + reload), state refreshed; preview → 1 fetch, no reload, state stays null. Drives the REAL store →
  settings-api → fetch (mocked), not a re-impl. NON-VACUOUS proved firsthand: dropped the `if (mode !== 'preview')`
  gate → ONLY the non-preview test RED (1 fetch not 2), preview + the other 6 stay green; restored → 8 pass. The
  arch-extract→guard-pin sibling pattern, here C319-twin→C100. Verify: frontend validate:local GREEN — type-check
  0, build OK, 737 pass / 0 fail (+2). FE-only (a store unit test; no UI markup change → no shot needed). cov: be
  87.47% / **fe 86.86% line / 87.97% func / 79.07% branch — UP +0.51/+0.29/+0.29, the FIRST FE coverage movement
  since C52** (the new tests cover settings.svelte.ts's uploadBackup reload branches). NEXT guard: the FE store/util
  layer has a few more real behavioral gaps (load-state.svelte.ts 35% func, theme.svelte.ts 60%) — prefer those
  genuine FE-logic pins over backend source-scans on unchanged code.
- **C99 (bug — recorded dry FAST per the C89/C95 discipline; no source changed since C85, 7th consecutive dry)** —
  Balance at C99 (HEAD was C98; nudge label lags): bug (99−95=4/3, +1) the LONE over-budget category → forced by
  category discipline. KEY STRUCTURAL FACT: `git diff 5766239(C85)..HEAD` over production source is EMPTY — NOTHING
  has changed since the cold bug vein was last swept (the C6/C10/C15/C83/C89/C95 dry scouts + every surface
  certified), so a regression is structurally impossible. Per the loop's OWN explicit C89/C95 recommendation
  ("record dry on the FIRST recheck + pivot — the budget is forcing ceremony, not finding work"), did ONE quick
  firsthand spot-check to stay non-vacuous rather than re-running the full cold sweep on provably-unchanged code:
  `buildAmortizationSchedule` (analytics-charts.ts:244, the #92/#117/#139 0%-APR money class) — CLEAN: 0%-APR →
  interest=0 (the bare `balance * apr/100/12` handles it, no special-case), principal clamped
  `Math.min(Math.max(0, payment − interest), balance)` (never negative, never over-pays the final month),
  paid-off loans skipped, no caller-input mutation; pinned by amortization-schedule.test.ts. No fresh defect —
  recorded DRY. The productive bug surface remains ONLY the parked Angelo-gated queue (#148/#100/#79/#129). NEXT
  bug cycle: with source unchanged since C85, record dry IMMEDIATELY (a 1-line precondition check: if
  `git diff C85..HEAD` over src is empty, nothing can have regressed) + pivot — re-scanning is pure ceremony.
  Doc-only — no source/test touched. cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C98 (arch no-churn [recorded fast per C91] → deep-review: pinned the session-cookie SECURITY-ATTRIBUTE
  contract via a source-scan)** — Balance at C98 (HEAD was C97; nudge label lags): TWO over budget — arch
  (98−91=7/5, +2, most-starved) and deep-review (98−92=6/5, +1, co-starved). ARCH: per the C91 standing
  recommendation, checked the precondition FIRST — `git diff 5766239(C85)..HEAD` over production source is EMPTY
  (no source threaded since the last arch scout: C86 saturated/C87 test/C88 eyes-on/C89 dry/C90 infra/C92 cert/C93
  eyes-on/C94 test/C95 dry/C96 eyes-on/C97 infra), so there is structurally nothing to converge → recorded no-churn
  IMMEDIATELY without re-scouting (the C12/C91 discipline; don't force ceremony). The substantive work PIVOTED to
  the co-starved deep-review (the C4 arch-scout→pivot precedent). DEEP-REVIEW: the C92/C97 notes flagged the
  session/cookie lifecycle as unaudited. Scouted Lucia firsthand: the session CONFIG (lucia.ts: secure-gates-prod,
  sameSite lax, httpOnly default) + the REFRESH chokepoint `validateAndRefreshSession` (utils.ts: validate→
  fresh-as-is→rotate-create-before-invalidate→fail-open-on-throw) are sound, and the refresh LOGIC is already
  guarded (validate-and-refresh-session.test.ts pins all 4 branches incl. the NORTH_STAR #1 fail-open). Found the
  genuine GAP: the session-cookie SECURITY ATTRIBUTES (secure: CONFIG.env==='production' / httpOnly: true /
  sameSite: 'Lax') are hand-duplicated across 5 manual sites — 2 setCookie (routes.ts login + utils.ts rotation) +
  3 deleteCookie (logout + 2 callback cleanups) — coupled only by copy-paste, and NO test asserted ANY of them
  (the refresh test mocks Lucia + checks the return value, never the `c` cookie attrs). A drift on one site (a
  refactor hardcoding `secure: true` → breaks local-http dev; `secure: false`/dropped httpOnly → ships an insecure
  / JS-readable session cookie in prod, an XSS-exfil + network-theft regression; a drifted deleteCookie silently
  fails to clear the cookie → logout doesn't log out) is invisible to every happy-path behavioral test. GUARD: new
  session-cookie-security-attributes.test.ts (+4) — source-scans both auth files, asserts every
  set/deleteCookie(c, lucia.sessionCookieName, …) block carries all 3 attributes. NON-VACUOUS proved firsthand:
  dropped httpOnly from the refresh-path cookie → ONLY the httpOnly test RED (named the utils.ts offender); restored
  → 4 pass. The one-edit→source-scan pattern (C25/C45/C59/C67/C80/C87/C94) applied to the session-cookie security
  contract. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new),
  1707 pass / 0 fail (+4), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ —
  guard-only source-scan; pins a multi-site security contract a happy-path test can't). The auth-security surface
  (rate-limit/client-IP C92, CORS/CSRF C94, session-cookie attrs C98) + the config-coupling seam
  (C67/C80/C81/C87/C94/C98) are now broadly fenced. NEXT deep-review: genuinely thin — every audited surface is
  certified; prefer a feature/bug-surfaced invariant or an Angelo steer over another cold audit.
- **C97 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C90)** — Balance at
  C97 (HEAD was C96; nudge label lags): TWO over budget — infra (97−90=7/6, +1) and arch (97−91=6/5, +1); infra wins
  on raw starvation (7 > 6, the C84 tie-break) AND is the higher-leverage pick (arch is reliably no-churn at its
  structural floor, C91; infra's cadence is genuinely non-dry). Ran right in the ~10-cycle window (7 since C90).
  (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.test.svelte` specs (bun/vitest discover by
  filesystem; an untracked spec vanishes on merge). Only the intentional `M .gitignore` + `M frontend/.gitignore`
  local overrides remain. (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.20% func** (file-mean, 1703 pass) — line
  UNCHANGED vs C90, func +0.01 (the C94 CORS/CSRF source-scan guard added a couple covered helper lines); **FE
  86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass) — FULLY UNCHANGED (no FE source touched since C52;
  C93/C96 were eyes-on shots, C95 a dry scout; the C90 branch 78.88 was v8 rounding noise, back to 78.78). Both at
  the ~87 BE / ~86 FE structural ceiling — the 90% goal stays structurally gated (BE tail OAuth/DI-bound; FE tail
  eyes-on components now ALL shot but not unit-covered). (3) BOTH-SIDES GREEN: BE 1703 / FE 735, 0 fail. (4) BRANCH
  STATE: claude-loop-dev = **97 commits ahead** of fresh origin/main, PR-ready (category spread bug 23 / feature 19
  / guard 15 / deep-review 15 / infra 13 / arch 11; the 97th is the C1 loop-doc reset). Recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe 86.35% (MEASURED). NEXT cadence
  ~C107. STANDING SIGNAL (C83–C97, 15 cycles): every self-authorizable vein is swept — net production change across
  all 15 is 2 guard tests (C87/C94). The branch is healthy + PR-ready; the highest-leverage remaining work is GATED
  on Angelo (#148 lease burn bar / import defaultCategory / #100 / #79 / #129) — a steer is the only thing that
  opens a fresh vein.
- **C96 (feature — eyes-on the LAST never-shot real surface /profile, desktop + mobile; CLEAN → every real surface
  now eyes-on)** — Balance at C96 (HEAD was C95; nudge label lags): NOTHING strictly over budget; arch (96−91=5/5) +
  infra (96−90=6/6) both AT budget. Arch is reliably no-churn (C91 confirmed, no source changed since C85) and infra
  ran C90 (cadence due ~C100), so both are weak picks → took the highest-leverage OPEN item: /profile, the last
  never-shot REAL surface (the C93 note teed this up — /trips is a Coming-Soon placeholder, /privacypolicy +
  /termsofservice are static legal copy). Shot DESKTOP + MOBILE (Pixel 5) + Read both PNGs. CERTIFIED CLEAN: desktop
  renders every section — Identity (DU avatar, Demo User/email, editable Display Name w/ pencil, Email, Member Since
  "June 2026" = correct vs today 2026-06-18), Connected Accounts (Google provider w/ unlink + "Link GitHub"),
  Sessions (Coming Soon, dashed fields), Data & Privacy (Export-all-data w/ working Export button + the honest
  "Images and photos are not included" disclosure; Delete account = Coming soon), Sharing + Notifications (Coming
  Soon). The Coming-Soon cards are clean intentional placeholders, NOT broken states. MOBILE (393px): NO horizontal
  overflow (NORTH_STAR #3) — title/subtitle wrap, the Identity label↔value rows reflow with right-aligned values
  (even the longest, demo@example.com, fits), Connected Accounts row reflows. Zero console errors; no /auth bounce.
  No defect; no fix (the GUIDE agent-HIGH-findings-often-false discipline). /profile is sound — DON'T re-audit.
  Read-only shots, no fixtures created. Doc-only — no committable source (shot.mjs is gitignored harness). cov: be
  87.47% / fe 86.35% (~ — no test/code touched). **MILESTONE: every REAL surface is now eyes-on
  (dashboard/analytics/insurance/financing-loan+lease/maintenance/recurring-dialog/settings/profile + the
  vehicles/expenses/reminders lists).** NEXT feature cycle: feature is FULLY exhausted of self-authorizable work —
  the only open feature (import-trackers) is Angelo-gated on defaultCategory, and every surface is shot → record
  parked + pivot to the co-starved category UNLESS Angelo steers (import defaultCategory unblocks the detect→commit
  round-trip + its 4-state shot; #148 the lease burn bar).
- **C95 (bug — offline-outbox field-dropout scout, DRY [6th consecutive]; recorded + pivot)** — Balance at C95
  (HEAD was C94; nudge label lags): bug (95−89=6/3, +3) the LONE over-budget category → picked (category discipline
  forces it). Cold scouts long exhausted (C6/C10/C15/C83/C89) + NO production source changed since C85, but ran one
  genuine firsthand scout of the freshest un-rechecked vein — the GUIDE-flagged offline-outbox→backend field-dropout
  family (#66/#101/#111). ALL CLEAN: (1) `api-transformer.ts` toBackendExpense/fromBackendExpense — symmetric +
  complete: volume/charge routed by isElectricFuelType, the create-vs-edit description null-clear asymmetry is
  deliberate (isEdit option, documented), every optional field (mileage/fuelType/description/sourceType/sourceId/
  missedFillup/groupId/groupTotal/splitMethod) round-trips. (2) the CALL-SITE dropout class (the real #66/#101/#111
  bug — the mapper can't carry a field the call site never put in the object) is pinned by
  offline-save-carries-fuel-fields.test.ts, which SOURCE-SCANS every `addOfflineExpense({...})` call for
  `missedFillup` (#101/#111 MPG-pairing) + `fuelType` (#66 electric charge survives sync) — exactly the GUIDE-flagged
  classes; plus api-transformer.property.test.ts pins the round-trip. The offline mapper + its call sites are
  SATURATED (10 test files). No fresh defect — recorded DRY, did NOT manufacture (the GUIDE bug-vein discipline + the
  C89 "record dry immediately + pivot"). The productive bug surface remains ONLY the parked Angelo-gated queue
  (#148/#100/#79/#129). NEXT bug cycle: with the cold vein 6× dry + no source churning, record dry on the FIRST
  recheck + pivot — the budget is forcing ceremony, not finding work; real defects now come only from a deep-review/
  feature cycle surfacing a concrete invariant, or an Angelo steer. Doc-only — no source/test touched (a dry scout).
  cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C94 (guard — pinned the CORS↔CSRF origin-allowlist coupling in app.ts via a source-scan; the C92-flagged
  unaudited surface)** — Balance at C94 (HEAD was C93; nudge label lags): TWO over budget — guard (94−87=7/6, +1)
  and bug (94−89=5/3, +2); guard most-starved (7 > 5) → picked (the C84 tie-break: raw starvation wins, not overage).
  Guard is narrowing + NO production source changed since C85, so I needed a genuine unguarded load-bearing
  invariant. The C92 deep-review flagged CORS/CSRF origin config as unaudited — verified the gap firsthand: app.ts
  wires `cors({ origin: CONFIG.cors.origins, ... })` AND `csrf({ origin: CONFIG.cors.origins })` from the SAME
  allowlist, coupled ONLY by both literally referencing that const — and NO test pinned it (the 2 files mentioning
  "csrf" assert the application-layer OAuth-state userId match, NOT the middleware origin allowlist). If a future
  edit drifts them (hands csrf a hardcoded/narrower/wider list, or an env var cors doesn't use), the two trust
  boundaries SPLIT: CSRF trusting an origin CORS rejects (or vice versa) → either a CSRF-protection gap on an
  unintended origin or legit cross-origin state-changing requests wrongly rejected as forgery (NORTH_STAR #2
  isolation), and a happy-path same-origin behavioral test stays GREEN, blind to it. GUARD: new
  `src/__tests__/cors-csrf-origin-coupling.test.ts` (+4) — source-scans app.ts: both `cors({...})` and `csrf({...})`
  must pass `origin: CONFIG.cors.origins`, AND both must reference the IDENTICAL origin source (drift detector).
  NON-VACUOUS proved firsthand: drifting csrf to a hardcoded `['http://localhost:5173']` → 2 of 4 RED (the csrf
  source assertion + the identical-source check); restored → 4 pass. The one-edit→source-scan pattern (C25/C45/C59/
  C67/C80/C87) applied to a security middleware-config coupling. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1703 pass / 0 fail (+5: the +4 here + a prior-uncounted
  delta), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ — guard-only source-scan;
  pins a cross-middleware config coupling a single-request test can't). NEXT guard: thin — prefer a fresh
  deep-review/feature-surfaced invariant over a cold guard scout; the config-coupling seam (retry-ceiling C67,
  export-import C80, OPTIONAL-files C81, prev-period C87, CORS/CSRF C94) is now broadly fenced.
- **C93 (feature — eyes-on the never-shot /settings surface [backup/restore + provider config], desktop + mobile;
  CLEAN)** — Balance at C93 (HEAD was C92; nudge label lags): TWO over budget — feature (93−88=5/4, +1) and bug
  (93−89=4/3, +1); feature most-starved (5 > 4) → picked. Import-trackers stays Angelo-gated (defaultCategory), so
  per the C68/C75/C82/C88 precedent took the shootable feature increment. The C88 "every populated surface eyes-on"
  claim was scoped to the DATA-feature surfaces (dashboard/insurance/financing/maintenance/recurring) — checked the
  shot history firsthand: /settings had ZERO prior eyes-on cycles (vs /reminders ×12, /insurance ×12, /financing
  ×10, /expenses ×10, /analytics ×5, /vehicles ×2, /dashboard ×1). /settings is the backup/restore + storage-provider
  + unit-preferences surface — a NORTH_STAR #1 (data-safety sacred) + #3 (mobile-first) crown-jewel that had never
  been visually verified. Shot it DESKTOP + MOBILE (Pixel 5) + Read both PNGs. CERTIFIED CLEAN: desktop renders every
  section — Profile card (Demo User/email/chevron), Appearance (Light/Dark/System toggle, System active), Unit
  Preferences (Distance=Kilometers / Fuel=Liters / Charge=kWh / Currency=USD with help text), Install App (PWA),
  Storage Providers (Download Backup + Restore buttons, Default Photo Source picker, an "e2e fake provider …
  Connected" card with edit/delete + ZIP-backup toggle). MOBILE (393px): NO horizontal overflow (NORTH_STAR #3) —
  the highest-risk elements (the 3-col theme grid, the wide unit selects, the Save-Settings FAB) all reflow within
  the Pixel-5 width; FAB pins bottom full-width. Zero console errors; no /auth bounce (auth valid). The mid-page dark
  Save-Settings button in the desktop full-page shot is the known fixed-FAB capture artifact (same as prior eyes-on
  cycles), not a render defect. No defect; no fix (the GUIDE agent-HIGH-findings-often-false discipline). /settings is
  sound — DON'T re-audit. Cleanup: none needed (read-only shots, no fixtures created). Doc-only — no committable
  source (shot.mjs is gitignored harness). cov: be 87.47% / fe 86.35% (~ — no test/code touched). NEXT feature cycle:
  the remaining never-shot routes are /profile + /trips (a "Coming Soon" placeholder, not a real surface) +
  /privacypolicy + /termsofservice (static legal copy) — only /profile is a real un-shot surface; after that, every
  real surface is eyes-on and feature is fully Angelo-gated (import defaultCategory + #148) → record parked + pivot.
- **C92 (deep-review — certified the rate-limit / client-IP abuse-prevention surface CLEAN + already comprehensively
  guarded firsthand; a NEW area, recorded + pivot)** — Balance at C92 (HEAD was C91; nudge label lags): deep-review
  (92−86=6/5, +1) the LONE over-budget category → picked. The eyes-on vein closed C88 + the C86 note pointed the next
  deep-review at "a backend correctness audit of a genuinely UNAUDITED surface." Picked the rate-limiting / client-IP
  resolution chokepoint — security-load-bearing (a spoofed-XFF bypass lets an attacker get a fresh per-request bucket
  → defeat the auth brute-force limiter, NORTH_STAR #2 isolation/abuse) and NOT in the prior audited set
  (backup/restore/import/TCO/sync/notification). Audited THREE layers firsthand, ALL certified clean + already
  guarded — DON'T re-audit: (1) `getClientIp` (utils/client-ip.ts) — derives the IP from the REAL socket
  (getConnInfo) and honors X-Forwarded-For ONLY when the socket is a configured trusted proxy; default (no trusted
  proxies) ignores XFF entirely. client-ip.test.ts (C265) pins all 4 trust branches (default→ignore-XFF,
  trusted-socket→honor-leftmost-XFF, untrusted-socket→ignore-XFF, no-socket→fallback) + the empty/whitespace-XFF +
  multi-hop edges + the explicit "two different-XFF requests from one socket share a bucket" bypass-closed assertion.
  (2) the rate-limit middleware (middleware/rate-limit.ts) — a clean fixed-window limiter; rate-limit.test.ts (C112)
  pins window-open / up-to-limit-pass / over-limit-429-with-the-documented-headers / body contract / per-key caller
  isolation / window-reset, PLUS a vacuity guard asserting CONFIG.disableRateLimit===false in the test process (the
  C77/C91 silent-vacuity trap). (3) the WIRING — the auth limiter keys on `auth:${getClientIp(c)}` (the trusted IP,
  not the raw header); the sync/backup/restore/trigger limiters key on the authenticated `user.id`. The keyGenerator
  closures are trivial one-liners — pinning them directly would be coverage theater (the C181/C229 lesson). No fresh
  defect; the bypass is closed + pinned. Recorded clean; did NOT manufacture a redundant cert (the GUIDE
  agent-HIGH-often-false + the C86 saturation discipline). Doc-only — no source/test touched. cov: be 87.47% / fe
  86.35% (~ — nothing changed). NEXT deep-review: another genuinely UNAUDITED backend surface (e.g. the CORS/CSRF
  origin config, the bodyLimit/zip-bomb upload guards, or the session/cookie lifecycle) — the eyes-on + the
  data-safety (backup/restore/import) veins are both exhausted.
- **C91 (arch — no churn warranted; pagination/route idioms already single-sourced + NO source changed since C85,
  recorded + pivot)** — Balance at C91 (HEAD was C90; nudge label lags): arch (91−85=6/5, +1) the LONE over-budget
  category → picked (category discipline). Per the C85/C12 "record no-churn FAST when arch next goes over budget"
  recommendation, but ran one genuine scout first. KEY STRUCTURAL FACT: `git diff 5766239(C85)..HEAD` over
  backend/src (excluding __tests__) is EMPTY — NO production source changed since the C85 arch scout (C86 saturated
  / C87 test-only / C88 eyes-on / C89 dry / C90 docs), so there is structurally no freshly-threaded duplication to
  converge (the exact precondition the C85/C12 notes describe). Scouted the freshest un-recorded candidate anyway —
  the pagination parsing across odometer/photos/expenses routes — and found it ALREADY well-factored: `clampPagination`
  + `buildPaginatedResponse` are both single-sourced in src/utils/pagination.ts (a prior arch cycle); all 3 routes
  delegate; the per-endpoint query schemas (odometer/expenses carry search/tags coercion, photos uses the generic
  commonSchemas.pagination) are deliberately divergent — merging would couple endpoint-specific contracts (arch
  rule 2). The ownership-validate+respond idiom is the C36-recorded "natural Hono idiom with shared validators"
  (not mergeable). Recorded no-churn; did NOT manufacture (the C4/C12/C36/C85 precedent + the GUIDE "Don't
  manufacture churn"). The convert family stays single-sourced (C64/C71/C78). RECOMMENDATION (now 6th confirm,
  C4/C6/C12/C36/C85/C91): arch is firmly at its structural floor — next time it goes over budget, record no-churn
  IMMEDIATELY without re-scouting unless a bug/feature cycle has threaded a NEW dup since the last arch scout (check
  the git diff first — if backend/src is unchanged, there's nothing to find). Doc-only — no source touched. cov: be
  87.47% / fe 86.35% (~ — nothing changed).
- **C90 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C84)** — Balance at
  C90 (HEAD was C89; nudge label lags): NOTHING strictly over budget; arch (90−85=5/5) + infra (90−84=6/6) both AT
  budget. Infra wins on raw starvation (6 > 5) AND is the higher-leverage pick — its cadence task is inherently
  NON-dry (a real coverage re-measure + merge-safety sweep + green check + branch refresh), whereas arch is reliably
  no-churn at its structural floor (C4/C12/C36/C85) and bug/deep-review just recorded dry/saturated (C86/C89). Ran ~4
  cycles early vs the ~C94 target, but every alternative this cycle produces a dry/no-churn record, so the
  non-dry pick is correct. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.test.svelte` specs
  (bun/vitest discover by filesystem; an untracked spec vanishes on merge). Only the intentional `M .gitignore` +
  `M frontend/.gitignore` local overrides remain (keep `.meshclaw-tools/` + `*.meshclaw.e2e.ts` ignored by design;
  the C68 shot.mjs CLICK harness is correctly gitignored). (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.19% func**
  (file-mean, 1698 pass) — UNCHANGED vs C84 (C85 no-churn + C86 saturated + C87 prev-period source-scan guard [scans
  a string, line-covers nothing new] + C88 eyes-on + C89 dry scout); **FE 86.35% line / 87.68% func / 78.88% branch**
  (v8, 735 pass) — line/func UNCHANGED, branch +0.10 vs C84's 78.78 = v8 instrumenter rounding noise (NO FE source
  touched since C52). Both at the ~87 BE / ~86 FE structural ceiling — the 90% goal stays structurally gated (BE
  tail = OAuth/DI-bound auth-routes/provider-services/backup-orchestrator/db-connection; FE tail = eyes-on
  components now all shot but not unit-covered). (3) BOTH-SIDES GREEN: BE 1698 / FE 735, 0 fail. (4) BRANCH STATE:
  claude-loop-dev = **90 commits ahead** of fresh origin/main, PR-ready (category spread bug 22 / feature 17 /
  guard 14 / deep-review 14 / infra 12 / arch 10; the 90th is the C1 loop-doc reset). Recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe 86.35% (MEASURED). NEXT cadence
  ~C100. The branch is healthy + PR-ready; the loop has swept every self-authorizable vein (C83–C89), so the
  highest-leverage remaining work is GATED on Angelo (#148/#100/#79/#129 + import defaultCategory) — a steer
  unblocks a fresh vein.
- **C89 (bug — date/tz + materialization scout, DRY [5th consecutive]; recorded + pivot per the GUIDE discipline)**
  — Balance at C89 (HEAD was C88; nudge label lags): bug (89−83=6/3, +3) the LONE over-budget category → picked.
  The cold pure-logic vein is long exhausted (C6/C10/C15/C83), so per the GUIDE bug seam ("date/tz math — setMonth
  overflow, UTC slice") + the fact C88 just exercised the reminder trigger/materialization path, ran a fresh scout
  of the date-advance + cost + materialization surfaces. ALL verified CLEAN firsthand: (1) the reminder
  date-advance (`computeNextDueDate` / `advanceCustom` / `clampToAnchorDay`) — the Jan-31→Feb overshoot is dodged
  by `setDate(1)` BEFORE the `setMonth`/`setFullYear` bump, then month-end clamp via `clampToAnchorDay` anchored to
  `startDate.getDate()` (getAnchorDay); the bug-#12/#13/#107/#114/#116 family (corrupt-frequency throw,
  non-positive-interval throw, endDate-boundary `hasReminderEndedBy`, fast-forward non-progress backstop) is all
  closed + guarded. (2) `monthKeysInRange` (analytics-charts.ts:185, the GUIDE-flagged setMonth site) — cursor is
  anchored to day-1 via the 3-arg `Date(y, m, 1)` constructor (NOT setMonth on a day-29..31 date), so it's
  rollover-safe, not just commented. (3) `reminder-cost.ts` annualization (occurrencesPerYear ÷ 12, the C5/C88
  dashboard run-rate) — consistent with computeNextDueDate, un-fireable shapes (non-positive/unknown interval) →
  0, no divide-by-zero. (4) the split-materialization path (`createExpenseFromReminder`) delegates to the shared
  `expenseSplitService.computeAllocations` + `createSiblings` — the SAME code the regular split flow uses, already
  saturated (C2/C4/#88/#98). No fresh defect — recorded DRY, did NOT manufacture (the GUIDE agent-HIGH-often-false
  discipline + the C15/C83 "record dry FAST + pivot" recommendation). The productive bug surface is now the parked
  Angelo-gated queue (#148 lease burn bar / #100 json_patch / #79 stuck-offline / #129 OAuth email-sync); cold
  scouts are spent. NEXT bug cycle: record dry immediately + let the budget pull elsewhere UNLESS a deep-review/
  feature cycle surfaces a concrete invariant or Angelo steers. Doc-only — no source/test touched (a dry scout).
  cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C88 (feature — eyes-on the never-shot recurring-expenses MaterializedExpensesDialog POPULATED; CLEAN)** —
  Balance at C88 (HEAD was C87; nudge label lags): TWO over budget — feature (88−82=6/4, +2) and bug (88−83=5/3,
  +2); feature most-starved (6 > 5) → picked. Import-trackers (the only open feature SPEC work) stays Angelo-gated
  (defaultCategory), so per the C68/C75/C82 precedent I took the shootable feature increment: an eyes-on of the
  ONE surface the C82/C86 notes flagged as still-unshot — the recurring-expenses MaterializedExpensesDialog in a
  POPULATED state (C5 shot the dashboard RecurringCostCard, C9 shot the ⟳ badge, C19 certified the dialog EMPTY
  state, C27 verified the round-trip via API, but the dialog's DATA markup itself was never eyes-on — the C68
  "E2E can't catch never-rendered fields" lesson). Stack already up (:5173/:3001). Minted auth, created an OVERDUE
  monthly expense reminder ("C88 eyes-on insurance", $150/mo, startDate 2025-12-15, financial category on Daily
  Driver), POST /trigger materialized 7 catch-up rows (Dec 2025→Jun 2026, $1,050 total — confirmed via GET
  /reminders/:id/expenses), opened the dialog via the per-card `[data-testid="reminder-card-<id>"]
  button[aria-label="View materialized expenses"]` (scoped past the 4 pre-existing e2e expense reminders) +
  **Read the PNG** (zoomed crop). CERTIFIED CLEAN: header (Receipt icon + "Materialized expenses" + ×), subtitle
  "Expenses auto-created by "C88 eyes-on insurance"." (reminder name interpolated, smart quotes), summary
  "**7 expenses · $1,050.00 total**" (matches the API exactly), each row = Financial · {date asc Dec 15 2025→May
  15 2026} · car-icon Daily Driver · **$150.00** right-aligned. Zero console errors; full FE→BE→DB→render
  round-trip. The dialog markup is sound — DON'T re-shoot it. CSRF NOTE for future API-seeded eyes-on: POST routes
  (/trigger, DELETE) need an `Origin: http://localhost:5173` header (hono/csrf, app.ts:116) or they 403; GET is
  unaffected. CLEANUP: deleted the reminder (severs source link, keeps rows = history by design) + all 7
  materialized rows individually → DB restored to its pre-cycle state (4 expense reminders, the C88 reminder 404s).
  Doc-only — no committable source (shot.mjs is gitignored harness; no auto-fix). cov: be 87.47% / fe 86.35%
  (~ — eyes-on cert, no module touched). NEXT feature cycle: still Angelo-gated (import-trackers defaultCategory +
  #148) → with all 3 feature tails + every populated surface now eyes-on (dashboard/insurance/financing
  loan+lease/maintenance/recurring dialog), record parked + pivot to the co-starved category UNLESS Angelo steers.
- **C87 (guard — pinned bug #18 split-sibling exclusion on the PREV-PERIOD SQL fillup count, the C97 guard's
  missing twin)** — Balance at C87 (HEAD was C86; nudge label lags): THREE over budget — guard (87−80=7/6, +1),
  feature (87−82=5/4, +1), bug (87−83=4/3, +1); guard most-starved (7) → picked. Scouted the convert-dispatch
  family FIRST (the C73/C80/C86 "guard is narrowing" note) and confirmed it's saturated — C59 placeholder-scan +
  C73 orientation-scan + per-member behavioral guards (incl. radar C76's ranking-inversion fixture + the C79
  prev-year VOLUME mixed-unit test) fence every #94 dispatch. Found the genuine GAP one layer over: the FuelStats
  "This Period vs Last Period" fillup COMPARISON computes its two halves through DIFFERENT predicate
  implementations across two layers — `fillups.currentYear` is in-memory `fuelRows.filter(isFillup)`
  (volume != null && volume > 0) while `fillups.previousYear` is the SQL `COUNT(CASE WHEN volume > 0 THEN 1 END)`
  in queryFuelAggregates (C79's group-by-vehicle shape), coupled only by a "matches the isFillup predicate"
  comment. A split fuel expense makes volume-null siblings (ExpenseSplitService) that must NOT inflate either
  count (bug #18 / C97). VERIFIED FIRSTHAND the C97 guard pins ONLY the currentYear/in-memory half — NO test
  asserts `fillups.previousYear` from a populated DB (summary-route.test.ts:41 is a mocked fixture; previousMonth
  is the in-memory path), so the SQL count's null-exclusion is un-exercised: drop the `CASE WHEN volume > 0` to a
  plain `COUNT(*)` and the prev-period count silently inflates by the split legs ("Last Period over-reports
  fillups", NORTH_STAR #2) while every test stays green. GUARD: +1 in fuel-stats-fleet-distance-pooling.test.ts
  (next to the C79 prev-year volume test, same 2024-range/2023-prev-window) — seed 2 real fillups + a 2-leg
  volume-null split in the prev window, assert `fillups.previousYear === 2` (not 4) + the prev volume SUM stays
  19 (null contributes 0). NON-VACUOUS proved firsthand: forcing `COUNT(*)` → the new test RED (Expected 2,
  Received 4) while the OTHER 10 in-file + the C97 currentYear test + calendar-month tests ALL stay green
  (confirming the gap was prev-period-only); restored → 1698 pass. The bug-class-pinned-on-one-layer → guard-pins-
  the-sibling-layer pattern (C67 cross-module retry-ceiling; here C97 in-memory count → C87 SQL count). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1698 pass / 0 fail
  (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ — analytics repo already
  line-covered; +1 pins the prev-period SQL predicate's null-exclusion a same-row-shape test can't). Next guard:
  thin — the fuel-stats count/convert predicates are now fenced on both layers; prefer a fresh deep-review/feature
  eyes-on-surfaced invariant over another cold guard scout.
- **C86 (deep-review — surfaces SATURATED; 4 candidates verified already-guarded firsthand, recorded + pivot)**
  — Balance at C86: four AT budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); deep-review has the lowest
  budget (tips first) → picked. Scouted 4 fresh deep-review candidates; EACH already well-guarded, DON'T
  re-audit: (1) FE sync-manager RETRY/BACKOFF — sync-manager.test.ts pins retry-count, maxRetries cap,
  `retryDelay * 2^retries` exponential, no-reschedule-at-cap, #121 retry-conflict-surface, #134
  orphan-resurrection (the C67/C81 "next vein" pointer is STALE — covered since); (2) determineConflictType
  (C67 cert, sync-manager.test.ts:562+); (3) computeTCOTotal — the #27/#28 double-count rule directly pinned in
  per-vehicle.property.test.ts:411 + Property 14 + #33 block; (4) reminder-NOTIFICATION read path — feed order +
  #142 + mark-read/404 (notifications-feed.test.ts) + per-milestone (reminderId,dueOdometer) dedup incl. re-arm
  + both-axes no-collision (trigger-mileage.test.ts, C256). Recorded saturated; did NOT manufacture a redundant
  cert (GUIDE agent-HIGH-often-false + C12 structural-floor discipline). The one still-paying deep-review vein is
  EYES-ON of a never-shot surface (E2E can't catch never-rendered fields — the C68 lesson); NEXT: the
  recurring-expenses MaterializedExpensesDialog / ⟳ badge POPULATED (needs a type:expense reminder + trigger to
  materialize rows first; C5 shot the dashboard card, C27 verified the round-trip via API, the dialog markup is
  unshot). Doc-only — no source touched. cov: be 87.47% / fe 86.35% (~ — nothing changed). PATTERN NOTE: the
  C83 (bug) / C85 (arch) / C86 (deep-review) run of dry scouts confirms the codebase is mature — the highest-
  leverage remaining work is GATED on Angelo (#148/#100/#79/#129 + import defaultCategory); the loop will keep
  producing solid guards/certs but a steer unblocks a fresh vein.
- **C85 (arch — no churn warranted; convert family fully deduped, recorded + pivot)** — Balance at C85: arch
  (85−78=7/5, +2) the lone over-budget category → picked. Scouted the #94 convert-helper residue firsthand;
  REJECTED both candidates per arch rule 5 (name a concrete payoff): (1) the 5-arg convertEfficiency
  from-vehicle-units shape is only 2 sites (radarUnitConverters closure + the convertedGasEfficiencyPoints
  generator), one interleaved with skipConversion + the load-bearing gas-gate — a 2-site wrapper is thin churn
  the generator wouldn't cleanly delegate; (2) `vehicleNameMap.get(vId) ?? 'Unknown'` repeats 10× but is a
  COSMETIC fallback (a drift is harmless — UNLIKE C71's `?? {...DEFAULT}` that threw, or C78's NaN-guard),
  10 sites for a 1-token tidy. The convert family is already single-sourced (C64 generator / C71 vehicleUnitsFor
  / C78 convertRowVolume). Recorded no-churn; did NOT manufacture (the C4/C12/C36 precedent + the GUIDE
  "Don't manufacture churn"). RECOMMENDATION (echoing C12): arch is at its structural floor — next time it goes
  over budget, record no-churn FAST + let the budget pull elsewhere. Doc-only — no source touched. cov: be
  87.47% / fe 86.35% (~ — nothing changed).
- **C84 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C77).**
  TWO over budget at C84 — infra (84−77=7/6, +1) and arch (84−78=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). Ran a touch early (7 cycles since C77) but the budget forces it. (1) UNTRACKED-TEST SWEEP: CLEAN —
  zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored `*.meshclaw.e2e.ts` agent specs + the C68
  shot.mjs CLICK_TEXT harness are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the
  intentional local overrides). (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.19% func** (1697 pass — both
  +0.01 vs C77 from the C80 export-import column guard + C81 backup-files guard); **FE 86.35% line / 87.68% func
  / 78.78% branch** (735 pass — UNCHANGED, C78–C83 all backend/doc). Both at the ~87 BE / ~86 FE structural
  ceiling. (3) BOTH-SIDES GREEN: BE 1697 / FE 735. (4) BRANCH STATE: claude-loop-dev = **84 commits ahead** of
  fresh origin/main, PR-ready (category spread bug 21 / feature 16 / guard 13 / deep-review 13 / infra 11 /
  arch 9; the 84th is the C1 loop-doc reset). Doc-only — no source touched. cov: be 87.47% / fe 86.35%
  (MEASURED). NEXT cadence ~C94.
- **C83 (bug — write-path validation-asymmetry scout, DRY; 3 surfaces verified clean firsthand)** — Balance at
  C83: bug (83−79=4/3, +1) the lone over-budget category → picked. #94 is fully closed (C79); the approved bug
  queue is all gated (#100 arch-gated, #129/#79 product-calls awaiting Angelo, #148 parked). Per the GUIDE bug
  vein (write-path validation asymmetry = the gold seam; one fresh-surface scout then record+pivot if dry), ran
  a fresh scout. ALL 3 surfaces verified CLEAN firsthand: (1) REMINDER create/update splitConfig —
  `refineSplitConfig` enforces splitConfig-vehicleIds === reminder vehicleIds (validation.ts:143) + the route
  validateVehicleIdsOwned's them, so the blob's legs are transitively owned (no verbatim-write gap; #88/#97 were
  the delete-cascade siblings, this is the create/update side). (2) ODOMETER write path — POST/PUT/DELETE all
  validate ownership before any write (the #215 tenant-scope class). (3) ODOMETER updateSchema `.partial()` —
  PROBED whether the `recordedAt` future-date refine survives `.partial()` (the #109/C372 dropped-refine class);
  it DOES because it's a FIELD-level `.refine()` (part of the field's schema; `.partial()` only wraps it in
  ZodOptional), UNLIKE #109's object-level `.superRefine()` — and it's already guarded (update-route.test.ts +
  validation.property.test.ts). DEBUNKED the #109-analogy candidate firsthand rather than filing a false
  positive (the GUIDE agent-HIGH-findings-are-often-false discipline). Recorded dry; did NOT manufacture a
  finding. The write-path asymmetry seam stays SATURATED (#80–#146 + these 3). Doc-only — no source/test changed
  (a dry scout). cov: be 87.46% / fe 86.35% (~ — nothing touched). NEXT bug cycle: record dry + pivot fast;
  productive defects now come from deep-review/feature eyes-on surfacing concrete invariants, not cold scouts.
- **C82 (feature — /financing LOAN render eyes-on sweep, CLEAN)** — Balance at C82: feature (7/4, +3) the lone
  most-starved over-budget category → picked. Import-trackers (the only open feature SPEC work) stays
  Angelo-gated (defaultCategory) + #148 escalated, so per the C68/C75 precedent I took the shootable feature
  increment: a deep-UI eyes-on of the never-shot FinanceTab LOAN render (C68 shot the LEASE path; the loan +
  Payment-Metrics + amortization path was unshot — the vein C75/C81 flagged). Minted auth, shot the Toyota
  Camry loan vehicle (Bank of America 4.5% APR, $20k/60mo) Finance tab (CLICK_TEXT='Finance' since the tab
  state is client-side) + **Read the PNG**. CERTIFIED CLEAN: Next Payment $372.86 (Monthly · Loan · 4.5% APR,
  Record/Change buttons), Payment Progress 5% (Original $20,000 / Paid $900 / Remaining $19,100), and all 4
  PaymentMetricsGrid cards render correct loan math — Principal vs Interest $297.86 (+$75 interest), Payments
  Made 1 of 60, Estimated Payoff Mar 18 2031 (59 mo remaining), Total Cost of Loan $22,371.63 (12% over
  principal) — the figures the #92/#117/#139 0%-APR-class fixes touched. Payment History: the $900 Extra
  Payment with Principal/Interest split + Remaining Balance $19,100. The Amortization Schedule chart area is
  BLANK — VERIFIED firsthand this is the C26-documented IO-gated-chart headless-capture limit (ChartCard's
  visibility-watch IntersectionObserver doesn't fire in a full-page shot; the legend renders outside the gate),
  NOT a data/render defect: the /analytics/financing endpoint returns a populated loanBreakdown (12 entries),
  so the data path is healthy. No defect; no fix (the GUIDE agent-HIGH-findings-are-often-false discipline).
  The loan FinanceTab is architecturally sound — DON'T re-audit. No code changed; doc-only. cov: be 87.46% /
  fe 86.35% (~ — no test/code touched). NEXT feature cycle: still Angelo-gated → record parked + pivot, OR
  eyes-on the recurring-expenses dashboard widget in a populated state / a remaining un-shot surface.
- **C81 (deep-review)** — **Certified the backup-EXPORT serialization round-trip CLEAN + pinned the one
  unguarded invariant: OPTIONAL_BACKUP_FILES ⊆ TABLE_FILENAME_MAP (data-recovery, NORTH_STAR #1).** Balance at
  C81: deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but less starved + spec
  Angelo-gated) → picked. Audited the backup export path (createBackup → exportAsZip → parseZipBackup) firsthand
  — the C74 next-vein. CERTIFIED CLEAN + already well-guarded (DON'T re-audit): (a) createBackup's 15 BackupData
  keys === TABLE_SCHEMA_MAP (backup-createbackup-keys.test.ts, C208 part B); (b) SCHEMA_MAP keys === FILENAME_MAP
  keys + every schema table mapped-or-excluded (backup-table-coverage.test.ts, C208 part A); (c) export +
  restore BOTH derive columns from the SAME getTableColumns(table) → schema-symmetric, can't drift; (d) coerceRow
  numeric (#68/#209 thousands-separator) + JSON round-trips covered by the populated claims/maintenance/
  split-config/csv-special-chars round-trip suites. Found the GENUINE GAP: getRequiredBackupFiles() = FILENAME_MAP
  values MINUS the hand-maintained OPTIONAL_BACKUP_FILES set — coupled ONLY by literal filename strings. An
  OPTIONAL entry that drifts from the map (typo / a map rename) filters out NOTHING → a genuinely-optional file
  becomes REQUIRED → parseZipBackup rejects a valid OLDER backup missing it ("Missing required files"), so the
  user can't recover their own data (NORTH_STAR #1). Certified firsthand all 11 OPTIONAL entries are in the map
  today (zero orphans). GUARD: exported OPTIONAL_BACKUP_FILES + a 3rd test in backup-table-coverage.test.ts
  asserting OPTIONAL ⊆ FILENAME_MAP values. NON-VACUOUS proved firsthand: drifting the map's
  reminder_vehicles.csv → reminders_vehicles.csv orphans the OPTIONAL entry → RED naming the orphan + the
  consequence; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing
  warnings, none new), 1697 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% /
  fe 86.35% (~ — guard/cert add; backup pipeline already well-covered, this pins the last drift seam). The backup
  export/restore round-trip is now broadly certified — next deep-review: the FE offline sync-manager retry/backoff,
  or an eyes-on /financing populated render.
- **C80 (guard)** — **Pinned the CSV export↔import column-name contract (the round-trip crown-jewel, NORTH_STAR
  #1) with a source-scan.** Balance at C80: THREE over budget — feature (5/4, +1), deep-review (6/5, +1), guard
  (7/6, +1); guard most-starved (7) → picked. With #94 fully closed (C79), scouted the convert-before-pool
  family FIRST and confirmed it's thoroughly fenced (C59 placeholder-scan + C73 dispatch-orientation + the
  per-member behavioral guards + the C79 prev-year test; the C71/C76/C78 private helpers are transitively
  driven — pinning them directly would be theater). Found the genuine GAP elsewhere: the export writes its
  header row from `EXPORT_COLUMNS` (expenses/routes.ts) and the native importer reads each cell BY NAME via
  `makeCellGetter`'s `get('<col>')` (import-csv.ts) — coupled ONLY by the column-name strings matching. Rename
  or drop an EXPORT_COLUMN without updating the importer's `get(...)` → a VROOM export silently STOPS
  round-tripping that field (the cell reads blank, the value is lost on re-import, NORTH_STAR #1). NEITHER
  existing suite catches it: export-csv.test.ts asserts the export only; import-csv.test.ts hand-writes its OWN
  literal header row (never imports the real EXPORT_COLUMNS const) — drift leaves both green. GUARD: exported
  EXPORT_COLUMNS + new export-import-column-contract.test.ts (+4): source-scans the importer's `get('<key>')`
  reads (10 cols) + asserts each is present in EXPORT_COLUMNS; pins the 2 export-only metadata cols
  (currency/createdAt) as INTENTIONALLY not-read (the asymmetry is one-directional ⊆, by design). NON-VACUOUS
  proved firsthand: renaming EXPORT_COLUMNS' `fuelType`→`fuel_type` → RED with "importer reads column(s) the
  export no longer writes: [fuelType] … would silently LOSE these fields"; restored → green. The
  one-edit→source-scan pattern (C25/C45/C59/C73) on the export/import round-trip contract. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1696 pass / 0 fail (+4),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only source-scan; pins a
  cross-module contract a single-side test can't). Next guard: thin — the import/export + convert families are
  now well-fenced; prefer a fresh deep-review-surfaced invariant.
- **C79 (bug #94, prev-year sub-member — #94 CLASS NOW FULLY CLOSED)** — **Convert each vehicle's prev-window
  volume to user-global units BEFORE pooling volume.previousYear (Angelo-APPROVED Sev-2, NORTH_STAR #2).**
  Balance at C79: four AT budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); bug has the lowest budget
  (tips first) + the concrete last #94 sub-member → picked. volume.previousYear (the FuelStats "Last Period"
  comparison) came from a raw SQL `SUM(volume)` in queryFuelAggregates over the prior equal-length window —
  cross-vehicle, UN-converted — so a mixed gal+L fleet pooled litres with gallons (the prev-year twin of the
  C62 current-period fix; the LAST un-fixed #94 member, a query-layer shape not a builder). FIX: changed
  queryFuelAggregates to GROUP the volume SUM BY vehicle (returns `{ count, volumeByVehicle: Map }` instead of
  a single totalGallons); buildFuelStatsFromData converts each vehicle's prev-window sum to the user's global
  unit before pooling (reusing vehicleUnitsFor + convertVolume), gated by skipConversion (a plain sum on the
  common single-unit branch). The COUNT stays unconverted (unit-free). Both callers (getFuelStats + getSummary)
  forward the new-shape agg unchanged. GUARD: +1 mixed gal+L test (range = calendar 2024, prev-window = 2023:
  A 40 gal + B 10 L→2.64 gal = 42.64, not the raw 50). NON-VACUOUS proved firsthand: reverting to the raw sum →
  50 not 42.64 RED; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20
  pre-existing warnings, none new), 1692 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot).
  cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). **#94 CLASS FULLY
  CLOSED** — all 6 builder members (distance C58 + volume C62 + monthlyConsumption C65 + seasonal C69 +
  dayOfWeek C72 + vehicleRadar C76) + the prev-year SQL sub-member (C79) now convert-before-pool. The
  fleet-wide analytics summary + fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet end-to-end.
- **C78 (arch)** — **Extracted the per-row volume-convert idiom into ONE private helper across the 3
  volume-pooling sites (behavior-preserving; the zero-guard + per-vehicle lookup can't drift).** arch was the
  SOLE over-budget category (78−71=7/5, +2). The C62/C65/C72 #94 volume work left the SAME idiom hand-repeated
  at 3 sites: `v = row.volume ?? 0; if (v===0) return 0; vUnits = vehicleUnitsFor(map, row.vehicleId); return
  convertVolume(v, vUnits.volumeUnit, target.volumeUnit)` — in buildConvertedMonthlyConsumption (C65),
  buildConvertedDayOfWeekPatterns (C72), and the buildFuelStatsFromData volumeInUserUnits closure (C62).
  Extracted `convertRowVolume(row, vehicleUnitsMap, targetUnits)`; all 3 route through it. PAYOFF: the `?? 0`
  coalesce + the `=== 0` short-circuit (missing/zero volume → 0, never NaN into a sum) + the per-vehicle
  vehicleUnitsFor lookup are now ONE source of truth — a future site can't drift the zero-guard or drop the
  per-vehicle unit lookup. The volumeInUserUnits closure KEEPS its own leading `skipConversion ||` guard (it's
  the only volume path reached on BOTH branches; the 2 twins are converted-only) and delegates the rest.
  Behavior-preserving (green→green): the C62/C65/C72 mixed-unit volume guards (headline 42.64, monthlyConsumption
  42.64, dayOfWeek 6.06) all pass unchanged — `convertVolume` now has exactly ONE call site (inside the helper).
  Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1691 pass
  / 0 fail (no test delta — pure refactor), build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe
  86.35% (~ — pure refactor, same lines covered). STANDING PATTERN again: a bug cycle that threads a
  near-identical idiom into N sites (C62/C65/C72 #94) seeds the next arch cycle to converge it (sibling to C64
  generator + C71 vehicleUnitsFor). Don't re-scout these volume sites — single-sourced.
- **C77 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C70).**
  TWO over budget at C77 — infra (77−70=7/6, +1) and arch (77−71=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). Ran a touch early (7 cycles since C70 vs the ~10 guideline) but the budget forces it AND the suite
  grew +19 (1672→1691) over C71–C76, so the re-measure is substantive, not ceremony. (1) UNTRACKED-TEST SWEEP:
  CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored `*.meshclaw.e2e.ts` agent specs +
  the C68 shot.mjs CLICK_TEXT harness are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are
  the intentional local overrides). (2) COVERAGE RE-MEASURED: **BE 87.46% line / 87.18% func** (1691 pass); **FE
  86.35% line / 87.68% func / 78.78% branch** (735 pass) — BOTH FLAT vs C70 (C71–C76 were dedups/twins/guards on
  already-covered analytics + import modules + a new test file; FE untouched since C52). Both at the ~87 BE /
  ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1691 / FE 735. (4) BRANCH STATE: claude-loop-dev = **77
  commits ahead** of fresh origin/main, PR-ready (category spread bug 19 / feature 15 / guard 12 /
  deep-review 12 / infra 10 / arch 8; the 77th is the C1 loop-doc reset). Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C87.
- **C76 (bug #94, vehicleRadar member — the LAST advanced builder)** — **Convert each vehicle's gas-MPG +
  odometer to user-global units BEFORE the cross-fleet normalize (Angelo-APPROVED Sev-2, NORTH_STAR #2).**
  Balance at C76: bug (4/3, +1) the lone over-budget category → picked. Took the 6th/last unit-bearing #94
  builder. buildVehicleRadar normalizes per-vehicle metrics via min/max ACROSS the fleet; TWO of its axes are
  unit-bearing — fuelEfficiency (each vehicle's avg gas-MPG in ITS mi/gal or km/L) AND mileage (each vehicle's
  max odometer in ITS distance unit). Pre-fix it normalized RAW values, so a mixed mi+km/gal+L fleet ranked a
  km/L car against an mpg car by bare magnitude → the efficiency ranking could fully INVERT (a more-efficient
  metric car scored LOWER). DESIGN: unlike the small twins (C65/C69/C72), buildVehicleRadar is ~75 lines + 2
  private helpers — a repository twin would be a large copy (arch-smell). Instead threaded an OPTIONAL
  `convert?: RadarUnitConverters` param (bound converter closures) into the ONE builder; it converts each
  vehicle's two unit-bearing metrics after the helpers populate `metrics` but BEFORE the normalize. Omitted →
  byte-identical (same-unit fleet + every existing caller). Kept analytics-charts UNIT-NAIVE: the repository
  owns the convertEfficiency/convertDistance deps via a new `radarUnitConverters(vehicleUnitsMap, userUnits)`
  helper (reuses the C71 vehicleUnitsFor fallback); switched at the call site by skipConversion. GUARD: +1 mixed
  mi/gal+km/L test driving getFuelAdvanced — A 30 mpg vs B 18 km/L→42.34 mpg: converted, B is more efficient →
  B.fuelEfficiency 100 / A 0 (the OPPOSITE of the raw magnitude ranking A>B). NON-VACUOUS proved firsthand:
  forcing the raw builder → B 100→0 (ranking inverts) RED; restored → green. The C73 orientation guard stays
  green (the radar ternary isn't a buildConverted* dispatch, correctly ignored). Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1691 pass / 0 fail (+1), build bundled.
  Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1
  mixed-unit guard). **#94 ADVANCED BUILDERS ALL DONE** (monthlyConsumption C65 + seasonalEfficiency C69 +
  dayOfWeekPatterns C72 + vehicleRadar C76, on top of distance C58 + volume C62). REMAINING #94 = only the
  prev-year SQL-sum sub-member (previousYearGallons — a raw SQL SUM in queryFuelAggregates needing a per-vehicle
  group-sum at the query layer; a different, query-layer shape).
- **C75 (feature — /insurance eyes-on sweep, CLEAN; a suspected defect debunked firsthand)** — Balance at C75:
  feature (7/4, +3) the lone most-starved over-budget category → picked. Import-trackers (the only open feature
  SPEC work) stays Angelo-gated (defaultCategory) + #148 escalated, so per the C68 precedent I took the
  shootable feature increment: a deep-UI eyes-on of the never-shot /insurance render (the vein C46/C53/C60/C67
  repeatedly flagged). Stack already up; minted auth, confirmed 7 seeded policies (State Farm + Geico + 5 e2e
  leftovers), shot /insurance DESKTOP + MOBILE and **Read both PNGs**. CERTIFIED CLEAN: the page renders the
  data state + four-states correctly — header + New-Policy FAB, per-policy PolicyCard (Current Term:
  Expires/Total Cost/Monthly/Vehicles), Documents EMPTY ("No documents uploaded yet" + Upload), Claims EMPTY
  ("No claims filed") AND a populated "Collision · Settled" claim on the e2e claims policy, "Expired" term
  badges (correct — all seeded term dates predate 2026-06-18) + working Renew. MOBILE: NO horizontal overflow
  (NORTH_STAR #3) — label/value rows + Current-Term/Documents/Claims sections all reflow to the Pixel-5 width;
  FAB pins bottom. DEBUNKED a suspected defect firsthand (the GUIDE's "agent HIGH findings are often false"
  discipline): the "Active Policies" section header vs the "Expired" badges looked contradictory, but they're
  TWO LEGITIMATE AXES — groupPoliciesByActive splits on `policy.isActive` (policy lifecycle: Active vs Inactive
  sections), while "Expired" is the per-TERM currency (the current term's date lapsed → the Renew affordance).
  An active policy with an expired current term is the correct, intended state. NOT a bug; no fix. /insurance is
  architecturally sound — DON'T re-audit it. (The mid-page dark New-Policy button in the desktop full-page shot
  is the known fixed-FAB capture artifact, not a render defect — same as prior eyes-on cycles.) No code changed;
  doc-only. cov: be 87.46% / fe 86.35% (~ — no test/code touched). NEXT feature cycle: still Angelo-gated
  (import-trackers + #148) → record parked + pivot, OR eyes-on another never-shot surface (the /financing
  populated render, or the recurring-expenses dashboard widget in a populated state).
- **C74 (deep-review)** — **Certified the CSV-import idempotency key `deriveImportClientId` FIELD-SENSITIVE +
  left a direct field-by-field guard (a load-bearing data-safety invariant, never directly tested).** Balance
  at C74: deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but less starved + its
  only spec work is Angelo-gated) → picked. SCOUTED two C67-suggested veins firsthand and found BOTH already
  well-guarded — DON'T re-audit: (a) the FE sync-manager conflict path — `determineConflictType` is directly
  pinned (sync-manager.test.ts:562-642: amount/tags/date match → duplicate, any diff → modified, epsilon
  boundary), (b) the CSV-import round-trip — import-csv.test.ts covers lossless round-trip, re-import idempotency
  (C211), two-identical-rows-both-import, BOM, date-only/out-of-range, #102 ambiguous-vehicle, #137 fuel-field
  clear, formula-injection. Found the genuine GAP inside (b): `deriveImportClientId` (the crown-jewel
  idempotency key — re-import = no-op, but two different rows must get distinct keys so both land) was
  module-PRIVATE with NO direct test; its field-sensitivity was only exercised transitively through round-trips
  that NEVER compare two rows differing in exactly one field. A future edit dropping a field from the `content`
  hash array (e.g. tags / missedFillup) → two rows differing only in that field hash-COLLIDE → the second
  silently dropped by createIdempotent's (userId, clientId) unique index → NORTH_STAR #1 data loss, INVISIBLE to
  every existing test. CERTIFIED firsthand all 11 content fields flip the key + determinism holds. DOCUMENTED
  NUANCE (characterized, not fixed — it's mitigated): the content joins tags with '' so `['a','b']`/`['ab']`
  share a tags-segment, BUT buildImportPlan's occurrence counter gives within-file collisions distinct
  occurrences → distinct final keys, so the "both import" contract holds within a single import (the only place
  two such rows coexist). GUARD: exported deriveImportClientId + new import-client-id-field-sensitivity.test.ts
  (+14): each distinguishing field flips the key; same content+occurrence → same key; different occurrence →
  distinct; null-vs-value differs; csv: prefix. Drives the REAL fn (not a re-impl — the C181/C229 theater
  lesson). NON-VACUOUS proved firsthand: dropping missedFillup from the content array → exactly that field's
  test RED with the "silently dropped → losing the user's data" diagnostic; restored → green. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1690 pass / 0 fail (+14),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard/cert add; import-csv was
  round-trip-covered, this pins the key's field-sensitivity a round-trip can't). Next deep-review: an eyes-on
  /insurance or /financing render sweep, or the backup EXPORT serialization round-trip.
- **C73 (guard)** — **Pinned the #94 skipConversion DISPATCH ORIENTATION across the C65/C69/C72 twins (the
  inversion footgun the C59 placeholder-scan doesn't cover).** Balance at C73: THREE over budget — feature
  (5/4, +1), deep-review (6/5, +1), guard (7/6, +1); guard most-starved (7) → picked. The C65/C69/C72 #94 work
  added a NEW dispatch pattern — 3 `skipConversion ? <pure> : this.buildConverted<X>(...)` ternaries
  (monthlyConsumption/seasonal/dayOfWeek) + 1 `if (skipConversion) <pure> else <converted>` (cross-vehicle
  comparison). VERIFIED the gap firsthand: the C59 source-scan pins the converted call never gets a unit
  PLACEHOLDER, but NOTHING pins the branch ORIENTATION — flip a ternary to `? converted : pure` (or an
  `if (!skipConversion)`) and a MIXED-unit fleet takes the raw-pooling PURE builder → #94 regression, INVISIBLE
  to same-unit fixtures (the only kind the builder tests use), so no behavioral test catches it. GUARD: new
  `skip-conversion-dispatch-orientation.test.ts` (+3): source-scans every skipConversion builder-dispatch
  (ternary + if/else forms), asserts the converted twin is on the FALSY/ELSE (conversion-needed) branch only.
  Filters OUT the per-point `skipConversion ? point.efficiency : convertEfficiency(...)` value-ternary inside
  the C64 generator (not a builder dispatch — neither branch names buildConverted). NON-VACUOUS proved firsthand
  BOTH forms: flipping the monthlyConsumption ternary → ternary test RED ("converted twin must be on the FALSY
  branch"); flipping the cross-vehicle if/else → if/else test RED ("...in the ELSE block") — each with its own
  diagnostic, the other staying green; restored → green. The arch/feature-creates-pattern→next-guard-pins lesson
  (C25/C45/C59 source-scan family; here C65/C69/C72→C73). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1676 pass / 0 fail (+3), build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only source-scan; pins an orientation a same-unit test
  can't). Next guard: thin — the convert-dispatch is now double-fenced (C59 placeholder + C73 orientation).
- **C72 (bug #94, dayOfWeekPatterns member)** — **Convert per-vehicle volume to user-global units BEFORE
  pooling the dayOfWeekPatterns avgVolume (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C72: four AT
  budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); bug has the lowest budget (tips first) + the most
  concrete actionable work (#94) → picked. Took the 5th unit-bearing #94 member (2nd of the 3 advanced builders).
  buildDayOfWeekPatterns sums each fillup's `volume` per weekday across ALL vehicles raw → a mixed gal+L fleet
  skews avgVolume. The C69 query-layer thread already put units in buildFuelAdvancedFromData's scope, so this was
  a straightforward twin (as C69 predicted). FIX (the C62/C65 volume pattern): added a
  buildConvertedDayOfWeekPatterns twin — isFillup-gated count + totalCost ($) UNCHANGED (unit-free); only the
  per-row volume converts via the C71 vehicleUnitsFor helper + convertVolume — switched at the call site by
  skipConversion. Exported DAY_NAMES from analytics-charts.ts for the twin (mirrors the C65 normalizeDate / C69
  SEASON_MAP exports). Updated the stale C69 comment (dayOfWeek no longer "remains raw"). GUARD: +1 mixed gal+L
  test driving getFuelAdvanced (Monday avgVolume 6.06 not the raw-pool 9.0; fillupCount 4 + avgCost $50
  unchanged). NON-VACUOUS proved firsthand: forcing the pure builder on the mixed fleet → 6.06→9.0 RED; restored
  → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new),
  1673 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ —
  analytics repo already well-covered; +1 mixed-unit guard). #94 PROGRESS: distance (C58) + volume-headline
  (C62) + monthlyConsumption (C65) + seasonalEfficiency (C69) + dayOfWeekPatterns (C72) DONE; REMAINING = 1
  advanced builder (buildVehicleRadar fuelEfficiency-normalize — the LAST, normalizes per-vehicle MPG across the
  fleet via normalizeScore, so it needs the gas points converted before the min/max normalize, a slightly
  different shape) + the prev-year SQL-sum sub-member (previousYearGallons).
- **C71 (arch)** — **Extracted the per-vehicle units fallback-lookup into ONE private helper across the 5
  analytics convert sites (behavior-preserving; the load-bearing default can't be silently dropped).** arch was
  the SOLE over-budget category (71−64=7/5, +2). Scouted the freshest churn surface first (the C65/C69 #94
  convert-twins) and REJECTED converging them — they're deliberately written to mirror their pure builders 1:1
  (the comments assert this; merging would destroy that auditability, arch rule 2) — and the 11-site
  `localeCompare` month-sort idiom has DIVERGING slices (−12/−24/−120) so it's not mergeable either. Found the
  genuine clean dedup: `vehicleUnitsMap.get(<id>) ?? { ...DEFAULT_UNIT_PREFERENCES }` was hand-repeated at 5
  per-vehicle convert sites (convertedGasEfficiencyPoints, computeConvertedTotalDistance ×2, the
  monthlyConsumption volume limb, the fuel-stats volumeInUserUnits closure, the cross-vehicle comparison).
  Extracted a private `vehicleUnitsFor(map, id)` → all 5 route through it. CONCRETE PAYOFF: the
  `?? {...DEFAULT_UNIT_PREFERENCES}` fallback is LOAD-BEARING — a missing-vehicle row without it throws on
  `.volumeUnit`/`.distanceUnit` at the convert call — so one source of truth means no site can silently drop it
  (and it stays a fresh clone per call, never a shared mutable default). Left the DIFFERENT-shape `getUserUnits`
  user-prefs fallback (`parsed ?? ...`, line 386) alone. Behavior-preserving (identical semantics); green→green
  (the #94 mixed-unit distance/volume/monthlyConsumption/seasonal guards + Property 11 conversion suite all pass
  unchanged). Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none
  new), 1672 pass / 0 fail (no test delta — a pure refactor), build bundled. Backend-only (no UI → no shot).
  cov: be 87.46% / fe 86.35% (~ — pure refactor, same lines covered). STANDING PATTERN: a bug cycle that threads
  a near-identical lookup into N convert sites (C58/C62/C65/C69 #94) seeds the next arch cycle to converge the
  shared sub-expression (sibling to C64's generator extraction). Don't re-scout the convert sites — single-sourced.
- **C70 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C63).**
  TWO over budget at C70 — infra (70−63=7/6, +1) and arch (70−64=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the
  intentional local overrides — left uncommitted by design). (2) COVERAGE RE-MEASURED (7 commits since C63):
  **BE 87.46% line / 87.18% func** (file-mean, 1672 pass — func +0.01 vs C63 from the C64 dedup + C65/C69 #94
  twins + C66/C67 guards); **FE 86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass — UNCHANGED, C64–C69
  all backend). Both at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1672 / FE 735.
  (4) BRANCH STATE: claude-loop-dev = **70 commits ahead** of fresh origin/main, PR-ready (category spread
  bug 17 / feature 14 / guard 11 / deep-review 11 / infra 9 / arch 7 — the 70th is the C1 loop-doc reset). The
  C68 eyes-on harness add (shot.mjs CLICK_TEXT) is gitignored, not in the count. Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C80.
- **C69 (bug #94, seasonalEfficiency member)** — **Convert per-vehicle gas-MPG to user-global units BEFORE
  pooling the seasonalEfficiency series (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C69: bug (4/3, +1)
  the ONLY over-budget category → picked. Took the 4th unit-bearing #94 member (the 1st of the 3 fuel-ADVANCED
  builders): `buildSeasonalEfficiency` averages each gas pair's RAW efficiency per season across ALL vehicles
  with no per-vehicle conversion → a mixed mi/gal + km/L fleet mixes the two on the seasonal chart. Unlike the
  monthlyConsumption member (C65, callable from buildFuelStatsFromData where units were in scope), the advanced
  builders live in buildFuelAdvancedFromData which fetched NO units — so this needed the QUERY-LAYER thread the
  C65 note flagged: getFuelAdvanced now fetches getUserUnits + getAllVehicleUnits + computes skipConversion, and
  buildFuelAdvancedFromData gained a (userUnits, vehicleUnitsMap, skipConversion) signature (its OTHER caller
  getSummary already had them in scope). FIX (the C58/C62/C65 + getCrossVehicle pattern): added a repository
  buildConvertedSeasonalEfficiency twin (fillupCount via isFillup — UNITLESS, unchanged; efficiency via the C64
  convertedGasEfficiencyPoints generator), switched at the call site by skipConversion. Exported SEASON_MAP from
  analytics-charts.ts for the twin's season bucketing (mirrors the C65 normalizeDate export). The pure builder
  stays for the common single-unit fleet (zero change). GUARD: +1 mixed mi/gal+km/L test in
  fuel-stats-fleet-distance-pooling.test.ts driving getFuelAdvanced (Winter avg 62.04 not the raw-pool 35;
  fillupCount 4 unchanged). NON-VACUOUS proved firsthand: forcing the pure builder on the mixed fleet → 62.04→35
  RED; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing
  warnings, none new), 1672 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% /
  fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). #94 PROGRESS: distance (C58) +
  volume-headline (C62) + monthlyConsumption (C65) + seasonalEfficiency (C69) DONE; REMAINING = 2 advanced
  builders (buildVehicleRadar fuelEfficiency-normalize + buildDayOfWeekPatterns volume — both now have units
  threaded into buildFuelAdvancedFromData, so each is a straightforward twin next bug cycle) + the prev-year
  SQL-sum sub-member (previousYearGallons).
- **C68 (feature — eyes-on FinanceTab lease render; #140 CONFIRMED + a NEW defect #148 escalated)** —
  Balance at C68: feature (7/4, +3) the lone most-starved over-budget category → picked. Import-trackers (the
  only open feature SPEC work) stays Angelo-gated (preset defaultCategory), so per the standing rule I took the
  shootable feature increment instead: a deep-UI eyes-on of the FinanceTab LEASE render — a surface CLAUDE.md
  flagged "stays eyes-on" + the home of the #140 "do it in a UI-work cycle / alongside a screenshot pass" item.
  Booted nothing (stack already up on :5173/:3001), minted auth, added a 30k odometer reading to the seeded e2e
  lease (Tesla Model 3, 36-mo/12k-yr), shot the Finance tab (extended the gitignored shot.mjs with a CLICK_TEXT
  arg since the tab state is client-side, not URL-driven), and **Read the PNG**. CONFIRMED #140 FIXED + consistent
  firsthand: the Mileage Overage card ("$0 · Within limit") and the burn-bar limit both use the WHOLE-LEASE 36,000
  allowance (leaseTotalMileageAllowance), no annual-vs-total contradiction. BUT eyes-on surfaced a NEW defect:
  **#148 — the LeaseMetricsCard burn bar reads "0 / 36,000 · 36,000 left" at a 30k odometer.**
  `calculateLeaseMetrics` gates `mileageUsed` on `initialMileage !== null`; a lease with no recorded starting
  odometer (the common case) leaves used=0, while the sibling PaymentMetricsGrid coalesces `initialMileage ?? 0`
  and computes used=30k → the SAME vehicle shows 30k driven on one card and 0 on the other (the #140 class on the
  null-initialMileage axis). It changes a displayed lease-mileage figure (semantics: coalesce to 0 / require an
  initial / show "set a starting odometer") → ESCALATED to Angelo, NOT auto-fixed (GUIDE product-call rule;
  send_message tool unavailable this turn → filed in BACKLOG as the durable record). Cleaned up the test odometer
  entry (DELETE /odometer/:id 200; fixture restored to its single 24k entry). Doc-only — no committable source
  (the shot.mjs CLICK_TEXT add is gitignored harness; no auto-fix). cov: be 87.46% / fe 86.35% (~ — no test/code
  change). NEXT feature cycle: still Angelo-gated (import-trackers defaultCategory + now #148) → record parked +
  pivot, OR eyes-on another never-shot surface (insurance/financing populated states).
- **C67 (deep-review)** — **Certified the sync-worker retry-ceiling coupling CLEAN + left a merge-surviving
  source-scan guard (a real unguarded cross-module invariant, NORTH_STAR #1 backoff honesty).** Balance at C67:
  deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but deep-review more starved by raw
  count) → picked. Per the C60 next-vein note (the sync-worker retry/backoff path), audited
  `backend/src/api/providers/sync-worker.ts` firsthand. The #144 terminal-auth fix (C461) parks a revoked-token
  ref at `MAX_RETRY_COUNT` so `photoRefRepository.findPendingOrFailed` (`retryCount < 3`) stops re-picking it —
  but those two `3`s are HAND-WRITTEN LITERALS in two different modules, coupled only by a code comment.
  CERTIFIED the runtime behavior is correct today (park at 3 → `3 < 3` false → dropped from the work set), and
  found the real GAP: nothing pins the coupling. If the query bound drifts (e.g. `< 5`) while MAX_RETRY_COUNT
  stays 3, a parked terminal-auth ref satisfies `3 < 5` → RE-PICKED every batch → a revoked token retried
  FOREVER (the #144 fix silently breaks), and the existing #144 test (which asserts the magic literal
  `retryCount: 3`) stays GREEN — blind to the drift. GUARD: exported `MAX_RETRY_COUNT` + new
  `sync-worker-retry-ceiling-sync.test.ts` (+3): imports the real constant, source-scans the repository's
  `${photoRefs.retryCount} < N` ceiling, asserts `N === MAX_RETRY_COUNT`. Also re-pointed the #144 test's magic
  `retryCount: 3` at the real constant. NON-VACUOUS proved firsthand: drifting the query bound to `< 5` → RED
  with the "DRIFTED... re-picked forever (#144 breaks)" diagnostic; restored → green. The one-edit→source-scan
  pattern (C25/C45/C59) applied to a CROSS-MODULE retry-ceiling invariant. Verify: backend validate:local GREEN
  — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1671 pass / 0 fail (+4), build bundled.
  Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard/cert add; sync-worker already
  behaviorally covered, this pins the cross-module coupling a single-module test can't). Next deep-review: an
  eyes-on /insurance or /financing render sweep, or the offline sync-manager conflict path (FE).
- **C66 (guard)** — **Pinned the C64 `convertedGasEfficiencyPoints` generator's gas/charge gate on the
  CONVERTED path (arch-extract→guard-pin; the #126/C427 footgun, currently invisible to every test).**
  Balance at C66: THREE over budget — feature (5/4, +1), deep-review (6/5, +1), guard (7/6, +1); guard is the
  most-starved (7) → picked. Per the C17→C18 / C50 standing pattern (a freshly-extracted shared helper gets a
  direct guard next cycle), the C64 generator now feeds 4 builders but had NO net for its gas-gate on the
  CONVERTED path. VERIFIED the gap firsthand: getFuelEfficiencyTrend's #126 test uses its OWN forEachVehiclePair
  loop (NOT the generator); Property 11 drives the converted consumers (getQuickStats/getCrossVehicle) but seeds
  GAS-ONLY rows — so a gate regression (revert gasEfficiencyPoint→computeEfficiencyPoint inside the generator,
  the exact #126/C427 footgun) would stay GREEN everywhere. GUARD (+1 in cross-vehicle.property.test.ts, next to
  the #126 sibling): a MIXED-unit (km/L vehicle, mi/gal user → skipConversion=false → the generator's CONVERT
  branch runs) PHEV fleet with gas fillups + charge sessions; asserts getQuickStats.avgEfficiency = the converted
  GAS pair alone (30 km/L → 70.57 mi/gal), charge mi/kWh excluded. NON-VACUOUS proved firsthand: reverting the
  generator's gate (with computeEfficiencyPoint imported) drops avgEfficiency 70.57 → 39.99 (the ~4 mi/kWh charge
  point mis-converted as mi/gal + averaged in) → RED on the exact value; restored → green. This is the WORSE half
  of #126 (convertEfficiency mis-converts mi/kWh as mi/gal), now pinned on the one path it can occur. Verify:
  backend validate:local — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1667 pass / 0 fail (+1),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only test add; generator
  already line-covered, this pins the BEHAVIOR). STANDING PATTERN reaffirmed: arch extracts a shared helper
  (C64) → next guard cycle pins it DIRECTLY against its load-bearing invariant (C66).
- **C65 (bug #94, monthlyConsumption member)** — **Convert per-vehicle volume + gas-MPG to user-global units
  BEFORE pooling the monthlyConsumption chart series (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C65:
  feature/deep-review/guard/bug all AT budget (4/4, 5/5, 6/6, 3/3); bug has the lowest budget (tips first) AND
  the most concrete actionable work (the #94 class), so it's the highest-leverage pick. Took the 4th of the 6
  #94 members: `buildMonthlyConsumption` (analytics-charts.ts) pools each fuel row's RAW `volume` into a month
  bucket AND averages each gas pair's RAW efficiency, both across ALL vehicles with no per-vehicle conversion —
  so a mixed gal+L / mi+km fleet sums litres into the gallons volume series + averages mi/gal with km/L on the
  FuelStats monthly chart. Chose it as the cleanest member: it's called from EXACTLY ONE site
  (`buildFuelStatsFromData`, which already has userUnits/vehicleUnitsMap/skipConversion in scope — no query-layer
  signature thread needed) and its efficiency limb REUSES the C64 `convertedGasEfficiencyPoints` generator (gas-gate
  + band filter stay identical/centralized). FIX (the established C58/C62 + getCrossVehicle pattern): added a
  repository `buildConvertedMonthlyConsumption` twin (per-row `convertVolume` + the C64 generator), switched at the
  call site by `skipConversion` — the common single-unit fleet still takes the pure builder (zero change), only a
  mixed fleet hits the twin. Mirrors buildMonthlyConsumption's structure EXACTLY (month-keyed volume map, the
  `if (entry)` volume-seeded-months-only efficiency guard, ascending sort, most-recent-12 slice) + uses the SAME
  `normalizeDate` (exported from analytics-charts.ts) so the seconds-vs-ms date contract is preserved. GUARD: +1
  mixed gal+L behavioral test in fuel-stats-fleet-distance-pooling.test.ts (series volume 42.64 not 50); the C59
  source-scan still passes (twin call uses real units, no placeholder). Verify: backend validate:local GREEN — tsc
  0, musl-biome clean (20 pre-existing warnings, none new), 1667 pass / 0 fail (+1), build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). #94
  PROGRESS: distance (C58) + volume-headline (C62) + monthlyConsumption (C65) DONE; REMAINING = 3 advanced builders
  (buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns — these live in buildFuelAdvancedFromData
  which fetches NO units, so they need a query-layer units thread, not just a twin) + the prev-year SQL-sum
  sub-member (previousYearGallons). Pick one per bug cycle, same convert-before-pool pattern.
- **C64 (arch)** — **Extracted the converted gas-MPG inner loop into ONE generator across the 3 per-vehicle
  efficiency builders (behavior-preserving, the #126/C427 gas-gate footgun centralized).** arch was the SOLE
  over-budget category (64−57=7/5, +2; all others within budget). Per the C57 watch-note (fresh duplication
  after C58/C61/C62 touched the analytics repository), scouted the convert-before-pool surface and found a
  real, clean dedup: `computeConvertedEfficiencyValues`, `buildConvertedEfficiencyTrend`, and
  `buildConvertedFuelEfficiencyComparison` each hand-rolled the SAME inner loop — `groupByVehicle` → fallback
  `vehicleUnitsMap.get(id) ?? {...DEFAULT_UNIT_PREFERENCES}` → `gasEfficiencyPoint` gate → `convertEfficiency`
  ternary — differing only in how they accumulate. That `gasEfficiencyPoint` gate IS the #119/#122 (C413) /
  #126 (C427) footgun: forget it on a new converted builder and a PHEV's charge mi/kWh contaminates the
  gas-MPG average (and convertEfficiency mis-converts it as mi/gal). EXTRACTED a private generator
  `*convertedGasEfficiencyPoints(fuelRows, vehicleUnitsMap, targetUnits, skipConversion)` yielding
  `{ vehicleId, efficiency, date }`; the three builders now consume the tuples (values push; trend month-buckets;
  comparison month×vehicle-buckets, called with skipConversion:false since it's the mixed-unit-only branch).
  Net −~40 LOC + the gas/charge gate now lives in ONE place — a future converted-efficiency builder physically
  CAN'T reintroduce the contamination (NORTH_STAR #6). Behavior-preserving + test-anchored: driven by
  analytics-units.property Property 11 (comparison), cross-vehicle.property #126 (trend gas-gate), and
  summary/year-end property (values + trend) — all GREEN unchanged. Verify: backend validate:local GREEN — tsc
  0, musl-biome clean (20 pre-existing warnings, none new), 1666 pass / 0 fail, build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — pure refactor, same lines covered via the same builders).
  STANDING PATTERN reaffirmed: a bug/feature cycle that threads a near-identical helper into N builders
  (C58/C62 #94 convert-before-pool) seeds the NEXT arch cycle to converge them (C22→C23, C37→C43, C51→C57,
  now C58/C62→C64). Don't re-scout this surface — the 3 converted-efficiency builders are now single-sourced.
- **C63 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C56).**
  TWO over budget at C63 — infra (63−56=7/6, +1) and arch (63−57=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design — note C61 added import-t6-manual-fuel-roundtrip.meshclaw
  .e2e.ts, correctly gitignored; the persistent `M .gitignore`/`M frontend/.gitignore` are the intentional
  local overrides). (2) COVERAGE RE-MEASURED (7 commits since C56): **BE 87.46% line / 87.17% func**
  (file-mean, 1666 pass); **FE 86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass) — both FLAT vs
  C56 (C57 dedup + C58/C62 #94 distance/volume + C59/C60 guards + C61 eyes-on were small targeted changes/
  test additions); FE UNCHANGED (C57–C62 all backend). Both at the ~87 BE / ~86 FE structural ceiling.
  (3) BOTH-SIDES GREEN: BE 1666 / FE 735. (4) BRANCH STATE: claude-loop-dev = **63 commits ahead** of fresh
  origin/main (C1–C62: 2 features COMPLETE + import-trackers manual-path fully eyes-on through T6 [detect-
  commit + the preset defaultCategory parked for Angelo]; category spread bug 15 / feature 13 / guard 10 /
  deep-review 10 / infra 8 / arch 6), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored.
  Doc-only — no source touched. cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C73.
- **C62 (bug #94, volume member)** — **Convert per-vehicle volume to user-global units BEFORE pooling the
  fleet fuel-stats volume + fillupDetails (Angelo-APPROVED Sev-2, NORTH_STAR #2).** bug was the SOLE
  over-budget category (62−58=4/3 +1; arch/infra AT). Cold-scout exhausted → top Angelo-approved item:
  the next #94 member after C58's distance (same approved convert-before-pool pattern, now guarded by
  C59). CONFIRMED FIRSTHAND: `buildFuelStatsFromData`'s `sumGallons` summed `row.volume` across ALL
  vehicles RAW (→ currentYear/currentMonth/prevMonth gallons) + the `volumes` array fed fillupDetails
  (avg/min/max) raw — so a mixed gal+L fleet pooled gallons with litres. FIX (mirror C58): added a local
  `volumeInUserUnits(row)` (skipConversion short-circuit, else `convertVolume(v, vehicleUnit, userUnit)`)
  + routed both sumGallons + the volumes array through it; the C58 fix already brought userUnits/
  vehicleUnitsMap/skipConversion into scope. No-op for a same-unit fleet (the common case → the C328
  same-unit pin stays green). EXPLICITLY SCOPED OUT: `previousYearGallons` is a raw SQL `SUM(volume)` from
  queryFuelAggregates (cross-vehicle, computed before this fn) — converting it needs a per-vehicle
  group-sum at the query layer, recorded as a separate prev-year sub-member. GUARD: +1 in
  fuel-stats-fleet-distance-pooling.test.ts — a mixed gal+L fleet reports 40 gal + 10 L→2.642 gal = 42.64,
  NOT raw 50, + fillupDetails min 5L→1.32 gal; updated the C328 same-unit pin's stale "update when the fix
  lands" note (still asserts 50 — no-op for same-unit). NON-VACUOUS (verified firsthand): neuter the
  conversion → ONLY the mixed-volume test RED (same-unit + distance green); reverted → 5/5 green,
  repository diff = only my change. Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1666 pass / 0 fail (+1), build bundled. Backend-only (FE charts already convert
  per-vehicle; summary scalar is the HTTP path → no shot). cov: be ~87.5% / fe 86.35%. #94 distance (C58)
  + volume (C62) members DONE; REMAINING: the 4 fuel-advanced builders (buildMonthlyConsumption /
  buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns) + the prev-year SQL-sum sub-member.
- **C61 (feature)** — **Import-trackers T6: consolidated manual-fuel round-trip on a same-unit vehicle
  (eyes-on DONE).** feature was the SOLE over-budget category (61−54=7/4, +3). Import-trackers is the only
  open feature; its remaining T4 is the parked-Angelo preset `defaultCategory` (stays parked), so the
  unblocked work is T6 (verify-phase, eyes-on now works). VERIFIED FIRSTHAND that the per-slice eyes-on
  already covered C31 detect-preview / C37 manual-map (a maintenance row commits; the fuel row errors on
  missing fields) / C41 manual-units (km→mi conversion) / C47 category-remap — but the COMMON real case was
  NEVER committed end-to-end: a complete, SAME-UNIT (mi/US-gallons) manual FUEL log. Did that. EYES-ON via
  `import-t6-manual-fuel-roundtrip.meshclaw.e2e.ts` + shot (Read): a bespoke fuel CSV with all fields mapped
  (date/amount/category/odometer/volume/fuelType/description) on a Miles vehicle, units left at the
  vehicle's defaults (Miles/Gallons-US → NO conversion) → "1 ready" → commit → the API confirms a `fuel`
  expense with EXACT mileage 42000 + volume 11.5 (no conversion drift). CAUGHT-MY-OWN harness bug: first run
  didn't map Memo→description so the unique tag never persisted + the row wasn't findable (the C41 lesson) →
  mapped description too → green. T6 MANUAL half is now fully eyes-on (C37/C41/C47/C61). T6 REMAINING is
  BLOCKED, not deferrable: the AUTO-DETECT PRESET round-trip THROUGH COMMIT can't be exercised — a detected
  preset maps NO category column → 0-ready "Unknown category" → nothing to commit (the C47 remap doesn't
  apply: no column = no word to remap). That's the parked `defaultCategory:'fuel'` Angelo decision (#C31);
  the four-state populated-detect screenshot is likewise gated on it. Verify: frontend validate:local GREEN
  — type-check 0, build OK, 735 tests. The e2e spec is gitignored-by-design (agent harness, not CI; the C54
  no-utc source-scan is the merge-surviving net) — this cycle's deliverable is the eyes-on confirmation +
  the spec tick. cov: be ~87.5% / fe 86.35% (~ — eyes-on capture, no module touched). Feature now has NO
  unblocked increment left (manual half fully verified; the detect-commit + 4-state shot both wait on
  Angelo's defaultCategory) — the next feature over-budget cycle should record that + pivot to the
  co-starved category.
- **C60 (deep-review)** — **Certified the `createProviderInstance` fake-provider production-safety gate
  CLEAN + pinned (a previously-unguarded layer).** deep-review was most-starved over budget (60−53=7/5 +2;
  feature +2 lost on raw starvation). Per the C53 pointer ("auth/provider path"), verified FIRSTHAND that
  the provider CREDENTIAL surface is ALREADY broadly guarded — formatProviderResponse omits credentials
  across GET/POST/PUT (providers-routes-http.test.ts:206 + the C260 PUT re-encrypt no-echo), config
  fail-fast (C416), tenant-scoping (#63), createProviderInstance's google-drive/photos/s3/unknown-type/
  missing-refreshToken branches (C254) — so did NOT re-audit them. Found the genuine gap: the `fake`
  storage-provider DOUBLE-GATE in createProviderInstance (registry.ts:217-221) was UNPINNED. It instantiates
  a FakeStorageProvider (in-memory, no bytes leave the process) ONLY when CONFIG.allowFakeStorageProvider is
  true (ALLOW_FAKE_STORAGE set AND NODE_ENV !== production), else throws — a `fake` row reaching production
  would silently swallow every backup/photo upload (NORTH_STAR #1 data-loss). The ROUTE-create gate is
  pinned, but this REGISTRY-instantiation gate (the layer restore/sync resolve a live provider through, NOT
  the route) had no test. CERTIFIED FIRSTHAND CLEAN: the test env is allowFakeStorageProvider=false (the
  prod-safety default), so a fake row → throws 'Fake storage provider is not enabled'; AND the gate
  short-circuits BEFORE decrypt (a fake row with garbage creds still throws the GATE error, not a parse
  error — proving the 217→224 ordering). GUARD: +2 in registry.test.ts — no CONFIG mock needed (the test
  env already has the gate off). NON-VACUOUS (verified firsthand): remove the gate → both RED; reverted →
  22/22 green, registry.ts byte-identical. Deep-review test-only — no app source touched. Verify: backend
  validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1665 pass / 0 fail (+2),
  build bundled. Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — pins the fake-gate; no
  module logic touched). The provider credential + instantiation path is now broadly certified; next
  deep-review: the sync-worker retry/backoff path, or an eyes-on /insurance render sweep.
- **C59 (guard)** — **Tree-wide source-scan pinning the C58 #94 convert-before-pool invariant.** THREE over
  budget at C59 — guard (59−52=7/6 +1), deep-review (6/5 +1), feature (5/4 +1); guard wins on raw starvation
  (7 > 6 > 5). The C58 #94 distance fix's footgun was `getFuelStats` feeding NO-OP PLACEHOLDERS (`new Map()`
  / `DEFAULT_UNIT_PREFERENCES` / hardcoded `skipConversion=true`) to `computeConvertedTotalDistance`,
  defeating the per-vehicle conversion — and the C58 behavioral test only covers getFuelStats' distance
  scalar, while 4 summary readers (getQuickStats/getYearEnd/getSummary/getFuelStats) call the convert
  helpers and the bug is INVISIBLE to a same-unit fixture. GUARD: new `no-unconverted-fleet-pooling.test.ts`
  (+3) source-scans repository.ts for any `computeConverted*`/`buildConverted*` call whose arg list contains
  the placeholder (new Map() / DEFAULT_UNIT_PREFERENCES / a `, true` literal skipConversion) → so a future
  reader (or the remaining #94 members) reintroducing the footgun regresses RED even if its same-unit tests
  pass. The one-edit-fix→source-scan pattern again (C24→C25 #36, C44→C45 #37, C54 import-date → now C58→C59
  #94). CAUGHT-MY-OWN regex bug: the first non-greedy `\(([^;]*?)\)` stopped at the nested `new Map()`'s
  first `)`, capturing `fuelRows, new Map(` and MISSING the placeholder (probe stayed green) → switched to a
  greedy `\(([^;]*)\)\s*;` (full arg list up to the statement `;`); re-probed. NON-VACUOUS BOTH WAYS
  (verified firsthand): the placeholder triple → RED; a lone hardcoded `, true)` skipConversion → RED; the 7
  legit `vehicleUnitsMap, userUnits, skipConversion` calls don't match (baseline green); reverted →
  3/3 green, repository byte-identical. Guard-only — app source untouched. Verify: backend validate:local
  GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1663 pass / 0 fail (+3), build bundled.
  Backend-only (source-scan → no shot). cov: be ~87.5% / fe 86.35% (~ — pure source scan, no module logic).
- **C58 (bug #94, distance member)** — **Convert per-vehicle distance to user-global units BEFORE pooling
  the fleet fuel-stats totalDistance (Angelo-APPROVED Sev-2, NORTH_STAR #2).** NOTHING strictly over budget
  at C58 (feature/deep-review/guard/bug all tied AT) → took the highest-leverage open item: #94, the
  biggest open correctness defect (a mixed mi+km / gal+L fleet shows garbage pooled scalars on the DEFAULT
  analytics view). #94 is a 6-member CLASS — too big for one verified increment — so did the contained,
  highest-impact, LOWEST-RISK member: the `distance.totalDistance` scalar (the fleet fuel-stats + summary
  headline). KEY FIRSTHAND FINDING: the conversion machinery ALREADY EXISTS and is tested
  (`computeConvertedTotalDistance` + `allVehiclesMatchUnits`, the getCrossVehicle model), but `getFuelStats`
  fed it NO-OP PLACEHOLDERS (`new Map()`, DEFAULT_UNIT_PREFERENCES, skipConversion=true) pending the #94
  decision — so the fix is purely ACTIVATING tested infra, not new math. FIX (Angelo's "convert-to-user-
  global BEFORE pooling, mirroring getCrossVehicle"): `getFuelStats` now fetches userUnits +
  getAllVehicleUnits + computes skipConversion=allVehiclesMatchUnits, threads them into buildFuelStatsFromData
  → computeConvertedTotalDistance (replacing the placeholders); getSummary's call site already had all three
  in scope (its summary distance was equally un-converted — also fixed). No-op for a same-unit fleet (the
  common case → existing same-unit characterization tests stay green). GUARD: +1 in
  fuel-stats-fleet-distance-pooling.test.ts — a MIXED mi+km fleet now reports 800 mi + 200 km→124.27 mi =
  924.27, NOT the raw 1000; flipped the C301 same-unit test's stale "update when the fix lands" note (it
  still correctly asserts 1000 — conversion is a no-op there). NON-VACUOUS (verified firsthand): revert to
  the placeholders → ONLY the mixed-unit test RED (same-unit green, proving the fix bites only a mixed
  fleet); reverted → 4/4 green, repository diff = only my change. Verify: backend validate:local GREEN —
  tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1660 pass / 0 fail (+1), build bundled.
  Backend-only (the FE chart already converts per-vehicle; the summary scalar's the HTTP path → no shot).
  cov: be ~87.5% / fe 86.35% (~ — the +1 pins the mixed-unit distance conversion). #94 distance member
  DONE; REMAINING #94 members (own cycles): volume (gal+L pooling in getFuelStats sumGallons +
  fillupDetails) + the 4 fuel-advanced builders (buildMonthlyConsumption / buildSeasonalEfficiency /
  buildVehicleRadar / buildDayOfWeekPatterns).
- **C57 (arch)** — **Dedup the C51 overwrite strip-and-update into one `applyLocalOverwrite` helper (the
  C51-created drift vector — a genuine fresh pick).** arch was the SOLE over-budget category (57−50=7/5,
  +2). Not a no-churn ceremony — found a real dup exactly where the standing lesson predicts (a bug/feature
  cycle introduces a near-duplicate → the next arch cycle dedups it; C22→C23, C37→C43): my own C51 #98 fix
  added `const { clientId, userId, ...patch } = data; return this.update(<id>, patch)` at TWO byte-identical
  sites in `createIdempotent` — the pre-check-collision branch + the raced-winner branch. Extracted ONE
  private `applyLocalOverwrite(rowId, data)` (the strip + update), called from both. Net +14/−10 (the 2
  inline blocks collapse). BEHAVIOR-PRESERVING (rule 4): green→green, the C51 +6 overwrite tests drive the
  helper via both call sites (19 pass across idempotent-create + expenses-http); the extraction even
  IMPROVES the raced branch (hard to hit deterministically) by routing it through the same tested code.
  Arch rule 3 (test-anchored): the C51 chars are the net — no new test needed. WORTHWHILE EXPLORATION
  (recorded honestly): probed whether the identity-key strip is load-bearing by trying to force a foreign-
  userId mutation — found it's UNREACHABLE through the public API (createIdempotent looks up by
  (data.clientId, data.userId), so when the overwrite branch runs data.userId already == the row's owner; a
  foreign userId misses the lookup + takes the create path). So the strip is DEFENSIVE-only; removed the
  misleading forcing-test (it asserted an unreachable state) + documented the finding in a code comment
  rather than pinning theater. Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1659 pass / 0 fail (pure refactor), build bundled. Backend-only (no UI → no shot).
  cov: be ~87.5% / fe 86.35% (~ — behavior-preserving dedup, LOC net down, one source of truth for the
  overwrite). Arch was NOT at its floor — the C51 fix created the drift; keep watching after bug/feature cycles.
- **C56 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C49).**
  TWO over budget at C56 — infra (56−49=7/6, +1) and arch (56−50=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are
  the intentional local overrides, NOT product changes). (2) COVERAGE RE-MEASURED (7 commits since C49):
  **BE 87.46% line / 87.18% func** (file-mean, 1659 pass); **FE 86.35% line / 87.68% func / 78.78% branch**
  (v8, 735 pass) — both essentially FLAT vs C49 (C50 dedup + C51 #98 + C52–C55 were test/small-guard
  additions; covered lines grew with the denominator); FE UNCHANGED (C50–C55 all backend). Both at the
  ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1659 / FE 735. (4) BRANCH STATE:
  claude-loop-dev = **56 commits ahead** of fresh origin/main (C1–C55: 2 features COMPLETE + import-trackers
  through T6's date-guard slice C54; category spread bug 13 / feature 12 / guard 9 / deep-review 9 / infra 7
  / arch 5), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C66.
- **C55 (bug #22)** — **Zip-bomb compression-ratio cap pre-inflation (Angelo-APPROVED Sev-4 hardening).**
  bug was the SOLE over-budget category (55−51=4/3 +1; arch/infra AT). Cold-scout exhausted → top
  unfinished Angelo-approved item; the Sev-1/2/3 are done or gated (#94 6-member class; #127/#100 arch-gated;
  #112 design-gated), so took the contained, clean Sev-4 #22 ("cheap, no new dep"). CONFIRMED FIRSTHAND:
  `parseZipBackup` (backup.ts) summed each entry's `header.size` (uncompressed) and rejected over
  maxUncompressedSize — but `header.size` is read from the ZIP central directory = ATTACKER-DECLARED. A bomb
  can declare a small size to pass the sum, then inflate to GB on `getData()`. FIX (Angelo's "compression-
  ratio cap pre-inflation"): added `CONFIG.backup.maxCompressionRatio = 1000` + a per-entry guard that
  rejects when `header.size / header.compressedSize > cap` BEFORE any getData() — `compressedSize` is the
  REAL in-file byte count, so an absurd declared-vs-actual ratio is a bomb signature the sum can't catch
  (DEFLATE's ~1032:1 ceiling makes 1000× generous for legit CSV ~3-20× / repetitive headers a few hundred×).
  compressedSize 0 (empty/stored entry) skipped. Probed AdmZip firsthand to confirm `header.compressedSize`
  exists. GUARD: +2 in restore-zip-bomb.test.ts (#22 block): an entry UNDER the total-size cap but over the
  ratio cap → rejected (only the ratio guard can catch it); a real exported backup's every-entry ratio is
  under the cap + parses through both guards (no false positive). NON-VACUOUS (verified firsthand): neuter
  the ratio guard → the isolated-ratio test RED; reverted → 4/4 green, backup.ts diff = only my +17.
  CAUGHT-A-SIDE-EFFECT: the pre-existing all-zeros total-size test (200MB zeros = 1029× ratio) now trips the
  EARLIER ratio guard → updated its assertion to accept either pre-inflation guard's message (both mean
  "bomb rejected before inflating"; the total-size guard stays the backstop for a declared-size lie with a
  plausible ratio). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing
  warnings; my 1 new noNonNullAssertion refactored away), 1659 pass / 0 fail (+2), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — the +2 pin the ratio guard; FE untouched).
  #22 DONE. Remaining Angelo Sev-4: #129 (OAuth email-sync, re-read archive first), #79 (stuck-offline-entry
  hygiene), #112 (chart palette, design-gated); plus #94 (6-member class, its own cycle).
- **C54 (feature)** — **Import-trackers T6: merge-surviving no-utc guard for the CSV-import date paths.**
  feature was the SOLE over-budget category (54−47=7/4, +3). Import-trackers is the only open feature; its
  remaining T4 piece is the Angelo-gated preset `defaultCategory` (PARKED — awaiting steer), so the
  unblocked work is T6 (verify-phase) — and the spec/GUIDE explicitly flag "extend the no-utc guard to cover
  import-mapping.ts." Took that. CONFIRMED FIRSTHAND: `normalizeForeignDate` (C19-certified clean) builds a
  date-only foreign value in LOCAL time via `buildLocalDate(year, month, day, …)` — NEVER `new Date('YYYY-
  MM-DD')` (parses as midnight UTC → rolls the calendar day BACK west of UTC, the #23/#59/#87 class). The
  behavioral net (import-mapping.test.ts: normalize→parse-back→local Y/M/D across iso/mdy/dmy/epoch in any CI
  zone) already exists, but only exercises today's paths; a future `buildLocalDate`→`new Date(string)` swap
  or a new write site could slip past. GUARD: new `no-utc-import-date.test.ts` (+3) source-scans
  import-mapping.ts / local-date.ts / import-csv.ts for a Date built from (a) a date-only quoted literal OR
  (b) a `${y}-${m}-${d}` template (a `}` before a date separator — the frontend no-utc-month-parse idiom),
  + pins that import-mapping still routes through buildLocalDate. The C24→C25 / C44→C45 one-edit-fix→
  source-scan pattern, now for the import date path. NON-VACUOUS BOTH WAYS (verified firsthand): injected the
  template antipattern → RED; injected a quoted-literal `new Date(datePart + '-01')` + `new Date('2024-03-
  15')` → RED; the 2 KNOWN-CORRECT sites (`new Date(ms)` epoch, `new Date(s)` for an explicit-offset ISO) do
  NOT false-flag (baseline green); reverted → 3/3 green, import-mapping.ts byte-identical. CAUGHT-MY-OWN: my
  first regex only matched quoted literals (digits after the quote), MISSING the template form — the likeliest
  refactor antipattern; split into literal + template matchers + re-probed both. Marked spec T6 `[~]`
  (date-guard slice done; the consolidated eyes-on multi-state round-trip E2E remains — each slice's eyes-on
  already landed C31/C37/C41/C47). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1657 pass / 0 fail (+3), build bundled. Backend-only (source-scan → no shot). cov:
  be ~87.5% / fe 86.35% (~ — pure source scan, no module logic touched). Feature now has NO unblocked
  increment left but T6's consolidated E2E + the parked `defaultCategory`; next feature cycle likely records
  that + pivots.
- **C53 (deep-review)** — **Certified `buildTCOMonthlyTrend` (the TCO monthly cost series) CLEAN + pinned
  the (category, sourceType) bucketing.** deep-review was most-starved over budget (53−46=7/5 +2; feature
  +2 lost on raw starvation, 6/4). Verified firsthand that the two C46-suggested money builders are ALREADY
  guarded — `buildAmortizationSchedule` (amortization-schedule.test.ts: decline/rise, payoff-clamp,
  multi-loan, no-mutate, negative-am) AND its caller `buildLoanBreakdown` incl. the #139 0%-APR-survives
  case (analytics-routes-http.test.ts drives the real GET over a raw-seeded 0% loan) — so did NOT re-scan
  them. Found the genuine gap: `buildTCOMonthlyTrend` (analytics-charts.ts:1020) — the per-month TCO SERIES
  the chart renders — had NO direct test (driven only transitively via getTCO; the C6/C18/C46 "helper output
  never pinned" gap). CERTIFIED FIRSTHAND CLEAN: buckets by (category, sourceType) — financial+financing→
  financing, financial+insurance_term→insurance, fuel→fuel, maintenance→maintenance (the TIME-dimension
  mirror of categorizeTCOExpenses, cert C33); an UNCATEGORIZED row (financial+reminder from C27 recurring /
  financial+null manual / regulatory / enhancement / misc) contributes to NO bucket (the deliberate
  "4 named categories only" trend contract — those route to otherCosts in the TOTAL but the trend doesn't
  surface them); same-month co-accumulate; ascending month-key sort; dateless row dropped. GUARD: +6 in
  tco-monthly-trend.test.ts. NON-VACUOUS (verified firsthand): dropping the financing sourceType guard
  (any financial row leaks into financing) → 3 of 6 RED; reverted → 6/6 green, analytics-charts.ts
  byte-identical. Deep-review test-only — no app source touched. Verify: backend validate:local GREEN —
  tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1654 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — pins the TCO trend series; no module
  logic touched). The TCO money path (total bucketing C33 + this trend series) is now broadly certified;
  next deep-review: a genuinely different surface (an eyes-on /insurance or /financing render sweep, or the
  auth/provider path).
- **C52 (guard)** — **Pin the C51 #98 overwrite path ∩ #76 fuel-field hygiene (a REAL invariant, not
  framework theater).** THREE over budget at C52 — guard (52−45=7/6 +1), deep-review (6/5 +1), feature
  (5/4 +1); guard wins on raw starvation (7 > 6 > 5). Scouted the freshest unguarded surface = the C51
  `forceOverwrite` flag. FIRST drafted two negative-invariant guards (flag never persisted / PUT strips it)
  but PROVED THEM VACUOUS firsthand: leaking forceOverwrite into the insert still passed (drizzle silently
  drops unknown insert keys; Zod strips unknown parse keys) — those are framework-guaranteed, so pinning
  them is coverage theater (the GUIDE's C181/C229 warning). DROPPED them. Pinned instead the genuinely
  load-bearing invariant: the C51 keep-local overwrite re-runs the create route's clearFuelFieldsIfNotFuel
  (body) BEFORE the idempotent UPDATE, so a resolved edit that switches a fuel row to a non-fuel category
  must NULL the existing row's stale volume/mileage/fuelType (the #76 class on the NEW overwrite branch — a
  lingering mileage poisons getCurrentOdometer cross-category). The C51 tests only changed the amount; this
  exercises the category-switch leg. GUARD: +1 HTTP-harness case (expenses-http.test.ts): seed a fuel
  expense w/ volume+mileage+fuelType → keep-local overwrite to maintenance → same row id, category flipped,
  all 3 fuel fields NULLED. NON-VACUOUS (verified firsthand): neuter the overwrite-update (return existing)
  → the case RED; reverted → green, repository byte-identical. Guard-only cycle — app source untouched
  (only the test file changed). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1648 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be
  ~87.5% / fe 86.35% (~ — pins the #98∩#76 overwrite-path invariant; no module logic touched). LESSON
  re-confirmed: a guard that a framework already guarantees is theater — drive the REAL app logic.
- **C51 (bug #98)** — **Real PUT-on-collision overwrite so sync-manager keep-local applies the offline edit
  (Angelo-APPROVED Sev-3 data-loss).** NOTHING strictly over budget at C51 (feature/deep-review/guard/bug
  all tied AT) → took the highest-leverage open item. #94 (Sev-2) is a genuine 6-builder multi-file analytics
  sweep (better as its own scoped effort, possibly a design pass) → took the contained, single-seam Sev-3
  #98, a NORTH_STAR #1 data-loss path. CONFIRMED FIRSTHAND: sync-manager `resolveConflict('keep_local')`
  re-POSTs with `forceOverwrite: true` + the local clientId, but (a) `createExpenseSchema` Zod-STRIPPED the
  unknown flag and (b) `createIdempotent` returned the existing (userId, clientId) row UNCHANGED — so on a
  GENUINE clientId collision the user's resolved offline edit was silently discarded. FIX (Angelo's "real
  PUT-on-collision/upsert"): (1) `createExpenseSchema.extend({ forceOverwrite: z.boolean().optional() })`
  (create-only, NOT on update); (2) the POST route separates the control flag from the row data (kept out
  of the insert) + threads it to the repo; (3) `createIdempotent(data, overwrite=false)` — on a collision
  with overwrite, UPDATEs the existing row with the local data, stripping clientId/userId from the patch so
  the identity + idempotency keys stay immutable; default false keeps the plain-retry no-op EXACTLY as
  before (the existing "retry returns original unchanged" test still passes). The race-recovery path honors
  the same overwrite contract on the re-read winner. GUARD: +4 repo cases (idempotent-create.test.ts:
  overwrite updates in place / identity immutable / default no-op unchanged / overwrite-on-absent =
  plain-create) + +2 HTTP-harness cases (expenses-http.test.ts: the REAL route applies the edit WITH the
  flag, no-ops WITHOUT — proves the schema no longer strips it). NON-VACUOUS (verified firsthand): neutering
  the overwrite branch → the 3 overwrite-applying tests RED, the no-op cases stay green; reverted → green,
  repository.ts diff = only my change. Updated the FE sync-manager comment + the stale "#98 not a real
  overwrite" characterization test to the now-real behavior (the wire contract — POST forceOverwrite +
  clientId — is unchanged + still asserted). The FE conflict-resolution path is eyes-on/Playwright-blocked
  (offline + conflict-dialog state); the end-to-end overwrite is covered by the HTTP-harness (the real
  route) — the right merge-surviving net for this seam, no shot feasible. Verify: backend validate:local
  GREEN (tsc 0, musl-biome 0 errors / 20 pre-existing warnings, 1647 pass / 0 fail, +6, build bundled) +
  frontend validate:local GREEN (type-check 0, build OK, 735 tests). cov: be ~87.5% / fe 86.35% (~ — the +6
  pin the overwrite path; FE comment/test-only). #98 DONE. Next Angelo: Sev-2 #94 (the fleet-unit-pool
  class, its own cycle) or the Sev-4 hardening (#100/#22/#129/#112/#79).
- **C50 (arch)** — **Dedup the split-config vehicleId extraction into ONE exported `splitConfigVehicleIds`
  (a genuine fresh pick — 3 hand-copies across 2 domains).** arch was the SOLE over-budget category
  (50−43=7/5, +2). Not a no-churn ceremony — found a real, clean dedup the prior scouts (C4/C6/C12/C36)
  hadn't covered: the `config.method === 'even' ? config.vehicleIds : config.allocations.map((a) =>
  a.vehicleId)` extraction was hand-copied at THREE sites — `expenses/routes.ts` (a LOCAL un-exported
  `splitConfigVehicleIds`, the split-ownership loop), `expenses/repository.ts` `validateVehicleOwnership`,
  and `reminders/validation.ts` `refineSplitConfig` (the split-vs-vehicleIds match check). FIX: lifted ONE
  exported `splitConfigVehicleIds(config)` into expenses/validation.ts (where `SplitConfig` lives +
  reminders/validation already imports splitConfigSchema from it), typed on the MINIMAL structural shape
  so BOTH `SplitConfig` AND the DB-layer `ReminderSplitConfig` satisfy it with no cross-import; de-dupes
  via Set (matching the callers' prior `[...new Set(ids)]`). Routed all 3 sites through it (routes drops
  its local copy; repo + reminder validator drop their inline ternaries). BEHAVIOR-PRESERVING (rule 4):
  the reminder validator wraps the result in `new Set(...)` exactly as before (helper returns a de-duped
  array → same set); the existing split-validation + reminder-validation + expense-ownership suites stayed
  green (142 pass across the affected files). Arch rule 3 (pin the newly-shared helper): +4 direct unit
  cases (split-config-vehicle-ids.test.ts — even/absolute/percentage extraction + the dedup) since it was
  a local un-exported helper with no direct net (the C17→C18 / C23 arch-extract→guard-pin pattern, in one
  cycle). NON-VACUOUS (verified firsthand): breaking the helper's even branch → 3 of 4 RED; reverted →
  green, validation.ts diff = only the +19-line helper. CAUGHT-MY-OWN: my first test passed bare object
  literals with `amount`/`percentage` → tsc excess-property error against the minimal param shape; typed
  the fixtures as `SplitConfig` (how callers actually use it) → green. Verify: backend validate:local GREEN
  — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1641 pass / 0 fail (+4), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — behavior-preserving dedup, LOC net down
  at the 3 sites, +4 pin the shared helper; FE untouched). Arch was NOT at its floor this cycle — a real
  cross-domain dup existed; keep scouting fresh modules, not the saturated C4/C6/C12 surfaces.
- **C49 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C42).**
  TWO over budget at C49 — infra (49−42=7/6, +1) and arch (49−43=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). Warranted on substance (the C42 projection was ~C52, but the budget forces it now and
  real modules accrued): C44 atomic-swap + C46 insurance-trend guard + C47 dialog markup + C48 #88
  prune-helper since C42. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the
  gitignored `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M
  frontend/.gitignore` are the intentional local overrides — NOT product changes). (2) COVERAGE
  RE-MEASURED (7 commits since C42): **BE 87.47% line / 87.17% func** (file-mean, 1637 pass); **FE 86.35%
  line / 87.68% func / 78.88% branch** (v8, 735 pass) — BE UP vs C42 (line 87.33→87.47, func 86.97→87.17
  from the C44/C46/C48 added covered lines); FE line/func flat, branch +0.10 (C47 markup; helper logic
  already covered). Both still at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1637 /
  FE 735. (4) BRANCH STATE: claude-loop-dev = **49 commits ahead** of fresh origin/main (C1–C48: 2 features
  COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4 through the category-remap table
  C47; category spread feature 11 / bug 11 / guard 8 / deep-review 8 / infra 6 / arch 4), PR-ready;
  recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe
  86.35% (MEASURED). NEXT cadence ~C59.
- **C48 (bug #88)** — **Prune a deleted vehicle from reminders' expenseSplitConfig blob (Angelo-APPROVED
  Sev-3 data-integrity).** bug was the SOLE over-budget category (48−44=4/3 +1; arch/infra AT). Cold-scout
  vein exhausted → took the top unfinished Angelo-approved item by severity: #88 (Sev-1 #36/#37 done,
  #127 arch-rule-6-gated; #94 is a 6-member multi-builder sweep better as its own cycle → took the
  contained, single-write-path #88). CONFIRMED FIRSTHAND: a reminder's `expenseSplitConfig` is a JSON blob
  (text mode:'json'), NOT FK-managed like the reminder_vehicles junction (onDelete:cascade). When a vehicle
  is deleted the junction cascades but the blob still NAMES the dead vehicleId, so the next trigger's
  `createExpenseFromReminder` builds a split sibling for that dead id (createSiblings inserts by the BLOB's
  vehicleIds, not the junction) → FK violation that (C151 async-tx footgun) leaves the surviving legs
  half-committed — a partial/inconsistent expense group every trigger. Same #88/#97 vehicle-delete family;
  #97 (junction→zero-vehicles) was closed C40, this is the blob sibling. FIX (Angelo's "drop+renormalize /
  single-vehicle fallback"): new pure `pruneVehicleFromSplitConfig(config, deletedId)` in
  split-config-helpers.ts — drops the leg (even: from vehicleIds; absolute: keep remaining fixed amounts,
  total shrinks honestly; percentage: drop + RESCALE survivors back to 100%, even-fallback when survivors
  sum 0); returns null when <2 legs remain (caller clears the blob → single-vehicle junction path) or the
  SAME ref when the id was absent (no-op skip). New `reminderRepository.pruneSplitConfigsForDeletedVehicle
  (userId, deletedId)` loads the user's split-config reminders, prunes each, writes back (clears to null on
  collapse). Wired into the vehicle-delete route BEFORE deactivateVehicleless (so a collapsed blob's
  now-vehicleless reminder is still caught by #97/C40). GUARD: +8 pure cases (prune-split-config.test.ts:
  all 3 methods, the rescale-to-100, the 0-sum even fallback, the <2 collapse, the absent no-op) + +4
  HTTP-harness cases (vehicle-delete-cascade.test.ts #88 block: even drop, percentage <2 collapse→null,
  3-way percentage rescale-to-100, unrelated-reminder untouched). NON-VACUOUS (verified firsthand): disabling
  the route's prune call → 3 of the 4 HTTP #88 tests RED (the no-op case correctly stays green); reverted →
  12/12 + 8/8 green, routes.ts diff = only my 6-line change. Verify: backend validate:local GREEN — tsc 0,
  musl-biome 0 errors (20 pre-existing warnings; my 2 new noNonNullAssertion warnings refactored away),
  1637 pass / 0 fail (+12), build bundled. Backend-only (no UI → no shot). cov: be ~87.3% / fe 86.35% (~ —
  the +12 pin the new prune helper + route path; FE untouched). #88 DONE — the #88/#97 vehicle-delete
  reminder-orphan family is now closed (junction C40 + blob C48). Next Angelo Sev-2 = #94 (fleet-unit-pool
  class, its own cycle) or Sev-3 #98 (PUT-on-collision upsert).
- **C47 (feature)** — **Import-trackers T4: category-remap table for unrecognized category words (eyes-on
  DONE).** feature was most-starved over budget (47−41=6/4 +2; bug sat AT 3/3, not over). Import-trackers
  is the only open feature; its remaining unblocked T4 piece was the category-remap table (the
  `defaultCategory` preset gap stays parked-for-Angelo, T6 e2e is verify-phase). REAL gap: when a foreign
  CSV's category column carries a word VROOM doesn't recognize, `mapCategory` falls it back to `misc` +
  surfaces it in the preview's `unmappedCategories` (D2 "never invent"), but the dialog had NO UI to remap
  it — so the user couldn't rescue a mis-categorized import without editing the CSV. FIX: when a preview
  surfaces `unmappedCategories`, render an "Unrecognized categories" panel — one row per word + a
  VROOM-category `Select` (reusing the canonical `categoryLabels` from expense-helpers, NOT a reinvented
  list — NORTH_STAR #4). Assigning a word folds into `buildMapping`'s `categoryMap` (merged OVER any
  preset's own map, user choices win; manual path sends categoryMap only once ≥1 word is assigned) +
  re-previews, so the word resolves, drops out of the list, and its rows re-categorize. State reset on
  dialog-close + on re-detect (no stale remap bleed). EYES-ON CONFIRMED via
  `import-category-remap.meshclaw.e2e.ts` + 2 PNGs (Read): a bespoke CSV with `Type=servicing` → the
  "Unrecognized categories" panel renders (amber, CircleAlert) → map servicing→Maintenance → panel
  disappears + "1 ready" + "Import 1 row" enabled → committed row imported as `maintenance` (NOT the misc
  fallback, verified via API). Remap trigger got `data-testid="remap-category-{word}"`. Verify: frontend
  validate:local GREEN — type-check 0, build OK, 735 tests pass. cov: be ~87.3% / fe 86.35% (~ — UI-markup
  cycle, the categoryMap round-trip is backend-covered at T1/T3; FE store/util layer untouched). T4 REMAINING:
  only the Angelo-gated preset `defaultCategory` (the remap table does NOT cover it — a detected preset maps
  no category COLUMN, so there's no word to remap; that's the parked missing-column decision) + T6 e2e.
- **C46 (deep-review)** — **Certified the insurance `monthlyPremiumTrend` month-bucketing CLEAN + guarded
  + fixed a latent test-harness epoch bug.** deep-review was most-starved over budget (46−39=7/5 +2;
  feature +1 lost on raw starvation). Per the standing notes (C39/C33/C26 all point to an unaudited
  surface), verified firsthand that the two recurring candidates are ALREADY well-guarded — the
  sync-manager conflict path (determineConflictType 4-way + resolveConflict 3-outcome + #98 char + retry
  backoff/cap + #121 + #134 orphan-no-resurrect) and the insurance premium MATH (effectiveMonthlyPremium /
  monthKeysInRange both directly unit-pinned; getInsurance totals/#8/#50/#25/#14/#51/contract all certified)
  — so didn't re-scan them. Found the genuine gap: `monthlyPremiumTrend` — the per-month premium SERIES the
  analytics tab's trend chart renders, built from `accumulateMonthlyPremiums`→`monthKeysInRange` — was
  driven ONLY transitively through getInsurance; NO test asserted the month-by-month bucketing (the C6/C18
  "helper output never pinned" gap on a money-facing series). CERTIFIED FIRSTHAND CLEAN: a term contributes
  its monthly premium to EACH spanned month (day-1 anchored, inclusive both ends); overlapping policies SUM
  in shared months; a totalCost-only term spreads its AMORTIZED monthly value per-month (matching the
  totals path) — all correct against source. GUARD (+3 in insurance-details.test.ts). NON-VACUOUS (verified
  firsthand): making accumulateMonthlyPremiums add once-then-break → the EACH-month + overlap tests RED;
  reverted → 17/17 green, repository byte-identical. FIRSTHAND HARNESS FINDING (recorded in-file): the
  file's shared `term()` helper inserts raw MILLISECONDS via direct SQL, but insurance_terms.start/end are
  Drizzle `mode:'timestamp'` (SQLite stores SECONDS; the real repo writes via the ORM which ÷1000) — so
  seeded term dates read back ~1000× too large (year ~55970). The PRODUCTION path is CLEAN (the route uses
  the ORM); the pre-existing tests never caught the harness bug because they're date-INDEPENDENT (monthlyCost
  flows straight through; the totalCost test asserts only >0) — the trend is the first date-DEPENDENT
  assertion. Added a local `termSeconds` seed matching the real storage contract; left the shared `term()`
  untouched (changing it risks the date-relative #14/#25/latest-term tests — a separate harness cleanup if
  ever warranted). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing
  warnings), 1625 pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be ~87.3% / fe
  86.35% (~ — insurance analytics already covered; +3 pin the trend series; FE untouched).
- **C45 (guard)** — **Tree-wide source-scan guard for the C44 #37 backup-atomicity invariant.** Two over
  budget (guard 45−38=7/6 +1, deep-review 45−39=6/5 +1); guard wins the tie on raw starvation (7 > 6). The
  C44 #37 atomic-swap is a HIGH data-safety fix whose regression risk is a ONE-EDIT revert — a future
  refactor reintroducing a `values.clear()` on a live sheet (the clear-then-write footgun), or adding a new
  unsafe write site — and the C44 fake-seam test only drives the single staging path that exists today
  (same gap the C24→C25 #36 source-scan closed). GUARD: new `sheets-atomic-backup.test.ts` (+4) scans
  google-sheets-service.ts for the three structural properties the atomicity rests on: (1) ZERO
  `.values.clear(` calls (the atomic design removed clearing entirely — staging tabs are born empty; a
  clear-then-write revert is the exact #37 footgun), (2) the staging+swap mechanism is present
  (`SHEET_STAGING_SUFFIX` constant + `deleteSheet`/`updateSheetProperties` in the commit batch), (3) the
  staging suffix is SPACE-FREE (it's interpolated UNQUOTED into A1 ranges `${title}${suffix}!A1` → a space
  silently corrupts every staging write's range). NON-VACUOUS (verified both ways firsthand): reintroducing
  a `values.clear` call → the clear test RED with the data-loss diagnostic; a spaced suffix → the
  space-free test RED; both reverted → 4/4 green, service file byte-identical to HEAD. Mirrors the
  established source-scan idiom (sheets-raw-value-input #36, no-utc-date-input). Source-scan > untracked
  e2e for merge survival (GUIDE); the one-token/one-edit-fix→source-scan pattern again (C24→C25, now
  C44→C45). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings),
  1622 pass / 0 fail (+4), build bundled. Backend-only (pure source scan → no shot). cov: be ~87.3% / fe
  86.35% (~ — pure source scan, no module logic touched; pins the #37 atomicity contract tree-wide).
- **C44 (bug #37)** — **Atomic Google Sheets backup: stage-then-swap (Angelo-APPROVED Sev-1 data-safety).**
  bug was the SOLE over-budget category (44−40=4/3, +1). The cold-scout vein is exhausted (C6/C10/C15/C20),
  so took the top unfinished Angelo-approved item by severity — #37 (HIGH, the only actionable open Sev-1:
  #36 done C24, #127 is arch-rule-6-gated). CONFIRMED FIRSTHAND: `updateSheet` did per-sheet `clear()` THEN
  `update()`, and the 15 sheets ran under one `Promise.all` — so a failure mid-run (429 / network / process
  death) left a TORN backup: some sheets rewritten, the one mid-write EMPTIED by its own preceding clear,
  the rest stale, on what may be the user's ONLY copy (NORTH_STAR #1 silent data-loss). FIX (Angelo's
  ratified mechanism — write to temp sheets, then copy-then-promote/swap): new `writeAllSheetsAtomically` —
  (1) STAGE every table into a fresh `${title}__vroom_staging` tab (live canonical sheets untouched; any
  staging failure → clean up the temp tabs + rethrow, prior backup fully intact), (2) COMMIT one atomic
  `batchUpdate` that deletes the old canonical sheets + renames each staging tab to its canonical title AND
  sets its `index` to the canonical position (Sheets applies a batchUpdate all-or-nothing → a reader sees
  the whole old OR whole new backup, never a mix; the index keeps tab ORDER stable across backups). Dropped
  the per-sheet `clear()` entirely (staging tabs are born empty). The `tables` array had to be reordered to
  match SHEET_NAMES (Odometer before Photos) since the swap now derives each tab's index from its array
  position — caught by the create-tab-order test (good pin). HARNESS: taught the fake's `batchUpdate` to
  honor `deleteSheet`/`updateSheetProperties(title,index)` (extracted `applyAddSheet`/`applyDeleteSheet`/
  `applyRenameSheet`/`applyBatchRequests` to keep cognitive-complexity under the biome cap) + a MONOTONIC
  `nextSheetId` (real Sheets never reuses ids; `sheets.length` would collide after a delete+rename cycle on
  the 2nd backup). GUARD (+2 in google-sheets-service.test.ts, the #37 net): a values.update 429 during a
  RE-backup → the prior backup reads back byte-identical (Toyota still there, not torn/emptied) + no
  `__vroom_staging` tabs leak + tab order == SHEET_NAMES; a successful re-backup replaces the data (2
  vehicles) with stable tab order. NON-VACUOUS (revert to clear-then-write → the failure case reads torn).
  Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1618 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). #37 DONE — the Sheets-backup Sev-1 pair
  (#36 C24 + #37 here) is now closed; the remaining Sev-1 #127 is arch-rule-6 design-gated. cov: be ~87.3%
  / fe 86.35% (~ — Sheets service already fake-seam-covered; +2 pin the atomicity invariant; FE untouched).
- **C43 (arch)** — **Dedup the duplicated target-vehicle picker in ImportExpensesDialog into a shared
  `{#snippet}` (the C37-created drift vector — a genuine fresh pick).** arch was the SOLE over-budget
  category (43−36=7/5, +2; bug sat AT 3/3, not over). Unlike the C4/C6/C12/C36 no-churn scouts, there was
  a REAL pick exactly where the standing lesson predicts (a feature cycle copies markup into a component →
  the NEXT arch cycle dedups it; C15→C17, C22→C23): the C31 preset-path target-vehicle picker (the
  detected-tracker banner) and the C37 manual-path target-vehicle picker were near-byte-identical ~22-line
  blocks — same bound `targetVehicleId` + `handleTargetVehicleChange`, same `Select.Root`/trigger/Content/
  `#each vehicles` + empty-state, differing ONLY in the trigger `id`, wrapper class, and empty-state copy.
  Verified firsthand there's no existing shared vehicle-picker component and `{#snippet}` is an established
  idiom here (used across ~15 components). FIX: extracted ONE local `{#snippet targetVehiclePicker(triggerId,
  emptyText)}` at the top of the dialog content + `{@render}`'d it at both sites; each KEEPS its own wrapper
  `<div>` (the manual one's `border-t pt-3` separator + the preset one's plain `space-y-1.5` legitimately
  differ — arch rule 1, converge only the truly-identical inner control). Net −17 LOC (46 del / 29 add).
  A local snippet, NOT a new shared file — the picker binds this component's `targetVehicleId`/handler, so
  lifting it out would force a prop-drilling seam for zero reuse elsewhere (rule 1/5). BEHAVIOR-PRESERVING
  confirmed eyes-on (rule 4, UI-touching): booted fresh (RESET_DB) + ran BOTH picker-path specs GREEN —
  import-mapping-detect (preset picker: Fuelly auto-detect → pick vehicle → preview) +
  import-manual-units (manual picker: km/litres log → pick vehicle → committed row converted 160.9344 km→
  100 mi end-to-end). Read the manual-editor PNG: the "Map your columns" editor + all field/date/unit
  dropdowns render pixel-identical. No characterization test needed beyond these (the snippet is pure
  markup; the 3 e2e specs ARE the merge-surviving net, and the C38 helper tests pin the logic). Verify:
  frontend validate:local GREEN — type-check 0, build OK, 735 tests pass. cov: be 87.33% / fe 86.35% (~ —
  markup-only dedup, no module logic touched; FE coverage was just MEASURED C42). Arch was NOT at its floor
  this cycle — the C37 feature created the drift; keep watching for this after eyes-on features.
- **C42 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C35).**
  TWO over budget at C42 — infra (42−35=7/6, +1) and arch (42−36=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). Warranted on substance, not just the counter: 7 cycles since C35 incl. C38's NEW
  `import-mapping-helpers.ts` vitest module + C39/C40 BE tests + C37/C41 FE markup. (1) UNTRACKED-TEST
  SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored `*.meshclaw.e2e.ts` agent-harness
  specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the intentional local
  overrides that keep `.meshclaw-tools/`/`mise.local.toml`/the e2e specs ignored — NOT product changes,
  left uncommitted by design so the PR stays harness-free). (2) COVERAGE RE-MEASURED (7 commits since C35):
  **BE 87.33% line / 86.97% func** (file-mean, 1616 pass); **FE 86.35% line / 87.68% func / 78.78% branch**
  (v8, 735 pass) — BOTH sides UP vs C35 (BE line 87.29→87.33 from C39/C40's added covered lines; FE
  86.14→86.35 line / 87.31→87.68 func / 78.70→78.78 branch from the C37/C41 dialog markup + C38's new
  helper module). Both still at the ~87 BE / ~86 FE structural ceiling; treat as the floor. (3) BOTH-SIDES
  GREEN: BE 1616 / FE 735. (4) BRANCH STATE: claude-loop-dev = **42 commits ahead** of fresh origin/main
  (C1–C41: 2 features COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4 manual path
  DONE through unit pickers C41; category spread feature 10 / bug 9 / guard 7 / deep-review 7 / infra 5 /
  arch 3), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.33% / fe 86.35% (MEASURED). NEXT cadence ~C52.
- **C41 (feature)** — **Import-trackers T4: manual-mapping unit pickers (eyes-on DONE; #NS2 fix).** Nothing
  strictly over budget (infra/arch/feature tied AT 6/6,5/5,4/4); took the highest-leverage item — feature's
  only open work (import-trackers) had a genuine UNBLOCKED correctness gap from my own C37: the manual
  column-mapping path never set the file's units, so a manually-mapped METRIC log imported raw km/litres
  into a miles/gallons vehicle (CONFIRMED FIRSTHAND: applyMapping's mapMileage/mapVolume convert ONLY when
  both the file's unit AND the target's unit are known — import-mapping.ts:245/229; manual buildMapping set
  neither). FIX: added Odometer-unit + Volume-unit pickers to the manual editor (shown only when those
  columns are mapped), defaulting to the target vehicle's units (= no-conversion baseline, re-seeded on
  vehicle change); buildMapping sends distanceUnit/volumeUnit only when the matching column is mapped → the
  server converts into the vehicle's units. EYES-ON via `import-manual-units.meshclaw.e2e.ts` + 2 shots
  (Read): a km/litres log fully mapped via the per-field dropdowns + units set to Kilometers/Liters →
  committed row CONVERTED 160.9344 km→100 mi, 37.854 L→~10 US gal (verified via API — the #NS2 proof).
  Added `data-testid`s to the manual field/unit Select triggers for deterministic e2e targeting (the
  dropdowns render all headers as options, so bits-ui listbox selectors needed a stable hook). DEBUG: the
  CSV headers first matched the Fuelio preset (odo+litres) → switched to non-preset headers; long-form unit
  labels (Kilometers/Liters) not short; row identified by converted mileage (Memo wasn't mapped to
  description). Verify: frontend validate:local GREEN — type-check 0, build OK, 735 tests. cov: be 87.29% /
  fe 86.14% (~ — UI-markup cycle; conversion path backend-covered T1). T4 REMAINING: a category-remap table
  for unknown category WORDS; the Angelo-gated preset defaultCategory; T6 round-trip e2e.
- **C40 (bug #97)** — **Auto-deactivate a reminder left vehicleless by a vehicle delete (Angelo-APPROVED
  Sev-3).** bug was the sole over-budget category (40−36=4/3). Sev-1 design-doc-gated + #94 is a class →
  took the clean approved Sev-3 orphan #97 (cleaner than its #88 sibling, which mutates the split-config
  JSON blob). CONFIRMED FIRSTHAND: `reminder_vehicles.vehicleId` is onDelete:cascade (schema:217), so a
  vehicle delete drops the junction rows but the reminder ROW survives — a reminder linked to ONLY that
  vehicle is left is_active=1 with ZERO vehicles, which processReminder skips 'no_vehicles' (trigger-service
  :441) every run forever, a silent never-firing orphan still shown active. FIX (Angelo's agreed
  deactivate): new `reminderRepository.deactivateVehicleless(userId)` — a LEFT JOIN reminders↔
  reminder_vehicles WHERE isActive AND junction isNull → bulk set isActive=false; called in the vehicle-
  delete route AFTER `vehicleRepository.delete`. GUARD: flipped the pre-existing #97 CHARACTERIZATION test
  (it pinned the buggy is_active=1/'no_vehicles' state, explicitly as a "red→green anchor for the eventual
  fix") to the fixed behavior + added a multi-vehicle case (NOT over-deactivated — keeps its remaining
  vehicle). NON-VACUOUS: removing the deactivateVehicleless call turns the single-vehicle test RED
  (is_active stays 1) while the multi-vehicle stays green. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1616 pass / 0 fail, build bundled. Backend-only (no UI → no shot; the deactivation
  surfaces via the existing reminders list). cov: be 87.29% / fe 86.14% (~ — vehicle-delete + reminder repo
  already covered; the new method + flipped test pin the orphan fix). NOTE: #88 (the SPLIT-config-blob
  sibling — prune the deleted vehicleId from a reminder's expenseSplitConfig JSON) is still OPEN; same
  family, more involved (JSON renormalize + the C151 async-tx footgun on the surviving leg).
- **C39 (deep-review)** — **Certified the OAuth-state CSRF consume CLEAN + replaced brittle source-scans
  with a behavioral guard.** deep-review was the sole over-budget category (39−33=6/5). Per the C33 note
  (TCO money path certified), picked the next UNAUDITED surface: the auth/OAuth path. Audited the
  highest-stakes invariant — the `oauthStateStore` single-use CSRF token across login/link/provider flows.
  CERTIFIED FIRSTHAND (scratch probe): the state consume is CLEAN — single-use (replay rejected),
  flow-isolated (a login state ≠ link/provider state), anti-fixation (a mismatched/unknown state is DELETED
  on the failed lookup), null-safe. BUT the only existing coverage (auth-routes.property.test.ts) was
  BRITTLE SOURCE-STRING SCANS — it asserts the validator body CONTAINS `storedData.flowType`/`'auth-link'`,
  which would pass even if the logic were inverted and pins NO actual behavior. GUARD: extracted the
  single-use+flow-isolation logic into a pure `consumeOAuthState(store, stateParam, expectedFlow)` in
  auth/utils.ts (the C38 "untestable-in-place → pure module" pattern); routed the two simplest validators
  (login/link) through it (the provider `resolveProviderState` keeps its own inline consume — it adds a
  PKCE codeVerifier assertion — same contract, left untouched to bound risk). +9 BEHAVIORAL cases
  (consume-oauth-state.test.ts: single-use/replay, 3-way flow isolation, anti-fixation delete, null-safe);
  replaced the 2 obsolete source-scans with thin wiring checks (validator delegates with the right flow
  arg). Behavior-preserving — the 3 existing auth property suites stay green. Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean, 1615 pass / 0 fail (+7 net), build bundled. Backend-only (no UI → no
  shot). cov: be 87.29% / fe 86.14% (~→UP — the CSRF consume logic is now unit-covered where it was only
  string-scanned). NOTE: #129 (OAuth login email-sync, MED, filed C433) also lives on this path — still a
  product call (don't sync / sync-if-unset / notify), NOT auto-fixed.
- **C38 (guard, arch-extract→pin in one cycle)** — **Extract + pin the C37 manual-mapping pure helpers.**
  Nothing strictly over budget (guard + deep-review tied AT 6/6 + 5/5); took the highest-leverage item via
  the standing pattern (a feature cycle that adds logic seeds the next guard cycle — C22→C23, C31→C32). C37
  buried three PURE functions inside ImportExpensesDialog.svelte where vitest can't reach them
  (`.svelte` <script>): the CSV header split+dequote, the native-export detection that gates the manual
  editor, and the auto-guess needle map. EXTRACTED them to a new pure `src/lib/utils/import-mapping-helpers
  .ts` (`parseCsvHeaders` / `isNativeImportHeaders` / `guessManualColumns`, no Svelte/DOM deps) + rewired
  the dialog to import them (the inline `NATIVE_HEADERS` const + inline `guessManualColumns` removed).
  BEHAVIOR-PRESERVING (the C37 e2e stays green — extraction moved code, didn't change rendering). GUARD: new
  import-mapping-helpers.test.ts (+9): header parse (quotes/whitespace/empty), native-superset detection
  (gates the editor), and the guess needle sets — INCLUDING the C37 eyes-on additions (spent/paid/total→
  amount, kind→category) a bespoke export needed to preview. NON-VACUOUS: dropping the spent/paid/total
  needles turns the C37-needles case RED; restored → 9 pass. Verify: frontend validate:local GREEN —
  type-check 0, build OK, 735 tests pass (+9, 65 files). cov: be 87.29% / fe 86.14% (~→UP — the extracted
  helpers are now FE-unit-covered where they were unreachable inside the component; re-measure next infra
  cadence ~C45).
- **C37 (feature)** — **Import-trackers T4: manual column-mapping path for unrecognized CSVs (eyes-on
  DONE).** feature was the sole over-budget category (37−31=6/4). The Angelo-gated fuel-preset
  `defaultCategory` piece (flagged C31) stays parked, so took the genuinely UNBLOCKED T4 work: the manual
  column-mapping editor. When detection finds no preset AND the file isn't a native VROOM export
  (headers ⊉ date/vehicle/category/amount), the dialog renders "Map your columns" — a per-field dropdown
  for each VROOM field (date*/amount* required + category/vehicle/mileage/volume/fuelType/description/tags)
  populated from the file's own headers, a date-format picker, and the target-vehicle picker (shown only
  when no vehicle column is mapped, D4). `guessManualColumns` auto-maps by header-name substring (incl.
  spent/paid/total→amount, kind→category from C37 eyes-on); `buildMapping` drops unmapped fields → the
  EXISTING preview/commit runs verbatim. A native export still imports with NO mapping (unchanged path).
  EYES-ON via `import-manual-mapping.meshclaw.e2e.ts` + 2 shots (Read): a bespoke CSV (Transaction Date/
  Spent/Kind/Notes) → editor with guessed mappings (Amount→Spent, Category→Kind, Description→Notes) →
  after picking Daily Driver, "1 ready · 1 row needs attention" (the maintenance row imports; the fuel row
  correctly errors "fuel rows require fuel amount and mileage" — I didn't map volume/mileage). DEBUG: the
  first run's "Spent" header wasn't auto-guessed (only amount/price/cost) → added spent/paid/total + kind;
  a strict-mode `/ready/` selector matched 2 nodes → scoped to the commit button + `.first()`. Verify:
  frontend validate:local GREEN — type-check 0, build OK, 726 tests. cov: be 87.29% / fe 86.14% (~ —
  UI-markup cycle; the mapping data path is backend-covered T1-T3 + C32). T4 REMAINING: unit override
  pickers + a category-remap table; the Angelo-gated preset defaultCategory; T6 round-trip e2e.
- **C36 (arch-scout → no-churn → bug #85)** — **Arch at its structural floor (4th confirm); pivoted to the
  #85 relabel (Angelo-APPROVED Sev-2).** Two cats over budget (arch 6/5, feature 5/4 — tie on over-by);
  arch wins on raw starvation (6 > 5). SCOUTED firsthand for a clean dedup: (1) my C34 `effectiveTermCost`
  vs `effectiveMonthlyPremium` are DUALS, not duplicates — inverse precedence (premium: monthlyCost wins,
  amortize totalCost DOWN; termCost: totalCost wins, multiply monthlyCost UP) + opposite direction;
  converging would distort one (arch rule 2 PROHIBITS). (2) The source dup-markers all point to
  ALREADY-deduped sites (C200 date-key, the day-offset switch). (3) Route-handler ownership+respond is the
  natural Hono idiom with shared validators. **Recorded no churn warranted (4th confirm after C4/C6/C12).**
  PIVOTED to the highest-leverage UNBLOCKED item — feature's only open item (import-trackers) has its
  highest-value piece (defaultCategory:'fuel') ANGELO-GATED (flagged C31), so took the clean approved
  Sev-2 bug #85. FIRSTHAND: getFuelStats computes "currentYear" as `fuelRows.filter(isFillup).length` over
  the ENTIRE requested range, and `prevYearAgg` queries `[range.start − rangeWidth, range.start]` (the
  prior EQUAL-LENGTH window) — so the two "year" fields are RANGE-relative (current range vs prior equal
  period), NOT calendar years; under the default 'all' range "This Year" = all-time fill-ups, mislabeled.
  FIX (Angelo's agreed cheap relabel, NOT re-implement calendar math): FuelStatsTab "This Year"/"Last Year"
  → "This Period"/"Last Period" (4 labels across the Fill-ups + Liters cards); the calendar "This/Last
  Month" rows UNCHANGED (true calendar post-#86/C262). EYES-ON via fuel-stats-period-labels.meshclaw.e2e.ts
  + shot (Read `/tmp/c36-fuel-stats-period-labels.png`): cards show This Period/Last Period, no This/Last
  Year, This Month intact. Verify: frontend validate:local GREEN — type-check 0, build OK, 726 tests. cov:
  be 87.29% / fe 86.14% (~ — label-only UI change, no vitest module touched).
- **C35 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C28).**
  infra was the sole over-budget category (35−28=7/6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked
  `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` agent-harness specs are by-design). (2) COVERAGE
  RE-MEASURED (6 commits since C28): **BE 87.29% line / 86.97% func** (file-mean); **FE 86.14% line / 87.31%
  func / 78.70% branch** (v8, 726 tests) — BE line ticked UP vs C28's 87.22 (C29/#51 + C33/TCO-bucket +
  C34/#69 added covered lines in analytics + insurance); FE FLAT (C29-C34 were all backend cycles + the C31
  FE-dialog markup hit no new vitest module). Both at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES
  GREEN: BE 1608 / FE 726. (4) BRANCH STATE: claude-loop-dev = 35 commits ahead of fresh origin/main (C1-C34:
  2 features COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4-slice, 4 bug [#147/#30/
  #36/#51/#69 minus dupes], 4 deep-review, 4 guard, 3 arch, 3 infra), PR-ready; recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.29% / fe 86.14% (MEASURED). NEXT
  cadence ~C45.
- **C34 (bug #69)** — **Materialize a monthly-only insurance term into TCO (Angelo-APPROVED Sev-2).** bug
  was the sole over-budget category (34−29=5/3). Sev-1 (#37/#127) are design-doc-gated (arch rule-6), #94
  is a 6-member class → took the clean money-facing Sev-2 #69, on fresh C33 TCO context. CONFIRMED
  FIRSTHAND: `createTermExpenses` (hooks.ts) only materialized an expense when `totalCost > 0`, so a
  monthly-only term (monthlyCost set, no totalCost) created NO `insurance_term` expense row → it showed in
  analytics (`getInsurance`→`effectiveMonthlyPremium` honours monthlyCost) but was ABSENT from TCO's
  insuranceCost bucket (which sums those rows, C33-certified). FIX (Angelo's agreed `monthlyCost ×
  term-months`): extracted `effectiveTermCost(term)` in hooks.ts — `totalCost` when present, else
  `monthlyCost × monthKeysInRange(start,end).length` (the SAME inclusive month count
  effectiveMonthlyPremium amortizes a totalCost over → symmetric). createTermExpenses/updateTermExpenses
  compute via it; the 3 route call sites now pass monthlyCost+endDate + always call the hook (it no-ops on
  0). NO DOUBLE-COUNT: analytics reads term.monthlyCost directly, never the materialized rows. GUARD: +2 in
  premium-expense-hook.test.ts (monthly-only term → rows sum to monthlyCost×13 [2024-01-01→2025-01-01 = 13
  inclusive month-keys]; explicit totalCost still wins, no costed-path regression). NON-VACUOUS: reverting
  effectiveTermCost to totalCost-only turns the monthly test RED (0 rows). Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean, 1608 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot).
  cov: be 87.22% / fe 86.14% (~ — insurance hook + the materialization path now pinned for the monthly
  shape).
- **C33 (deep-review)** — **Certified the TCO `categorizeTCOExpenses` sourceType-bucketing CLEAN + left a
  money-facing guard.** deep-review was most-starved (33−26=7/5 > bug 4/3). Per the C19/C26 note
  (backup/restore/import/analytics swept), audited the highest-stakes UNAUDITED money path: the per-vehicle
  TCO categorization (NORTH_STAR #1). The #27/#28 financing-vs-purchase-price accounting is well-pinned
  (per-vehicle.property all-time + year arms), but a subtle seam was UNPINNED: `categorizeTCOExpenses`
  buckets a `financial` row by sourceType — `'financing'`→financingInterest, `'insurance_term'`→insurance,
  and ANY OTHER `financial` row (sourceType `'reminder'` from a recurring expense [C27], or null from a
  manual financial entry) falls through to otherCosts. Recurring-expenses (C27) now materializes exactly
  `financial`+`'reminder'` rows, so this seam is live. CERTIFIED FIRSTHAND (scratch probe): reminder/null
  financial → otherCosts (150), NOT financingInterest (200 = only the financing row); insurance 75; total
  425 = sum. CLEAN. GUARD: +2 cases in per-vehicle.property.test.ts — (1) the 4-way sourceType split
  (financing/insurance_term/reminder/null → correct buckets); (2) the DANGEROUS case: a PRICED vehicle with
  a reminder financial row keeps it in otherCosts ($30100 total), because a mis-bucket to financingInterest
  would make computeTCOTotal EXCLUDE it (#27 principal-retiring) → silently dropping a real recurring cost.
  NON-VACUOUS: dropping the `sourceType==='financing'` clause (bucket by category alone) turns BOTH RED
  (the PRICED case shows otherCosts 100→0, the silent-drop). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1606 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22%
  / fe 86.14% (~ — analytics repo already covered; +2 pin the money-facing bucketing seam). The TCO money
  path (financing/purchase-price #27/#28 + sourceType bucketing) is now broadly certified — next
  deep-review should pick a genuinely different surface (an eyes-on /insurance sweep, or the auth path).
- **C32 (guard)** — **Characterize the C31 import-preset category gap end-to-end (the standing
  bug-finding→next-guard pattern).** Two cats over budget (guard 7/6, deep-review 6/5 — tie on over-by);
  guard wins on raw starvation (7 > 6). The C31 eyes-on surfaced a concrete, unguarded invariant: the
  built-in fuel presets map NO category column, so a detected fuel log maps + resolves the vehicle but
  buildImportPlan errors EVERY row "Unknown category" → readyCount 0 (the presets import nothing today).
  The EXISTING round-trip test (import-mapping.test.ts) hand-ADDS a `category:'Type'` column + categoryMap
  to its mapping, so it tests a hypothetical mapping, NOT the REAL `MAPPING_PRESETS` — the gap was
  unpinned. GUARD: +2 cases in import-mapping-presets.test.ts driving all 3 real presets through
  presetToMapping → applyMapping → buildImportPlan: (1) NONE map a category column (the root); (2) each
  currently yields readyCount 0 / errorCount 1 / message matches /category/ (the end-to-end consequence).
  Verified the exact behavior firsthand via a scratch probe first (native CSV has a blank category cell →
  `Unknown category ""`). NET-FLIPPING by design: when the flagged fix (defaultCategory:'fuel' per preset)
  lands, the category expectation flips to 'fuel' + readyCount to N — these are the tests to update, and
  they're documented as such. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1604 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.14% (~ — import-mapping
  modules already covered; +2 pin the preset gap as a characterization net).
- **C31 (feature)** — **Import-trackers T4: auto-detect + target-vehicle mapping step (eyes-on DONE;
  preset gap flagged).** Nothing strictly over budget (guard/deep-review/feature all tied AT); took the
  highest-leverage open item — import-trackers is the ONLY remaining open feature (the other two DONE), and
  its mapping step is genuine net-new product UI. Scoped ONE coherent slice (not the whole dialog): the
  AUTO-DETECT path. Added `vehicles` prop to ImportExpensesDialog (already loaded on /expenses); on
  file/paste it splits the header row + calls `detectImportSource` → if a Fuelly/Fuelio/Drivvo preset
  matches, renders a "Detected a <Tracker> fuel log" banner + a target-vehicle picker (KEY firsthand fact:
  NO preset maps a `vehicle` column — these are single-vehicle fuel logs, so D4 requires picking one;
  auto-selects the only vehicle), builds the `ImportColumnMapping` from preset+vehicle, and threads it
  through the EXISTING preview/commit verbatim. A native VROOM export detects null → unchanged path
  (backward-compatible). EYES-ON via `import-mapping-detect.meshclaw.e2e.ts` + shot (Read
  `/tmp/c31-import-mapped-preview.png`): banner + picker render, "Daily Driver" auto-selected.
  EYES-ON CAUGHT A REAL PRESET GAP (firsthand, NOT a UI defect): the fuel presets map no category column +
  `mapCategory` leaves a blank category blank (the D2 "never invent a category" rule), so a detected fuel
  log previews **0-ready / "Unknown category"** — the presets are unusable end-to-end. This is a product/
  data-contract call (default a column-less fuel import to `category:'fuel'` vs the D2 rule) → send_message'd
  Angelo recommending option (a) defaultCategory:'fuel' per preset (a backend-preset change, a future cycle),
  did NOT auto-fix. The T4 UI slice stands on its own. Verify: frontend validate:local GREEN — type-check 0,
  build OK, 726 tests. cov: be 87.22% / fe 86.14% (~ — UI-markup cycle; the detect/map data path is
  backend-covered T1-T3). T4 REMAINING: the manual per-field column editor + category-remap table + the
  flagged preset defaultCategory.
- **C30 (arch)** — **Extract the canonical `SHEET_NAMES` tab roster (a real fresh dedup, not a no-churn
  scout).** arch was the sole over-budget category (30−23=7/5). No pick was pre-seeded, so scouted firsthand
  + found a GENUINE C161-class drift vector: the 15-tab Sheets roster was hand-copied across 4 sites (the
  literal `'Reminder Notifications'` appears 4×) — `createSpreadsheet` (initial tabs) + `ensureRequiredSheets`
  (backfill) are PURE title lists, while `updateSpreadsheetWithUserData` (write fan-out) +
  `readSpreadsheetData` (read ranges) pair each title with table-specific logic. Extracted ONE exported
  `SHEET_NAMES` const (the ordered 15-tab roster) and routed the two PURE-roster sites through it
  (`create` → `SHEET_NAMES.map(...)`, `ensure` → `SHEET_NAMES.filter(...)`); left the logic-paired
  write/read lists inline (converging those is riskier — arch rule 1, ONE small reviewable refactor).
  BEHAVIOR-PRESERVING: same titles, same create order → existing spreadsheets unaffected; proven by
  strengthening the create test to assert `info.sheets === [...SHEET_NAMES]` exactly (was a loose
  contains+length-15). Arch rule 3: +2 drift guards in sheets-header-coverage.test.ts (SHEET_NAMES is 1:1
  with the SHEET_HEADERS table count; entries distinct + non-empty) — so adding a 16th table forces a
  matching roster entry, closing the drift the extraction targets. Caught a TS literal-tuple type error
  (`as const` makes `.length` the literal `15`) → widened to `number` for the comparison. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean, 1602 pass / 0 fail (+2), build bundled. Backend-only (no
  UI → no shot). cov: be 87.22% / fe 86.14% (~ — same module, LOC down, one source of truth for the tab
  roster). NOTE: #37 (Sheets atomicity) remains the top Sev-1 — still arch rule-6 (design.md + Angelo), NOT
  taken as a churn-pick this cycle since a genuine clean dedup was available.
- **C29 (bug #51)** — **Exclude term-less active policies from `activePoliciesCount` (Angelo-APPROVED Sev-2).**
  Two cats over budget (bug 5/3 +2, arch 6/5 +1); bug is most-starved → forced. Skipped the top Sev-1 #37
  (Sheets atomicity) — it's a tx-semantics change to the crown-jewel backup write path = arch rule-6
  (design.md + Angelo first, like the sibling #127), NOT a clean bug increment. Took the top CLEAN approved
  Sev-2: #51. FIRSTHAND CONFIRMED the bug in `getInsurance` (analytics/repository.ts): a TERM-LESS active
  policy contributes $0 to premium totals (`buildInsuranceDetails` does `if (!latestTerm) continue`), yet
  `activePoliciesCount = activePolicies.length` counted it → the headline showed "N active policies" beside
  premiums summed over FEWER (internal inconsistency). FIX (Angelo's agreed approach): count only active
  policies that have ≥1 term — `activePoliciesWithTerms = activePolicies.filter(p => policyIdsWithTerms
  .has(p.id))`, the SAME has-a-term predicate the premium path gates on (set built from termRows, so an
  inactive policy's terms can't leak — the filter is over activePolicies only). GUARD: +3 cases in
  insurance-details.test.ts (term-less-not-counted-beside-a-termed-one; termed-still-counted [no
  over-exclude]; lone-term-less→0+$0). NON-VACUOUS: reverting to `activePolicies.length` turns 2 of the 3
  RED; restored → 14 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1600 pass / 0
  fail (+3), build bundled. Backend-only (analytics repo; the displayed count is pinned precisely by the
  unit test — no UI logic changed). cov: be 87.22% / fe 86.14% (~ — analytics repo already covered; +3 pin
  the count-consistency contract).
- **C28 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C21).**
  Two cats over budget (infra 7/6, bug 4/3 — tie on over-by); infra is the most-starved (7 > 4) → forced.
  (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts`
  agent-harness specs are by-design; the committed regression net is the unit + HTTP-harness + source-scan
  suites). (2) COVERAGE RE-MEASURED (7 commits since C21): **BE 87.22% line / 86.97% func** (file-mean);
  **FE 86.14% line / 87.31% func / 78.70% branch** (v8, 726 tests) — BE flat vs C21, FE marginally UP on
  all three (the C22 split-form types + C23 buildSplitConfig +5 tests added covered lines; C24/C25 added
  Sheets-service tests on already-covered modules; C26/C27 were eyes-on/e2e). Both at the ~87 BE / ~86 FE
  structural ceiling. (3) BOTH-SIDES GREEN: BE 1597 / FE 726. (4) BRANCH STATE: claude-loop-dev = 28
  commits ahead of fresh origin/main (C1-C27 + the C0 reset: 5 feature [2 features now COMPLETE:
  maintenance C1, recurring-expenses C27], 2 bug [1 dry] + 2 dry-scouts, 3 deep-review, 3 guard, 2 arch,
  3 infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.22% / fe 86.14% (MEASURED). NEXT cadence ~C38.
- **C27 (feature)** — **Recurring-expenses T8: full round-trip E2E (eyes-on DONE → FEATURE COMPLETE).**
  feature was the sole over-budget category (27−22=5/4). Picked recurring-expenses T8 (closes the whole
  feature) over the import-trackers dialog (a larger net-new arc). Wrote `recurring-expense-roundtrip
  .meshclaw.e2e.ts` (gitignored harness) exercising the full feature-DoD chain: create a SPLIT recurring
  expense (2 vehicles, even, $100, overdue Oct–Dec 2024) → `POST /reminders/trigger` → one sibling per
  vehicle per overdue month, each `sourceType:'reminder'` + `expenseAmount:50` (even split) + template tag
  → delete the source → rows SURVIVE unlinked (T3 clearSource: history kept, source nulled). EYES-ON (Read
  `/tmp/c27-roundtrip-badged-expenses.png`): /expenses renders the ⟳ Recurring badge (C9) on a
  reminder-sourced row + the ⑂ Split badge on the collapsed 2-vehicle group ($200 total). DEBUGGING (real
  firsthand findings, all harness — NOT product bugs): (1) hono/csrf (app.ts) 403s a BODYLESS
  `page.request` POST/DELETE — it Origin-checks form-submittable requests but exempts `application/json`;
  fixed by sending `content-type: application/json` on the trigger POST + reminder DELETE (the JSON-body
  create POST was always fine). (2) split siblings render COLLAPSED at the group total, so a UI `$50`
  substring never appears → assert the per-sibling share via the API. (3) 2024-dated rows paginate off
  page 1 of 150 → assert materialization via the API (tag-filtered), capture the badge eyes-on separately.
  (4) the list API row exposes the per-sibling value as `expenseAmount`, not `amount`. **Recurring-expenses
  is now COMPLETE (T1–T8).** Verify: the spec passes green; no app source touched (FE was fully built
  C5–C22); both suites were green at C26. cov: be 87.22% / fe 86.07% (~ — e2e capture, no module touched).
- **C26 (deep-review)** — **Eyes-on sweep of /analytics (the most complex shipped page) — AUDITED CLEAN;
  3 suspected defects debunked firsthand.** deep-review was the sole over-budget category (26−19=7/5).
  Per the C19 note (backup/restore/import already swept), picked the recommended UNAUDITED surface: an
  eyes-on sweep of /analytics. Booted fresh (RESET_DB) + shot desktop & mobile EMPTY state (clean
  four-states EmptyState "No fuel data yet" + Log-a-Fillup CTA; 2×2 mobile grid, no overflow, 0 console
  errors). Then seeded consecutive fuel fill-ups via API to review the POPULATED state. THREE suspected
  defects, ALL DEBUNKED firsthand (the GUIDE's "HIGH findings are often false"): (1) **"Avg km/L" on a USD
  user** — traced to `getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)`, fully unit-derived
  from the user's pref, NEVER hardcoded (the seeded user's distance/volume prefs are metric independent of
  USD currency — a valid config); no `km/L`/`mi/gal` literal exists in the analytics render path. (2)
  **blank gray chart boxes** — those are ChartCard's deliberate visibility-gated Skeletons (UIQuality "no
  blank box"), not a render defect: charts are IntersectionObserver-gated (`visibility-watch.svelte.ts`) +
  the tabs are lazy `{#await import()}` code-split with proper spinners. (3) **missing `[data-slot=chart]`
  svg** — the IO gate simply doesn't flip in headless full-page capture (no real viewport intersection),
  a HARNESS limitation, not a product bug. EYES-ON PAYOFF: the Playwright-failure screenshot captured the
  populated Fuel & Stats stat cards rendering CORRECTLY — Fill-ups 17/yr, Liters 166.5, Fuel Consumption
  Avg km/L 30.2 (Best 30.5 green / Worst 30.0 red), trend arrows + "-100%" deltas all correct (confirms
  the 30 mpg→12.75 km/L conversion + band/color semantics end-to-end). VERDICT: /analytics is
  architecturally sound (lazy tabs + IO-gated charts + correct unit-derived labels + four-states + trend/
  color semantics) — no defect, no code change. The capture spec was removed (non-deterministic against
  the IO gate; knowledge recorded here). RECORDED for future eyes-on cycles: IO-gated charts don't paint
  in headless full-page shot.sh — to capture a painted analytics chart, a real scroll/viewport-intersection
  trigger is needed (or test the stat-card layer, which renders unconditionally). Verify: no source touched
  (audit only); both suites were green at C25. cov: be 87.22% / fe 86.07% (~ — no module touched).
- **C25 (guard)** — **Tree-wide source-scan guard for the C24 #36 RAW-value-input fix.** Two cats tied
  over budget (deep-review 6/5 +1, guard 7/6 +1); guard wins the tie on raw starvation (7 > 6). The C24
  #36 fix is a HIGH data-safety fix whose regression risk is a ONE-TOKEN flip (`RAW`→`USER_ENTERED`) or a
  NEW Sheets write site added with USER_ENTERED — and the C24 fake-seam test only drives the single write
  path that exists today. GUARD: new `sheets-raw-value-input.test.ts` (+2) scans google-sheets-service.ts
  for EVERY `valueInputOption: '<x>'` assignment and asserts each is `'RAW'` (+ a non-no-op check that ≥1
  site exists). KEY design point: it matches the ASSIGNMENT, not a bare `USER_ENTERED` substring — the C24
  fix's own explanatory comment contains the word USER_ENTERED, which a naive grep would false-positive on
  (verified: 2 comment occurrences, 1 real assignment). NON-VACUOUS: flipping the source to USER_ENTERED
  turns the scan RED with the precise corruption diagnostic; restored → green (1 RAW site). Mirrors the
  established source-scan idiom (no-oldest-month-slice / no-utc-date-input). Source-scan > untracked e2e
  for merge survival (GUIDE). Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1597 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — pure source
  scan, no module logic touched; pins the #36 contract tree-wide).
- **C24 (bug #36)** — **Sheets backup formula-injection fix: USER_ENTERED → RAW (Angelo-APPROVED Sev-1).**
  bug was the sole over-budget category (24−20=4/3). The cold-scout vein is exhausted, so took the top
  unfinished Angelo-approved item by severity: #36 (HIGH, the Sheets-backup formula-injection / silent
  round-trip corruption). FIX: switched `updateSheet`'s `valueInputOption` from `'USER_ENTERED'` to `'RAW'`
  (google-sheets-service.ts) — USER_ENTERED makes Sheets PARSE each cell as if typed, so a value starting
  `=`/`+`/`-`/`@` becomes a LIVE formula (injection + the user's OWN data silently round-trips back as the
  formula RESULT, not their text — NORTH_STAR #1 backup corruption). RAW stores the literal string →
  byte-exact, injection-inert, NO escaping needed. GUARD (+2 in google-sheets-service.test.ts via the
  injected-fake seam): asserts every write sends `RAW` (added a `valueInputOptions` capture map to the fake
  — the grid stores identically regardless of option, so a round-trip alone is vacuous for this), and a
  `=HYPERLINK(...)` make round-trips VERBATIM through write→read. DELIBERATELY did NOT do the approved
  text's second half ("escape leading formula chars on read"): under RAW that's both unnecessary (nothing
  to un-escape) and HARMFUL (a `'`-prefix escape on this backup→restore ROUND-TRIP path reintroduces the
  C399/C401 apostrophe corruption csv-safety.ts's header explicitly warns against — the two clauses are
  ALTERNATIVE mechanisms, not complementary). send_message'd Angelo the nuance (don't auto-decide a
  data-contract divergence), shipped the unambiguously-correct half, did NOT block. CAUGHT-MY-OWN-BUG: the
  first edit accidentally dropped the `range:` line → my new RAW guard + 3 existing tests went RED (range
  undefined → fake skips the write); restored the line → green (the guard did its job). #37 (atomic
  temp-sheet+swap) is a materially larger restructure → left OPEN for its own cycle per one-coherent-
  increment. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1595 pass / 0 fail (+2 net,
  was 1593 functional pre-cycle), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe
  86.07% (~ — Sheets service already covered by the C-era fake-seam tests; +2 pin the injection-safety
  contract).
- **C23 (arch)** — **`buildSplitConfig` dedup (the C22-created drift vector — a genuine fresh pick, not a
  re-scout).** arch was the sole over-budget category (23−17=6/5). Unlike the C4/C6/C12 no-churn scouts,
  there was a REAL pick: my own C22 T4 work added a `buildSplitConfig()` to `ReminderForm` that was
  near-byte-identical to `ExpenseForm`'s (both build the `SplitConfig`/`ReminderSplitConfig` discriminated
  union from method/vehicleIds/allocations — `even`→vehicleIds, else map allocations with a `?? 0`
  coalesce). The two union aliases are structurally identical; `InsuranceTermForm` uses a DIFFERENT flat
  `{vehicleIds, splitMethod?, allocations?}` API shape → correctly NOT a merge target (verified firsthand).
  Extracted ONE pure `buildSplitConfig(method, vehicleIds, allocations): SplitConfig` into
  `expense-helpers.ts` — the natural pair to `resetSplitAllocations` (the C415 split-seed source of truth
  that already lives there). ExpenseForm calls it directly (dropped its now-unused `SplitConfig` type
  import); ReminderForm wraps it in a thin `reminderSplitConfig()` that keeps the `showSplitEditor`→null
  guard then delegates. Arch rule 3 satisfied: added the characterization test FIRST (buildSplitConfig was
  never directly tested — it lived locally in each component, the C181/C229 isolation gap). GUARD: +5 cases
  in reset-split-allocations.test.ts (even→vehicleIds / absolute+percentage map / the load-bearing
  cleared-input→0 coalesce on both numeric methods) — the merge-surviving net since both forms are
  eyes-on/Playwright-blocked. BEHAVIOR-PRESERVING confirmed at the API seam (rule 4): re-ran the C22
  reminder-expense-split + reminder-expense-type e2e specs GREEN — the split round-trip still persists
  `{method:'even', vehicleIds:[2]}` identically + the single-vehicle no-split path unchanged (no template
  touched, only the `<script>` call expression). Verify: frontend validate:local GREEN — type-check 0,
  build OK, 726 tests pass (+5). cov: be 87.22% / fe 86.07% (~ — same split-state module, LOC down, one
  source of truth for the union builder; the +5 pin the newly-shared helper directly).
- **C22 (feature)** — **Recurring-expenses T4: multi-vehicle split in `ReminderForm` (eyes-on DONE).**
  feature was the sole over-budget category (22−16=6/4; arch sat AT 5/5). Picked T4 over the import-trackers
  tail as the more contained, higher-leverage increment (reuses an existing kit widget). REAL gap: the form
  hard-nulled `expenseSplitConfig` (ReminderForm:52-53), so a multi-vehicle EXPENSE reminder materialized
  ONE row on `vehicleIds[0]` only (trigger-service drops to the single-row path on null config) — the other
  selected vehicles silently got nothing. FIX: exposed the shared `SplitConfigEditor` (the same widget the
  expense + insurance-term forms use — InsuranceTermForm was the copy template, incl. `resetSplitAllocations`
  the C415 shared seed) when `kind==='expense'` && ≥2 vehicles && amount>0; `buildSplitConfig()` → null for
  notification/single-vehicle/unsplit (trigger path UNCHANGED) else a `ReminderSplitConfig` union; edit-open
  reads the stored config back; client-side split validation mirrors the backend `refineSplitConfig`
  (percentages→100 / fixed-$→amount) so submit blocks before a 400. EYES-ON CONFIRMED via a new
  `reminder-expense-split.meshclaw.e2e.ts` + two PNGs (Read): 2 vehicles + $200 → the "Split across vehicles"
  editor reveals; EVEN shows Daily Driver $100.00 / Weekend Car $100.00 · Total $200.00; the % toggle reveals
  per-vehicle inputs seeded 50/50; the created reminder persists `{method:'even', vehicleIds:[2]}` (read back
  via GET — full FE→BE→DB→render round-trip). Single-vehicle no-split path unchanged (reminder-expense-type
  spec still green; the 2 full-suite reminder failures were the documented accumulated-data strict-mode-2
  flake — both pass in isolation, and the split editor can't render in either notification flow). Verify:
  frontend validate:local GREEN — type-check 0, build OK, 721 tests pass. cov: be 87.22% / fe 86.07% (~ —
  UI-markup cycle; the split materialization path is backend-covered at T2/C102). Recurring-expenses
  REMAINING: only T8 round-trip e2e (the last tail).
