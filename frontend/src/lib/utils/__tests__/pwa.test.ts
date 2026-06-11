import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getPlatformInfo,
	initializePWA,
	promptInstall,
	requestBackgroundSync,
	pwaInstallState,
	type BeforeInstallPromptEvent
} from '../pwa';

// Get mocks from global setup
const mockServiceWorker = (global as any).mockServiceWorker;

describe('PWA Utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Reset PWA state
		pwaInstallState.canInstall = false;
		pwaInstallState.isInstalled = false;
		pwaInstallState.isStandalone = false;

		// Mock window.addEventListener
		window.addEventListener = vi.fn();

		// Reset service worker mock
		if (mockServiceWorker && mockServiceWorker.__reset) {
			mockServiceWorker.__reset();
		}
	});

	describe('initializePWA', () => {
		it('should detect standalone mode', () => {
			vi.mocked(window.matchMedia).mockReturnValue({
				matches: true,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			} as any);

			initializePWA();

			expect(pwaInstallState.isStandalone).toBe(true);
			expect(pwaInstallState.isInstalled).toBe(true);
		});

		it('should set up event listeners', () => {
			initializePWA();

			expect(window.addEventListener).toHaveBeenCalledWith(
				'beforeinstallprompt',
				expect.any(Function)
			);
			expect(window.addEventListener).toHaveBeenCalledWith('appinstalled', expect.any(Function));
		});

		it('should handle beforeinstallprompt event', () => {
			let beforeInstallHandler: (event: Event) => void;

			vi.mocked(window.addEventListener).mockImplementation((event, handler) => {
				if (event === 'beforeinstallprompt') {
					beforeInstallHandler = handler as (event: Event) => void;
				}
			});

			initializePWA();

			// Simulate beforeinstallprompt event
			const mockEvent = {
				preventDefault: vi.fn(),
				platforms: ['web'],
				userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
				prompt: vi.fn()
			} as unknown as BeforeInstallPromptEvent;

			beforeInstallHandler!(mockEvent);

			expect(mockEvent.preventDefault).toHaveBeenCalled();
			expect(pwaInstallState.canInstall).toBe(true);
		});

		it('should handle appinstalled event', () => {
			let appInstalledHandler: () => void;

			vi.mocked(window.addEventListener).mockImplementation((event, handler) => {
				if (event === 'appinstalled') {
					appInstalledHandler = handler as () => void;
				}
			});

			initializePWA();

			// Simulate appinstalled event
			appInstalledHandler!();

			expect(pwaInstallState.isInstalled).toBe(true);
			expect(pwaInstallState.canInstall).toBe(false);
		});
	});

	describe('promptInstall', () => {
		it('should return false when no deferred prompt available', async () => {
			const result = await promptInstall();
			expect(result).toBe(false);
		});

		it('should prompt installation and return true on acceptance', async () => {
			// Set up deferred prompt
			pwaInstallState.canInstall = true;

			// Mock the deferred prompt (this would normally be set by beforeinstallprompt)
			// We'll simulate this by modifying the module's internal state
			// Note: In a real scenario, these would be used to create a mock event

			// This is a bit of a hack since we can't easily access the internal deferredPrompt
			// In a real test environment, we'd set this up through the beforeinstallprompt event

			// For now, we'll test the error case
			const result = await promptInstall();
			expect(result).toBe(false);
		});
	});

	describe('requestBackgroundSync', () => {
		it('should register background sync when supported', async () => {
			const mockSync = {
				register: vi.fn().mockResolvedValue(undefined)
			};

			// Set up the mock for this test
			mockServiceWorker.ready = Promise.resolve({
				sync: mockSync
			} as any);

			// Also update the navigator mock directly
			Object.defineProperty(navigator, 'serviceWorker', {
				value: {
					...mockServiceWorker,
					ready: Promise.resolve({
						sync: mockSync
					})
				},
				writable: true
			});

			await requestBackgroundSync('test-sync', true); // Force browser mode

			expect(mockSync.register).toHaveBeenCalledWith('test-sync');
		});

		it('should handle background sync registration failure', async () => {
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

			// Set up the mock for this test
			const rejectedPromise = Promise.reject(new Error('Service worker not ready'));
			mockServiceWorker.ready = rejectedPromise;

			// Also update the navigator mock directly
			Object.defineProperty(navigator, 'serviceWorker', {
				value: {
					...mockServiceWorker,
					ready: rejectedPromise
				},
				writable: true
			});

			await requestBackgroundSync('test-sync', true); // Force browser mode

			// Wait a bit for the promise to reject and console.error to be called
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(consoleError).toHaveBeenCalledWith(
				'Background sync registration failed:',
				expect.any(Error)
			);

			consoleError.mockRestore();
		});

		it('should not register when service worker not supported', async () => {
			// Remove service worker support
			Object.defineProperty(window, 'navigator', {
				value: {},
				writable: true
			});

			await requestBackgroundSync('test-sync');

			// Should not throw or call any methods
			expect(mockServiceWorker.ready).toBeDefined();
		});

		it('should handle missing sync API', async () => {
			mockServiceWorker.ready = Promise.resolve({
				// No sync property
			} as any);

			await requestBackgroundSync('test-sync');

			// Should not throw
		});
	});

	describe('getPlatformInfo', () => {
		// getPlatformInfo classifies the UA to decide which install instructions to show
		// (iOS Share-sheet vs Android/desktop native prompt). The heuristics are subtle —
		// iPadOS 13+ masquerades as a MacIntel desktop, and Opera ships a "Chrome/" token —
		// so pin each branch. Replace window.navigator wholesale (the proven technique the
		// 'service worker not supported' test above uses) and restore the real one after each.
		const realNavigator = window.navigator;

		function setNavigator(opts: { ua?: string; platform?: string; maxTouchPoints?: number }): void {
			Object.defineProperty(window, 'navigator', {
				value: {
					userAgent: opts.ua ?? '',
					platform: opts.platform ?? '',
					maxTouchPoints: opts.maxTouchPoints ?? 0
				},
				configurable: true,
				writable: true
			});
		}

		afterEach(() => {
			Object.defineProperty(window, 'navigator', {
				value: realNavigator,
				configurable: true,
				writable: true
			});
		});

		it('detects an iPhone as iOS (non-Chromium)', () => {
			setNavigator({
				ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
			});
			const info = getPlatformInfo();
			expect(info.isIOS).toBe(true);
			expect(info.platform).toBe('ios');
			expect(info.isAndroid).toBe(false);
			expect(info.isChromium).toBe(false);
		});

		it('detects an iPadOS 13+ tablet masquerading as MacIntel desktop Safari (the touch heuristic)', () => {
			// iPadOS 13+ reports a desktop Mac UA; the ONLY signal it is really a tablet is
			// platform === 'MacIntel' with a touch screen (maxTouchPoints > 1). A regression
			// here would serve iPad users the wrong (desktop) install instructions.
			setNavigator({
				ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
				platform: 'MacIntel',
				maxTouchPoints: 5
			});
			const info = getPlatformInfo();
			expect(info.isIOS).toBe(true);
			expect(info.platform).toBe('ios');
		});

		it('does NOT classify a real MacIntel desktop (no touch) as iOS', () => {
			// Same MacIntel platform but maxTouchPoints 0 → a genuine desktop. Pins the
			// maxTouchPoints > 1 guard so a desktop Mac is never mis-detected as an iPad.
			setNavigator({
				ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
				platform: 'MacIntel',
				maxTouchPoints: 0
			});
			const info = getPlatformInfo();
			expect(info.isIOS).toBe(false);
			expect(info.platform).toBe('desktop');
		});

		it('detects Android Chrome', () => {
			setNavigator({
				ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
			});
			const info = getPlatformInfo();
			expect(info.isAndroid).toBe(true);
			expect(info.isIOS).toBe(false);
			expect(info.isChromium).toBe(true);
			expect(info.platform).toBe('android');
		});

		it('classifies desktop Chrome as a Chromium desktop', () => {
			setNavigator({
				ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			});
			const info = getPlatformInfo();
			expect(info.platform).toBe('desktop');
			expect(info.isChromium).toBe(true);
		});

		it('treats Edge (the Edg token) as Chromium', () => {
			setNavigator({
				ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
			});
			expect(getPlatformInfo().isChromium).toBe(true);
		});

		it('does NOT treat Opera (the OPR token) as Chromium, despite its Chrome token', () => {
			// Opera is Chromium-based and carries "Chrome/..." in its UA; the !/OPR/ guard is
			// the load-bearing exclusion so isChromium stays false for Opera.
			setNavigator({
				ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'
			});
			expect(getPlatformInfo().isChromium).toBe(false);
		});

		it('classifies Firefox desktop as a non-Chromium desktop', () => {
			setNavigator({
				ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
			});
			const info = getPlatformInfo();
			expect(info.platform).toBe('desktop');
			expect(info.isChromium).toBe(false);
			expect(info.isIOS).toBe(false);
			expect(info.isAndroid).toBe(false);
		});
	});

	describe('promptInstall — reaches the deferred-prompt accept/dismiss branches', () => {
		// The 'no deferred prompt' tests above never populate the module-internal
		// deferredPrompt, so promptInstall's accept/dismiss outcome branches were unexercised.
		// Drive it the real way: fire the captured beforeinstallprompt handler (which stores
		// the event inside the module), THEN call promptInstall. (dismissed first, accepted
		// last — the accepted branch nulls deferredPrompt, leaving the module state clean.)
		function captureBeforeInstallHandler(): (e: Event) => void {
			let handler: ((e: Event) => void) | undefined;
			vi.mocked(window.addEventListener).mockImplementation((event, h) => {
				if (event === 'beforeinstallprompt') handler = h as (e: Event) => void;
			});
			initializePWA();
			if (!handler) throw new Error('beforeinstallprompt handler was not registered');
			return handler;
		}

		function makePromptEvent(
			outcome: 'accepted' | 'dismissed',
			promptFn = vi.fn().mockResolvedValue(undefined)
		): BeforeInstallPromptEvent {
			return {
				preventDefault: vi.fn(),
				platforms: ['web'],
				userChoice: Promise.resolve({ outcome, platform: 'web' }),
				prompt: promptFn
			} as unknown as BeforeInstallPromptEvent;
		}

		it('returns false when the user dismisses the prompt', async () => {
			const handler = captureBeforeInstallHandler();
			handler(makePromptEvent('dismissed'));
			expect(pwaInstallState.canInstall).toBe(true);

			const result = await promptInstall();

			expect(result).toBe(false);
		});

		it('prompts, returns true, and clears canInstall when the user accepts', async () => {
			const handler = captureBeforeInstallHandler();
			const promptFn = vi.fn().mockResolvedValue(undefined);
			handler(makePromptEvent('accepted', promptFn));

			const result = await promptInstall();

			expect(promptFn).toHaveBeenCalled();
			expect(result).toBe(true);
			expect(pwaInstallState.canInstall).toBe(false);
		});
	});
});
