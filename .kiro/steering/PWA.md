---
inclusion: fileMatch
fileMatchPattern: "frontend/static/sw.js,frontend/static/manifest.json,frontend/src/lib/utils/pwa.ts,frontend/src/lib/components/layout/PWAInstallPrompt.svelte,frontend/src/app.html"
---

# PWA (Progressive Web App)

## Architecture

The PWA setup spans these files:

| File | Purpose |
|---|---|
| `frontend/static/manifest.json` | Web app manifest — name, icons, display mode, theme color |
| `frontend/static/sw.js` | Service worker — fetch handler, background sync for offline expenses |
| `frontend/src/lib/utils/pwa.ts` | PWA utilities — install prompt capture, service worker registration, background sync API |
| `frontend/src/lib/components/layout/PWAInstallPrompt.svelte` | Install banner UI — shown when `beforeinstallprompt` fires |
| `frontend/src/app.html` | `<link rel="manifest">`, apple-mobile-web-app meta tags |

## Install Prompt Requirements

Chrome fires `beforeinstallprompt` only when ALL of these are true:

1. Valid `manifest.json` linked via `<link rel="manifest">` in `app.html`
2. Manifest has `name`, `start_url`, `display` (standalone/fullscreen/minimal-ui), and `icons` with at least a 192px and 512px PNG
3. Service worker registered with a `fetch` event handler (even a passthrough counts)
4. Site served over HTTPS (or localhost for dev)
5. User has interacted with the page

iOS Safari does not support `beforeinstallprompt`. Users must use Share → "Add to Home Screen". The manifest and apple meta tags ensure the app launches in standalone mode.

## Service Worker (`sw.js`)

- Located in `frontend/static/` so it's served at the root scope (`/sw.js`)
- Uses a network-first strategy for navigation requests with an offline fallback
- Non-navigation requests pass through to the network (no caching layer yet)
- Handles `sync` events for offline expense syncing via the Background Sync API
- Registered in `+layout.svelte` via `registerServiceWorker()` from `pwa.ts`

### Adding Caching

If adding a cache strategy later, update the `fetch` handler in `sw.js`. Use cache-first for static assets and network-first for API calls. Bump `CACHE_NAME` version when changing cache behavior so old caches get cleaned up in the `activate` handler.

## PWA Install State (`pwa.ts`)

`pwaInstallState` is a plain object (not a Svelte store) with three flags:

- `canInstall` — `true` after `beforeinstallprompt` fires and before the user installs
- `isInstalled` — `true` after `appinstalled` fires or if already in standalone mode
- `isStandalone` — `true` if running in standalone display mode

`initializePWA()` sets up the event listeners. `promptInstall()` triggers the deferred prompt. Both are called from `PWAInstallPrompt.svelte`.

## Icons

| File | Size | Purpose |
|---|---|---|
| `frontend/static/icon-192.png` | 192×192 | Manifest icon, apple-touch-icon |
| `frontend/static/icon-512.png` | 512×512 | Manifest icon, splash screen |
| `frontend/static/icon-512-maskable.png` | 512×512 | Maskable icon for adaptive icon shapes on Android |
| `frontend/static/favicon.svg` | SVG | Browser tab favicon |

When updating the app icon, regenerate all three PNG sizes. The maskable icon should have safe-zone padding (inner 80% circle contains the logo).

## Manifest Changes

After editing `manifest.json`, users need to:

1. Unregister the old service worker (DevTools → Application → Service Workers → Unregister)
2. Clear site data or hard refresh
3. Revisit the page — the new manifest will be picked up

In development, Chrome DevTools → Application → Manifest shows validation errors if the manifest is misconfigured.
