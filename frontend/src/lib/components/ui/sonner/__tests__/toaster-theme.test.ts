import { render, waitFor } from '@testing-library/svelte';
import { toast } from 'svelte-sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '$lib/stores/theme.svelte';
import { Toaster } from '../index';

// sonner mounts its themed list only once a toast exists.
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
	// Pin matchMedia to light so a 'system' preference resolves to light.
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
