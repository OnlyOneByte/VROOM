import { beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '../theme.svelte';

const STORAGE_KEY = 'vroom-theme-preference';

const registered: Array<() => void> = [];
let osIsDark = false;

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

describe('themeStore.initialize — bootstrap + live OS-preference listener (the skipped one-shot)', () => {
	test('mounts the stored preference, registers ONE live listener (idempotent), and the listener honors the system-only guard', () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		themeStore.initialize();
		expect(htmlIsDark()).toBe(true);
		expect(themeStore.current).toBe('dark');
		expect(registered.length).toBe(1);

		themeStore.initialize();
		expect(registered.length).toBe(1);

		const fireOsChange = registered[0];
		expect(fireOsChange).toBeTypeOf('function');
		if (!fireOsChange) throw new Error('no OS-change listener registered');

		localStorage.setItem(STORAGE_KEY, 'system');
		osIsDark = true;
		document.documentElement.classList.remove('dark');
		fireOsChange();
		expect(htmlIsDark()).toBe(true);

		localStorage.setItem(STORAGE_KEY, 'light');
		document.documentElement.classList.remove('dark');
		osIsDark = true;
		fireOsChange();
		expect(htmlIsDark()).toBe(false);
	});
});
