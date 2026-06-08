// Custom service worker for VROOM Car Tracker.
//
// Offline expense sync is handled in the foreground by the app's outbox + sync
// engine (src/lib/utils/offline-storage.ts + sync/sync-manager.ts), NOT here.
// The Background Sync API is unsupported on iOS Safari and Firefox, so this SW
// only provides a network-first navigation fallback. The previously-present
// `syncOfflineExpenses`/IndexedDB helpers posted to a defunct
// `/api/vehicles/{id}/expenses` path and were never wired up; they were removed.

const CACHE_NAME = 'vroom-v1';

// Install event
self.addEventListener('install', event => {
	console.log('Service Worker installing');
	self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
	console.log('Service Worker activating');
	event.waitUntil(self.clients.claim());
});

// Fetch event — network-first strategy for navigation, passthrough for everything else
self.addEventListener('fetch', event => {
	// Only handle same-origin requests
	if (!event.request.url.startsWith(self.location.origin)) return;

	// Let navigation requests fall through to the network, with an offline fallback
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request).catch(
				() => caches.match('/') || new Response('Offline', { status: 503 })
			)
		);
		return;
	}

	// All other requests: network passthrough (no caching for now)
	return;
});
