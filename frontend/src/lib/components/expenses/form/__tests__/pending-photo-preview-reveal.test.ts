/**
 * The queued-photo tile reveals its Remove control on hover. Hover is not a thing on a phone —
 * which is where this app mostly runs — and `opacity: 0` does not take a control out of the tab
 * order, so a hover-only reveal leaves Remove unusable by touch and lands keyboard focus on an
 * invisible button. The control must therefore be visible unconditionally on small screens and
 * revealed by focus as well as hover on large ones.
 */

import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import PendingPhotoPreview from '../PendingPhotoPreview.svelte';

vi.mock(
	'svelte',
	() => import('../../../../../../node_modules/svelte/src/index-client.js' as string)
);

function mountWithOneFile() {
	const file = new File(['receipt-bytes'], 'receipt.pdf', { type: 'application/pdf' });
	return render(PendingPhotoPreview, {
		files: [file],
		onAdd: () => {},
		onRemove: () => {}
	});
}

describe('the Remove control on a queued photo', () => {
	test('is named, visible without hover, and revealed by focus', () => {
		const { container } = mountWithOneFile();
		const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;

		expect(remove).not.toBeNull();

		const tokens = (remove.getAttribute('class') ?? '').split(/\s+/);
		// Visible with no hover at all (the only state a touch device has).
		expect(tokens).toContain('opacity-100');
		// And revealed by focus wherever it does hide, so Tab never lands on an invisible control.
		expect(
			tokens.some(token => token.endsWith('focus-within:opacity-100')),
			`Remove hides itself with no focus escape: ${tokens.join(' ')}`
		).toBe(true);
	});
});
