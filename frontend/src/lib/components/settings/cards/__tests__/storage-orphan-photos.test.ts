import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const count = vi.fn(() => Promise.resolve(0));
const remove = vi.fn(() => Promise.resolve({ removed: 0, failed: 0 }));
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock('#lib/services/photo-api.ts', () => ({
	orphanedPhotosApi: { count: () => count(), remove: () => remove() }
}));
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return { ...actual, providerApi: { getProviders: () => Promise.resolve([]) } };
});
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ storageConfig: null, backupConfig: { providers: {} } }),
		updateSettings: vi.fn()
	}
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => Promise.resolve(null)
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showSuccess: (m: string) => showSuccess(m), showError: (m: string) => showError(m) }
}));

const StorageProvidersCard = (await import('../StorageProvidersCard.svelte')).default;

beforeEach(() => {
	count.mockReset();
	remove.mockReset();
	showSuccess.mockReset();
	showError.mockReset();
});

describe('Storage Providers: photos no longer attached to anything', () => {
	test('shows nothing when there are no such photos', async () => {
		count.mockResolvedValue(0);
		render(StorageProvidersCard, { props: {} });
		await screen.findByText(/No storage connected yet/);
		expect(screen.queryByText(/no longer attached/)).toBeNull();
	});

	test('shows nothing when the count cannot be loaded', async () => {
		count.mockRejectedValue(new Error('boom'));
		render(StorageProvidersCard, { props: {} });
		await screen.findByText(/No storage connected yet/);
		expect(screen.queryByText(/no longer attached/)).toBeNull();
	});

	test('names the count and asks before removing anything', async () => {
		count.mockResolvedValue(3);
		render(StorageProvidersCard, { props: {} });

		expect(
			await screen.findByText('3 photos are no longer attached to anything.')
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove them' }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent('Remove 3 photos?');
		expect(dialog).toHaveTextContent('VROOM deletes them and their files in your storage.');
		expect(remove).not.toHaveBeenCalled();
	});

	test('confirming removes them, says how many, and hides the notice', async () => {
		count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
		remove.mockResolvedValue({ removed: 1, failed: 0 });
		render(StorageProvidersCard, { props: {} });

		expect(
			await screen.findByText('1 photo is no longer attached to anything.')
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Removed 1 photo'));
		await waitFor(() => expect(screen.queryByText(/no longer attached/)).toBeNull());
	});

	test('photos whose files could not be deleted stay listed, and the user is told why', async () => {
		count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
		remove.mockResolvedValue({ removed: 2, failed: 1 });
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('button', { name: 'Remove them' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Removed 2 photos'));
		expect(showError).toHaveBeenCalledWith(
			"Couldn't delete 1 photo from your storage. It stays listed here so you can try again later."
		);
		expect(
			await screen.findByText('1 photo is no longer attached to anything.')
		).toBeInTheDocument();
	});

	test('a failed removal explains it in a sentence and keeps the notice', async () => {
		count.mockResolvedValue(2);
		remove.mockRejectedValue(new Error('network'));
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('button', { name: 'Remove them' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(showError).toHaveBeenCalled());
		expect(showError.mock.calls[0]?.[0]).toMatch(/^Couldn't remove the photos\. /);
		expect(screen.getByText('2 photos are no longer attached to anything.')).toBeInTheDocument();
	});
});
