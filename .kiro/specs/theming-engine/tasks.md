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
- [ ] **T3** Backup round-trip. Add `themePreference` to `SHEET_HEADERS` (Google Sheets path) +
      extend the backup round-trip coverage guard so a restore re-applies the user's theme id (the
      cycle-3/C15 contract; inherits the C300/#93 merge-restore prefs-collision handling). +guard test
      proving the field survives export→import. `bun run validate:local` green.

## Phase 2 — theme model + registry + resolver (frontend, pure, no UI)
- [ ] **T4** `frontend/src/lib/theme/theme-types.ts` — `ThemeId`, `ThemeMode`, `ThemeTokenKey` (the
      EXACT set of custom properties `app.css` declares), `ThemeTokens`, `ThemeVariant`,
      `ThemeDefinition` (id/label/description/swatch/light/dark/source). No values yet; types only.
- [ ] **T5** `theme-registry.ts` — `THEME_REGISTRY`. `default`'s light+dark token maps **extracted
      verbatim from the current `app.css`** (a guard test asserts they equal the live `:root`/`.dark`
      values → zero visual change for existing users + catches baseline drift). Add the FIRST
      non-default theme per **[D1/D5]** (recommend `instrument`), token set distilled from
      `vroom-redesign-mocks/design-language.css`, re-expressed in `oklch` **[A2]** and pre-tuned for AA
      **[A3/R10]**. +registry-integrity tests: every definition declares ALL token keys (no missing-key
      leak); `default` ≡ app.css.
- [ ] **T6** `resolveTheme(themeId, mode, systemPref)` — total resolver: definition lookup with
      `default` fallback on unknown id (**R8**); pick light/dark by `mode==='system'?systemPref:mode`;
      return the token map. Pure. +unit tests: every built-in × {light,dark,system×sysPref}, unknown →
      default, empty/garbage → default, never throws.
- [ ] **T7** `themes.css` generation + anti-FOUC seam **[A1 = option (b)]**. Emit one
      `:root[data-theme="<id>"]` / `:root[data-theme="<id>"].dark` block per registry theme (a small
      build/codegen step or a checked-in generated file with a guard test that it ⊇ the registry ids).
      Load it in `<head>`. This is what makes a non-default theme paint with zero FOUC and zero token
      duplication in JS.

## Phase 3 — store generalization + wiring
- [ ] **T8** Extend `theme.svelte.ts` — add the `themeId` axis alongside the existing mode:
      `vroom-theme-id` localStorage mirror, `themeId` getter, `setTheme(id)`, and an `applyTheme()`
      that sets `document.documentElement` `data-theme` + `.dark` (driving the T7 `themes.css`) AND the
      `theme-color` meta from the resolved theme's brand token (not the hard-coded hex). `initialize()`
      applies BOTH axes. Preserve the existing `setPreference(mode)` API + the `matchMedia` system
      listener. +unit tests (the C100/C101 FE-store guard pattern): setTheme persists+applies,
      initialize applies both, mode-change re-applies the correct variant.
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
