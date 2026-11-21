import { render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { VehicleShare } from '#lib/types/index.ts';

const share = (id: string, sharedWithId: string, status: VehicleShare['status']) =>
	({
		id,
		vehicleId: 'v1',
		ownerId: 'u1',
		sharedWithId,
		level: 'viewer',
		status,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	}) as VehicleShare;

vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listGranted: () =>
			Promise.resolve([
				share('s1', 'pending@example.com', 'pending'),
				share('s2', 'accepted@example.com', 'accepted'),
				share('s3', 'revoked@example.com', 'revoked'),
				share('s4', 'declined@example.com', 'declined'),
				{ ...share('s5', 'other-vehicle@example.com', 'accepted'), vehicleId: 'v2' }
			]),
		invite: vi.fn(),
		changeLevel: vi.fn(),
		revoke: vi.fn()
	}
}));

const ShareVehicleDialog = (await import('../ShareVehicleDialog.svelte')).default;

describe('ShareVehicleDialog "People with access"', () => {
	test('lists only pending and accepted shares of this vehicle', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		expect(await screen.findByText('pending@example.com')).toBeInTheDocument();
		expect(screen.getByText('accepted@example.com')).toBeInTheDocument();
		expect(screen.queryByText('revoked@example.com')).toBeNull();
		expect(screen.queryByText('declined@example.com')).toBeNull();
		expect(screen.queryByText('other-vehicle@example.com')).toBeNull();
	});

	test('the list can shrink below its longest name, so the name truncates instead of widening the dialog', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		const heading = await screen.findByRole('heading', { name: 'People with access' });
		expect(heading.parentElement).toHaveClass('min-w-0');
		expect(await screen.findByText('accepted@example.com')).toHaveClass('truncate');
	});
});
