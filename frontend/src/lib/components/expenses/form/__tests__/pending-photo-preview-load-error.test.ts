import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const handleErrorWithNotification = vi.hoisted(() => vi.fn());

vi.mock('#lib/utils/error-handling.ts', () => ({ handleErrorWithNotification }));

vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => {
	throw new Error('chunk unavailable');
});

import PendingPhotoPreview from '../PendingPhotoPreview.svelte';

describe('PendingPhotoPreview when the upload dialog cannot load', () => {
	test('says so on each tap and leaves the Add button usable', async () => {
		render(PendingPhotoPreview, { props: { files: [], onAdd: vi.fn(), onRemove: vi.fn() } });
		const add = screen.getByRole('button', { name: 'Add' });

		await fireEvent.click(add);
		await waitFor(() => expect(handleErrorWithNotification).toHaveBeenCalledTimes(1));
		expect(handleErrorWithNotification).toHaveBeenCalledWith(
			expect.anything(),
			"Couldn't open the upload dialog"
		);

		await fireEvent.click(add);
		await waitFor(() => expect(handleErrorWithNotification).toHaveBeenCalledTimes(2));
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
