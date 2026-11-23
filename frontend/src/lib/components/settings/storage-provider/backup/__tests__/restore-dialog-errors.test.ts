import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RestoreProviderInfo, RestoreResult } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const sheetsProvider: RestoreProviderInfo = {
	providerId: 'prov-1',
	providerType: 'google-drive',
	displayName: 'Drive',
	accountEmail: 'owner@example.com',
	sourceTypes: ['sheets']
};
const loadRestoreProviders = vi.fn(() => Promise.resolve([sheetsProvider]));
const restoreFromProvider = vi.fn((_request: unknown) =>
	Promise.resolve({ success: true } as RestoreResult)
);
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		loadRestoreProviders: () => loadRestoreProviders(),
		restoreFromProvider: (request: unknown) => restoreFromProvider(request)
	}
}));

const RestoreDialog = (await import('../RestoreDialog.svelte')).default;

async function openProviderFlow(): Promise<void> {
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
}

beforeEach(() => {
	loadRestoreProviders.mockReset().mockResolvedValue([sheetsProvider]);
	restoreFromProvider.mockReset();
});

describe('RestoreDialog errors', () => {
	test('a server failure while loading providers is a plain sentence, not the raw text', async () => {
		loadRestoreProviders.mockRejectedValue(new ApiError('SQLITE_BUSY: database is locked', 500));
		await openProviderFlow();

		expect(
			await screen.findByText(`Couldn't load your storage providers. ${SERVER_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
		expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
	});

	test('an API reason for a failed Sheets preview is passed through', async () => {
		restoreFromProvider.mockRejectedValue(new ApiError('The spreadsheet has no Vehicles tab', 400));
		await openProviderFlow();

		expect(
			await screen.findByText(
				"Couldn't preview the Sheets data. The spreadsheet has no Vehicles tab."
			)
		).toBeInTheDocument();
	});

	test('the first backup check that failed is shown, not the generic validation message', async () => {
		const newer =
			'This backup was made by a newer version of VROOM. Update VROOM, then restore it again.';
		restoreFromProvider.mockRejectedValue(
			new ApiError(
				'Sheet data validation failed',
				400,
				{ validationErrors: [newer, 'Invalid metadata'] },
				'ValidationError'
			)
		);
		await openProviderFlow();

		expect(
			await screen.findByText(`Couldn't preview the Sheets data. ${newer}`)
		).toBeInTheDocument();
		expect(screen.queryByText(/validation failed/)).toBeNull();
	});
});
