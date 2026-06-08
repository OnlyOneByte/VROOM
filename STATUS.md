# STATUS — VROOM (live snapshot for a fresh agent session)

Read this first, then `CLAUDE.md` for the loop + conventions. Update this file at the
end of each cycle so the next session orients in one read.

_Last updated: cycle 156 — full backend green re-confirmed (tsc 0 / 773 tests / build ok); no new gap found._

## Cycles 149–156 (one-line index, since the dark-mode note below)
- **149** restore zip-bomb guard (uncompressed-size cap; defense-in-depth). **150** refreshed
  BRANCH_REVIEW digest 98→112 commits. **151** found+recorded the reminders no-create/edit-UI gap.
  **152** built the reminder create/edit form (notification-type, bits-ui Dialog; expense-type
  deferred). **153** E2E custom-frequency + edit-frequency branches. **154** mobile (393px) verify of
  the reminder dialog. **155** routing/dead-link audit (sound) + fixed a stale self-referential nav
  test. **156** grounded across trips/reminders/financing — no new feature gap (trips=greenfield stub,
  financing=mature, reminders=just built); re-ran the backend gate green (tsc 0, 773/0, build ok).
- **Branch:** `feat/offline-entries` ~**118 commits** ahead of `origin/main`, clean fast-forward, tree
  clean each cycle. Digest current as of cycle 150 (+152/155 to fold at next refresh). **The single
  highest-value action remains the human-owned merge.**


## Dark mode — reviewed cycle 148 (never audited before; verified sound)
Dark is a full second render path (`.dark` class on `<html>`, default pref `system` → resolves via
`prefers-color-scheme`; `theme.svelte.ts`). Captured with Playwright `colorScheme:'dark'` (the store
reads `matchMedia` on init). Eyes-on the 5 highest-risk surfaces — **dashboard, new-expense form,
analytics, settings (toggles/selects), insurance (status badges)** — all render correctly: borders +
placeholders + switch tracks visible, red "Expired" badges legible, charts/empty-states themed, 0
console errors. Token system (`hsl(var(--…))`; no hardcoded hex in chart-colors/formatters) holds in
dark as designed. Active-tab pill + primary buttons read as light-on-dark (intentional, consistent).
**No bug.** A dark visual-regression baseline could be added to the harness if ever wanted (the
`colorScheme:'dark'` recipe is the seam), but not built — capture-only.


## Where the work is
- **Branch:** `feat/offline-entries` (**106 commits**, off `main`; `HEAD..main` = 0, clean
  fast-forward). Human approves all merges. The cycle-89–95 staged backlog was **committed
  in cycle 112** (no more staged-but-uncommitted work — the tree is clean each cycle now).
- **Cycles 125–143 (since this file's prior body was written) — one-line index:**
  vehicle clear-field + delete/cascade orphan-photo class (125,128–131), Log Fill-up
  quick-action (127), CSV export (132) later hardened vs **CSV formula injection/CWE-1236**
  (139) + **hardcoded-USD currency** fix (140), backup→restore claims proof (133), Fuel-tab
  single empty-state (136), expense-filters unit tests (137), **cross-tenant IDOR audit +
  proof** (138), **Duplicate expense** (141), **tag suggestions from history** (143). Reviews:
  full-route eyes-on (135), Duplicate action-bar (142), money-precision verified-sound (140).
  All green, all committed; **the branch is feature-rich and merge-pending — a human merge is
  the single highest-value next step.**
- The `.meshclaw-tools/` harness and `frontend/e2e/*.meshclaw.e2e.ts` specs are **untracked
  by design** (local verification harness, not shipped). ⚠️ Do NOT `git add` a
  `*.meshclaw.e2e.ts` file — they depend on the untracked harness; a tracked one is dead
  weight at merge. (Cycle 124 caught + amended one such slip.)

## Latest cycle (124) — closed a real data-loss bug class across insurance
A deep-review cycle (last 3 were feature work). Found and fixed the **clear-optional-field
silent-data-loss class**: an edit form empties an optional field → sends `undefined` →
`JSON.stringify` drops the key → the repo's `if (x !== undefined)` patch guard skips it →
the column keeps its OLD value. The user literally cannot clear the field. Fixed in all
three insurance update paths, each with a failing-first test:
- **Claims** (recent work): payout / description / fault — commit e6e77fc (+ E2E
  `insurance-claims` clear-payout, proven to fail without the fix).
- **Terms** (pre-existing): deductible / coverageLimit / agent* / policyNumber / costs etc.
  — commit cc633be (+ HTTP `terms-http` + E2E `term-clear-field`, both proven guards;
  verified the totalCost→expense-sync coupling stays correct when cleared).
- **Policy notes** (pre-existing) — commit cb90a4a (+ HTTP test).
- The mechanism: schema `.optional()` → `.nullish()` (null clears, omit = unchanged);
  repo input type widened to `| null` (the existing `!== undefined` guard passes null
  through); form sends `null` on EDIT (still omits on CREATE — nothing to clear).
- Swept the rest: **financing has no general update** (targeted PATCH only) → unaffected;
  class is closed across insurance. BE 731 pass / 0 fail; svelte-check 0; regress 38/38.

## How to verify (one command)
```bash
# Self-healing: kills orphaned dev servers, frees ports, boots fresh, waits for both,
# resets the DB to a clean seed, runs the full authenticated E2E suite + screenshots.
RESET_DB=1 START_SERVERS=1 .meshclaw-tools/regress.sh        # 38/38 green, deterministic
cd backend && mise exec -- bun test                          # 731 pass / 0 fail / 1 skip
cd frontend && mise exec -- npm run type-check               # 0 errors (7 benign warnings)
```
If a change "didn't take effect", a stale orphaned `bun --hot` backend was serving the old
code — `START_SERVERS=1` now handles that automatically.

## Done (ranked TODO + follow-ups)
All original ranked items through **offline entries** are complete. Recent cycles added:
server-side expense search, batch photo endpoint (killed dashboard N+1), financing-balance
batch query (killed vehicles N+1), bounded insurance expiring-soon, editable profile +
Data&Privacy export, reminders `/reminders` UI, and the offline-entries foundation
(client_id idempotency + migration 0001 + outbox sync rewrite).

## Test coverage
- **E2E interaction specs** (the high-value layer — caught a debounce self-cancel bug and a
  reminders PUT-400 bug that type-check + smoke both missed): route-smoke (16 routes),
  auth-bypass, offline-entries, expense-search, expense-create, expense-pagination,
  reminders-lifecycle, profile-edit, settings-persist.
- **Backend:** 625+ tests (repo property tests + schema-contract tests). New pattern:
  route-boundary query/validation contract tests (`query-schema.test.ts`,
  `update-validation.test.ts`) catch the param-coercion bug class repo tests can't.

## Open gaps / next candidates
- **Cycle 25 — refreshed the stale merge digest (the one artifact the human merges from).**
  `BRANCH_REVIEW.md` was written at cycle 9 (48 commits/+7,589) and understated the branch;
  updated to real `git diff main..HEAD` = **67 commits, 104 files, +8,252 / −1,259**, current
  test counts (713 BE / 32 E2E), and a new **§8 "Added since the initial digest"** itemizing the
  cycle-13→24 fixes (Member Since, dashboard/expenses error states, sync-worker DI, Sec-Fetch-Site
  harness fix + trigger tests, 4 new guard specs) so the reviewer merges informed, not blind.
  Commit 9727450. The digest is now accurate as of HEAD.
- **Cycle 24 — identified the nudge driver + grounded the self-halt failure (operational,
  no code change).** Stopped hand-waving about "the loop" and checked: `meshclaw cron list`
  = 3 jobs, all PAUSED, none is the nudge; the "auto-nudge cycle N" string is in no workspace
  file → it's injected by the **gateway's AutoNudgeService at runtime**. `autonudge_stop` from
  this session returns **"Failed to look up loop: HTTP 403 Forbidden"** — the service has no
  loop registered to THIS session, so the agent has no authority to deregister it. (A too-long
  `reason` separately trips a 500-char validation error — that's NOT the 403; earlier cycles
  conflated the two.) **So the agent structurally CANNOT self-halt:** the `STOP` sentinel is
  read by the separate autopilot LOOP (not AutoNudgeService), and `autonudge_stop` can't reach
  a loop it doesn't own. **Only a human can stop it** — gateway dashboard 🔁 "Stop loop", or
  the gateway-side AutoNudgeService (NOT `meshclaw cron`). This corrects ~7 cycles of imprecise
  "it 403s / halt via cron" notes. **Backlog is exhausted (last item #278 closed cycle 23);
  the branch is DoD-complete and proven green — the only remaining action is a human merge.**
- **Cycle 21 — grounded the "nothing tractable solo" claim in the FULL TODO (not memory).**
  Re-read every TODO section: ranked #1–8 done; #9 Sharing + #11–16 greenfield/design-blocked;
  logo assets / ZIP-photo functionality / backup versioning need human assets; analytics nit
  (c) (one unified Fuel-tab empty state vs ~10 cards) is a product/design call. The one
  plausibly-tractable item was AI-testing-gap line 278 **"POST /reminders/trigger" HTTP test**
  (only reminders endpoint `reminders-http.test.ts` doesn't cover). ATTEMPTED + REVERTED:
  every trigger call (even authed) returns **403 in the in-process harness**. Likely the
  `csrf()` middleware rejecting a state-changing request whose Origin it can't verify — BUT
  adding `Origin: http://localhost:3000` (the NODE_ENV=test allowed origin) did NOT fix it,
  and the existing JSON-body POSTs (`/vehicles`, `/reminders`) pass WITHOUT an Origin, so that
  theory is incomplete. Stopped at 3 attempts (no rabbit-holing). **The endpoint is already
  covered by the `reminders-lifecycle` E2E (real browser, real Origin), so HTTP-level coverage
  is marginal** — reverted the test + an unverified harness Origin tweak to keep the tree clean.
  If ever pursued: figure out why a body-less authed POST 403s through `app.request()` (csrf
  Origin/secFetch headers? — note the JSON-body asymmetry) before re-adding. Backend still 711
  pass at HEAD.
  **[Cycle 22 — ROOT-CAUSED, production proven safe, no code change.]** Read Hono's actual
  `csrf()` source: it 403s a non-GET request only when ALL hold — (a) content-type is
  form-like, and a **missing** content-type defaults to `text/plain` which qualifies; (b)
  `Sec-Fetch-Site` absent/disallowed; (c) `Origin` absent/disallowed. So JSON-body POSTs
  (`application/json`) are exempt (that's the asymmetry); a body-less POST via `app.request()`
  has none of the three → 403. Cycle-21's fix used `Origin: http://localhost:3000` but the
  test-env allowlist actually resolves to **`["http://localhost:5173","http://localhost:4173"]`**
  → no match. **Production is safe:** `sw.js` does NOT replay POSTs (offline sync is foreground
  via the normal `apiClient`), and real browsers always send `Sec-Fetch-Site: same-origin` +
  `Origin` on same-origin requests, so csrf never blocks real traffic — the 403 is purely an
  `app.request()` limitation. **2-min fix if HTTP coverage of body-less state-changing routes
  is ever wanted:** add `headers['Sec-Fetch-Site'] = 'same-origin'` in `http-client.ts`
  `buildReq` (origin-independent; mirrors a real browser). Not done now — deliberately avoiding
  re-touching the harness I reverted last cycle.
  **[Cycle 23 — DONE.] Applied that fix** (`buildReq` now sends `Sec-Fetch-Site: same-origin`)
  and re-added the 3 `POST /reminders/trigger` HTTP tests. Full backend suite **713 pass / 0
  fail** — the harness change caused ZERO regressions (JSON-body POSTs were already csrf-exempt;
  the header only adds fidelity). TODO #278 now fully closed (all 3 endpoints HTTP-covered).
  Commit 30f46e6.
- **Cycle 20 — keyboard/focus a11y (the last never-reviewed UI dimension) → verified sound,
  guarded.** axe covers contrast/names, not keyboard (WCAG 2.1.1/2.1.2/2.4.3). Read-audit:
  all modals use bits-ui (Dialog/Sheet/AlertDialog handle focus-trap + Escape + focus-return);
  `MediaCaptureDialog` uses bits-ui `Dialog`; the one custom overlay `PWAInstallPrompt` is
  correctly NON-modal (fixed bottom banner) with an aria-labeled dismiss. Then PROVED it in a
  real browser: `e2e/keyboard-a11y.meshclaw.e2e.ts` drives the Vehicle Type bits-ui Select
  fully by keyboard — opens on Enter, **Escape closes + returns focus to the trigger** (no
  keyboard trap), arrow+Enter commits a selection with focus intact. PASSED (full regress
  32/32 green). No bug; dimension permanently guarded. Spec untracked by design. **With this,
  the four-states + mobile + a11y-static + a11y-keyboard + error-state dimensions are all now
  either fixed or proven sound across the app.**
- **Cycle 19 — SETTLED the dashboard mobile-donut question (open since cycle 14) → proven
  harness-blindness, NO bug.** Wrote `e2e/dashboard-donut-mobile.meshclaw.e2e.ts`: at 393px,
  scroll the "Expense by Category" card into view, assert the chart `[data-slot=chart] svg`
  + arc `path`s actually mount. **PASSED** (full regress 31/31 green). So real mobile users
  who scroll DO see the donut; the blank-on-tall-screenshot was the full-page-capture-doesn't-
  fire-IntersectionObserver artifact (3rd time this pattern resolved to harness, now with a
  permanent guard so no future cycle re-investigates by reasoning). Spec untracked by design.
  **Reusable lesson: to tell harness-blindness from a real chart bug, scroll the element into
  view in a real browser and assert the SVG/paths — don't trust (or fix) a full-page shot.**
- **Cycle 18 — triaged the standing svelte-check "7 warnings / 5 files" line → CONFIRMED
  BENIGN, no action.** All 7 are Svelte-5 "reference only captures the initial value of X"
  warnings. 4 are in app forms (`ExpenseForm` isLoading←expenseId, `FuelFieldsSection`
  energyMode←trackFuel/fuelType, `InsuranceTermForm` termId, `VehicleForm` vehicleId) — all
  benign one-time `$state(...)` seeds in route-keyed forms (the genuinely-reactive reads use
  `$derived` correctly; the prop can't change without a remount). 3 are in **vendored
  shadcn `ui/carousel/carousel.svelte`** — don't hand-edit (upstream's, churns on update).
  Considered an `untrack()` cleanup to zero-out the noise (so a future REAL reactivity
  warning stands out) but couldn't verify it clears them here (warning-level svelte-check
  isn't runnable in this env; `npm run type-check` is `--threshold error`), so reverted the
  speculative edit rather than churn 4 working files unverified. **Not a bug; future cycles
  can skip re-investigating.** (If ever worth doing: `untrack(() => …)` is the in-repo idiom,
  already used in `MediaCaptureDialog.svelte`.) Keyboard/focus a11y remains genuinely
  unreviewed (axe checks contrast/names, not tab order / focus traps) — still a candidate.
- **Cycle 17 — paid down verification debt: branch is now PROVEN green end-to-end.** Cycles
  13–16 each verified only at type-check/build level (servers were down), so the two
  error-state E2E specs (dashboard-error, expenses-error) had never actually run. Ran the full
  `RESET_DB=1 START_SERVERS=1 .meshclaw-tools/regress.sh`: first pass = **28 passed, 2 failed** —
  but the 2 failures were the new specs' OWN loose `getByText` selectors (strict-mode violation:
  matched both the error-card `<p>` AND the Sonner toast), which actually *confirmed* both app
  fixes render. Scoped the assertions to `p.font-medium` + the Retry button; re-ran → **30/30
  green, exit 0**. Backend **711 pass**. So dashboard + expenses error states are now proven
  (error card + toast both show, Retry recovers). Lesson reinforced (again): `getByText` matches
  substrings across the toast layer — scope to the element. **Takeaway for future cycles: run
  regress.sh in the SAME cycle as a UI change, don't defer it.**
- **Cycle 16 — closed the error-state gap (and corrected cycle-15's over-claim).** Audited
  all list/load routes: **insurance + analytics already had** error+retry; dashboard was
  fixed cycle-15. The ONLY real remaining offender was **expenses** — and it was a genuine
  bug, not cosmetic: its `onMount` awaited `settingsStore.load()` + `getVehicles()` +
  `fetchPageAndSummary()` with NO try/catch, so any failure left `isLoading` stuck `true` →
  **permanent skeleton forever**; page-fetch errors only `console.error`'d in DEV. Fixed:
  `loadInitial()` (try/catch/finally + `loadError`) + `{:else if loadError}` Retry branch
  mirroring insurance; `fetchPageAndSummary` re-throws during initial load, toasts after
  (commit 530de15). Vehicle-detail page checked = acceptable (per-loader catch + redirect to
  dashboard on critical fail). Authored `e2e/expenses-error.meshclaw.e2e.ts` — UNRUN this
  cycle (servers down), runs in next regress.sh. **Error-state dimension is now consistent
  across dashboard/analytics/insurance/expenses.** No reusable `<LoadError>` extracted yet —
  4 routes now share the same ~8-line inline idiom; extract only if a 5th appears (rule of 3
  already passed, but the routes differ enough — header placement, wrapper — that a premature
  abstraction would fight them). Low priority.
- **Cycle 15 Four-States review — ERROR dimension (the one screenshots can't show).**
  Found the dashboard's load-failure path only fired a 5s toast then silently rendered the
  EMPTY "add your first vehicle" view → a returning user whose fetch failed would think
  their data vanished. FIXED by composing analytics's existing error+retry idiom onto the
  dashboard (persistent `loadError` card + Retry, honest header). type-check 0 + build pass;
  commit b4f1ae1. Authored `e2e/dashboard-error.meshclaw.e2e.ts` (route-intercept 500) —
  UNRUN this cycle (servers down), runs in next regress.sh. **BROADER GAP (not yet fixed):**
  expenses / vehicles / insurance routes share the same toast-only-then-empty pattern — only
  analytics + (now) dashboard show a persistent error+retry. Good candidate for a follow-up:
  either extract a small reusable `<LoadError onRetry>` and apply to the other 3 routes, or
  leave per-route. No reusable error-state component exists yet (there is `common/empty-state`
  + `ui/empty/*`, but nothing for errors).
- **Cycle 14 deep UI review (eyes-on every route screenshot, mobile+desktop).** Reviewed
  dashboard, analytics, expenses, settings, vehicles-new, reminders, trips, insurance,
  profile at both viewports. Almost all healthy (empty-states, badges, layouts correct;
  insurance "Expired" badges verified correct vs today's date; analytics radar→bar + day-of-
  week/seasonal empty-states all holding). Found + FIXED one REAL data bug: profile **"Member
  Since" rendered "—"** because `createdAt` was dropped in `/me` serialization (commit a3f3c4f).
  Deliberately did NOT "fix" the dashboard category donut blanking on the tall MOBILE
  screenshot — that's the documented harness-blindness pattern (Playwright capture doesn't
  fire the IntersectionObserver gate below the fold; real users scrolling do; desktop renders
  it fine). **[Cycle 19: this is now PROVEN, not just reasoned — see below.]** Minor cosmetic
  noted, not actioned: settings provider name truncates to "e…" for the seeded fake provider
  (real CSS truncation, low value).
0. ~~HTTP-harness cross-file isolation flake (found cycle 12)~~ — **FIXED (cycle 13).** The
   500s were NOT a `:memory:` singleton problem — they were a `mock.module` leak after all,
   from a non-photos file: `sync-worker.test.ts` did
   `mock.module('../../photos/photo-repository', …)` (+ `photo-ref-repository` + the storage
   `registry`). Bun's `mock.module` is process-global and CANNOT be restored (`mock.restore()`
   only undoes `mock()` spies), so every file running after it saw a stubbed `photoRepository`
   missing `findByUser` → the real photos route 500'd. Same leak class cycle 21 fixed for the
   Google tests; this file was missed. Fix: gave `sync-worker.ts` an optional `deps` arg
   (`SyncWorkerDeps`, real default singletons) and rewrote the test to inject fakes — zero
   `mock.module`. Re-added `photos-http.test.ts`; it now passes IN THE FULL SUITE (708 pass,
   deterministic x2). Lesson reinforced: `grep "mock.module("` is the first check for any
   "passes alone, fails in suite" flake.
1. ~~Full in-process backend HTTP harness~~ — **DONE.** `src/app.ts` is now a
   side-effect-free Hono app (split out of `index.ts`), and `src/test-helpers/http-client.ts`
   (`createTestApp()`) drives it via `app.request()` over a `:memory:` DB with a real Lucia
   session. Pattern: set env → dynamic-import DB-bound modules → migrate-once + reset-data →
   seed user + mint cookie → `authed/anon` request helpers. Example suites:
   `reminders-http.test.ts` (the PUT-400 class), `expenses-http.test.ts` (search/pagination/
   user-scoping). Write new route tests against this harness, NOT raw repos.
2. **Storage-backup-toggle E2E** — needs a real OAuth (Google Drive) storage provider,
   which can't be provisioned headlessly. Settings-persist covers the save→reload path via
   the provider-free Unit Preferences card instead. (The fake-provider seam below now makes
   a backup E2E possible without OAuth — seed a `providerType:'fake'` row.) The Drive+Sheets
   **backup logic** itself is now covered at the unit level via injected fakes — see the
   External-provider-testing section + `.kiro/steering/TestingExternalAPIs.md`.
3. **Pre-existing type-debt in HTTP-harness tests** — `res.json()` returns `unknown`, so
   `expenses-http.test.ts` / `reminders-http.test.ts` / `http-client.smoke.test.ts` and the
   `app.request()` return type in `http-client.ts` throw ~24 `tsc` errors. Tests RUN fine
   (Bun strips types); this is type-check-only debt. Fix: a typed `json<T>(res)` helper in
   the harness + tighten `app.request`'s return type. (Predates the Google-mocking work.)

## Independent UI development (kit + self-driving loop)
The higher-level layer that makes UI work independent (not just verifiable):
- **`.kiro/steering/DesignSystem.md`** — the "compose, don't invent" source of truth: design
  tokens (light+dark), spacing/typography scale, and a grounded component inventory with real
  import paths (ui/* primitives, common/* patterns, charts/* 4-state wrappers).
- **`/dev/gallery`** (dev-only route) — the LIVE kit: every component in its key states + the
  Four States side-by-side + ChartCard's 4 states. One screenshot target that exercises every
  state at the component level (covered by route-smoke, a11yClean-enforced). Building it caught
  a real app-wide token bug (`--destructive` < AA as text in 76 sites — now fixed).
- **`.meshclaw-tools/ui-autoloop.md`** — autonomous build→critique→fix loop: shoot mobile+desktop
  → critic subagent scores vs UIQuality+DesignSystem → verify findings against objective gates →
  apply → re-shoot, cap 3 rounds. Critics over-flag, so findings are verified against axe/overflow
  gates before applying (proof run: a StatCardGrid "overflow" finding was a false positive — the
  grid is responsive — correctly rejected). The human reviews the result, not each iteration.

## UI quality system ("human-ready, not junk")
A passing build only proves a page renders. To stop shipping UI junk:
- **`.kiro/steering/UIQuality.md`** — the rubric every UI feature must clear: Four-States
  (loading/empty/error/populated), mobile-first (it's a PWA), a11y, consistency/reuse,
  + a "human-ready" pre-merge checklist.
- **axe a11y scan** in route-smoke — REPORT mode by default (warns per route), `A11Y=strict`
  to enforce. App has pre-existing debt (color-contrast, nested-interactive) — see task to
  pay it down then ratchet to strict.
- **Mobile pass** in route-smoke — every route re-rendered at 393px, `<slug>-mobile.png`
  captured, horizontal-overflow asserted (currently clean on all routes).
- **UI critic pass** — `.meshclaw-tools/ui-critic.md`: a repeatable design review of the
  mobile+desktop shots against the rubric. First run already found 2 real dashboard issues
  (blank chart cards with no empty state; FAB overlapping fleet card on mobile) — logged there.

## Built infra (was a gap, now done)
- **Visual regression** — `VISUAL=1 .meshclaw-tools/regress.sh` compares each route against a
  committed baseline (`toHaveScreenshot`, `maxDiffPixelRatio 0.02`). OFF by default (full-page
  pixel diffing is noisy); create/refresh baselines with `UPDATE_SNAPSHOTS=1 VISUAL=1 …`.
  Baselines live in `frontend/e2e/route-smoke.meshclaw.e2e.ts-snapshots/` (untracked, host-specific).
- **Fake storage-provider seam** — `FakeStorageProvider` (in-memory, implements the real
  `StorageProvider` interface) is wired into the registry factory under `providerType:'fake'`,
  double-gated by `CONFIG.allowFakeStorageProvider` (`ALLOW_FAKE_STORAGE=1` AND env≠production).
  This is the reusable pattern for testing EVERY external provider (Google Photos, VLM, LLM)
  with zero network — see below.

## External provider testing (Google Drive/Sheets — DONE; pattern for the rest)
The ranked TODO's later items (Google Photos storage, VLM receipt parsing, LLM assistant)
all call **third-party APIs** that must NOT be hit in tests. The standard is now built and
documented in **`.kiro/steering/TestingExternalAPIs.md`** — read it before touching any
provider/service/strategy. Two complementary seams:

1. **Photo storage** goes through `storageProviderRegistry` + the `StorageProvider`
   interface → select the in-memory `FakeStorageProvider` via a `providerType: 'fake'` row
   (double-gated by `CONFIG.allowFakeStorageProvider`). Assert the app's behavior (photo
   appears), never the vendor. This is the seam Google Photos reuses.
2. **Drive + Sheets backup** now has a deeper seam: `GoogleDriveService` /
   `GoogleSheetsService` / `GoogleDriveProvider` / `GoogleDriveStrategy` all take an
   **optional injected client/collaborator** (real default, fake in tests). Tests drive the
   REAL service logic (folder dedup, path walk, sheet clear+write, read round-trip, +401/
   403/429 fault injection) against `src/test-helpers/fake-google-clients.ts` (in-memory
   Drive+Sheets over one shared store) — ZERO network. 24 new tests; full suite 668 pass.

**Why injection, not `mock.module`:** Bun's `mock.module` is process-global (concurrency=1),
so a stub in one file clobbers the real class in others — it caused 23 phantom failures here
and meant the old provider/strategy tests only exercised a re-implementation. Those two
suites were converted to injection; the leak is gone. **Do not `mock.module` a VROOM module
you also test for real elsewhere.**

Keep one optional, explicitly-gated live smoke (`LIVE_GDRIVE=1`/`LIVE_GPHOTOS=1`) for manual
real-API verification — never in the default `bun test` / `regress.sh` run. Fixtures use
canned fake tokens only (ARCC: never log/store real refresh_tokens; test rotation).

## History note: the cycle-89–95 staged backlog is COMMITTED (cycle 112)
Earlier STATUS revisions warned about "12 files staged-but-uncommitted" (reminders/settings
error states, the EUR/GBP currency-markup class, chart-formatter USD fix, + formatter tests).
The permission engine declined the inline commit each cycle until **cycle 112**, when the
human explicitly authorized committing via a script (`/tmp/vroom-commitN.sh`). That entire
backlog is now in history (commit 1ca9f02 and the claims/feature commits after it). **There
is no staged-but-uncommitted work anymore** — the tree is clean at the end of each cycle.
