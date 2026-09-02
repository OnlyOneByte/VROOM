/**
 * Regression GUARD (committed, travels with the merge) for the push service worker (T6).
 *
 * The push/notificationclick handlers live in `src/sw.ts`, bundled into the app's service worker by the
 * PWA plugin's `injectManifest` strategy. A live cross-vendor push DELIVERY can only be verified against
 * a real installed PWA + a real browser push service (eyes-on-pending, like the live-VLM/Photos legs), so
 * a headless e2e can't be the merge-surviving net. This scans the SOURCE instead and pins the invariants a
 * future autonomous cycle could silently break:
 *   - the SW registers a `push` listener that shows a notification (else a delivered push is dropped),
 *   - the SW registers a `notificationclick` listener that opens a window (else a click does nothing),
 *   - the SW precaches the injected manifest (else `injectManifest` ships a SW with NO offline precache —
 *     a silent PWA-offline regression vs the prior generateSW behavior),
 *   - `vite.config.ts` actually wires the `injectManifest` strategy at `filename: 'sw.ts'` (else the SW
 *     source exists but is never built into the app),
 *   - the dead `static/sw.js` stays deleted (two registered service workers would collide — D4).
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server, no build.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up and frontend/ is four.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRONTEND_ROOT = join(SRC_ROOT, '..');

/** Strip JS block + line comments so a doc comment mentioning a handler is never mistaken for live code. */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.split('\n')
		.map((line) => {
			const idx = line.indexOf('//');
			return idx === -1 ? line : line.slice(0, idx);
		})
		.join('\n');
}

const swSource = stripComments(readFileSync(join(SRC_ROOT, 'service-worker.ts'), 'utf8'));
const viteConfig = readFileSync(join(FRONTEND_ROOT, 'vite.config.ts'), 'utf8');

describe('push service worker (src/sw.ts) emits the required handlers', () => {
	test('registers a push listener that shows a notification', () => {
		expect(swSource).toMatch(/addEventListener\(\s*['"]push['"]/);
		expect(swSource).toMatch(/showNotification\(/);
	});

	test('registers a notificationclick listener that opens/focuses a window', () => {
		expect(swSource).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
		expect(swSource).toMatch(/openWindow\(/);
	});

	test('precaches the injected manifest (offline precache preserved under injectManifest)', () => {
		expect(swSource).toMatch(/precacheAndRoute\(/);
		expect(swSource).toContain('__WB_MANIFEST');
	});
});

describe('vite PWA config wires the injectManifest SW', () => {
	test('uses the injectManifest strategy pointing at service-worker.ts', () => {
		expect(viteConfig).toMatch(/strategies:\s*['"]injectManifest['"]/);
		expect(viteConfig).toMatch(/filename:\s*['"]service-worker\.ts['"]/);
	});
});

describe('the dead static service worker is removed', () => {
	test('static/sw.js no longer exists (a second registered SW would collide)', () => {
		expect(existsSync(join(FRONTEND_ROOT, 'static', 'sw.js'))).toBe(false);
	});
});
