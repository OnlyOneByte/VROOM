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
		console.error('Error prompting PWA install:', error);
		return false;
	}
}

// Register service worker for background sync
export function registerServiceWorker(): void {
	if (!browser || !('serviceWorker' in navigator)) {
		return;
	}

	navigator.serviceWorker
		.register('/sw.js')
		.then(registration => {
			if (import.meta.env.DEV) {
				console.log('Service Worker registered:', registration);
			}

			// Listen for messages from service worker
			navigator.serviceWorker.addEventListener('message', event => {
				if (event.data && event.data.type === 'SYNC_COMPLETE') {
					// Handle sync completion
					if (import.meta.env.DEV) {
						console.log('Background sync completed');
					}
				}
			});
		})
		.catch(error => {
			console.error('Service Worker registration failed:', error);
		});
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
		console.error('Background sync registration failed:', error);
	}
}
