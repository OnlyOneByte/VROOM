/// <reference lib="webworker" />
/**
 * VROOM service worker — the injectManifest entry point.
 *
 * Two jobs:
 *  1. Precache the built app shell (`precacheAndRoute` + `autoUpdate`). Under the `generateSW`
 *  strategy workbox wired this itself; `injectManifest` hands us the manifest and expects us to.
 *  2. Web Push delivery: render a notification from a pushed reminder payload and route a click to the
 *  reminders page. Delivery is browser→SW, so this adds no outbound network calls.
 *
 * There is deliberately NO `sync` (Background Sync) listener: the offline expense outbox lives in
 * localStorage, which does not exist in service-worker scope, so a `sync` handler here could not read
 * the queued writes it would need to POST. Offline expenses are delivered by the foreground sync
 * manager (an `online` listener + the manual sync control) instead. Adding a `sync` listener without
 * first moving the outbox somewhere a worker can read is a no-op.
 *
 * The push payload shape matches the backend sender: `{ title, body, tag, url }`.
 *
 * The filename is load-bearing. `service-worker.ts` is SvelteKit's reserved service-worker entry:
 * SvelteKit compiles it to `output/client/service-worker.js`, then `@vite-pwa/sveltekit`'s
 * injectManifest step reads that build output and substitutes `self.__WB_MANIFEST` with the precache
 * list. It is excluded from the app type-check program by SvelteKit's generated tsconfig, so the
 * `webworker` lib reference below does not leak into the DOM-typed app code.
 */
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

// The injectManifest build substitutes `self.__WB_MANIFEST` with the precache list. The app's tsconfig
// also loads lib.dom (which types `self` as a Window), so re-type via a cast rather than redeclaring
// `self` (which would be a block-scoped redeclare conflict).
interface PushServiceWorker extends ServiceWorkerGlobalScope {
	__WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
}
const sw = self as unknown as PushServiceWorker;

// 1. Precache the app shell + take control immediately (mirrors the generateSW autoUpdate behavior).
// workbox's injectManifest replaces the literal `self.__WB_MANIFEST` token in the BUILT output via a
// string match, so it must appear verbatim here (not via the `sw` alias) — the cast erases to plain
// `self.__WB_MANIFEST` in the emitted bundle.
precacheAndRoute((self as unknown as PushServiceWorker).__WB_MANIFEST);
sw.skipWaiting();
clientsClaim();

/** The push payload the backend sends. Every field is optional so a malformed push still notifies. */
interface PushPayload {
	title?: string;
	body?: string;
	tag?: string;
	url?: string;
}

const DEFAULT_TITLE = 'VROOM reminder';
const DEFAULT_URL = '/reminders';

/** Read the push payload defensively — a bodyless/non-JSON push yields an empty payload, not a throw. */
function readPushPayload(event: PushEvent): PushPayload {
	try {
		return (event.data?.json() as PushPayload | undefined) ?? {};
	} catch {
		return {};
	}
}

// 2a. Render a notification for each delivered push. A bodyless/non-JSON push still surfaces a generic
// notification rather than being silently dropped.
sw.addEventListener('push', (event: PushEvent) => {
	const payload = readPushPayload(event);
	const title = payload.title ?? DEFAULT_TITLE;
	const url = payload.url ?? DEFAULT_URL;
	event.waitUntil(
		sw.registration.showNotification(title, {
			body: payload.body ?? '',
			icon: '/pwa-192x192.png',
			tag: payload.tag,
			data: { url }
		})
	);
});

// 2b. On click: focus an existing VROOM tab (and navigate it to the target), else open a new window.
sw.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const data = (event.notification.data ?? {}) as { url?: string };
	const targetUrl = data.url ?? DEFAULT_URL;
	event.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
			for (const client of clientList) {
				const windowClient = client as WindowClient;
				if ('focus' in windowClient) {
					await windowClient.focus();
					if ('navigate' in windowClient) await windowClient.navigate(targetUrl);
					return;
				}
			}
			await sw.clients.openWindow(targetUrl);
		})
	);
});
