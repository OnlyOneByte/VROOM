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

	test('registers fetch, activate, push and notificationclick listeners and no sync listener', () => {
		expect([...worker.listeners.keys()].sort()).toEqual([
			'activate',
			'fetch',
			'notificationclick',
			'push'
		]);
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

const ORIGIN = 'https://vroom.test';

function createPageCache() {
	const pages = new Map<string, Response>();
	const keyOf = (entry: Request | string) => (typeof entry === 'string' ? entry : entry.url);
	const cache = {
		pages,
		put: vi.fn(async (key: string, response: Response) => {
			pages.set(keyOf(key), response);
		}),
		keys: vi.fn(async () => [...pages.keys()].map(url => new Request(url))),
		delete: vi.fn(async (entry: Request) => pages.delete(keyOf(entry)))
	};
	const storage = {
		open: vi.fn(async () => cache),
		match: vi.fn(async (key: string) => pages.get(keyOf(key))?.clone()),
		delete: vi.fn(async () => true)
	};
	return { cache, storage };
}

function navigation(path: string, mode: Request['mode'] = 'navigate') {
	return { url: `${ORIGIN}${path}`, mode, method: 'GET' } as unknown as Request;
}

function dispatchFetch(request: Request) {
	let responded: Promise<Response> | undefined;
	const extended: Promise<unknown>[] = [];
	worker.listeners.get('fetch')!({
		request,
		respondWith: (promise: Promise<Response>) => {
			responded = promise;
		},
		waitUntil: (promise: Promise<unknown>) => {
			extended.push(promise);
		}
	});
	return {
		responded,
		settled: async () => {
			const response = await responded;
			await Promise.all(extended);
			return response;
		}
	};
}

describe('navigation (network first)', () => {
	let pageCache: ReturnType<typeof createPageCache>;
	const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

	beforeEach(async () => {
		pageCache = createPageCache();
		vi.stubGlobal('caches', pageCache.storage);
		vi.stubGlobal('fetch', fetchMock);
		await loadWorker();
	});

	afterEach(() => {
		vi.useRealTimers();
		fetchMock.mockReset();
	});

	test('online, it serves the network page and caches it for later', async () => {
		fetchMock.mockResolvedValue(new Response('<p>fresh</p>', { status: 200 }));

		const response = await dispatchFetch(navigation('/expenses')).settled();

		expect(await response?.text()).toBe('<p>fresh</p>');
		expect(pageCache.cache.pages.has(`${ORIGIN}/expenses`)).toBe(true);
	});

	test('a failed page is not cached', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 502 }));

		const response = await dispatchFetch(navigation('/expenses')).settled();

		expect(response?.status).toBe(502);
		expect(pageCache.cache.pages.size).toBe(0);
	});

	test('offline, it serves the cached copy of a visited page, whatever its query string', async () => {
		pageCache.cache.pages.set(`${ORIGIN}/expenses/new`, new Response('<p>cached form</p>'));
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

		const response = await dispatchFetch(navigation('/expenses/new?vehicleId=v1')).settled();

		expect(await response?.text()).toBe('<p>cached form</p>');
	});

	test('offline on a page never visited, it serves the offline page', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

		const response = await dispatchFetch(navigation('/trips')).settled();

		expect(response?.status).toBe(503);
		expect(response?.headers.get('Content-Type')).toContain('text/html');
		const html = await response!.text();
		expect(html).toContain("You're offline");
		expect(html).toContain('href="/dashboard"');
	});

	test('a page is cached once under its path, whatever its query string', async () => {
		fetchMock.mockImplementation(async () => new Response('<p>form</p>', { status: 200 }));

		await dispatchFetch(navigation('/expenses/new?vehicleId=v1')).settled();
		await dispatchFetch(navigation('/expenses/new?vehicleId=v2')).settled();

		expect([...pageCache.cache.pages.keys()]).toEqual([`${ORIGIN}/expenses/new`]);
	});

	test('when the timeout serves the cached copy, the late network page still refreshes it', async () => {
		vi.useFakeTimers();
		pageCache.cache.pages.set(`${ORIGIN}/dashboard`, new Response('<p>old</p>'));
		let answer: (response: Response) => void = () => {};
		fetchMock.mockReturnValue(new Promise<Response>(resolve => (answer = resolve)));

		const { responded, settled } = dispatchFetch(navigation('/dashboard'));
		await vi.advanceTimersByTimeAsync(3000);
		expect(await (await responded)?.text()).toBe('<p>old</p>');
		answer(new Response('<p>new</p>', { status: 200 }));
		await settled();

		expect(await pageCache.cache.pages.get(`${ORIGIN}/dashboard`)?.text()).toBe('<p>new</p>');
	});

	test('a cache storage failure does not break pages online', async () => {
		pageCache.storage.match.mockRejectedValue(new Error('quota'));
		pageCache.storage.open.mockRejectedValue(new Error('quota'));
		fetchMock.mockResolvedValue(new Response('<p>fresh</p>', { status: 200 }));

		const response = await dispatchFetch(navigation('/expenses')).settled();

		expect(await response?.text()).toBe('<p>fresh</p>');
	});

	test('a network slower than the timeout falls back to the cached copy', async () => {
		vi.useFakeTimers();
		pageCache.cache.pages.set(`${ORIGIN}/dashboard`, new Response('<p>cached dashboard</p>'));
		fetchMock.mockReturnValue(new Promise<Response>(() => {}));

		const { responded } = dispatchFetch(navigation('/dashboard'));
		await vi.advanceTimersByTimeAsync(3000);

		expect(await (await responded)?.text()).toBe('<p>cached dashboard</p>');
	});

	test('keeps at most 50 pages, dropping the oldest', async () => {
		for (let i = 0; i < 50; i++)
			pageCache.cache.pages.set(`${ORIGIN}/vehicles/v${i}`, new Response(''));
		fetchMock.mockResolvedValue(new Response('<p>new</p>', { status: 200 }));

		await dispatchFetch(navigation('/vehicles/v50')).settled();

		expect(pageCache.cache.pages.size).toBe(50);
		expect(pageCache.cache.pages.has(`${ORIGIN}/vehicles/v0`)).toBe(false);
		expect(pageCache.cache.pages.has(`${ORIGIN}/vehicles/v50`)).toBe(true);
	});

	test('leaves requests that are not page navigations alone', () => {
		const { responded } = dispatchFetch(navigation('/api/v1/expenses', 'cors'));

		expect(responded).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('a new worker drops the pages cached by the old build', async () => {
		let waited: Promise<unknown> | undefined;
		worker.listeners.get('activate')!({
			waitUntil: (promise: Promise<unknown>) => {
				waited = promise;
			}
		});
		await waited;

		expect(pageCache.storage.delete).toHaveBeenCalledWith('vroom-pages');
	});
});
