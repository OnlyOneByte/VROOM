import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { PushEnableOutcome } from '#lib/utils/push.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const { push, getVapidPublicKey, showError, showSuccess } = vi.hoisted(() => ({
	push: {
		isPushSupported: vi.fn<() => boolean>(),
		getNotificationPermission: vi.fn<() => 'default' | 'granted' | 'denied'>(),
		getExistingSubscription: vi.fn<() => Promise<PushSubscription | null>>(),
		enablePush: vi.fn<() => Promise<PushEnableOutcome>>(),
		disablePush: vi.fn<() => Promise<void>>()
	},
	getVapidPublicKey: vi.fn<() => Promise<{ publicKey: string }>>(),
	showError: vi.fn<(message: string) => void>(),
	showSuccess: vi.fn<(message: string) => void>()
}));

vi.mock('#lib/utils/push.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/push.ts')>()),
	...push
}));
vi.mock('#lib/services/push-api.ts', () => ({
	pushApi: { getVapidPublicKey: () => getVapidPublicKey() }
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		showError: (message: string) => showError(message),
		showSuccess: (message: string) => showSuccess(message)
	}
}));

const PushNotificationsCard = (await import('../PushNotificationsCard.svelte')).default;

const DISCLOSURE_KEY = 'vroom.push.disclosed';
const OFF = 'Off — turn on to get a notification when a reminder comes due.';
const ON = "On — you'll get a notification when VROOM next runs a reminder check and one is due.";

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount() {
	const result = render(PushNotificationsCard);
	await settle();
	return result;
}

function statusText() {
	return screen.getByTestId('push-status').textContent?.trim();
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	push.isPushSupported.mockReturnValue(true);
	push.getNotificationPermission.mockReturnValue('default');
	push.getExistingSubscription.mockResolvedValue(null);
	push.enablePush.mockResolvedValue({ ok: true });
	push.disablePush.mockResolvedValue();
	getVapidPublicKey.mockResolvedValue({ publicKey: 'key' });
});

afterEach(() => {
	cleanup();
});

describe('PushNotificationsCard status', () => {
	test('shows a spinner while the status is checked', async () => {
		getVapidPublicKey.mockReturnValue(new Promise(() => {}));
		await mount();
		expect(screen.getByTestId('push-loading')).toBeInTheDocument();
	});

	test('an unsupported browser shows the reason with no toggle', async () => {
		push.isPushSupported.mockReturnValue(false);
		await mount();
		expect(statusText()).toBe('This browser does not support push notifications.');
		expect(screen.queryByTestId('push-toggle')).toBeNull();
		expect(getVapidPublicKey).not.toHaveBeenCalled();
	});

	test.each([
		['a PUSH_NOT_CONFIGURED code', new ApiError('nope', 400, undefined, 'PUSH_NOT_CONFIGURED')],
		['a 503 status', new ApiError('down', 503)]
	])('a VAPID error with %s marks push unconfigured', async (_label, failure) => {
		getVapidPublicKey.mockRejectedValue(failure);
		await mount();
		expect(statusText()).toBe('Push notifications are not configured on this server.');
		expect(screen.queryByTestId('push-toggle')).toBeNull();
	});

	test('denied permission shows the blocked message with no toggle', async () => {
		push.getNotificationPermission.mockReturnValue('denied');
		await mount();
		expect(statusText()).toMatch(/^Notifications are blocked/);
		expect(screen.queryByTestId('push-toggle')).toBeNull();
	});

	test('an existing subscription shows the toggle switched on', async () => {
		push.getExistingSubscription.mockResolvedValue({} as PushSubscription);
		await mount();
		expect(statusText()).toBe(ON);
		expect(screen.getByTestId('push-toggle')).toHaveAttribute('aria-checked', 'true');
	});

	test('no subscription shows the toggle switched off', async () => {
		await mount();
		expect(statusText()).toBe(OFF);
		expect(screen.getByTestId('push-toggle')).toHaveAttribute('aria-checked', 'false');
	});

	test('an unexpected error shows the message and retry reloads the status', async () => {
		getVapidPublicKey.mockRejectedValueOnce(new Error('Network down'));
		await mount();
		expect(screen.getByTestId('push-error')).toHaveTextContent('Network down');

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(statusText()).toBe(OFF);
		expect(getVapidPublicKey).toHaveBeenCalledTimes(2);
	});

	test('a non-Error failure falls back to a generic message', async () => {
		push.getExistingSubscription.mockRejectedValue('boom');
		await mount();
		expect(screen.getByTestId('push-error')).toHaveTextContent(
			'Failed to check notification status'
		);
	});
});

describe('PushNotificationsCard enable and disable', () => {
	test('first enable asks for disclosure and does nothing until confirmed', async () => {
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		expect(await screen.findByText('Turn on push notifications?')).toBeInTheDocument();
		expect(push.enablePush).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await settle();
		expect(localStorage.getItem(DISCLOSURE_KEY)).toBe('1');
		expect(push.enablePush).toHaveBeenCalledTimes(1);
		expect(showSuccess).toHaveBeenCalledWith('Push notifications turned on');
		expect(statusText()).toBe(ON);
	});

	test('cancelling the disclosure leaves push off', async () => {
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await screen.findByText('Turn on push notifications?');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();
		await waitFor(() => expect(screen.queryByText('Turn on push notifications?')).toBeNull());
		expect(push.enablePush).not.toHaveBeenCalled();
		expect(localStorage.getItem(DISCLOSURE_KEY)).toBeNull();
	});

	test('a prior disclosure skips the dialog and enables directly', async () => {
		localStorage.setItem(DISCLOSURE_KEY, '1');
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await settle();
		expect(screen.queryByText('Turn on push notifications?')).toBeNull();
		expect(push.enablePush).toHaveBeenCalledTimes(1);
		expect(statusText()).toBe(ON);
	});

	test.each([
		[{ ok: false, reason: 'denied' } as const, /^Notifications are blocked/, null],
		[{ ok: false, reason: 'unsupported' } as const, /does not support push notifications/, null],
		[
			{ ok: false, reason: 'unconfigured' } as const,
			/not configured on this server/,
			'Push notifications are not configured on this server'
		],
		[
			{ ok: false, reason: 'error', message: 'Subscribe failed' } as const,
			/^Off/,
			'Subscribe failed'
		],
		[{ ok: false, reason: 'error' } as const, /^Off/, 'Could not enable push notifications']
	])('an enable outcome of %o updates status and errors', async (outcome, status, error) => {
		localStorage.setItem(DISCLOSURE_KEY, '1');
		push.enablePush.mockResolvedValue(outcome);
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await settle();
		expect(statusText()).toMatch(status);
		if (error) expect(showError).toHaveBeenCalledWith(error);
		else expect(showError).not.toHaveBeenCalled();
		expect(showSuccess).not.toHaveBeenCalled();
	});

	test('the toggle is disabled while enabling is in flight', async () => {
		localStorage.setItem(DISCLOSURE_KEY, '1');
		push.enablePush.mockReturnValue(new Promise(() => {}));
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await settle();
		expect(screen.getByTestId('push-toggle')).toBeDisabled();
	});

	test('turning off unsubscribes and reports success', async () => {
		push.getExistingSubscription.mockResolvedValue({} as PushSubscription);
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await settle();
		expect(push.disablePush).toHaveBeenCalledTimes(1);
		expect(showSuccess).toHaveBeenCalledWith('Push notifications turned off');
		expect(statusText()).toBe(OFF);
	});

	test('a failed turn-off reports an error and stays on', async () => {
		push.getExistingSubscription.mockResolvedValue({} as PushSubscription);
		push.disablePush.mockRejectedValue(new Error('x'));
		await mount();
		await fireEvent.click(screen.getByTestId('push-toggle'));
		await settle();
		expect(showError).toHaveBeenCalledWith('Could not turn off push notifications');
		expect(statusText()).toBe(ON);
	});
});
