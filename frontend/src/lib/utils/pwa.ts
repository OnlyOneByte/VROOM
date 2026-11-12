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

export const pwaInstallState = {
	canInstall: false,
	isInstalled: false,
	isStandalone: false
};

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

// Service-worker scope cannot read localStorage, where the outbox lives; writes are delivered by the foreground sync manager.
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
