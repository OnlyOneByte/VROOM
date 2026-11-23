# Design System — compose from the kit, don't invent

This is the kit's inventory: tokens, components and import paths. The rules for using them —
principles, layout, typography, states, motion, accessibility, copy and the UI review
checklist — are in the UI design guide, `UIQuality.md`.

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
| `text-success` / `bg-success/10` | "All good" status text (synced, up to date) |
| `border-border` / `border-input` / `ring-ring` | Borders, inputs, focus rings |
| `text-chart-1`…`text-chart-8` | Categorical chart colors |

Notes:
- `--muted-foreground` and `--destructive` are deliberately darkened to clear WCAG AA 4.5:1
  on white/card — do NOT lighten them, and avoid `text-muted-foreground/40`-style opacity on
  real text. `theme/__tests__/theme-contrast.test.ts` gates every theme's text pairs at AA
  (`warning` included) and the chart tokens at 3:1; `border`, `input` and `ring` are not gated
  yet (see `UIQuality.md`, *Colour and theme tokens*).
- Status surfaces: use `Alert` (`default`, `destructive`, `warning` or `success`), or a
  `bg-warning/10` + `text-warning` tint, rather than a hand-tinted div. The three status variants
  paint `bg-card` with their status token as the text colour (AA-gated on `card`); `default` is
  `bg-card text-card-foreground`. All four follow the theme and dark mode. Toasts (`app.css`,
  sonner block) do the same: a `--card` surface with a `--destructive` / `--success` /
  `--warning` / `--primary` border, text, close button and progress bar; plain and loading
  toasts use `--card-foreground` text and a `--border` edge. Toast width is capped at the
  viewport minus 2rem (`ui/sonner/__tests__/toast-css.test.ts`).
- `text-chart-*` is for chart marks and icons, not words: chart tokens are gated at 3:1, on
  `card` and as an icon on their own `/10` tint over `card` and `background` (the category badges
  and `StatCard` chips). Put the label in `text-foreground` beside the tinted icon. Status text
  uses `text-success` / `text-warning` / `text-destructive`. `chart-5` and `chart-2` are
  still used for words on a few screens, so both are also gated as text at AA (`background` and
  `card`, plus `popover` for `chart-2`); new status text uses `text-warning` / `text-success`.
- In every theme and both modes these tinted text pairs are gated at AA over `background` and
  `card`: `text-primary` on `bg-primary/10` (the active nav item, chips, avatars),
  `text-warning` on `bg-warning/10` and `text-chart-5` on `bg-chart-5/10`. The axe e2e scans
  cover the `A11Y_ROUTES` pages in `e2e/pwa.spec.ts` in the default light theme, the default
  theme's dashboard in dark mode, and every other theme's dashboard in light and dark mode.
- Chart colors come from `utils/chart-colors`: series `CHART_COLORS[i % CHART_COLORS.length]`
  (8 colors), category `getCategoryChartColor` (badges use `getCategoryBadgeClasses` from
  `utils/expense-helpers`; both derive from the one `CATEGORY_COLOR_TOKENS` assignment), chart
  config `buildChartConfig`.

## Spacing, typography, layout scale

These rules live in the UI design guide, `UIQuality.md` (*Layout and spacing*, *Typography*,
*Mobile-first*), together with how to use every component below.

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
| Card | `import * as Card from '#lib/components/ui/card'` | Root/Header/Title/Description/Action/Content/Footer. `Title` takes `level?` (`2`/`3`/`4`) to render a heading; without it, it renders a `div` |
| Badge | `import { Badge } from '#lib/components/ui/badge'` | variants: default/secondary/destructive/outline |
| Alert | `import { Alert, AlertTitle, AlertDescription } from '#lib/components/ui/alert'` | `variant`: `default` / `destructive` / `warning` / `success`, all themed; `role?`: `'alert'` (default, announced at once) or `'status'` (polite, for non-urgent notices such as the restore dialog's skipped-photos note) |
| Skeleton | `import { Skeleton } from '#lib/components/ui/skeleton'` | loading placeholder |
| Tabs | `import * as Tabs from '#lib/components/ui/tabs'` | |
| Dialog | `import * as Dialog from '#lib/components/ui/dialog'` / `* as AlertDialog` | AlertDialog backs destructive confirms — prefer `common/ConfirmDialog.svelte` |
| Table | `import * as Table from '#lib/components/ui/table'` | |
| Popover/Sheet | `import * as Popover from '#lib/components/ui/popover'` / `* as Sheet` | floating layers |

### App-level — `#lib/components/common/*` (direct `.svelte` imports)
| Need | Import | Props |
|---|---|---|
| Page title + actions | `common/page-header.svelte` | `title`, `description?` (string or Snippet), `back?` (Snippet: a back button, rendered before the title), `actions?` (Snippet). The page's only `<h1>`; detail and form pages pass `back` instead of hand-rolling a title row |
| Empty state | `common/empty-state.svelte` | `icon?`, `title`, `description`, `action?` (all Snippets), `level?` (`2`/`3`/`4`, default `2`): the title's heading level. Use `3` inside a card whose `Card.Title` is the `h2` |
| Destructive confirm | `common/ConfirmDialog.svelte` | `bind:open`, `title`, `description`, `onConfirm` (may be async), `destructive?`, `confirmLabel?`, `cancelLabel?`, `children?` (a snippet under the description, for a summary of what the action affects, such as the expense a delete removes) — native `confirm()`/`alert()` are banned (`no-native-dialogs.test.ts`) |
| Pagination | `common/pagination-controls.svelte` | `currentOffset`, `pageSize`, `totalCount`, `isLoading?`, `onPageChange` |
| Mobile primary action | `common/floating-action-button.svelte` | `href`/`onclick`, `label` (the visible text is the accessible name) |
| Date | `common/date-picker.svelte` | `bind:value` — a date-only `YYYY-MM-DD` string (convert with `dateOnlyToISO` / `toDateInputValue`, never a UTC `.slice(0,10)`) |
| Date range | `common/date-range-picker.svelte` | `bind:startValue`, `bind:endValue` (same `YYYY-MM-DD` form) |
| Time period | `common/period-selector.svelte` | `selectedPeriod`, `isLoading`, `onPeriodChange` |
| Photo capture / upload | `common/MediaCaptureDialog.svelte` | `bind:open`, `onUpload`, `onClose` — camera + upload tabs |
| Form page wrapper | `common/form-layout.svelte` | wraps form content centered |
| Brand mark (logo) | `common/BrandMark.svelte` | `class?` — a themed `Car` icon, `h-6 w-6 text-primary` by default, `aria-hidden` (put the "VROOM" wordmark beside it); never the car emoji (`brand-mark.test.ts`) |

### Charts — `#lib/components/charts` (barrel) — ALWAYS 4-state
| Need | Import | Notes |
|---|---|---|
| Any chart | `import { AppLineChart, AppBarChart, AppPieChart, AppAreaChart } from '#lib/components/charts'` | all wrap `ChartCard` → loading/empty/error handled for you |
| KPI tiles | `import { StatCard, StatCardGrid } from '#lib/components/charts'` | `iconColor` (`StatCardIconColor`): `primary` · `chart-1`…`chart-8` · `destructive` · `muted`. An unknown token still falls back to the primary tint, but warns under `import.meta.env.DEV`; `category-color-label-convergence.test.ts` fails if the map stops covering a theme token |
| Custom chart container | `import ChartCard from '#lib/components/charts/ChartCard.svelte'` | not in the barrel; pass `isLoading`/`error`/`isEmpty`/`emptyTitle` — never render a raw chart in a bare div |
| Chart table, summary and keyboard | built into `AppLineChart`/`AppBarChart`/`AppAreaChart` (Chart/Table toggle, `role="img"` summary, arrow-key stepping with a live region) and `AppPieChart` (summary and stepping; its value list is the table) | name the category column with `categoryLabel` when "Month"/"Date"/"Category" is wrong; `onSelect(row, seriesKey)` fires on Enter. A custom chart builds a `ChartA11y` with `buildChartA11y` (`charts/chart-a11y.ts`), passes it to `ChartCard` as `table` and wraps its plot in `ChartPlot` |

## The Four-States contract (cross-ref UIQuality.md, *States*)

Any data view = loading (`Skeleton`) + empty (`EmptyState`) + error (visible message) +
populated, and every mutation adds success feedback. `ChartCard` encodes all four (`isLoading`/`isEmpty`/`error`); `StatCard` and
`PaginationControls` take `isLoading` only, so you still own their empty/error states.

`utils/formatters` for currency/dates and `#lib/routes` + `resolve()` for links are the other
two "don't reinvent" rules — see `UIQuality.md`.

## When you add a component
1. Build it under `ui/` (primitive) or `common/` (app pattern), theme-tokens only.
2. Add it to `/dev/gallery` in all relevant states.
3. Add a row here. Then use it everywhere — that's how the kit stays the source of truth.
