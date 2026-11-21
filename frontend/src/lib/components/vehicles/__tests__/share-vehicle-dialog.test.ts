import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { CreateShareRequest, ShareLevel, VehicleShare } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const listGranted = vi.fn<() => Promise<VehicleShare[]>>();
const invite = vi.fn<(data: CreateShareRequest) => Promise<VehicleShare>>();
const changeLevel = vi.fn<(id: string, level: ShareLevel) => Promise<VehicleShare>>();
const revoke = vi.fn<(id: string) => Promise<void>>();

vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listGranted: () => listGranted(),
		invite: (data: CreateShareRequest) => invite(data),
		changeLevel: (id: string, level: ShareLevel) => changeLevel(id, level),
		revoke: (id: string) => revoke(id)
	}
}));

const toastSuccess = vi.fn<(message: string) => void>();
const toastError = vi.fn<(message: string) => void>();
vi.mock('svelte-sonner', () => ({
	toast: {
		success: (message: string) => toastSuccess(message),
		error: (message: string) => toastError(message)
	}
}));

import ShareVehicleDialog from '../ShareVehicleDialog.svelte';

function share(overrides: Partial<VehicleShare> = {}): VehicleShare {
	return {
		id: 's1',
		vehicleId: 'v1',
		ownerId: 'owner',
		sharedWithId: 'friend@example.com',
		level: 'viewer',
		status: 'pending',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function mount(props: { open?: boolean; vehicleId?: string | null } = {}) {
	return render(ShareVehicleDialog, {
		props: {
			open: props.open ?? true,
			vehicleId: props.vehicleId === undefined ? 'v1' : props.vehicleId,
			vehicleName: 'Daily Driver'
		}
	});
}

function emailInput(): HTMLInputElement {
	return screen.getByLabelText('Invitee email') as HTMLInputElement;
}

function sendButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /Send invitation|Sending/ }) as HTMLButtonElement;
}

async function pickOption(trigger: HTMLElement, optionName: string | RegExp): Promise<void> {
	await fireEvent.click(trigger);
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name: optionName }));
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	listGranted.mockResolvedValue([]);
	invite.mockResolvedValue(share());
	changeLevel.mockResolvedValue(share());
	revoke.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('ShareVehicleDialog loading the share list', () => {
	test('does not load shares while closed', async () => {
		mount({ open: false });
		await settle();

		expect(listGranted).not.toHaveBeenCalled();
	});

	test('does not load shares without a vehicle id', async () => {
		mount({ vehicleId: null });
		await settle();

		expect(listGranted).not.toHaveBeenCalled();
	});

	test('names the vehicle in the description', async () => {
		mount();
		await settle();

		expect(screen.getByText(/Invite another VROOM user to “Daily Driver”/)).toBeInTheDocument();
	});

	test('shows skeletons while the list is loading', async () => {
		listGranted.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
	});

	test('shows only shares for this vehicle', async () => {
		listGranted.mockResolvedValue([
			share({ id: 's1', sharedWithId: 'friend@example.com', status: 'accepted' }),
			share({ id: 's2', vehicleId: 'other', sharedWithId: 'stranger@example.com' })
		]);
		mount();
		await settle();

		expect(screen.getByText('friend@example.com')).toBeInTheDocument();
		expect(screen.getByText('accepted')).toBeInTheDocument();
		expect(screen.queryByText('stranger@example.com')).toBeNull();
	});

	test('shows the not-shared empty state when nobody has access', async () => {
		mount();
		await settle();

		expect(screen.getByText('Not shared yet')).toBeInTheDocument();
	});

	test('a load failure shows the error and Retry refetches', async () => {
		listGranted.mockRejectedValueOnce(new Error('Server unavailable'));
		listGranted.mockResolvedValueOnce([share()]);
		mount();
		await settle();

		expect(screen.getByText('Failed to load shares')).toBeInTheDocument();
		expect(screen.getByText('Server unavailable')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(listGranted).toHaveBeenCalledTimes(2);
		expect(screen.getByText('friend@example.com')).toBeInTheDocument();
	});

	test('a non-Error load failure falls back to a generic message', async () => {
		listGranted.mockRejectedValueOnce('boom');
		mount();
		await settle();

		expect(screen.getAllByText('Failed to load shares')).toHaveLength(2);
	});
});

describe('ShareVehicleDialog inviting', () => {
	test('Send invitation is disabled until an email is typed', async () => {
		mount();
		await settle();

		expect(sendButton()).toBeDisabled();

		await fireEvent.input(emailInput(), { target: { value: '   ' } });
		expect(sendButton()).toBeDisabled();

		await fireEvent.input(emailInput(), { target: { value: 'pat@example.com' } });
		expect(sendButton()).toBeEnabled();
	});

	test('a whitespace-only email never reaches the API', async () => {
		mount();
		await settle();

		await fireEvent.input(emailInput(), { target: { value: '   ' } });
		await fireEvent.submit(emailInput().closest('form') as HTMLFormElement);
		await settle();

		expect(invite).not.toHaveBeenCalled();
	});

	test('invites as viewer by default with a trimmed email, then resets and reloads', async () => {
		mount();
		await settle();

		await fireEvent.input(emailInput(), { target: { value: '  pat@example.com  ' } });
		await fireEvent.click(sendButton());
		await settle();

		expect(invite).toHaveBeenCalledWith({
			vehicleId: 'v1',
			email: 'pat@example.com',
			level: 'viewer'
		});
		expect(toastSuccess).toHaveBeenCalledWith('Invited pat@example.com as viewer');
		expect(emailInput().value).toBe('');
		expect(listGranted).toHaveBeenCalledTimes(2);
	});

	test('the editor permission level is sent when chosen', async () => {
		mount();
		await settle();

		await pickOption(document.getElementById('share-level') as HTMLElement, /Editor/);
		expect(document.getElementById('share-level')).toHaveTextContent('Editor');

		await fireEvent.input(emailInput(), { target: { value: 'pat@example.com' } });
		await fireEvent.click(sendButton());
		await settle();

		expect(invite).toHaveBeenCalledWith({
			vehicleId: 'v1',
			email: 'pat@example.com',
			level: 'editor'
		});
		expect(toastSuccess).toHaveBeenCalledWith('Invited pat@example.com as editor');
		expect(document.getElementById('share-level')).toHaveTextContent('Viewer');
	});

	test('shows Sending… while the invitation is in flight', async () => {
		let release: (value: VehicleShare) => void = () => {};
		invite.mockReturnValue(
			new Promise<VehicleShare>(resolve => {
				release = resolve;
			})
		);
		mount();
		await settle();

		await fireEvent.input(emailInput(), { target: { value: 'pat@example.com' } });
		await fireEvent.click(sendButton());
		await settle();

		expect(sendButton()).toHaveTextContent('Sending…');
		expect(sendButton()).toBeDisabled();

		release(share());
		await settle();
		expect(sendButton()).toHaveTextContent('Send invitation');
	});

	test('an API error message from the server is shown verbatim and the email is kept', async () => {
		invite.mockRejectedValue(new ApiError('No VROOM user with that email', 404));
		mount();
		await settle();

		await fireEvent.input(emailInput(), { target: { value: 'nobody@example.com' } });
		await fireEvent.click(sendButton());
		await settle();

		expect(toastError).toHaveBeenCalledWith('No VROOM user with that email');
		expect(toastSuccess).not.toHaveBeenCalled();
		expect(emailInput().value).toBe('nobody@example.com');
	});

	test('a non-API failure shows a generic retry message', async () => {
		invite.mockRejectedValue(new Error('socket hang up'));
		mount();
		await settle();

		await fireEvent.input(emailInput(), { target: { value: 'pat@example.com' } });
		await fireEvent.click(sendButton());
		await settle();

		expect(toastError).toHaveBeenCalledWith('Could not send the invitation. Try again.');
	});
});

describe('ShareVehicleDialog managing existing shares', () => {
	test('changing a share to editor calls the API and reloads', async () => {
		listGranted.mockResolvedValue([share()]);
		mount();
		await settle();

		await pickOption(
			screen.getByRole('combobox', { name: 'Change access level for friend@example.com' }),
			'Editor'
		);

		expect(changeLevel).toHaveBeenCalledWith('s1', 'editor');
		expect(toastSuccess).toHaveBeenCalledWith('Changed to editor');
		expect(listGranted).toHaveBeenCalledTimes(2);
	});

	test('picking the level a share already has makes no API call', async () => {
		listGranted.mockResolvedValue([share({ level: 'editor' })]);
		mount();
		await settle();

		const trigger = screen.getByRole('combobox', {
			name: 'Change access level for friend@example.com'
		});
		await fireEvent.click(trigger);
		await settle();
		await fireEvent.pointerUp(screen.getByRole('option', { name: 'Editor' }));
		await settle();

		expect(changeLevel).not.toHaveBeenCalled();
	});

	test('a failed level change shows an error toast', async () => {
		listGranted.mockResolvedValue([share()]);
		changeLevel.mockRejectedValue(new Error('nope'));
		mount();
		await settle();

		await pickOption(
			screen.getByRole('combobox', { name: 'Change access level for friend@example.com' }),
			'Editor'
		);

		expect(toastError).toHaveBeenCalledWith('Could not change the level. Try again.');
	});

	test('revoking access calls the API, confirms and reloads', async () => {
		listGranted.mockResolvedValueOnce([share()]);
		listGranted.mockResolvedValueOnce([]);
		mount();
		await settle();

		await fireEvent.click(
			screen.getByRole('button', { name: 'Revoke access for friend@example.com' })
		);
		await settle();

		expect(revoke).toHaveBeenCalledWith('s1');
		expect(toastSuccess).toHaveBeenCalledWith('Access revoked');
		await waitFor(() => expect(screen.getByText('Not shared yet')).toBeInTheDocument());
	});

	test('a failed revoke shows an error toast and keeps the row', async () => {
		listGranted.mockResolvedValue([share()]);
		revoke.mockRejectedValue(new Error('nope'));
		mount();
		await settle();

		await fireEvent.click(
			screen.getByRole('button', { name: 'Revoke access for friend@example.com' })
		);
		await settle();

		expect(toastError).toHaveBeenCalledWith('Could not revoke access. Try again.');
		expect(screen.getByText('friend@example.com')).toBeInTheDocument();
	});
});
