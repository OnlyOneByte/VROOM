import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RestoreProviderInfo, RestoreResult } from '#lib/types/index.ts';

const restoreFromProvider = vi.fn((_request: unknown) =>
	Promise.resolve({ success: true } as RestoreResult)
);
const sheetsProvider: RestoreProviderInfo = {
	providerId: 'prov-1',
	providerType: 'google-drive',
	displayName: 'Drive',
	accountEmail: 'owner@example.com',
	sourceTypes: ['sheets']
};
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		loadRestoreProviders: () => Promise.resolve([sheetsProvider]),
		restoreFromProvider: (request: unknown) => restoreFromProvider(request)
	}
}));

const RestoreDialog = (await import('../RestoreDialog.svelte')).default;

async function previewFromSheets(result: RestoreResult): Promise<void> {
	restoreFromProvider.mockResolvedValue(result);
	render(RestoreDialog, {
		props: {
			open: true,
			backupProviders: [],
			sheetsSyncEnabled: true,
			onRestore: vi.fn(),
			onClose: vi.fn()
		}
	});
	await fireEvent.click(await screen.findByText('Restore from provider'));
	await screen.findByText('Import Summary');
}

beforeEach(() => {
	restoreFromProvider.mockReset();
});

describe('RestoreDialog skipped photos', () => {
	test('the preview tells the user how many photos will be skipped', async () => {
		await previewFromSheets({
			success: true,
			preview: { vehicles: 1, expenses: 0, insurance: 0, photos: 1 },
			skipped: { photos: 2 }
		});

		expect(screen.getByTestId('restore-skipped-photos')).toHaveTextContent(
			"2 photos won't be restored because the records they were attached to were deleted."
		);
		expect(restoreFromProvider).toHaveBeenCalledWith(
			expect.objectContaining({ sourceType: 'sheets', mode: 'preview' })
		);
	});

	test('no notice when nothing is skipped', async () => {
		await previewFromSheets({ success: true, preview: { vehicles: 1 } });

		expect(screen.queryByTestId('restore-skipped-photos')).toBeNull();
	});
});
