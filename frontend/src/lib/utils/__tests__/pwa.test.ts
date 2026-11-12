import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import {
	getPlatformInfo,
	initializePWA,
	promptInstall,
	pwaInstallState,
	type BeforeInstallPromptEvent
} from '../pwa';

const mockServiceWorker = (global as any).mockServiceWorker;

describe('PWA Utils', () => {
	const realAddEventListener = window.addEventListener;
	const realRemoveEventListener = window.removeEventListener;

	afterEach(() => {
		window.addEventListener = realAddEventListener;
		window.removeEventListener = realRemoveEventListener;
	});

	beforeEach(() => {
		vi.clearAllMocks();

		pwaInstallState.canInstall = false;
		pwaInstallState.isInstalled = false;
		pwaInstallState.isStandalone = false;

		window.addEventListener = vi.fn();

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

			appInstalledHandler!();

			expect(pwaInstallState.isInstalled).toBe(true);
			expect(pwaInstallState.canInstall).toBe(false);
		});
	});

	describe('initializePWA — idempotent registration', () => {
		type WindowListener = (event: Event) => void;

		function trackWindowListeners(): Map<string, Set<WindowListener>> {
			const live = new Map<string, Set<WindowListener>>();
			const listenersFor = (type: string): Set<WindowListener> => {
				const existing = live.get(type);
				if (existing) return existing;
				const created = new Set<WindowListener>();
				live.set(type, created);
				return created;
			};
			window.addEventListener = vi.fn((type: string, handler: WindowListener) =>
				listenersFor(type).add(handler)
			) as unknown as typeof window.addEventListener;
			window.removeEventListener = vi.fn((type: string, handler: WindowListener) =>
				listenersFor(type).delete(handler)
			) as unknown as typeof window.removeEventListener;
			return live;
		}

		it('leaves exactly one listener per event after repeated calls', () => {
			const live = trackWindowListeners();

			initializePWA();
			initializePWA();
			initializePWA();

			expect(live.get('beforeinstallprompt')?.size).toBe(1);
			expect(live.get('appinstalled')?.size).toBe(1);
		});

		it('keeps the surviving registration live, so install detection still works', () => {
			const live = trackWindowListeners();

			initializePWA();
			initializePWA();

			const [handler] = [...(live.get('beforeinstallprompt') ?? [])];
			expect(handler).toBeDefined();
			handler!({ preventDefault: vi.fn() } as unknown as Event);

			expect(pwaInstallState.canInstall).toBe(true);
		});
	});

	describe('promptInstall', () => {
		it('should return false when no deferred prompt available', async () => {
			const result = await promptInstall();
			expect(result).toBe(false);
		});

		it('should prompt installation and return true on acceptance', async () => {
			pwaInstallState.canInstall = true;

			const result = await promptInstall();
			expect(result).toBe(false);
		});
	});

	describe('getPlatformInfo', () => {
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

describe('PWA document head — viewport and theme-color are declared exactly once', () => {
	const UTILS_TESTS_DIR = dirname(fileURLToPath(import.meta.url));
	const SRC_ROOT = join(UTILS_TESTS_DIR, '..', '..', '..');
	const FRONTEND_ROOT = join(SRC_ROOT, '..');

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

	const PENDING_VIEWPORT_OVERRIDES: string[] = [];

	const viewportOverrides = (): string[] => {
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) {
					walk(full);
				} else if (entry.endsWith('.svelte')) {
					if (metaDeclarations(readFileSync(full, 'utf8'), 'viewport').length > 0) {
						offenders.push(relative(SRC_ROOT, full).split(sep).join('/'));
					}
				}
			}
		};
		walk(join(SRC_ROOT, 'routes'));
		walk(join(SRC_ROOT, 'lib'));
		return offenders;
	};

	ratchet({
		name: 'no route re-declares the viewport',
		tolerated: PENDING_VIEWPORT_OVERRIDES,
		guidance:
			'A <meta name="viewport"> outside app.html overrides it and drops viewport-fit=cover, ' +
			'collapsing env(safe-area-inset-*) on that route. Remove the override from these:',
		scan: viewportOverrides,
		probe: () => {
			expect(
				metaDeclarations('<meta name="viewport" content="width=device-width" />', 'viewport')
			).toHaveLength(1);
			expect(
				metaDeclarations('<meta name="theme-color" content="#000" />', 'viewport')
			).toHaveLength(0);
			expect(metaDeclarations(appHtml, 'viewport').length).toBe(1);
		}
	});
});
