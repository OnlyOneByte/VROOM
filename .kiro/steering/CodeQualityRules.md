---
inclusion: fileMatch
fileMatchPattern: "frontend/**"
---

# Frontend Code Quality Rules

MainSteering.md is always on and carries the shared rules, under three headings:

- **"UI Components"** — semantic color tokens, compose from the kit, `LoaderCircle` spinners,
  `@lucide/svelte` imports, `FormLayout` on form pages.
- **"Frontend Architecture" → "Rules"** — no `any`, no raw `fetch`, domain API services over
  `apiClient`, one canonical utility/type per concept.
- **"Code Hygiene"** — SSR guards on browser APIs, FAB paint and clearance, `undefined` on array
  index access, keyed `{#each}`, `svelte/reactivity` collections, and branching on enum values
  rather than display labels.

DesignSystem.md carries the component kit and the token table. This doc carries what neither
states: the rules below, the guards the test suite enforces statically, and the chart-color
contract.

## Frontend-only rules

- Never put an `!important` (`!`) prefix on a Tailwind class handed to a shadcn `Button` — pass the
  class plainly or pick a `variant`. The `!` fights the component's own styles and breaks theming.
- Validation error borders are `border-destructive`, never `border-red-*`. No source-scan guard
  covers this one: `no-theme-clashing-colors` matches only white/black/gray/slate/zinc/neutral.
- A status or accent color is a theme token too, including in a plain `.ts` helper that returns
  class strings — `utils/sync/sync-status.ts` is the reference: `text-destructive` for
  offline/failed, `text-chart-5` for pending/syncing, `text-chart-2` for synced. Never
  `text-green-500` / `bg-blue-100` for a status pill or a financing/payment accent. Same gap as
  above: the guard's regex sees no non-grey palette class, so nothing fails the build for you.
- Guard `console.error` in client error handlers (`hooks.client.ts` `handleError`) with
  `import.meta.env.DEV`. A production build must not dump raw error objects to the console.
- Never switch an ESLint rule off globally in `eslint.config.js` to clear a warning. Scope the
  exception to the files that need it — the `src/lib/components/ui/**` block is the pattern — or
  fix the code. `svelte/require-each-key`, `svelte/prefer-svelte-reactivity` and
  `no-useless-assignment` each catch real bugs.

## Static source-scan guards

Committed scans under `src/lib/utils/__tests__/` fail `npm run test` on a whole bug class, not
just the site that first hit it. Each test's header comment names the helper to use instead — read
it before working around a failure.

| Guard | Fails on | Use instead |
|---|---|---|
| `no-theme-clashing-colors` | a bare `bg-`/`text-`/`border-` + `white`, `black`, `gray-N`, `slate-N`, `zinc-N`, `neutral-N` in a `.svelte` | a semantic theme token (a `dark:`-prefixed variant is fine; five fixed-contrast sites are allowlisted) |
| `no-hardcoded-currency` | a literal `($)` / `(€)` / `(£)` label suffix | `getCurrencySymbol` / `formatCurrency` (`utils/formatters`) |
| `no-utc-date-input` | `.toISOString().split('T')[0]` or `.slice(0, 10)` as an `<input type="date">` value | `toDateInputValue` (`utils/formatters`) — date-only values persist at noon local, so the UTC date is off by a day |
| `no-utc-month-parse` | `new Date(month + '-01')` | `parseMonthToDate` (`utils/chart-formatters`) |
| `no-native-dialogs` | a `confirm()` / `alert()` call | `common/ConfirmDialog.svelte` |
| `no-interpolated-arbitrary-class` | an interpolated arbitrary value (`h-[{height}px]`) — Tailwind scans source text, so no CSS is generated and the utility is silently dead | a literal arbitrary value, or inline `style=` |
| `fab-bottom-clearance` | a page importing `FloatingActionButton` without `pb-16` or larger | `pb-24` on the content wrapper (the FAB is `position: fixed` and would occlude the last row) |
| `expense-category-maps` | a label/icon/badge lookup in `expense-helpers.ts` missing a key of the `ExpenseCategory` union (`fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`), or an extra key | add the category to `CATEGORY_LABELS` + `CATEGORY_COLOR_TOKENS` (`chart-colors`) and to `CATEGORY_ICONS` |
| `category-color-label-convergence` | a second category → color, label, or icon map anywhere under `src`; a badge/chart/icon rendering that stops resolving to the one assignment; a component printing a category as the bare enum value instead of its label; a `getCategoryColor` alias re-pointed at the other module's helper; a `--chart-N` token in `app.css` that `StatCard`'s icon map and type don't both list | assign each category's color, label, and icon once — `CATEGORY_COLOR_TOKENS` + `CATEGORY_LABELS` (`chart-colors`) and `CATEGORY_ICONS` (`expense-helpers`) — and derive every rendering from those |
| `assistant-safe-render` | `{@html}` on the assistant surface, which renders untrusted LLM output | a plain-text node with `whitespace-pre-wrap` |
| `_helpers/no-duplicate-file-walker` | a new guard re-declaring `collectSvelteFiles` | import `__tests__/_helpers/collect-svelte-files` |

A new guard goes in the `__tests__/` folder next to what it pins; route-local layout pins live
with the route (e.g. `routes/reminders/__tests__/reminder-card-mobile-stack.test.ts`).

## Chart colors

- Series colors come from `CHART_COLORS` in `$lib/utils/chart-colors`. A category's color is
  assigned exactly once, in that module's `CATEGORY_COLOR_TOKENS`; every surface derives its own
  rendering from it — `getCategoryChartColor` (a CSS color value, for a chart fill or legend
  swatch) and `getCategoryBadgeClasses` in `expense-helpers` (a Tailwind `text-*`/`bg-*` pair, for
  a badge). Never hardcode a hex or build a second category map. The bare `getCategoryColor` name
  survives in both modules as a deprecated alias for its own module's helper; don't add call sites.
- The tokens are `var(--chart-1)` … `var(--chart-8)` — plain `var()`, not `hsl(var(--chart-N))`,
  since the values are oklch under Tailwind v4. Eight exist so a fleet of ≥6 vehicles gets
  distinct series colors; `theme/theme-registry.ts` defines all eight per theme and
  `theme/__tests__/theme-contrast.test.ts` pins each at ≥3:1 against `card`.
