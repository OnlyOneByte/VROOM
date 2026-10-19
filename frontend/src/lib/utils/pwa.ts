import { browser } from '$app/environment';

export interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	readonly userChoice: Promise<{
		outcome: 'accepted' | 'dismissed';
		platform: string;
	}>;
	prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

type PwaPlatform = 'ios' | 'android' | 'desktop';

export interface PlatformInfo {
	platform: PwaPlatform;
	isIOS: boolean;
	isAndroid: boolean;
	isChromium: boolean;
}

export function getPlatformInfo(): PlatformInfo {
	if (!browser) return { platform: 'desktop', isIOS: false, isAndroid: false, isChromium: false };
	const ua = navigator.userAgent;
	const isIOS =
		/iPad|iPhone|iPod/.test(ua) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const isAndroid = /Android/.test(ua);
	const isChromium = /Chrome|Chromium|Edg/.test(ua) && !/OPR/.test(ua);
	const platform: PwaPlatform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
	return { platform, isIOS, isAndroid, isChromium };
}

// PWA installation state
export const pwaInstallState = {
	canInstall: false,
	isInstalled: false,
	isStandalone: false
};

// Named rather than inline so the registrations below are removable — see initializePWA.
function handleBeforeInstallPrompt(e: Event): void {
	e.preventDefault();
	deferredPrompt = e as BeforeInstallPromptEvent;
	pwaInstallState.canInstall = true;
}

function handleAppInstalled(): void {
	pwaInstallState.isInstalled = true;
	pwaInstallState.canInstall = false;
	deferredPrompt = null;
}

/**
 * Initialize PWA detection. Safe to call any number of times: the window listeners outlive the
 * components that ask for them, and this is called from two of them — including a settings card
 * that re-mounts on every visit to /settings. Registering unconditionally therefore accumulated a
 * fresh pair of listeners per visit for the life of the page, with nothing ever removing them.
 *
 * Each call removes the previous registration before adding it back, so exactly one listener per
 * event is live no matter how many callers there are, and no caller needs to own a teardown. The
 * standalone/installed probe is deliberately NOT guarded — display-mode can change mid-session
 * (the user installs the app), so a later caller must be able to re-read it.
 */
export function initializePWA(): void {
	if (!browser) return;

	pwaInstallState.isStandalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		(window.navigator as { standalone?: boolean }).standalone === true;
	pwaInstallState.isInstalled = pwaInstallState.isStandalone;

	window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
	window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

	window.removeEventListener('appinstalled', handleAppInstalled);
	window.addEventListener('appinstalled', handleAppInstalled);
}

// Prompt user to install PWA
export async function promptInstall(): Promise<boolean> {
	if (!deferredPrompt) {
		return false;
	}

	try {
		await deferredPrompt.prompt();
		const choiceResult = await deferredPrompt.userChoice;

		if (choiceResult.outcome === 'accepted') {
			pwaInstallState.canInstall = false;
			deferredPrompt = null;
			return true;
		}

		return false;
	} catch (error) {
		if (import.meta.env.DEV) console.error('Error prompting PWA install:', error);
		return false;
	}
}

// Deliberately NO Background Sync helper here. Two hard blockers, not an oversight:
//  - The offline outbox lives in localStorage ('vroom_offline_expenses'), and localStorage does not
//    exist in ServiceWorkerGlobalScope — a `sync` handler in the service worker cannot read the
//    queued expenses, so it has nothing to POST. Reaching it would mean moving the outbox to
//    IndexedDB and reimplementing conflict detection/retry/backoff in worker scope.
//  - Background Sync is Chromium-only. iOS Safari is a first-class install target here (see
//    getPlatformInfo's iOS branch and the apple-* meta tags in app.html) and has never shipped it.
// Offline writes are delivered by the FOREGROUND path instead: syncManager.setupAutoSync() listens
// for `online` and runs syncAll(), plus the manual sync control. Re-adding a sync.register() call
// without a matching `sync` listener in src/service-worker.ts re-creates a silent no-op; the
// sw-push-handlers guard fails if the two ever drift apart.
