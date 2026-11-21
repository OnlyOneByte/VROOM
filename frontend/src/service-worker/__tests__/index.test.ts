import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }));
vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn() }));

type Listener = (event: unknown) => void;

interface FakeClient {
	focus?: ReturnType<typeof vi.fn>;
	navigate?: ReturnType<typeof vi.fn>;
}

interface FakeWorker {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
	listeners: Map<string, Listener>;
	addEventListener: (type: string, listener: Listener) => void;
	skipWaiting: ReturnType<typeof vi.fn>;
	registration: { showNotification: ReturnType<typeof vi.fn> };
	clients: { matchAll: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn> };
}

const MANIFEST = [{ url: '/index.html', revision: 'abc' }];

function createWorker(clientList: FakeClient[] = []): FakeWorker {
	const listeners = new Map<string, Listener>();
	return {
		__WB_MANIFEST: MANIFEST,
		listeners,
		addEventListener: (type, listener) => {
			listeners.set(type, listener);
		},
		skipWaiting: vi.fn(),
		registration: { showNotification: vi.fn(() => Promise.resolve()) },
		clients: {
			matchAll: vi.fn(() => Promise.resolve(clientList)),
			openWindow: vi.fn(() => Promise.resolve(null))
		}
	};
}

let worker: FakeWorker;

async function loadWorker(clientList: FakeClient[] = []) {
	worker = createWorker(clientList);
	vi.stubGlobal('self', worker);
	vi.resetModules();
	await import('../index.ts');
}

function dispatchPush(data: { json: () => unknown } | null) {
	let waited: Promise<unknown> | undefined;
	worker.listeners.get('push')!({
		data,
		waitUntil: (promise: Promise<unknown>) => {
			waited = promise;
		}
	});
	return waited;
}

async function dispatchClick(data: unknown) {
	const close = vi.fn();
	let waited: Promise<unknown> | undefined;
	worker.listeners.get('notificationclick')!({
		notification: { data, close },
		waitUntil: (promise: Promise<unknown>) => {
			waited = promise;
		}
	});
	await waited;
	return close;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('service worker install', () => {
	beforeEach(async () => {
		await loadWorker();
	});

	test('precaches the injected manifest and takes control immediately', () => {
		expect(precacheAndRoute).toHaveBeenCalledWith(MANIFEST);
		expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
		expect(clientsClaim).toHaveBeenCalledTimes(1);
	});

	test('registers push and notificationclick listeners and no sync listener', () => {
		expect([...worker.listeners.keys()].sort()).toEqual(['notificationclick', 'push']);
	});
});

describe('push', () => {
	beforeEach(async () => {
		await loadWorker();
	});

	test('shows the payload title, body and tag and carries the url for the click', async () => {
		await dispatchPush({
			json: () => ({ title: 'Oil change', body: 'Due tomorrow', tag: 'r-1', url: '/reminders/r-1' })
		});
		expect(worker.registration.showNotification).toHaveBeenCalledWith('Oil change', {
			body: 'Due tomorrow',
			icon: '/pwa-192x192.png',
			tag: 'r-1',
			data: { url: '/reminders/r-1' }
		});
	});

	test('an empty payload falls back to the default title, empty body and reminders url', async () => {
		await dispatchPush({ json: () => ({}) });
		expect(worker.registration.showNotification).toHaveBeenCalledWith('VROOM reminder', {
			body: '',
			icon: '/pwa-192x192.png',
			tag: undefined,
			data: { url: '/reminders' }
		});
	});

	test('a push without data still shows the default notification', async () => {
		await dispatchPush(null);
		expect(worker.registration.showNotification).toHaveBeenCalledWith(
			'VROOM reminder',
			expect.objectContaining({ body: '', data: { url: '/reminders' } })
		);
	});

	test('a payload that json() resolves to undefined is treated as empty', async () => {
		await dispatchPush({ json: () => undefined });
		expect(worker.registration.showNotification).toHaveBeenCalledWith(
			'VROOM reminder',
			expect.objectContaining({ data: { url: '/reminders' } })
		);
	});

	test('a payload that is not valid JSON still shows the default notification', async () => {
		await dispatchPush({
			json: () => {
				throw new SyntaxError('Unexpected token');
			}
		});
		expect(worker.registration.showNotification).toHaveBeenCalledWith(
			'VROOM reminder',
			expect.objectContaining({ body: '' })
		);
	});
});

describe('notificationclick', () => {
	test('closes the notification and focuses then navigates an open window to its url', async () => {
		const client = {
			focus: vi.fn(() => Promise.resolve()),
			navigate: vi.fn(() => Promise.resolve())
		};
		await loadWorker([client]);
		const close = await dispatchClick({ url: '/reminders/r-9' });
		expect(close).toHaveBeenCalledTimes(1);
		expect(worker.clients.matchAll).toHaveBeenCalledWith({
			type: 'window',
			includeUncontrolled: true
		});
		expect(client.focus).toHaveBeenCalledTimes(1);
		expect(client.navigate).toHaveBeenCalledWith('/reminders/r-9');
		expect(worker.clients.openWindow).not.toHaveBeenCalled();
	});

	test('focuses a window that cannot navigate without opening another', async () => {
		const client = { focus: vi.fn(() => Promise.resolve()) };
		await loadWorker([client]);
		await dispatchClick({ url: '/reminders/r-2' });
		expect(client.focus).toHaveBeenCalledTimes(1);
		expect(worker.clients.openWindow).not.toHaveBeenCalled();
	});

	test('skips clients that cannot be focused and focuses the first one that can', async () => {
		const unfocusable = {};
		const focusable = {
			focus: vi.fn(() => Promise.resolve()),
			navigate: vi.fn(() => Promise.resolve())
		};
		await loadWorker([unfocusable, focusable]);
		await dispatchClick({ url: '/reminders/r-3' });
		expect(focusable.navigate).toHaveBeenCalledWith('/reminders/r-3');
		expect(worker.clients.openWindow).not.toHaveBeenCalled();
	});

	test('opens a new window when no client can be focused', async () => {
		await loadWorker([{}]);
		await dispatchClick({ url: '/reminders/r-4' });
		expect(worker.clients.openWindow).toHaveBeenCalledWith('/reminders/r-4');
	});

	test('opens the reminders page when the notification carries no data', async () => {
		await loadWorker([]);
		await dispatchClick(null);
		expect(worker.clients.openWindow).toHaveBeenCalledWith('/reminders');
	});

	test('opens the reminders page when the notification data has no url', async () => {
		await loadWorker([]);
		await dispatchClick({});
		expect(worker.clients.openWindow).toHaveBeenCalledWith('/reminders');
	});
});
