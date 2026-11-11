import { browser } from '$app/environment';
import { pushApi, type PushSubscribeInput } from '$lib/services/push-api';
import { ApiError } from '$lib/utils/error-handling';

export type PushStatus = 'unsupported' | 'unconfigured' | 'denied' | 'subscribed' | 'off' | 'error';

export interface PushStatusInput {
	supported: boolean;
	configured: boolean;
	permission: 'default' | 'granted' | 'denied';
	subscribed: boolean;
}

export function derivePushStatus(i: PushStatusInput): PushStatus {
	if (!i.supported) return 'unsupported';
	if (!i.configured) return 'unconfigured';
	if (i.permission === 'denied') return 'denied';
	return i.subscribed ? 'subscribed' : 'off';
}

export function pushStatusLabel(status: PushStatus): string {
	switch (status) {
		case 'unsupported':
			return 'This browser does not support push notifications.';
		case 'unconfigured':
			return 'Push notifications are not configured on this server.';
		case 'denied':
			return 'Notifications are blocked. Allow them for this site in your browser settings, then try again.';
		case 'subscribed':
			return "On — you'll get a notification when VROOM next runs a reminder check and one is due.";
		case 'off':
			return 'Off — turn on to get a notification when a reminder comes due.';
		case 'error':
			return 'Could not check notification status. Try again.';
	}
}

export type PushEnableOutcome =
	| { ok: true }
	| { ok: false; reason: 'unsupported' | 'unconfigured' | 'denied' | 'error'; message?: string };

export function isPushSupported(): boolean {
	return (
		browser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
	);
}

export function getNotificationPermission(): 'default' | 'granted' | 'denied' {
	if (!browser || !('Notification' in window)) return 'default';
	return Notification.permission;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
	if (!isPushSupported()) return null;
	const registration = await navigator.serviceWorker.getRegistration();
	if (!registration) return null;
	return registration.pushManager.getSubscription();
}

function toSubscribePayload(sub: PushSubscription): PushSubscribeInput {
	const json = sub.toJSON();
	return {
		endpoint: sub.endpoint,
		keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
		userAgent: browser ? navigator.userAgent : undefined
	};
}

export async function enablePush(): Promise<PushEnableOutcome> {
	if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

	let permission = getNotificationPermission();
	if (permission === 'default') {
		permission = await Notification.requestPermission();
	}
	if (permission !== 'granted') return { ok: false, reason: 'denied' };

	try {
		const { publicKey } = await pushApi.getVapidPublicKey();
		const registration = await navigator.serviceWorker.ready;
		const existing = await registration.pushManager.getSubscription();
		const sub =
			existing ??
			(await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey)
			}));
		await pushApi.subscribe(toSubscribePayload(sub));
		return { ok: true };
	} catch (e) {
		if (e instanceof ApiError && e.code === 'PUSH_NOT_CONFIGURED') {
			return { ok: false, reason: 'unconfigured' };
		}
		return { ok: false, reason: 'error', message: e instanceof Error ? e.message : undefined };
	}
}

export async function disablePush(): Promise<void> {
	const sub = await getExistingSubscription();
	if (!sub) return;
	const { endpoint } = sub;
	try {
		await sub.unsubscribe();
	} finally {
		await pushApi.unsubscribe(endpoint);
	}
}
