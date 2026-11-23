# VROOM UI Design Guide — "human-ready, not junk"

This is the one guide for how VROOM looks and behaves. Every UI rule lives here; when a rule
and a screen disagree, the screen is wrong. `DesignSystem.md` is the companion *inventory*:
which components and tokens exist and how to import them. This doc says how to use them and
what a reviewer blocks on.

CI runs type-check, lint, the unit suite, a build, and the Chromium e2e project with axe. All of
that proves a page **compiles** — none of it proves quality. A page can be green and still be
ugly, unusable on a phone, inaccessible, or missing the states a real user hits. Treat this guide
as blocking, the same way you treat a failing test.

## The guiding philosophy

> **A calm ledger for your car. The numbers are the hero, the chrome stays quiet, and every
> theme is the same app.**

VROOM answers "what does this car really cost me?", often on a phone in a parking lot. Each
screen should let someone glance, trust the number, and act with one thumb.

## Core principles

1. **Numbers first.** Money, distance and dates are the content. Give them weight
   (`font-semibold`/`font-bold`, right-aligned in lists) and give labels the muted voice. Never
   decorate a number until it is hard to read.
2. **Quiet chrome.** One primary action per view. Everything else is `outline`, `ghost` or a
   link. Borders and muted surfaces separate content; heavy shadows, gradients and colour
   blocks do not.
3. **Phone first, desktop wider.** Design at 375px, then let the layout breathe. A desktop-only
   affordance (hover, wide tables) always has a mobile equivalent.
4. **Tokens, not colours.** A screen is painted only with theme tokens, so all 11 theme families
   in light and dark work without a second thought. If it only looks right in Default light, it
   is not done.
5. **Every state is designed.** Loading, empty, error and populated are four screens, not one,
   and every action gives success feedback.
   The empty state is where a new user decides whether the app is worth it.
6. **Compose, don't reinvent.** Use the kit. A new pattern goes into the kit and `/dev/gallery`
   first, then into the route.
7. **Accessible by construction.** Real labels, real buttons, real focus. axe clean is the floor.

## Layout and spacing

Tailwind's 4px scale is the only spacing scale. Match the neighbours; don't invent values.

| Use | Value |
|---|---|
| Between page sections | `space-y-6` |
| Inside a card / between form fields | `space-y-4` (dense groups `space-y-2`) |
| Inline groups (icon + text, button rows) | `gap-2` / `gap-3` |
| Grids of cards or stat tiles | `gap-4` (`gap-6` at `lg:` when cards are large) |
| App shell page padding | `px-4 sm:px-6 lg:px-8 py-6` |
| Card padding | from the primitive (`py-6` on Root, `px-6` on Header/Content); override only for dense tiles (`StatCard`: `p-4 sm:p-6`) |

- **Page width.** Forms use `FormLayout` (centred, `max-w-2xl`). List, detail and dashboard
  pages are full-width inside the app shell.
- **Breakpoints** are Tailwind defaults: `sm` 640, `md` 768, `lg` 1024. Navigation switches from
  the mobile top bar + menu to the desktop rail at `lg`. Write the base (mobile) classes first
  and add `sm:`/`lg:` overrides — never the reverse.
- **Grids collapse.** Stat tiles are 2-up on mobile and up to 4-up at `lg` (`StatCardGrid`).
  Side-by-side cards stack below `lg`.
- **Radius** comes from `--radius` (`rounded-md` controls, `rounded-lg`/`rounded-xl` cards).
  `rounded-full` is for avatars, pills, carousel arrows and the FAB only.
- **Reserve space** for anything that arrives late (badges, charts, counts) so nothing jumps.
- **No photo, no image area.** With no photo, a card shows no image area; a placeholder band is
  decoration.
- **Four screens at 375.** A page or tab fits in about four phone screens. Lead with the
  numbers people come for, then group secondary content behind a disclosure that is closed
  below `lg` (Analytics → Fuel & Stats uses `ChartGroup`), or move it to its own tab.

## Typography

VROOM uses the system font stack (no web fonts), so it is fast offline. Hierarchy comes from
size and weight, not from new families or colours.

| Role | Classes |
|---|---|
| Page title (`<h1>`, via `PageHeader`) | `text-3xl font-bold tracking-tight` |
| Page description | `text-muted-foreground` (base size) |
| Card title | `Card.Title` as-is (base size, `font-semibold`) |
| Section title outside a card | `text-lg font-semibold` |
| Body, form labels, table cells | `text-sm` |
| Meta, captions, helper text | `text-xs text-muted-foreground` |
| Key figure (stat tile, total) | `text-2xl font-bold` (`text-xl` in dense lists) |

- One `<h1>` per page, rendered by `PageHeader`. Don't hand-roll one, and don't put an icon in
  it — icons belong on cards and nav, not the page title.
- Headings go in order (`h1` → `h2` → `h3`); pick the level by structure, the size by the table.
- Nothing smaller than `text-xs`, and nothing a user must act on at `text-xs`.
- Numbers in columns use `tabular-nums` so they line up.

## Colour and theme tokens

VROOM ships 11 theme families, each with a light and a dark variant. Their ids (used by the
`themePreference` setting) are `default`, `blueprint`, `bento`, `vaporwave`, `cyberpunk`,
`aurora`, `solarpunk`, `editorial`, `tui` (labelled Terminal), `y2k` and `neobrutalist`. The
token table and the role of each token live in `DesignSystem.md` → *Design tokens*.

- **Only tokens.** `bg-*`/`text-*`/`border-*` from the token set. No hex, `rgb()`, `gray-*`,
  `white`, `black` or other palette classes in components or `app.css`.
  `no-theme-clashing-colors.test.ts` catches `bg-`/`text-`/`border-` palette classes in `.svelte`
  files and `rgb()`/`hsl()`/hex literals in `app.css`; reviewers catch the rest (other prefixes
  such as `ring-`/`fill-`/`from-`, arbitrary values like `bg-[#fff]`, classes built in a `.ts`
  file, named CSS colours).
- **Contrast is WCAG 2.1 AA in every theme and both modes.** Text ≥ 4.5:1 against its surface;
  large text (≥ 24px, or ≥ 18.66px bold) and meaningful non-text UI (icons that carry meaning,
  input borders, focus rings) ≥ 3:1.
- **Know what is gated.** `theme/__tests__/theme-contrast.test.ts` gates, in every theme and
  both modes: the text pairs at 4.5:1 (foreground/background pairs plus `primary`,
  `destructive`, `success`, `warning` and `chart-5` on their surfaces); `text-primary`,
  `text-warning` and `text-chart-5` on their own `/10` tint over `background` and `card` at
  4.5:1; and `chart-1`…`chart-8` on `card`, and as an icon on their own `/10` tint, at 3:1. axe
  in e2e checks text contrast on real pages, not non-text contrast. Nothing gates `border`,
  `input` or `ring` yet, so the reviewer checks those by hand: `border`/`input` are below 3:1 in
  nearly every theme, and `ring` is below 3:1 in Default light. So a border alone never marks a
  control or its state, and a focus ring keeps its 3px width.
- **Opacity eats contrast.** `text-foreground/60`, primary text on a `bg-primary/10` tint, and
  `text-muted-foreground/70` are the usual ways a screen fails AA. Use text tokens as-is.
- **Status colours mean status.** `text-destructive` for errors and deletes, `text-warning` for
  "needs attention", `text-success` for "all good". Pair each with an icon or a word — colour is
  never the only signal.
- **Chart colours are for marks and icons.** `chart-1`…`chart-8` are gated at 3:1; never use them
  for new text. Existing screens still colour words with two of them: `text-chart-5` (banners,
  notes and a heading across odometer, insurance, settings and the expense form) and
  `text-chart-2` (the payment planner, fuel stats) are both gated as text at 4.5:1. Prefer
  `text-warning` / `text-success`.
  Category colours come from `getCategoryChartColor` (`utils/chart-colors`) and
  `getCategoryBadgeClasses` (`utils/expense-helpers`), so a category is the same colour in every
  chart and badge.
- **A theme is a palette, not a layout.** Theme work changes tokens only. A component never
  branches on the theme id.

## Components

The inventory and import paths are in `DesignSystem.md`. The usage rules:

### Buttons
- **One primary (`default`) button per view or dialog.** Secondary actions are `outline`;
  tertiary and toolbar actions are `ghost`; actions that navigate use `href`.
- `destructive` is for the final confirm of a delete inside `ConfirmDialog` — not for the button
  that opens it.
- Mobile primary actions are `size="lg"` (40px) or full-width. On list pages the mobile primary
  action is the `FloatingActionButton`; don't repeat the same action in the header on mobile.
- The FAB is the mobile primary action only. At `lg` and up, the same action is the primary
  button in `PageHeader` (`class="hidden lg:inline-flex"`). From `lg` up nothing fixed covers page
  content at rest: form action bars are sticky below `lg` (with bottom padding to clear them) and a
  normal row at the end of the form from `lg`. A tab with its own primary action hides the page FAB.
- Icon-only buttons are `size="icon"` or larger and always have an `aria-label`. On touch layouts
  use `icon-lg` or pad the hit area to 40px.
- Labels are verbs in Title Case: "Add Expense", "Log Fill-up", "Import CSV". While a mutation is
  in flight the button is disabled and shows a spinner. That rule is for submits.
- A Retry button that reloads data or re-sends queued work stays focusable while it runs: use
  `aria-disabled` with a spinner, and ignore a second press in its handler. A `disabled` button
  drops keyboard focus to the page.

### Forms
- Wrap form pages in `FormLayout`. One column on mobile; two columns only for short paired fields
  (date + amount) at `sm:` and up.
- Every field has a visible `Label for=`. Required fields carry ` *`; optional fields say
  "(Optional)".
- Validation errors render under the field with `FormFieldError`, wired by `aria-describedby`
  and `aria-invalid`. Validate on submit and on blur, not on every keystroke.
- After a failed submit, move focus to the first invalid field in DOM order, so keyboard and
  screen-reader users land on what needs fixing instead of staying on Save. Focusing the field
  is enough: its wired error is announced with it. Move focus after the errors have rendered,
  to the element that carries `aria-invalid` and `aria-describedby` (the trigger, for `Select`
  and `DatePicker`). New forms do this; existing forms adopt it form by form, and a PR that
  changes a form for another reason isn't blocked on it.
- Use the right control: `DatePicker` for dates, `Select` for a short fixed list, a tile grid for
  a handful of illustrated choices (expense category), `Switch` for settings that apply
  instantly, `Checkbox` for choices saved with a form.
- Inputs set `inputmode`/`type` so phones show the right keyboard (`decimal` for money and
  volume, `numeric` for odometer).
- Long forms keep Save/Cancel reachable (a sticky bar at the bottom on mobile), and that bar
  never covers the last field: pad the form by the bar's height.
- **One save model per page.** Settings that apply instantly need no Save button; when a page
  needs one, it shows only while something is unsaved and is never fixed from `lg` up.

### Cards
- A card is one topic: title, optional description, content, optional footer action.
- Nest cards at most one level deep.
- A clickable card is a real link (an `<a>` on the title or a stretched link), never
  `role="button"` on a container that holds other buttons — see `VehicleCarousel`.

### Charts
- Always through `AppLineChart`/`AppBarChart`/`AppPieChart`/`AppAreaChart` or `ChartCard`, so
  loading, empty and error are handled.
- Every chart has a title, a one-line description of what it shows, axis values formatted by
  `utils/formatters` (currency, units), and a legend or direct labels when there is more than one
  series.
- A chart is never the only way to read a number: pair it with a stat tile, a legend with values
  (as the category pie does), or a table.
- On mobile, charts are full width with few enough x-axis ticks to stay legible; no horizontal
  scrolling.

### Dialogs, sheets and toasts
- `Dialog` for short focused tasks; anything longer than one phone screen becomes a page.
- Destructive confirms use `common/ConfirmDialog.svelte`, which names what will be deleted and
  its cascade. Native `confirm()`/`alert()` are banned (`no-native-dialogs.test.ts`).
- Dialogs trap focus, close on Escape, return focus to the trigger, and have a visible title.
- Toasts (`appStore.addNotification`) confirm an action or report a failure. They are never the
  only place important information appears, and an error toast says what to do next.

## States

Every view that loads or mutates data handles all of these:

1. **Loading** — a `Skeleton` shaped like the content (or a spinner inside the control that
   triggered the work). Never a blank flash or a layout that jumps when data arrives.
2. **Empty** — `EmptyState` (`#lib/components/common/empty-state.svelte`) with an icon, a
   sentence-case title that says what's missing, one line on why it matters, and the primary
   action that fills it. NOT a bare "No data". `/reminders` is the reference.
   With no vehicles, every page whose content needs one shows the no-vehicle `EmptyState` with
   Add Vehicle as its action (`/trips` is the reference). Don't render zero-value stat tiles,
   filters or charts over no data. While an empty state shows its action, the page shows no second
   button for the same action under another label.
3. **Error** — a visible, recoverable message, never a silent `catch {}` that leaves the user on
   a spinner. `handleErrorWithNotification` is the shared path: it toasts via
   `appStore.addNotification` and logs to console only under `import.meta.env.DEV`. Where the view
   can retry, show a Retry button in place of the content.
   A load failure is shown once, where the content would be: the inline error with Retry. Don't
   also toast it; log it with `logLoadFailure`. Toasts are for the result of an action the user
   took and for background work with no place on screen.
   That inline error is `common/LoadErrorCard.svelte` (`compact` inside dialogs and cards): it owns
   the alert role, the busy Retry and where focus goes after a retry. Don't hand-write a
   `CircleAlert` + Retry block; `load-error-card-adoption.test.ts` guards this.
4. **Populated** — the happy path, including edge sizes: one item, many items, long names, large
   amounts, zero amounts.
5. **Success** — every mutation gives feedback: a success toast or a visible change (the row
   appears, the value updates). A click that does nothing visible reads as broken.

Partial data counts too: a vehicle with expenses but no fill-up volumes must say what is missing
on the fuel views, not show an empty chart. If a PR adds a data view and you can't point to every
state, it's not done.

## Motion

Motion explains a change; it never decorates.

- Durations: `duration-200` for hover, press and colour; `duration-300` for panels, sheets and
  accordions. Nothing over 500ms except chart entry.
- Animate colour, opacity and transform (`transition-colors`, `transition-opacity`,
  `transition-transform`). New code avoids `transition-all`, which also animates layout.
- No motion on page load beyond chart entry and the skeleton pulse. No looping animation outside
  a loading state.
- **Respect reduced motion.** New animation is wrapped in `motion-safe:` (or switched off with
  `motion-reduce:`); anything that moves more than a few pixels has a no-motion path.
- Hover effects are enhancements: nothing is reachable only on hover, and scale-on-hover is
  desktop-only (`sm:hover:`).

## Accessibility

Target: **WCAG 2.1 AA**, axe clean at `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`.

`e2e/pwa.spec.ts` (`A11Y_ROUTES`) runs `@axe-core/playwright` over every route it lists, and
`e2e/expenses-a11y.spec.ts` covers the expense table's interactive states. It is a ratchet, not a
gate: each route carries a list of rule ids it already violates (all currently empty) and fails
only on an id not on its list. A new route gets an `A11Y_ROUTES` entry. Everything else is yours to
verify by hand:

- **Names.** Every interactive control has an accessible name (visible `<label for>`,
  `aria-label`, or text content). Icon-only buttons MUST have `aria-label` (see profile's
  `aria-label="Edit display name"`). When a control has visible text, its `aria-label` must
  start with that text (axe `label-content-name-mismatch`), or drop the `aria-label`. `Select`
  triggers need a name too.
- **Forms.** Associated `<Label for>`; error text wired via `aria-describedby` + `aria-invalid`
  (use `FormFieldError`).
- **Never nest interactive elements.** A row or card that is itself `role="button"` + `onclick`
  while containing Edit/Delete buttons is a `nested-interactive` violation. Make the container
  non-interactive and a real link the navigation target — the pattern `VehicleCarousel` uses.
- **Keyboard.** Every action is reachable and operable by keyboard in a sensible order. Enter
  submits, Escape cancels inline editors and closes dialogs. A text field with a suggestion list
  is a combobox (`TagInput`, `ExpenseTagFilter`): the field is the only tab stop, the options are
  `tabindex="-1"`, Arrow keys move through them, Enter picks the active one, Escape closes the
  list, and Tab moves on to the next control. Close the list on `focusout` to outside the field,
  never on a timer, so focus is never left on a removed element.
- **Focus.** Never remove outlines. Primitives show `focus-visible:ring-[3px]` in `ring-ring/50`;
  a custom control shows the same ring. Focus moves into a dialog on open and back on close, and
  after a failed submit it moves to the first invalid field (see *Forms*).
- **Colour is never the only signal** — see *Colour and theme tokens* for contrast.
- **Semantics.** Lists are lists, tables are `Table`, headings are headings. Updates that matter
  use one live role, never two on the same element: sync status is `role="status"`, and form
  errors are `FormFieldError`, which is `role="alert"` with no `aria-live`. The alert announces
  an error once as it appears, including errors no field points to with `aria-describedby`.
- **Zoom.** Layout survives 200% browser zoom without clipping.

## Mobile-first (this is a PWA)

VROOM installs to phones. Mobile is the primary form factor, not an afterthought.

- Design and verify at **375px wide first**, then desktop. `npm run test:e2e:mobile` runs the
  Pixel 5 + iPhone 12 projects.
- **No horizontal overflow** at 375px — not of the page, and not inside a card (watch rows that
  pair a `Select` with an icon button). Tables either scroll-x deliberately inside their card or
  collapse to cards, as the expense list does.
- **Tap targets ≥ 40×40px**, with at least 8px between neighbouring targets. `Button` default is
  h-9/36px, so mobile primary actions use `size="lg"` or full-width.
- **Thumb zone.** The primary action sits at the bottom (FAB or sticky action bar). Fixed bottom UI
  never hides content: the page has bottom padding at least the height of the bar or FAB.
- **Fixed UI leaves room for content and focus.** Below `lg`, `html` carries `scroll-padding`
  equal to the fixed header and bottom bar, so a focused control is never hidden under them. On
  short viewports (`max-height: 500px`, which includes 200%+ zoom and landscape phones), the
  header scrolls away and form action bars sit in the page flow (the `short:` variant in `app.css`).
- Respect safe areas (`app.css` defines `.safe-top` and `.safe-bottom`).
- Nothing depends on hover, tooltips or right-click; everything has a tap path.
- The first screen is useful: title, the key number, the primary action. Secondary tools
  (import/export, filters) collapse behind a menu or disclosure on mobile.

## Copy and voice

Plain, short, friendly, specific. Write like a helpful friend who knows cars, not like a bank.

- **Case.** Page titles, card titles, buttons and nav use Title Case ("Monthly Expense Trends",
  "Add Vehicle"). Empty-state titles, descriptions, helper text, toasts and errors use sentence
  case ("Nothing due soon").
- **Verbs on buttons, nouns on titles.** A confirm button repeats the verb of its question
  ("Delete vehicle?" → "Delete").
- **Say what happened and what to do.** "Couldn't save the expense. Check your connection and try
  again." — not "Error 500" or "Something went wrong".
- **Specific empty states.** "No fuel data yet" plus how to get it, not "No data".
- **Units and money are always formatted** (`formatCurrency`, `formatDate`, the vehicle's unit
  preferences). Never hardcode "$", "mi" or "gal".
- No jargon ("entity", "record", "payload"), no exclamation marks in errors, no blame ("Enter a
  mileage above 25,000", not "You entered an invalid mileage").
- One name per concept everywhere: Vehicle, Expense, Fill-up, Reminder, Policy, Trip. A heading
  never contradicts its content (an "Active" list holds no expired items).

## Interaction quality

- **Optimistic where safe, honest where not.** Disable the submit button + show a spinner while
  a mutation is in flight (`isSubmitting`); never let a user double-submit.
- **Confirm destructive actions** with `common/ConfirmDialog.svelte`, never a bare click.
- **No layout shift** when async content or badges appear — reserve space.
- **Feedback on every action** — success toast or visible state change.

## Consistency (reuse, don't reinvent)

New screens must look like the app, not like a new app. Past the `DesignSystem.md` inventory:

- **Currency / dates** — `utils/formatters` (`formatCurrency`, `formatDate`), never inline
  `toFixed` / `toLocaleString`.
- **Routes / links** — `#lib/routes` + `resolve()`, never a hardcoded path string.
- **Page chrome** — `PageHeader` for the title, `FormLayout` for forms, `EmptyState` for empty.

## How to review a UI PR

Reviewers (human or agent) do this for every PR that changes what a user sees. Block on any
failed step; nits can be follow-up issues.

1. **Read the evidence first.** The PR body has before/after screenshots at desktop (1280px) and
   mobile (375px), in light and dark, or a GIF for anything that moves or takes more than one step
   (dialogs, wizards, transitions). No evidence means "changes requested". Evidence comes from the
   PR's own head commit running against a real or seeded backend, not from a mockup.
2. **Check the evidence against this guide**, section by section: one primary action, spacing on
   the scale, the type table, tokens only, every state, copy, mobile.
3. **Check themes.** At least Default, one high-contrast family (Terminal or Neobrutalist) and one
   saturated family (Vaporwave or Cyberpunk), each light and dark. Look for invisible text,
   low-contrast badges, and surfaces that don't change with the theme.
4. **Check the states.** Find the loading, empty and error paths in the diff and in the evidence.
5. **Check the diff** for hex/`rgb()`/palette classes, hand-rolled headings, cards, empty states
   or dialogs, icon buttons without `aria-label`, new `transition-all`, inline number or date
   formatting, hardcoded routes, and new components missing from `/dev/gallery`.
6. **Check CI.** Frontend Tests is green, which includes the axe e2e scans. A new route is in
   `A11Y_ROUTES`; a new journey has an e2e spec.
7. **Post the verdict** naming the guide section behind each finding (for example "Mobile-first:
   the split button overflows the card at 375px").

### Capturing evidence

- Run the app on `127.0.0.1` only and capture with Playwright Chromium.
- Move the mouse off the desktop rail first (it expands on hover), and scroll the page once
  before a full-page shot — charts mount when they scroll into view. Wait for chart entry
  animations to finish before the shot.
- The theme family is a user setting: set it with `PUT /api/v1/settings`
  `{"themePreference": "<family id>"}` (ids are listed under *Colour and theme tokens*; an
  unknown id renders Default) or in Settings → Theme. If the account already has a
  `themePreference`, it overwrites the `vroom-theme-id` `localStorage` key once settings load.
  Light/dark is the `vroom-theme-preference` key (`light` / `dark` / `system`).
- Before and after use the same route, viewport and data.

### Definition of human-ready (pre-merge checklist)

`.github/PULL_REQUEST_TEMPLATE.md` carries this list. A UI change is done when ALL are true:

- [ ] Evidence: before/after at 1280px and 375px, light and dark (a GIF for motion or multi-step).
- [ ] Every state handled (loading / empty / error / populated / success feedback).
- [ ] No overflow at 375px; tap targets ≥ 40px; primary action in thumb reach.
- [ ] Tokens only; AA contrast checked in Default plus two other theme families, light and dark.
- [ ] Icon-only controls have `aria-label`; forms have labels + wired errors, and a new form
      focuses the first invalid field after a failed submit (existing forms: see *Forms*); no
      nested interactive elements; keyboard and focus work.
- [ ] Reuses the kit + formatters + routes (no hardcoded colours, paths, or number formatting).
- [ ] Destructive actions confirmed; in-flight mutations disable + spinner.
- [ ] Copy follows *Copy and voice*.
- [ ] `npm run test:e2e` green locally (CI runs only the Chromium project); a new route is in
      `A11Y_ROUTES` and a new user journey has a spec in `frontend/e2e/`.
