import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRONTEND_ROOT = join(SRC_ROOT, '..');

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

describe('Background Sync registration stays paired with a consuming sync listener', () => {
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
