// The remove control must work without hover: visible on small screens, focus-revealed on large ones.

import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import PendingPhotoPreview from '../PendingPhotoPreview.svelte';

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
		expect(tokens).toContain('opacity-100');
		// And revealed by focus wherever it does hide, so Tab never lands on an invisible control.
		expect(
			tokens.some(token => token.endsWith('focus-within:opacity-100')),
			`Remove hides itself with no focus escape: ${tokens.join(' ')}`
		).toBe(true);
	});
});
