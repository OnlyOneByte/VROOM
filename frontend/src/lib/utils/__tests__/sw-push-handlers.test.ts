/**
 * Source-scan guard for the push service worker.
 *
 * The push/notificationclick handlers live in `src/service-worker.ts`, bundled into the app's service
 * worker by the PWA plugin's `injectManifest` strategy. A live cross-vendor push DELIVERY can only be
 * verified against a real installed PWA plus a real browser push service, so a headless test cannot be
 * the merge-surviving net. This scans the SOURCE instead and pins the invariants that are easy to
 * silently break:
 *  - the SW registers a `push` listener that shows a notification (else a delivered push is dropped),
 *  - the SW registers a `notificationclick` listener that opens a window (else a click does nothing),
 *  - the SW precaches the injected manifest (else `injectManifest` ships a SW with NO offline precache,
 *  a silent PWA-offline regression versus the previous generateSW behavior),
 *  - `vite.config.ts` wires the `injectManifest` strategy at `filename: 'service-worker.ts'` (else the
 *  SW source exists but is never built into the app). That filename is load-bearing twice over: it is
 *  SvelteKit's reserved service-worker entry, and the plugin reads the file SvelteKit emits from it,
 *  so the config and the source filename must agree exactly.
 *  - the dead `static/sw.js` stays deleted (two registered service workers would collide),
 *  - Background Sync registration and a consuming `sync` listener stay paired (see below).
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server, no build.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
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
		.map(line => {
			const idx = line.indexOf('//');
			return idx === -1 ? line : line.slice(0, idx);
		})
		.join('\n');
}

const swSource = stripComments(readFileSync(join(SRC_ROOT, 'service-worker.ts'), 'utf8'));
const viteConfig = readFileSync(join(FRONTEND_ROOT, 'vite.config.ts'), 'utf8');

describe('push service worker (src/service-worker.ts) emits the required handlers', () => {
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

/**
 * Background Sync registration and consumption must stay paired.
 *
 * A `registration.sync.register(tag)` call with no `sync` listener in the service worker is a silent
 * no-op: the tag is accepted, nothing ever fires, and the calling code reads as though the browser is
 * syncing offline writes in the background when it is not. That is exactly the state this app shipped
 * in until the registration was removed.
 *
 * The reverse drift is just as bad: a `sync` listener with no registrar never runs.
 *
 * Note the handler side is not merely unimplemented — it is currently unimplementABLE. The offline
 * outbox lives in localStorage, which does not exist in service-worker scope, so a `sync` handler
 * cannot read the queued expenses it would have to POST. Making Background Sync real means moving the
 * outbox to IndexedDB first. Offline writes are delivered by the foreground sync manager instead.
 */
describe('Background Sync registration stays paired with a consuming sync listener', () => {
	/** Every app source file that could register or consume a sync event (tests excluded). */
	function appSourceFiles(dir: string, found: string[] = []): string[] {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				if (entry !== '__tests__') appSourceFiles(full, found);
			} else if (/\.(ts|js|svelte)$/.test(entry) && !/\.(test|spec)\.(ts|js)$/.test(entry)) {
				found.push(full);
			}
		}
		return found;
	}

	const REGISTRAR = /\bsync\s*\.\s*register\s*\(|['"]sync['"]\s+in\s+registration/;
	const CONSUMER = /addEventListener\(\s*['"]sync['"]/;

	const registrars = appSourceFiles(SRC_ROOT)
		.filter(file => REGISTRAR.test(stripComments(readFileSync(file, 'utf8'))))
		.map(file => relative(SRC_ROOT, file).split(sep).join('/'));

	test('no app code registers a Background Sync tag the service worker does not consume', () => {
		if (registrars.length > 0) {
			expect(
				swSource,
				`These files register a Background Sync tag: ${registrars.join(', ')}. ` +
					'src/service-worker.ts has no `sync` listener, so the registration is a no-op. ' +
					'Either add a listener that can actually flush the outbox (which requires moving the ' +
					'outbox off localStorage, unreadable from worker scope) or drop the registration.'
			).toMatch(CONSUMER);
		}
		expect(registrars).toEqual([]);
	});

	test('the service worker declares no sync listener while nothing registers a sync tag', () => {
		if (registrars.length === 0) {
			expect(
				swSource,
				'src/service-worker.ts declares a `sync` listener but no app code registers a Background ' +
					'Sync tag, so the handler can never fire.'
			).not.toMatch(CONSUMER);
		}
	});
});
