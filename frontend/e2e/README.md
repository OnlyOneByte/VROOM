# VROOM E2E Tests

Playwright specs for the critical user journeys, mobile layout, and accessibility.
Config: `frontend/playwright.config.ts` (`testDir: ./e2e`).

## Running

```bash
npm run test:e2e              # all 5 browser projects, dev server
npm run test:e2e:chromium     # fastest single-engine run
npm run test:e2e:mobile       # Mobile Chrome + Mobile Safari
npm run test:e2e:ui           # interactive
npx playwright test --list    # enumerate without running
npx playwright test e2e/auth.spec.ts
npx playwright show-report

E2E_TARGET=preview npx playwright test   # against the production bundle
```

Prerequisites:

- `npx playwright install` once, for the browser binaries.
- Nothing else. Playwright starts the server itself (`webServer`), and on the dev target an
  already-running dev server on 5173 is reused.
- **No backend and no database.** Every `/api/v1/...` request the app makes is answered
  in-browser by `page.route` (see `support/mock-api.ts`). An endpoint the mock does not
  know about gets a 404 whose body names the path, so a newly added app request shows up
  as a readable failure instead of an `undefined` field. Nothing listens on :3001 during a
  run and nothing needs to.

A full five-engine run is 220 tests, 15 of which are skipped on the dev target (the three
build-only PWA tests, across five projects). Most individual tests land in 1-3s once the
routes are warm, but a failing test burns its 90s timeout, so a red run takes far longer
than a green one. `npm run test:e2e:chromium` is the fast inner loop.

## The two server targets

|                           | default (`vite dev`, 5173)                  | `E2E_TARGET=preview` (`vite preview`, 4173) |
| ------------------------- | ------------------------------------------- | ------------------------------------------- |
| Build step                | none                                        | full `vite build` (~17s)                    |
| Serves source             | always current                              | the bundle that ships                       |
| Service worker + manifest | **no** (`SvelteKitPWA` has no `devOptions`) | yes                                         |
| `reuseExistingServer`     | yes (locally)                               | never                                       |

The dev server is the default on its merits: no build step, it recompiles from source so a
reused server can never serve a stale bundle, and because every `/api/v1` call is mocked it
needs neither the backend nor a database. Its one real gap is the PWA surface — `vite dev`
serves no service worker and no web app manifest, so the three tests that need them
(`serves a valid web app manifest`, `registers a service worker`, `the service worker
precaches the static assets for offline use`) skip themselves with that reason and run on
the preview target instead. Both targets are green; run the preview one when you touch
`vite.config.ts`, the service worker, or the manifest.

Turning on `devOptions` would make those three pass against a DEV service worker — a
different artifact from the one that ships, i.e. green without testing the thing that
matters. That is why the preview target exists instead.

Two notes for anyone reading older revisions of this file: the claim that `npm run build`
fails inside `@vite-pwa/sveltekit` is **false** and has been removed — that break was a
dangling import from an unrelated change and `npm run build` exits 0. What actually used to
hang this suite was `webServer.port: 5173` pointed at a `vite preview` that binds 4173.

## Cold start, and why there is a globalSetup

`vite dev` compiles a route's module graph the first time it is requested, and the first
route on a cold server also pays dependency optimization — measured here at ~18s for the
first route and under 2s for every route after it. Charged to a test, that one-time cost
blows the assertion timeout and reports as a content failure ("expected the heading, saw
the loading shell"), which says nothing about the app.

So `globalSetup` (`support/warm-dev-server.ts`) walks every route the specs visit in one
browser before any test runs, using the same `mockApi` fixtures. Vite's transform cache
lives in the server, so one browser warms the expensive half for all five projects. It
prints a line you should expect to see at the top of every run:

```
[e2e] warmed 8/8 routes in 9.3s
```

Warming cannot fail the suite. A route that fails to warm is listed as `un-warmed` and
still runs its own tests, which then fail with a real assertion rather than hiding behind a
setup error — and the `chromium.launch()` itself is inside that guard too, so a missing
browser binary prints `warming skipped: …` instead of aborting the run (including for the
four projects that never use chromium).

## Harness settings, and why each one is not the default

Everything below differs from Playwright's defaults or from this file's own history. If you
change one, say so here.

| Setting          | Value                             | Why                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retries`        | 0 locally, 2 on CI                | Deliberately 0 locally: a local retry hides a flake from the only person able to reproduce it. CI retries because a red shared pipeline blocks everyone.                                                                                                                                                                              |
| `workers`        | default locally, 1 on CI          | Left at Playwright's default. The local flake described below is caused by `svelte-kit sync` force-reloading pages, not by worker oversubscription, so a cap does not help and none is pretended. CI pins to 1 for a stable shared runner.                                                                                            |
| `reporter`       | `list` + `html` (`open: 'never'`) | `open`'s default (`on-failure`) hands the terminal to a report web server and never returns, so a failing run hangs CI and any non-interactive caller. `list` is already the local default; it is named so adding `html` does not drop it.                                                                                            |
| `timeout`        | 90s (default 30s)                 | On the dev target a test that triggers a route re-compile needs room for several slow assertions, not just one.                                                                                                                                                                                                                       |
| `expect.timeout` | 20s (default 5s)                  | A route re-transforms whenever anything it imports changes on disk, and `svelte-kit sync` rewriting `.svelte-kit/generated/` is enough to trigger it. At 5s those re-compiles surface as "expected heading, saw the loading shell". Kept well under the test timeout so a genuine hang fails on the assertion that is actually stuck. |
| `webServer.url`  | not `port`                        | `url` waits on the app answering a request; `port` only waits on something holding the socket, and a dev server binds the port well before it can serve the first SSR render.                                                                                                                                                         |

## The one flake you will actually hit (dev target)

Anything that runs `svelte-kit sync` rewrites `.svelte-kit/generated/`, and `vite dev`
answers by force-reloading **every page it is currently serving**. Mid-test that surfaces as:

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
Error: page.goto: NS_ERROR_ABORT
```

No timeout absorbs it — the navigation is aborted, not slow. A concurrent `npm run check`,
`npm run validate`, `vitest`, or a second editor on the same checkout is enough to trigger
it; one observed run logged 143 reload events and lost 6 unrelated tests across four specs
and three engines, every one of which passed when its spec ran alone.

So: **do not run the typecheck/unit suites alongside `npm run test:e2e`.** If you must,
use `E2E_TARGET=preview` — a built bundle has no HMR and is immune. This is not worker
oversubscription; capping `workers` does not help.

## Specs

| File                         | Covers                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`               | landing sign-in affordance, provider list, provider-fetch failure, OAuth handoff, route protection, signed-in bounce, profile, sign-out                                                     |
| `vehicle-management.spec.ts` | empty fleet, fleet cards + per-vehicle links, financed badge, create form + validation + POST                                                                                               |
| `expense-entry.spec.ts`      | form fields, category set, validation, fuel-only fields, odometer monotonicity, create POST, offline queue + drain, list, search, category filter, delete, per-layout fields, mobile layout |
| `analytics.spec.ts`          | summary load, quick stats, fuel tab, tab switching, zero-data state, error + retry                                                                                                          |
| `pwa.spec.ts`                | install meta tags, offline badge, responsive overflow, mobile nav, axe scan, + 3 preview-only (manifest, service worker, precache)                                                          |

### Intent reconciliation against the pre-rewrite suite

The previous suite targeted routes and endpoints that do not exist (`/vehicles/:id/expenses/new`,
`/api/vehicles`), so every spec in it failed or was vacuous. Rewriting it against the real
app moved some intents and dropped others; this is the full accounting.

Preserved, same intent, real selectors: PWA manifest, service worker, meta tags, app icons,
offline indicator, offline expense entry, offline→online sync, mobile responsiveness, mobile
navigation, touch-target sizes, tablet layout, expense form display, required-field
validation, fuel expense create, category set offered, fuel-only fields, expense list,
category filter, expense delete, mobile form + numeric keyboards + touch targets, all six
auth intents, all four analytics intents, and five of the seven vehicle intents.

Changed on purpose:

- _"add a fuel expense with MPG calculation"_ asserted only a success toast — it never
  checked an MPG figure. The replacement asserts the POST body's backend field names
  (`expenseAmount`, `volume`, `mileage`) and the redirect, which is the contract that was
  actually broken.
- _"display expense categories correctly"_ looked for an `insurance` option in a `<select>`.
  The app has a button grid and no `insurance` category (insurance is logged under
  Financial), so the assertion now covers the six categories the app really offers.
- _"display vehicle list with summary statistics"_ asserted only vehicle names, no
  statistics. Kept as-is, under an honest title.
- _"cache static assets for offline use"_ asserted `caches.keys().length > 0`, which any
  library's cache satisfies. The replacement requires a hashed `.js` chunk from the
  precache manifest, and runs on the preview target where a service worker actually exists.
- _"touch-friendly interactive elements"_ wrapped its only assertion in
  `if (buttonCount > 0)` on the landing page. Now asserted unconditionally against the
  expense form's primary action.

Dropped, and still missing — these are real gaps, not preserved coverage:

- _"filter vehicles by selection"_ clicked a vehicle and asserted the URL changed. The
  fleet spec asserts the link's `href` instead; the navigation itself is not driven.
- The vehicle detail page (`/vehicles/[id]`) and its finance tab. Reaching it needs fixtures
  for `/vehicles/:id/stats`, `/vehicles/:id/photos` and `/analytics/fuel-efficiency`.
- The non-fuel analytics tabs. Each lazy-loads its own bundle and its own endpoint;
  `analytics.spec.ts` asserts only that the tab selection and panel swap.
- Expense **split** delete (`/expenses/split/:groupId`). The single-row delete is covered;
  no fixture carries a `groupId`.

## Accessibility ratchet

`pwa.spec.ts` runs `@axe-core/playwright` over `/`, `/auth` and `/dashboard` with the
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tags. It is a **ratchet**: each route lists the rule
ids it currently violates, and the test fails only on an id that is NOT on that list, so
existing debt blocks nobody while a new class of violation does. The full violation JSON is
attached to the HTML report either way.

All three lists are currently **empty** — those three routes have zero violations at those
tags, so any new one fails the run. Shrink a list when you fix something; an id left behind
after the fix makes the ratchet permanently looser than the app.

## Conventions

- `mockApi(page, …)` first, then any spec-specific `page.route()` override — Playwright runs
  matching handlers in reverse registration order, so the later one wins. An override that
  only wants to OBSERVE should record and then `route.fallback()`.
- Mock bodies go through `fulfillData`/`fulfillPage`, which wrap the backend's
  `{ success, data }` envelope. `apiClient` unwraps `data`, so a bare payload silently
  makes every field `undefined`.
- Mock paths match EXACTLY, segment for segment. A `startsWith('/vehicles/')` prefix also
  swallows `/vehicles/:id/stats`, `/financing`, `/photos` and `/policies` and answers each
  with the vehicle body — an unrelated shape the caller reads `undefined` off, instead of
  the 404 naming the path that this file promises.
- Fixtures are BACKEND-shaped (`expenseAmount`, not `amount`) because
  `fromBackendExpense` renames fields on the way in. Unit values must be real
  `UnitPreferences` members (`gallons_us`, not `gallons`) or the label helpers throw.
- Semantic selectors (`getByRole`, `getByLabel`, `getByText`), not CSS. Note bits-ui
  `Select.Trigger` exposes role **button**, not `combobox`, and the delete confirmation is
  role **alertdialog**, not `dialog`. Icon-only row actions are named by their `title`
  ("Delete expense"), not by visible text.
- `ExpensesTable` picks ONE layout at runtime (`{:else if isMobile.current}`), so the other
  is absent from the DOM, not hidden. The two carry different fields — the compact row is
  category/amount/date/vehicle and deliberately drops the description — so a test that
  asserts a field only one layout renders must pin the viewport, or it passes on the three
  desktop projects and fails on the two mobile ones. Prefer `.filter({ visible: true })`
  over `.first()` regardless: the same figure can also appear in the page's summary card.
- Offline behavior is driven by dispatching the window `offline`/`online` events, which is
  the real code path (`$lib/stores/offline.svelte` listens to them) and behaves the same on
  all five engines, unlike `context.setOffline`. Dispatch inside an `expect(...).toPass()`:
  the listener is registered during hydration, which can finish after `goto` resolves.
- Reconnecting arms TWO drain paths — the `Sync N` button and `syncManager`'s 2s-delayed
  auto-sync. A test must not count POSTs exactly; assert the row reached the server, that
  every attempt carries one `clientId`, and that the outbox ends empty.
- Assert with `await expect(...)`, never `page.waitForTimeout()`.

Projects: chromium, firefox, webkit, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 12).
