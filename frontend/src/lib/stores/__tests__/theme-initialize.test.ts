/**
 * Guard for themeStore.initialize() — the on-mount theme bootstrap + the LIVE OS-preference listener
 * (C336 pinned setPreference but DELIBERATELY skipped initialize(), calling it "a one-shot guarded by an
 * internal flag"; theme.svelte.ts lines 40-55 were uncovered → 60% line / 55% branch).
 *
 * initialize() does three things, and the third is the load-bearing-yet-untested one:
 *   1. idempotency — a second initialize() is a no-op (the `initialized` flag).
 *   2. applies the stored preference on mount + sets `current`.
 *   3. registers a `prefers-color-scheme` change listener that re-applies the theme LIVE when the OS
 *      flips — but ONLY when the stored preference is 'system'. This `if (stored === 'system')` guard is
 *      what makes "System" track the OS in real time while NOT yanking an explicit light/dark user's
 *      theme out from under them when the OS changes. Drop that guard and a 'light' user's page jumps to
 *      dark the moment their OS enters night mode — a real user-facing regression, and setPreference's
 *      tests never exercise the listener so it stays GREEN.
 *
 * themeStore is a module SINGLETON with an internal `initialized` flag that latches on the first
 * initialize() and never resets — so only ONE initialize() in this file runs the body + registers the
 * listener. We therefore drive the whole contract in a single ordered test: capture the listener from
 * that one real initialize(), assert the mount effect + registration, prove idempotency (a 2nd call
 * registers nothing new), then fire the captured listener under each stored-preference to pin the
 * system-only branch by its OBSERVABLE effect (the <html> dark class), not a spy on a private fn.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '../theme.svelte';

const STORAGE_KEY = 'vroom-theme-preference';

const registered: Array<() => void> = [];
let osIsDark = false;

/** matchMedia mock that records every registered 'change' listener so we can fire it manually. */
function installMatchMedia(): void {
	vi.mocked(window.matchMedia).mockImplementation(
		() =>
			({
				get matches() {
					return osIsDark;
				},
				addEventListener: (_event: string, cb: () => void) => {
					registered.push(cb);
				},
				removeEventListener: vi.fn()
			}) as unknown as MediaQueryList
	);
}

beforeEach(() => {
	document.documentElement.classList.remove('dark');
	osIsDark = false;
	installMatchMedia();
});

function htmlIsDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

describe('themeStore.initialize — bootstrap + live OS-preference listener (the C336-skipped one-shot)', () => {
	test('mounts the stored preference, registers ONE live listener (idempotent), and the listener honors the system-only guard', () => {
		// 1. MOUNT: seed a stored 'dark' preference, then the (singleton's only) real initialize().
		localStorage.setItem(STORAGE_KEY, 'dark');
		themeStore.initialize();
		expect(htmlIsDark()).toBe(true); // stored 'dark' applied on mount
		expect(themeStore.current).toBe('dark');
		expect(registered.length).toBe(1); // exactly one live OS-change listener registered

		// 2. IDEMPOTENCY: a second initialize() is guarded by `initialized` → body must not re-run.
		themeStore.initialize();
		expect(registered.length).toBe(1); // still one — no duplicate listener

		const fireOsChange = registered[0];
		expect(fireOsChange).toBeTypeOf('function');
		if (!fireOsChange) throw new Error('no OS-change listener registered'); // narrow for TS + guard

		// 3a. stored 'system' → an OS flip to dark re-applies LIVE.
		localStorage.setItem(STORAGE_KEY, 'system');
		osIsDark = true;
		document.documentElement.classList.remove('dark');
		fireOsChange();
		expect(htmlIsDark()).toBe(true); // system tracks the OS live

		// 3b. stored explicit 'light' → the same OS flip must NOT touch the theme (the load-bearing guard).
		localStorage.setItem(STORAGE_KEY, 'light');
		document.documentElement.classList.remove('dark'); // a light user's current state
		osIsDark = true;
		fireOsChange();
		expect(htmlIsDark()).toBe(false); // the `if (stored === 'system')` guard protects an explicit choice
	});
});
