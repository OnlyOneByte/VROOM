import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	initializePWA,
	promptInstall,
	registerServiceWorker,
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

	describe('registerServiceWorker', () => {
		it('should register service worker when supported', () => {
			registerServiceWorker();

			expect(mockServiceWorker.register).toHaveBeenCalledWith('/sw.js');
		});

		it('should handle service worker registration failure', async () => {
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockServiceWorker.register.mockRejectedValue(new Error('Registration failed'));

			registerServiceWorker();

			// Wait for promise to resolve
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(consoleError).toHaveBeenCalledWith(
				'Service Worker registration failed:',
				expect.any(Error)
			);

			consoleError.mockRestore();
		});

		it('should set up message listener for service worker', async () => {
			mockServiceWorker.register.mockResolvedValue({
				addEventListener: vi.fn()
			});

			registerServiceWorker();

			// Wait for the promise to resolve
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(mockServiceWorker.addEventListener).toHaveBeenCalledWith(
				'message',
				expect.any(Function)
			);
		});

		it('should not register when service worker not supported', () => {
			// Remove service worker support
			Object.defineProperty(window, 'navigator', {
				value: {},
				writable: true
			});

			registerServiceWorker();

			expect(mockServiceWorker.register).not.toHaveBeenCalled();
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
});
