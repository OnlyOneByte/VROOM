import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RestoreProviderInfo, RestoreResult } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const sheetsProvider: RestoreProviderInfo = {
	providerId: 'prov-1',
	providerType: 'google-drive',
	displayName: 'Drive',
	accountEmail: 'owner@example.com',
	sourceTypes: ['sheets']
};
const preview: RestoreResult = {
	success: true,
	preview: { vehicles: 2, expenses: 6 },
	merge: { imported: { vehicles: 1, expenses: 2 }, kept: { vehicles: 1, expenses: 4 } }
};
const restoreFromProvider = vi.fn((_request: { mode: string }) => Promise.resolve(preview));
const uploadBackup = vi.fn((_file: File, _mode: string) => Promise.resolve(preview));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		loadRestoreProviders: () => Promise.resolve([sheetsProvider]),
		restoreFromProvider: (request: { mode: string }) => restoreFromProvider(request),
		uploadBackup: (file: File, mode: string) => uploadBackup(file, mode),
		load: () => Promise.resolve()
	}
}));

const RestoreDialog = (await import('../RestoreDialog.svelte')).default;

function renderDialog() {
	const onRestore = vi.fn();
	render(RestoreDialog, {
		props: { open: true, backupProviders: [], sheetsSyncEnabled: true, onRestore, onClose: vi.fn() }
	});
	return onRestore;
}

async function openSheetsPreview() {
	const onRestore = renderDialog();
	await fireEvent.click(await screen.findByText('Restore from provider'));
	await screen.findByText('How to restore');
	return onRestore;
}

const modes = () => restoreFromProvider.mock.calls.map(([request]) => request.mode);

beforeEach(() => {
	restoreFromProvider.mockReset().mockResolvedValue(preview);
	uploadBackup.mockReset().mockResolvedValue(preview);
});

describe('RestoreDialog merge', () => {
	test('merge is the default, says what it keeps, and shows what it would add', async () => {
		await openSheetsPreview();

		expect(screen.getByRole('radio', { name: /Merge with what's here/ })).toBeChecked();
		expect(screen.getByText(/Keeps anything you added since the backup/)).toBeInTheDocument();
		expect(screen.getByTestId('restore-merge-counts')).toHaveTextContent(
			'3 records to add, 5 already here or skipped.'
		);
		expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled();
	});

	test('a backup with nothing new says so', async () => {
		restoreFromProvider.mockResolvedValue({
			...preview,
			merge: { imported: { vehicles: 0 }, kept: { vehicles: 2, expenses: 6 } }
		});
		await openSheetsPreview();

		expect(screen.getByTestId('restore-merge-counts')).toHaveTextContent(
			'Nothing to add: all 8 records in this backup are already here or skipped.'
		);
	});

	test('confirming sends a merge restore', async () => {
		const onRestore = await openSheetsPreview();
		restoreFromProvider.mockResolvedValue({ success: true, imported: { vehicles: 1 }, kept: {} });

		await fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

		await vi.waitFor(() => expect(onRestore).toHaveBeenCalled());
		expect(modes()).toEqual(['preview', 'merge']);
	});

	test('a replace refused as a conflict offers Merge instead, which merges', async () => {
		const onRestore = await openSheetsPreview();
		await fireEvent.click(screen.getByRole('radio', { name: /Replace everything/ }));
		restoreFromProvider.mockRejectedValueOnce(
			new ApiError('Some people have their own roles. Remove those changes first.', 409)
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Replace everything' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Merge instead' }));

		await vi.waitFor(() => expect(onRestore).toHaveBeenCalled());
		expect(modes()).toEqual(['preview', 'replace', 'merge']);
	});

	test('other replace failures do not offer a merge', async () => {
		await openSheetsPreview();
		await fireEvent.click(screen.getByRole('radio', { name: /Replace everything/ }));
		restoreFromProvider.mockRejectedValueOnce(new ApiError('The backup is empty', 400));

		await fireEvent.click(screen.getByRole('button', { name: 'Replace everything' }));

		await screen.findByText(/Couldn't restore/);
		expect(screen.queryByRole('button', { name: 'Merge instead' })).toBeNull();
	});
});
