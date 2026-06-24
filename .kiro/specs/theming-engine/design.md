# Theming Engine — Design

> **Status: APPROVED — Angelo signed off D1–D7 (all ✅ recommended) 2026-06-24; build UNBLOCKED.**
> The `[depends on Dx]` sections below now reflect ratified decisions, not assumptions. Grounded in a
> read of the current theming internals (`frontend/src/app.css`,
> `frontend/src/lib/stores/theme.svelte.ts`, `backend/src/db/schema.ts` `userPreferences`, the
> settings PUT path, and `DesignSystem.md`).

## Grounding — what already exists (reuse, don't reinvent)

- **The token system IS the theme system.** `frontend/src/app.css` declares the whole visual language
  as CSS custom properties under `:root` (light) and `.dark` (dark): `--background --foreground --card
  --card-foreground --popover(-fg) --primary(-fg) --secondary(-fg) --muted(-fg) --accent(-fg)
  --destructive --warning --border --input --ring --chart-1..5 --sidebar*` + `--radius`. The
  `@theme inline {}` block maps each to a Tailwind token (`--color-background: var(--background)`, …),
  and every component consumes the Tailwind class (`bg-background`, `text-primary`) — never a raw hex
  (`DesignSystem.md`'s enforced rule). **Swapping the `:root`/`.dark` values re-skins the entire app.**
  This is the entire reason a theming engine is cheap: the mock exploration produced three completely
  different looks by only changing these values.
- **The existing theme store:** `theme.svelte.ts` — `ThemePreference = 'light'|'dark'|'system'`,
  persisted to `localStorage['vroom-theme-preference']`, applied by toggling `.dark` on
  `document.documentElement` + updating the `theme-color` meta. `initialize()` runs in the root layout
  `onMount`; a `matchMedia('(prefers-color-scheme: dark)')` listener re-applies on OS change when
  `system`. **This is the dark-mode half of the engine — we generalize it to also carry a theme id.**
- **Preference persistence:** `backend/src/db/schema.ts` `userPreferences` (PK `userId`, write-rare
  user-facing settings: `unitPreferences`, `currencyUnit`, `backupConfig`, …). The settings PUT
  (`backend/src/api/settings/routes.ts`) merges a partial body into the existing row (the C82/#82
  per-field merge discipline). `settingsStore` (`frontend/src/lib/stores/settings.svelte.ts`) hydrates
  it app-wide in the root layout (cycle-203). **A theme preference is one more field on this row.**
- **Backup round-trip:** `userPreferences` fields ride the CSV + Google Sheets backup; `SHEET_HEADERS`
  is the pinned column contract (cycle-3/C15) with a coverage guard. **Add one header, inherit the
  round-trip.**
- **The quality gate:** `/dev/gallery` (dev-only) renders the whole kit in all four states at both
  viewports; route-smoke runs axe there with an enforced a11y ratchet. Building it caught the
  `--destructive` 3.9:1 AA bug (cycle-20). **This is exactly the harness that validates each theme.**

**Key architectural insight:** a theme is a **named (light, dark) pair of token-value maps**. The
engine = a registry of those maps + a resolver that writes the active map's values onto `:root` as
inline custom properties (overriding `app.css`'s defaults) + a persisted `(themeId, mode)` selection.
**No component, no markup, no Tailwind class changes — ever.** That constraint (R1) is the whole design.

## Architecture

```
userPreferences.themePreference (server, synced, backed-up)   ┐
localStorage['vroom-theme-id'] mirror (first-paint, no FOUC)  ┘─► resolveTheme(themeId, mode, sysPref)
                                                                     │
   THEME_REGISTRY  ──────────────────────────────────────────────►  │  → { tokens: Record<cssVar,value> }
   (built-in (light,dark) token maps + metadata)                     │
                                                                     ▼
                                          applyTheme(): write tokens as inline style on :root
                                          (overrides app.css defaults; components unchanged)
```

### New: the theme model + registry (`frontend/src/lib/theme/`)

```ts
// theme-types.ts
type ThemeId = string;                       // 'default' | 'instrument' | 'garage' | <custom>
type ThemeMode = 'light' | 'dark' | 'system';   // unchanged from today (R4/D3)

// the token keys are EXACTLY the custom properties app.css already declares
type ThemeTokens = Partial<Record<ThemeTokenKey, string>>;  // e.g. { '--primary': 'oklch(...)', ... }

interface ThemeVariant { tokens: ThemeTokens; }       // a full token map for one mode
interface ThemeDefinition {
  id: ThemeId;
  label: string;                 // 'Instrument Cluster'
  description: string;           // picker copy
  swatch: string[];              // 3–4 hexes for the picker card preview
  light: ThemeVariant;
  dark: ThemeVariant;
  source: 'builtin' | 'user';    // R9/D6 seam — registry is [builtins] ∪ [user]
}
```

- **`theme-registry.ts`** — `THEME_REGISTRY: Record<ThemeId, ThemeDefinition>`. `default`'s light/dark
  maps are the values **currently in `app.css`** (extracted verbatim → zero visual change for existing
  users). Additional built-ins per **[D5]** (`instrument`, then `garage`) carry the productized token
  sets distilled from the mock CSS (`vroom-redesign-mocks/design-language.css` + `option2.css`),
  re-expressed in `oklch` to match the app's color space and **tuned to clear AA (R10/D4)**.
- **`resolveTheme(themeId, mode, systemPref)`** — total function: look up the definition (fallback to
  `default` if unknown, **R8**), pick `light`/`dark` by `mode==='system' ? systemPref : mode`, return
  its token map. Pure + exhaustively unit-tested (every built-in × both modes, unknown id → default,
  empty/garbage id → default).

### Generalize the store (`theme.svelte.ts`, extended — not replaced)

Keep `ThemePreference` (the mode) and add a parallel `themeId`. The store now owns **both** axes:

```ts
// localStorage: 'vroom-theme-preference' (mode, EXISTING) + 'vroom-theme-id' (NEW)
themeStore.current        // mode (existing getter, unchanged API)
themeStore.themeId        // NEW
themeStore.setPreference(mode)        // existing — now also re-applies the active theme's correct variant
themeStore.setTheme(themeId)          // NEW — swap theme, persist mirror, re-apply, push to server
themeStore.initialize()               // existing — now resolves (themeId, mode) and applies BOTH
```

`applyTheme()` is extended: in addition to toggling `.dark`, it writes the resolved variant's tokens
onto `document.documentElement.style` (`setProperty('--primary', …)` per key). Because these are
inline styles they override `app.css`'s `:root`/`.dark` cascade. The `theme-color` meta is set from
the resolved theme's `--background`/brand token (not hard-coded `#2563eb`/`#1a1a2e` as today).

### Persistence + sync (server) **[depends on D2 = userPreferences]**

- **Schema:** add `themePreference text('theme_preference').notNull().default('default')` to
  `userPreferences` (Drizzle migration `000X_*.sql` + snapshot/journal per `DatabaseMigrations.md`;
  `db:init` not `drizzle-kit push` on this host). It stores the **theme id only**; the mode stays the
  existing localStorage `vroom-theme-preference` (mode is device-local by convention — a user may want
  dark on their phone, light on desktop; **theme id syncs, mode stays local**). *(If Angelo wants mode
  synced too, it's a trivial second column — flag at sign-off.)*
- **Route:** extend the settings PUT schema with `themePreference: z.string().optional()` and the
  per-field merge (the #82 discipline — never wholesale-overwrite). Validate against known ids server-
  side is NOT required (R8 resolver fallback makes an unknown id safe), but we DO clamp length.
- **Hydration:** `settingsStore.load()` already runs in the root layout; on load, if
  `settings.themePreference` differs from the localStorage mirror, the store reconciles (server wins
  for cross-device correctness; update the mirror). First paint used the mirror (no FOUC); the server
  value corrects within the same tick if they differ (rare).

### No-flash inline head script (R7)

A tiny synchronous script in `frontend/src/app.html` `<head>` (mirroring the standard dark-mode
anti-FOUC trick): read `localStorage['vroom-theme-id']` + `vroom-theme-preference`, look up the token
map from a **minimal inlined registry** (or apply `.dark` + a `data-theme` attr that a synchronous
`<style>` keys off), and set the custom properties before first paint. **[Ambiguity A1 below.]**

### Backup/restore (R6)

`themePreference` is a `userPreferences` column → it's already carried by the schema-derived backup.
Add it to `SHEET_HEADERS` (Google Sheets path) + extend the backup round-trip coverage guard
(`maintenance-fields-roundtrip`-style) so a restore re-applies the user's theme. Inherits the
merge-mode-restore prefs-collision handling (C300/#93).

### Frontend picker (`/settings` → a ThemeSection)

A new settings section: a responsive grid of **theme cards** (compose `Card` + `Badge` from the kit).
Each card shows the theme's `label`, `description`, a swatch strip (`swatch[]`), and a selected-state
ring (`ring-ring`). Clicking calls `themeStore.setTheme(id)` → instant live re-skin (the whole point).
A small `light | dark | system` segmented control sits alongside (the existing mode control, surfaced
here too). Four-states (the registry is static so no loading/error, but empty-safe), mobile-first,
axe-clean. **No bespoke color controls** — v1 is *selection*, not *authoring* (D6).

## A11y strategy (R10 / D4 — hard gate)

Each built-in theme's token map is tuned so every **text-bearing** token clears WCAG AA 4.5:1 against
its surface, in BOTH variants — the same bar the `--destructive`/`--muted-foreground` fixes (cycle-19/20)
established app-wide. Process: render `/dev/gallery` under each candidate theme (a `?theme=<id>` dev
override or a gallery theme switcher), run the existing axe scan, tune until clean. A theme that can't
clear AA does **not** enter the registry. The `instrument` dark canvas makes this easy (lime/azure on
near-black are high-contrast); the warm `garage` light look needs care on the muted/secondary text
tokens (pre-tuned in the mock, re-verified here).

## Ambiguities flagged

- **A1 — anti-FOUC registry duplication.** The head script must apply the theme *before* the JS bundle
  (and thus the registry) loads. Options: (a) inline a tiny `id → {bg, fg, primary, …critical tokens}`
  map in `app.html` (fast, but duplicates a subset of the registry — drift risk; mitigate with a build
  step or a guard test asserting the inline map ⊆ registry); (b) ship each theme as a
  `[data-theme="instrument"]` selector block in a static CSS file that loads in `<head>` (no JS, no
  duplication, but ships all themes' CSS always). ✅ lean **(b)** — a generated `themes.css` with one
  `:root[data-theme="x"]` / `:root[data-theme="x"].dark` block per theme; the head script only sets the
  `data-theme` attribute + `.dark` class from localStorage. Zero token duplication, zero FOUC, and the
  registry's TS metadata (label/swatch/description) stays the single source for the *picker*.
  **Confirm at design review.**
- **A2 — `oklch` for the productized themes.** The mocks used hex/`oklch` mixed; the app is all `oklch`.
  Re-express each productized theme in `oklch` (matches `app.css`, gives perceptually-uniform
  light/dark tuning). Mechanical but must be eyes-on verified per theme.
- **A3 — chart colors.** `--chart-1..5` are part of the token set; each theme must supply 5
  distinguishable hues (color-blind-safe ideally). The `#112` open bug (only 5 chart tokens, a 6-vehicle
  fleet reuses `--chart-1`) is orthogonal but related — a theme could ship 6+ but that's a separate
  palette-size decision; v1 keeps 5 per the current contract.

## Test plan

- **Unit (`resolveTheme`):** every built-in × {light, dark, system+sysPref}; unknown id → default;
  empty/garbage → default; the resolver is total (no throw).
- **Unit (registry integrity):** every `ThemeDefinition` declares all the token keys `app.css` declares
  (no missing token → no fallback-to-default-leak); `default`'s maps equal the current `app.css` values
  (a guard that catches accidental drift of the baseline look); the inline/`themes.css` set ⊇ the
  registry ids [A1].
- **Store:** `setTheme` persists the mirror + applies tokens + (mocked) pushes to server; `initialize`
  applies (themeId, mode); reconcile prefers server over a differing mirror.
- **HTTP:** settings PUT with `themePreference` persists + merges (doesn't wipe sibling prefs — the #82
  guard); GET returns it; restore re-applies it (round-trip).
- **A11y (R10, the hard gate):** `/dev/gallery` axe scan passes for EACH shipped theme in light AND
  dark (extend route-smoke to iterate themes, or a dedicated theme-a11y spec).
- **E2E + screenshot:** open `/settings`, switch theme → assert a token actually changed on `:root` +
  no reload; reload → theme persisted (mirror); shot the picker + the dashboard in each shipped theme ×
  {light, dark}. (The FE→BE→DB→render round trip per NORTH_STAR #3 — theme set in UI, synced to server,
  survives reload.)

## Rollout (backend-first per CLAUDE.md, additive + backward-compatible)

The whole feature is **additive** — `default` reproduces today's look byte-for-byte, so an un-migrated
/ un-chosen user sees zero change.

1. **Schema + route** — `userPreferences.themePreference` column + migration; settings PUT/GET field +
   per-field merge; `SHEET_HEADERS` + backup round-trip guard. (Backend, testable in isolation.)
2. **Registry + resolver** — `theme-types.ts`, `theme-registry.ts` (extract `default` from `app.css`
   verbatim + add the first non-default theme per D1/D5), `resolveTheme` + the `themes.css` generation
   [A1]. Pure, fully unit-tested. **No UI yet.**
3. **Store generalization** — extend `theme.svelte.ts` (themeId axis + `applyTheme` token write +
   server push/hydrate reconcile) + the anti-FOUC head hook. Wire `settingsStore` hydration.
4. **Picker UI** — the `/settings` ThemeSection; eyes-on each shipped theme × {light,dark}.
5. **A11y gate** — extend `/dev/gallery` + route-smoke to validate every shipped theme; ENFORCE (not
   warn) for shipped themes.
6. **(Phase 4, separate spec) custom themes** — the authoring editor on top of the R9/D6 seam.

**Build starts only after D1–D7 sign-off.** Each numbered step is one or more loop increments; the
native (default) look is untouched and stays the default throughout.
