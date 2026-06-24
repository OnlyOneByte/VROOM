# Theming Engine — Tasks

> **UNBLOCKED: Angelo signed off D1–D7 (all ✅ recommended) 2026-06-24 — build is GO.** Backend-first
> per CLAUDE.md. Each task is one verified loop increment; verify before ticking. The whole feature is
> **additive** — `default` reproduces today's look byte-for-byte, so until a user picks another theme
> nothing changes. Design `[depends on Dx]` sections reflect the ratified ✅ option for each decision.
> v1 theme set (D1/D5): **`default` + `instrument` first, `garage` as the immediate fast-follow.**

## Phase 0 — sign-off (gates everything)
- [x] **T0 (2026-06-24)** Angelo ratified D1–D7 at the ✅ recommended option for each: D1 engine +
      ONE theme first; D2 persist in `userPreferences` (+ localStorage mirror); D3 theme × mode
      orthogonal; D4 a11y HARD gate per theme; D5 set = `default` + `instrument` (first), `garage`
      (fast-follow); D6 custom-theme seam only (authoring deferred); D7 token-only v1 (no textures).
      Build T1+.

## Phase 1 — backend persistence (additive, backward-compatible)
- [x] **T1 (C174)** `userPreferences.themePreference` column. Added `theme_preference text NOT NULL
      DEFAULT 'default'` to `backend/src/db/schema.ts` `userPreferences`; generated the Drizzle migration
      via `db:generate` → `0006_mixed_zarek.sql` (`ALTER TABLE user_preferences ADD theme_preference text
      DEFAULT 'default' NOT NULL`) + snapshot + journal. Verified: applies on a fresh `db:init` (column =
      TEXT NOT NULL dflt `'default'`); an existing pre-0006 prefs row backfills `'default'`
      (migration-0006.test.ts, +4). Also added `themePreference` to `SHEET_HEADERS.userPreferences` (keeps
      the sheets-header-coverage drift guard green — the column would otherwise be silently dropped on a
      Sheets backup; the full backup round-trip + its own guard remains T3). Backend validate:local GREEN
      (1803 pass). **[D2]**
- [x] **T2 (C179)** Settings route field. Added an EXPLICIT bounded `themePreference:
      z.string().min(1).max(64).optional()` to `updateSettingsSchema.extend()` — createInsertSchema had
      auto-derived it as an UNBOUNDED string from the plain-text column (verified firsthand: a 5000-char
      id persisted pre-fix). Routed through the EXISTING row-level merge (`...restUpdates` →
      `repository.update`, which sets only provided fields — the #82 per-field discipline; verified theme
      survives a sibling PUT and vice-versa). GET returns it. +HTTP tests (theme-preference.test.ts, +7):
      fresh user defaults to `'default'`, PUT persists + GET round-trips, per-field merge both directions,
      >64 + empty rejected (400, stored value unchanged), omitted is a no-op. Non-vacuity proven (drop the
      bound → length+empty RED). `bun run validate:local` GREEN (1817 pass).
- [x] **T3 (C180)** Backup round-trip. `themePreference` was already in `SHEET_HEADERS` (added T1/C174)
      and rides the schema-derived CSV column set automatically; T3 CERTIFIED the round-trip firsthand and
      left the guard. +theme-preference-roundtrip.test.ts (+3): a non-default theme id survives the TRUE
      `exportAsZip → restoreFromBackup('replace')` stack (CSV serialize → coerceRow → FK-ordered insert),
      the default round-trips as `'default'` (control), and a paired sibling pref (currencyUnit) survives
      alongside it (no field dropped). Inherits the C175 coerceRow NOT-NULL-default safety (an empty cell
      → `'default'`, never a restore-aborting null). Non-vacuity proven (drop themePreference on coerce →
      the two non-default tests RED). `bun run validate:local` GREEN (1820 pass).

## Phase 2 — theme model + registry + resolver (frontend, pure, no UI)
- [x] **T4 (C181)** `frontend/src/lib/theme/theme-types.ts` — `ThemeId`, `ThemeMode` (re-exported from
      the existing store's `ThemePreference` = the single source of truth, not redeclared), `ThemeTokenKey`
      (the EXACT 32-key per-variant color set `app.css` declares — censused firsthand: `:root` and `.dark`
      declare an identical 32-key set; `--radius` is `:root`-only/variant-invariant → excluded),
      `ThemeTokens` (full Record), `ThemeVariant` (light+dark), `ThemeSource`, `ThemeDefinition`
      (id/label/description/swatch/light/dark/source). + a frozen `THEME_TOKEN_KEYS` const tuple
      (`satisfies readonly ThemeTokenKey[]`). Types only, no values/registry/runtime. GUARD:
      theme-token-keys.test.ts (+5) source-scans app.css `:root`/`.dark` and pins light/dark parity +
      `THEME_TOKEN_KEYS` == the live set exactly + `--radius` excluded (the merge-surviving net so a token
      add/remove can't silently desync the engine). FE validate:local GREEN (svelte-check 0, 765 pass).
- [~] **T5 (C185, default DONE; `instrument` DESIGN-GATED)** `theme-registry.ts` — `THEME_REGISTRY` +
      `DEFAULT_THEME_ID`. `default`'s light+dark token maps transcribed VERBATIM from `app.css` `:root`/`.dark`
      (all 32 keys × 2 variants). +registry-integrity guard (theme-registry.test.ts, +6): `default` ≡ app.css
      VALUE-FOR-VALUE (parses live app.css → zero visual change + baseline-drift detection), every definition
      declares ALL token keys in BOTH variants (no missing-key leak) + NO stray keys. FE validate:local GREEN
      (svelte-check 0, 771 pass). **REMAINING (design-gated, NOT loop-self-authorizable): the first non-default
      theme `instrument`** — its 32-token oklch palette must be distilled from the design-language mock +
      AA-tuned (A3/R10/D4), which is a product/design decision (the mock dir is a gitignored working file, absent
      from the tree). The registry + guard accept it with zero structural change (add one ThemeDefinition).
      Flagged to Angelo: supply the `instrument` palette (or greenlight deriving it from the mock).
- [x] **T6 (C187)** `resolve-theme.ts` — `resolveTheme(themeId, mode, systemPref)` total resolver +
      `resolveThemeDefinition` (id→def, default fallback R8, Object.hasOwn so prototype keys don't false-hit)
      + `resolveVariant` (mode→light/dark; `system`→systemPref, garbage→light). Pure, never throws. +unit
      tests (resolve-theme.test.ts, +12): every built-in × {light,dark}; `system` follows OS pref; explicit
      mode ignores pref; unknown id→default; empty/null/garbage ids+modes never throw + yield a COMPLETE
      token map; the prototype-pollution case (`constructor`/`toString`→default). FE validate:local GREEN
      (svelte-check 0, 785 pass).
- [x] **T7 (C189)** `themes.css` generation + load seam. `themes-css.ts` — a PURE generator
      (`generateThemesCss`/`themeBlocks`/`nonDefaultThemeIds`) emitting one `:root[data-theme="<id>"]`
      (light) + `:root[data-theme="<id>"].dark` (dark) block per NON-default registry theme (`default` is
      excluded — app.css owns its bare `:root`/`.dark`; generating it would duplicate + risk drift, and the
      C185 guard already pins default≡app.css). Checked-in `themes.css` generated from THEME_REGISTRY
      (placeholder today — only `default` registered) + imported in `+layout.svelte` right after app.css so
      a non-default theme paints with zero FOUC, zero JS token duplication. +guard (themes-css.test.ts, +7):
      generator emits both selectors with ALL tokens (synthetic theme), excludes default, AND the committed
      themes.css == generateThemesCss(THEME_REGISTRY) byte-for-byte (adding a theme without regenerating
      trips it). EYES-ON: booted + shot /dashboard → renders byte-identical to default (the zero-rule import
      is a clean no-op), regress.sh GREEN (91 pass). FE validate:local GREEN (svelte-check 0, 792 pass).
      NOTE: the `data-theme` head-script set (FOUC for the id axis) is T8's store wiring — T7 is the css
      seam; with only `default` today there's no non-default block to flash.

## Phase 3 — store generalization + wiring
- [~] **T8 (C191, core DONE; theme-color-token sub-part flagged)** Extended `theme.svelte.ts` with the
      `themeId` axis alongside the mode: `vroom-theme-id` mirror, `themeId` getter, `setTheme(id)`, and
      `applyTheme(preference, themeId)` now sets `<html>` `data-theme` (a non-default id → the attribute
      driving themes.css; `default` → attribute REMOVED so app.css's bare :root serves the identity) +
      the `.dark` class. `initialize()` applies BOTH axes; `setPreference`/`setTheme` each preserve the
      OTHER axis (orthogonal, D3); the matchMedia system listener preserves the active id. Existing
      `setPreference`/`current`/`initialize` API + consumers (ThemeCard, +layout) untouched. +unit tests
      (theme-id-axis.test.ts, +6): setTheme persists+sets data-theme, default removes it, mode↔id
      orthogonality both directions, unknown id degrades (R8). FE validate:local GREEN (svelte-check 0, 802
      pass). **REMAINING (flagged to Angelo, NOT loop-self-authorized): the theme-color meta still uses the
      hard-coded brand hex by mode** — migrating it to the RESOLVED theme's brand token is a VISIBLE
      browser-chrome change (the PWA status-bar tint; uncapturable by shot.sh + an oklch-in-`<meta>` compat
      question), so it's a design sub-part deferred until a non-default theme ships. Also deferred: the
      app.html head-script `data-theme` set (the id-axis anti-FOUC leg) — moot until a non-default theme exists.
- [ ] **T9** Server sync + hydrate reconcile. `setTheme` pushes `themePreference` to the settings PUT
      (fail-soft — a network error keeps the local mirror, never blanks the theme). On
      `settingsStore.load()` (root layout, cycle-203), if `settings.themePreference` differs from the
      mirror, server wins (cross-device correctness) + update the mirror. +tests for the reconcile
      precedence. **[D2]**

## Phase 4 — picker UI (eyes-on)
- [ ] **T10** `/settings` ThemeSection — a responsive grid of theme cards (compose `Card`+`Badge`+ring
      from the kit per `DesignSystem.md`; NO bespoke controls): label, description, swatch strip,
      selected-state ring; click → `themeStore.setTheme(id)` → instant live re-skin. Surface the
      `light|dark|system` segmented control alongside. Four-states (static registry → empty-safe),
      mobile-first, axe-clean. **Eyes-on:** shot the picker; switch theme → whole-page re-skin captured.
- [ ] **T11** Per-theme eyes-on. Screenshot the **dashboard** rendered in EACH shipped theme ×
      {light, dark} (the `shot.mjs` + a `?theme=` dev override or the picker). Confirm: full re-skin,
      readable, four-states intact, no mobile overflow. (NORTH_STAR #3 — a UI capability isn't done
      until the real FE→BE→DB→render round trip is eyes-on.)

## Phase 5 — a11y gate (the hard R10/D4 gate) + E2E
- [ ] **T12** Theme a11y gate. Extend `/dev/gallery` (a theme switcher / `?theme=` override) +
      route-smoke so the axe color-contrast scan runs for EVERY shipped theme in BOTH light and dark.
      **ENFORCE** (not warn-only) for shipped themes — a theme that can't clear AA doesn't ship (the
      `--destructive` 3.9:1 precedent, cycle-19/20). Tune token values until clean.
- [ ] **T13** Round-trip E2E. A `theme.meshclaw.e2e.ts`: open `/settings`, switch to a non-default
      theme, assert a `:root` token actually changed + no reload; reload → theme persisted (mirror);
      (optionally) assert the settings PUT carried `themePreference`. Self-cleaning (reset to
      `default` in `finally`). `regress.sh` green.

## Phase 6 — DONE criteria
- [ ] **T14** Feature DoD: backend `bun run validate:local` + frontend `validate:local` green;
      `regress.sh` green; each shipped theme eyes-on (T11) + axe-clean (T12); backup round-trip guarded
      (T3); `default` proven byte-identical to today (T5 guard); spec ticked. Branch committed for
      Angelo to PR/merge. **Custom-theme authoring (R9/D6) is explicitly OUT — it's its own future spec
      (`.kiro/specs/theme-authoring/`).**

## Notes / guard-rails carried from the codebase
- **Additive contract:** `default` MUST reproduce today's look exactly (T5 guard). No component markup
  or Tailwind class changes anywhere — the engine only swaps token *values* (R1, inviolable).
- **#82 merge discipline:** the settings PUT must NEVER wholesale-overwrite `userPreferences` — partial
  per-field merge only (T2).
- **No-FOUC:** the `data-theme`/`themes.css` head seam (T7) is what prevents a default-theme flash on
  every load — don't defer it to "after the picker."
- **A11y is a hard gate (D4 = strict):** no theme ships that fails AA in either variant (T12).
- **Persistence split [D2]:** theme *id* syncs via `userPreferences`; light/dark *mode* stays
  device-local localStorage by current convention — flag at T0 if Angelo wants mode synced too.
