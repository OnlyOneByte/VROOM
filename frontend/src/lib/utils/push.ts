/**
 * Web Push browser lifecycle helpers (push-notifications T5). Sits beside `pwa.ts` — the same layer:
 * thin wrappers over the browser Push API + our `pushApi` transport, kept out of the component so the
 * pure state-machine below is unit-testable and the card stays a thin view.
 *
 * Honesty (D6): enabling push here means "VROOM will send a browser notification when it next runs a
 * reminder check" (the trigger is request-driven; there is no background scheduler in v1). The card
 * copy discloses that — do NOT imply guaranteed scheduled delivery.
 */

import { browser } from '$app/environment';
import { pushApi, type PushSubscribeInput } from '$lib/services/push-api';
import { ApiError } from '$lib/utils/error-handling';

/**
 * The user-facing state of push on THIS browser. Drives the settings card's status line + toggle:
 *   unsupported  — the browser lacks the Push API / service worker / Notification API
 *   unconfigured — this server has no VAPID keypair (the 503 degrade); nothing to subscribe to
 *   denied       — the user blocked notifications at the OS/browser level (must un-block manually)
 *   subscribed   — an active subscription exists and is persisted server-side (push is ON)
 *   off          — supported + configured + not blocked, but not subscribed (push is OFF, can enable)
 *   error        — a status check or toggle failed (retry)
 */
export type PushStatus = 'unsupported' | 'unconfigured' | 'denied' | 'subscribed' | 'off' | 'error';

export interface PushStatusInput {
	/** The browser exposes the Push API + service worker + Notification API. */
	supported: boolean;
	/** The server returned a VAPID public key (not the 503 PUSH_NOT_CONFIGURED degrade). */
	configured: boolean;
	/** The current Notification permission ('default' | 'granted' | 'denied'). */
	permission: 'default' | 'granted' | 'denied';
	/** An active browser PushSubscription exists. */
	subscribed: boolean;
}

/**
 * Pure state machine (no browser access) → the single source of truth for the card's status. Ordered
 * by precedence: capability first (can't-do beats not-doing), then a hard block, then on/off. Kept
 * pure so it is exhaustively unit-testable without a DOM.
 */
export function derivePushStatus(i: PushStatusInput): PushStatus {
	if (!i.supported) return 'unsupported';
	if (!i.configured) return 'unconfigured';
	if (i.permission === 'denied') return 'denied';
	return i.subscribed ? 'subscribed' : 'off';
}

/** The human status line for each state (honest about the request-driven timing, D6). */
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

/** The outcome of an enable attempt — a discriminated result the card maps to a status/toast. */
export type PushEnableOutcome =
	| { ok: true }
	| { ok: false; reason: 'unsupported' | 'unconfigured' | 'denied' | 'error'; message?: string };

/** True when this browser exposes everything Web Push needs. Safe to call during SSR (returns false). */
export function isPushSupported(): boolean {
	return (
		browser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
	);
}

/** The current Notification permission, or 'default' when unavailable (SSR / unsupported). */
export function getNotificationPermission(): 'default' | 'granted' | 'denied' {
	if (!browser || !('Notification' in window)) return 'default';
	return Notification.permission;
}

/**
 * Decode a base64url VAPID public key into the Uint8Array `applicationServerKey` that
 * `pushManager.subscribe()` requires (base64url → base64 → bytes).
 */
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

/** The active Web Push subscription for this browser, if any (null when unsupported/none).
 *  Uses `getRegistration()` (resolves immediately — `undefined` when nothing is registered) rather
 *  than `serviceWorker.ready`, which never resolves until a worker is active (dev / pre-T6), so this
 *  passive status check can't hang the settings card on its loading spinner. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
	if (!isPushSupported()) return null;
	const registration = await navigator.serviceWorker.getRegistration();
	if (!registration) return null;
	return registration.pushManager.getSubscription();
}

/** Map a browser PushSubscription to the backend subscribe payload (endpoint + keys + UA hint). */
function toSubscribePayload(sub: PushSubscription): PushSubscribeInput {
	const json = sub.toJSON();
	return {
		endpoint: sub.endpoint,
		keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
		userAgent: browser ? navigator.userAgent : undefined
	};
}

/**
 * Turn push ON: request permission (if not already decided), fetch the VAPID public key, subscribe via
 * the browser Push API (reusing an existing subscription if present), and persist it server-side.
 * Best-effort + honest — returns a discriminated outcome instead of throwing so the card can render the
 * exact reason (blocked / not-configured / unsupported / error) rather than a generic failure.
 */
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

/**
 * Turn push OFF: unsubscribe the browser subscription AND remove it server-side. The server delete runs
 * even if the browser-side unsubscribe hiccups, so a stale row never lingers (the endpoint is captured
 * before unsubscribe, which invalidates the object).
 */
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
