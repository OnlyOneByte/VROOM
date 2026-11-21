/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

interface PushServiceWorker extends ServiceWorkerGlobalScope {
	__WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
}
const sw = self as unknown as PushServiceWorker;

precacheAndRoute((self as unknown as PushServiceWorker).__WB_MANIFEST);
sw.skipWaiting();
clientsClaim();

const PAGE_CACHE = 'vroom-pages';
const NETWORK_TIMEOUT_MS = 3000;
const MAX_CACHED_PAGES = 50;

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline - VROOM Car Tracker</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
main { max-width: 22rem; padding: 1.5rem; text-align: center; }
h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
p { margin: 0 0 1.5rem; line-height: 1.5; }
a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.5rem; padding: 0 1rem; margin: 0.25rem; border-radius: 0.375rem; font: inherit; }
button { border: 1px solid ButtonBorder; background: ButtonFace; color: ButtonText; }
a { color: LinkText; }
</style>
</head>
<body>
<main>
<h1>You're offline</h1>
<p>This page hasn't been opened on this device yet, so it can't load without a connection. Reconnect and try again, or go to your dashboard.</p>
<button type="button" onclick="location.reload()">Try Again</button>
<a href="/dashboard">Go to Dashboard</a>
</main>
</body>
</html>`;

function offlineResponse(): Response {
	return new Response(OFFLINE_PAGE, {
		status: 503,
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
}

function pageKey(request: Request): string {
	const url = new URL(request.url);
	url.search = '';
	url.hash = '';
	return url.href;
}

async function rememberPage(key: string, response: Response): Promise<void> {
	const cache = await caches.open(PAGE_CACHE);
	await cache.put(key, response);
	const keys = await cache.keys();
	const overflow = keys.slice(0, Math.max(0, keys.length - MAX_CACHED_PAGES));
	await Promise.all(overflow.map(entry => cache.delete(entry)));
}

function cachedPage(key: string): Promise<Response | undefined> {
	return caches.match(key, { cacheName: PAGE_CACHE }).catch(() => undefined);
}

async function networkFirstNavigation(key: string, network: Promise<Response>): Promise<Response> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cachedAfterTimeout = new Promise<Response | undefined>(resolve => {
		timer = setTimeout(() => resolve(cachedPage(key)), NETWORK_TIMEOUT_MS);
	});
	try {
		return (await Promise.race([network, cachedAfterTimeout])) ?? (await network);
	} catch {
		return (await cachedPage(key)) ?? offlineResponse();
	} finally {
		clearTimeout(timer);
	}
}

sw.addEventListener('fetch', (event: FetchEvent) => {
	if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
	const key = pageKey(event.request);
	const network = fetch(event.request);
	event.waitUntil(
		network
			.then(response => (response.ok ? rememberPage(key, response.clone()) : undefined))
			.catch(() => undefined)
	);
	event.respondWith(networkFirstNavigation(key, network));
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(caches.delete(PAGE_CACHE));
});

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

// No sync listener: the offline outbox lives in localStorage, which workers cannot read.
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
