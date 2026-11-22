# PWA (Progressive Web App)

## Architecture

`@vite-pwa/sveltekit` owns the PWA build. There is no `static/sw.js` and no
`static/manifest.json` — both are generated.

| File | Purpose |
|---|---|
| `frontend/vite.config.ts` | `withPwa(kitOptions, pwaOptions)` — wraps `sveltekit()` and configures the `buildSW` strategy, `registerType: 'autoUpdate'`, and the web app manifest (name, icons, `display: standalone`, theme color) as inline config |
| `frontend/src/service-worker/index.ts` | Service worker source — precaches the injected manifest, caches pages for offline navigation, handles Web Push. Type-checked by `frontend/src/service-worker/tsconfig.json` (extends `$app/tsconfig/service-worker`) |
| `frontend/src/lib/utils/pwa.ts` | `getPlatformInfo()`, `pwaInstallState`, `initializePWA()`, `promptInstall()` |
| `frontend/src/lib/utils/push.ts` | Web Push browser lifecycle (permission, subscribe, persist server-side) plus the pure `derivePushStatus()` state machine |
| `frontend/src/lib/utils/offline-storage.ts` | The offline expense outbox in localStorage |
| `frontend/src/lib/components/layout/PWAInstallPrompt.svelte` | Install banner |
| `frontend/src/lib/components/settings/cards/PwaInstallCard.svelte` | Settings install card, including the iOS Share → Add to Home Screen branch |
| `frontend/src/app.html` | Theme color, apple-mobile-web-app meta tags, favicon and apple-touch-icon links |

## Registration

`vite.config.ts` sets `serviceWorker: { register: false }` on `sveltekit()` — SvelteKit must
not register the worker, because the plugin does. `+layout.svelte`'s `onMount` dynamically
imports `virtual:pwa-register` and calls `registerSW({ immediate: true })`, gated on
`pwaInfo`.

`buildBase: '/'` and `scope: '/'` are set in the PWA options on purpose. Kit's default
`paths.relative` makes Vite's `base` `./`, and the plugin would then register
`./service-worker.js` with scope `./`, which 404s from any nested route and scopes the
worker to that directory. Keep both pinned to the root.

The manifest `<link>` is injected from the same file's `<svelte:head>` via
`{@html webManifestLink}` (from `virtual:pwa-info`). Do NOT add a `<link rel="manifest">`
to `app.html`.

## Service worker

`src/service-worker/index.ts` is the `swSrc` of the plugin's `buildSW` step, which bundles it
and substitutes `self.__WB_MANIFEST` in the built output. `npm run type-check` compiles it
against `src/service-worker/tsconfig.json`, which the root tsconfig excludes. Three jobs:

1. **Precache** — `precacheAndRoute(self.__WB_MANIFEST)`, plus `skipWaiting()` and
   `clientsClaim()`. This covers the build assets (JS, CSS, icons), not pages.
2. **Page cache** — a `fetch` listener handles `GET` navigations network-first:
   after 3 seconds (`NETWORK_TIMEOUT_MS`) without a response it serves the copy in the
   `vroom-pages` cache if there is one, and otherwise keeps waiting for the network. Every
   successful navigation response is stored there, keyed by URL without query or hash, and the
   cache keeps the newest 50 pages (`MAX_CACHED_PAGES`). When the network request fails, the
   worker serves the cached copy, or, for a page with none, a built-in "You're offline" page
   (HTTP 503) with Try Again and Go to Dashboard. On `activate`, a new worker clears
   `vroom-pages` and warms it with `WARM_PAGES` (`/dashboard`, `/expenses`, `/expenses/new`),
   so the main pages open offline even if this worker version never served them. A warm-up
   response that redirects (for example to sign-in) is not cached.
3. **Web Push** — a `push` listener renders the backend's `{ title, body, tag, url }`
   payload (a bodyless or non-JSON push still surfaces a generic notification rather than
   being dropped); `notificationclick` focuses an existing tab and navigates it, else opens
   a window. Default URL `/reminders`.

When editing it:

- `self.__WB_MANIFEST` must appear **verbatim**. Workbox string-matches the built output,
  so routing it through an alias breaks the precache silently.
- There is **no `sync` listener**, and nothing registers Background Sync. The offline outbox
  lives in localStorage, which a worker can't read, so offline expenses sync from the page
  via `sync/sync-manager.ts`.
- The page cache holds rendered page shells only. Pages fetch their data through
  `api-client.ts` after load, so `vroom-pages` stores no user data.
- `src/lib/utils/__tests__/sw-push-handlers.test.ts` scans this source and `vite.config.ts`
  to pin the push handlers, the precache call, the `buildSW` wiring, and that
  `static/sw.js` stays deleted (two registered workers would collide).
  `src/service-worker/__tests__/index.test.ts` runs the worker's listeners: the page cache,
  the warm-up, push and notification clicks, and that no `sync` listener exists. Both
  run in the unit suite. The real worker is exercised by the preview-target E2E tests
  (`pwa.spec.ts`, `offline.spec.ts`), which CI's Frontend Tests job runs.

## Offline writes

Offline expense creates are deduped by a `clientId` UUID in the request body — not by the
`Idempotency-Key` middleware, which backs restore. `addOfflineExpense()` mints the
`clientId`, `loadOfflineExpenses()` backfills one for pre-v3 localStorage entries, and the
backend's `expenseRepository.createIdempotent` resolves a collision against the partial
unique index on `(user_id, client_id)`.

Every save path builds its outbox entry with `toOfflineExpense()`
(`components/expenses/form/offline-expense.ts`). There are three: the offline-first save and
the error-fallback save in `expense-form/expense-form-actions.ts`, which call
`addOfflineExpense()`, and the requeue below. Any new field on `OfflineExpense` must be
carried through `toOfflineExpense()` AND `offlineExpenseToBackend()`, or it vanishes on sync.
`offline-save-carries-fuel-fields.test.ts` pins that for the fuel fields.

### Parked entries: edit and requeue

`sync-manager.ts` parks an entry with `markExpenseNeedsAttention()` when the server refuses
it for good, or when a fuel entry is missing its volume/charge or mileage. A parked entry
stays in the outbox with its reason, and auto-sync skips it. The sync panel's retry
(`syncManager.retryParked()`) clears the mark on every parked entry and sends them again,
for when the cause was fixed elsewhere. To change an entry instead,
`OfflineExpenseCards.svelte` lists parked entries, and one the server never created (no
`serverId`) gets an **Edit** link to `/expenses/new?queued=<id>`, which opens the expense
form on that entry.
`saveQueuedExpense()` (`expense-form/requeue-expense.ts`) validates the form and calls
`replaceParkedExpense()`, which:

- replaces the entry in place, keeping its `id`, `clientId` and `timestamp`, so the server's
  `clientId` dedupe still applies, and clears the needs-attention mark;
- returns `not-parked` if the entry stopped being parked during the edit (a sync-panel retry
  or a sync started, or it was removed), so the edit never overwrites an entry that may
  already be on its way to the server;
- returns `failed` if localStorage or the photo store can't save it.

After a successful requeue, the form starts a sync when online, or leaves the entry for the
next auto-sync. An entry the server did create (it has a `serverId`, for example when only
its photo upload failed) can't be edited from the outbox. Edit the saved expense instead.

## Install prompt

`initializePWA()` attaches the `beforeinstallprompt` and `appinstalled` listeners and
populates `pwaInstallState` — a plain object, NOT a rune store, with `canInstall`,
`isInstalled`, `isStandalone`. `promptInstall()` replays the deferred event. Because the
object is not reactive, each component calls `initializePWA()` itself and then **polls**
`pwaInstallState` on an interval.

Chrome fires `beforeinstallprompt` only over HTTPS (or localhost), after a user
interaction, with a valid manifest and a registered worker that has a `fetch` handler
(`precacheAndRoute` provides one). iOS Safari never fires it — hence the `isIOS` branch in
`PwaInstallCard.svelte`.

## Icons

`npm run generate-pwa-assets` regenerates the whole set from `static/favicon.svg` per
`pwa-assets.config.ts` (`minimal2023Preset`): `pwa-64x64.png`, `pwa-192x192.png`,
`pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`,
`favicon.ico`. Edit the SVG and rerun rather than hand-replacing PNGs — the manifest icon
list in `vite.config.ts` and the links in `app.html` reference these exact names.
