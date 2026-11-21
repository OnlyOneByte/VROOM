import { render, waitFor } from '@testing-library/svelte';
import { toast } from 'svelte-sonner';
import { afterEach, describe, expect, test } from 'vitest';
import { Toaster } from '../index';

afterEach(() => toast.dismiss());

async function mountedToasterStyle(): Promise<string> {
	toast('a message');
	const list = await waitFor(() => {
		const el = document.querySelector('[data-sonner-toaster]');
		if (!el) throw new Error('toaster list not mounted');
		return el;
	});
	return list.getAttribute('style') ?? '';
}

describe('Toaster clears the floating Save bar and FAB', () => {
	test('toasts sit above the bottom action area on desktop and mobile', async () => {
		render(Toaster, { props: { position: 'bottom-right' } });
		const style = await mountedToasterStyle();
		expect(style).toContain('--offset-bottom: 6.5rem');
		expect(style).toContain('--mobile-offset-bottom: 6.5rem');
	});
});
