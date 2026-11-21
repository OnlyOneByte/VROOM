import { render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { GrantedShare } from '#lib/types/index.ts';

const share = (id: string, sharedWithEmail: string, status: GrantedShare['status']) =>
	({
		id,
		vehicleId: 'v1',
		ownerId: 'u1',
		sharedWithId: `u-${id}`,
		sharedWithEmail,
		sharedWithName: '',
		level: 'viewer',
		status,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	}) as GrantedShare;

vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listGranted: () =>
			Promise.resolve([
				share('s1', 'pending@example.com', 'pending'),
				share('s2', 'accepted@example.com', 'accepted'),
				share('s3', 'revoked@example.com', 'revoked'),
				share('s4', 'declined@example.com', 'declined'),
				{ ...share('s5', 'other-vehicle@example.com', 'accepted'), vehicleId: 'v2' },
				{ ...share('s6', 'sam@example.com', 'accepted'), sharedWithName: 'Sam Rivera' },
				{ ...share('s7', 'blank-name@example.com', 'accepted'), sharedWithName: '   ' },
				{
					...share('s8', '', 'pending'),
					sharedWithEmail: null,
					sharedWithName: null,
					createdAt: '2026-03-04T12:00:00.000Z'
				}
			]),
		invite: vi.fn(),
		changeLevel: vi.fn(),
		revoke: vi.fn()
	}
}));

const ShareVehicleDialog = (await import('../ShareVehicleDialog.svelte')).default;

const rowDetail = (text: string) => (_content: string, element: Element | null) =>
	element?.tagName === 'P' && element.textContent === text;

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

	test('a row shows the invitee by name, with their email and status, never their user id', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		expect(await screen.findByText('Sam Rivera')).toBeInTheDocument();
		expect(screen.getByText(rowDetail('accepted · sam@example.com'))).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Revoke access for Sam Rivera' })
		).toBeInTheDocument();
		expect(screen.queryByText('u-s6')).toBeNull();
	});

	test('a blank display name falls back to the email', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		expect(
			await screen.findByRole('button', { name: 'Revoke access for blank-name@example.com' })
		).toBeInTheDocument();
	});

	test('a pending invitation the API does not name is shown by when it was sent, never by id', async () => {
		render(ShareVehicleDialog, {
			props: { open: true, vehicleId: 'v1', vehicleName: 'Daily Driver' }
		});

		expect(await screen.findByText('Pending invitation')).toBeInTheDocument();
		expect(screen.getByText(rowDetail('pending · sent Mar 4, 2026'))).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Revoke access for the invitation sent Mar 4, 2026' })
		).toBeInTheDocument();
		expect(screen.queryByText('u-s8')).toBeNull();
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
