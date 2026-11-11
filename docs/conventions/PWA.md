# PWA (Progressive Web App)

## Architecture

`@vite-pwa/sveltekit` owns the PWA build. There is no `static/sw.js` and no
`static/manifest.json` — both are generated.

| File | Purpose |
|---|---|
| `frontend/vite.config.ts` | `SvelteKitPWA({...})` — the `injectManifest` strategy, `registerType: 'autoUpdate'`, and the web app manifest (name, icons, `display: standalone`, theme color) as inline config |
| `frontend/src/service-worker.ts` | Service worker source — precaches the injected manifest, handles Web Push |
| `frontend/src/lib/utils/pwa.ts` | `getPlatformInfo()`, `pwaInstallState`, `initializePWA()`, `promptInstall()`, `requestBackgroundSync()` |
| `frontend/src/lib/utils/push.ts` | Web Push browser lifecycle (permission, subscribe, persist server-side) plus the pure `derivePushStatus()` state machine |
| `frontend/src/lib/utils/offline-storage.ts` | The offline expense outbox in localStorage |
| `frontend/src/lib/components/layout/PWAInstallPrompt.svelte` | Install banner |
| `frontend/src/lib/components/settings/cards/PwaInstallCard.svelte` | Settings install card, including the iOS Share → Add to Home Screen branch |
| `frontend/src/app.html` | Theme color, apple-mobile-web-app meta tags, favicon and apple-touch-icon links |

## Registration

`svelte.config.js` sets `serviceWorker.register: false` — SvelteKit must not register the
worker, because the plugin does. `+layout.svelte`'s `onMount` dynamically imports
`virtual:pwa-register` and calls `registerSW({ immediate: true })`, gated on `pwaInfo`.

The manifest `<link>` is injected from the same file's `<svelte:head>` via
`{@html webManifestLink}` (from `virtual:pwa-info`). Do NOT add a `<link rel="manifest">`
to `app.html`.

## Service worker

`src/service-worker.ts` is SvelteKit's reserved SW entry; the plugin's `injectManifest`
step substitutes `self.__WB_MANIFEST` in the built output. Two jobs:

1. **Precache** — `precacheAndRoute(self.__WB_MANIFEST)`, plus `skipWaiting()` and
   `clientsClaim()`. That is the entire caching layer: precached build assets, no runtime
   route handlers, no navigation fallback, no offline page.
2. **Web Push** — a `push` listener renders the backend's `{ title, body, tag, url }`
   payload (a bodyless or non-JSON push still surfaces a generic notification rather than
   being dropped); `notificationclick` focuses an existing tab and navigates it, else opens
   a window. Default URL `/reminders`.

When editing it:

- `self.__WB_MANIFEST` must appear **verbatim**. Workbox string-matches the built output,
  so routing it through an alias breaks the precache silently.
- There is **no `sync` listener.** `requestBackgroundSync()` registers Background Sync tags
  that nothing in the worker consumes; offline expenses sync from the page via
  `sync/sync-manager.ts`, not from the worker.
- `src/lib/utils/__tests__/sw-push-handlers.test.ts` scans this source and `vite.config.ts`
  to pin the two handlers, the precache call, the `injectManifest` wiring, and that
  `static/sw.js` stays deleted (two registered workers would collide). It runs in the unit
  suite.

## Offline writes

Offline expense creates are deduped by a `clientId` UUID in the request body — not by the
`Idempotency-Key` middleware, which backs restore. `addOfflineExpense()` mints the
`clientId`, `loadOfflineExpenses()` backfills one for pre-v3 localStorage entries, and the
backend's `expenseRepository.createIdempotent` resolves a collision against the partial
unique index on `(user_id, client_id)`.

Any new field on `OfflineExpense` must be carried through `offlineExpenseToBackend()` AND
every `addOfflineExpense()` call site (`ExpenseForm.svelte` has two — the offline-first save
and the error-fallback save). A field added to one path only vanishes on sync;
`offline-save-carries-fuel-fields.test.ts` source-scans for exactly that.

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
