import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const pushApiMock = vi.hoisted(() => ({
	getVapidPublicKey: vi.fn(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn()
}));

vi.mock('#lib/services/push-api.ts', () => ({ pushApi: pushApiMock }));

const {
	derivePushStatus,
	disablePush,
	enablePush,
	getExistingSubscription,
	getNotificationPermission,
	isPushSupported,
	pushStatusLabel,
	urlBase64ToUint8Array
} = await import('../push');
type PushStatus = import('../push').PushStatus;
type PushStatusInput = import('../push').PushStatusInput;

const base: PushStatusInput = {
	supported: true,
	configured: true,
	permission: 'granted',
	subscribed: false
};

describe('derivePushStatus precedence', () => {
	test('unsupported wins over everything (even a live subscription)', () => {
		expect(
			derivePushStatus({ ...base, supported: false, subscribed: true, permission: 'granted' })
		).toBe('unsupported');
	});

	test('unconfigured (503) wins over a denied/subscribed state when supported', () => {
		expect(derivePushStatus({ ...base, configured: false, permission: 'denied' })).toBe(
			'unconfigured'
		);
		expect(derivePushStatus({ ...base, configured: false, subscribed: true })).toBe('unconfigured');
	});

	test('denied wins over subscribed once supported + configured', () => {
		expect(derivePushStatus({ ...base, permission: 'denied', subscribed: true })).toBe('denied');
	});

	test('subscribed when supported + configured + not blocked + an active subscription', () => {
		expect(derivePushStatus({ ...base, permission: 'granted', subscribed: true })).toBe(
			'subscribed'
		);
	});

	test("off when supported + configured + not blocked but not yet subscribed (permission 'default')", () => {
		expect(derivePushStatus({ ...base, permission: 'default', subscribed: false })).toBe('off');
		expect(derivePushStatus({ ...base, permission: 'granted', subscribed: false })).toBe('off');
	});
});

describe('pushStatusLabel', () => {
	const statuses: PushStatus[] = [
		'unsupported',
		'unconfigured',
		'denied',
		'subscribed',
		'off',
		'error'
	];

	test('every status has a non-empty label', () => {
		for (const s of statuses) {
			expect(pushStatusLabel(s).length).toBeGreaterThan(0);
		}
	});

	test('the subscribed label does not promise scheduled delivery', () => {
		const label = pushStatusLabel('subscribed').toLowerCase();
		expect(label).toContain('reminder check');
		expect(label).not.toContain('every day');
		expect(label).not.toContain('scheduled');
	});

	test('the denied label tells the user to un-block in browser settings', () => {
		expect(pushStatusLabel('denied').toLowerCase()).toContain('blocked');
	});
});

interface FakeSubscription {
	endpoint: string;
	toJSON: () => { keys?: Record<string, string> };
	unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSubscription(endpoint = 'https://push.example/abc'): FakeSubscription {
	return {
		endpoint,
		toJSON: () => ({ keys: { p256dh: 'p-key', auth: 'a-key' } }),
		unsubscribe: vi.fn(() => Promise.resolve(true))
	};
}

function writableNavigator(): { serviceWorker: unknown } {
	return navigator as unknown as { serviceWorker: unknown };
}

function installPushEnvironment(options: {
	permission?: 'default' | 'granted' | 'denied';
	requestResult?: 'default' | 'granted' | 'denied';
	existing?: FakeSubscription | null;
	registration?: boolean;
}) {
	const notification = {
		permission: options.permission ?? 'granted',
		requestPermission: vi.fn(() => Promise.resolve(options.requestResult ?? 'granted'))
	};
	const pushManager = {
		getSubscription: vi.fn(() => Promise.resolve(options.existing ?? null)),
		subscribe: vi.fn(() => Promise.resolve(fakeSubscription('https://push.example/new')))
	};
	const registration = { pushManager };
	const serviceWorker = {
		ready: Promise.resolve(registration),
		getRegistration: vi.fn(() =>
			Promise.resolve(options.registration === false ? undefined : registration)
		)
	};
	vi.stubGlobal('Notification', notification);
	vi.stubGlobal('PushManager', class {});
	writableNavigator().serviceWorker = serviceWorker;
	return { notification, pushManager, serviceWorker };
}

describe('push browser integration', () => {
	const originalServiceWorker = navigator.serviceWorker;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		writableNavigator().serviceWorker = originalServiceWorker;
	});

	test('urlBase64ToUint8Array decodes url-safe base64 without padding', () => {
		expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
		expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
	});

	test('push is unsupported without the PushManager and Notification APIs', async () => {
		expect(isPushSupported()).toBe(false);
		expect(getNotificationPermission()).toBe('default');
		expect(await getExistingSubscription()).toBeNull();
		expect(await enablePush()).toEqual({ ok: false, reason: 'unsupported' });
	});

	test('disablePush is a no-op when push is unsupported', async () => {
		await disablePush();
		expect(pushApiMock.unsubscribe).not.toHaveBeenCalled();
	});

	test('reports support and the current permission once the APIs exist', () => {
		installPushEnvironment({ permission: 'denied' });
		expect(isPushSupported()).toBe(true);
		expect(getNotificationPermission()).toBe('denied');
	});

	test('getExistingSubscription returns null without a service worker registration', async () => {
		installPushEnvironment({ registration: false });
		expect(await getExistingSubscription()).toBeNull();
	});

	test('getExistingSubscription returns the active subscription', async () => {
		const existing = fakeSubscription();
		installPushEnvironment({ existing });
		expect(await getExistingSubscription()).toBe(existing);
	});

	test('enablePush reports denied when permission is already blocked', async () => {
		const env = installPushEnvironment({ permission: 'denied' });
		expect(await enablePush()).toEqual({ ok: false, reason: 'denied' });
		expect(env.notification.requestPermission).not.toHaveBeenCalled();
		expect(pushApiMock.getVapidPublicKey).not.toHaveBeenCalled();
	});

	test('enablePush asks for permission and stops when the user declines', async () => {
		const env = installPushEnvironment({ permission: 'default', requestResult: 'denied' });
		expect(await enablePush()).toEqual({ ok: false, reason: 'denied' });
		expect(env.notification.requestPermission).toHaveBeenCalledTimes(1);
	});

	test('enablePush subscribes with the VAPID key and registers the subscription', async () => {
		const env = installPushEnvironment({ permission: 'default', requestResult: 'granted' });
		pushApiMock.getVapidPublicKey.mockResolvedValue({ publicKey: 'AQID' });
		pushApiMock.subscribe.mockResolvedValue({ id: 'sub-1' });
		expect(await enablePush()).toEqual({ ok: true });
		const subscribeCall = env.pushManager.subscribe.mock.calls[0] as unknown as [
			{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }
		];
		expect(subscribeCall[0].userVisibleOnly).toBe(true);
		expect(Array.from(subscribeCall[0].applicationServerKey)).toEqual([1, 2, 3]);
		expect(pushApiMock.subscribe).toHaveBeenCalledWith({
			endpoint: 'https://push.example/new',
			keys: { p256dh: 'p-key', auth: 'a-key' },
			userAgent: navigator.userAgent
		});
	});

	test('enablePush reuses an existing subscription instead of subscribing again', async () => {
		const existing = fakeSubscription('https://push.example/old');
		existing.toJSON = () => ({});
		const env = installPushEnvironment({ existing });
		pushApiMock.getVapidPublicKey.mockResolvedValue({ publicKey: 'AQID' });
		pushApiMock.subscribe.mockResolvedValue({ id: 'sub-2' });
		expect(await enablePush()).toEqual({ ok: true });
		expect(env.pushManager.subscribe).not.toHaveBeenCalled();
		expect(pushApiMock.subscribe).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: 'https://push.example/old',
				keys: { p256dh: '', auth: '' }
			})
		);
	});

	test('enablePush maps PUSH_NOT_CONFIGURED to unconfigured', async () => {
		installPushEnvironment({});
		pushApiMock.getVapidPublicKey.mockRejectedValue(
			new ApiError('Not configured', 503, undefined, 'PUSH_NOT_CONFIGURED')
		);
		expect(await enablePush()).toEqual({ ok: false, reason: 'unconfigured' });
	});

	test('enablePush reports a server failure as a plain sentence, not its raw text', async () => {
		installPushEnvironment({});
		pushApiMock.getVapidPublicKey.mockResolvedValue({ publicKey: 'AQID' });
		pushApiMock.subscribe.mockRejectedValue(new ApiError('Server exploded', 500));
		expect(await enablePush()).toEqual({
			ok: false,
			reason: 'error',
			message: SERVER_FAILURE_MESSAGE
		});
	});

	test('enablePush reports a browser that blocks the subscription as denied', async () => {
		const env = installPushEnvironment({});
		pushApiMock.getVapidPublicKey.mockResolvedValue({ publicKey: 'AQID' });
		env.pushManager.subscribe.mockRejectedValue(
			new DOMException('Registration failed - permission denied', 'NotAllowedError')
		);
		expect(await enablePush()).toEqual({ ok: false, reason: 'denied' });
	});

	test('enablePush passes an API reason through', async () => {
		installPushEnvironment({});
		pushApiMock.getVapidPublicKey.mockResolvedValue({ publicKey: 'AQID' });
		pushApiMock.subscribe.mockRejectedValue(new ApiError('Endpoint must be https', 400));
		expect(await enablePush()).toEqual({
			ok: false,
			reason: 'error',
			message: 'Endpoint must be https.'
		});
	});

	test('enablePush reports a non-Error rejection with the generic sentence', async () => {
		installPushEnvironment({});
		pushApiMock.getVapidPublicKey.mockRejectedValue('nope');
		expect(await enablePush()).toEqual({
			ok: false,
			reason: 'error',
			message: UNEXPECTED_FAILURE_MESSAGE
		});
	});

	test('disablePush does nothing when there is no subscription', async () => {
		installPushEnvironment({ existing: null });
		await disablePush();
		expect(pushApiMock.unsubscribe).not.toHaveBeenCalled();
	});

	test('disablePush unsubscribes locally and on the server', async () => {
		const existing = fakeSubscription('https://push.example/bye');
		installPushEnvironment({ existing });
		pushApiMock.unsubscribe.mockResolvedValue({ removed: true });
		await disablePush();
		expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
		expect(pushApiMock.unsubscribe).toHaveBeenCalledWith('https://push.example/bye');
	});

	test('disablePush still removes the server record when the local unsubscribe fails', async () => {
		const existing = fakeSubscription('https://push.example/stuck');
		existing.unsubscribe.mockRejectedValue(new Error('browser refused'));
		installPushEnvironment({ existing });
		pushApiMock.unsubscribe.mockResolvedValue({ removed: true });
		await expect(disablePush()).rejects.toThrow('browser refused');
		expect(pushApiMock.unsubscribe).toHaveBeenCalledWith('https://push.example/stuck');
	});
});
