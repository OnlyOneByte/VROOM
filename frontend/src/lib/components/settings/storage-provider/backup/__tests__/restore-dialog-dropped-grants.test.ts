import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RestoreDroppedReason, RestoreProviderInfo, RestoreResult } from '#lib/types/index.ts';

const sheetsProvider: RestoreProviderInfo = {
	providerId: 'prov-1',
	providerType: 'google-drive',
	displayName: 'Drive',
	accountEmail: 'owner@example.com',
	sourceTypes: ['sheets']
};
const preview: RestoreResult = { success: true, preview: { vehicles: 2, expenses: 6 } };
const restoreFromProvider = vi.fn((_request: { mode: string }) => Promise.resolve(preview));
const getVehicles = vi.fn(() =>
	Promise.resolve([
		{ id: 'car-1', year: 2019, make: 'Honda', model: 'Civic', nickname: 'Blue' },
		{ id: 'car-2', year: 2015, make: 'Ford', model: 'Focus' }
	])
);
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		loadRestoreProviders: () => Promise.resolve([sheetsProvider]),
		restoreFromProvider: (request: { mode: string }) => restoreFromProvider(request),
		uploadBackup: vi.fn(),
		load: () => Promise.resolve()
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

const RestoreDialog = (await import('../RestoreDialog.svelte')).default;

async function replaceRestore(result: RestoreResult) {
	const onRestore = vi.fn();
	const view = render(RestoreDialog, {
		props: { open: true, backupProviders: [], sheetsSyncEnabled: true, onRestore, onClose: vi.fn() }
	});
	await runReplace(onRestore, result);
	return view;
}

async function runReplace(onRestore: ReturnType<typeof vi.fn>, result: RestoreResult) {
	await fireEvent.click(await screen.findByText('Restore from provider'));
	await screen.findByText('How to restore');
	await fireEvent.click(screen.getByRole('radio', { name: /Replace everything/ }));
	restoreFromProvider.mockResolvedValueOnce(result);
	await fireEvent.click(screen.getByRole('button', { name: 'Replace everything' }));
	await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(result));
}

const dropped = (
	vehicleId: string,
	reason: RestoreDroppedReason,
	kind: 'role' | 'override' = 'override'
) => ({
	kind,
	vehicleId,
	userId: `person-${reason}`,
	reason
});

beforeEach(() => {
	restoreFromProvider.mockReset().mockResolvedValue(preview);
	getVehicles.mockClear();
});

describe('RestoreDialog after a full restore', () => {
	test('lists the sharing settings that were not brought back, by car, in plain words', async () => {
		await replaceRestore({
			success: true,
			imported: { vehicles: 2 },
			grants: {
				reapplied: 3,
				dropped: [
					dropped('car-1', 'person_not_active', 'role'),
					dropped('car-1', 'person_not_active'),
					dropped('car-1', 'role_not_assignable', 'role'),
					dropped('car-2', 'person_not_active'),
					dropped('gone-car', 'vehicle_not_restored')
				]
			}
		});

		expect(await screen.findByText('Restore finished')).toBeInTheDocument();
		const list = within(screen.getByTestId('restore-dropped-grants'));
		await list.findByText('Blue');
		const items = list
			.getAllByRole('listitem')
			.map(item =>
				[...item.children].map(line => line.textContent?.replace(/\s+/g, ' ').trim()).join(' | ')
			);
		expect(items).toEqual([
			"Blue | 2 sharing settings: the person isn't active on this car any more. | 1 sharing setting: that role isn't available any more.",
			"2015 Ford Focus | 1 sharing setting: the person isn't active on this car any more.",
			"A car not in this backup | 1 sharing setting: the car isn't in this backup."
		]);
		expect(screen.getByTestId('restore-dropped-grants')).not.toHaveTextContent(/person-/);
		expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus());

		await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		await vi.waitFor(() => expect(screen.queryByText('Restore finished')).toBeNull());
	});

	test('after Done, opening the dialog again starts from the beginning', async () => {
		const view = await replaceRestore({
			success: true,
			imported: { vehicles: 1 },
			grants: { reapplied: 0, dropped: [dropped('car-1', 'person_not_active')] }
		});
		await fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
		await vi.waitFor(() => expect(screen.queryByText('Restore finished')).toBeNull());

		await view.rerender({ open: true });

		expect(await screen.findByText('Restore Data')).toBeInTheDocument();
		expect(screen.queryByTestId('restore-dropped-grants')).toBeNull();
		expect(screen.getByText('Restore from provider')).toBeInTheDocument();
	});

	test('while a restore runs the dialog cannot be closed, and it can again once it finishes', async () => {
		const onRestore = vi.fn();
		render(RestoreDialog, {
			props: {
				open: true,
				backupProviders: [],
				sheetsSyncEnabled: true,
				onRestore,
				onClose: vi.fn()
			}
		});
		await fireEvent.click(await screen.findByText('Restore from provider'));
		await screen.findByText('How to restore');
		await fireEvent.click(screen.getByRole('radio', { name: /Replace everything/ }));
		let finish: (result: RestoreResult) => void = () => {};
		restoreFromProvider.mockImplementationOnce(
			() => new Promise<RestoreResult>(resolve => (finish = resolve))
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Replace everything' }));
		await screen.findByText('Restoring…');

		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
		await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
		expect(screen.getByText('Restoring…')).toBeInTheDocument();

		const result = {
			success: true,
			imported: { vehicles: 1 },
			grants: { reapplied: 0, dropped: [dropped('car-1', 'person_not_active')] }
		};
		finish(result);
		await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(result));
		expect(await screen.findByText('Restore finished')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	test('when every grant came back the dialog just closes', async () => {
		await replaceRestore({
			success: true,
			imported: { vehicles: 2 },
			grants: { reapplied: 2, dropped: [] }
		});

		await vi.waitFor(() => expect(screen.queryByText('How to restore')).toBeNull());
		expect(screen.queryByText('Restore finished')).toBeNull();
		expect(getVehicles).not.toHaveBeenCalled();
	});

	test('a car list that fails to load still shows the list without names', async () => {
		getVehicles.mockRejectedValueOnce(new Error('offline'));
		await replaceRestore({
			success: true,
			imported: { vehicles: 1 },
			grants: { reapplied: 0, dropped: [dropped('car-1', 'role_not_assignable', 'role')] }
		});

		const list = within(await screen.findByTestId('restore-dropped-grants'));
		await vi.waitFor(() => expect(getVehicles).toHaveBeenCalled());
		expect(list.getByRole('listitem').textContent?.replace(/\s+/g, ' ').trim()).toBe(
			"One of your cars 1 sharing setting: that role isn't available any more."
		);
	});
});
