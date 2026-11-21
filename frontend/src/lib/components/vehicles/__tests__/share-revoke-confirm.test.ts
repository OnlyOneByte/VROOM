import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GrantedShare } from '#lib/types/index.ts';

const SHARE = {
	id: 's1',
	vehicleId: 'v1',
	ownerId: 'u1',
	sharedWithId: 'u-friend',
	sharedWithEmail: 'friend@example.com',
	sharedWithName: '',
	level: 'viewer',
	status: 'accepted',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
} as unknown as GrantedShare;

const listGranted = vi.fn(() => Promise.resolve([SHARE]));
const revoke = vi.fn((_id: string) => Promise.resolve());
vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listGranted: () => listGranted(),
		invite: vi.fn(),
		changeLevel: vi.fn(),
		revoke: (id: string) => revoke(id)
	}
}));

const ShareVehicleDialog = (await import('../ShareVehicleDialog.svelte')).default;

beforeEach(() => {
	listGranted.mockClear();
	revoke.mockClear();
});

describe('ShareVehicleDialog revoke', () => {
	test('asks before revoking and names who loses access', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		await fireEvent.click(
			await screen.findByRole('button', { name: 'Revoke access for friend@example.com' })
		);

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent('Revoke access?');
		expect(dialog).toHaveTextContent('friend@example.com will no longer see “Daily Driver”');
		expect(revoke).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(revoke).toHaveBeenCalledWith('s1'));
	});

	test('a failed revoke keeps the dialog open so the user can retry', async () => {
		revoke.mockRejectedValueOnce(new Error('boom'));
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		await fireEvent.click(
			await screen.findByRole('button', { name: 'Revoke access for friend@example.com' })
		);
		await fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

		await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled());
		await new Promise(resolve => setTimeout(resolve, 300));
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});
});
