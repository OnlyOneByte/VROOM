# Project Conventions

## Tech Stack

- Monorepo: `frontend/` and `backend/` directories
- Frontend: SvelteKit + Svelte 5 (runes mode), Tailwind CSS v4, shadcn-svelte components on bits-ui, layerchart for charts, sveltekit-superforms + Zod for forms, Vitest + Playwright for tests, ESLint + Prettier
- Backend: Hono on Bun, Drizzle ORM with SQLite, Lucia for auth, Biome for linting/formatting

## Validation & Quality

After finishing a task, run fix then validate in each subfolder you modified. Fix all errors and warnings, even pre-existing ones.

- Backend: `bun run all:fix && bun run validate`
- Frontend: `npm run all:fix && npm run validate`

`all:fix` auto-fixes lint and formatting. `validate` runs lint, format check, type check, tests, and the build in sequence — fix any failing step before proceeding.

## Git Commands

Always use `--no-pager` immediately after `git` for commands with large output (e.g., `git --no-pager diff`).

## Output Style

- Keep task summaries to a few key bullet points. No full paragraphs.
- Do not generate documentation files unless updating README or existing docs.

## Svelte 5 Runes Mode

### State & Reactivity

- `$state(value)` for reactive state.
- `$derived(expression)` or `$derived.by(() => ...)` for computed values. Prefer `$derived` over `$state` + manual sync via `$effect` — if you call an "apply"/"update" function inside an `$effect`, it should be `$derived`.
- `$effect(() => { ... })` for side effects. Never create empty or no-op effects that track nothing.
- `let { prop = default } = $props()` for component props.
- Never use `$effect` to fire async data loads on reactive state that `onMount` already loads — it double-fetches. Use an explicit change handler instead.

### Handling `state_referenced_locally` Warnings

Svelte warns when a `$props()` or `$derived` value is captured once into `$state()` or a `const` instead of being used reactively. Apply this decision tree:

- If the prop can change during the component's lifetime (e.g., `data` from SvelteKit page load, a bindable parent prop), it's a real bug — use `$derived` instead of `const`.
- If the prop is stable for the component's lifetime (e.g., `expenseId` or `vehicleId` from a URL param, a one-time config prop), the warning is a false positive — `$state(!!prop)` for initial values is fine.
- If the value is reset by an `$effect` (e.g., dialog state reset when `open` changes), initialize with a plain default and let the effect handle it.
- Never "fix" the warning by wrapping in `$derived` when you actually need mutable `$state` — that changes semantics.

### Forbidden Patterns

- Never use `$:` reactive statements. Use `$derived()` or `$effect()`.
- Never use `ComponentType`. Use `Component` instead.
- Never use `class:`, `on:`, or other directives directly on Svelte components. They only work on HTML elements.
- Never use `|modifier` syntax on event attributes (e.g., `onmousedown|preventDefault`). Call the modifier inside the handler instead.
- Never use `$app/stores`. Use `$app/state` instead (rune-compatible, no `$derived($page)` wrapper needed).

```svelte
// ❌ WRONG
$: doubled = count * 2;
<Icon class:mr-3={expanded} />

// ✅ CORRECT
let doubled = $derived(count * 2);
<Icon class="base {expanded ? 'mr-3' : ''}" />
```

### Navigation

Route strings live in `$lib/routes.ts` (`routes` for static, `paramRoutes` for parameterized). Never hardcode a path like `'/dashboard'` in a component. All navigation goes through `resolve()` from `$app/paths` so the app works under any base path; this also satisfies the `svelte/no-navigation-without-resolve` lint rule.

- Static: `goto(resolve(routes.dashboard))`, `href={resolve(routes.dashboard)}`
- Parameterized: `resolve(paramRoutes.vehicle, { id: vehicleId })` — params go in the object, never interpolated into the string
- With query params: `gotoWithQuery(resolve(routes.expenseNew), { vehicleId })` from `$lib/utils/navigation`, or append to a resolved `href`. Never put a query string inside `resolve()`.
- Runtime-only paths (e.g., a `returnTo` URL param): `gotoDynamic(returnTo)` from `$lib/utils/navigation`

## UI Components

- Compose from the existing kit — shadcn-svelte primitives in `$lib/components/ui/`, app patterns in `$lib/components/common/`. Check before building a custom component. (See `DesignSystem.md` for the inventory.)
- Charts use the shadcn-svelte chart components (built on layerchart). Do not add recharts.
- Use semantic color tokens (`text-foreground`, `bg-background`, `text-muted-foreground`, `border-input`) instead of hardcoded Tailwind colors (`text-gray-900`, `bg-white`).
- Loading spinners are `LoaderCircle` from `@lucide/svelte` with `animate-spin`. No custom CSS spinners.
- Import icons from `@lucide/svelte` (the Svelte 5 package), not `lucide-svelte`. App code uses barrel imports — `import { Car, Fuel } from '@lucide/svelte'`; the `ui/` components' `@lucide/svelte/icons/*` deep imports are upstream code and fine as-is. Don't mix emoji strings with Lucide icons in the same UI.
- Do not modify shadcn-svelte registry components (`$lib/components/ui/`) to fix warnings or lint issues. They are upstream-managed; diverging creates maintenance burden on registry updates. Tolerate warnings there (`eslint.config.js` already scopes the Svelte rules off for that directory).
- Form and form-like pages (vehicle, expense, insurance, odometer, settings, profile, providers) must wrap their content in `<FormLayout>` from `$lib/components/common/form-layout.svelte`, which applies the shared centered `max-w-2xl`. Never use inline `max-w-*` on a form page wrapper.

## Frontend Architecture

### Directory Layout (`frontend/src/lib/`)

| Directory | Purpose |
|---|---|
| `components/` | Svelte components by domain (vehicles, expenses, analytics, …), `ui/` for shadcn primitives, `common/` for app-level patterns |
| `services/` | API layer: `api-client.ts` (base) plus one `<domain>-api.ts` per domain, and `api-transformer.ts` for backend↔frontend shapes |
| `stores/` | Rune-based state modules (`app.svelte.ts`, `auth.svelte.ts`, `offline.svelte.ts`, `settings.svelte.ts`, `theme.svelte.ts`) — not `svelte/store` writables |
| `types/` | TypeScript type definitions (main barrel: `types/index.ts`) |
| `utils/` | Shared utility functions (formatters, validation, filters, calculations) |
| `constants/` | App constants: `limits.ts`, `messages.ts`, `providers.ts`, `time-periods.ts`, `ui.ts` |
| `hooks/` | Svelte 5 reactive hooks (e.g., `is-mobile.svelte.ts`) |
| `theme/` | Theme registry and color-space helpers |

### Rules

- API calls: use the domain service (`vehicleApi`, `expenseApi`, `settingsApi`, …) when it has the method you need; fall back to `apiClient` only for endpoints no service covers. Never use raw `fetch()` in components, stores, or utils — `api-client.ts` is the only exception.
- Types: define in `$lib/types/`. Avoid `any`; use proper types or `unknown` with type guards. Don't redefine a backend shape that `api-transformer.ts` already declares.
- Utilities: reuse from `$lib/utils/` (and `$lib/constants/` for shared maps). Don't reimplement existing logic in components.

Routes live in `frontend/src/routes/` under SvelteKit file-based routing; `$lib/routes.ts` is the canonical list.

## Backend Architecture

### Directory Layout (`backend/src/`)

| Directory | Purpose |
|---|---|
| `api/` | Route handlers by domain: auth, vehicles, expenses, financing, insurance, odometer, photos, providers, reminders, settings, shares, sync, trips, analytics, assistant, push |
| `db/` | Database connection, schema, migrations, seeding |
| `middleware/` | Hono middleware: auth, rate-limit, error-handler, idempotency, body-limit, activity tracking |
| `utils/` | Shared utilities: calculations, money, logger, validation, unit-conversions, vehicle-stats |

### Rules

- Every domain under `api/` has a `routes.ts` with its Hono route definitions. Most also have a `repository.ts` (or a domain-named one such as `insurance/claims-repository.ts`) holding the data access — follow the split the domain you're touching already uses.
- Use Biome for linting and formatting (not ESLint/Prettier). `bun run all:fix` chains `lint:fix`, `format:fix`, and `check:fix`.
- Schema changes go through generated migrations in `backend/drizzle/`: edit `db/schema.ts`, then `bun run db:generate`. Migrations apply automatically at startup via `runMigrations()`. Never use `db:push` for a schema change — see `DatabaseMigrations.md`.

## Money (integer cents)

All monetary values are stored AND computed as **integer cents** — the 14 money columns (expenses.expenseAmount/groupTotal, vehicleFinancing.{originalAmount,paymentAmount,residualValue,excessMileageFee}, insuranceTerms.{deductibleAmount,coverageLimit,totalCost,monthlyCost,paymentAmount}, insuranceClaims.payoutAmount, vehicles.purchasePrice, reminders.expenseAmount) are `integer`, NOT `real`. Dollars exist ONLY at two edges; everything in between (sums, splits, balances, analytics) is integer cents.

- **Input edge (dollars → cents):** every money Zod validator wraps the amount in `moneyDollarsToCents` / `dollarsToCents` (`backend/src/utils/money.ts`). The non-Zod CSV import does the same. Never store a client dollar amount without converting.
- **Display edge (cents → dollars):** convert at the API RESPONSE boundary — per-entity `*ToApi` helpers (`utils/money.ts`) + `api/analytics/api-transform.ts` for analytics. The frontend dollar contract is unchanged; do NOT convert inside repositories or analytics (they read/compute cents).
- **NOT money** (stay `real`/number): `apr` (%), `volume` (gal/kWh), `businessMileageRate` ($/mile rate), mileage, percentages, normalized scores (e.g. analytics `vehicleRadar` fields). A cost-NAMED analytics field may be a normalized score — check its builder, not its name.
- **Backup/restore:** backup `currentVersion` is `'2.0.0'` (cents). The ZIP path version-gates a ×100 restore shim for pre-cents (`<2.0.0`) backups (`coerceRow` + `shimMoneyToCents`). The Google **Sheets** path has NO persisted version (it is a live cents-native DB mirror) → it must restore WITHOUT the shim. `MONEY_CENTS_FIELDS` (the shim allowlist) is drift-guarded by `money-cents-fields-guard.test.ts`.
- Adding a new money column? Make it `integer`, add it to `MONEY_CENTS_FIELDS`, add its input transform + display conversion, and update the guard.

## Code Hygiene

`CodeQualityRules.md` adds the frontend-only rules: the shadcn/Tailwind styling rules, the status and accent color tokens, the ESLint-config rule, the static source-scan guards and the chart-color contract. The rules below apply to the whole repo:

- No comments in code. CLAUDE.md quality bar #6 states the rule and its narrow exceptions; rename or extract before reaching for a comment.
- Floating action buttons paint with `bg-foreground` / `text-background`, as `common/floating-action-button.svelte` does — never `bg-gray-900 text-white`, and never a gradient stack with `!text-white` overrides.
- Pages with a floating action button must add `pb-24` to the main content wrapper so the fixed FAB doesn't cover the last row. `fab-bottom-clearance.test.ts` enforces this.
- Never access browser-only APIs (`window`, `document`, `PerformanceObserver`) at module top level or without a guard — including `window.location` inside event handlers, since SvelteKit may SSR the component. Guard with `browser` from `$app/environment` or initialize lazily.
- An array index access can yield `undefined` — guard (or narrow) before dereferencing. The frontend tsconfig sets `noUncheckedIndexedAccess` so the compiler says so there; `backend/tsconfig.json` does NOT, so on the backend `rows[0].id` type-checks and throws at runtime.
- Memoization caches (`Map`-based) must have a max size to prevent memory leaks. Use LRU eviction or clear on navigation.
- Stubbed or unimplemented API functions must not be called from UI — render a "coming soon" state (`common/coming-soon-card.svelte`) instead of catching a thrown error.
- Category color/label maps must use the real enum values: `fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`. No stale keys like `insurance`, `parking`, `tolls`.
- Branch on the raw enum value (`category === 'fuel'`), never on a display label (`=== 'Fuel'`). `categoryLabels` (frontend) and `EXPENSE_CATEGORY_LABELS` (backend, also emitted as the `label` field by `GET /expenses/categories`) are display strings that can be reworded without touching the values, so a label comparison breaks silently.
- Every `{#each}` block needs a key: `{#each items as item (item.id)}`. For index-only arrays (e.g., skeleton placeholders), use `{#each Array(3) as _, i (i)}`. Satisfies `svelte/require-each-key`.
- Use `SvelteMap`, `SvelteSet`, and `SvelteDate` from `svelte/reactivity` instead of the native built-ins when the instance lives in a reactive context (`$state`, `$derived`) — natives don't trigger re-renders on mutation. Satisfies `svelte/prefer-svelte-reactivity`. Exception: a `Map`/`Set` created and consumed inside one `$derived.by()` expression isn't mutated reactively and doesn't need the Svelte variant.
- Remove dead code and `console.log` debug statements, and don't shadow variable names in templates or loops.
