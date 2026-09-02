# Theming Engine — Requirements

> **Status: APPROVED (Angelo signed off D1–D7 at the ✅ recommended option for each, 2026-06-24).
> Build is UNBLOCKED — proceed per `tasks.md` (backend-first, T1+).** Drafted from a design
> exploration (2026-06-23/24) that mocked three radically different looks for the home + dashboard
> — "Instrument Cluster" (dark/electric), "Garage Journal" (warm editorial), and "Glovebox Journal"
> (paper/cork-board/post-it). The exploration's load-bearing finding: **all three are pure token
> swaps on the existing `app.css` CSS-custom-property system** — no component rewrites. This spec
> generalizes that into a first-class, user-facing **theming engine**: ship multiple built-in themes,
> let the user pick (and eventually author) one, persist + sync + back it up like any other preference.
> Mock artifacts: `vroom-design-language-option-1-instrument-cluster` (saved) + the
> `vroom-redesign-mocks/` HTML set.

## Problem

VROOM's look is hard-coded to **one** theme with a light/dark pair. The visual language lives entirely
in `frontend/src/app.css` as `:root` / `.dark` CSS custom properties (`--background`, `--primary`,
`--card`, `--chart-1..5`, …), already consumed everywhere via Tailwind tokens (`bg-background`,
`text-primary`, etc.) per `DesignSystem.md`'s "never hardcode a color" rule. The `themeStore` only
toggles `light | dark | system`. So:

- The app has **no brand identity knob** — the default "primary" is a near-black neutral grey; for an
  app literally called *VROOM* that's a missed opportunity (the exploration's core critique).
- A self-hostable, "you own your data" product can't let a user **make the instance theirs** (a
  household, an enthusiast, a fleet ops team all want a different feel).
- The token system is *already* theme-ready — but there's no engine to register, select, persist, or
  author alternate token sets. The capability is one layer away and currently unreachable.

## Goal

A **theming engine** that treats a theme as a named set of design tokens (the same custom properties
`app.css` already defines), with:
1. a registry of **built-in themes** (the existing default + the explored looks, productized),
2. a **picker** in Settings (live preview, persisted),
3. **persistence + cross-device sync + backup** through the *existing* `userPreferences` plumbing
   (so a theme choice is as durable and portable as currency/unit prefs — NORTH_STAR data-safety),
4. a clean extension seam for **user-authored custom themes** (gated to a later phase),

…**without** touching a single component's markup. Components keep consuming tokens; the engine only
swaps which token values are live. Every theme must independently satisfy the quality bar (a11y
contrast, four-states, mobile, light+dark coverage).

## Functional requirements

- **R1 — Theme = a token set, not new components.** A theme is a typed record of token values for the
  variables already declared in `app.css` (core palette + `--chart-1..5` + radius). Applying a theme
  sets those custom properties on `:root`; **zero** component/markup changes. This is the inviolable
  constraint — it's what made the mock exploration cheap and what keeps the engine maintainable.
- **R2 — Built-in theme registry.** Ship a static, typed registry of built-in themes. v1 set per **D5**
  (recommend: `default` [today's look, unchanged] + the productized explored looks). Each registry
  entry declares both a light and a dark variant (**D3**) plus metadata (id, label, description,
  swatch colors for the picker).
- **R3 — Theme selection UI.** A theme picker in `/settings` (and/or `/profile`): a gallery of theme
  cards with live swatches, current selection highlighted, **live preview on hover/select** before
  commit. Composes from the existing kit (Card/Button/Badge) per `DesignSystem.md` — no bespoke
  controls. Four-states + mobile + axe-clean.
- **R4 — Light/dark orthogonal to theme.** The existing `light | dark | system` control stays and
  becomes **orthogonal**: a user picks a *theme* AND a *mode*. Each theme supplies both variants; the
  engine resolves `(theme, mode, systemPreference)` → the live token set. The current `themeStore`
  light/dark/system logic is preserved and extended, not replaced (**D3**).
- **R5 — Persistence + sync.** The chosen theme persists. Per **D2**: store it in the existing
  `userPreferences` table (a new `themePreference` column / field) so it syncs across devices and is
  owner-scoped, with a localStorage fast-path mirror (the current `themeStore` pattern) so first paint
  is flicker-free before the server settings hydrate.
- **R6 — Backup/restore + round-trip safety.** The theme preference flows through the existing
  backup/restore + Google Sheets header set exactly like every other `userPreferences` field — added
  to `SHEET_HEADERS` + the backup round-trip coverage guard (NORTH_STAR #1; the cycle-3/C15 contract).
  No new backup path.
- **R7 — No-flash-of-wrong-theme (FOUC).** The resolved theme + mode must apply **before first paint**
  (an inline head script reading the localStorage mirror, mirroring how dark mode already avoids the
  flash), so a non-default theme doesn't flicker through the default on every load.
- **R8 — Graceful fallback.** An unknown/removed theme id (stale localStorage, a restored backup from a
  newer instance, a deleted custom theme) resolves to `default` — never a broken/blank palette. The
  resolver is total.
- **R9 — Custom themes (gated to Phase 4, behind D6).** A seam for user-authored themes: the engine
  reads themes from `[built-ins] ∪ [user-authored]`. Authoring UX (token editor, import/export JSON,
  live contrast linting) is **out of scope for v1** but the registry/types/resolver must not preclude
  it. **[depends on D6]**
- **R10 — Quality bar per theme.** EVERY built-in theme must independently pass the gates: axe
  color-contrast AA on text tokens (the `/dev/gallery` a11y gate, both light+dark), four-states intact,
  no mobile overflow, chart colors distinguishable. A theme that can't clear AA doesn't ship (**D4** —
  how strict, and what to do about the paper/post-it look's bright surfaces).

## Non-goals (this iteration)

- A full WYSIWYG theme **authoring/editor** UI (R9 is a seam only; editor is Phase 4 / its own spec).
- Per-component or per-route theme overrides (a theme is app-global).
- Theme **marketplace**/sharing between users, or importing community themes.
- Animated/seasonal/auto-switching themes (e.g. time-of-day) beyond the existing `system` mode.
- Re-skinning the marketing/landing page independently of the app shell (one engine, app-wide).
- The literal skeuomorphic textures from the "Glovebox Journal" mock (cork/paper images) — those are a
  *look* to potentially productize as one theme later, but heavy raster/CSS textures have a11y + perf +
  dark-mode costs; v1 themes are **token-based** (color/radius), not texture-based (**D7**).

## Product decisions — **RATIFIED (Angelo, 2026-06-24, all ✅ recommended)**

> ✅ **ALL of D1–D7 signed off at the recommended option below.** Build is UNBLOCKED. (No ARCC —
> VROOM is a personal project.) The design `[depends on Dx]` sections already assume these options.

- **D1 — Is this one feature or two?** The engine (registry + resolver + picker + persistence) is the
  foundation; the *content* (which specific themes ship) is a product/taste call. ✅ **Ship the engine
  with `default` + ONE additional polished theme first** (prove the whole pipe end-to-end), then add
  more themes as fast-follow increments. Avoids blocking the engine on bikeshedding the full palette.
- **D2 — Where does the theme preference live?** (a) localStorage only (like `themeStore` today —
  simple, but doesn't sync across devices and isn't in backups); (b) `userPreferences` table + a
  localStorage mirror for first-paint. ✅ **(b)** — NORTH_STAR says preferences should be durable,
  portable, and synced; a theme is exactly that. The mirror keeps first paint flicker-free.
- **D3 — How do theme and light/dark relate?** (a) each theme is a single fixed palette (no dark
  variant); (b) every theme supplies BOTH a light and dark variant, and the existing
  `light|dark|system` mode selects between them. ✅ **(b)** — preserves the existing dark-mode
  investment and the `system` auto-switch; the resolver composes `(theme × mode)`.
- **D4 — A11y strictness per theme.** A bold theme (e.g. a neon accent, or the paper look's bright
  post-it surfaces) may struggle to clear AA on every token. Options: (a) HARD gate — a theme can't
  ship unless every text token clears AA in both variants (consistent with the app-wide rule that
  caught the `--destructive` 3.9:1 bug); (b) soft — allow a documented exception per theme. ✅ **(a)**
  — accessibility is non-negotiable; tune the palette until it clears, or don't ship that theme.
- **D5 — v1 built-in theme set.** Which themes ship first (gated by D1's "engine + 1"). Candidates from
  the exploration: **Instrument Cluster** (dark/electric-lime, data-forward), **Garage Journal** (warm
  cream/combustion-orange editorial), plus the existing **Default**. ✅ **`default` + `instrument`
  first** (the dark/electric look has the strongest identity and the cleanest a11y story on a dark
  canvas); **`garage` (warm editorial) as the immediate fast-follow.** Confirm the pick + the names.
- **D6 — Custom (user-authored) themes in scope?** ✅ **Seam only in v1** (types/registry/resolver
  must allow a user theme source), **authoring UI deferred** to its own spec — keeps v1 shippable while
  not painting us into a corner.
- **D7 — Texture/skeuomorphism (the "Glovebox Journal" paper look).** That mock leaned on cork/paper
  textures, post-it cards, pushpins. Options: (a) v1 themes are **token-only** (color + radius), no
  textures — the paper look becomes a *future* texture-capable theme behind its own design pass; (b)
  build texture support into the engine now. ✅ **(a)** — textures add a11y/perf/dark-mode complexity
  the token engine shouldn't carry on day one; ship the color engine first, revisit textures as a
  deliberate later theme.

## Acceptance (once signed off)

- A user opens `/settings`, sees a theme gallery, picks a non-default theme → the whole app
  re-skins live (no reload), the choice persists across reload AND across a different device (synced
  via `userPreferences`), and survives a backup→restore round-trip.
- First paint after reload shows the chosen theme with **no flash** of the default.
- Every shipped theme passes the `/dev/gallery` axe a11y gate in BOTH light and dark, four-states
  intact, no mobile overflow (the R10 gate, enforced — not warn-only — for shipped themes).
- A stale/unknown theme id falls back to `default` cleanly (R8 unit-tested).
- `regress.sh` green + eyes-on screenshots of the picker AND of at least one full surface
  (dashboard) rendered in each shipped theme, light + dark.
