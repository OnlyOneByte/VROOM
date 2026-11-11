# VROOM E2E Tests

Playwright specs for the critical user journeys, mobile layout, and accessibility.
Config: `frontend/playwright.config.ts` (`testDir: ./e2e`).

## Running

```bash
npm run test:e2e              # all five browser projects, dev server
npm run test:e2e:chromium     # one engine, the fast inner loop
npm run test:e2e:mobile       # Mobile Chrome + Mobile Safari
npm run test:e2e:ui           # interactive
npx playwright test --list    # enumerate without running
npx playwright test e2e/auth.spec.ts
npx playwright show-report

E2E_TARGET=preview npx playwright test   # against the production bundle
```

Prerequisites:

- `npx playwright install` once, for the browser binaries.
- Nothing else. Playwright starts the server itself (`webServer`). On the dev target, a dev
  server already on 5173 is reused locally.
- **No backend and no database.** Every `/api/v1/...` request the app makes is answered
  in the browser by `page.route` (see `support/mock-api.ts`). An endpoint the mock does not
  know gets a 404 whose body names the path, so a new app request shows up as a readable
  failure instead of an `undefined` field.

A failing test uses its full 90s timeout, so a red run takes much longer than a green one.

## What runs in CI

The `frontend-test` job runs `npm run test:e2e:chromium` after `npm run build`, and uploads
`playwright-report/` as an artifact (the axe violation JSON is attached there). Only Chromium
runs in CI. The five-project matrix at `workers: 1` costs roughly five times as much, for
regressions that are rarely engine-specific, so the other engines and the mobile viewports
are a local, pre-release check.

The harness is also its own type-check program. SvelteKit generates the app's `include`
list, which covers `src/` only, so `frontend/tsconfig.e2e.json` extends the app's
`tsconfig.json` and covers `e2e/` and `playwright.config.ts`. CI runs
`npx tsc -p tsconfig.e2e.json --noEmit`. Run it before pushing.

## The two server targets

|                           | default (`vite dev`, 5173)                  | `E2E_TARGET=preview` (`vite preview`, 4173) |
| ------------------------- | ------------------------------------------- | ------------------------------------------- |
| Build step                | none                                        | full `vite build` (~17s)                    |
| Serves source             | always current                              | the bundle that ships                       |
| Service worker + manifest | **no** (`SvelteKitPWA` has no `devOptions`) | yes                                         |
| `reuseExistingServer`     | yes (locally)                               | never                                       |

The dev server is the default: no build step, it recompiles from source so a reused server
can never serve a stale bundle, and it needs neither the backend nor a database. Its one gap
is the PWA surface. `vite dev` serves no service worker and no web app manifest, so the three
tests that need them (`serves a valid web app manifest`, `registers a service worker`, `the
service worker precaches the static assets for offline use`) skip with that reason on the dev
target and run on the preview target. Run the preview target when you change
`vite.config.ts`, the service worker, or the manifest.

Turning on `devOptions` would make those three pass against a dev service worker, which is a
different artifact from the one that ships. That would be green without testing what matters,
which is why the preview target exists.

## Cold start and `globalSetup`

`vite dev` compiles a route's module graph the first time it is requested, and the first route
also pays dependency optimization. Charged to a test, that one-time cost reads as a content
failure ("expected the heading, saw the loading shell").

So `globalSetup` (`support/warm-dev-server.ts`) walks every route the specs visit in one browser
before any test runs, using the same `mockApi` fixtures. It prints a summary line such as
`[e2e] warmed N/N routes in Ts`.

Warming cannot fail the suite. A route that fails to warm is listed as `un-warmed` with the
reason it failed, and still runs its own tests, which then fail with a real assertion. The
`chromium.launch()` is inside that guard too, so a missing browser binary prints
`warming skipped: …` instead of aborting the run.

## Harness settings

Everything below differs from Playwright's defaults. If you change one, update this table with
the reason.

| Setting          | Value                             | Why                                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retries`        | 0 locally, 2 on CI                | A local retry hides a flake from the only person able to reproduce it. CI retries because a red shared pipeline blocks everyone.                                                                                                                                                                                                 |
| `workers`        | default locally, 1 on CI          | Local flakes come from `svelte-kit sync` force-reloading pages, not from worker count, so a cap would not help locally. CI pins 1 for a stable shared runner.                                                                                                                                                                    |
| `reporter`       | `list` + `html` (`open: 'never'`) | `open`'s default (`on-failure`) starts a report server and never returns, which hangs CI and any non-interactive caller.                                                                                                                                                                                                         |
| `timeout`        | 90s (default 30s)                 | On the dev target, a test that triggers a route re-compile needs room for several slow assertions, not just one.                                                                                                                                                                                                                 |
| `expect.timeout` | 20s (default 5s)                  | A route re-transforms whenever anything it imports changes on disk, and `svelte-kit sync` rewriting `.svelte-kit/generated/` is enough to trigger it. At 5s those re-compiles surface as "expected heading, saw the loading shell". Kept under the test timeout so a genuine hang fails on the assertion that is actually stuck. |
| `webServer.url`  | not `port`                        | `url` waits for the app to answer a request. `port` only waits for something to hold the socket, and a dev server binds the port well before it can serve its first SSR render.                                                                                                                                                  |

## Known flake (dev target)

Anything that runs `svelte-kit sync` rewrites `.svelte-kit/generated/`, and `vite dev` answers
by force-reloading **every page it is currently serving**. Mid-test that surfaces as:

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
Error: page.goto: NS_ERROR_ABORT
```

No timeout absorbs it, because the navigation is aborted, not slow. A concurrent
`npm run check`, `npm run validate`, `vitest`, or a second editor on the same checkout is enough
to trigger it.

So **do not run the typecheck or unit suites alongside `npm run test:e2e`.** If you must, use
`E2E_TARGET=preview`: a built bundle has no HMR and is immune. Capping `workers` does not help.

## Specs

| File                         | Covers                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`               | landing sign-in affordance, provider list, provider-fetch failure, OAuth handoff, route protection, signed-in bounce, profile, sign-out                                                     |
| `vehicle-management.spec.ts` | empty fleet, fleet cards + per-vehicle links, financed badge, create form + validation + POST                                                                                               |
| `expense-entry.spec.ts`      | form fields, category set, validation, fuel-only fields, odometer monotonicity, create POST, offline queue + drain, list, search, category filter, delete, per-layout fields, mobile layout |
| `analytics.spec.ts`          | summary load, quick stats, fuel tab, tab switching, zero-data state, error + retry                                                                                                          |
| `pwa.spec.ts`                | install meta tags, offline badge, responsive overflow, mobile nav, the route and theme axe ratchets, and three preview-only tests (manifest, service worker, precache)                      |
| `expenses-a11y.spec.ts`      | the expense list's axe-clean states: split group collapsed and expanded, row actions revealed by tap, insurance-blocked delete, keyboard reach into a split row's actions                   |

### Known gaps

- Filtering vehicles by selection: the fleet spec asserts the link's `href`. The navigation
  itself is not driven.
- The vehicle detail page (`/vehicles/[id]`) and its finance tab have no spec. Reaching them
  needs fixtures for `/vehicles/:id/stats`, `/vehicles/:id/photos` and `/analytics/fuel-efficiency`.
- The non-fuel analytics tabs. Each lazy-loads its own bundle and endpoint. `analytics.spec.ts`
  covers only the tab selection and the panel swap.
- Expense **split** delete (`/expenses/split/:groupId`). The single-row delete is covered, and
  `expenses-a11y.spec.ts` opens the split row's delete confirmation, but no spec asserts the
  DELETE that confirming it issues.

## Accessibility ratchet

Every scan in the suite goes through `support/axe.ts`, which pins the tag set to
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` and attaches the full violation JSON to the HTML report
whether the test passes or fails. A spec that scanned a narrower tag set would report an empty
violation list for a page that fails WCAG.

Three layers, each covering what the others cannot reach:

- **`pwa.spec.ts`, `A11Y_ROUTES`.** `/`, `/auth`, `/dashboard`, `/expenses/new`, `/vehicles/new`,
  `/analytics`, `/insurance`, `/reminders`, `/trips`, `/settings` and `/profile`, as they first
  render. Each entry carries its debt list, whether it is a signed-out surface, and a locator that
  proves its own content rendered.
- **`pwa.spec.ts`, the theme sweep.** `/dashboard` in dark mode under each non-default registry
  theme. A theme swaps the custom properties the whole app paints from, so a low-contrast palette
  fails on every route at once, which no default-palette scan can see. Chromium only: axe derives
  it from computed colour, which does not differ by engine. The theme ids come from
  `THEME_REGISTRY`, so a new theme is scanned as soon as it is added.
- **`expenses-a11y.spec.ts`.** The expense table's post-interaction states: a row's actions exist
  only after a tap, and a split group renders only when a fixture carries a `groupId`.

It is a **ratchet**. Each route lists the rule ids it currently violates, and the test fails only
on an id that is not on that list, so existing debt blocks nobody while a new class of violation
does. Every recorded debt list is currently **empty**, a zero-violation gate. Shrink a list when
you fix something: an id left behind after a fix makes the ratchet looser than the app.

Two assertions guard the ratchet against silent passes. A route whose readiness locator is generic
enough to match the app shell, or the sign-in page the auth gate redirects to, would scan the wrong
page and pass. So every route states the content that proves it rendered, and the test re-checks
`page.url()` **after** the scan. Route protection runs in an effect once `/auth/me` resolves, so
right after `goto` the URL is still the requested one whether or not the app is about to redirect.

## Conventions

- `mockApi(page, …)` first, then any spec-specific `page.route()` override. Playwright runs matching
  handlers in reverse registration order, so the later one wins. An override that only wants to
  observe should record and then call `route.fallback()`.
- Mock bodies go through `fulfillData` / `fulfillPage`, which wrap the backend's `{ success, data }`
  envelope. `apiClient` unwraps `data`, so a bare payload silently makes every field `undefined`.
- Mock paths match EXACTLY, segment for segment. A `startsWith('/vehicles/')` prefix also swallows
  `/vehicles/:id/stats`, `/financing`, `/photos` and `/policies`, and answers each with the vehicle
  body. The caller then reads an unrelated shape, instead of getting the 404 that names the path.
- Fixtures are BACKEND-shaped (`expenseAmount`, not `amount`) because `fromBackendExpense` renames
  fields on the way in. Unit values must be real `UnitPreferences` members (`gallons_us`, not
  `gallons`), or the label helpers throw.
- Semantic selectors (`getByRole`, `getByLabel`, `getByText`), not CSS. The bits-ui `Select.Trigger`
  exposes role **button**, not `combobox`, and the delete confirmation is role **alertdialog**, not
  `dialog`. Icon-only row actions are named by their `title` ("Delete expense"), not by visible text.
- `ExpensesTable` renders ONE layout at runtime (`{:else if isMobile.current}`), so the other is
  absent from the DOM, not hidden. The two carry different fields: the compact row is
  category, amount, date and vehicle, and drops the description. A test that asserts a field only
  one layout renders must pin the viewport, or it passes on the desktop projects and fails on the
  mobile ones. Prefer `.filter({ visible: true })` over `.first()` regardless, because the same
  figure can also appear in the page's summary card.
- Offline behaviour is driven by dispatching the window `offline` / `online` events. That is the
  real code path (`$lib/stores/offline.svelte` listens to them) and behaves the same on all five
  engines, unlike `context.setOffline`. Dispatch inside `expect(...).toPass()`, because the
  listener is registered during hydration, which can finish after `goto` resolves.
- Reconnecting arms TWO drain paths: the `Sync N` button and `syncManager`'s 2-second auto-sync. A
  test must not count POSTs exactly. Assert that the row reached the server, that every attempt
  carries one `clientId`, and that the outbox ends empty.
- Assert with `await expect(...)`, never `page.waitForTimeout()`.

Projects: chromium, firefox, webkit, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 12).
