---
inclusion: always
---

# Project Conventions

## Tech Stack

- Monorepo: `frontend/` and `backend/` directories
- Frontend: SvelteKit + Svelte 5 (runes mode), Tailwind CSS v4, shadcn-svelte v4 (bits-ui), layerchart for charts, Zod for validation, Vitest + Playwright for testing, ESLint + Prettier for linting/formatting
- Backend: Hono on Bun, Drizzle ORM with SQLite, Lucia for auth, Biome for linting/formatting

## Validation & Quality

After finishing a task, run fix then validate in each modified subfolder. Fix all errors and warnings, even pre-existing ones. Only validate subfolders you modified.

- Backend: `bun run all:fix && bun run validate`
- Frontend: `npm run all:fix && npm run validate`

The `validate` script runs linting, format checking, type checking, and tests in sequence. If any step fails, fix it before proceeding.

## Git Commands

Always use `--no-pager` immediately after `git` for commands with large output (e.g., `git --no-pager diff`).

## Output Style

- Keep task summaries to a few key bullet points. No full paragraphs.
- Do not generate documentation files unless updating README or existing docs.

## Svelte 5 Runes Mode

### State & Reactivity

- `$state(value)` for reactive state.
- `$derived(expression)` or `$derived.by(() => ...)` for computed values. Prefer `$derived` over `$state` + manual sync via `$effect`.
- `$effect(() => { ... })` for side effects. Never create empty or no-op effects that track nothing.
- `let { prop = default } = $props()` for component props.

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
- Use `resolve()` from `$app/paths` for all navigation so the app works under any base path. This satisfies the `svelte/no-navigation-without-resolve` lint rule. Patterns:
  - Static routes: `goto(resolve(routes.dashboard))`, `href={resolve(routes.dashboard)}` — import `routes` from `$lib/routes`
  - Parameterized routes: `resolve(paramRoutes.vehicle, { id: vehicleId })` — import `paramRoutes` from `$lib/routes`, use SvelteKit's built-in route params
  - Routes with query strings: separate the route from the query — `` resolve(routes.expenseNew) + `?vehicleId=${id}` `` — never put query params inside `resolve()`
  - Dynamic runtime paths (e.g., `returnTo` from URL params): use `gotoDynamic(returnTo)` from `$lib/utils/navigation` — for paths only known at runtime
  - Never hardcode route strings like `'/dashboard'` or `'/vehicles'` in components — always reference `routes.*` or `paramRoutes.*` from `$lib/routes` so route changes don't cascade

```svelte
// ❌ WRONG
$: doubled = count * 2;
<Icon class:mr-3={expanded} />

// ✅ CORRECT
let doubled = $derived(count * 2);
<Icon class="base {expanded ? 'mr-3' : ''}" />
```

## UI Components

- Use shadcn-svelte for all UI elements. Check the registry before building custom components.
- Use shadcn-svelte charts (built on layerchart) for charts. Do not use recharts.
- Use semantic color tokens (`text-foreground`, `bg-background`, `text-muted-foreground`, `border-input`) instead of hardcoded Tailwind colors (`text-gray-900`, `bg-white`).
- Use `LoaderCircle` from `@lucide/svelte` with `animate-spin` for loading spinners. No custom CSS spinners.
- Import icons from `@lucide/svelte` (the Svelte 5 package), not `lucide-svelte` (legacy Svelte 3/4 compat). The shadcn-svelte `ui/` components use `@lucide/svelte/icons/icon-name` deep imports — that's fine for upstream code, but app code should use barrel imports: `import { Car, Fuel } from '@lucide/svelte'`.
- Do not modify shadcn-svelte registry components (`$lib/components/ui/`) to fix warnings or lint issues. These are upstream-managed; diverging creates maintenance burden when updating the registry. Tolerate warnings in `ui/` components.
- All form and form-like pages (vehicle, expense, insurance, odometer, settings, profile, providers) must wrap their content in `<FormLayout>` from `$lib/components/common/form-layout.svelte`. This applies `max-w-2xl mx-auto` for consistent form width on desktop. Never use inline `max-w-*` classes on form page wrappers — use the shared component so width changes propagate everywhere.

## Frontend Architecture

### Directory Layout (`frontend/src/lib/`)

| Directory | Purpose |
|---|---|
| `components/` | Svelte components organized by domain (vehicles, expenses, analytics, etc.) and `ui/` for shadcn primitives |
| `services/` | API layer: `api-client.ts` (base), `vehicle-api.ts`, `expense-api.ts`, `settings-api.ts` |
| `stores/` | Svelte stores: `app.ts`, `auth.ts`, `offline.ts`, `settings.ts` |
| `types/` | TypeScript type definitions (main barrel: `types/index.ts`) |
| `utils/` | Shared utility functions (formatters, validation, filters, calculations) |
| `constants/` | App constants: `limits.ts`, `messages.ts`, `time-periods.ts`, `ui.ts` |
| `hooks/` | Svelte 5 reactive hooks (e.g., `is-mobile.svelte.ts`) |

### Rules

- API calls: use `apiClient` from `$lib/services/api-client.ts` or domain services (`vehicle-api`, `expense-api`, `settings-api`). Never use raw `fetch()` in components.
- Types: define in `$lib/types/`. Avoid `any`; use proper types or `unknown` with type guards.
- Utilities: reuse functions from `$lib/utils/`. Don't reimplement existing logic in components.
- Constants: keep in `$lib/constants/`.
- Stores: keep in `$lib/stores/`.

### Routes

Routes live in `frontend/src/routes/` and follow SvelteKit file-based routing: `analytics/`, `auth/`, `dashboard/`, `expenses/`, `profile/`, `settings/`, `trips/`, `vehicles/`.

## Backend Architecture

### Directory Layout (`backend/src/`)

| Directory | Purpose |
|---|---|
| `api/` | Route handlers organized by domain: auth, vehicles, expenses, financing, insurance, settings, sync |
| `db/` | Database connection, schema, migrations, seeding |
| `middleware/` | Hono middleware: auth, rate-limit, error-handler, idempotency, body-limit, activity tracking |
| `utils/` | Shared utilities: calculations, logger, validation, unit-conversions, vehicle-stats |

### Rules

- Each domain under `api/` has `routes.ts` (Hono route definitions) and `repository.ts` (data access).
- Use Biome for linting and formatting (not ESLint/Prettier). Run `bun run all:fix` which chains `lint:fix`, `format:fix`, and `check:fix`.
- Database migrations are in `backend/drizzle/`. Generate with `bun run db:generate`, push with `bun run db:push`.

## Code Hygiene

- Floating action buttons (FABs) must use `bg-foreground text-background` — never `bg-gray-900 text-white` or `!text-white` with gradient overrides.
- Pages with FABs must add `pb-24` to the main content wrapper so the FAB doesn't cover bottom content on any screen size.
- Status-indicator colors (`text-green-500`, `text-orange-500`, etc.) in utility functions must use semantic tokens (`text-chart-2`, `text-destructive`, `text-chart-5`) so they adapt to dark mode.
- Financing/payment components must use `chart-1`–`chart-5` tokens for accent colors, not raw `text-green-600`, `bg-blue-100`, etc.
- Never use `!important` overrides on shadcn `Button` — pass classes normally or use `variant` props.
- Remove dead code, unused imports, and `console.log` debug statements.
- Don't shadow variable names in templates or loops.
- Guard against `undefined` on array index access in strict TypeScript.
- Never use raw `fetch()` in stores or utils — use `apiClient` or domain API services. The only exception is `api-client.ts` itself.
- Never use `any` — use proper types from `$lib/types` or `unknown` with type guards.
- Computed values must use `$derived` / `$derived.by`, not `$state` + manual sync functions. If you find yourself calling an "apply" or "update" function inside `$effect`, it should be `$derived` instead.
- Memoization caches (`Map`-based) must have a max size to prevent memory leaks. Use LRU eviction or clear on navigation.
- Stubbed/broken API functions must not be called from UI — show a "coming soon" state instead of catching thrown errors from unimplemented endpoints.
- Use domain API services (`vehicleApi`, `expenseApi`, `settingsApi`) over raw `apiClient` calls when a service method exists. Only use `apiClient` directly for endpoints not yet covered by a domain service.
- Never access browser-only APIs (`window`, `document`, `PerformanceObserver`) at module top-level or in component functions without guards. Guard with `browser` from `$app/environment` or use lazy initialization to avoid SSR crashes. This includes `window.location` in event handlers — wrap in `if (browser)` since SvelteKit may SSR the component.
- Don't duplicate utility functions across files. Check `$lib/utils/` before adding a new helper (e.g., there should be one `debounce`, not two).
- Don't duplicate type definitions. Backend API types belong in `api-transformer.ts`; re-export from `$lib/types` if needed, don't copy them.
- Category color/label maps must stay in sync with the actual category enum (`fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`). Don't use stale category names like `insurance`, `parking`, `tolls`.
- Never use non-existent CSS classes like `btn`, `btn-primary`, or `card`. Use shadcn-svelte `Button` component and `Card` components instead. For raw container styling, use Tailwind utilities like `rounded-lg border bg-card p-6`.
- Never use `!important` (`!`) prefix on Tailwind classes applied to shadcn `Button` — use `variant` props or pass classes normally.
- Use `border-destructive` for validation error borders, not `border-red-300`.
- Guard `console.error` in production error handlers with `import.meta.env.DEV`.
- Don't use display labels (e.g., `'Fuel'`) for logic comparisons — use the raw enum/category value (e.g., `'fuel'`). Labels can drift from values and cause silent bugs.
- Don't use `$effect` to fire async data-loading functions on reactive state that `onMount` already loads. This causes duplicate API calls. Track previous values or use explicit change handlers instead.
- Never globally disable ESLint rules in `eslint.config.js` to silence warnings. If specific files need exceptions, use inline `// eslint-disable-next-line` or `// eslint-disable` comments scoped to those files. Rules like `svelte/require-each-key`, `svelte/prefer-svelte-reactivity`, and `no-useless-assignment` catch real bugs — disabling them globally hides issues across the entire codebase.
- Don't duplicate shared constants (like category label maps, photo category lists) across components. Extract to `$lib/constants/` and import.
- Use Lucide icons consistently for provider/status indicators — don't mix emoji strings with Lucide icons in the same UI.
- Every `{#each}` block must have a key expression: `{#each items as item (item.id)}`. Without a key, Svelte can't efficiently diff the list and may produce stale DOM nodes. This satisfies the `svelte/require-each-key` lint rule. For index-only arrays (e.g., skeleton placeholders), use `{#each Array(3) as _, i (i)}`.
- Use `SvelteMap`, `SvelteSet`, and `SvelteDate` from `svelte/reactivity` instead of native `Map`, `Set`, and `Date` when the instance is used in reactive contexts (`$state`, `$derived`). Native built-ins aren't reactive — mutations won't trigger re-renders. This satisfies the `svelte/prefer-svelte-reactivity` lint rule. Exception: `Map`/`Set` used purely inside `$derived.by()` computations (created and consumed in the same expression) don't need the Svelte variants since they're not mutated reactively.