---
inclusion: fileMatch
fileMatchPattern: "frontend/src/routes/**/*.svelte,frontend/src/lib/components/**/*.svelte,frontend/src/app.css"
---

# Design System — compose from the kit, don't invent

VROOM has a real component kit (shadcn-svelte primitives + app-level patterns). The single
biggest source of "AI-junk" UI is **reinventing** what already exists — a hand-rolled card,
an ad-hoc grey, a bespoke empty state. The rule:

> **Compose from the kit below. Do not invent a component, color, or spacing value that the
> kit already provides.** If the kit is missing something, add it to the kit (and the
> gallery) — don't one-off it in a route.

The live, rendered reference is the **component gallery** at `/dev/gallery` (dev-only). It
shows every kit component in all four states at both viewports. Read this doc for the rules;
open the gallery to see them.

## Design tokens (theme — never hardcode colors)

Defined in `frontend/src/app.css` as CSS custom properties, exposed as Tailwind tokens.
Use the Tailwind class, never a raw hex / `gray-*` / `white` / `black` (those break dark
mode + custom themes). Every value below has a light AND dark variant that swaps automatically.

| Token (Tailwind class) | Role |
|---|---|
| `bg-background` / `text-foreground` | Page base |
| `bg-card` / `text-card-foreground` | Card/panel surface |
| `bg-primary` / `text-primary-foreground` | Primary actions/emphasis |
| `bg-secondary` / `text-secondary-foreground` | Secondary surfaces |
| `bg-muted` / `text-muted-foreground` | Muted surfaces + secondary text (AA-contrast — see note) |
| `bg-accent` / `text-accent-foreground` | Hover/active surfaces |
| `bg-destructive` / `text-destructive` | Errors, delete |
| `border-border` / `border-input` / `ring-ring` | Borders, inputs, focus rings |
| `text-chart-1`…`text-chart-5` | Categorical chart colors (use `utils/chart-colors`) |

Notes:
- `--muted-foreground` is tuned to clear WCAG AA 4.5:1 on white — do NOT lighten it, and
  avoid `text-muted-foreground/40`-style opacity on real text (it drops below AA; axe flags it).
- Status surfaces: use the `Alert` component variants (`default|destructive|warning|success`)
  rather than hand-tinted divs.

## Spacing, typography, layout scale

Match neighbors; don't invent values. The conventions in this codebase:
- **Page sections**: `space-y-6`. Inline groups: `gap-2` / `gap-3`. Card padding: `p-4`/`p-6`.
- **Page width**: forms use `FormLayout` (centered, max-w-2xl). List/detail pages are full-width
  inside the app shell.
- **Headings**: page title via `PageHeader` (renders the `<h1>`). Section titles `text-lg
  font-semibold`. Don't hand-roll page `<h1>`s.
- **Mobile**: design at 393px first (see `UIQuality.md`). Tap targets ≥ 40px (Button default
  is h-9/36px → use `lg` or full-width for primary mobile actions).

## Component inventory (import paths are real — use them)

### Primitives — `$lib/components/ui/*` (barrel imports)
| Need | Import | Notes |
|---|---|---|
| Action | `import { Button } from '$lib/components/ui/button'` | variants: default/destructive/outline/secondary/ghost/link · sizes: default/sm/lg/icon/icon-sm/icon-lg · `href` for links |
| Text input | `import Input from '$lib/components/ui/input/input.svelte'` | `bind:value`, `aria-invalid` |
| Multiline | `import { Textarea } from '$lib/components/ui/textarea'` | |
| Toggle | `import { Switch } from '$lib/components/ui/switch'` / `{ Checkbox }` | `bind:checked` |
| Dropdown | `import * as Select from '$lib/components/ui/select'` | compound; `onValueChange` |
| Label | `import { Label } from '$lib/components/ui/label'` | `for=` ties to input id |
| Field error | `import { FormFieldError } from '$lib/components/ui/form-field'` | wire via `aria-describedby` |
| Card | `import * as Card from '$lib/components/ui/card'` | Root/Header/Title/Description/Content/Footer |
| Badge | `import { Badge } from '$lib/components/ui/badge'` | status/tags |
| Alert | `import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert'` | variants incl. warning/success |
| Skeleton | `import { Skeleton } from '$lib/components/ui/skeleton'` | loading placeholder |
| Tabs | `import * as Tabs from '$lib/components/ui/tabs'` | |
| Dialog / confirm | `import * as Dialog from '$lib/components/ui/dialog'` / `* as AlertDialog` | AlertDialog for destructive confirms |
| Table | `import * as Table from '$lib/components/ui/table'` | |
| Popover/Tooltip/Sheet/DropdownMenu | `import * as Popover` … | floating layers |

### App-level — `$lib/components/common/*` (direct `.svelte` imports)
| Need | Import | Props |
|---|---|---|
| Page title + actions | `common/page-header.svelte` | `title`, `description?`, `actions?` (Snippet) |
| Empty state | `common/empty-state.svelte` | `icon?`, `title`, `description`, `action?` (Snippets) |
| Pagination | `common/pagination-controls.svelte` | `currentOffset`, `pageSize`, `totalCount`, `isLoading`, `onPageChange` |
| Mobile primary action | `common/floating-action-button.svelte` | `href`/`onclick`, `label`, `ariaLabel?` |
| Date / range | `common/date-picker.svelte` · `common/date-range-picker.svelte` | `bind:value` ISO strings |
| Time period | `common/period-selector.svelte` | `selectedPeriod`, `isLoading`, `onPeriodChange` |
| Form page wrapper | `common/form-layout.svelte` | wraps form content centered |

### Charts — `$lib/components/charts` (barrel) — ALWAYS 4-state
| Need | Import | Notes |
|---|---|---|
| Any chart | `import { AppLineChart, AppBarChart, AppPieChart, AppAreaChart } from '$lib/components/charts'` | all wrap `ChartCard` → loading/empty/error handled for you |
| KPI tiles | `import { StatCard, StatCardGrid } from '$lib/components/charts'` | `iconColor` takes a token name |
| Custom chart container | `charts/ChartCard.svelte` | pass `isLoading`/`isEmpty`/`error`/`emptyTitle` — never render a raw chart in a bare div |

## The Four-States contract (cross-ref UIQuality.md)

Any data view = loading (`Skeleton`) + empty (`EmptyState`) + error (visible message) +
populated. The kit already encodes this — `ChartCard`, `StatCard`, `PaginationControls`
take `isLoading`/`isEmpty`/`error`. Use them; don't render data into a bare container that
shows a blank box before it loads.

## Formatting + routing (don't reinvent)
- Currency/dates: `utils/formatters` (`formatCurrency`, `formatDate`, `formatRelativeTime`).
  Never inline `toFixed`/`toLocaleString`.
- Routes/links: `$lib/routes` + `resolve()`. Never hardcode path strings.
- Chart colors: `utils/chart-colors` (`getCategoryColor`). Never hardcode chart hex.

## When you add a component
1. Build it under `ui/` (primitive) or `common/` (app pattern), theme-tokens only.
2. Add it to `/dev/gallery` in all relevant states.
3. Add a row here. Then use it everywhere — that's how the kit stays the source of truth.
