/// <reference lib="webworker" />
// Must stay named service-worker.ts: SvelteKit's reserved entry, precached via injectManifest.
// Excluded from the DOM-typed app type-check, so the webworker lib reference does not leak.
// No `sync` listener: the offline outbox lives in localStorage, which workers cannot read.
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

// The app tsconfig types `self` as a Window, so the manifest is read through a cast.
// workbox replaces the literal `self.__WB_MANIFEST` token by string match; keep it verbatim.
interface PushServiceWorker extends ServiceWorkerGlobalScope {
	__WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
}
const sw = self as unknown as PushServiceWorker;

precacheAndRoute((self as unknown as PushServiceWorker).__WB_MANIFEST);
sw.skipWaiting();
clientsClaim();

// Every field is optional so a malformed push still notifies.
interface PushPayload {
	title?: string;
	body?: string;
	tag?: string;
	url?: string;
}

const DEFAULT_TITLE = 'VROOM reminder';
const DEFAULT_URL = '/reminders';

function readPushPayload(event: PushEvent): PushPayload {
	try {
		return (event.data?.json() as PushPayload | undefined) ?? {};
	} catch {
		return {};
	}
}

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
