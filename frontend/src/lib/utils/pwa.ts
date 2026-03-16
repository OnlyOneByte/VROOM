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

// Initialize PWA detection
export function initializePWA(): void {
	if (!browser) return;

	// Check if app is running in standalone mode
	pwaInstallState.isStandalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		(window.navigator as { standalone?: boolean }).standalone === true;

	// Check if app is already installed
	pwaInstallState.isInstalled = pwaInstallState.isStandalone;

	// Listen for beforeinstallprompt event
	window.addEventListener('beforeinstallprompt', (e: Event) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
		pwaInstallState.canInstall = true;
	});

	// Listen for app installed event
	window.addEventListener('appinstalled', () => {
		pwaInstallState.isInstalled = true;
		pwaInstallState.canInstall = false;
		deferredPrompt = null;
	});
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

// Request background sync
export async function requestBackgroundSync(tag: string, forceBrowser = false): Promise<void> {
	if (!(forceBrowser || browser) || !('serviceWorker' in navigator)) {
		return;
	}

	try {
		const registration = await navigator.serviceWorker.ready;
		if ('sync' in registration) {
			await (
				registration as ServiceWorkerRegistration & {
					sync: { register: (tag: string) => Promise<void> };
				}
			).sync.register(tag);
		}
	} catch (error) {
		if (import.meta.env.DEV) console.error('Background sync registration failed:', error);
	}
}
