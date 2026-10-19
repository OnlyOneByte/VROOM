import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getPlatformInfo,
	initializePWA,
	promptInstall,
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

	// There is no requestBackgroundSync here any more: it registered a Background Sync tag that the
	// service worker never consumed, so offline expenses were never synced in the background despite
	// the call reading that way. The outbox lives in localStorage, which worker scope cannot read, so
	// the handler side was not implementable without moving the outbox to IndexedDB. Delivery is the
	// foreground sync manager's `online` listener plus the manual sync control.
	// sw-push-handlers.test.ts fails if a sync registration reappears without a consuming listener.

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

/**
 * Source-scan guard for the PWA document head.
 *
 * `viewport` and `theme-color` are single-declaration metas, and a duplicate does real damage rather
 * than being merely redundant:
 *  - A second `<meta name="viewport">` REPLACES the first description instead of merging with it, so
 *    one that omits `viewport-fit=cover` resets it to `auto`. `env(safe-area-inset-*)` then reports 0,
 *    and app.css's .safe-top/.safe-bottom plus the mobile nav's safe-area padding silently collapse on
 *    notched devices. `<svelte:head>` content lands AFTER app.html's head, so a layout or page copy
 *    always wins.
 *  - The browser picks the FIRST `theme-color`, which is also the one themeStore rewrites per active
 *    theme (document.querySelector returns the first match). A second one is dead weight that
 *    disagrees with the installed-app manifest colour and would hijack theming if it ever sorted first.
 *
 * `user-scalable=no` is called out separately because it fails WCAG 1.4.4 (Resize Text) and the axe
 * `meta-viewport` rule, independent of the duplication problem.
 */
describe('PWA document head — viewport and theme-color are declared exactly once', () => {
	const UTILS_TESTS_DIR = dirname(fileURLToPath(import.meta.url));
	const SRC_ROOT = join(UTILS_TESTS_DIR, '..', '..', '..');
	const FRONTEND_ROOT = join(SRC_ROOT, '..');

	/** Drop HTML comments so prose ABOUT a meta tag is not scanned as a declaration of one. */
	function stripHtmlComments(source: string): string {
		return source.replace(/<!--[\s\S]*?-->/g, ' ');
	}

	function metaDeclarations(source: string, name: string): string[] {
		const pattern = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*>`, 'gi');
		return stripHtmlComments(source).match(pattern) ?? [];
	}

	const appHtml = readFileSync(join(SRC_ROOT, 'app.html'), 'utf8');
	const layout = readFileSync(join(SRC_ROOT, 'routes', '+layout.svelte'), 'utf8');
	const viteConfig = readFileSync(join(FRONTEND_ROOT, 'vite.config.ts'), 'utf8');

	it('app.html declares one viewport, and it carries viewport-fit=cover', () => {
		const declarations = metaDeclarations(appHtml, 'viewport');
		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toContain('viewport-fit=cover');
		expect(declarations[0]).not.toContain('user-scalable=no');
	});

	it('the root layout re-declares neither viewport nor theme-color', () => {
		expect(metaDeclarations(layout, 'viewport')).toEqual([]);
		expect(metaDeclarations(layout, 'theme-color')).toEqual([]);
	});

	it('app.html declares one theme-color and it matches the installed-app manifest', () => {
		const declarations = metaDeclarations(appHtml, 'theme-color');
		expect(declarations).toHaveLength(1);

		const metaColor = /content=["']([^"']+)["']/.exec(declarations[0] ?? '')?.[1];
		const manifestColor = /theme_color:\s*['"]([^'"]+)['"]/.exec(viteConfig)?.[1];
		expect(manifestColor).toBeTruthy();
		expect(metaColor).toBe(manifestColor);
	});

	/**
	 * Routes that still override the viewport. Every entry is a live defect: it drops
	 * `viewport-fit=cover` for that route, so the safe-area insets collapse there. The assertion is
	 * exact rather than "at most these", so this list can only ever shrink — removing the last
	 * override turns this test red until the list is emptied too.
	 */
	const PENDING_VIEWPORT_OVERRIDES: string[] = [];

	it('no route re-declares the viewport beyond the known pending overrides', () => {
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) {
					walk(full);
				} else if (entry.endsWith('.svelte')) {
					const source = readFileSync(full, 'utf8');
					if (metaDeclarations(source, 'viewport').length > 0) {
						offenders.push(relative(SRC_ROOT, full).split(sep).join('/'));
					}
				}
			}
		};
		walk(join(SRC_ROOT, 'routes'));
		walk(join(SRC_ROOT, 'lib'));

		expect(
			offenders.sort(),
			'A <meta name="viewport"> outside app.html overrides it and drops viewport-fit=cover, ' +
				'collapsing env(safe-area-inset-*) on that route. Remove the override. If this list is now ' +
				'SHORTER than expected, the override was fixed — delete its PENDING_VIEWPORT_OVERRIDES entry.'
		).toEqual([...PENDING_VIEWPORT_OVERRIDES].sort());
	});
});
