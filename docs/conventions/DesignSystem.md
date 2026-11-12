# Design System — compose from the kit, don't invent

VROOM has a real component kit (shadcn-svelte primitives + app-level patterns). The single
biggest source of "AI-junk" UI is **reinventing** what already exists — a hand-rolled card,
an ad-hoc grey, a bespoke empty state. The rule:

> **Compose from the kit below. Do not invent a component, color, or spacing value that the
> kit already provides.** If the kit is missing something, add it to the kit (and the
> gallery) — don't one-off it in a route.

The live, rendered reference is the **component gallery** at `/dev/gallery` (gated on `dev`
from `$app/env`; a prod build renders a "dev-only" notice). It shows buttons, badges,
alerts, a wired form field, the four states, StatCards and ChartCard.

## Design tokens (theme — never hardcode colors)

`frontend/src/app.css` defines the default palette as CSS custom properties exposed as
Tailwind v4 `@theme inline` tokens; `theme/theme-registry.ts` redeclares the same set per
built-in theme (emitted to the generated `theme/themes.css`). A token is therefore the only
way to paint something that survives a theme switch: use the Tailwind class, never a raw hex
/ `gray-*` / `white` / `black` — `no-theme-clashing-colors.test.ts` fails the suite on a bare
palette class. Every token has a light and a dark variant.

| Token (Tailwind class) | Role |
|---|---|
| `bg-background` / `text-foreground` | Page base |
| `bg-card` / `text-card-foreground` | Card/panel surface |
| `bg-primary` / `text-primary-foreground` | Primary actions/emphasis |
| `bg-secondary` / `text-secondary-foreground` | Secondary surfaces |
| `bg-muted` / `text-muted-foreground` | Muted surfaces + secondary text (AA-contrast — see note) |
| `bg-accent` / `text-accent-foreground` | Hover/active surfaces |
| `bg-destructive` / `text-destructive` | Errors, delete |
| `text-warning` / `bg-warning/10` | "Attention" / due-now cues (reminders, offline state) |
| `border-border` / `border-input` / `ring-ring` | Borders, inputs, focus rings |
| `text-chart-1`…`text-chart-8` | Categorical chart colors |

Notes:
- `--muted-foreground` and `--destructive` are deliberately darkened to clear WCAG AA 4.5:1
  on white/card — do NOT lighten them, and avoid `text-muted-foreground/40`-style opacity on
  real text. `theme/__tests__/theme-contrast.test.ts` gates every theme's token pairs at AA.
- Status surfaces: use `Alert` with `default` or `destructive`, or a `bg-warning/10` +
  `text-warning` tint, rather than a hand-tinted div. Do NOT reach for `Alert`'s `warning` or
  `success` variants yet — both hardcode palette classes (`bg-yellow-50 border-yellow-200
  text-yellow-800`, and the green equivalent) in `ui/alert/alert.svelte`, so they ignore the theme
  and dark mode. `no-theme-clashing-colors.test.ts` does not catch them (its regex covers only
  white/black/gray/slate/zinc/neutral); `/dev/gallery` renders all four if you want to see the gap.
  There is no `--success` token today, so a success surface needs one added before it can be themed.
- Chart colors come from `utils/chart-colors`: series `CHART_COLORS[i % CHART_COLORS.length]`
  (8 colors), category `getCategoryChartColor` (badges use `getCategoryBadgeClasses` from
  `utils/expense-helpers`; both derive from the one `CATEGORY_COLOR_TOKENS` assignment), chart
  config `buildChartConfig`.

## Spacing, typography, layout scale

Match neighbors; don't invent values. The conventions in this codebase:
- **Page sections**: `space-y-6`. Inline groups: `gap-2` / `gap-3`.
- **Card padding** comes from the primitive (`py-6` on Root, `px-6` on Header/Content);
  override only for dense tiles (`StatCard` uses `p-4 sm:p-6`).
- **Page width**: forms use `FormLayout` (centered, `max-w-2xl`). List/detail pages are
  full-width inside the app shell (`px-4 sm:px-6 lg:px-8 py-6`).
- **Headings**: page title via `PageHeader` (renders the `<h1>`). Section titles `text-lg
  font-semibold`. Don't hand-roll page `<h1>`s.
- **Mobile**: mobile-first (see `UIQuality.md`). Tap targets ≥ 40px — `Button` default is
  h-9/36px, so use `size="lg"` (h-10) or full-width for primary mobile actions.

## Component inventory (import paths are real — use them)

### Primitives — `#lib/components/ui/*` (barrel imports)
| Need | Import | Notes |
|---|---|---|
| Action | `import { Button } from '#lib/components/ui/button'` | variants: default/destructive/outline/secondary/ghost/link · sizes: default/sm/lg/icon/icon-sm/icon-lg · `href` renders an `<a>` |
| Text input | `import { Input } from '#lib/components/ui/input'` | `bind:value`, `aria-invalid`, `aria-describedby` |
| Multiline | `import { Textarea } from '#lib/components/ui/textarea'` | |
| Toggle | `import { Switch } from '#lib/components/ui/switch'` / `{ Checkbox }` | `bind:checked`, or `checked` + `onCheckedChange` |
| Dropdown | `import * as Select from '#lib/components/ui/select'` | compound; `Select.Root` takes `type="single"` + `onValueChange` |
| Label | `import { Label } from '#lib/components/ui/label'` | `for=` ties to input id |
| Field error | `import { FormFieldError } from '#lib/components/ui/form-field'` | renders `role="alert"`; wire via `aria-describedby` (`FormFieldDescription` for hints) |
| Card | `import * as Card from '#lib/components/ui/card'` | Root/Header/Title/Description/Action/Content/Footer |
| Badge | `import { Badge } from '#lib/components/ui/badge'` | variants: default/secondary/destructive/outline |
| Alert | `import { Alert, AlertTitle, AlertDescription } from '#lib/components/ui/alert'` | use `default` / `destructive`; the local `warning` / `success` variants hardcode palette colors — see Design tokens |
| Skeleton | `import { Skeleton } from '#lib/components/ui/skeleton'` | loading placeholder |
| Tabs | `import * as Tabs from '#lib/components/ui/tabs'` | |
| Dialog | `import * as Dialog from '#lib/components/ui/dialog'` / `* as AlertDialog` | AlertDialog backs destructive confirms — prefer `common/ConfirmDialog.svelte` |
| Table | `import * as Table from '#lib/components/ui/table'` | |
| Popover/Sheet | `import * as Popover from '#lib/components/ui/popover'` / `* as Sheet` | floating layers |

### App-level — `#lib/components/common/*` (direct `.svelte` imports)
| Need | Import | Props |
|---|---|---|
| Page title + actions | `common/page-header.svelte` | `title`, `description?`, `actions?` (Snippet) |
| Empty state | `common/empty-state.svelte` | `icon?`, `title`, `description`, `action?` (all Snippets) |
| Destructive confirm | `common/ConfirmDialog.svelte` | `bind:open`, `title`, `description`, `onConfirm` (may be async), `destructive?` — native `confirm()`/`alert()` are banned (`no-native-dialogs.test.ts`) |
| Pagination | `common/pagination-controls.svelte` | `currentOffset`, `pageSize`, `totalCount`, `isLoading?`, `onPageChange` |
| Mobile primary action | `common/floating-action-button.svelte` | `href`/`onclick`, `label`, `ariaLabel?` |
| Date | `common/date-picker.svelte` | `bind:value` — a date-only `YYYY-MM-DD` string (convert with `dateOnlyToISO` / `toDateInputValue`, never a UTC `.slice(0,10)`) |
| Date range | `common/date-range-picker.svelte` | `bind:startValue`, `bind:endValue` (same `YYYY-MM-DD` form) |
| Time period | `common/period-selector.svelte` | `selectedPeriod`, `isLoading`, `onPeriodChange` |
| Photo capture / upload | `common/MediaCaptureDialog.svelte` | `bind:open`, `onUpload`, `onClose` — camera + upload tabs |
| Form page wrapper | `common/form-layout.svelte` | wraps form content centered |

### Charts — `#lib/components/charts` (barrel) — ALWAYS 4-state
| Need | Import | Notes |
|---|---|---|
| Any chart | `import { AppLineChart, AppBarChart, AppPieChart, AppAreaChart } from '#lib/components/charts'` | all wrap `ChartCard` → loading/empty/error handled for you |
| KPI tiles | `import { StatCard, StatCardGrid } from '#lib/components/charts'` | `iconColor` (`StatCardIconColor`): `primary` · `chart-1`…`chart-8` · `destructive` · `muted`. An unknown token still falls back to the primary tint, but warns under `import.meta.env.DEV`; `category-color-label-convergence.test.ts` fails if the map stops covering a theme token |
| Custom chart container | `import ChartCard from '#lib/components/charts/ChartCard.svelte'` | not in the barrel; pass `isLoading`/`error`/`isEmpty`/`emptyTitle` — never render a raw chart in a bare div |

## The Four-States contract (cross-ref UIQuality.md)

Any data view = loading (`Skeleton`) + empty (`EmptyState`) + error (visible message) +
populated. `ChartCard` encodes all four (`isLoading`/`isEmpty`/`error`); `StatCard` and
`PaginationControls` take `isLoading` only, so you still own their empty/error states.

`utils/formatters` for currency/dates and `#lib/routes` + `resolve()` for links are the other
two "don't reinvent" rules — see `UIQuality.md`.

## When you add a component
1. Build it under `ui/` (primitive) or `common/` (app pattern), theme-tokens only.
2. Add it to `/dev/gallery` in all relevant states.
3. Add a row here. Then use it everywhere — that's how the kit stays the source of truth.
