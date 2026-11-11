/**
 * The app-wide Toaster must render in the user's active light/dark mode.
 *
 * sonner styles its own card from the `data-sonner-theme` attribute it derives from the `theme`
 * prop — it does not read the app's `.dark` class. A literal `theme="light"` therefore leaves every
 * toast on a light surface for every dark-mode user, which is the whole app's error channel.
 */

import { render, waitFor } from '@testing-library/svelte';
import { toast } from 'svelte-sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '$lib/stores/theme.svelte';
import { Toaster } from '../index';

/**
 * Mounting needs svelte's CLIENT entries; this suite otherwise resolves the package's `default`
 * (server) ones because vite.config.ts sets no `browser` resolve condition for tests. Written
 * `'…' as string` so TypeScript does not try to type svelte's internals (which ship no
 * declarations) while Vite still sees a literal it can resolve.
 */
vi.mock(
	'svelte',
	() => import('../../../../../../node_modules/svelte/src/index-client.js' as string)
);

/** sonner only mounts its themed list once a toast exists, so each case has to raise one. */
async function themeOfMountedToaster(): Promise<string | null> {
	toast('a message');
	const list = await waitFor(() => {
		const el = document.querySelector('[data-sonner-toaster]');
		if (!el) throw new Error('toaster list not mounted');
		return el;
	});
	return list.getAttribute('data-sonner-theme');
}

beforeEach(() => {
	localStorage.clear();
	// test-setup's matchMedia mock reports matches:false; pin it so a 'system' resolution is light.
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
});

afterEach(() => {
	toast.dismiss();
	themeStore.setPreference('system');
	vi.clearAllMocks();
});

describe('Toaster theme follows the theme store', () => {
	test('a dark preference renders a dark toaster surface', async () => {
		themeStore.setPreference('dark');
		render(Toaster);
		await expect(themeOfMountedToaster()).resolves.toBe('dark');
	});

	test('a light preference renders a light toaster surface', async () => {
		themeStore.setPreference('light');
		render(Toaster);
		await expect(themeOfMountedToaster()).resolves.toBe('light');
	});

	test('an explicitly passed theme still wins over the store', async () => {
		themeStore.setPreference('light');
		render(Toaster, { props: { theme: 'dark' } });
		await expect(themeOfMountedToaster()).resolves.toBe('dark');
	});
});
