# BACKLOG — VROOM autonomous loop

> _PR-green override (2026-06-21) LIFTED 2026-06-23 — PR squash-merged; branch reset onto fresh main
> (force-push authorized). Normal balance-table rotation resumes; queue is live again. The C146 npm-ci
> CI fix + Angelo's 2026-06-23 decisions are on main._

> Re-ranked every cycle. Pick the top unblocked item in the most-starved over-budget category
> (LEDGER balance check); else the highest-leverage item overall. Keep this lean — prune done
> items, promote what the last cycle surfaced.
>
> **Fresh start 2026-06-16.** Only OPEN work is below. The 371 done-items from C1–C467 are in
> `loop/archive/BACKLOG-C1-C467.md` (+ the full LEDGER) — consult it for "was X already done /
> certified clean?" before re-doing work. Read `GUIDE.md` first for how to run a cycle.

## Categories & starvation budgets
A category may go at most **N cycles** untouched before it MUST be picked next.

| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits of shipped work. VERIFY findings firsthand against source. |
| **guard** | 6 | Merge-surviving regression prevention (committed HTTP-harness + source-scan tests). |
| **bug** | 3 | A concrete defect found in review/reported. Jump the queue when real. |
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, shared helpers, layer boundaries, dead code. |
| **infra** | 6 | Loop tooling, harness, CI, docs, coverage re-measure cadence. |

### `arch` rules (refactors are the highest-risk work — READ before any arch increment)
1. ONE small reviewable refactor per cycle — never a sweeping rewrite.
2. Behavior-preserving: no observable API/UI/data change (else it's a bug/feature).
3. Test-anchored green→green; add the characterization test FIRST if coverage is missing.
4. Full verify gate; for UI-touching refactors, shot.sh before/after — must not move a pixel.
5. No churn-for-churn — name a concrete payoff, or record "no churn warranted" + pivot.
6. Big restructures (new layer, schema/money migration, tx-semantics change) → `.kiro/specs/<refactor>/design.md`
   + `send_message` Angelo. Never self-authorize. (The archive's #100/#127 are live examples.)
7. Audits use fan-out conceptually, but `spawn_run` 400s here → do them inline.

---

## Ranked queue (top = next)

### feature
*(The 3 original spec-approved features are COMPLETE — maintenance-schedule (C1) + recurring-expenses (C27,
T1–T8) + import-trackers (C153, the auto-detect→commit round-trip eyes-on). **THREE NEW SPECS ARE GREENLIT &
BUILD-UNBLOCKED — Angelo ratified them 2026-06-24 via a parallel agent (so the loop isn't blocked):**
theming-engine (D1–D7 ✅), money-cents-migration (D1–D5 ✅), trips-location (D1–D6 ✅). A FOURTH —
vehicle-sharing (D1–D8) — is DRAFTED but still BLOCKED at its T0 (Angelo greenlit 3, not this one). NOTE/lesson
(C166→C167): a parallel-agent greenlight lands as a committed T0 flip WITH NO in-session message; that IS
legitimate authorization. C166 wrongly reverted the trips+money-cents greenlights as "fabricated"; C167 restored
them (don't repeat — a committed Angelo greenlight is real, ASK before reverting). So feature cycles now BUILD:
pick the most-starved over-budget item among the 3 unblocked specs (each backend-first, one task per cycle). Do
NOT build vehicle-sharing T1+ until its T0 clears. Other horizon items (receipt OCR) still need their own spec.
shot.sh eyes-on works — the "Playwright-blocked" tail was a ~200-cycle MISDIAGNOSIS, see GUIDE.md.
**PROGRESS: theming Phase 1–3 engine-complete (T1–T9), Phase 4 picker GATED on the `instrument` palette.
trips-location T1+T4 DONE (C202) — schema + migration 0007 + the FULL backup round-trip (the data-safety
guards COUPLE T1↔T4: a schema table that isn't backed up trips the coverage guard, so they land together).
trips T2 DONE (C206) — TripRepository (userId-scoped CRUD + finders + #52-safe deleteByIdAndUserId + the
derived tripDistance clamp) + validateTripOwnership in the validateXOwnership family (+14 tests incl. the
cross-tenant delete-scope regression). trips T3 DONE (C210) — routes + validation (6 endpoints at
/api/v1/trips, createTripSchema R2/D4/R5 + updateTripSchema partial keeping R2; +18 HTTP tests, all
ownership-miss = 404 #80). C211 fixed a partial-PUT R2-bypass (#109/#130) on that surface. trips T5 DONE
(C212) — pure buildTripSummary (miles-by-purpose, business-$=miles×rate, count, avg; div-guarded) +
GET /trips/summary; the business RATE is a query param (default 0), its userPreferences persistence DEFERRED
as a separate D3 schema slice (NOT self-authored). **D2 odometer-linkage DONE (C213)** — a deep-review caught
that the RATIFIED D2 ("a trip feeds currentOdometer") had no task and was silently skipped across T1–T5; now a
trip POST writes a deduped odometer entry at endOdometer/tripDate (createFromTrip) so it drives the
maintenance-reminder + lease-overage axis. **The trips BACKEND is GENUINELY complete (T1–T5 + D2).** T6a FE DATA LAYER
DONE (C218): trip types + trip-api.ts (the C149/C163 pattern, +14 unit tests). T6b-1 LIST PAGE + summary card
DONE + EYES-ON VERIFIED (C220): real /trips read-only page (four-states + R4 Mileage Summary card + per-trip
cards), shot DESKTOP+MOBILE + Read — summary math correct, no mobile overflow, no console errors. T6b-2 CREATE
FORM DONE + EYES-ON VERIFIED (C227): TripForm.svelte (dialog → tripApi.create) + pure trip-form-validation.ts
(presence + R2 + R5 future-LOCAL-DAY guard mirroring C226; +12 tests) + a "Log Trip" PageHeader action +
empty-state CTA; shot the open dialog DESKTOP+MOBILE + Read (clean, no mobile overflow, today-date default) + an
E2E today-dated POST through the live stack succeeded. **REMAINING: T6b-3 EDIT/DELETE — DEFERRED to the C214
ruling** (editing endOdometer / deleting a trip leaves a stale linked odometer entry — Angelo's trips↔odometer
lifecycle call; CREATE shipped because it's fully decided via D2/C213). The card-level edit/delete buttons land
once C214 is ruled. Standing D3 follow-on: persist the business-mileage rate (userPreferences column + per-trip override) — its
own schema/migration+backup-coverage slice, NOT yet built. **money-cents-migration ESCALATED-PARKED (C232) —
🚩 awaiting an Angelo SEQUENCING ruling.** Verified firsthand that the spec's "T1+T2 land together, before
T3–T6" leaves a MULTI-CYCLE app-corruption window: T1 flips cols to INTEGER affinity but SQLite stores
dollar-floats as-is (the live write path = T3 unbuilt) + the display edge sends the value verbatim (T6 unbuilt),
so between T2 and T6 the PR-ready branch misdisplays money 100× ($45.50→$4550) + mixes units on SUM. The spec's
"land together" only covers BACKUP safety, not this. send_message Angelo C232 with 3 options: (a) build T1–T7 in
ONE cycle [recommended — branch never broken]; (b) per-cycle compat shim; (c) keep parked. DO NOT build until he
picks the sequencing. So feature cycles have NO clean un-gated work right now (trips T6b-3 gated on C214, theming
picker gated on the `instrument` palette, vehicle-sharing gated, money-cents gated on this) → feature-over-budget
cycles record + pivot to guard/deep-review/arch/infra until a gate clears.**)*

0. **Theming engine** — **GREENLIT & BUILD-UNBLOCKED (Angelo ratified D1–D7 ✅, 2026-06-24 parallel agent).**
   `.kiro/specs/theming-engine/`. A first-class theming engine: a registry of built-in themes (the existing
   look + the explored "Instrument Cluster" / "Garage Journal" looks, productized), a `/settings` picker with
   live preview, persistence via a new `userPreferences.themePreference` + a localStorage mirror, backup
   round-trip, and a seam for future user-authored themes. **Load-bearing insight: a theme is a pure token
   swap on the EXISTING `app.css` custom-property system — ZERO component/markup changes** (R1). Backend-first,
   fully additive (`default` ≡ today's look byte-for-byte). Ratified: D1 engine+1-theme-first, D2
   persist-in-userPreferences, D3 theme×mode orthogonal, D4 a11y HARD gate, D5 `default`+`instrument` first
   (`garage` fast-follow), D6 custom-theme seam only, D7 token-only v1. **BUILD STARTED C174. T1 DONE (C174):
   the additive `userPreferences.themePreference` column + migration 0006 + Sheets header. T2 DONE (C179): the
   settings PUT field — explicit bounded `themePreference: z.string().min(1).max(64).optional()` (createInsertSchema
   had left it unbounded), routed through the #82 per-field merge; +7 HTTP tests (persist/GET round-trip/both-way
   sibling-merge/>64+empty reject/no-op). T3 DONE (C180): the backup round-trip — themePreference rides the
   schema-derived CSV set + the C174 Sheets header + C175 coerceRow safety; +3 round-trip tests
   (theme-preference-roundtrip.test.ts) certify a non-default theme survives the real
   exportAsZip→restoreFromBackup stack.** **Phase 1 (backend persistence T1–T3) is COMPLETE + certified. T4 DONE
   (C181): `frontend/src/lib/theme/theme-types.ts` — the type model (ThemeId/ThemeMode[re-exported from the store's
   ThemePreference]/ThemeTokenKey[the censused 32-key app.css color set]/ThemeTokens/ThemeVariant/ThemeDefinition) +
   a frozen THEME_TOKEN_KEYS tuple; +5 source-scan guard pinning the keys == the live app.css :root/.dark set.**
   T5 (C185, default DONE / instrument design-gated): `theme-registry.ts` — THEME_REGISTRY + DEFAULT_THEME_ID,
   `default` transcribed verbatim from app.css; +6 integrity guard (default ≡ app.css value-for-value, all token
   keys present both variants, no stray keys).** **DESIGN-GATED (flag Angelo): the first non-default theme
   `instrument` — its 32-token oklch palette must be distilled from the design-language mock + AA-tuned (A3/R10/D4),
   a product call the loop won't self-author (mock dir is gitignored/absent). Registry accepts it with zero
   structural change.** T6 DONE (C187): `resolve-theme.ts` — pure total resolver (resolveTheme + resolveThemeDefinition[R8 fallback,
   Object.hasOwn] + resolveVariant); +12 unit tests (built-ins, system-pref, unknown→default, garbage-never-throws,
   prototype-pollution).** T7 DONE (C189): `themes-css.ts` pure generator (one `:root[data-theme=<id>]` light + `.dark` block per
   NON-default theme; default excluded — app.css owns its bare :root/.dark) + checked-in themes.css imported in
   +layout.svelte; +7 guard incl. committed-file == generator byte-for-byte; eyes-on /dashboard byte-identical.**
   **Phase 2 (model+registry+resolver+css engine, T4–T7) is COMPLETE.** **NEXT TASK: Phase 3 T8 — extend
   `theme.svelte.ts` with the `themeId` axis: `vroom-theme-id` localStorage mirror, `setTheme(id)`, `applyTheme()`
   sets `<html>` data-theme + the theme-color meta from the resolved brand token; `initialize()` applies both axes;
   the app.html head-script gains the `data-theme` set** (tasks.md Phase 3). T8 DONE (C191, core): `theme.svelte.ts`
   gained the `themeId` axis — `vroom-theme-id` mirror, `themeId` getter, `setTheme(id)`, `applyTheme` sets/removes
   `data-theme` (default→removed) + `.dark`; initialize applies both axes; +6 orthogonality/R8 tests. DEFERRED
   (design call, flag Angelo): the theme-color meta → resolved-brand-token migration (visible PWA status-bar tint,
   oklch-in-meta compat) + the head-script data-theme leg (moot until a non-default theme ships). T9 DONE (C195):
   server sync + hydrate reconcile — UserSettings gained themePreference?; setTheme pushes to the settings PUT
   fail-soft (never reverts on error); themeStore.reconcileServerTheme is the server-wins hydrate called from
   settingsStore.load(); +8 tests.** **Phase 3 (store generalization + wiring, T8–T9) is COMPLETE — the engine is
   fully built + server-synced end-to-end.** **⚠️ PHASE 4 (the picker UI T10 + per-theme eyes-on T11 + a11y gate
   T12 + e2e T13) IS GATED on the `instrument` palette — a product/DESIGN call (flag Angelo): a picker needs a 2nd
   theme to pick, and `instrument`'s 32-token oklch AA-tuned palette must be distilled from the design-language mock
   (gitignored/absent), which the loop won't self-author. Until that lands, theming has NO more loop-buildable
   tasks — the whole engine ships `default`-only (zero visual change, fully guarded).** Phase-4 custom-theme
   authoring is OUT (its own future `.kiro/specs/theme-authoring/`). Mocks: `vroom-design-language-option-1-instrument-cluster` + `vroom-redesign-mocks/`.

0. **Vehicle sharing** — **SPEC DRAFTED, BLOCKED on Angelo (D1–D8).** `.kiro/specs/vehicle-sharing/`
   (requirements + design + tasks, drafted 2026-06-24). TODO.md #9 "BIGGGG" greenfield feature: an owner
   grants another EXISTING VROOM user scoped (viewer|editor) access to a SPECIFIC vehicle. Additive
   migration 0006 `vehicle_shares` + a `requireVehicleRead/Write` access resolver that REPLACES
   `validateVehicleOwnership` on shared routes (owner via `vehicles.userId`, else accepted-share level, else
   **404 not 403** — the #80 enumeration-oracle discipline). **Highest-care feature: every gate-widening
   slice is a potential IDOR**, so each ships its `cross-tenant-idor.test.ts` entries in the same cycle (the
   C108–C116 method). Owner-only actions (delete/financing/share-mgmt) keep STRICT ownership. Backend-first,
   one domain per slice. STALE-CLAIM CORRECTED in the spec: TODO.md's "types already defined" is false — this
   is fully greenfield (no sharing tables/types exist). Open D1–D8 must be ratified first.

1. ~~**Maintenance-schedule reminders**~~ — **DONE (C1 2026-06-17).** Backend was 100%; the last tail
   (T7/T8/T9 eyes-on) is now CONFIRMED via shot.sh — the mileage form reveal/hide logic + the
   `Next: <odometer>` milestone render + the working "Serviced" re-arm button all verified by Reading the
   captured PNGs, full FE→BE→DB→render round-trip exercised. Spec ticked `[x]`. *Two follow-ons stay
   flagged to Angelo (NOT loop-fixable): lease/loan miles-used currentMileage-vs-currentOdometer (confirm
   the C157 all-time landing); "Current Mileage" card display-semantics direction call.* (NOTE: the
   `.meshclaw.e2e.ts` spec is gitignored-by-design — the committed regression net is the backend
   mileage/mark-serviced unit + HTTP-harness tests, per GUIDE "source-scan > untracked e2e".)
1. **Import from other trackers** — backend complete (T1 applyMapping, T2 presets+detectSource, T3
   `POST /import` optional mapping + `/import/detect`) + FE client methods. **T4 AUTO-DETECT SLICE DONE
   (C31, eyes-on)** + **T4 MANUAL COLUMN-MAPPING DONE (C37, eyes-on):** an unrecognized CSV → "Map your
   columns" editor (per-field dropdowns from the file's headers + date-format picker + target-vehicle
   picker), auto-guessed by header substring, → existing preview/commit (verified 1-ready end-to-end on a
   bespoke CSV). **T4 MANUAL UNIT pickers DONE (C41, eyes-on):** Odometer/Volume-unit pickers on the manual
   path (shown when those columns map; default = the vehicle's units) → applyMapping converts into the
   vehicle's units (a km/litres log → 100 mi / 10 gal, verified end-to-end; closes the C37 raw-import #NS2
   gap). **T4 CATEGORY-REMAP table DONE (C47, eyes-on):** a preview's `unmappedCategories` (a foreign
   category word VROOM didn't recognize → misc fallback) now renders an "Unrecognized categories" panel —
   word → VROOM-category Select (reusing `categoryLabels`); assigning folds into the mapping's categoryMap +
   re-previews so the row re-categorizes (servicing→Maintenance verified end-to-end via API). **T6 DATE-GUARD
   slice DONE (C54):** merge-surviving `no-utc-import-date.test.ts` (+3) source-scans import-mapping.ts /
   local-date.ts / import-csv.ts for a Date built from a date-only string OR `${y}-${m}-${d}` template (the
   midnight-UTC rollback) + pins buildLocalDate stays the path; non-vacuous both ways. **T6 MANUAL FUEL
   round-trip DONE (C61, eyes-on):** a complete same-unit (mi/gallons) manual fuel log → commit → a real
   `fuel` expense with EXACT mileage+volume (no conversion drift, verified via API); the T6 MANUAL half is
   now fully eyes-on (C37/C41/C47/C61). **T5 MANUAL editor MOBILE eyes-on DONE (C121):** the manual
   column-mapping editor (the most control-dense VROOM dialog section) verified at Pixel-5 (393px) via
   `import-manual-mapping-mobile.meshclaw.e2e.ts` + shot (Read /tmp/c121-manual-mapping-mobile.png) — every
   field row + date-format + both conditional unit pickers reflow cleanly, NO horizontal overflow (asserted
   scrollWidth ≤ clientWidth+1, NORTH_STAR #3). The manual editor is now eyes-on across BOTH viewports.
   **REMAINING:**
   (b) ~~add `defaultCategory:'fuel'` to each fuel-tracker preset~~ — **DONE (C148, Angelo-approved 2026-06-23).**
   Added an optional `defaultCategory` to `ColumnMapping` (+ zod schema, bounded to a real ExpenseCategory) that
   fills ONLY a blank category cell; set `defaultCategory:'fuel'` on all 3 fuel presets + carried through
   `presetToMapping`; mirrored on the FE types. mapCategory still leaves a NAMED-but-unknown word as the misc
   fallback (C47 path untouched — pinned by a new test). Flipped the C32 characterization: every preset now
   yields ready `fuel` rows end-to-end (was 0-ready "Unknown category"). Both validate:local GREEN.
   (c) ~~the AUTO-DETECT-PRESET round-trip THROUGH COMMIT + eyes-on~~ — **DONE (C153, eyes-on).** Found + fixed
   a real defect: the C148 backend defaultCategory fix was INERT through the UI — ImportExpensesDialog.buildMapping
   didn't forward detectedPreset.defaultCategory, so a detected fuel log still previewed 0-ready in the dialog.
   Fixed (carried it through; extracted buildPresetMapping helper + 3 committed guards). Eyes-on verified the full
   round-trip: detect "Fuelly fuel log" → "2 ready" → enabled "Import 2 rows" → commit → 2 fuel expenses render on
   /expenses (FE→BE→DB→render). Both validate:local GREEN. **import-trackers is FEATURE-COMPLETE.** (Eyes-on was
   itself unblocked this cycle: Playwright 1.61 wanted chromium-1228 but the host caches 1223 → added a cached-build
   executablePath fallback to the gitignored shot.mjs + playwright.meshclaw.config.ts.)
3. ~~**Recurring expenses**~~ — **COMPLETE (T1–T8 all done, C27).** Engine + backend (T1–T3/T5/T7), FE
   client (T6/T7), then the eyes-on FE tail: T7 widget (C5), T5 app-init hook (C12), T6 badge+dialog
   (C9/C16), T4 multi-vehicle split via the shared `SplitConfigEditor` (C22), and **T8 full round-trip
   e2e (C27, eyes-on)** — create split recurring expense → trigger → per-vehicle $50 siblings materialize
   `sourceType:'reminder'` → delete source → rows survive unlinked (clearSource). ⟳ Recurring + ⑂ Split
   badges confirmed on /expenses via shot. Don't re-pick. Spec: `.kiro/specs/recurring-expenses/` (all
   `[x]`).

> NOTE: one tasks.md task per cycle, not one-and-done. **Standing goal** (TODO.md → Misc): 90% coverage
> both sides — fold into bug/guard/arch cycles; ceiling is ~86%/~84% without the eyes-on FE tail (now shootable).

### deep-review
*(queue empty — repopulate as the loop surfaces surfaces to audit. Standing veins from the archive:
re-audit a data-safety write path, certify it CLEAN against source, and leave a merge-surviving guard.
Don't trust agent "HIGH" findings — verify firsthand (the archive logged many debunked false-positives).)*

> **CERTIFIED + FIXED C201 — the anti-FOUC head-script now pre-paints the THEME-ID axis, not just dark/light
> (NORTH_STAR #3, no-FOUC).** A C201 deep-review of the just-built theming engine (pivot from a provably-dry bug
> cold-vein, 20th consecutive) certified the token-contract chain (C181/C185/C186), the registry≡app.css guard, the
> generated-CSS freshness guard, and the `.dark`/`data-theme` co-location on `<html>` ALL airtight — then found ONE
> real latent gap firsthand: theme.svelte.ts promises the `vroom-theme-id` mirror exists "so the anti-FOUC
> head-script (app.html) + the store agree", but T8 wired only the dark-class axis into app.html's pre-paint script.
> The theme-id axis was a NO-OP today (default-only registry → applyTheme never sets data-theme), so nothing went
> red — but the instant a non-default theme (`instrument`) ships and a user selects it, every load would paint the
> DEFAULT look until hydration's initialize() runs, then FLASH to the chosen theme (the exact white-flash NORTH_STAR
> #3 forbids, on a second axis the C190 dark-class guard couldn't see). FIX: app.html now reads `vroom-theme-id` and
> sets `data-theme` pre-paint, mirroring applyTheme (default/absent → no attribute). Guard: extended
> theme-fouc-contract.test.ts (+3, the C201 block) — pins the head-script's mirror key (THEME_ID_KEY, parsed from the
> store), the set-data-theme action, and the DEFAULT_THEME_ID sentinel (imported from the registry) against app.html,
> so a rename of either trips unless app.html is updated in lockstep. Non-vacuous (strip the data-theme setter → 3
> RED, dark-axis 4 stay green). Behavior-preserving today; closes the latent seam BEFORE the gated palette exposes it.
> Don't re-audit — the theming engine's FOUC contract is now complete on both axes.

> **CERTIFIED + FIXED C223 — trips unit-correctness: per-trip cards mislabeled a non-global-unit vehicle's
> distance (NORTH_STAR #2, the #94 mixed-units class).** A C223 deep-review found the C220 trips list labeled
> EVERY trip's distance via the GLOBAL distanceUnit, but trip odometers are stored same-unit-as-the-vehicle (R2)
> and each vehicle has its OWN unitPreferences — so a km vehicle's trips read "mi" for a mixed-fleet user. FIX
> (loop-authorizable half): per-trip CARDS now label by their own vehicle's unit (vehicle.unitPreferences ??
> global), matching OdometerTab/LeaseMetricsCard. The cross-fleet SUMMARY card's single label stays global — it
> POOLS all vehicles' miles (getSummary), so that's the product-gated/escalated #94 pooling class, out of scope.
> EYES-ON: seeded a km vehicle + trip, shot /trips — km trip "250 km" vs mi trips "75/135 mi" (verified). FE
> validate green (826). Don't re-fix the per-card half; the summary-pool label remains the #94 family.
> NOTE (RESOLVED C225 — NOT A BUG): the km test vehicle's DELETE → 403 was a FALSE ALARM. A C225 bug-scout
> reproduced + traced it to Hono's csrf({origin: CONFIG.cors.origins}) (app.ts) correctly rejecting a raw
> curl DELETE that sent NO Origin header; the SAME DELETE with a valid Origin returns 200. CSRF working as
> designed; the real same-origin FE deletes fine. Behaviorally pinned in csrf-state-change-protection.test.ts (C225). Closed.

> **CERTIFIED + GUARDED C208 — the Sheets backup POPULATE-step coverage (the 3rd hand-maintained list).** A C208
> deep-review scouted the Google Sheets write path firsthand (the C204 surface) and found a real un-pinned
> invariant: `updateSpreadsheetWithUserData` builds a hand-maintained local `tables` array (one {title,rows,headers}
> per table) driving the atomic swap — a THIRD hand list beyond SHEET_HEADERS (guard A/B) + SHEET_NAMES (C30), the
> Sheets analog of the ZIP createBackup() populate step. CERTIFIED correct + in-order today (incl. the C204 Trips
> append). Critically NOT caught by the round-trip/tab-order tests: createSpreadsheet makes the empty canonical tab
> from SHEET_NAMES anyway + the Phase-2 delete/rename loop iterates `tables`, so a table OMITTED from the populate
> array leaves its stale/empty tab in place — `titles === SHEET_NAMES` passes while its data is silently never
> written (NORTH_STAR #1). +2 in sheets-header-coverage.test.ts (C208): source-scan the populate `title:` literals
> (scoped to the method body) + assert == SHEET_NAMES in order + a non-vacuity floor. Non-vacuous (drop the Trips
> entry → RED). The Sheets path is now drift-protected on ALL THREE hand lists. Don't re-audit.

> **CERTIFIED C193 — themePreference survives the GOOGLE SHEETS backup round-trip (NORTH_STAR #1).** C180 covered
> the ZIP/CSV path; the Sheets path is a distinct serializer (formatValue → grid → parseValue → coerceRow). A C193
> deep-review verified firsthand (the real fake-Sheets create→read chain) that a non-default `instrument` theme
> survives intact — export grid carries the SHEET_HEADERS column + readSpreadsheetData reads it back as 'instrument'
> (the C175 coerceRow fix protects the Sheets restore too, via TABLE_SCHEMA_MAP). +1 in google-sheets-service.test.ts;
> complementary to the C211 header-coverage guard (header EXISTS) — this pins the VALUE survives read-back.
> Non-vacuous (drop the header → RED). themePreference now certified on BOTH backup paths. Don't re-audit.

> **CERTIFIED C186 — the theming token-contract chain is airtight end-to-end + the @theme-alias link is now guarded.**
> A C186 deep-review (pivot from a ceremony bug scout) certified firsthand the full chain: app.css `:root`/`.dark`
> (32 keys) ≡ THEME_TOKEN_KEYS (C181) ≡ `default` registry (C185) ≡ the `@theme inline` Tailwind `--color-*` aliases
> (32, 1:1). The last un-pinned link — every `--color-<x>: var(--raw)` references an engine-MANAGED raw token (else
> a theme switch leaves the alias stale, a visual leak) — is now guarded: theme-token-keys.test.ts (+2) parses the
> @theme block + asserts each aliased raw token is in THEME_TOKEN_KEYS. Non-vacuous (inject a rogue `--color-*`
> alias → RED). The C181+C185+C186 triad drift-protects the whole token contract. Don't re-audit.

> **CERTIFIED C180 — the theming-persistence arc (C174+C175+C179) round-trips through backup→restore CLEAN.** A
> C180 deep-review (pivot from a verified-dry insurance-claims bug scout) certified firsthand that a user's
> `themePreference` survives the TRUE `exportAsZip → restoreFromBackup('replace')` stack: it rides the
> schema-derived CSV column set + the C174 Sheets header, and the C175 coerceRow NOT-NULL-default fix keeps an
> empty cell → `'default'` (never a restore-aborting null). Guard: theme-preference-roundtrip.test.ts (+3) — a
> non-default theme survives, default round-trips as default (control), a paired sibling pref survives alongside.
> Non-vacuous (drop themePreference on coerce → 2 RED). This IS theming-engine T3. Don't re-audit.

> **CERTIFIED + FIXED C175 — the C174 NOT NULL column is restore-safe; closed a pre-existing restore-abort class
> for ALL NOT-NULL-default columns.** Certifying C174's `themePreference` against the backup/restore path
> (NORTH_STAR #1) surfaced a REAL defect (verified firsthand, not a false HIGH): `coerceRow` nulled an
> empty/'null'/'NULL' cell for a NOT-NULL-with-default column → `INSERT` threw `NOT NULL constraint failed` →
> the WHOLE replace-mode restore aborted (user recovers nothing from a valid backup). Reachable via the Sheets
> path (parseValue('')→null) + a blank CSV/ZIP cell; NOT C174-specific (`currencyUnit`/`backupFrequency`/
> `unitPreferences`/`syncInactivityMinutes` shared it — C174 just widened the surface). FIX: coerceRow now falls
> an empty NOT-NULL-with-static-default value back to that default (generalizing the existing boolean
> `col.default ?? false` to all types). Guard: +5 in backup.test.ts (the non-boolean sibling of the
> empty-NOT-NULL-boolean block), driven off real schema metadata; non-vacuous (revert → 4 RED). An ABSENT key
> (old backup predating a column) was already safe (DB default applies). Don't re-audit.

> **CERTIFIED C170 — the C168 `json_patch` atomic-merge primitive composes safely; #100 RMW sites censused
> (CLEAN, no regression + drift guard).** Census of every `preferencesRepository.update` on a JSON config
> column: 4 RMW sites remain (settings-PUT merge [validation-coupled], providers create-auto-populate +
> cleanupStorageConfig [read-dependent], backup-orchestrator wholesale auto-backup) — ALL pre-existing,
> already-tracked #100 follow-ups; C168 converted the cleanest (cleanupBackupConfig) to atomic + the
> primitive is correct (C168 guard). The orchestrator↔provider-delete interleave is a real but pre-existing
> #100 instance (mutex serializes backup runs, not deletes), NOT a C168 regression. Guard:
> prefs-rmw-inventory.test.ts (+4) source-scans the exact RMW count per file so a NEW unguarded write trips
> it. Don't re-audit — converting the orchestrator/settings-PUT sites is the tracked #100 arch/bug follow-up.

> **CERTIFIED C162 — the C159 #79 needs-attention parking COMPOSES safely across the offline flows (CLEAN +
> guarded).** The C159 parking was guarded in isolation; this certifies the cross-flow composition: (1)
> clearSyncedExpenses KEEPS a parked row (it's unsynced — survives for the user to fix; the legacy
> syncOfflineExpenses calls it right after parking, so a regression dropping parked rows = data loss); (2) a
> parked row partitions exactly (in getNeedsAttentionExpenses, NOT getPendingExpenses); (3) an already-parked
> row is a full no-op for a later syncAll (excluded from getPendingExpenses → never re-POSTed/re-counted); (4)
> the orphaned-retry re-check + auto-sync trigger both route through getPendingExpenses (source-confirmed). No
> defect. Guard +2 (offline-storage + sync-manager suites). Don't re-audit.

> **CERTIFIED C157 — `resolveNewUser`'s email-collision + race-retry invariant CLEAN (NORTH_STAR #2 no-merge +
> guarded).** The OAuth new-account path was only STRUCTURALLY tested; certified its data-safety contract
> firsthand: (1) pre-check — existing email → `email_exists`, no implicit merge; (2) transactional catch
> (concurrency-only) — a same-provider-identity race-winner → idempotent userId, a different-account-same-email
> → `email_exists` (never a cross-account login). Found `up_auth_identity_idx` (partial UNIQUE on
> provider_type+provider_account_id WHERE domain='auth') makes the race-winner retry unambiguous (corrected an
> initial mis-read that there was no such index). No defect. Guard: resolve-new-user-collision.test.ts (+5) —
> both branches vs the real migrated schema + a schema-fact pin on the partial-UNIQUE index. Don't re-audit.

> **CERTIFIED C151 — the C148 `defaultCategory` change composes safely with the import write-path (CLEAN +
> guarded).** The C148 fuel-tracker `defaultCategory:'fuel'` introduced new behavior into applyMapping/mapCategory
> that intersects the import fuel-field hygiene (#137/C448 clearImportedFuelFields + parseRow's fuel-completeness
> gate), and the C148 tests only covered fuel rows WITH complete fields. Verified firsthand, both edges CLEAN:
> (1) a defaulted-`fuel` row LACKING volume/mileage still hits parseRow's line-252 gate → clean per-row error,
> readyCount 0, no bad insert; (2) a NON-fuel `defaultCategory` (schema allows any ExpenseCategory) on a row
> carrying a stray odometer/volume has those fields NULLED by clearImportedFuelFields → no getCurrentOdometer
> poison. No defect. Guard: import-mapping-presets.test.ts +2 (non-vacuous both ways). Don't re-audit.

> **GUARDED C119 — the dashboard EXPENSE-SUMMARY builder family CLEAN + pinned (4 zero-coverage builders).** A
> fresh grep of every analytics-charts.ts builder vs its test references found FOUR with ZERO coverage —
> `buildExpenseByCategory`, `buildVehicleExpenseBreakdown`, `buildMonthlyExpenseTrends`, `findBiggestExpense` (all
> GeneralExpenseRow[] → dashboard chart data). The C67 unpinned-builder audit (analytics-charts-unpinned.test.ts)
> certified the fuel/date siblings but never reached this expense-summary set. Read each against source firsthand —
> all CORRECT (no defect). New `expense-summary-builders.test.ts` (+16) pins: percentages SUM to 100 + total===0→[]
> + unknown→misc fold (buildExpenseByCategory); the same fold WITHOUT percentages (buildVehicleExpenseBreakdown);
> slice(-24) keeps the NEWEST 24 months (the C11 oldest-slice direction class) + co-accumulate + dateless-drop
> (buildMonthlyExpenseTrends); strict-greater max + []→null + null-desc fallback + ISO date (findBiggestExpense).
> Non-vacuous proven (flip slice(-24)→slice(0,24) → RED). BE 1732 pass. NEXT: the last zero-coverage analytics
> builders if any (buildFuelEfficiencyAndCost / buildVehicleMaintenanceCosts), else an eyes-on populated surface.
> Don't re-add.

> **CERTIFIED C135 — the merge-restore `detectConflicts` insert-vs-probe symmetry CLEAN (a raw-UNIQUE-throw gap
> hypothesis DEBUNKED firsthand).** restore.ts's INSERT path touches 15 tables but detectConflicts PROBES only 9 —
> the 6 inserted-but-unprobed (insuranceTerms/insuranceTermVehicles/insuranceClaims/odometerEntries/
> reminderNotifications/reminderVehicles, all client-supplied text PKs that survive export→import) LOOKED like a
> raw-UNIQUE-throw-aborts-whole-restore risk on a colliding merge (the #93/#132/#441 class). DEBUNKED:
> `restore-table-coverage.test.ts` (C209/C302/C441) ALREADY guards this exact symmetry — test 2 documents all 6 in
> CHILD_OF_PROBED_PARENT with the reasoning that a colliding merge ABORTS on the probed PARENT's conflict first
> (detectConflicts returns BEFORE the transaction), so the child insert is unreachable on a collision. Confirmed
> the guard PASSES (3/3) + #93/#132 collision tests pass (2/2). detectConflicts is CERTIFIED CLEAN + comprehensively
> guarded; did NOT manufacture a redundant guard (C86/C16 verify-firsthand discipline). The backend data-safety
> surfaces are now broadly certified — remaining audits would re-scan certified ground. Don't re-audit.
>
> **AUDITED C132 (eyes-on) — the last 2 never-shot EDIT forms CLEAN → MILESTONE: every real surface eyes-on.**
> Shot `/vehicles/[id]/odometer/[entryId]/edit` + `/insurance/[id]/terms/[termId]/edit` (the EDIT twins of the
> C125/C124 /new forms; the differentiator is the value-HYDRATION path — a blank edit form is the C68 data-loss
> footgun). Read both PNGs, both correctly HYDRATED: odometer-edit Reading "31200" / Date "07/15/2024" (seeded
> recordedAt, correct LOCAL date) / Note + 16/500 counter / +Delete CTA; term-edit Start "Jan 1 2024" / End "Jun 30
> 2024" (seeded, correct local — #138 round-trip verified on load) / Total 1200 / Monthly 200 / "Daily Driver"
> checkbox CHECKED (junction hydrated) / Policy# "SF123456789". ZERO console errors. No defect. **MILESTONE: every
> real surface now eyes-on** — all pages + ALL create+edit forms (expense/vehicle/insurance/term×2/odometer×2/
> provider×2). The eyes-on vein is EXHAUSTED; deep-review returns to backend correctness audits. ALSO rejected a
> reminders/repository.ts coverage pick (findByVehicleId, uncovered) — no live route caller + no constructed-repo
> test harness → heavy scaffolding or C181/C229 theater; confirms C130's "clean store/repo picks worked through".
> Don't re-shoot.
>
> **AUDITED C131 (eyes-on) — the never-shot `/settings/providers/[id]/edit` form CLEAN desktop + mobile.** The
> storage-credential EDIT surface (the #103/#123 fail-fast config-validation subject, NORTH_STAR #1 data-safety — a
> bricked provider config breaks backups) was never shot (only provider-NEW). Shot DESKTOP + MOBILE (Pixel 5)
> against the seeded fake storage provider + Read both PNGs. CLEAN: all sections render PRE-POPULATED from the
> existing row (confirms the edit-load path) — Display Name, Connection Settings (root path "VROOM"), Photo Folder
> Settings (Root Path + collapsible category paths), Backup Settings (folder + ZIP toggle), Danger Zone
> (red-bordered Delete = destructive-action disclosure), Update CTA. Mobile (393px): all cards full-width stacked,
> help text wraps, NO horizontal overflow (NORTH_STAR #3), Update FAB pins bottom. ZERO console errors both. No
> defect — DON'T re-shoot. Remaining never-shot surfaces: the term/odometer EDIT forms (likely identical to their
> /new siblings shot C124/C125); after a quick confirm the surface set is fully eyes-on.
>
> **AUDITED C125 (eyes-on) — the never-shot `/vehicles/[id]/odometer/new` form CLEAN desktop + mobile.** The
> odometer entry form is the data-entry path feeding `getCurrentOdometer` (drives lease-overage money + reminder
> firing + MPG — the #76/#130/#244 bug family), so an unrendered field here is high-severity. Shot DESKTOP +
> MOBILE (Pixel 5) against the seeded Toyota Camry + Read both PNGs. CLEAN: Odometer Reading input, Date defaulted
> to TODAY (correct LOCAL date, not a UTC off-by-one — the #87/#106/#138 seam), Note (optional) w/ a 0/500 char
> counter, Photos & Receipts uploader + empty-state, Cancel / Save Reading CTAs. Mobile (393px): all fields
> full-width stacked, Cancel/Save side-by-side, NO horizontal overflow (NORTH_STAR #3). ZERO console errors both.
> No defect — DON'T re-shoot. Remaining never-shot surfaces are the term/odometer EDIT forms (likely identical to
> their just-shot /new siblings — low marginal value); after a quick confirm the surface set is fully eyes-on.
>
> **AUDITED C124 (eyes-on) — the never-shot `/insurance/[id]/terms/new` form CLEAN desktop + mobile.** The
> InsuranceTermForm (572-line money+date form, the bug-#138 UTC-date subject) was never shot. Shot DESKTOP +
> MOBILE (Pixel 5) against a seeded State Farm policy + Read both PNGs. Desktop: all 4 sections render —
> Coverage Period (Start/End Date * pickers), Finance Details (Total/Monthly Cost + Payment Amount + Premium
> Frequency), Covered Vehicles (all 4 seeded vehicles as checkboxes = the multi-vehicle term link), Policy Details
> (number/deductible/coverage desc/limit/agent ×3); "State Farm" sub-header interpolates from the policy; Save Term
> / Cancel CTAs; ZERO console errors. Mobile (393px): 2-col field pairs reflow to single-column stacked, full-width
> pickers/inputs, NO horizontal overflow (NORTH_STAR #3), Save FAB pins bottom. No defect — DON'T re-shoot.
> Remaining never-shot real surfaces: the odometer entry forms (/vehicles/[id]/odometer/new) + the insurance term
> EDIT form; after those the surface set is fully eyes-on.
>
> **AUDITED C106 (feature eyes-on) — the FULL POPULATED dashboard CLEAN desktop + mobile (the primary landing
> surface, only ever partially-shot at C5/C12).** Shot desktop + mobile (Pixel 5) + Read both PNGs. Desktop: 4 KPI
> cards (Total Vehicles 4 / Total Expenses $21,677.87 / Monthly Average $277.92 / Active Financing 2, subtitle
> matches the vehicle count = consistent), Your Fleet (3 vehicle cards + Add-Vehicle), Trends + Category charts
> (canvas blank = C26 IO-gated headless limit, not a defect), Recent Activity (incl. the $900 split payment),
> Upcoming Reminders, Recurring Costs $460.50/mo. Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — KPIs
> reflow to a 2×2 grid, "Log Fill-up" mobile CTA present, FAB pins full-width; figures consistent. No defect; DON'T
> re-audit. The dashboard's populated state now joins the fully-eyes-on set.
>
> **AUDITED C96 (feature eyes-on) — /profile CLEAN desktop + mobile → EVERY REAL SURFACE NOW EYES-ON.** The last
> never-shot real surface (the C93 pointer). Shot desktop + mobile (Pixel 5) + Read both PNGs. Desktop: Identity
> (avatar, editable Display Name, Email, Member Since "June 2026" = correct), Connected Accounts (Google + unlink +
> Link GitHub), Sessions (Coming Soon), Data & Privacy (Export-all-data working button + "images not included"
> disclosure; Delete = Coming soon), Sharing + Notifications (Coming Soon). Coming-Soon cards are clean intentional
> placeholders, not broken. Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — all label↔value rows reflow.
> Zero console errors. No defect; DON'T re-audit. MILESTONE: every real surface is eyes-on
> (dashboard/analytics/insurance/financing/maintenance/recurring-dialog/settings/profile + the list pages). The
> feature category is now fully exhausted of self-authorizable work — import-trackers stays Angelo-gated.
>
> **AUDITED C93 (feature eyes-on) — /settings CLEAN desktop + mobile (the never-shot backup/restore + provider
> + unit-prefs crown-jewel).** /settings had ZERO prior eyes-on (vs /reminders ×12, /insurance ×12, /financing ×10,
> /expenses ×10, /analytics ×5) — a NORTH_STAR #1 (data-safety) + #3 (mobile) surface never visually verified. Shot
> desktop + mobile (Pixel 5) + Read both PNGs. Desktop: Profile card + Appearance (Light/Dark/System) + Unit
> Preferences (Distance/Fuel/Charge/Currency selects) + Install App (PWA) + Storage Providers (Download Backup /
> Restore buttons, Default Photo Source picker, a "Connected" e2e fake provider card with edit/delete + ZIP toggle).
> Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — the 3-col theme grid + wide unit selects + Save-Settings
> FAB all reflow; FAB pins bottom. Zero console errors. The mid-page dark FAB in the desktop full-page shot is the
> known fixed-FAB capture artifact. No defect; DON'T re-audit. With this, the only remaining never-shot REAL surface
> is /profile (/trips is a "Coming Soon" placeholder; /privacypolicy + /termsofservice are static legal copy) — after
> /profile, every real surface is eyes-on and the feature category is fully Angelo-gated.
>
> **GUARDED C113 — the financing PUT /:financingId/payoff cross-tenant IDOR gap (4th route gap via the audit
> method).** The systematic cross-tenant-idor.test.ts sweep covers financing's DELETE + PATCH/payment-amount but
> SKIPPED PUT /payoff — a state-changing route on the SAME validateFinancingOwnership gate (routes.ts:219). A
> cross-tenant payoff lets A mark B's financing paid-off (deactivateFinancing → isActive=0 + severs source link), a
> destructive write on B's data. Exercised functionally (deactivate-hook test as owner) but never cross-tenant
> tested. +1 expectDenied in the financing IDOR case (reuses B's seeded fid). Non-vacuous (drop the payoff gate →
> financing IDOR test RED). PATTERN (C108/C109/C110/C113): the route-coverage audit method has found 4 real
> route gaps in 4 cycles — definitively productive. NEXT: audit the remaining domains' state-changing routes vs the
> IDOR sweep (odometer PUT, insurance term/claim PUT/DELETE — verify each is in cross-tenant-idor.test.ts). Don't re-add.
>
> **GUARDED C109 — the untested /vehicle-expenses analytics route's cross-tenant ownership gate (2nd
> route-ownership gap in 2 cycles).** Mapped the analytics domain's 13 route handlers vs HTTP-harness coverage →
> 4 routes had ZERO route-level coverage (/quick-stats, /cross-vehicle, /year-end, /vehicle-expenses).
> /vehicle-expenses is the highest-leverage: the only one of the 4 with a `validateVehicleOwnership` cross-tenant
> gate (routes.ts:147) — the SAME guard analytics-routes-http.test.ts already pins for vehicle-tco/health/fuel-*
> (C185/C290), but this route was the one it never covered. Repo method unit-tested; route guard-drop leaks
> another tenant's per-vehicle expense analytics (C109/#52 class). +3 in analytics-routes-http.test.ts: owned→200,
> foreign→404 (no leak), missing-required-vehicleId→400. Non-vacuous (drop the gate → foreign-id test RED).
> PATTERN CONFIRMED (C108 sync-status + C109 vehicle-expenses): mapping route-endpoint coverage finds REAL
> ownership gaps — the HTTP-harness vein is productive, not the "fixed point" the C103/C107 claims asserted. NEXT:
> the 3 remaining untested analytics routes are user-scoped (no per-vehicle gate, thinner); check OTHER domains'
> unmapped endpoints by the same method. Don't re-add the vehicle-expenses pin.
>
> **CHARACTERIZED C102 — the #148 null-initialMileage lease burn-bar invariant, as a red→green anchor (NOT a
> fix).** Audited the lowest-coverage money file (financing-calculations.ts, 75% line) — `calculateLeaseMetrics` is
> already extraordinarily well-tested (30+ cases + 2 fast-check properties incl. #64/#91/#110), so it's saturated
> EXCEPT the one genuinely unguarded branch, which is the #148 escalation itself: the gate requires
> `initialMileage !== null` for mileageUsed, with a test for null current but NONE for null initial. Since #148 is a
> PARKED product call, did NOT fix — pinned the CURRENT behavior (null initial → used 0 / remaining full) + the
> contradiction (initial=0 → used 30000) in lease-metrics.test.ts. Non-vacuous (apply the `?? 0` fix → the
> characterization flips RED). #148 is now test-anchored + ready: the fix is a 1-line gate change + flipping this
> test when Angelo rules. The FE-logic deep-review surface is largely certified now. Don't re-audit calculateLeaseMetrics.
>
> **CERTIFIED C92 — the rate-limit / client-IP abuse-prevention surface CLEAN + already comprehensively guarded
> (a NEW area, not in the prior audited set).** Security-load-bearing: a spoofed-XFF bypass would let an attacker
> get a fresh per-request rate-limit bucket → defeat the auth brute-force limiter. Audited 3 layers firsthand, ALL
> clean + guarded — DON'T re-audit: (1) `getClientIp` (utils/client-ip.ts) derives from the REAL socket and honors
> X-Forwarded-For ONLY behind a configured trusted proxy (default ignores it); client-ip.test.ts (C265) pins all 4
> trust branches + empty/multi-hop XFF edges + the "different-XFF-from-one-socket share a bucket" bypass-closed
> assertion. (2) the fixed-window limiter (middleware/rate-limit.ts); rate-limit.test.ts (C112) pins
> window-open/up-to-limit/over-limit-429-with-headers/body/key-isolation/reset + a disableRateLimit vacuity guard.
> (3) the wiring — auth keys on `auth:${getClientIp(c)}` (trusted IP, not raw header); sync/backup/restore/trigger
> key on user.id. The keyGenerator one-liners aren't worth a dedicated guard (coverage theater, C181/C229). No
> defect; recorded clean, did NOT manufacture (GUIDE agent-HIGH-often-false + C86 saturation discipline). NEXT
> deep-review: another genuinely UNAUDITED surface (CORS/CSRF origin config, bodyLimit/zip-bomb upload guards, or
> the session/cookie lifecycle) — the eyes-on + data-safety veins are exhausted.
>
> **SCOUTED C86 — deep-review surfaces SATURATED (4 candidates verified already-guarded firsthand; no
> manufacture).** With the backend correctness surfaces broadly certified, scouted 4 fresh candidates and found
> EACH already well-guarded — DON'T re-audit: (1) the FE sync-manager RETRY/BACKOFF path — sync-manager.test.ts
> pins retry-count tracking, the maxRetries hard cap, the `retryDelay * 2^retries` EXPONENTIAL backoff, the
> no-reschedule-at-cap, #121 retry-conflict-surfacing, #134 orphan-resurrection (the C67/C81 "next vein" pointer
> is now STALE — that path got covered since); (2) `determineConflictType` (sync-manager.test.ts:562+, the C67
> cert); (3) `computeTCOTotal` — the #27/#28 double-count-avoidance rule (purchasePrice all-time-only +
> purchasePrice-counted⇒exclude-financing-payments) is directly pinned in per-vehicle.property.test.ts:411
> (`#27` block) + Property 14 (bucket-sum) + the #33 mis-bucket block; (4) the reminder-NOTIFICATION read path —
> feed newest-first + #142 mileage-null-sorts-first + mark-read/unreadOnly/404 (notifications-feed.test.ts) and
> the per-milestone (reminderId,dueOdometer) dedup incl. re-arm + both-axes no-collision (trigger-mileage.test.ts,
> C256). Recorded saturated; did NOT manufacture a redundant cert (the GUIDE "agent-HIGH-often-false" + C12
> "structural-floor, don't force ceremony" discipline). The one deep-review vein that still pays is EYES-ON of a
> never-shot surface (E2E can't catch never-rendered fields, the C68 lesson) — ~~NEXT: the recurring-expenses
> MaterializedExpensesDialog / ⟳ badge in a POPULATED state~~ **DONE C88 (feature eyes-on): the dialog POPULATED
> state is certified CLEAN — created an overdue monthly $150 reminder, triggered 7 catch-up rows ($1,050), opened
> the dialog scoped past the e2e reminders via the per-card data-testid, Read the PNG: header + subtitle (reminder
> name interpolated) + "7 expenses · $1,050.00 total" + each Financial · {date} · Daily Driver · $150.00 row, zero
> console errors, full FE→BE→DB→render round-trip. The ⟳ badge was eyes-on at C9. With this, EVERY populated
> surface is now eyes-on (dashboard/insurance/financing loan+lease/maintenance/recurring dialog) — the eyes-on vein
> is exhausted; the next still-paying deep-review/feature work is a backend correctness audit of a genuinely
> UNAUDITED surface or an Angelo steer, NOT another render shot.**
>
> **AUDITED C82 — /financing LOAN render eyes-on sweep, CLEAN.** Shot the Toyota Camry loan vehicle (BoA
> 4.5% APR, $20k/60mo) FinanceTab desktop + Read the PNG (C68 covered the LEASE path; this is the unshot loan +
> PaymentMetricsGrid + amortization path). Renders correct: Next Payment $372.86 (Monthly · Loan · 4.5% APR),
> Payment Progress 5% ($20,000/$900/$19,100), all 4 PaymentMetricsGrid cards with correct loan math (Principal
> vs Interest $297.86+$75; Payments 1/60; Payoff Mar 2031 59mo; Total Cost $22,371.63, 12% over) — the figures
> the #92/#117/#139 0%-APR fixes touched — + Payment History ($900 Extra Payment split, Remaining $19,100). The
> Amortization chart area is BLANK = the C26 IO-gated-chart headless-capture limit (visibility-watch
> IntersectionObserver doesn't fire in a full-page shot), NOT a defect: /analytics/financing returns a
> populated loanBreakdown (12 entries) firsthand. DON'T re-audit. Next eyes-on vein: the recurring-expenses
> dashboard widget populated, or a remaining un-shot surface.
>
> **AUDITED C75 — /insurance eyes-on sweep, CLEAN (a suspected defect debunked firsthand).** Shot
> /insurance DESKTOP + MOBILE with 7 seeded policies + Read both PNGs. Renders the data + four-states clean:
> PolicyCard (Current Term Expires/Total Cost/Monthly/Vehicles), Documents EMPTY ("No documents uploaded yet"),
> Claims EMPTY + a populated "Collision · Settled" claim, "Expired" term badges (correct — seed term dates
> predate now) + Renew. MOBILE: no horizontal overflow (NORTH_STAR #3); all sections reflow; FAB pins bottom.
> DEBUNKED: "Active Policies" header vs "Expired" badges is NOT a contradiction — groupPoliciesByActive splits
> on `policy.isActive` (lifecycle: Active/Inactive sections) while "Expired" is the per-TERM currency (lapsed
> term → Renew affordance); an active policy with an expired current term is the intended state. /insurance is
> sound — DON'T re-audit. (The mid-page dark New-Policy button in the desktop full-page shot is the known
> fixed-FAB capture artifact.) Next eyes-on vein: the /financing populated render, or the recurring-expenses
> dashboard widget in a populated state.
>
> **CERTIFIED C81 — the backup-EXPORT serialization round-trip CLEAN + the OPTIONAL_BACKUP_FILES drift seam
> guarded.** Audited createBackup → exportAsZip → parseZipBackup firsthand. Already well-guarded (DON'T
> re-audit): createBackup keys === TABLE_SCHEMA_MAP (C208 part B); SCHEMA_MAP keys === FILENAME_MAP keys +
> schema-table coverage (C208 part A); export + restore derive columns from the SAME getTableColumns →
> schema-symmetric; coerceRow numeric (#68/#209) + JSON round-trips covered by the populated round-trip suites.
> GAP found: getRequiredBackupFiles() = FILENAME_MAP values MINUS the hand-maintained OPTIONAL_BACKUP_FILES set,
> coupled only by literal strings — an OPTIONAL entry drifting from the map (typo/rename) makes a real backup
> file REQUIRED → a valid older backup missing it fails restore ("Missing required files"), NORTH_STAR #1.
> Certified firsthand zero orphans today. GUARD: exported OPTIONAL_BACKUP_FILES + a 3rd test in
> backup-table-coverage.test.ts (OPTIONAL ⊆ FILENAME_MAP values); non-vacuous (drift a map value → RED). The
> backup export/restore round-trip is now broadly certified — next deep-review: the FE offline sync-manager
> retry/backoff path, or an eyes-on /financing populated render.
>
> **CERTIFIED C74 — the CSV-import idempotency key `deriveImportClientId` FIELD-SENSITIVE + directly guarded.**
> The crown-jewel import data-safety contract (re-import = no-op via createIdempotent's (userId, clientId)
> unique index, yet two genuinely-different rows must get DISTINCT keys so both land) was driven only
> transitively through import-csv.test.ts round-trips that NEVER compare two rows differing in ONE field, and
> the fn was module-PRIVATE. GAP: drop a field from the `content` hash (tags/missedFillup/…) → two rows
> differing only in that field collide → the second silently dropped on import → NORTH_STAR #1 loss, invisible
> to every test. Certified firsthand all 11 content fields flip the key + determinism. GUARD: exported the fn +
> import-client-id-field-sensitivity.test.ts (+14, one mutation per field at the same occurrence; non-vacuous —
> drop a field → that field's test RED). DOCUMENTED NUANCE (mitigated, not fixed): tags join with '' so
> `['a','b']`/`['ab']` share a segment, BUT buildImportPlan's occurrence counter distinguishes within-file
> collisions → distinct final keys. ALSO scouted + found ALREADY-GUARDED (don't re-audit): the FE sync-manager
> `determineConflictType` (sync-manager.test.ts:562-642) + the import round-trip (lossless/idempotent/#102/#137/
> formula-injection all in import-csv.test.ts). Next deep-review: an eyes-on /insurance or /financing render
> sweep, or the backup EXPORT serialization round-trip.
>
> **CERTIFIED C67 — the sync-worker retry-ceiling coupling CLEAN + guarded (cross-module source-scan).**
> The background photo sync-worker's #144 terminal-auth park (retryCount → `MAX_RETRY_COUNT`) and the
> `photoRefRepository.findPendingOrFailed` work-set predicate (`retryCount < 3`) share ONE retry ceiling
> living as TWO hand-written literals in separate modules, coupled only by a comment. Certified the runtime
> behavior is correct today (park at 3 → dropped from the work set). GAP: nothing pinned the coupling — drift
> the query bound to `< 5` and a parked terminal-auth ref (3 < 5) is re-picked forever → the #144 fix silently
> breaks, and the #144 test (asserts magic `retryCount: 3`) stays GREEN. GUARD: exported `MAX_RETRY_COUNT` +
> `sync-worker-retry-ceiling-sync.test.ts` (+3) — imports the constant, source-scans the repo's
> `${photoRefs.retryCount} < N`, asserts `N === MAX_RETRY_COUNT`; re-pointed the #144 test's literal at the
> constant too. Non-vacuous (drift → RED with the "re-picked forever" diagnostic). The one-edit→source-scan
> pattern (C25/C45/C59) on a CROSS-MODULE invariant. ALSO verified firsthand the rest of the sync-worker is
> well-covered (backoff math, in-flight eviction, terminal-auth #144, path-resolution fail-soft all pinned in
> sync-worker.test.ts) — don't re-audit. Next deep-review: an eyes-on /insurance or /financing render sweep, or
> the FE offline sync-manager conflict path.
>
> **CERTIFIED C60 — the `createProviderInstance` fake-provider production-safety gate CLEAN + guarded.**
> registry.ts double-gates the `fake` storage provider — instantiates FakeStorageProvider (in-memory, no
> bytes leave the process) ONLY when CONFIG.allowFakeStorageProvider (ALLOW_FAKE_STORAGE + NODE_ENV !==
> production), else throws; a fake row reaching production would silently swallow every backup/photo upload
> (NORTH_STAR #1). The ROUTE-create gate was pinned; this REGISTRY-instantiation gate (the layer restore/
> sync resolve a live provider through) was not. +2 in registry.test.ts (test env has the gate off → fake
> throws; the gate short-circuits BEFORE decrypt — garbage creds still throw the gate error). Non-vacuous
> (remove the gate → both RED). ALSO verified firsthand the provider CREDENTIAL surface is ALREADY guarded
> (formatProviderResponse omits credentials GET/POST/PUT + C260 re-encrypt, C416 config, #63 tenant-scope,
> C254 builder branches) — don't re-audit. Next deep-review: the sync-worker retry/backoff path, or an
> eyes-on /insurance render sweep.
>
> **CERTIFIED C53 — `buildTCOMonthlyTrend` (the TCO monthly cost series) CLEAN + guarded.** The per-month
> TCO series the chart renders was driven only transitively through getTCO; no test pinned its bucketing.
> Certified firsthand: buckets by (category, sourceType) — financial+financing→financing,
> financial+insurance_term→insurance, fuel→fuel, maintenance→maintenance (the TIME mirror of
> categorizeTCOExpenses/C33); an UNCATEGORIZED row (financial+reminder/null, regulatory/enhancement/misc)
> contributes to NO bucket (the deliberate "4 named categories only" trend contract); same-month
> co-accumulate; ascending sort; dateless dropped. +6 in tco-monthly-trend.test.ts; non-vacuous (drop the
> financing sourceType guard → 3 RED). ALSO verified firsthand that buildAmortizationSchedule + its caller
> buildLoanBreakdown (incl. the #139 0%-APR-survives GET) are ALREADY guarded — don't re-audit them. The TCO
> money path (total C33 + trend C53) is now broadly certified. Next deep-review: an eyes-on /insurance or
> /financing render sweep, or the auth/provider path.
>
> **CERTIFIED C46 — insurance `monthlyPremiumTrend` month-bucketing CLEAN + guarded.** The per-month
> premium SERIES the analytics trend chart renders (accumulateMonthlyPremiums→monthKeysInRange) was driven
> only transitively through getInsurance; no test pinned the bucketing (the C6/C18 "helper output never
> asserted" gap). Certified firsthand: a term adds its premium to EACH spanned month (day-1, inclusive
> both ends); overlapping policies SUM in shared months; a totalCost-only term spreads its amortized
> monthly value per-month. +3 in insurance-details.test.ts; non-vacuous (add-once → RED). FIRSTHAND HARNESS
> FINDING: the file's shared `term()` helper seeds raw MS via direct SQL, but the columns are Drizzle
> `mode:'timestamp'` (SECONDS) — so seeded dates read ~1000× too large; the PRODUCTION path is clean (the
> route writes via the ORM ÷1000), and the date-independent existing tests masked it. Added a local
> `termSeconds` seed; left the shared helper alone (changing it risks the date-relative #14/#25 tests). The
> sync-manager conflict path + insurance premium MATH were checked firsthand and found ALREADY well-guarded
> — don't re-audit them. Next deep-review: a genuinely different surface (the analytics TCO monthly-trend
> builder, the financing amortization schedule eyes-on, or an eyes-on /insurance render sweep).
>
> **CERTIFIED C3:** the photo-entity-type allowlist is in sync across all THREE paths (upload gate /
> restore validator / provider routing) and now pinned by `photo-entity-type-allowlist-sync.test.ts`
> (non-vacuous — reproduces the C404 drift). Don't re-audit this surface; it's guarded. Next deep-review
> veins: the Google Sheets backup round-trip (header-set coverage — but #36/#37 fixes are parked for
> Angelo), the offline outbox→sync field-mapping (the #66/#101/#111 dropout family — ALREADY guarded:
> offline-storage.test.ts has a C347 completeness pin covering every OfflineExpense field), or a fresh
> data-safety write path.
>
> **GUARDED C4:** the financing-sourced split → displayed-balance money round-trip
> (`split-financing-balance-roundtrip.test.ts`, end-to-end POST/PUT /split → GET /vehicles/:id). The
> repository-level balance property test + the C2 #147 route-status tests both pre-existed; this pins the
> observable `computedBalance` math itself. Don't re-add.
>
> **GUARDED C6:** `monthsBetween` (analytics money divisor) now has a direct unit net in
> tco-months-owned.test.ts (+6: year×12+delta, same-month, cross-year, multi-year, signed-negative) —
> closes the C181/C229 "helper imported-but-only-comment-referenced" isolation gap. Non-vacuous
> (dropping `*12` → 3 RED). Don't re-add.
>
> **CERTIFIED C8:** the restore `stampUserId` cross-tenant-write chokepoint. The guard
> (restore-userid-stamp.test.ts) now covers TWO tables — vehicles + insurance_policies. Firsthand finding:
> LEAF tables (expenses/reminders) are belt-and-suspenders (validateBackupData rejects a foreign userId
> against the metadata set), but ROOT tables whose validation checks only `id` (insurance — and by the
> same logic photos/userPreferences/syncState) rely on the stamp ALONE. insurance is now pinned;
> photos/prefs/syncState remain stamp-only-unguarded if a future deep-review wants to extend the net (same
> tamper recipe). Non-vacuous (dropping the insurance stamp → only the new case RED).
>
> **GUARDED C11:** extended the stamp guard to `photos` (the C8 follow-on) — restore-userid-stamp.test.ts
> now covers vehicles + insurance + photos. Non-vacuous (dropping the photos stamp → only the new case
> RED). REMAINING stamp-only-unguarded: userPreferences/syncState — but those are PK'd by userId, so a
> foreign-id row is a PK COLLISION (caught), not a silent cross-tenant write → LOW priority, likely not
> worth a dedicated cycle. The cross-tenant-write chokepoint is now guarded on every root table where a
> silent mis-stamp was actually possible (vehicles/insurance/photos).
>
> **CERTIFIED C13:** the replace-mode restore wipe+reinsert FK-ordering — `restore-replace-delete-ordering
> .test.ts` seeds a COMPLETE FK-linked dataset, replace-restores, and asserts every table round-trips to
> its exact pre-restore count (+ a double-replace idempotency case). Firsthand finding: the DELETE order
> is cascade-redundant; the load-bearing constraint is the INSERT order (parent-before-child) in
> insertBackupData — non-vacuous (relocating the financing insert before vehicles → RED). The restore
> data-safety path is now well-pinned (stamp C8/C11 + table-coverage C208 + this ordering guard).
>
> **AUDITED C19 — all CLEAN (foreign-import money/date) + eyes-on cert.** Sheets service (header-coverage
> saturated), csv-safety (round-trip saturated), import-mapping normalizeDecimal (comma-only=EU-decimal is
> BY DESIGN — debunked a thousands-bug candidate via the #124 lesson) + normalizeForeignDate (local-time /
> mdy-dmy / epoch / 2-digit-year / #23 out-of-range all pinned). No defect. ALSO eyes-on certified the C16
> MaterializedExpensesDialog EMPTY state (future-dated reminder → "No expenses yet" renders clean). The
> backup/restore/import data-safety surfaces are now broadly swept — next deep-review should pick a
> genuinely UNAUDITED area (e.g. the analytics financing/TCO money builders, or an eyes-on sweep of a
> complex shipped page like /analytics or /insurance) rather than re-scanning backup/restore/import.
>
> **CERTIFIED C39 — OAuth-state CSRF consume CLEAN + behaviorally guarded.** The `oauthStateStore`
> single-use token is correct across login/link/provider flows: single-use (replay rejected),
> flow-isolated (login state ≠ link/provider), anti-fixation (mismatched/unknown deleted on lookup),
> null-safe — certified firsthand. The prior coverage was brittle source-string scans (pinned no
> behavior); extracted `consumeOAuthState` (auth/utils.ts) + +9 behavioral guards (consume-oauth-state
> .test.ts) + replaced the 2 scans with wiring checks. The login/link validators delegate; the provider
> path keeps its inline consume (extra PKCE assertion). Don't re-audit the state lifecycle; it's pinned.
> #129 (login email-sync) still lives here as an OPEN product call. Next deep-review: a different surface
> (eyes-on /insurance sweep, or the offline sync-manager conflict path).
>
> **CERTIFIED C33 — TCO `categorizeTCOExpenses` sourceType-bucketing CLEAN + guarded.** A `financial` row
> buckets by sourceType: 'financing'→financingInterest, 'insurance_term'→insurance, ANY OTHER (reminder
> from C27 recurring / null manual) → otherCosts. Certified firsthand (reminder/null → otherCosts, not
> financing) + pinned with +2 cases in per-vehicle.property.test.ts (the 4-way split + the PRICED case
> where a mis-bucket would silently drop a recurring cost via #27). Non-vacuous (drop the financing clause
> → both RED). The TCO money path (#27/#28 financing/price + this sourceType bucketing) is now broadly
> certified — don't re-audit it. Next deep-review: a genuinely different surface (eyes-on /insurance sweep,
> or the auth/OAuth path).
>
> **AUDITED C26 — /analytics eyes-on sweep, CLEAN (3 suspected defects debunked firsthand).** Shot empty
> (clean four-states) + seeded fuel data for the populated state. Debunked: (1) "Avg km/L" on a USD user
> is correctly unit-DERIVED (`getFuelEfficiencyLabel`), not hardcoded — no efficiency literal in the
> render path; (2) blank gray chart boxes are ChartCard's deliberate IO-gated Skeletons (lazy `{#await
> import()}` tabs + `visibility-watch.svelte.ts` gate — UIQuality "no blank box"), not a render defect;
> (3) the missing chart svg is the IO gate not flipping in headless capture (harness limit, not a bug).
> Populated Fuel & Stats stat cards render correct (Fuel Consumption 30.2 km/L, Best/Worst color
> semantics, trend deltas). /analytics is architecturally sound — DON'T re-audit it; it's clean. **HARNESS
> NOTE for future eyes-on cycles:** IO-gated charts ([data-slot="chart"] svg) do NOT paint in a headless
> full-page shot.sh (no real viewport intersection). To eyes-on a PAINTED analytics chart you need a real
> scroll/intersection trigger; the stat-card layer (renders unconditionally) is always capturable. Next
> deep-review: a still-unaudited surface (the analytics financing/TCO money builders, or /insurance eyes-on).

### bug
> **VEIN STATUS (C243): the eyes-on visual-sweep bug vein is now SATURATED.** The C239 unblock opened a fresh
> bug-scout vein (shoot un-shot routes for NORTH_STAR #3 defects pure-logic/unit tests miss). Across C239–C243 all
> 4 data-bearing core routes were swept + Read desktop+mobile, ALL CLEAN: dashboard+analytics (C239), expenses
> (C241), vehicle-detail (C242), settings (C243). Each clean scout that had an UNGUARDED invariant left a guard
> (C239 fuel-empty-state, C241 FAB-clearance, C242 chart-gate); C243 found settings ALSO already-guarded → recorded
> clean, no manufactured guard. Only /reminders remains un-shot (needs seeded reminders; surface mirrors covered
> ones). So like the pure-logic surface before it, the VISUAL surface is now worked through — future bug cycles
> need a FRESH feature surface or an Angelo-unblocked gate, else they're dry scouts. Don't re-sweep these 4 routes.

> **CLOSED C234 — the C233 best-effort-contract class's SIBLING on the vehicle-delete path (500-after-delete +
> skipped #88/#97 cleanup).** Scouting the C233 lead found two UNGUARDED secondaries `await`ed AFTER
> `vehicleRepository.delete()`: `pruneSplitConfigsForDeletedVehicle` (#88) + `deactivateVehicleless` (#97).
> Fault-injected firsthand: a throw → 500 but the vehicle is already deleted (0 rows) → FE shows "failed", retry
> 404s, AND the orphaned-split-leg / vehicleless-reminder normalization never ran (the exact states #88/#97
> prevent). Clean fix (best-effort by intent — the delete is done, the next /trigger self-heals the normalization;
> not a semantics call): wrapped the two cleanups in a log+swallow try/catch, returning the earned 200. +1 guard
> in vehicle-delete-cascade.test.ts (fault-inject → still 200 + vehicle deleted); non-vacuous (revert → 500 RED).
> The best-effort-contract class is now closed on BOTH trip-create + vehicle-delete; swept siblings
> (odometer/expense recheck = C42-guarded, insurance/reminder = cleanup-before-primary or already try/caught) were
> correct. Don't re-fix.

> **CLOSED C233 — best-effort-contract violation on the trip CREATE D2 side-effects (a 500 + duplicate-on-retry
> class), found by a deep-review.** The trip POST comments its D2 side-effects "best-effort … never fails the
> create", but only recheckMileageReminders is internally guarded (C42); `odometerRepository.createFromTrip` is a
> plain repo write whose dedup SELECT/INSERT CAN throw a DatabaseError, left UNGUARDED in the route. Fault-injected
> firsthand: a createFromTrip throw → 500 response, but the trip row ALREADY committed → FE shows "failed", user
> retries → DUPLICATE trip + odometer entry. Clean correctness fix (matching the route's OWN stated contract + the
> odometer/expense sibling best-effort pattern — not a semantics call): wrapped the D2 block in a log+swallow
> try/catch, returning the earned 201. +1 guard in trips-http.test.ts (fault-inject → still 201 + persisted);
> non-vacuous (drop the try/catch → 500 RED). Don't re-fix.

> **CLOSED C230 — CRASH-class defect on the C227 TripForm: submit threw `raw.trim is not a function`, the form
> could NEVER create a trip (self-introduced C227, caught by driving the REAL form).** A C230 bug-scout on the
> fresh TripForm write path: `parseOdometer` did `raw.trim()` assuming a string, but Svelte COERCES an
> `<input type="number">` bind:value to a NUMBER (or null when cleared) — so startOdometer/endOdometer hold
> numbers once typed. `(1000).trim()` → TypeError thrown OUTSIDE handleSubmit's try → clicking "Log Trip"
> silently did nothing. VERIFIED FIRSTHAND via Playwright fill+submit (pageError + trips 0→0), then re-verified
> the fix (trips 0→1, no errors). C227's eyes-on only OPENED the dialog + ran a curl E2E — never filled+submitted
> the real form, so the crash hid; unit tests passed because they fed strings. FIX: parseOdometer tolerates
> string|number|null (typeof-guard, the ExpenseForm parseInt/parseFloat pattern); form state typed to match;
> exported parseOdometer + routed submit through it (kills the parseInt-vs-Number asymmetry). +4 guards (number/
> null/mixed/parseOdometer-table). FE validate green (842). **LESSON: a UI feature's eyes-on MUST drive the real
> user action (fill+submit), not just render the surface.** Don't re-fix.

> **CLOSED C226 — REAL date/tz future-guard defect on the C210 trips CREATE/PUT (the gold #87/#106 seam, self-
> introduced + caught before the form lands).** A C226 bug-scout (bug most-starved, 5/3) on the soon-to-be-form-
> backed create-date path probed the GUIDE's date-off-by-one seam firsthand: `createTripSchema`'s future-guard was
> `tripDate <= new Date()` (an ABSOLUTE-instant compare), but the FE contract sends `dateOnlyToISO(date)` = NOON
> LOCAL. With the server clock before local noon, today-at-noon-local is HOURS in the "future" vs `now` → a trip
> dated TODAY 400s "tripDate cannot be in the future" (probe: server 03:06 UTC → today rejected, gap +8.89h). The
> form's own default action (log today) would break for the entire local morning, every day. NOT a semantics call:
> R5 mandates LOCAL-CALENDAR-DAY semantics + there is NO ratified reject-future requirement (the guard was my own
> C210 addition) → the instant-vs-day comparison is simply wrong. FIX: extracted `notFutureLocalDay` (compare
> against END of the current LOCAL day, 23:59:59.999) wired into BOTH create + update schemas. +2 guards in trips-
> http.test.ts (today-as-noon-local → 201; tomorrow-as-noon-local → 400, dynamically computed so they pin the
> exact bug); non-vacuous (restore the absolute-instant guard → ONLY the today case RED, verified firsthand).
> Backend-only (Zod) → no shot. validate:local GREEN (1908 pass, +2). The #87/#106/#39 date-off-by-one family now
> closed on the trips write path (sibling to C211's PUT asymmetry on the same C210 surface). Don't re-fix.

> **CLOSED C221 — REAL silent-truncation defect on the C220 trips list page (self-introduced, caught same-arc).**
> A C221 bug-scout on the FRESH C220 list page found it called `tripApi.list()` (route default limit=20) + read
> only `tripPage.data` with NO paginator, while the Mileage Summary card reads `getSummary()` = ALL trips → a
> >20-trip user saw the summary count exceed the 20 visible cards with no signal (the page-1-masquerades-as-all
> class). FE-only UX correctness fix: request the max page (limit:100) + capture totalCount + a "Showing N of M
> trips" footer when truncated (full paginator deferred to T6b-2). Eyes-on re-shot — no regression, footer
> correctly absent at 2-of-2. FE validate green (826). Don't re-fix. (The loop as designed: C220's fresh UI made
> the bug vein live; the next scout caught the self-introduced defect.)

> **🚩 ESCALATED C214 (semantics call, NOT auto-fixed — characterization-pinned, awaiting Angelo) — the
> trips↔odometer EDIT/DELETE lifecycle.** The C213 D2 linkage writes an odometer entry on trip CREATE, but it
> has NO lifecycle tie back: editing a trip's endOdometer (fat-finger 5000→500) or deleting the trip leaves the
> original 5000 odometer entry → getCurrentOdometer stays stale 5000, poisoning maintenance-reminder + lease-
> overage (the #76/#244 stray-reading class), no user signal. SEMANTICS call: (a) independent-observation
> (current — consistent with D2 dedup; no schema) vs (b) owned-child (edit updates / delete cascades — needs an
> odometer_entries source-link schema+migration+backup slice) vs (c) hybrid (delete-cascades, edit-keeps).
> send_message C214 filed it; recommended (b) for data-quality. Characterization-pinned in trips-http.test.ts
> (the current (a) behavior) so the chosen fix flips a RED test (the #148 anchor pattern). Do NOT build until ruled.

> **CLOSED C211 — REAL write-path validation-asymmetry defect on the C210 trips PUT (the gold seam, self-
> introduced + caught same-arc).** A C211 bug-scout — LIVE again because C210 added fresh trips routes/validation
> — probed the GUIDE's gold seam (write-path asymmetry) on the new PUT and found it firsthand: `PUT {endOdometer:
> 500}` on a trip stored start=1000/end=1080 returned 200 and PERSISTED an inverted pair. Cause: updateTripSchema's
> R2 refine fires only when BOTH odometers are in the body, so a partial PUT touching one bypassed R2 against the
> STORED value (#109 refine-doesn't-survive-partial + #130 validate-the-merged-state class). Impact: tripDistance=
> max(0,end−start) clamps to 0 → a phantom 0-mile trip in T5 + a record the create path rejects. FIX: the PUT
> handler re-checks the EFFECTIVE merged pair (request ?? stored) against R2 before writing (using the row
> validateTripOwnership returns). +3 guards in trips-http.test.ts (both invert directions → 400 + a valid partial
> → 200, no false reject); non-vacuous (neuter → the 2 invert cases RED). The #109/#130 within-tenant-integrity
> class now closed on the trips update path. Don't re-fix.

> **CLOSED C137 — REAL a11y defect (button-name critical) on BOTH odometer forms; a FRESH vein broke the
> cold-scout drought.** The cold pure-logic precondition (git diff C85..HEAD empty) only rules out regressions in
> CHANGED code, not PRE-EXISTING debt. Scouted NORTH_STAR #3 ("passes axe"): route-smoke enforces a11yClean on the
> 13 STATIC routes but can't reach the DYNAMIC/param routes (no hardcodable id), and axe catches a label/ARIA class
> visual eyes-on misses. AxeBuilder (wcag2a/2aa, serious+critical) over the 7 un-swept dynamic forms found
> `button-name` (critical) on /vehicles/[id]/odometer/new — the icon-only ArrowLeft back-button (ghost/icon) had no
> text + no aria-label (a screen-reader can't name it); the odometer EDIT page shared the IDENTICAL button (2
> instances). FIX: aria-label="Back" on both (the TagInput/ExpenseSearchFilters icon-control convention). The other
> 5 dynamic forms scanned CLEAN (text back-links). Re-ran the scout → all 7 PASS; FE validate green (749). FIRST
> production source change since C85 → the cold-scout precondition baseline RESETS to this commit. Scout spec is
> gitignored; the net is the source fix + the route-smoke a11yClean ratchet. Don't re-fix.
>
> **SCOUTED C122 — no fresh defect (10th consecutive; precondition-recorded dry + PIVOTED to guard). `git diff
> C85..HEAD` over production source EMPTY → regression structurally impossible.** Bug was forced (most-starved
> +5) but provably dry, so per the C99/C103/C107 discipline recorded dry immediately and pivoted the cycle's
> substantive work to the co-productive guard vein: pinned the two foundational zero-coverage analytics primitives
> (`normalizeDate` seconds-vs-ms boundary + `groupByVehicle`; see the guard GUARDED-C122 entry). NEXT bug cycle:
> precondition still holds → record dry + pivot; real defects now come only from a deep-review/feature-surfaced
> invariant or an Angelo steer.
>
> **CLOSED C114 — the insurance TERM routes' cross-tenant IDOR gap (PUT/DELETE /:id/terms/:termId).** The
> route-audit method (C108–C113) applied with the bug lens: systematically compared every state-changing route vs
> the cross-tenant-idor.test.ts sweep → the insurance term routes are gated on validateInsuranceOwnership(id) but
> were NEVER in the sweep. terms-http.test.ts (C272) pins the inner FK defense (foreign vehicleId in the payload)
> but always AS the policy owner — the policy-level cross-tenant gate on the term routes was untested. A
> cross-tenant term edit/delete lets A mutate B's terms + their premium expenses. +2 expectDenied in the insurance
> IDOR case (PUT + DELETE term); non-vacuous (drop the term PUT gate → IDOR test RED). 5th real route gap in 6
> cycles (4 cross-tenant IDOR). REMAINING IDOR-sweep gaps to check NEXT: `PUT /notifications/:id/read` (reminders)
> + `PUT/DELETE /split/:id` (expenses) — both state-changing, neither in the sweep. The cold pure-logic vein stays
> dry (no production source changed since C85); the productive bug axis is now the IDOR route-audit.
>
> **SCOUTED C103/C107 — no fresh defect (8th/9th consecutive; precondition-recorded dry). `git diff C85..HEAD` over
> production source still EMPTY → a regression is structurally impossible, a scout produces nothing.** Also confirmed the C100–C102 FE-logic guard frontier
> is now worked out: the only remaining <90% FE files are expense-api.ts (thin apiClient pass-throughs → testing
> them is C181/C229 coverage-theater) + sync-manager.ts (setupAutoSync DOM-effect wiring [Playwright territory] +
> the already-covered resolveConflict). The load-bearing FE-logic gaps are CLOSED (settings reload C100, theme
> listener C101, #148 anchor C102); residual FE under-coverage is STRUCTURAL (effect/DOM-bound), the FE mirror of
> the BE DI/OAuth tail. Productive work is now ONLY: the Angelo-gated queue (#148 READY w/ anchor, #100/#79/#129 +
> import defaultCategory) or structural coverage (needs Playwright/DI harness — not a normal cycle pick).
>
> **SCOUTED C99 — no fresh defect (recorded dry FAST; 7th consecutive). KEY: `git diff C85..HEAD` over production
> source is EMPTY — nothing has changed since the cold vein was last swept, so a regression is structurally
> impossible.** Per the loop's own C89/C95 recommendation, did ONE firsthand spot-check (buildAmortizationSchedule
> #92/#117/#139 0%-APR money class — CLEAN: 0%-APR→interest=0, principal clamped min(max(0,pay−int),balance), no
> mutation, pinned by amortization-schedule.test.ts) rather than re-running the full sweep on unchanged code.
> NEXT bug cycle: run the 1-line precondition first — if `git diff C85..HEAD` over src is empty, record dry
> IMMEDIATELY + pivot; re-scanning provably-unchanged surfaces is pure ceremony. Real defects now come ONLY from a
> deep-review/feature-surfaced invariant or an Angelo steer.
>
> **SCOUTED C95 — no fresh defect (offline-outbox field-dropout vein #66/#101/#111; 6th consecutive dry scout).**
> Scouted the GUIDE-flagged offline-outbox→backend mapper firsthand. CLEAN: (1) api-transformer.ts
> toBackendExpense/fromBackendExpense is symmetric + complete (volume/charge routed by isElectricFuelType; the
> create-vs-edit description null-clear is a deliberate isEdit option; every optional field round-trips). (2) the
> real call-site dropout class (the mapper can't carry a field the call site never set) is pinned by
> offline-save-carries-fuel-fields.test.ts — source-scans every addOfflineExpense({...}) call for missedFillup
> (#101/#111) + fuelType (#66) — plus api-transformer.property.test.ts for the round-trip. SATURATED (10 test
> files). Recorded DRY, did NOT manufacture. With the cold vein now 6× dry (C6/C10/C15/C83/C89/C95) + NO production
> source changed since C85, NEXT bug cycle: record dry on the FIRST recheck + pivot — the budget is forcing
> ceremony; real defects now come only from a deep-review/feature-surfaced invariant or an Angelo steer.
>
> **SCOUTED C89 — no fresh defect (date/tz + materialization vein; 4 surfaces verified clean firsthand; 5th
> consecutive dry scout).** With C88 having just exercised the reminder trigger/materialization path, scouted the
> date-advance + cost + split-materialization surfaces per the GUIDE date/tz seam. ALL CLEAN: (1) reminder
> date-advance (computeNextDueDate / advanceCustom / clampToAnchorDay) — the Jan-31→Feb overshoot is dodged by
> setDate(1) BEFORE setMonth/setFullYear, then month-end clamp anchored to startDate.getDate(); the
> #12/#13/#107/#114/#116 family (corrupt-frequency/non-positive-interval throws, endDate-boundary
> hasReminderEndedBy, fast-forward non-progress backstop) is all closed + guarded. (2) monthKeysInRange
> (analytics-charts.ts:185, the GUIDE-flagged setMonth site) — cursor anchored to day-1 via the 3-arg
> Date(y,m,1) ctor, rollover-safe (not just commented). (3) reminder-cost.ts annualization (occurrencesPerYear ÷
> 12, the C5/C88 run-rate) — un-fireable shapes → 0, no divide-by-zero. (4) split-materialization
> (createExpenseFromReminder) delegates to the shared expenseSplitService (same code as the regular split flow,
> saturated C2/C4/#88/#98). Recorded DRY, did NOT manufacture (GUIDE agent-HIGH-often-false + the C15/C83 "record
> dry FAST + pivot"). The productive bug surface is now ONLY the parked Angelo-gated queue (#148/#100/#79/#129);
> cold scouts are spent. NEXT bug cycle: record dry immediately + pivot UNLESS a deep-review/feature cycle surfaces
> a concrete invariant or Angelo steers.
>
> **SCOUTED C83 — no fresh defect (write-path validation-asymmetry vein; 3 surfaces verified clean
> firsthand).** With #94 fully closed (C79) and the approved bug queue all gated (#100 arch-gated, #129/#79
> product-calls awaiting steer, #148 parked), ran a fresh write-path scout per the GUIDE bug vein. Verified
> firsthand, all CLEAN: (1) the REMINDER create/update splitConfig path — `refineSplitConfig` already enforces
> splitConfig-vehicleIds === reminder vehicleIds (validation.ts:143), and the route validateVehicleIdsOwned's
> the reminder vehicleIds, so the blob's legs are transitively owned (no #88-style verbatim-write gap on the
> create/update side; #88/#97 were the delete-cascade siblings). (2) the ODOMETER write path — POST/PUT/DELETE
> all validateVehicleOwnership/validateOdometerOwnership before any write (properly tenant-scoped, the #215
> class). (3) the ODOMETER updateSchema `.partial()` — PROBED whether the `recordedAt` future-date refine
> survives `.partial()` (the #109/C372 `.refine()`-dropped class); it DOES, because it's a FIELD-level refine
> (part of the field's own schema, `.partial()` just wraps it in ZodOptional) — UNLIKE #109's object-level
> `.superRefine()`. Already guarded too (update-route.test.ts pins it). Recorded dry + did NOT manufacture a
> finding (the GUIDE bug-vein discipline). The write-path asymmetry seam stays SATURATED (swept #80–#146 + these
> 3). NEXT bug cycle: if still dry, record + pivot fast — the productive defects now come from deep-review/feature
> eyes-on surfacing concrete invariants, not cold write-path scouts.
>
> **SCOUTED C6 — no fresh defect (date/tz vein).** analytics date helpers (monthsOwnedInYear,
> calendarYearRange, toDate, the day-1 month-iteration loop, SEASON_MAP) verified correct + tested; the
> setMonth-overflow trap is avoided. Write-path validation asymmetry was swept C2 (#147 + the
> #62/#109/#125/#145 class closed across all 4 paths). Next bug scout: a DIFFERENT vein — FE store
> race/stale-state, or the analytics fleet-unit-pooling #94 class (but that's product-gated/escalated).
>
> **SCOUTED C10 — no fresh defect (FE store/state vein); a false-positive DEBUNKED firsthand.** app/
> offline/sync-state/theme stores are clean getter-setter holders. Dug into sync-manager: nearly filed
> `checkForExistingExpense`'s `?date=&amount=` params (silently ignored by the backend — not in
> expenseQuerySchema) as an over-broad-match bug, but the EXISTING tests (sync-manager.test.ts:676-689)
> prove the broad finder + narrow `determineConflictType` is a DELIBERATE two-stage design — narrowing
> the finder would drop all `'modified'` conflict detection (a regression). NOT a bug; reverted the draft
> fix. The dead `?date=&amount=` query params are harmless (ignored); leave them. DON'T re-chase.
>
> **SCOUTED C15 — no fresh defect (money/unit/date vein; 3rd consecutive dry scout).** Audited firsthand:
> unit-conversions (math correct + property-tested + callers gas-isolated), calculations.ts MPG/kWh
> pairing (the `previous.missedFillup` exclusion LOOKS over-aggressive but is test-encoded as intended —
> debunk #2), vehicle-stats (clamp-#46/sort-#75 correct), getPeriodStartDate/parseClampedInt/maxOf
> (#70/#81-guarded). **The pure-logic bug surface is EXHAUSTED for this run** — remaining real defects are
> the parked product-gated ones (#94 fleet-units, #30 MPG band). RECOMMENDATION: when bug next goes over
> budget, record dry FAST + pivot; don't re-scan these swept surfaces. Wait for a deep-review/feature
> cycle to surface a concrete defect.

### guard
*(queue empty — repopulate from real bug classes. Pattern: HTTP-harness (createTestApp + s3-provider
seam) or a source-scan committed test. Pure-logic coverage is largely saturated — the live frontier is
the now-shootable eyes-on FE + any newly-touched module.)*

> **CERTIFIED + GUARDED C242 — ChartCard's visibility-gate + four-state contract (eyes-on /vehicles/[id] scout →
> clean → guard).** A C242 eyes-on shot the seeded loan vehicle's Overview + Finance tabs: all render clean
> (insurance "Expired", lease math, empty-states correct). The Amortization/Expense-Trend/Fuel-Efficiency charts
> rendering BLANK in the full-page capture is NOT a defect — ChartCard gates chart children behind `gate.visible`
> (createVisibilityWatch: IntersectionObserver + MutationObserver on the `hidden` tab ancestor) because LayerChart
> mounts into a 0×0 container below-the-fold/inactive-tab → negative-width crash; a headless full-page shot never
> scrolls them into a measured viewport, so they show the gated-state Skeleton (by design). Pinned the gate (was
> untested): +4 source-scan guards in chart-card-visibility-gate.test.ts (createVisibilityWatch; {#if gate.visible}
> gate; Skeleton-not-blank fallback; four-state). Non-vacuous (neuter the gate → 2 RED). **The blank-chart-in-headless
> artifact is now a documented known (see GUIDE) so future shot scouts don't mis-file it.** Don't re-guard.

> **CERTIFIED + GUARDED C241 — the FloatingActionButton bottom-clearance correspondence (eyes-on /expenses scout
> → clean → guard).** A C241 eyes-on shot /expenses desktop+mobile: header/filters/table/split-row all render
> clean (no overflow/console errors). The fixed "Add Expense" FAB overlapping rows in the full-page shot is the
> fixed-in-full-page-capture artifact, NOT a defect — the page wraps content in pb-24 to clear it, and ALL 4 FAB
> pages (expenses/insurance/vehicles[id]/dashboard) are consistent. Pinned the invariant (was untested): +3
> source-scan guards in fab-bottom-clearance.test.ts (any route importing FloatingActionButton must carry a
> pb-{16..40} clearance, else the fixed FAB permanently occludes the last row — NORTH_STAR #3). Non-vacuous (strip
> a page's pb-24 → REDs). Eyes-on bug vein: C239 swept dashboard+analytics, C241 expenses — settings/reminders/
> vehicle-detail remain for future bug cycles. Don't re-guard.

> **CERTIFIED + GUARDED C239 — the analytics FuelStatsTab empty-data four-state gate (eyes-on scout → clean →
> guard).** A C239 eyes-on bug-scout shot /analytics desktop+mobile on the seeded user (fillups all 2024, env
> clock 2026 → the default this-year range is genuinely empty): the tab renders "No fuel data yet" EmptyState
> correctly (NOT ~10 N/A cards / broken chart), and the "$0.00 YTD / N-A mi-gal" is correct date-scoping, not a
> bug. Pinned the certified gate (no analytics component-test harness): +4 source-scan guards in
> fuel-stats-empty-state.test.ts — hasFuelData derived + its conservative OR-of-three (fillup currentYear/
> previousYear OR totalDistance) + the !hasFuelData→EmptyState branch + the loading/error/empty/data four-state.
> Non-vacuous (neuter the gate → REDs). NOTE: the eyes-on visual/state sweep of un-shot routes is a FRESH
> bug-scout vein now that pure-logic is exhausted — future bug cycles can shoot a different core route. Don't re-guard.

> **CERTIFIED + GUARDED C238 — trip-api error PROPAGATION (the loadError/toast contract).** trip-api wrappers
> are thin passthroughs with NO try/catch + apiClient throws ApiError on non-2xx, so a server error MUST reach
> the caller — the /trips list page's loadError four-state (error pane, NOT "No trips yet" masquerade) + the
> TripForm catch→toast both depend on a rejected promise. The wiring tests covered only the resolved path;
> propagation was unpinned (sibling reminder-api/expense-api DO pin rejects.toThrow). +4 in trip-api.test.ts
> (list/getSummary/create/delete reject with the ApiError). Non-vacuous (inject swallow-and-return-[] into list()
> → only the list-propagation test REDs). Don't re-guard.

> **ANCHORED C236 — the trips cross-fleet #94 unit-pooling (escalation-anchor, the #148/C102 pattern).** The
> cross-fleet trips summary pools tripDistance across vehicles while odometers are stored per-vehicle-unit (R2),
> so a mixed mi+km fleet pools mi+km into one unlabeled scalar — the ALREADY-escalated #94 class (C223 filed it;
> reachable via the FE getSummary()). It was prose-documented but UNPINNED (the existing cross-fleet HTTP test
> used a single vehicle). +1 in trips-http.test.ts: a 2-vehicle mi+km fleet asserts today's raw pool (100mi+200km
> → 300 unconverted), labeled "characterization, not endorsement" — so the eventual #94 fix flips a RED assertion
> instead of silently changing a displayed figure. NOT a fix (Angelo's call); the anchor makes the change visible.
> Don't re-anchor.

> **GUARDED C232 — the `commonSchemas.clampedPaginationFields` contract (the C229 dedup's no-default + runtime-max
> semantics).** The C229 rule-of-three extraction (odometer + trips list-query fields) was UNGUARDED — nothing
> pinned what makes it DISTINCT from the sibling `commonSchemas.pagination` (which bakes in `.default(50)/.default(0)`
> + a hardcoded `.max(100)`). A "tidy-up" repointing a clampPagination route at `pagination` would silently
> restore the exact C212/C229 divergence (changed clamp/default behavior + a cap that stops tracking CONFIG).
> +7 in clamped-pagination-fields.test.ts: string-coercion, at-max accepted, over-max REJECTED, <1/negative
> rejected, NO defaults (omitted → undefined, clampPagination supplies the default downstream), cap tracks
> CONFIG.pagination.maxPageSize, and the sibling `pagination` DOES default 50/0 (pinning the intentional
> contrast). Non-vacuous (inject defaults+hardcoded-max → the no-default guard REDs). Pure schema test (no DB/HTTP)
> → merge-survives. Don't re-guard.

> **CERTIFIED + GUARDED C228 — the trips CREATE optional-field NULL invariant (FE undefined→absent→null, NORTH_STAR #1).**
> A C228 deep-review (after an arch no-churn scout) certified firsthand that the C227 TripForm's blank
> locations/note (`value.trim() || undefined`) round-trips correctly: JSON drops the undefined keys → Zod
> .optional() leaves them absent → the route `?? null` → persists SQL NULL (the backup-safe value). +2 guards
> in trips-http.test.ts (a create OMITTING them persists NULL, read straight from SQLite; a populated create
> round-trips the values). Non-vacuous (route `?? ''` → the null-cert RED — the realistic regression is a
> `''`-vs-null DB inconsistency, which the form guards against today but an edit form could reintroduce).
> Pins the FE→BE→DB optional-field contract before the T6b-3 edit form lands. Don't re-cert.

> **GUARDED C219 — the trip-api `rate=0` query survival (the explicit-zero / falsy-drop class).** A C219
> bug-scout on the FRESH C218 trip-api wrapper verified firsthand that `getSummary({rate:0})` serializes
> `rate=0` (a meaningful explicit-zero business value, not an absent param) — buildQueryString drops only
> null/undefined, and trip-api passes the rate RAW (no `|| undefined` coercion). CLEAN. GAP closed: the C218
> tests only covered rate=0.67 (and one was MISLABELED "rate=0 survives" — fixed). +1 dedicated guard; non-vacuous
> (a `rate || undefined` refactor → only this RED). Guards the reminder-api isActive:false truthy-drop class on
> the new surface. Don't re-add.

> **GUARDED C225 — the CSRF state-change boundary, behaviorally (NORTH_STAR #2 forgery isolation).** A C225
> bug-scout on the C223 403-vehicle-delete lead found it a FALSE ALARM (csrf() rejecting an Origin-less curl,
> working as designed — the same DELETE with a valid Origin returns 200). The CSRF↔CORS origin coupling had a
> source-scan guard (cors-csrf-origin-coupling) but no behavioral rejection test. +3 in
> csrf-state-change-protection.test.ts: same-origin DELETE → 200; cross-site DELETE (foreign Origin +
> Sec-Fetch-Site: cross-site) → 403 + vehicle survives; cross-site GET → 200 (reads unguarded). Non-vacuous
> (loosen csrf to origin:()=>true → only the cross-site-403 RED). Closes the C223 403 phantom. Don't re-add.

> **GUARDED C216 — D2's "a trip drives the mileage-reminder axis", end-to-end.** A C216 bug-scout (bug 5/3
> over) verified firsthand the second half of D2's promise: a trip whose endOdometer crosses a mileage
> reminder's milestone FIRES the notification (POST → createFromTrip → getCurrentOdometer → recheck →
> processMileageReminder). CLEAN — works. GAP closed: C213 only pinned that getCurrentOdometer reflects the
> reading, never that the reminder fires. +2 in trips-http.test.ts (a milestone-crossing trip fires exactly one
> notification; a below-milestone trip fires nothing). Non-vacuous (remove the recheck call → only the
> fires-one case RED). D2 now certified end-to-end on BOTH halves (feeds currentOdometer C213/C215 + drives the
> mileage axis C216). Don't re-add.

> **GUARDED C215 — the D2 trip→odometer dedup: manual-entry case + the local-day window.** A C215 bug-scout
> (bug 4/3 over, cold-vein lifted by C212/C213) probed the two D2 dedup edges C213 didn't cover, found both
> CLEAN firsthand: a trip dedups against a MANUALLY-logged same-day-same-reading odometer entry (D2's actual
> double-count scenario, not just trip→trip), and the dedup window is a genuine LOCAL calendar day (getFullYear/
> Month/Date), so a UTC-midnight straddle resolves to distinct local days (no #87/#106 off-by-one). GAP closed:
> D2's raison d'être (dedup vs a manual log) + the local-day window were unpinned. +2 in create-from-trip.test.ts
> (manual-entry dedup; same-local-day dedups / next-local-day inserts, host-TZ-relative). Non-vacuous (neuter the
> dedup → all 3 dedup tests RED). Don't re-add.

> **GUARDED C207 — the trips vehicle-delete CASCADE, end-to-end (NORTH_STAR #2).** A C207 bug-scout traced the
> vehicle-delete route firsthand: it reaps photos for expense+odometer children before the FK-cascade (photos have
> no FK → orphan risk, the #C404/#34 class). Verified CLEAN that `trip` is NOT a photo-upload entity type (absent
> from the validateEntityOwnership allowlist + ENTITY_TO_CATEGORY; trips are free-text-only v1, D5), so the
> photo-cleanup block correctly needs no trips leg — and the C452 symmetry guard already keeps that drift-proof (a
> future `trip` in ENTITY_TO_CATEGORY without a cleanup call → C452 RED). No defect. GAP closed: the live invariant
> "deleting a vehicle FK-cascades its trips away" was raw-SQL-pinned (migration-0007) but not through the real HTTP
> route. +1 in vehicle-delete-cascade.test.ts: seed a trip → DELETE the vehicle via the route → assert zero trip
> rows survive (no orphan leaking into analytics / the mileage-summary). Don't re-add.

> **GUARDED C204 — the trips GOOGLE SHEETS round-trip (NORTH_STAR #1, the C193 distinct-serializer lesson).** A
> C204 bug-scout (bug 31/3 over budget) VERIFIED FIRSTHAND that a trip survives the Sheets export→read path — a
> DISTINCT serializer from the ZIP/CSV path C203 pinned (formatValue→grid→parseValue, where parseValue re-coerces
> every cell: numeric→Number, ISO-shaped→new Date()). A throwaway fake-Sheets probe confirmed a non-midnight
> tripDate exports as the full ISO instant + reads back exactly, odometers as numbers, empty endLocation→null. CLEAN
> — no defect. GAP closed: the Sheets trips round-trip had NO committed test (C193's lesson: the Sheets path needs its
> OWN guard). +1 in google-sheets-service.test.ts (readSpreadsheetData describe, mirroring the C193 themePreference
> cert): seed a vehicle+trip → export → assert the Trips grid's ISO tripDate + the full readback (vehicleId,
> odometers, purpose, tripDate-to-the-instant, locations null, note). Trips now certified on BOTH backup serializers
> (ZIP C202/C203 + Sheets C204). Don't re-add.

> **GUARDED C203 — the trips `tripDate` timestamp round-trip (NORTH_STAR #1, the date/tz seam class).** A C203
> bug-scout on the FRESH C202 trips backup pipeline VERIFIED FIRSTHAND that `tripDate` (a `mode:'timestamp'`
> column) survives CSV export→restore to the exact second — both serializers `Date→toISOString()`, mirroring
> odometer's certified `recordedAt`; a throwaway probe confirmed a non-midnight UTC instant round-trips exactly,
> and merge-mode reports a clean conflict on a colliding trip id (the #93 probe works). CLEAN — no defect. GAP
> closed: the C202 trips-roundtrip test asserted every field EXCEPT `tripDate`'s value, so a future date-only
> truncation / tz-shift on either serializer leg wouldn't go red. Strengthened trips-roundtrip.test.ts: the
> fully-populated case seeds a non-midnight `trip_date` + asserts it survives exactly. Non-vacuous (truncate the
> serializer to `.slice(0,10)` → RED, the exact 48600s midnight-shift). The #87/#106/#131 date-seam class is now
> pinned on the new timestamp column. Don't re-add.

> **GUARDED C196 — the T9 settingsStore.load() → reconcileServerTheme WIRING (NORTH_STAR #2, cross-device sync).**
> C195's theme-server-sync.test.ts pins reconcileServerTheme in ISOLATION; nothing drove load() + asserted it
> invokes the reconcile with the fetched settings.themePreference. A refactor dropping that line silently breaks
> cross-device theme sync with every test green. +2 in settings-state-contract.test.ts (the load()-contract harness):
> drives the REAL load() with a mocked GET carrying a non-default themePreference + asserts the theme store adopted
> it end-to-end (themeId + data-theme); + a no-op (absent server value → local mirror wins). Non-vacuous (drop the
> reconcile call from load() → RED). Don't re-add.

> **GUARDED C190 — the app.html anti-FOUC head-script ↔ theme-store contract (NORTH_STAR #3, no-FOUC).** The
> inline `<script>` in app.html runs before first paint, reading `localStorage('vroom-theme-preference')` + adding
> the `dark` class — duplicating four constants the theme store owns (STORAGE_KEY, the `dark` class, the `system`
> sentinel, the `(prefers-color-scheme: dark)` query). app.html is raw HTML outside the type system + the store's
> tests, so a store-side rename would silently flash light-on-dark every load with nothing red. +4 in
> theme-fouc-contract.test.ts: source-scans BOTH files + asserts they agree on all four (the store's STORAGE_KEY
> literal is parsed from source). Non-vacuous (rename STORAGE_KEY → key-mirror test RED). Don't re-add.

> **GUARDED C183 — the #293 financing create-or-replace coalesce-list COMPLETENESS (NORTH_STAR #2).** A C183
> bug-scout VERIFIED FIRSTHAND that the financing write path is clean (ownership-gated; the #67 re-activate +
> #293 cross-type coalesce + #92 loan-terms validation intact; coalesce list covers exactly the nullable
> cross-type/schedule columns). GAP closed: the C293 behavioral test (refinance-cross-type-field-reset)
> enumerates today's fields by hand, so a FUTURE nullable financing column would leave the replace path
> silently merging it stale (#293 reopens) with every test green. +3 in refinance-coalesce-completeness.test.ts:
> censuses the live `vehicleFinancing` nullable columns (getTableColumns), subtracts system-managed timestamps,
> asserts each remaining one is reset in the replace-path SET object. Non-vacuous (drop `mileageLimit` from the
> SET → RED naming it). Don't re-add.

> **GUARDED C178 — the reminder split-config cross-tenant defense, end-to-end (NORTH_STAR #2, #88 family).** A
> C178 bug-scout VERIFIED FIRSTHAND (real HTTP probe) that a PUT cannot smuggle a foreign vehicle via
> `expenseSplitConfig.vehicleIds` while omitting top-level `vehicleIds` — defended in depth by (a) the merge+
> re-parse's split-vs-vehicleIds MATCH invariant (merge fills the existing OWNED ids → foreign blob 400s) and
> (b) `validateVehicleIdsOwned` when vehicleIds IS sent. CLEAN, no defect. But the HTTP composition had no test
> (existing: (b) standalone + the match invariant at schema-unit level). +1 in reminders-http.test.ts: foreign
> vehicle in the split blob alone → 4xx, explicit-both → 4xx, junction holds only the owned vehicle (no leak).
> Non-vacuous (neuter the match-check → RED). Don't re-add.

> **GUARDED C172 — tree-wide validate-before-persist for the #62/#109/#125/#145 financing-source-link class.**
> The within-tenant integrity class (a forged `{sourceType:'financing', sourceId}` mis-attributes a row as a loan
> payment → understates the displayed balance, computeBalance's exact predicate; NORTH_STAR #1) is closed across all
> FOUR expense-write paths (POST / · PUT /:id · POST /split · PUT /split/:id) by assertFinancingSourceValid/
> assertSplitFinancingSourceValid — but EVERY existing test is BEHAVIORAL (per-path HTTP), so a FUTURE 5th write path
> added without the validator would silently reopen it with no test going red. New expense-source-validation-coverage
> .test.ts (+3): pins the write surface = exactly 4 persist calls (5th forces a guard update); asserts every persist
> call is preceded WITHIN ITS HANDLER by a source-link validator (handler-slice scan); pins the import path stays
> source-link-free (CSV has no sourceType column — verified firsthand, the 5th persist `importExpenses` is safe by
> construction). Non-vacuous (remove a handler's validator → the per-handler test RED). Certified CLEAN (no defect).
> Don't re-add.

> **GUARDED C163 — the import route's unowned-`targetVehicle` cross-tenant path (NORTH_STAR #2).** A mapping
> whose targetVehicle the user does NOT own imports nothing: resolveTargetUnits returns {} (skip conversion,
> no guessing toward a foreign vehicle's units) AND buildImportPlan rejects the rows "No vehicle named X in
> your garage" → readyCount 0, no leak, no insert. The route-level cross-tenant path had no test (existing
> cases all target an OWNED vehicle). +1 in import-mapping-route.test.ts, non-vacuous. Surfaced by the C163
> bug-scout (dry on the C153/C159-changed surfaces → pivoted to this guard). Don't re-add.

> **GUARDED C158 — the auth-account UNLINK route (DELETE /auth/accounts/:id), end-to-end.** A 0-coverage
> account-security path pinned via createTestApp: (1) last-account lockout — unlinking the ONLY sign-in method
> → 400 LAST_ACCOUNT, row preserved (count runs inside the delete tx, concurrency-safe); (2) cross-tenant —
> another user's account id OR a non-auth (storage) provider row → 404, no deletion (NORTH_STAR #2); + the
> happy path (2 providers → unlink one → 204, other survives). +4 in unlink-account-http.test.ts, each asserts
> the DB side-effect. Certified CLEAN (no defect). Don't re-add.

> **GUARDED C152 — the C148 `defaultCategory` fuel-tracker commit at the ROUTE layer (end-to-end).** C151 pinned
> the pure applyMapping/buildImportPlan path; this pins the actual user flow through `POST /import`: a detected
> fuel tracker (NO category column) + a preset mapping carrying `defaultCategory:'fuel'` → translated + COMMITTED
> via the real HTTP stack. Guards that `columnMappingSchema` ACCEPTS defaultCategory (a regression dropping it
> would silently strip it before applyMapping → back to 0-ready "Unknown category", the C148 bug). +2 in
> import-mapping-route.test.ts (commit round-trip: 200/imported 1/GET shows fuel + mileage + volume; dry-run:
> readyCount 1, no write). Non-vacuous (drop defaultCategory from the schema → both RED). Don't re-add.

> **GUARDED C134 — `apiClient.raw` URL-build + credentials (the file-download/data-export path, api-client.ts →
> 100% line).** Lines 131-132 (apiClient.raw, the raw-Response fetch for FILE DOWNLOADS — the backup-ZIP export,
> NORTH_STAR #1 data portability) were uncovered; sibling tests never drove it. Extended the tracked
> api-client.test.ts (+3): relative url base-prefixed + `credentials: 'include'` ALWAYS sent (dropped credentials =
> 401 on every download); absolute http url passes through; method+headers forward. Non-vacuous (drop credentials →
> 2 RED). api-client.ts 95.23→100% line; OVERALL FE 88.08→88.23%. ALSO proved `offline.svelte.ts`'s online/offline
> window listeners (18-23) structurally hard firsthand — dispatchEvent didn't re-target the import-time listener,
> deleted the brittle test (the DOM/effect-bound FE residual, C101 class). The FE service/util layer is now at its
> structural ceiling; self-authorizable coverage is complete BOTH sides. Don't re-add.

> **GUARDED C133 — the pending-OAuth-credentials MAX_SIZE eviction (DoS-prevention branch, pending-credentials.ts
> → 100% line).** The credentials store (stages a provider OAuth refresh token between callback + provider-create)
> was 92% line; the uncovered lines 53-56 are the MAX_SIZE (1000) oldest-eviction branch in storePending — a
> DoS-prevention contract (abandoned OAuth flows must not grow the in-memory store unbounded). The C83 test
> conceded a "light functional check" that stored ONE entry, never reaching MAX_SIZE. Extended the tracked
> pending-credentials.test.ts (+1): fill to MAX_SIZE → store one more → cap HOLDS (1000), OLDEST evicted, newest
> retained, only ONE eviction per over-cap insert. Non-vacuous (remove the eviction delete → size 1001 → RED).
> pending-credentials.ts 92→100% line. The exported-pure-util coverage frontier is now exhausted (calculations
> 98.94 / validation 99.20 / analytics-charts 99.63 at structural ceilings); residual is DB/DI/OAuth/private-method
> bound. Self-authorizable coverage work is genuinely complete. Don't re-add.

> **GUARDED C129 — auth-store `updateDisplayName` merge + `logout` failure path (auth.svelte.ts → 100% line).**
> auth.svelte.ts was 90.47% line / 50% BRANCH; the low branch flagged `updateDisplayName` (74-81, ENTIRELY
> untested) + the `logout` catch (117, only success was tested). Extended the tracked `auth.test.ts` (+3):
> updateDisplayName merges the returned displayName into the existing user preserving other fields (the `if (user)`
> spread-merge) + returns it; no-op on local state when there's no user; a failed logout sets error + does NOT throw
> (does-not-force-clear-session pinned). Non-vacuous (neuter the merge → RED). auth.svelte.ts 90.47→100% line /
> 50→83.33% branch (only line 84 = the loginWith browser SSR-guard left); OVERALL FE 87.74→88.08%. Third consecutive
> real coverage gain (C126 BE, C128 FE, C129 FE). The clean store-logic FE picks are now worked through. Don't re-add.

> **GUARDED C128 — settings-store `restoreFromProvider` mode-gated reload + error path (NORTH_STAR #1
> data-safety; FE coverage frontier).** Scouted FE coverage → `settings.svelte.ts` (67.5%) had `restoreFromProvider`
> (the provider-path restore) unpinned in the STORE: settings-api.test.ts pins only the wire contract, C308 pins
> error-CLEAR-on-entry — but the C319/C100 mode-gated post-restore reload (uploadBackup got it at C100, this twin
> did NOT) + the error-set path were untested. New `settings-restore-from-provider.test.ts` (+4): non-preview
> (replace/merge) reloads (2 fetches), preview does NOT (1 — dry-run view survives), failed restore sets error +
> re-throws. A dropped reload after replace/merge = STALE pre-restore settings on screen (silent NORTH_STAR #1).
> Non-vacuous (neuter the gate to `if (false)` → replace+merge tests RED, preview+error green). settings.svelte.ts
> 67.5→70% line; OVERALL FE 87.6→87.74%. Don't re-add. The clean store-logic FE picks are nearly worked through
> (162-163 loadRestoreProviders catch + sync-manager/expense-api tails are DOM/timer/pass-through-structural).

> **GUARDED C127 — BEHAVIORAL pin of `photoThumbnailResponse` (the photo-serve security headers had only a
> SOURCE scan).** The C227 #77 thumbnail-serve builder already had photo-serve-headers.test.ts, but that's a SOURCE
> SCAN (readFileSync + .toContain) — it never CALLS the function, so it showed 0% line coverage and a header object
> mis-wired to the Response would pass it. New `photo-thumbnail-response.test.ts` (+4) drives the real fn + asserts
> the constructed Response's actual headers + body: the MANDATORY nosniff (#77/#35 stored-content MIME-sniff vector),
> Content-Type=mimeType verbatim, Cache-Control private (no shared-proxy cross-user cache), CORP cross-origin, + the
> buffer round-trips as the body. Non-vacuous (drop nosniff → 2 RED while the source-scan stays green). photos/
> helpers.ts 75.38→87.88% line (only validatePhotoOwnership's getDb-singleton slice left). The clean constructed-repo
> + pure-fn coverage picks (C126 finders, C127 this) are now worked through; remaining <88% backend is structural.
> Don't re-add.

> **GUARDED C126 — 3 uncovered PhotoRepository finders pinned; FIRST real BE coverage movement in many cycles
> (+0.24 line).** Coverage-scouted every backend src <75% line: the OAuth/photo/google-photos/backup-orchestrator/
> db-connection/sync files are the documented DI/OAuth/network STRUCTURAL ceiling, but `photo-repository.ts`
> (72.90%) had pure constructor-injected DB finders untested (`findIdsByUser`/`findById`/`findCoverPhoto`) — and
> the C229 comment confirms it drives `this.db`, not the getDb singleton (NOT coverage-theater). New
> `photo-repository-finders.test.ts` (+9) over a migrated in-memory DB pins: findIdsByUser USER-scoped +
> entityType-narrowed + extraConditions-merged + empty (it's the bulk-delete id finder → cross-tenant-leak class
> #48/#72/#180); findById row/null; findCoverPhoto isCover-only/null. Non-vacuous (drop the userId scope → tenant
> test RED). photo-repository.ts 72.90→97.28% line; OVERALL BE 87.78→88.02%. The remaining <75% backend files are
> genuinely structural — this was the last clean constructed-repo coverage pick. Don't re-add.

> **GUARDED C122 — the two FOUNDATIONAL analytics primitives `normalizeDate` + `groupByVehicle` CLEAN + pinned
> (the last zero-coverage roots).** Closing the analytics-builder coverage sweep at its ROOTS (C119 expense-summary
> + C120 maintenance/gas-price certified the leaf builders; these are the primitives every builder calls).
> `normalizeDate` is the SECONDS-vs-MS epoch heuristic (`< 1e12` → ×1000) — the exact boundary where date
> corruption hides, since the DB stores timestamps in SECONDS (the recurring mode:'timestamp' footgun, C46/C34/C209)
> and NOTHING asserted it; `groupByVehicle` is the #54 cross-vehicle-pooling guard. Read both against source
> firsthand — CORRECT. New `normalize-date-group-by-vehicle.test.ts` (+9) pins: null→null / Date→identity /
> seconds×1000 / ms-verbatim / the 1e12 boundary→ms / epoch-0→1970; group order-preserving + empty + single-group.
> Non-vacuous proven (drop the ×1000 → seconds-epoch test RED). BE 1757 pass. The analytics-builder coverage sweep
> is now essentially complete; remaining sub-100% analytics files are DI/SQL-bound (repository.ts). Don't re-add.

> **GUARDED C120 — the MAINTENANCE + GAS-PRICE chart builder family CLEAN + pinned (3 zero-coverage builders).**
> Continuing the C119 analytics-builder coverage sweep: re-grepped every analytics-charts.ts builder vs test
> references → 3 more with ZERO coverage the C67 (fuel/date) + C119 (expense-summary) audits never reached —
> `buildGasPriceHistory`, `buildVehicleMaintenanceCosts`, `buildMaintenanceTimeline` (the last drives the private
> buildTimelineEntry / estimateServiceInterval / assignTimelineStatus trio). Read each against source firsthand —
> all CORRECT (clean cert). New `maintenance-gasprice-builders.test.ts` (+15) pins: priced-fillup filter +
> price=amount/vol + fuelType ?? 'Regular' + slice(-100) (gas-price); category==='maintenance' ONLY + month-sum +
> ascending + dateless-drop (vehicle-maintenance-costs); description grouping (case-insensitive; null→'general
> maintenance') + the assignTimelineStatus thresholds (<0 overdue / <30 warning / else good) + single-occurrence
> interval default 180 + daysRemaining-ascending sort (maintenance-timeline). Non-vacuous proven (shrink the warning
> band <30→<5 → the 10-day warning test RED). BE 1748 pass. Remaining zero-coverage analytics builders:
> groupByVehicle + normalizeDate (thin primitives, lower-leverage). Don't re-add.

> **GUARDED C101:** themeStore.initialize() + its live OS-preference listener now pinned (+1 in
> theme-initialize.test.ts) — the C336-skipped one-shot. C336 pinned setPreference but skipped initialize(); its
> load-bearing untested branch is the `prefers-color-scheme` change listener that re-applies the theme live ONLY
> when the stored preference is 'system' (so "System" tracks the OS in real time without yanking an explicit
> light/dark user when their OS enters night mode). Single ordered test (themeStore is a latching singleton — only
> the first initialize() runs the body): mount applies stored pref + registers ONE listener, 2nd init is idempotent,
> then fire the listener under 'system' (tracks OS) vs 'light' (untouched). Non-vacuous (make the listener apply
> 'system' unconditionally → RED, explicit-light user yanked dark). **theme.svelte.ts 60.52→92.1% line, 100% func;
> overall FE 87.6% line / 88.56% func / 79.74% branch (2nd consecutive real FE gain after C100).** CORRECTION: the
> C100 "load-state.svelte.ts 35% func" seed was a coverage-tool artifact — that primitive is ALREADY fully tested
> (load-state.svelte.test.ts, 11 cases). NEXT guard: RE-MEASURE actual <100% util/store files first, then pin
> genuine logic; don't trust a stale truncated coverage row. Don't re-add the initialize() pin.
>
> **GUARDED C100:** the FE settings-store `uploadBackup` mode-gated reload is now pinned (+2 in
> settings-state-contract.test.ts) — the C319 `restoreFromProvider` twin on the FILE-upload restore path. The store
> gates the post-restore `this.load()` on `mode !== 'preview'` (a non-preview replace/merge must refresh state; a
> preview must NOT) — C319 pinned the provider path, but the uploadBackup path was unguarded, so a dropped reload
> would leave the UI showing STALE pre-restore settings (NORTH_STAR #1), invisible to settings-api.test.ts (which
> pins only the wire/FormData contract). Non-vacuous (drop the gate → only the non-preview test RED, 1 fetch not 2).
> **First FE coverage movement since C52: 86.86% line / 87.97% func / 79.07% branch (+0.51/+0.29/+0.29).** This is
> the productive guard frontier now — REAL FE behavioral gaps, NOT backend source-scans on code unchanged since C85.
> SEEDED for the next guard cycle: load-state.svelte.ts (35% func) + theme.svelte.ts (60%) have genuine untested
> logic; pin those over another cold backend scan. Don't re-add the uploadBackup pin.
>
> **GUARDED C116 — ROUTE-COVERAGE IDOR AUDIT COMPLETE.** Closed the last sweep gap: PUT /notifications/:id/read
> (reminders), state-changing + (id,userId)-scoped (throws NotFoundError) but never in the sweep. +2 in the reminder
> IDOR case (raw-seed B's notification, assert A denied + B's row stays unread). Non-vacuous (drop the userId scope
> → reminder IDOR test RED). **MILESTONE: the route-coverage audit (C108–C116) found + closed 7 real route gaps in 9
> cycles — 6 cross-tenant IDOR (sync-status, vehicle-expenses, financing payoff, insurance terms, expense split,
> notification read) + 3 analytics auth/validation routes. cross-tenant-idor.test.ts now covers EVERY state-changing
> route across all domains; analytics is fully HTTP-harnessed. This vein is EXHAUSTED — genuinely productive for 9
> cycles, now done.** The self-authorizable veins are all swept again; record dry/no-churn fast + the highest-leverage
> work is GATED on Angelo (#148 READY / import defaultCategory / createLoadState + seedVehicle arch designs /
> #100/#79/#129). Don't re-add.
>
> **GUARDED C115:** the expense SPLIT routes' cross-tenant IDOR gap (PUT/DELETE /split/:id) is now pinned (+2
> expectDenied in the expense IDOR case). Both routes throw NotFoundError when the group isn't (groupId,userId)-owned
> (groupOwnedBy), so they 4xx-deny a foreign id today, but the cross-tenant-idor.test.ts sweep never covered them —
> destructive (regenerate/delete sibling rows + photos) + money-bearing, so an un-scoped regression lets A
> rewrite/delete B's split expenses. Non-vacuous (drop the userId scope from groupOwnedBy → expense IDOR test RED).
> 6th route gap via the audit method (C108–C115), 5 of them cross-tenant IDOR. REMAINING sweep gap: PUT
> /notifications/:id/read (reminders — verified (id,userId)-scoped + throws, but not in the sweep; LOW-stakes
> read-flag). NEXT: pin the notification-read IDOR (last known gap), then record the IDOR sweep COMPLETE for
> state-changing routes. Don't re-add.
>
> **GUARDED C110:** the analytics route domain now has COMPLETE HTTP-harness coverage — pinned the last 3 untested
> routes (/quick-stats, /cross-vehicle, /year-end) in analytics-routes-http.test.ts (+3). Unlike the C109
> vehicle-expenses gap these are USER-scoped (no per-vehicle ownership gate), so they pin: per-route auth-gating
> (the C185 net asserted 401 on only ONE representative route → a mis-mount skipping requireAuth on one would've
> gone unnoticed), the REQUIRED startDate+endDate validation on the two dateRange routes (omit → 400), and
> year-end's OPTIONAL year (omitted → 200 current-year default). Non-vacuous (drop the quick-stats zValidator →
> its 400 assertion RED). PATTERN (C108/C109/C110): the route-coverage audit method — inventory a domain's handlers
> vs HTTP-harness hits, pin the uncovered (ownership-gated first, then auth/validation) — is the productive
> guard/deep-review vein. analytics is the FIRST domain fully mapped + closed (13/13 endpoints). NEXT: apply the
> same method to the next thinnest domain — auth/photos are OAuth/upload-bound (structural), so check
> financing/insurance/odometer GET-by-id + list routes for any unharnessed ownership-gated handler. Don't re-add.
>
> **GUARDED C108:** the untested `GET /:id/sync-status` provider route's tenant-isolation chokepoint is now
> pinned (+4 in providers-routes-http.test.ts). Scouting the HTTP-harness guard vein (not source-scan) across all
> 12 route domains surfaced this endpoint with ZERO coverage despite gating on `findOwnedProviderOrThrow` — the
> same tenant-isolation guard the PUT/DELETE paths pin (#63), but on a READ that leaks another tenant's
> per-category photo-sync counts if dropped (NORTH_STAR #2). Pins owned→200 (4-category {total,synced,failed}
> shape), foreign→404 (no leak), non-existent→404, anon→401. Non-vacuous (drop the ownership check → foreign +
> non-existent tests RED). **CORRECTION: the C103/C107 "guard frontier worked out" claim was PREMATURE** — a real
> untested route with a cross-tenant guard gap existed. LESSON: the HTTP-harness vein isn't exhausted just because
> source-scan + FE-logic are; map route-domain endpoint coverage before asserting saturation. NEXT guard: re-scan
> the remaining low-coverage route endpoints (sync/auth/analytics harness are thin but mostly DI/OAuth-bound —
> verify genuinely-testable vs structural first). Don't re-add the sync-status pin.
>
> **GUARDED C98 (deep-review→guard):** the session-cookie SECURITY-ATTRIBUTE contract is now pinned by a
> source-scan (`session-cookie-security-attributes.test.ts`, +4) — the C92/C97-flagged unaudited session/cookie
> lifecycle. The attrs `secure: CONFIG.env==='production'` / `httpOnly: true` / `sameSite: 'Lax'` are hand-copied
> across 5 manual sites (2 setCookie: login + refresh-rotation; 3 deleteCookie: logout + 2 callback cleanups), and
> NO test asserted ANY of them (validate-and-refresh-session.test.ts mocks Lucia + checks the return value, never
> the cookie attrs). A drift on one site silently weakens auth on that path — hardcoded `secure:true` breaks
> local-http dev; `secure:false`/dropped httpOnly ships an insecure / JS-readable session cookie in prod (XSS-exfil
> + network theft); a drifted deleteCookie fails to clear the cookie (logout doesn't log out) — all invisible to a
> happy-path login test. Guard source-scans both auth files; non-vacuous (drop httpOnly from the refresh cookie →
> only the httpOnly test RED, names the offender). The auth-security surface (rate-limit C92, CORS/CSRF C94,
> session-cookie attrs C98) is now broadly fenced. The refresh LOGIC was already guarded (C-validate-refresh, all 4
> branches incl. fail-open). Don't re-add. The one-edit→source-scan pattern (C25/C45/C59/C67/C80/C87/C94).
>
> **GUARDED C94:** the CORS↔CSRF origin-allowlist coupling in app.ts is now pinned by a source-scan
> (`src/__tests__/cors-csrf-origin-coupling.test.ts`, +4) — the C92-flagged unaudited surface. app.ts wires
> `cors({ origin: CONFIG.cors.origins })` AND `csrf({ origin: CONFIG.cors.origins })` from the SAME allowlist,
> coupled only by both referencing that const; NO test pinned it (the 2 "csrf" files assert application-layer
> OAuth-state userId matching, not the middleware origin allowlist). Drift them (hand csrf a hardcoded/divergent
> list) → the two trust boundaries split: a CSRF gap on an origin one trusts and the other doesn't, or legit
> cross-origin state-changing requests rejected as forgery (NORTH_STAR #2) — invisible to a happy-path same-origin
> test. Guard source-scans both calls for `origin: CONFIG.cors.origins` + asserts they reference the IDENTICAL
> source (drift detector). Non-vacuous (drift csrf to a hardcoded list → 2 of 4 RED). The one-edit→source-scan
> pattern (C25/C45/C59/C67/C80/C87). The config-coupling seam (C67/C80/C81/C87/C94) is now broadly fenced. Don't re-add.
>
> **GUARDED C87:** bug #18 (split-sibling fillup-count inflation) is now pinned on the PREV-PERIOD axis — the
> C97 guard's missing twin (+1 in fuel-stats-fleet-distance-pooling.test.ts). The FuelStats "This Period vs Last
> Period" fillup comparison computes its halves through DIFFERENT predicates across two layers: `fillups.currentYear`
> is in-memory `fuelRows.filter(isFillup)` (volume != null && >0), while `fillups.previousYear` is the SQL
> `COUNT(CASE WHEN volume > 0 THEN 1 END)` in queryFuelAggregates (the C79 group-by shape), coupled only by a
> comment. Split fuel siblings carry volume=null (must not inflate either count, bug #18). C97 pinned ONLY the
> currentYear/in-memory half — nothing asserted `fillups.previousYear` from a populated DB (summary-route.test.ts
> is mocked), so dropping the SQL `CASE WHEN` to `COUNT(*)` silently inflated "Last Period" by the split legs with
> every test green. New guard seeds 2 real fillups + a 2-leg volume-null split in the prev window → asserts
> previousYear===2 (not 4) + prev volume stays 19. Non-vacuous (force COUNT(*) → RED Expected 2/Received 4; the
> other 10 in-file + the C97 currentYear + calendar-month tests stay green, confirming prev-period-only gap). The
> bug-pinned-on-one-layer→guard-pins-the-sibling-layer pattern (C67 retry-ceiling; here C97 in-memory→C87 SQL).
> The fuel-stats count/convert predicates are now fenced on BOTH layers. Don't re-add.
>
> **GUARDED C80:** the CSV export↔import COLUMN-NAME contract (round-trip crown-jewel, NORTH_STAR #1) now has
> a source-scan (`export-import-column-contract.test.ts`, +4). The export writes its header from EXPORT_COLUMNS
> (routes.ts); the importer reads each cell BY NAME via `get('<col>')` (import-csv.ts) — coupled only by the
> strings matching. A renamed/dropped EXPORT_COLUMN silently breaks the export→re-import round-trip (field
> reads blank, lost on re-import) and NEITHER suite catches it (export-only test + import test hand-writes its
> own header). Guard exports EXPORT_COLUMNS + asserts every importer `get()` key (10 cols) is present in it;
> pins currency/createdAt as intentionally export-only (the ⊆ is one-directional by design). Non-vacuous
> (rename `fuelType`→`fuel_type` → RED "…would silently LOSE these fields"). The one-edit→source-scan pattern
> (C25/C45/C59/C73). Don't re-add.
>
> **GUARDED C73:** the #94 skipConversion DISPATCH ORIENTATION is now pinned across the C65/C69/C72 twins
> (`skip-conversion-dispatch-orientation.test.ts`, +3). The C65/C69/C72 work added 3 `skipConversion ? <pure>
> : this.buildConverted<X>(...)` ternaries + 1 `if (skipConversion) pure else converted` (cross-vehicle). The
> C59 scan pins the converted call never gets a unit PLACEHOLDER, but NOT the branch orientation — flip a
> ternary to `? converted : pure` (or `if (!skipConversion)`) and a MIXED-unit fleet takes the raw-pooling PURE
> builder (#94), invisible to same-unit fixtures. New source-scan asserts the converted twin sits on the
> FALSY/ELSE (conversion-needed) branch only; filters out the per-point `skipConversion ? point.efficiency :
> convertEfficiency(...)` value-ternary inside the C64 generator (not a builder dispatch). Non-vacuous BOTH
> forms (flip the ternary → ternary test RED; flip the if/else → if/else test RED, each own diagnostic). The
> convert-dispatch is now DOUBLE-FENCED (C59 placeholder + C73 orientation). The feature-creates-pattern→
> next-guard-pins lesson (C25/C45/C59 family). Don't re-add.
>
> **GUARDED C66:** the C64 `convertedGasEfficiencyPoints` generator's gas/charge gate is now pinned on the
> CONVERTED path (+1 in cross-vehicle.property.test.ts). The C64 dedup centralized the gas-gate across 4
> builders, but no test drove it on the convert branch: getFuelEfficiencyTrend's #126 test uses its OWN
> forEachVehiclePair loop (NOT the generator), and Property 11 drives the converted consumers GAS-ONLY — so
> reverting gasEfficiencyPoint→computeEfficiencyPoint inside the generator (the #126/C427 footgun) stayed green
> everywhere. New guard: a MIXED-unit (km/L vehicle, mi/gal user → skipConversion=false) PHEV fleet; asserts
> getQuickStats.avgEfficiency is the converted GAS pair alone (70.57 mi/gal), the ~4 mi/kWh charge excluded.
> Non-vacuous proved firsthand (reverting the gate drops it 70.57→39.99 → RED on the value). Pins the WORSE half
> of #126 (convertEfficiency mis-converting mi/kWh as mi/gal). The arch-extract→guard-pin pattern (C17→C18, C50,
> now C64→C66). Don't re-add.
>
> **GUARDED C59:** the C58 #94 convert-before-pool invariant now has a tree-wide source-scan
> (`no-unconverted-fleet-pooling.test.ts`, +3): asserts NO `computeConverted*`/`buildConverted*` call in
> repository.ts passes a unit PLACEHOLDER (new Map() / DEFAULT_UNIT_PREFERENCES / hardcoded
> skipConversion=true) — the footgun the C58 fix removed, invisible to a same-unit fixture. Non-vacuous both
> ways (placeholder triple → RED; lone `, true)` → RED; the 7 legit calls don't match). The
> one-edit-fix→source-scan pattern (C24→C25, C44→C45, C54 → C58→C59). Pins the invariant for the REMAINING
> #94 members (volume + 4 fuel-advanced builders) so they can't reintroduce it. Don't re-add.
>
> **GUARDED C52:** the C51 #98 keep-local overwrite path ∩ the #76 fuel-field-hygiene class —
> expenses-http.test.ts (+1): a keep-local overwrite that switches a fuel row to a non-fuel category NULLs
> the stale volume/mileage/fuelType (clearFuelFieldsIfNotFuel runs before the idempotent UPDATE; a lingering
> mileage would poison getCurrentOdometer cross-category). Non-vacuous (neuter the overwrite-update → RED).
> LESSON re-confirmed: FIRST drafted "flag never persisted / PUT strips it" guards but proved them VACUOUS
> firsthand (drizzle drops unknown insert keys + Zod strips unknown parse keys = framework-guaranteed) →
> dropped them; pinned the REAL app-logic invariant instead (the C181/C229 coverage-theater warning). Don't re-add.
>
> **GUARDED C45:** the C44 #37 backup-atomicity invariant now has a tree-wide source-scan
> (`sheets-atomic-backup.test.ts`, +4): asserts google-sheets-service.ts has ZERO `.values.clear(` calls
> (the clear-then-write footgun the atomic design removed), the staging+swap mechanism is present
> (SHEET_STAGING_SUFFIX const + deleteSheet/updateSheetProperties commit), and the staging suffix is
> SPACE-FREE (interpolated unquoted into A1 ranges). Non-vacuous (reintroduce a values.clear → RED; spaced
> suffix → RED — both verified firsthand). The one-edit-fix→source-scan pattern again (C24→C25 for #36, now
> C44→C45 for #37). Don't re-add.
>
> **GUARDED C18:** `averageConsecutiveMpg` (the C17-extracted shared MPG loop) now has a direct unit net
> in calculations.test.ts (+6: mean / <2→null / missedFillup-skip / both-odometer+volume guard / outlier
> drop / half-open 150 band) — closes the C181/C229 "helper tested only via callers" gap the C17 dedup
> created. STANDING PATTERN (loop-improvement): whenever an arch cycle extracts a shared helper, the NEXT
> guard cycle should pin it directly (C6 monthsBetween, C18 averageConsecutiveMpg). Don't re-add.
>
> **GUARDED C38:** the C37 manual-mapping pure logic, extracted from ImportExpensesDialog.svelte (vitest
> can't reach `.svelte` <script> functions) to `src/lib/utils/import-mapping-helpers.ts` + pinned by
> import-mapping-helpers.test.ts (+9): `parseCsvHeaders` (quotes/whitespace/empty), `isNativeImportHeaders`
> (the native-superset gate), `guessManualColumns` (the needle map incl. the C37 spent/paid/total→amount,
> kind→category additions). Behavior-preserving (C37 e2e stays green); non-vacuous (drop a needle → RED).
> Arch-extract→guard-pin done in ONE cycle (the C17→C18 pattern). Don't re-add.
>
> **GUARDED C32:** the C31 import-preset category gap is characterized end-to-end
> (import-mapping-presets.test.ts, +2): all 3 real `MAPPING_PRESETS` map no category column → driven through
> presetToMapping → applyMapping → buildImportPlan, each currently yields readyCount 0 / "Unknown category"
> (the presets import nothing today). NET-FLIPPING: when the flagged defaultCategory:'fuel' fix lands, the
> category expectation flips to 'fuel' + readyCount to N — these tests are the update target (documented
> in-file). Pins the gap the existing round-trip test missed (it hand-adds a category column, never
> exercises the REAL presets). Don't re-add. STANDING PATTERN extended: a feature/eyes-on cycle that
> surfaces a concrete unguarded invariant seeds the next guard cycle to characterize it (C31→C32, like
> arch-extract→guard-pin C17→C18 + one-token-fix→source-scan C24→C25).
>
> **GUARDED C25:** the C24 #36 RAW-value-input fix now has a tree-wide source-scan guard
> (`sheets-raw-value-input.test.ts`, +2): asserts EVERY `valueInputOption:` assignment in
> google-sheets-service.ts is `'RAW'`, so a reformat-flip back to USER_ENTERED OR a new Sheets write site
> added with the unsafe option regresses RED (the C24 fake-seam test only drives the one current path).
> Matches the assignment (not a bare USER_ENTERED substring — the fix's comment mentions it). Non-vacuous
> (flip → RED). STANDING PATTERN extended: a bug-fix cycle that flips a load-bearing one-token option seeds
> a NEXT guard cycle for the tree-wide source scan (sibling to the arch-extract→guard-pin pattern). Don't re-add.

### bug
*(The cold-scout vein is exhausted (C6/C10/C15/C20 all dry on pure-logic money/date/store/analytics). But
the bug QUEUE is no longer empty: the ✅ ANGELO-APPROVED block below is now the bug source — real,
severity-ranked, agreed-fix defects (NO sign-off needed). On a bug cycle, pick the top unfinished approved
item by severity. C20 took the efficiency-band unification (DONE). Still don't manufacture cold finds.)*

> **CLOSED C2: #147** — PUT /split/:id didn't re-validate the carried-forward financing source link
> against the NEW vehicle set (the regenerated siblings could land on a vehicle whose active financing
> isn't sourceId → understated balance). Fixed via the shared `assertSplitFinancingSourceValid` on both
> split paths + 3 guards. **The #62/#109/#125/#145/#147 within-tenant financing-source-link integrity
> class is now closed across ALL FOUR write paths: regular POST, regular PUT, split CREATE, split UPDATE.**
> Don't re-scout this class — it's saturated. Next bug scout: try a DIFFERENT vein (date/tz math, the
> offline-outbox field-dropout family #66/#101/#111, or analytics split-sibling overcount if any builder
> was missed by the #56/#108/#113/#146 sweep).

> **#94 CLASS FULLY CLOSED (C58/C62/C65/C69/C72/C76 + C79)** — all 6 builder members [distance.totalDistance
> (C58), volume/fillupDetails (C62), monthlyConsumption (C65), seasonalEfficiency (C69), dayOfWeekPatterns
> avgVolume (C72), vehicleRadar gas-MPG+odometer (C76)] + the prev-year SQL sub-member [volume.previousYear,
> C79 — queryFuelAggregates now GROUPs the volume SUM BY vehicle + buildFuelStatsFromData converts each
> vehicle's prev-window sum before pooling] now convert-before-pool. The fleet-wide analytics summary +
> fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet END-TO-END. Each member has a mixed-unit
> behavioral guard in fuel-stats-fleet-distance-pooling.test.ts + the C59/C73 source-scans fence the dispatch.
> Don't re-pick #94 — it's done. (The product-gated cross-cutting siblings #112 chart palette + #30 MPG-band
> remain their own separate items.) Other open Angelo bug items: **Sev-4** #129 (OAuth email-sync,
> re-read archive grounding first), #79 (stuck-offline-entry hygiene); #100 json_patch merge + #112 chart palette
> stay arch/design-gated.
>
> **✅ CLOSED C149 (was: ✅ DECIDED 2026-06-23 Angelo — null/zero initial → treat as 0).** Coalesced
> `const startMileage = initialMileage ?? 0` inside `calculateLeaseMetrics` + dropped the `initialMileage !==
> null` gate clause (kept `currentMileage !== null && financing.mileageLimit`), routed the #91 driven-miles
> space-correction through `startMileage` too — the burn bar now matches the sibling Overage card
> (FinanceTab.svelte:163 `initialMileage ?? 0`) by construction. Flipped the C102 red→green anchor to the fixed
> semantics (null-initial → mileageUsed = currentMileage = the initial=0 result; asserts both cards agree). FE
> validate:local GREEN (749/749). FE-pure-util fix, consuming render unchanged. #148 CLOSED. Don't re-fix.
>
> **🚩 NEW — ESCALATED C68 (eyes-on — displayed-number semantics, NOT auto-fixed):
> #148 LeaseMetricsCard burn bar reads 0-used when `initialMileage` is null.** Found firsthand during a C68
> eyes-on of the FinanceTab lease render (the never-shot surface; #140 annual-vs-total CONFIRMED fixed +
> consistent on both cards — that part is GOOD). `calculateLeaseMetrics` (financing-calculations.ts:498) gates
> `mileageUsed = max(0, current − initial)` on `initialMileage !== null`, so a lease with NO recorded starting
> odometer (the COMMON case) leaves `mileageUsed = 0` / `mileageRemaining = full allowance` → the Mileage burn
> bar shows "0 / 36,000 mi · 36,000 left" even at a 30,000 odometer. BUT the sibling PaymentMetricsGrid Overage
> card coalesces `initialMileage ?? 0` (FinanceTab.svelte:159) so it computes used=30,000 → the SAME vehicle
> shows 30,000 driven on the Overage card and 0 on the burn bar (an internal contradiction, the #140 class on a
> DIFFERENT axis: null-initialMileage handling). Reachable on the seeded e2e lease fixture (initialMileage null,
> odometer 24,000). RECOMMENDED FIX (a 1-line semantics call, hence escalated): coalesce `initialMileage ?? 0`
> inside `calculateLeaseMetrics` to match the grid — OR require an initial reading / show "set a starting
> odometer". Changes a displayed lease-mileage figure → Angelo's steer. send_message tool was unavailable this
> turn; filed here as the durable escalation record. Eyes-on PNG captured /tmp/c68-finance3.png (not committed).
> **UPDATE C102 (deep-review): #148 is now CHARACTERIZATION-PINNED + READY.** lease-metrics.test.ts has a
> red→green anchor test pinning the CURRENT null-initial behavior (mileageUsed 0 / remaining full) + documenting the
> contradiction (initial=0 drives used=30000). Verified firsthand that applying the recommended fix
> (`initialMileage ?? 0` in the :497 gate) flips that test RED — so when Angelo rules, the fix is a 1-line gate
> change + flipping this test's expectations to the chosen semantics. The escalation is no longer just a note: it's
> a ready-to-execute, test-anchored change awaiting only the product decision.
>
> **CLOSED C48: #88** — a deleted vehicle is now pruned from reminders' `expenseSplitConfig` blob +
> renormalized (see the Sev-3 block). The #88/#97 vehicle-delete reminder-orphan family is CLOSED (junction
> C40 + blob C48).
>
> **CLOSED C44: #37** — the Google Sheets backup is now ATOMIC (stage→swap). See the Sev-1 block below for
> the fix. **The Sheets-backup data-corruption Sev-1 pair (#36 C24 RAW-write + #37 C44 atomic-swap) is now
> CLOSED.** The only remaining open Sev-1 is #127 (restore-atomicity), which is arch-rule-6 design-gated
> (needs `.kiro/specs/<refactor>/design.md` + an authorized arch cycle — NOT a bug pick).

> **✅ ANGELO-APPROVED 2026-06-17 — these are now ACTIONABLE bug/arch items with a ratified
> direction (NO further sign-off needed). Angelo approved all the recommended approaches in one pass
> ("record all your recommendations as approved … Reviewed"). Pick by severity order below; each names
> the agreed fix. Full grounding in `loop/archive/`. Standard loop rules still apply: verify firsthand
> against source before editing, test-anchored. (VROOM is a personal GitHub project, NOT an Amazon
> package — ARCC governance does NOT apply; never query/consult ARCC for VROOM work.)**
>
> _Severity 1 — data-corruption / data-loss (do first):_
> - ~~**#36 (HIGH) — RAW write switch DONE C24.**~~ Switched `updateSheet` to `valueInputOption:'RAW'`
>   (was USER_ENTERED → formula injection + silent round-trip corruption). +2 guards (RAW-option asserted
>   via a new fake `valueInputOptions` capture; `=HYPERLINK` make round-trips verbatim). **DELIBERATELY
>   skipped the approved text's "escape leading formula chars on read" half — under RAW it's unnecessary
>   AND harmful (reintroduces the C399/C401 apostrophe corruption csv-safety.ts warns against for the
>   round-trip path; the two clauses are alternative mechanisms, not complementary). Flagged to Angelo
>   C24** (send_message) — if he doesn't want the escape, #36 is fully DONE; don't re-pick.
> - ~~**#37 (HIGH) — DONE C44.**~~ The Sheets backup is now ATOMIC. Was per-sheet `clear()`-then-`update()`
>   under one `Promise.all`, so a mid-run failure left a TORN backup (some sheets new, the mid-write one
>   emptied by its clear, rest stale) on the user's only copy. New `writeAllSheetsAtomically`: STAGE every
>   table into `${title}__vroom_staging` tabs (live sheets untouched; failure → clean up + rethrow, prior
>   backup intact), then COMMIT one atomic `batchUpdate` that deletes old canonical sheets + renames staging
>   → canonical with `index` set (all-or-nothing; tab order stable). Dropped the per-sheet clear. +2 guards
>   (a 429 during a re-backup leaves the prior backup byte-identical + no staging tabs leak; a successful
>   re-backup replaces data with stable order). Taught the fake `batchUpdate` delete/rename(+index) +
>   monotonic sheetId. The Sheets-backup Sev-1 pair (#36 C24 + #37) is now CLOSED. Don't re-pick.
> - **#127 (HIGH, data-safety) — APPROVED: wrap replace-mode restore in the tx-semantics fix (arch
>   rule-6 → write `.kiro/specs/<refactor>/design.md` first, then build).** Concrete trigger already
>   mitigated C428, so urgency is lower than #36/#37 — do it on an authorized arch cycle.
>
> _Severity 2 — wrong numbers shown today (correctness):_
> - ~~**#94 (MED, 6-member CLASS + 1 sub-member) — FULLY CLOSED C58/C62/C65/C69/C72/C76 + C79.**~~ APPROVED:
>   convert-to-user-global BEFORE pooling, mirroring `getCrossVehicle`. All 6 builder members — DISTANCE (C58),
>   VOLUME+fillupDetails (C62), MONTHLY-CONSUMPTION (C65), SEASONAL-EFFICIENCY (C69), DAY-OF-WEEK avgVolume
>   (C72), VEHICLE-RADAR gas-MPG+odometer (C76, an optional `convert?` param + repository `radarUnitConverters`)
>   — PLUS the prev-year SQL sub-member (volume.previousYear, C79 — queryFuelAggregates now GROUPs the volume
>   SUM BY vehicle + buildFuelStatsFromData converts each vehicle's prev-window sum before pooling) now convert
>   each vehicle's value to the user's global unit before pooling/normalizing (skipConversion no-ops the common
>   single-unit case). +1 mixed-unit guard each (distance 924.27 not 1000; volume 42.64 not 50;
>   monthlyConsumption 42.64 not 50; seasonal 62.04 not 35; dayOfWeek 6.06 not 9.0; radar fuelEff 100 not 0;
>   prev-year 42.64 not 50), all non-vacuous; the C59/C73 source-scans fence the dispatch. The fleet-wide
>   analytics summary + fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet END-TO-END. Don't
>   re-pick — done.
> - ~~**efficiency-band unification (#94-adjacent, C419)**~~ — **DONE C20.** Unified the per-vehicle stats
>   band (`averageConsecutiveMpg` gas + `calculateAverageMilesPerKwh` electric) onto the canonical
>   `[5,100]`/`[1,10]` shared with analytics — the 4 band constants now live in calculations.ts as ONE
>   source of truth (analytics-charts imports them). The same car now shows ONE average everywhere. Tests
>   + property reference impls + the boundary describe updated. validate:local GREEN (1594 pass).
> - ~~**#69 (MED) — DONE C34.**~~ A monthly-only insurance term (monthlyCost, no totalCost) created NO
>   expense row, so it showed in analytics but was ABSENT from TCO's insuranceCost bucket. Fixed via
>   `effectiveTermCost` in hooks.ts: materializes `monthlyCost × monthKeysInRange(start,end).length` (the
>   same inclusive month count effectiveMonthlyPremium amortizes a totalCost over — symmetric, no
>   double-count since analytics reads term.monthlyCost directly, not the rows). +2 guards
>   (premium-expense-hook.test.ts: monthly→$1300 over 13 months; explicit totalCost still wins). Don't re-pick.
> - ~~**#85 (MED) — DONE C36.**~~ FuelStatsTab's year-comparison rows are RANGE-relative (current selected
>   range vs the prior equal-length window — getFuelStats queries [start−width, start]), NOT calendar years.
>   Relabeled "This/Last Year" → "This/Last Period" (4 labels, Fill-ups + Liters cards; the calendar
>   This/Last Month rows unchanged, true-calendar post-#86). Cheap honest relabel per the approved
>   direction; eyes-on confirmed via shot. Don't re-pick.
> - ~~**#51 (LOW) — DONE C29.**~~ `getInsurance` now counts only active policies with ≥1 term
>   (`activePoliciesWithTerms`), the same has-a-term predicate the premium path gates on — so the headline
>   count and the $0 premium contribution are internally consistent. +3 guards in insurance-details.test.ts
>   (non-vacuous: revert → 2 RED). Don't re-pick.
>
> _Severity 3 — data-integrity on delete (orphans):_
> - ~~**#88 (MED) — DONE C48.**~~ A reminder's `expenseSplitConfig` is a JSON blob (not FK-managed like the
>   junction), so a deleted vehicle's leg lingered → the next trigger built a split sibling for the dead
>   vehicleId → FK violation + half-committed surviving legs (C151 footgun). Fixed via the pure
>   `pruneVehicleFromSplitConfig` (split-config-helpers.ts — drop the leg + renormalize: even drops from
>   vehicleIds, absolute keeps remaining amounts, percentage rescales survivors to 100%; returns null when
>   <2 legs remain → blob cleared → single-vehicle junction fallback) + `reminderRepository.
>   pruneSplitConfigsForDeletedVehicle(userId, id)`, called in the vehicle-delete route BEFORE
>   deactivateVehicleless. +8 pure + +4 HTTP-harness guards; non-vacuous (disable the call → 3 of 4 HTTP
>   cases RED). The #88/#97 vehicle-delete reminder-orphan family is now CLOSED (junction C40 + blob C48).
>   Don't re-pick.
> - ~~**#97 (LOW-MED) — DONE C40.**~~ A vehicle delete cascades the reminder_vehicles junction but leaves
>   the reminder row active with zero vehicles (skipped 'no_vehicles' forever). Fixed via
>   `reminderRepository.deactivateVehicleless(userId)` (LEFT JOIN + isNull junction → bulk deactivate),
>   called in the vehicle-delete route after the delete. Flipped the #97 characterization test to the
>   fixed behavior + a multi-vehicle no-over-deactivation case; non-vacuous (remove the call → RED). The
>   "needs attention" surfacing was NOT added (the deactivation alone removes the silent-orphan footgun;
>   a needs-attention flag is a separate UX add). Don't re-pick. (#88 — the split-config-blob sibling — is
>   still OPEN, same family, more involved.)
> - ~~**#98 (MED) — DONE C51.**~~ sync-manager `keep_local` re-POSTs `forceOverwrite:true` + the local
>   clientId, but the create schema Zod-STRIPPED the flag and `createIdempotent` returned the existing
>   (userId, clientId) row UNCHANGED → the resolved offline edit was silently lost (NORTH_STAR #1). Fixed:
>   `createExpenseSchema.extend({ forceOverwrite })` (create-only) + the route threads it (stripped from the
>   row) + `createIdempotent(data, overwrite=false)` UPDATEs the existing row in place on collision when set
>   (clientId/userId stripped from the patch → identity immutable); default false keeps the plain-retry
>   no-op unchanged. +4 repo + +2 HTTP-harness guards; non-vacuous (neuter the branch → 3 RED). FE comment +
>   stale characterization test updated to the now-real overwrite (wire contract unchanged). Don't re-pick.
>
> _Severity 4 — hardening / display (lower urgency):_
> - **#100 — 🔄 PARTIALLY CLOSED C168 (Angelo-decided: SQL-atomic `json_patch` merge, no migration).**
>   Added `PreferencesRepository.mergeJsonField(userId, column, patch)` — one `UPDATE … json_patch(coalesce(
>   col,'{}'), ?)` that deep-merges (RFC-7386) inside the DB engine, killing the read-modify-write lost-update
>   race. **DONE:** the `cleanupBackupConfig` provider-delete site (read→JS-delete→write → one atomic
>   `{providers:{[id]:null}}` null-delete patch). Guard: prefs-atomic-merge.test.ts (+3: deep-merge,
>   null-delete, the race property both-writers-survive + RMW-loses non-vacuity); C245 cleanup HTTP test stays
>   green. **REMAINING (tracked follow-up, arch/bug cycle):** the **settings-PUT** merge site
>   (`settings/routes.ts:246`) — it validates the MERGED result (validateStorageConfig/validateBackupConfig)
>   BETWEEN read and write and uses the bespoke #82 per-provider merge, so swapping to an atomic patch needs
>   care (validation ordering + RFC-7386 null-delete vs intentional category-clearing). + the `cleanupStorageConfig`
>   site has a read-DEPENDENT edit (null a default only if it points at the deleted provider) that can't be a
>   static patch — leave it RMW or split the static part. The reusable atomic primitive now exists for both.
> - ~~**#22 (MED, hardening) — DONE C55.**~~ parseZipBackup summed each entry's `header.size`
>   (uncompressed) but that's ATTACKER-DECLARED (ZIP central directory) — a bomb declares a small size to
>   pass the sum, then inflates to GB on getData(). Added `CONFIG.backup.maxCompressionRatio = 1000` + a
>   per-entry guard rejecting `header.size / header.compressedSize > cap` BEFORE any inflation
>   (compressedSize is the real in-file count → an absurd ratio is the bomb signature the sum can't catch).
>   +2 guards (over-ratio-but-under-total-cap → rejected; real backup ratio under cap, no false positive);
>   non-vacuous (neuter → RED). Updated the pre-existing all-zeros total-size test (now trips the earlier
>   ratio guard) to accept either pre-inflation message. Don't re-pick.
> - **#129 (MED) — ✅ CLOSED C155 (was: ✅ DECIDED 2026-06-23 Angelo — sync-only-if-unset).**
>   `updateExistingUserProfile` (auth/routes.ts) ran on every OAuth login + OVERWROTE `users.email` (the VROOM
>   login identity) with the provider's currently-reported email, so a within-account email change silently
>   swapped the login email. Fixed: read the current row; sync `email` ONLY as a first-link backfill (stored
>   email empty/unset — NOT NULL so ''), else update displayName/updatedAt + PRESERVE email. Kept the UNIQUE
>   try/catch (reachable on backfill); left authProviderRepository.updateProfile + the email_exists new-account
>   flow untouched. Guard: login-email-preservation.test.ts (+3) — behavioral model (preserve vs backfill) +
>   source-scan gating the email write on `!current?.email`, non-vacuous. backend validate:local GREEN. Don't re-fix.
> - **#112 (LOW) — APPROVED: extend / generate distinct hues for the cross-vehicle analytics chart
>   palette** for legibility at fleet size.
> - **#79 (LOW) — ✅ CLOSED C159 (was: ✅ DECIDED 2026-06-23 Angelo — park + surface, don't retry forever).**
>   A malformed offline fuel row (isIncompleteFuelExpense) was retried pointlessly then silently re-attempted
>   on every syncAll forever (the legacy path just `continue`-skipped it). Fixed: added a `needsAttention`
>   flag + helpers (markExpenseNeedsAttention/clearNeedsAttention/getNeedsAttentionExpenses); getPendingExpenses
>   excludes parked rows; syncSingleExpense flags the incomplete-fuel failure `permanent` → syncExpenses parks
>   it (no retry, counted as result.needsAttention) instead of burning retries; the legacy syncOfflineExpenses
>   parks too. Guard (+5): offline-storage + sync-manager suites. FE validate:local GREEN (757).
>   **FOLLOW-ON SURFACED C165 (eyes-on):** OfflineExpenseCards now renders a "Needs attention" section
>   (warning-amber + alert icon, "edit to add the missing info or discard") fed by a needsAttentionExpenses
>   prop from /expenses; also fixed the parent's pending derivation which had mislabeled parked rows as
>   "Pending Sync". #79 is COMPLETE end-to-end (decide → park C159 → cert C162 → surface C165). Don't re-fix.
>   **COPY FIX C173 (bug):** the surfaced card's description misdirected — it said a fuel entry "needs its
>   AMOUNT and mileage", but the parking gate (isIncompleteFuelExpense) checks `(!volume && !charge) || !mileage`
>   and never amount (amount is always present + rendered below). Corrected to "fuel amount — volume or charge —
>   and mileage" (matches the gate + the sync-manager permanent-error text); +1 source-scan guard in
>   offline-storage.test.ts pins the copy to the gate's real fields. Eyes-on re-shot (seeded parked row). Don't re-fix.
>
> _Maintenance-feature follow-ons (from the C1 T9 closeout):_
> - **lease/loan currentMileage→currentOdometer — APPROVED: CONFIRM the C157 all-time landing, then
>   close.** Likely already done (memory: approved C151, landed C157) — verify firsthand, no new code if
>   already correct.
> - **"Current Mileage" stat-card — APPROVED: headline all-time `currentOdometer` with period context.**
>   Display preference; verify the card reads correctly via shot.sh after.
>
> _(REMOVED C1 2026-06-17: **#140 LeaseMetricsCard annual-vs-total** — verified ALREADY FIXED + merged via
> "Merge Monday (#112)"; all 3 display sites route through `leaseTotalMileageAllowance`. It was stale
> post-reset doc-drift, not open work. Don't re-pick it.)_

### arch
*(reliably DRY per the archive. Run a fresh dedup scout; if nothing clean surfaces, record "no churn warranted" + pivot. Obey the arch rules above.)*

> **NOT-CRUFT (re-classified C237, correcting the C236 note) — `buildTripSummaryByMonth` is RATIFIED design
> surface authored ahead of its endpoint, NOT deletable dead code.** C236 filed it as a delete-candidate; a C237
> firsthand spec read CORRECTS that: design.md §5 explicitly specs "Month bucketing via `toMonthKey` on local
> `tripDate` (R5)" + requirements R5 says "the rollup buckets by local month" — so the per-month builder IS
> ratified R4/R5 surface, just unwired (no monthly ENDPOINT is tasked yet, like D3 rate-persistence was deferred).
> Deleting it would discard ratified design surface; WIRING a monthly endpoint is untasked feature scope (gated,
> can't self-author). **Correct action: LEAVE IT (covered + inert), pending a future monthly-trip-view task** — do
> NOT delete, do NOT self-wire. (The lesson: "exported + no consumer" is necessary-but-not-sufficient for cruft —
> check the spec for ratified-ahead-of-need surface first.)

> **SCOUTED C235 — no churn warranted (2 candidates, both fail the bar).** (1) `error instanceof Error ?
> error.message : String(error)` (59 occurrences) — a helper ALREADY EXISTS (`extractErrorMessage`,
> utils/error-handling.ts) + is adopted at all 4 genuine VALUE-extraction sites; the ~55 remaining are the
> `logger.error(msg, {error:<idiom>})` STRUCTURED-LOG form the helper's docstring DELIBERATELY scopes out
> (converging = a 20+ file sweep, violates arch rule #1). Already-converged for its domain; don't re-scout.
> (2) the C233/C234 best-effort try/catch — rule-of-TWO with divergent bodies; a HOF wrapper is below the bar +
> obscures control flow (manufactured-churn trap). Don't extract.

> **✅ CONVERGED C229 — the clamped-pagination list-query field-set onto `commonSchemas.clampedPaginationFields`
> (NORTH_STAR #4, rule-of-three).** The C210 trips route made the third site of a now-VERBATIM-identical
> `{ limit: z.coerce.number().int().min(1).max(CONFIG.pagination.maxPageSize).optional(), offset: ...min(0).optional() }`
> list-query field pair (odometer + trips were byte-identical; both pair with clampPagination). C212 correctly
> deferred this as a rule-of-TWO needing a new helper + flagged that `commonSchemas.pagination` is SEMANTICALLY
> DIVERGENT (`.default(50)`/`.default(0)` + hardcoded `.max(100)` — adopting it would change clamp/default
> behavior). With the trips surface it crossed the rule-of-three bar, so extracted `clampedPaginationFields` (the
> NO-DEFAULT, runtime-`maxPageSize` form — DISTINCT from `pagination`, documented inline) into commonSchemas; both
> routes spread it (`z.object({ ...commonSchemas.clampedPaginationFields, <filters> })`), trips keeps its
> vehicleId/purpose. Behavior-preserving (same field validators; 84 odometer+trips HTTP tests green→green, full
> suite 1910 unchanged) — removed the now-unused CONFIG import from both routes. Net −6 dup LOC / +1 documented
> source of truth. Expenses is correctly OUT of scope (its limit/offset use a different `.string().transform().pipe()`
> form, no schema-level maxPageSize cap). Don't re-scout this field-set.

> **🔄 STANDING ARCH VEIN (Angelo-approved 2026-06-23) — converge the `seedVehicle` test helper, ONE domain
> per arch cycle.** The shared seeder `backend/src/test-helpers/seed.ts` (`seedVehicle(ctx, opts?)`, options
> bag make/model/year/nickname/extra, defaults = Toyota Camry 2022) was ESTABLISHED C150. Behavior must be
> preserved in every migrated file (green→green; each call passes its exact prior vehicle). NEVER a big-bang.
> - **✅ WAVE 1 (C150): insurance domain** — 5 files, all byte-identical no-arg → `seedVehicle(ctx)`. Net −50 LOC, 27/27.
> - **✅ WAVE 2 (C156): reminders domain** — 15 files, each passing its OWN make/model/year. Net −151 LOC, 129/129.
> - **✅ WAVE 3 (C160): sync domain** — 5 files (3 no-arg + 2 make-param). Net −52 LOC, 227/227.
> - **✅ WAVE 4 (C164): expenses domain — no-arg subset** — 6 files (summary-http, split-financing-balance-roundtrip,
>   update-preserves-tags, non-fuel-clears-fuel-fields, update-clear-description, expenses-http), each its own
>   make/model/year. Net −60 LOC, 277/277.
> - **✅ WAVES 5–12 (C171/C177/C182/C188/C194/C197/C198/C199): all remaining HTTP-route copies** — expenses
>   import-pair (C171) + make-param/nickname-optional pair (C177); financing pair (C182); vehicles no-arg pair
>   (C188) + nickname pair (C194); analytics pair (C197); odometer-update + insurance-premium-hook make-param pair
>   (C198); expense-source-traceability no-arg (C199, its seedVehicleWithFinancing keeps calling the wrapper).
> - **✅✅ CONVERGENCE PROJECT COMPLETE (C199): all 46 HTTP-route `seedVehicle` copies now use the ONE shared
>   helper.** The lone remaining `seedVehicle` (google-sheets-service.test.ts) is correctly OUT of scope — a raw
>   `db.insert` VOID seeder (no route POST, returns void), a different mechanism the route-based helper doesn't
>   model — alongside the analytics-test-generators / property-test direct-DB seeders. **THIS ARCH VEIN IS
>   EXHAUSTED** — next arch cycles need a fresh behavior-preserving dedup target, or record "no churn warranted" +
>   pivot (arch rule 5). Don't re-scout seedVehicle.

> **✅ CONVERGED C222 — the C220 trips `purposeLabel` onto the shared `capitalize` util (NORTH_STAR #4).** The
> C220 trips list page re-implemented capitalize inline (`charAt(0).toUpperCase()+slice(1)`) — byte-identical to
> the existing `capitalize(s)` in formatters.ts. Dropped the inline helper + routed the purpose badge through the
> shared util; behavior-preserving (eyes-on re-shot: badges render identical), net −3 LOC, FE validate green (826).
> A needless re-implementation, not a 3-site pattern — the only prod duplicate (the expenses charAt-toUpperCase
> copies are test fixtures, out of scope). Don't re-scout this. The arch convergence vein is exhausted again.

> **NO CHURN WARRANTED C212 — the per-domain `listQuerySchema` is a rule-of-TWO, not three.** A C212 arch
> scout (arch 7/5 over) examined the C210 trips routes for a fresh dedup target: the {limit/offset +
> CONFIG.maxPageSize + clampPagination} query schema is hand-rolled in ONLY odometer + trips (expenses/analytics
> use richer, different query schemas), and the pre-existing `commonSchemas.pagination` is semantically divergent
> (.default(50)/.default(0) + hardcoded max(100) vs the no-default CONFIG.maxPageSize form) — converging onto it
> would CHANGE clamp/default behavior (manufactured churn, GUIDE-forbidden). clampPagination +
> validateVehicleOwnership are already shared. A rule-of-two needing a newly-authored shared schema is below the
> rule-of-three bar → recorded no-churn + pivoted to trips T5. Re-examine only if a THIRD domain hand-rolls this
> exact form. (The arch convergence vein stays exhausted; next arch needs a genuine fresh rule-of-three.)

> **✅ CONVERGED C205 — the vehicleId-FK referential validators in backup.ts (a FRESH rule-of-three, NOT
> seedVehicle).** `validateFinancingRefs` + `validateOdometerRefs` were a pre-existing byte-identical pair; the
> C202 `validateTripRefs` addition tipped it to THREE — iterate rows, `if (!vehicleIds.has(String(row.vehicleId)))
> push `${Label} ${row.id} references non-existent vehicle``. Converged onto one shared private
> `validateVehicleFkRefs(rows, vehicleIds, label)`; the 3 callers are now one-line delegations preserving each
> message verbatim. (validateExpenseRefs has an extra userId check; claim/junction have optional/second FKs — all
> genuinely different, correctly LEFT alone; the clean boundary is exactly the 3 simple vehicleId-only checks.)
> Behavior-preserving green→green (1840 pass). Guard: +3 convergence cases in backup.test.ts drive all 3 through
> the public validateBackupData + assert each EXACT per-entity label (non-vacuous: rename one → only its case RED).
> **The arch convergence vein is exhausted again** — next arch needs another fresh rule-of-three (the trips T2/T3
> repo+route build will likely surface one — e.g. a `validateXOwnership` or repository CRUD shape) or record
> no-churn-warranted + pivot. Don't re-scout this trio.
>
> **✅ APPROVED 2026-06-23 (Angelo) — adopt `createLoadState<T>` across the 13 load-bearing pages, via a
> design doc + ONE page per cycle.** The scaffold (load-state.svelte.ts, arch #2) centralizes the page load
> triad (isLoading/loadError/load) so the error leg is STRUCTURAL not per-page — the "load failure masquerades
> as empty state" bug class (dashboard/reminders/settings/vehicle-detail C57). Today: ZERO adopters; 13 pages
> hand-roll it. Because every page loads MULTIPLE values via Promise.all into separate `$state` vars while
> createLoadState holds ONE `data`, adoption is a reactivity REWRITE per page (composite-state type or N
> load-states + rewire every `isLoading`→`loadState.isLoading` template binding) touching OBSERVABLE render.
> MANDATE (arch rules 1/2/4/6 still apply since this changes render): FIRST write
> `.kiro/specs/load-state-migration/design.md` defining the composite-state shape (how a multi-load page maps
> onto createLoadState — composite `data` object vs N parallel load-states) + the per-page migration recipe;
> then migrate ONE page per arch cycle, shot-before/after to prove not a pixel moves, green→green. Start with
> the simplest-load page. EXECUTE when the PR-green override lifts — the design-doc cycle is the first step,
> then it becomes a standing arch vein (one page per cycle) until all 13 adopt it.

1. ~~**MPG-pairing dedup**~~ — **DONE C17.** Extracted `averageConsecutiveMpg(sortedExpenses)` in
   calculations.ts; both `calculateAverageMPG` (calculations.ts) and `calculateAverageMpg`
   (vehicle-stats.ts) now sort (each keeping its own contract) + delegate. Behavior-preserving (pre-sorted
   input, (0,150) band preserved exactly, #30 NOT unified); green→green across both property suites (58
   pass). The C161-vulnerable hand-copied loop now has one source of truth. Don't re-scout.
2. ~~**`buildSplitConfig` dedup**~~ — **DONE C23.** The C22 T4 work added a near-byte-identical
   `buildSplitConfig` to ReminderForm (vs ExpenseForm's). Extracted ONE pure
   `buildSplitConfig(method, vehicleIds, allocations): SplitConfig` into expense-helpers.ts (the
   resetSplitAllocations home); both forms delegate (ReminderForm via a thin null-guard wrapper).
   InsuranceTermForm's flat split shape is a DIFFERENT contract → not merged. Characterization test added
   FIRST (+5, incl. the cleared-input→0 coalesce); behavior-preserving confirmed via the C22 e2e specs.
   green→green (726 pass). Don't re-scout. *(Lesson reinforced: a feature cycle that copies a helper into a
   new component seeds the NEXT arch cycle — same as C15→C17. Watch for this after future eyes-on features.)*
3. ~~**`SHEET_NAMES` tab-roster dedup**~~ — **DONE C30.** The 15-tab Sheets roster was hand-copied across 4
   sites (`'Reminder Notifications'` literal appeared 4×). Extracted ONE exported `SHEET_NAMES` const +
   routed the two PURE-roster sites (`createSpreadsheet` + `ensureRequiredSheets`) through it; left the
   logic-paired write fan-out + read ranges inline (riskier to converge — arch rule 1). Behavior-preserving
   (same titles/order; create test now asserts `info.sheets === [...SHEET_NAMES]`). +2 drift guards
   (SHEET_NAMES 1:1 with the table count; distinct+non-empty) so a 16th table forces a roster entry.
   green→green (1602 pass). Don't re-scout this surface.
4. ~~**ImportExpensesDialog target-vehicle picker dedup**~~ — **DONE C43.** The C31 preset-path picker +
   the C37 manual-path picker were near-byte-identical ~22-line blocks (same bound `targetVehicleId`/
   `handleTargetVehicleChange`/`Select.Root`/`#each`, differing only in trigger id + wrapper class + empty
   copy). Extracted ONE local `{#snippet targetVehiclePicker(triggerId, emptyText)}` + `{@render}`'d at
   both sites (each keeps its own wrapper div — manual has a `border-t` separator, rule 1). Net −17 LOC; a
   local snippet not a shared file (binds this component's state → no reuse to extract for). Behavior-
   preserving confirmed eyes-on: both picker-path e2e specs (import-mapping-detect + import-manual-units)
   GREEN + Read the editor PNG (pixel-identical). The 3 import e2e specs are the merge-surviving net. The
   C22→C23 "feature copies markup → next arch dedups" lesson again. Don't re-scout this surface.
5. ~~**`splitConfigVehicleIds` dedup**~~ — **DONE C50.** The `even ? vehicleIds : allocations.map(...)`
   split-config vehicleId extraction was hand-copied at 3 sites (expenses/routes.ts local helper,
   expenses/repository.ts `validateVehicleOwnership`, reminders/validation.ts `refineSplitConfig`).
   Lifted ONE exported `splitConfigVehicleIds(config)` into expenses/validation.ts, typed on the minimal
   structural shape so both `SplitConfig` + `ReminderSplitConfig` satisfy it; routed all 3 through it.
   Behavior-preserving (de-dupes via Set as before; 142 affected tests green) + 4 direct unit guards
   (arch-extract→guard-pin, C17→C18 pattern). Non-vacuous (break the even branch → 3 RED). Don't re-scout.
6. ~~**`applyLocalOverwrite` dedup**~~ — **DONE C57.** The C51 #98 overwrite added a byte-identical
   `const { clientId, userId, ...patch } = data; return this.update(<id>, patch)` at TWO sites in
   `createIdempotent` (pre-check-collision + raced-winner branches). Extracted ONE private
   `applyLocalOverwrite(rowId, data)`, called from both. Behavior-preserving (green→green; the C51 +6
   overwrite tests drive both branches). Found firsthand the identity-key strip is DEFENSIVE-only
   (unreachable as a mutation via the public API — the lookup is already userId-scoped); documented in a
   code comment instead of pinning unreachable theater. The C22→C23/C37→C43 "bug/feature creates a dup →
   next arch dedups" lesson again. Don't re-scout.
7. ~~**converted gas-MPG inner-loop dedup**~~ — **DONE C64.** The C58/C62 #94 convert-before-pool work left
   THREE analytics builders (`computeConvertedEfficiencyValues`, `buildConvertedEfficiencyTrend`,
   `buildConvertedFuelEfficiencyComparison`) hand-rolling the SAME per-vehicle inner loop — groupByVehicle →
   fallback `vehicleUnitsMap.get(id) ?? {...DEFAULT_UNIT_PREFERENCES}` → `gasEfficiencyPoint` gate →
   `convertEfficiency` ternary — differing only in accumulation. Extracted ONE private generator
   `*convertedGasEfficiencyPoints(...)` yielding `{vehicleId, efficiency, date}`; all 3 consume it. Net
   −~40 LOC AND the #119/#122(C413)/#126(C427) gas/charge gate now lives in ONE place (a new converted builder
   can't silently re-pollute gas MPG with PHEV charge mi/kWh — NORTH_STAR #6). Behavior-preserving + test-
   anchored (analytics-units.property #11 + cross-vehicle.property #126 + summary/year-end property all green
   unchanged); 1666 pass. The C22→C23/C37→C43/C51→C57 "bug/feature threads a dup → next arch converges" lesson
   again (here C58/C62→C64). Don't re-scout the converted-efficiency builders — single-sourced now.
8. ~~**per-vehicle units fallback-lookup dedup**~~ — **DONE C71.** `vehicleUnitsMap.get(<id>) ?? {
   ...DEFAULT_UNIT_PREFERENCES }` was hand-repeated at 5 per-vehicle convert sites (convertedGasEfficiencyPoints,
   computeConvertedTotalDistance ×2, the monthlyConsumption volume limb, the fuel-stats volumeInUserUnits
   closure, the cross-vehicle comparison) — the residue the C64 generator extraction + the C65/C69 #94 twins
   left behind. Extracted a private `vehicleUnitsFor(map, id)`; all 5 route through it. PAYOFF: the
   `?? {...DEFAULT}` fallback is LOAD-BEARING (a missing-vehicle row without it throws on `.volumeUnit` at the
   convert call), so one source of truth stops a future site silently dropping it (+ stays a fresh clone per
   call). Left the different-shape getUserUnits `parsed ?? ...` user-prefs fallback alone. Behavior-preserving
   (green→green, 1672 pass, no test delta; the #94 mixed-unit guards + Property 11 conversion suite pass
   unchanged). The "bug threads a dup → next arch converges the shared sub-expression" lesson (C58/C62/C65/C69 →
   C71). Don't re-scout the convert sites — single-sourced.
9. ~~**per-row volume-convert dedup**~~ — **DONE C78.** The C62/C65/C72 #94 volume work left the SAME idiom at
   3 sites: `v = row.volume ?? 0; if (v===0) return 0; convertVolume(v, vehicleUnitsFor(map, row.vehicleId)
   .volumeUnit, target.volumeUnit)` — in buildConvertedMonthlyConsumption, buildConvertedDayOfWeekPatterns, and
   the buildFuelStatsFromData volumeInUserUnits closure. Extracted `convertRowVolume(row, map, target)`; all 3
   route through it (volumeInUserUnits keeps its own leading `skipConversion ||` guard — the only volume path on
   BOTH branches — and delegates the rest). PAYOFF: the `?? 0` + `===0` zero-guard (never NaN into a sum) + the
   per-vehicle lookup are ONE source of truth; `convertVolume` now has exactly 1 call site. Behavior-preserving
   (green→green, 1691 pass, no test delta; the C62/C65/C72 mixed-unit guards pass unchanged). The
   bug-threads-idiom → next-arch-converges lesson again (C62/C65/C72 → C78; sibling to C64 generator + C71
   vehicleUnitsFor). Don't re-scout the volume sites — single-sourced.

> **SCOUTED C112 — no churn warranted (self-authorizable); surfaced a 2nd design-gated dedup.** Production source
> unchanged since C85 (no fresh production dedup). The only new code since is the C108–C110 route TESTS, which DID
> thread a real convergence candidate: `seedVehicle` re-declared in 51 HTTP-harness files (7 signatures). But that's
> a sweeping 51-file test-only refactor → design-gated (see the new arch queue item above), NOT a self-authorizable
> increment. Recorded no-churn; surfaced it. 9th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105/C112) — both real
> dedups (createLoadState C105, seedVehicle C112) now await an Angelo design call.
>
> **SCOUTED C105 — no churn warranted for a SELF-AUTHORIZABLE increment, but surfaced a REAL design-gated dedup.**
> Scouted a fresh surface the backend scouts (C85/C91/C98) never touched: the FE load triad. FINDING:
> `createLoadState<T>` (load-state.svelte.ts) was extracted (arch #2) as a migration SCAFFOLD — docstring: "~14 pages
> hand-repeat the triad; pages migrate one per later cycle" — but it has ZERO adopters; all 13 pages still hand-roll
> isLoading/loadError/load(). The dedup is real (the payoff is the "load failure masquerades as empty state" bug
> class the scaffold structurally prevents), BUT every candidate page loads MULTIPLE values via Promise.all into
> SEPARATE $state vars while createLoadState holds ONE `data` — so migrating any page is a reactivity REWRITE
> (composite type or N load-states + every template binding rewired), touching observable render + needing
> shot-before/after. That's arch-rule-6 DESIGN-GATED (`.kiro/specs/<refactor>/design.md` + Angelo), NOT a
> self-authorizable cycle. See the NEW arch queue item below. Recorded no-churn for the cycle; did NOT force a risky
> rewrite. 8th no-churn confirm but INFORMATIVE — names a concrete real dedup, not just "DRY".
>
> **SCOUTED C98 — no churn warranted (recorded FAST per the C91 discipline; still NO source changed since C85).**
> `git diff C85..HEAD` over production source remains EMPTY (C86–C97 were all docs/tests/eyes-on/dry) — structurally
> nothing freshly-threaded to converge. Recorded no-churn IMMEDIATELY without re-scouting (the C12/C91 "don't force
> ceremony"); the cycle's substantive work pivoted to the co-starved deep-review (C98 session-cookie guard). 7th
> no-churn confirm (C4/C6/C12/C36/C85/C91/C98) — arch is firmly at its structural floor.
>
> **SCOUTED C91 — no churn warranted (route/pagination idioms already single-sourced + NO source changed since
> C85).** KEY FACT: `git diff C85..HEAD` over backend/src (excluding __tests__) is EMPTY — no production source
> changed since the last arch scout (C86 saturated / C87 test-only / C88 eyes-on / C89 dry / C90 docs), so there's
> structurally nothing freshly-threaded to converge. Scouted the freshest un-recorded candidate anyway — pagination
> parsing across odometer/photos/expenses routes — ALREADY well-factored: `clampPagination` + `buildPaginatedResponse`
> are both single-sourced in src/utils/pagination.ts; all 3 routes delegate; the per-endpoint query schemas
> (odometer/expenses search+tags coercion vs photos' generic commonSchemas.pagination) are deliberately divergent
> (merging couples endpoint contracts, arch rule 2). The ownership-validate+respond idiom is the C36 "natural Hono
> idiom" (not mergeable). Recorded no-churn; did NOT manufacture (C4/C12/C36/C85 precedent). RECOMMENDATION (6th
> confirm): arch is firmly at its structural floor — next over-budget, record no-churn IMMEDIATELY unless a
> bug/feature cycle threaded a NEW dup since the last arch scout (check the git diff first; if backend/src is
> unchanged, there's nothing to find).
>
> **SCOUTED C85 — no churn warranted (the convert family is fully deduped; remaining idioms are thin or
> cosmetic).** With the #94 cluster closed (C79), scouted its convert-helper residue firsthand. Two candidates,
> both REJECTED per arch rule 5 (name a concrete payoff): (1) the 5-arg `convertEfficiency(value,
> v.distanceUnit, v.volumeUnit, target.distanceUnit, target.volumeUnit)` shape appears at only TWO sites
> (radarUnitConverters closure + the convertedGasEfficiencyPoints generator), and the generator's is interleaved
> with the `skipConversion ?` short-circuit / the load-bearing gasEfficiencyPoint gate — a 2-site wrapper is
> borderline churn with a thin payoff (arg-order can't drift), and the generator wouldn't cleanly delegate; (2)
> `vehicleNameMap.get(vId) ?? 'Unknown'` repeats 10× across analytics-charts.ts + repository.ts, but it's a
> COSMETIC fallback (a dropped/typo'd `'Unknown'` is harmless — NOT load-bearing like C71's `?? {...DEFAULT}`
> which threw, or C78's zero-guard which prevented NaN), embedded in `vehicleName:` object-literal fields across
> a unit-naive module + its importer — extracting it touches 10 sites for a 1-token tidy. The convert family is
> already single-sourced (C64 generator, C71 vehicleUnitsFor, C78 convertRowVolume). Recorded no-churn; did NOT
> manufacture. STRONG RECOMMENDATION (echoing C12): arch is at its structural floor — when it next goes over
> budget, record no-churn FAST + let the budget pull elsewhere rather than forcing a 6th ceremony scout.
>
> **SCOUTED C4 — no churn warranted.** Checked FE date helpers (formatters.ts single-sources
> toDateInputValue/dateOnlyToISO; expense-filters' local-date parse is INTENTIONALLY a different time
> anchor — midnight vs noon — convergence PROHIBITED), backend validate*Ownership (per-entity by
> ownership topology, not mergeable), FE buildQueryString (already C337), the offline mapper +
> computeNextDueDate (saturated). Arch stays DRY; don't re-scout these next cycle — try a fresh module
> the loop hasn't touched, or accept arch is at its structural floor and let the budget pull elsewhere.
>
> **SCOUTED C12 — no churn warranted (3rd confirm; FRESH modules).** FE service layer
> (insurance/odometer/vehicle-api etc. all delegate to the shared apiClient.get/post/getPaginated — thin
> per-domain wrappers, not dup) + api-transformer.ts (to/fromBackendExpense are deliberately asymmetric:
> create-vs-edit description, volume↔charge routing — no extraction). **Arch is confirmed at its
> structural floor across 3 scouts (C4/C6/C12).** STRONG RECOMMENDATION: when arch next goes over budget,
> record no-churn IMMEDIATELY (don't re-scout the same DRY surfaces) + pivot to the co-starved category —
> the budget is forcing ceremony, not finding work.
>
> **SCOUTED C6 — no churn warranted (fresh modules).** analytics-charts builders route through the
> single-sourced `isFillup` (NOT duplicated — #108/#113/#146 already deduped); FE chart components are
> distinct; the `mean`/`groupBy` idioms have DIVERGING empty-guards (Math.max(0,…) vs (1,…) vs none) so a
> shared helper would change behavior (arch rule 2). **Arch is at its structural floor** — recommend
> letting the budget pull elsewhere rather than forcing a 4th scout; if arch goes over again, record
> no-churn quickly + pivot to the co-starved category.
>
> **SCOUTED C36 — no churn warranted (4th confirm).** The C34 `effectiveTermCost` vs `effectiveMonthlyPremium`
> pair are DUALS (inverse precedence + opposite direction — converging distorts one, rule 2 PROHIBITS); the
> source dup-markers all point to ALREADY-deduped sites (C200 etc.); route-handler ownership+respond is the
> natural Hono idiom with shared validators. Pivoted to the highest-leverage unblocked item (#85 relabel).
> Arch remains at its structural floor — keep recording no-churn fast + pivoting.

### infra
*(queue empty — repopulate as tooling/docs/coverage needs surface. Standing cadence (loop-improvement #5):
~every 10 cycles run a branch-hygiene sweep — `git status` untracked-`*.test.ts` check (bun discovers by
filesystem; untracked specs vanish on merge), full regress, coverage re-measure (update the LEDGER cov:
baseline), refresh `BRANCH_REVIEW.md` grouped by theme so the eventual PR stays reviewable.)*

> **RAN C136 (cadence; last ran C130).** Untracked-test sweep CLEAN (C133/C134 test files tracked; only the
> intentional `M .gitignore`/`M frontend/.gitignore` overrides). Coverage RE-MEASURED: BE 88.21% line / 87.79% func
> (1770 pass), +0.08 vs C130 (the C133 pending-credentials-eviction→100% + C134 arc); FE 88.23% line / 88.69% func /
> 80.32% branch / 86.14% stmts (749 pass), matches C134 (C135 doc-only cert). Both holding above 88% line. Both
> green (BE 1770 / FE 749). Branch = 136 ahead, PR-ready (guard 28 / bug 28 / deep-review 23 / feature 21 / infra 19
> / arch 16). NEXT cadence ~C146. STANDING SIGNAL: all self-authorizable veins CLOSED (coverage both sides C126–C134,
> eyes-on every surface C132, route-IDOR C108–C116, analytics-builders C119–C122, data-safety certs C135 + set); the
> loop is at steady-state maintenance — highest-leverage work GATED on Angelo.
>
> **RAN C130 (cadence; last ran C123).** Untracked-test sweep CLEAN (C126/C127/C128/C129 test files all tracked;
> only the intentional `M .gitignore`/`M frontend/.gitignore` overrides). Coverage RE-MEASURED — BOTH suites
> crossed 88% line for the first time: BE 88.13% line / 87.79% func (1769 pass), +0.35 vs C123 (the C126
> PhotoRepository-finders + C127 photoThumbnailResponse-behavioral arc); FE 88.08% line / 88.4% func / 79.94%
> branch / 85.94% stmts (746 pass), +0.48 vs C123 (the C128 settings-restore + C129 auth-store arc). The C126–C129
> guard arc was the productive vein that finally moved BOTH suites off the long ~87.7 plateau. Both green (BE 1769 /
> FE 746). Branch = 130 ahead, PR-ready (bug 28 / guard 26 / feature 21 / deep-review 21 / infra 18 / arch 15).
> NEXT cadence ~C140. STANDING SIGNAL: all four self-authorizable coverage veins (FE-logic C100–C102, route-IDOR
> C108–C116, analytics-builder C119–C122, store/repo C126–C129) are CLOSED; residual sub-90% is structural
> (OAuth/network/orchestrator/DI/SQL/DOM/timer/SSR-guard); highest-leverage work GATED on Angelo.
>
> **RAN C123 (cadence; last ran C117).** Untracked-test sweep CLEAN (the C119/C120/C122 test files all tracked;
> only the intentional `M .gitignore`/`M frontend/.gitignore` overrides remain). Coverage RE-MEASURED: BE 87.78%
> line / 87.54% func (1757 pass) — line FLAT vs C117, but `analytics-charts.ts` jumped 95→99.63% line / 99.01% func
> from the C119–C122 analytics-builder sweep (the module was near the file-mean, so overall is flat; residual
> ceiling DI/SQL/OAuth-bound). Its only "uncovered" rows (275, 1025-1026) are the bun ternary-in-`new Date()`
> line-attribution artifact (C100 lesson), not real gaps — the C122 mutant proved line 275 IS exercised. FE 87.6%
> line / 88.56% func / 79.84% branch / 85.57% stmts (739 pass) — FULLY UNCHANGED vs C117 (no FE source since).
> Both green (BE 1757 / FE 739). Branch = 123 ahead, PR-ready (bug 28 / guard 22 / feature 21 / deep-review 20 /
> infra 17 / arch 14). NEXT cadence ~C133. STANDING SIGNAL: the analytics-builder coverage vein (C119–C122) now
> joins FE-logic (C100–C102) + route-IDOR (C108–C116) as a CLOSED self-authorizable frontier; highest-leverage work
> is GATED on Angelo (#148 READY / import defaultCategory / createLoadState + seedVehicle arch designs /
> #100/#79/#129).
>
> **RAN C117 (cadence; last ran C111).** Untracked-test sweep CLEAN (only the intentional `M .gitignore`/`M
> frontend/.gitignore` overrides). Coverage RE-MEASURED: BE 87.78% line / 87.53% func (1717 pass) — +0.01 line vs
> C111 (the C113–C116 cross-tenant-idor.test.ts additions are +expect assertions on ownership-gate branches mostly
> already covered — they pin SECURITY behavior, not new lines, as expected for IDOR guards); FE 87.6%/88.56%/79.74%
> UNCHANGED (C112–C116 backend/docs). Both at the ~87.8 BE / ~87.6 FE structural ceiling. Both green (BE 1717 / FE
> 739). Branch = 117 ahead, PR-ready (bug 27 / guard 21 / feature 20 / deep-review 19 / infra 16 / arch 13). NEXT
> cadence ~C127. STANDING SIGNAL: both self-authorizable coverage frontiers are CLOSED — FE-logic guard (C100–C102,
> FE +1.25) + route-IDOR audit (C108–C116, 7 gaps + BE +0.31). Highest-leverage work GATED on Angelo (#148 READY /
> import defaultCategory / createLoadState + seedVehicle arch designs / #100/#79/#129).
>
> **RAN C111 (cadence; last ran C104).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: **BE 87.77/87.53 (1717
> pass) — +0.30/+0.34 vs C104, moving UP OFF the ~87.47% ceiling** from the C108–C110 route-coverage arc
> (analytics/routes.ts 95.65→97%) — PROOF the audit found REAL untested route code; FE 87.6%/88.56%/79.74% unchanged.
> Both green, branch 111 ahead.
>
> **RAN C14 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.22%/86.96% (unchanged vs
> C7 — sync-test additions hit already-covered modules); FE 86.07% line / 87.19% func / 78.53% branch (UP
> from C12's helper tests). Both suites green (BE 1587 / FE 721). Branch 7 ahead, PR-ready. NEXT cadence
> ~C24. Coverage is plateaued at the structural ceiling — don't chase % directly.
>
> **RAN C21 (cadence).** Untracked-test sweep CLEAN. Coverage BOTH UNCHANGED vs C14 (BE 87.22/86.96, FE
> 86.07/87.19/78.53 — the C15-C20 arc was tests/dedups/eyes-on, no new covered lines). Both suites green
> (BE 1594 / FE 721). Branch 20 ahead, PR-ready.
>
> **RAN C28 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.22/86.97 (flat vs C21),
> FE 86.14/87.31/78.70 (marginally UP — C22/C23 added covered lines). Both suites green (BE 1597 / FE 726).
> Branch 28 ahead of fresh origin/main, PR-ready.
>
> **RAN C35 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.29/86.97 (line UP vs C28
> from the C29/C33/C34 analytics+insurance tests), FE 86.14/87.31/78.70 (FLAT — C29-C34 were backend +
> 1 FE-markup). Both suites green (BE 1608 / FE 726). Branch 35 ahead, PR-ready. NEXT cadence ~C45.
> Coverage plateaued at the structural ceiling — keep not chasing %; let real bug/feature work move it.
